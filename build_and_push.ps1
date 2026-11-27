# Build everything, then commit / tag / push
& "$PSScriptRoot\build.ps1"
$version = (Get-Content "neutralino-app\package.json" -Raw | ConvertFrom-Json).version

# 6. Git actions
git add .
$msg = Read-Host "Enter commit message"
if (-not $msg) {
    $msg = "release: v$version"
}
git commit -m $msg

$pushChoice = Read-Host "Press y to push"
if ($pushChoice -eq "y") {
    git push origin main
    git tag -d "v$version" 2>$null
    git push origin --delete "v$version" 2>$null
    git tag "v$version"
    git push origin "v$version"
}
