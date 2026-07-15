param(
    [string]$action,
    [string]$base64Data
)

# Force stdout encoding to UTF-8
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch [System.IO.IOException] {}

if (-not $base64Data -or -not $action) {
    Write-Output "ERROR: Missing parameters"
    exit
}

try {
    # Decode Base64 input securely
    $dataBytes = [System.Convert]::FromBase64String($base64Data)
    $dataStr = [System.Text.Encoding]::UTF8.GetString($dataBytes)

    if ($action -eq "encrypt") {
        # Encrypt the string using current user context DPAPI
        $sec = ConvertTo-SecureString $dataStr -AsPlainText -Force
        $encrypted = ConvertFrom-SecureString $sec
        $encBytes = [System.Text.Encoding]::UTF8.GetBytes($encrypted)
        Write-Output [System.Convert]::ToBase64String($encBytes)
    } elseif ($action -eq "decrypt") {
        # Decrypt the string back under current user context DPAPI
        $sec = ConvertTo-SecureString $dataStr
        $decrypted = [System.Management.Automation.PSCredential]::new("user", $sec).GetNetworkCredential().Password
        $decBytes = [System.Text.Encoding]::UTF8.GetBytes($decrypted)
        Write-Output [System.Convert]::ToBase64String($decBytes)
    } else {
        Write-Output "ERROR: Invalid action"
    }
} catch {
    Write-Output "ERROR: $($_.Exception.Message)"
}
