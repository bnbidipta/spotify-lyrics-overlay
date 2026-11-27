# Builds the app, native helpers, release zip and installer. Used by build_and_push.ps1 and CI.
# Optional code signing: set SIGNING_CERT (base64 .pfx) and SIGNING_PASSWORD env vars.
$ErrorActionPreference = "Stop"

# Stop any running overlay process to unlock files
Stop-Process -Name "overtone" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$version = (Get-Content "neutralino-app\package.json" -Raw | ConvertFrom-Json).version
Write-Host "Building Overtone v$version..." -ForegroundColor Cyan

# 1. Build Neutralino App
Push-Location "neutralino-app"
npx @neutralinojs/neu build
Pop-Location

# 2. Compile C# helpers
Write-Host "Compiling C# native helper binaries..." -ForegroundColor Cyan
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$helpers = @{
    auth_listener   = @()
    window_utils    = @("/r:System.Windows.Forms.dll", "/r:System.Drawing.dll")
    secure_store    = @("/r:System.Security.dll")
    fetch_lyrics    = @("/r:System.Web.Extensions.dll")
    obs_server      = @()
    spotify_watcher = @()
}
foreach ($name in $helpers.Keys) {
    & $csc /nologo @($helpers[$name]) "/out:neutralino-app\$name.exe" "neutralino-app\$name.cs"
    if ($LASTEXITCODE -ne 0) { throw "csc failed for $name" }
}

# 3. Copy compiled assets to a fresh release folder (never ships local config/tokens)
Remove-Item "neutralino-release" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "neutralino-release" -Force | Out-Null
Copy-Item "neutralino-app\dist\overtone\resources.neu" "neutralino-release\resources.neu" -Force
Copy-Item "neutralino-app\dist\overtone\overtone-win_x64.exe" "neutralino-release\overtone.exe" -Force
foreach ($name in $helpers.Keys) { Copy-Item "neutralino-app\$name.exe" "neutralino-release\$name.exe" -Force }
Copy-Item "neutralino-app\resources\icons\appIcon.ico" "neutralino-release\appIcon.ico" -Force
Copy-Item "LICENSE.txt" "neutralino-release\LICENSE.txt" -Force

function Invoke-Sign($files) {
    if (-not $env:SIGNING_CERT) { return }
    [System.IO.File]::WriteAllBytes("$PWD\cert.pfx", [System.Convert]::FromBase64String($env:SIGNING_CERT))
    $signtool = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits" -Filter signtool.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
    try {
        foreach ($f in $files) { & $signtool sign /f cert.pfx /p $env:SIGNING_PASSWORD /tr http://timestamp.digicert.com /td sha256 /fd sha256 $f.FullName }
    } finally { Remove-Item cert.pfx -Force }
}
Invoke-Sign (Get-ChildItem "neutralino-release\*.exe")

# 4. Create clean zip file
Remove-Item "overtone-win-x64-*.zip" -Force -ErrorAction SilentlyContinue
$zipName = "overtone-win-x64-v$version.zip"
Compress-Archive -Path "neutralino-release\*" -DestinationPath $zipName -Force
Write-Host "Created release package: $zipName" -ForegroundColor Green

# 5. Compile Inno Setup Windows installer if available
$isccCandidates = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "C:\Program Files (x86)\Inno Setup 6\ISCC.exe", "C:\Program Files\Inno Setup 6\ISCC.exe", "ISCC.exe")
$isccPath = $isccCandidates | Where-Object { (Get-Command $_ -ErrorAction SilentlyContinue) -or (Test-Path $_) } | Select-Object -First 1
if ($isccPath) {
    Write-Host "Compiling Inno Setup Windows installer..." -ForegroundColor Cyan
    & $isccPath "/DAppVersion=$version" installer.iss
    if ($LASTEXITCODE -eq 0 -and (Test-Path "Overtone-Setup-$version.exe")) {
        Invoke-Sign (Get-ChildItem "Overtone-Setup-$version.exe")
        Write-Host "Installer generated: Overtone-Setup-$version.exe" -ForegroundColor Green
    } else {
        if ($env:CI) { throw "Inno Setup failed" }
        Write-Warning "Inno Setup failed (ISCC at '$isccPath'); installer skipped."
    }
} else {
    if ($env:CI) { throw "Inno Setup not found" }
    Write-Warning "Inno Setup not found; installer skipped."
}
