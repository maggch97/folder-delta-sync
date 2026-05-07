$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

Push-Location (Join-Path $root "web")
npm ci
npm run build
Pop-Location

New-Item -ItemType Directory -Force -Path (Join-Path $root "dist") | Out-Null
go build -ldflags "-s -w" -o (Join-Path $root "dist\folder-delta-sync.exe") ./cmd/folder-delta-sync

Write-Host "built dist\folder-delta-sync.exe"

