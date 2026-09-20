[CmdletBinding()]
param([switch]$Json, [switch]$NoStart)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$SystemPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$savedModules = $env:PSModulePath
$env:PSModulePath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\Modules;$env:ProgramFiles\WindowsPowerShell\Modules"
$savedNoOpen = $env:NO_OPEN
$savedPort = $env:PORT
$setupProcess = $null
$setupStep = 'runtime'
$Log = Join-Path $Root 'bin\setup-last.log'

function Write-Result($Result) {
    if ($Json) { $Result | ConvertTo-Json -Compress }
    elseif ($Result.ok) { Write-Host "Video Downloader is ready. $($Result.url)" -ForegroundColor Green }
    else { Write-Host "Setup failed: $($Result.error)" -ForegroundColor Red; Write-Host "Log: $Log" }
}

try {
    # The bootstrap validates every bundled executable before a version probe or other execution.
    if (-not $Json) { Write-Host 'Preparing and checking local runtime components...' }
    $ErrorActionPreference = 'Continue'
    $bootstrapOutput = & $SystemPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'bootstrap-windows.ps1') 2>&1 | ForEach-Object {
        if (-not $Json) { Write-Host $_ }
        $_
    }
    $bootstrapExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if (Test-Path -LiteralPath (Split-Path $Log -Parent)) { $bootstrapOutput | Out-String | Set-Content -LiteralPath $Log -Encoding UTF8 }
    if ($bootstrapExit -ne 0) { throw "Runtime setup failed. See $Log" }
    $Node = Join-Path $Root 'bin\node.exe'
    $ServerFile = Join-Path $Root 'server.js'
    $setupStep = 'source'
    Push-Location -LiteralPath $Root
    try {
        $identityText = & $Node -e "const a=require('./server');console.log(JSON.stringify({build:a.BUILD_ID,instance:a.INSTANCE_ID}))"
        if ($LASTEXITCODE -ne 0) { throw 'Source validation failed.' }
        $identity = $identityText | ConvertFrom-Json
    } finally { Pop-Location }
    if ($NoStart) { Write-Result @{ ok = $true; started = $false; build = $identity.build; instance = $identity.instance; root = $Root; log = $Log }; return }
    $ready = $null
    function Find-ReadyService {
        foreach ($port in 3210..3219) {
            try {
                $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/config" -TimeoutSec 1
                if ($response.app -eq 'shinewood-video-downloader' -and $response.build -eq $identity.build -and $response.instance -eq $identity.instance -and $response.ytdlp -and $response.ffmpeg -and $response.jsRuntime) { $script:ReadyPid = $response.pid; return "http://localhost:$port/" }
            } catch {}
        }
        return $null
    }
    $ready = Find-ReadyService
    if (-not $ready) {
        $setupStep = 'start'
        $env:NO_OPEN = '1'; $env:PORT = ''
        # ShellExecute detaches the service from the calling Agent's output pipes.
        # ProcessStartInfo also treats bracketed working directories literally.
        $startInfo = New-Object Diagnostics.ProcessStartInfo
        $startInfo.FileName = $Node
        $startInfo.Arguments = '"' + $ServerFile + '"'
        $startInfo.WorkingDirectory = $Root
        $startInfo.UseShellExecute = $true
        $startInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $setupProcess = [Diagnostics.Process]::Start($startInfo)
        for ($attempt = 0; $attempt -lt 15 -and -not $ready; $attempt++) {
            Start-Sleep -Milliseconds 300
            $ready = Find-ReadyService
            if ((-not $setupProcess -or $setupProcess.HasExited) -and -not $ready) { throw 'Local service exited before becoming ready. Run bin\node.exe server.js from this directory to inspect the startup error.' }
        }
    }
    if (-not $ready) { throw 'No ready local service was found on ports 3210-3219.' }
    if (-not $Json) { Start-Process $ready }
    Write-Result @{ ok = $true; started = $true; url = $ready; pid = $script:ReadyPid; build = $identity.build; instance = $identity.instance; root = $Root; log = $Log }
} catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message; step = $setupStep; line = $_.InvocationInfo.ScriptLineNumber; root = $Root; log = $Log }
    exit 1
} finally {
    $env:PSModulePath = $savedModules
    $env:NO_OPEN = $savedNoOpen
    $env:PORT = $savedPort
}
