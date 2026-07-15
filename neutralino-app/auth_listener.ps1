param(
    [int]$Port,
    [string]$ExpectedState
)

# Force stdout encoding to UTF-8
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch [System.IO.IOException] {}

if ($Port -lt 1024 -or $Port -gt 65535) {
    @{ error = "Invalid port number: $Port. Must be between 1024 and 65535." } | ConvertTo-Json -Compress
    exit
}

$listener = $null
$code = $null
$returnedState = $null

try {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    
    # Asynchronous wait with a 30-second timeout
    $ctxTask = $listener.GetContextAsync()
    if (-not $ctxTask.Wait(30000)) { 
        throw "Authentication timed out (30 seconds)." 
    }
    
    $ctx = $ctxTask.Result
    $req = $ctx.Request
    if ($req.Url.LocalPath -ne "/callback") { 
        throw "Invalid redirect path received: $($req.Url.LocalPath)" 
    }
    
    $code = $req.QueryString["code"]
    $returnedState = $req.QueryString["state"]
    $err = $req.QueryString["error"]
    
    if ($err) { 
        throw "Spotify auth error: $err" 
    }
    if ($ExpectedState -and $returnedState -ne $ExpectedState) { 
        throw "CSRF state validation failed." 
    }
    if (-not $code -or $code -notmatch "^[A-Za-z0-9_-]{10,}$") { 
        throw "Invalid authorization code format." 
    }

    $html = "<html><body style='background:#121212;color:white;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;'><div style='background:#1e1e1e;padding:40px;border-radius:16px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.5);'><h2 style='color:#1DB954;margin-top:0;'>Login Successful!</h2><p style='color:#b3b3b3;margin-bottom:0;'>You can close this tab and return to the lyrics overlay application.</p></div></body></html>"
    $buf = [System.Text.Encoding]::UTF8.GetBytes($html)
    $ctx.Response.ContentLength64 = $buf.Length
    $ctx.Response.Headers.Add("Content-Type","text/html")
    $ctx.Response.OutputStream.Write($buf,0,$buf.Length)
    $ctx.Response.OutputStream.Close()
} catch {
    $Output = @{ error = $_.Exception.Message }
    $Output | ConvertTo-Json -Compress
    exit
} finally {
    if ($listener) {
        $listener.Stop()
        $listener.Close()
    }
}

if ($code) {
    @{ code=$code; state=$returnedState } | ConvertTo-Json -Compress
}
