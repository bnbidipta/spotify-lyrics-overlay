# Stop any running overlay process to unlock files
Stop-Process -Name "spotify-lyrics-overlay" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 1. Build Neutralino App
Set-Location -Path "neutralino-app"
npx @neutralinojs/neu build
Set-Location -Path ".."

# 2. Copy compiled assets to release folder
Copy-Item "neutralino-app\dist\spotify-lyrics-overlay\resources.neu" "neutralino-release\resources.neu" -Force
Copy-Item "neutralino-app\dist\spotify-lyrics-overlay\spotify-lyrics-overlay-win_x64.exe" "neutralino-release\spotify-lyrics-overlay.exe" -Force
Copy-Item "neutralino-app\auth_listener.ps1" "neutralino-release\auth_listener.ps1" -Force
Copy-Item "neutralino-app\fetch_lyrics.ps1" "neutralino-release\fetch_lyrics.ps1" -Force
Copy-Item "neutralino-app\secure_store.ps1" "neutralino-release\secure_store.ps1" -Force

# 3. Create zip file
Remove-Item "spotify-lyrics-overlay-win-x64-*.zip" -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "neutralino-release\*" -DestinationPath "spotify-lyrics-overlay-win-x64-v2.0.0.zip" -Force

# 4. Git actions
git add .
$msg = Read-Host "Enter commit message"
if (-not $msg) {
    $msg = "security: PKCE + no secret, fix RCE via code/track injection, remove port killer"
}
git commit -m $msg

$pushChoice = Read-Host "Press y to push"
if ($pushChoice -eq "y") {
    git push origin main
    git tag -d v2.0.0 2>$null
    git push origin --delete v2.0.0 2>$null
    git tag v2.0.0
    git push origin v2.0.0
}
