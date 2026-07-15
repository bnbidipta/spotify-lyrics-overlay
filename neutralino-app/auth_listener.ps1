param(
    [Parameter(Mandatory=$true)][int]$Port,
    [Parameter(Mandatory=$true)][string]$ExpectedState
)

# Validate port range
if ($Port -lt 1024 -or $Port -gt 65535) {
    Write-Error "Invalid port: $Port"
    exit 1
}

# Validate state format (UUID)
if ($ExpectedState -notmatch "^[A-Za-z0-9_-]{8,64}$") {
    Write-Error "Invalid state format"
    exit 1
}

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$code = $null
$returnedState = $null

try {
    $listener.Start()
    
    # Wait up to 90 seconds async
    $contextTask = $listener.GetContextAsync()
    if (-not $contextTask.Wait(90000)) {
        throw "Authentication timeout - no response from browser"
    }
    
    $context = $contextTask.Result
    $request = $context.Request
    $response = $context.Response

    # Validate path
    if ($request.Url.LocalPath -ne "/callback") {
        $request.Url.LocalPath | Out-Null
        throw "Invalid callback path: $($request.Url.LocalPath)"
    }

    $returnedState = $request.QueryString["state"]
    $errorParam = $request.QueryString["error"]
    $codeParam = $request.QueryString["code"]

    if ($errorParam) {
        throw "Spotify returned error: $errorParam - $($request.QueryString["error_description"])"
    }

    if (-not $returnedState -or $returnedState -ne $ExpectedState) {
        throw "State mismatch - possible CSRF attack. Expected: $ExpectedState, Got: $returnedState"
    }

    if (-not $codeParam -or $codeParam.Length -lt 10 -or $codeParam.Length -gt 500) {
        throw "Invalid code length"
    }

    # Strict code format validation - Spotify codes are base64url-ish
    if ($codeParam -notmatch "^[A-Za-z0-9_-]+$") {
        throw "Invalid code format"
    }

    $code = $codeParam
    $returnedState = $request.QueryString["state"]

    # Success HTML
    $html = @"
<html><head><title>Success</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#121212;color:white}
.card{background:#1e1e1e;padding:40px;border-radius:16px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.6);max-width:400px}
h2{color:#1DB954;margin-top:0} p{color:#b3b3b3;line-height:1.5}
</style></head><body><div class='card'><h2>Login Successful!</h2><p>Spotify linked. Return to overlay app. This window will close automatically.</p><script>setTimeout(()=>window.close(),2000)</script></div></body></html>
"@
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
    $response.ContentLength64 = $buffer.Length
    $response.Headers.Add("Content-Type", "text/html; charset=utf-8")
    $response.Headers.Add("Cache-Control", "no-store")
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.OutputStream.Close()

} catch {
    $errMsg = $_.Exception.Message
    Write-Error $errMsg
    # Try to send error page if we have context
    try {
        if ($context -and $context.Response) {
            $html = "<html><body style='background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh'><div style='background:#1e1e1e;padding:20px;border-radius:12px'><h2 style='color:#ff4444'>Error</h2><p>$errMsg</p></div></body></html>"
            $buf = [System.Text.Encoding]::UTF8.GetBytes($html)
            $context.Response.ContentLength64 = $buf.Length
            $context.Response.OutputStream.Write($buf,0,$buf.Length)
            $context.Response.OutputStream.Close()
        }
    } catch {}
} finally {
    try { $listener.Stop() } catch {}
    try { $listener.Close() } catch {}
}

if ($code -and $returnedState) {
    @{ code=$code; state=$returnedState } | ConvertTo-Json -Compress
}
