# Runs Xenith smoke sessions sequentially.
# Usage: .\tools\smoke-matrix.ps1 -Seconds 45 -Runs '[{"os":"windows","dims":"2560x1440","codec":"4d","caps":"1","alias":"1440"}]'
param([int]$Seconds = 45, [string]$Runs = '[]')
$root = Split-Path $PSScriptRoot -Parent
$list = $Runs | ConvertFrom-Json
$out = "$env:APPDATA\xenith\logs\matrix-status.txt"
"started $(Get-Date -Format s)" | Set-Content $out
foreach ($r in $list) {
  $env:XENITH_SMOKE_SECONDS = "$Seconds"; $env:XENITH_OSNAME = $r.os; $env:XENITH_DIMS = $r.dims; $env:XENITH_CODEC = $r.codec
  $env:XENITH_CAPS = "$($r.caps)"; $env:XENITH_MAXKBPS = "$($r.maxkbps)"; $env:XENITH_RES_ALIAS = "$($r.alias)"
  "run $($r | ConvertTo-Json -Compress) $(Get-Date -Format s)" | Add-Content $out
  $p = Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList '.' -WorkingDirectory $root -PassThru
  if (-not $p.WaitForExit(($Seconds + 150) * 1000)) { $p.Kill(); "  killed (timeout)" | Add-Content $out }
  Start-Sleep 15
}
"done $(Get-Date -Format s)" | Add-Content $out
