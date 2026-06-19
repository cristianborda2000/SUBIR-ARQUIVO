$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dist = Join-Path $root "dist"
$payload = Join-Path $root "installer\payload"

if (Test-Path $payload) {
  Remove-Item -Recurse -Force $payload
}

New-Item -ItemType Directory -Force -Path $payload | Out-Null

Copy-Item (Join-Path $dist "MediaDrop-Downloader.exe") (Join-Path $payload "MediaDrop-Downloader.exe") -Force
Copy-Item (Join-Path $dist "config.example.json") (Join-Path $payload "config.example.json") -Force
Copy-Item (Join-Path $root "README.md") (Join-Path $payload "README.txt") -Force
Copy-Item (Join-Path $dist "tools\yt-dlp.exe") (Join-Path $payload "yt-dlp.exe") -Force
Copy-Item (Join-Path $dist "tools\ffmpeg.exe") (Join-Path $payload "ffmpeg.exe") -Force

& (Join-Path $root "node_modules\.bin\pkg.cmd") (Join-Path $root "installer\setup.js") `
  --targets node18-win-x64 `
  --output (Join-Path $dist "MediaDrop-Downloader-Setup.exe") `
  --config (Join-Path $root "installer\setup-pkg.json")

Get-Item (Join-Path $dist "MediaDrop-Downloader-Setup.exe")
