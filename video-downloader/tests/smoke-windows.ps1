[CmdletBinding()]
param([switch]$Bootstrap, [switch]$BrowserIntegration)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$Node = Join-Path $Root 'bin\node.exe'
$started = $null

if ($Bootstrap) {
    & (Join-Path $Root 'scripts\bootstrap-windows.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Runtime bootstrap failed.' }
}
if (-not (Test-Path -LiteralPath $Node)) { throw 'bin\node.exe is missing. Run the launcher first.' }
$deps = Get-Content -LiteralPath (Join-Path $Root 'dependencies.windows.json') -Raw | ConvertFrom-Json
foreach ($entry in @(@('node.exe', $deps.node.executableSha256), @('ffmpeg.exe', $deps.ffmpeg.sha256), @('yt-dlp.exe', $deps.ytDlp.sha256))) {
    $runtimeFile = Join-Path $Root ('bin\' + $entry[0])
    if ((Get-FileHash -LiteralPath $runtimeFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry[1]) { throw ('Runtime integrity check failed: ' + $entry[0]) }
}

& $Node --check (Join-Path $Root 'server.js')
if ($LASTEXITCODE -ne 0) { throw 'server.js syntax check failed.' }
& $Node --check (Join-Path $Root 'scripts\douyin-anonymous-resolver.js')
if ($LASTEXITCODE -ne 0) { throw 'Douyin anonymous resolver syntax check failed.' }
& $Node (Join-Path $Root 'tests\source-smoke.js')
if ($LASTEXITCODE -ne 0) { throw 'Link parser smoke test failed.' }
& $Node (Join-Path $Root 'tests\runtime.js')
if ($LASTEXITCODE -ne 0) { throw 'Runtime integrity tests failed.' }
& $Node (Join-Path $Root 'tests\bilibili-download.js')
if ($LASTEXITCODE -ne 0) { throw 'Bilibili fallback tests failed.' }
& $Node (Join-Path $Root 'tests\yangshipin.js')
if ($LASTEXITCODE -ne 0) { throw 'Yangshipin adapter tests failed.' }
& $Node (Join-Path $Root 'tests\browser-resolver.js')
if ($LASTEXITCODE -ne 0) { throw 'Browser discovery tests failed.' }
if ($BrowserIntegration) {
    & $Node (Join-Path $Root 'tests\browser-integration.js')
    if ($LASTEXITCODE -ne 0) { throw 'Browser integration tests failed.' }
}
& $Node (Join-Path $Root 'tests\download-integrity.js')
if ($LASTEXITCODE -ne 0) { throw 'Download integrity tests failed.' }
& $Node (Join-Path $Root 'tests\http-security.js')
if ($LASTEXITCODE -ne 0) { throw 'HTTP security test failed.' }

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$oldNoOpen = $env:NO_OPEN
$oldPort = $env:PORT
$env:NO_OPEN = '1'
$env:PORT = [string]$port
try {
    $started = Start-Process -FilePath $Node -ArgumentList 'server.js' -WorkingDirectory ([Management.Automation.WildcardPattern]::Escape($Root)) -WindowStyle Hidden -PassThru
} finally {
    $env:NO_OPEN = $oldNoOpen
    $env:PORT = $oldPort
}

$ready = $false
for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
    try {
        $probe = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/config" -TimeoutSec 1
        $ready = $probe.app -eq 'shinewood-video-downloader'
    } catch {
        Start-Sleep -Milliseconds 250
    }
}

try {
    if (-not $ready) { throw "The isolated local service did not start on port $port." }
    $page = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/" -TimeoutSec 5
    $config = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/config" -TimeoutSec 5
    $expectedBuild = (& $Node -e "console.log(require(process.argv[1]).BUILD_ID)" (Join-Path $Root 'server.js')).Trim()
    if ($page.StatusCode -ne 200 -or $page.Content.Length -lt 1000) { throw 'Web page check failed.' }
    if ($config.build -ne $expectedBuild) { throw 'The running service does not match this source tree. Restart it and retry.' }
    if (-not $config.ytdlp -or -not $config.ffmpeg -or -not $config.jsRuntime) { throw 'Runtime component check failed.' }
    if (-not $config.xiaohongshu) { throw 'Xiaohongshu capability is disabled.' }
    if (-not $config.yangshipin) { throw 'Yangshipin capability is disabled.' }
    Write-Host "All smoke tests passed: http://localhost:$port" -ForegroundColor Green
} finally {
    if ($started -and -not $started.HasExited) { Stop-Process -Id $started.Id }
}
