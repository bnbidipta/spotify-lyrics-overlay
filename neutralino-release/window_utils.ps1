param(
    [Parameter(Mandatory=$true)][string]$Action
)

# Load Win32 signatures
$signature = @"
[DllImport("user32.dll")]
public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

[DllImport("user32.dll")]
public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
"@

try {
    $type = Add-Type -MemberDefinition $signature -Name "Win32API" -Namespace Win32 -PassThru
} catch {
    # If already defined in session
    $type = [Win32.Win32API]
}

$GWL_EXSTYLE = -20
$WS_EX_LAYERED = 0x80000
$WS_EX_TRANSPARENT = 0x20

# Find window handle
$hwnd = [IntPtr]::Zero
$processes = Get-Process -Name "spotify-lyrics-overlay" -ErrorAction SilentlyContinue
foreach ($p in $processes) {
    if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
        $hwnd = $p.MainWindowHandle
        break
    }
}

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Error "Window handle not found."
    exit 1
}

$currentStyle = $type::GetWindowLong($hwnd, $GWL_EXSTYLE)

if ($Action -eq "enable-clickthrough") {
    $newStyle = $currentStyle -bor $WS_EX_LAYERED -bor $WS_EX_TRANSPARENT
    $type::SetWindowLong($hwnd, $GWL_EXSTYLE, $newStyle) | Out-Null
    Write-Output "Enabled click-through."
} elseif ($Action -eq "disable-clickthrough") {
    $newStyle = $currentStyle -band -bnot $WS_EX_TRANSPARENT
    $type::SetWindowLong($hwnd, $GWL_EXSTYLE, $newStyle) | Out-Null
    Write-Output "Disabled click-through."
}
