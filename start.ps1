$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$bundledPython = 'C:\Users\86150\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$pythonExe = if (Test-Path -LiteralPath $bundledPython) { $bundledPython } else { (Get-Command python -ErrorAction Stop).Source }
$nodeExe = (Get-Command node -ErrorAction Stop).Source
& $nodeExe (Join-Path $projectRoot 'build.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
$ready = $false
try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:4188/api/config' -TimeoutSec 2; $ready = $response.mode -eq 'local' } catch {}
if (-not $ready) {
    $logDirectory = Join-Path $projectRoot 'private\logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Start-Process -FilePath $pythonExe -ArgumentList @('-X','utf8',('"' + (Join-Path $projectRoot 'scripts\server.py') + '"')) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory "server-$stamp.log") -RedirectStandardError (Join-Path $logDirectory "server-$stamp.err.log")
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        try { $response = Invoke-RestMethod -Uri 'http://127.0.0.1:4188/api/config' -TimeoutSec 1; if ($response.mode -eq 'local') { $ready=$true; break } } catch {}
    }
}
if (-not $ready) { throw 'Job Dating did not start. See private\logs.' }
Start-Process 'http://127.0.0.1:4188'
