[CmdletBinding()]
param([switch]$Json)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$Node = Join-Path $Root 'bin\node.exe'
$ServerFile = Join-Path $Root 'server.js'
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant())))).Replace('-', '').ToLowerInvariant().Substring(0, 12)
} finally { $sha.Dispose() }

function Write-Result($Result) {
    if ($Json) { $Result | ConvertTo-Json -Compress }
    elseif ($Result.ok) { Write-Host $Result.message -ForegroundColor Green }
    else { Write-Host $Result.error -ForegroundColor Red }
}

try {
    foreach ($port in 3210..3219) {
        try { $config = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/config" -TimeoutSec 1 } catch { continue }
        if ($config.app -ne 'shinewood-video-downloader' -or $config.instance -ne $identity) { continue }
        $jobs = @(Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/jobs" -TimeoutSec 3)
        if (@($jobs | Where-Object { $_.status -eq 'running' }).Count) {
            throw '仍有下载任务正在运行，请等待完成后再停止。'
        }
        $ownProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$config.pid)
        if (-not $ownProcess -or $ownProcess.ExecutablePath -ne $Node -or -not $ownProcess.CommandLine.Contains('"' + $ServerFile + '"')) {
            throw '进程与本目录不匹配，已拒绝停止。'
        }
        Stop-Process -Id $ownProcess.ProcessId -ErrorAction Stop
        Write-Result @{ ok = $true; stopped = $true; message = '本目录的视频下载器已停止，可以关闭浏览器页面。' }
        return
    }
    Write-Result @{ ok = $true; stopped = $false; message = '本目录的视频下载器当前没有运行。' }
} catch {
    Write-Result @{ ok = $false; error = $_.Exception.Message }
    exit 1
}
