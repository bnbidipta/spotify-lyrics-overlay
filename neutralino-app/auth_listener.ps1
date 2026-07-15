# Kill any process currently occupying port 8888 to prevent bind conflicts
$conn = Get-NetTCPConnection -LocalPort 8888 -ErrorAction SilentlyContinue
if ($conn) {
    try {
        Stop-Process -Id $conn.OwningProcess -Force
        Start-Sleep -Milliseconds 500
    } catch {}
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:8888/")
$code = $null
$state = $null

try {
    $listener.Start()
    
    # Asynchronous wait with a 30-second timeout (300 * 100ms)
    $result = $listener.BeginGetContext($null, $null)
    for ($i = 0; $i -lt 300; $i++) {
        if ($result.IsCompleted) {
            break
        }
        Start-Sleep -Milliseconds 100
    }
    
    if ($result.IsCompleted) {
        $context = $listener.EndGetContext($result)
        $code = $context.Request.QueryString["code"]
        $state = $context.Request.QueryString["state"]
        
        $response = $context.Response
        $html = "<html><head><title>Success</title><style>body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #121212; color: white; } .card { background: #1e1e1e; padding: 40px; border-radius: 16px; text-align: center; box-shadow: 0 8px 24px rgba(0,0,0,0.6); max-width: 400px; } h2 { color: #1DB954; margin-top: 0; } p { color: #b3b3b3; line-height: 1.5; }</style></head><body><div class='card'><h2>Login Successful!</h2><p>Spotify has been successfully linked. You can close this tab and return to the lyrics overlay application.</p></div></body></html>"
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $response.ContentLength64 = $buffer.Length
        $response.Headers.Add("Content-Type", "text/html")
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.OutputStream.Close()
    } else {
        # Timeout occurred
        $Output = @{ error = "TIMEOUT" }
        Write-Output ($Output | ConvertTo-Json -Compress)
        exit
    }
} catch {
    $Output = @{ error = $_.Exception.Message }
    Write-Output ($Output | ConvertTo-Json -Compress)
    exit
} finally {
    $listener.Stop()
}

if ($code) {
    $res = @{ code = $code; state = $state }
    Write-Output ($res | ConvertTo-Json -Compress)
}
