# Runs stream-test sessions strictly one after another (never two harness processes at once).
# Usage: .\tools\stream-test\run.ps1 -Runs '[{"name":"t6a","seconds":60,"settings":{...},"actions":[...]}]'
# Progress: %APPDATA%\xenith\logs\stream-test-status.txt
param([string]$Runs = '[]', [string]$RunsFile = '')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if ($RunsFile) { $Runs = Get-Content $RunsFile -Raw }
$list = $Runs | ConvertFrom-Json
$status = "$env:APPDATA\xenith\logs\stream-test-status.txt"
New-Item -ItemType Directory -Force (Split-Path $status) | Out-Null
"started $(Get-Date -Format s)" | Set-Content $status
foreach ($r in $list) {
  if (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$root*" }) { "  another harness electron is running, abort" | Add-Content $status; break }
  $env:XENITH_TEST_NAME = $r.name
  $env:XENITH_TEST_SECONDS = "$($r.seconds)"
  $env:XENITH_TEST_SETTINGS = ($r.settings | ConvertTo-Json -Depth 8 -Compress)
  $env:XENITH_TEST_ACTIONS = if ($r.actions) { ConvertTo-Json @($r.actions) -Depth 8 -Compress } else { '[]' }
  $env:XENITH_TEST_OSNAME = if ($r.os) { $r.os } else { 'windows' }
  $env:XENITH_TEST_DIMS = if ($r.dims) { $r.dims } else { '2560x1440' }
  "run $($r.name) $(Get-Date -Format s)" | Add-Content $status
  $p = Start-Process -FilePath "$root\node_modules\electron\dist\electron.exe" -ArgumentList "`"$root\tools\stream-test\dist`"" -WorkingDirectory $root -PassThru
  if (-not $p.WaitForExit(([int]$r.seconds + 200) * 1000)) { $p.Kill(); "  killed (timeout)" | Add-Content $status }
  "  exit $($p.ExitCode) $(Get-Date -Format s)" | Add-Content $status
  Start-Sleep 12
}
"done $(Get-Date -Format s)" | Add-Content $status
