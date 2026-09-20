[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$Node = Join-Path $Root 'bin\node.exe'
$ServerFile = Join-Path $Root 'server.js'
$SystemPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$existingPids = @(Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.ExecutablePath -eq $Node } | Select-Object -ExpandProperty ProcessId)
$first = $null
try {
    $firstText = & $SystemPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\install-windows.ps1') -Json
    if ($LASTEXITCODE -ne 0) { throw ($firstText | Out-String) }
    $first = $firstText | ConvertFrom-Json
    if (-not $first.ok -or -not $first.started -or $first.root -ne $Root) { throw 'First installation result is invalid.' }
    $actual = Invoke-RestMethod -Uri ($first.url + 'api/config') -TimeoutSec 5
    if ($actual.app -ne 'shinewood-video-downloader' -or $actual.build -ne $first.build -or $actual.instance -ne $first.instance -or $actual.pid -ne $first.pid) { throw 'Reported service identity does not match the actual service.' }
    if (-not $actual.ytdlp -or -not $actual.ffmpeg -or -not $actual.jsRuntime) { throw 'The service is missing verified runtime components.' }
    $secondText = & $SystemPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\install-windows.ps1') -Json
    if ($LASTEXITCODE -ne 0) { throw ($secondText | Out-String) }
    $second = $secondText | ConvertFrom-Json
    if (-not $second.ok -or -not $second.started -or $second.pid -ne $first.pid -or $second.url -ne $first.url -or $second.instance -ne $first.instance) { throw 'Repeated installation did not reuse the same service.' }
    if ($first.pid -notin $existingPids) {
        $stopText = & $SystemPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\stop-windows.ps1') -Json
        if ($LASTEXITCODE -ne 0) { throw ($stopText | Out-String) }
        $stopped = $stopText | ConvertFrom-Json
        if (-not $stopped.ok -or -not $stopped.stopped) { throw 'The stop launcher did not stop its own service.' }
        Start-Sleep -Milliseconds 300
        if (Get-Process -Id $first.pid -ErrorAction SilentlyContinue) { throw 'Service still exists after stopping.' }
        $stopAgain = (& $SystemPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\stop-windows.ps1') -Json) | ConvertFrom-Json
        if (-not $stopAgain.ok -or $stopAgain.stopped) { throw 'Repeated stop was not idempotent.' }
    }
    Write-Host 'Installation entrypoint passed: readiness, launch reuse and own-service stop.' -ForegroundColor Green
} finally {
    # Preserve any service that already existed when this test began.
    if ($first -and $first.pid -and $first.pid -notin $existingPids) {
        $ownProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$first.pid)
        if ($ownProcess -and $ownProcess.ExecutablePath -eq $Node -and $ownProcess.CommandLine.Contains($ServerFile)) { Stop-Process -Id $ownProcess.ProcessId }
    }
}
