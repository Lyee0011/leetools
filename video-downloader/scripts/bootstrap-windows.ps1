[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$Bin = Join-Path $Root 'bin'
$ManifestPath = Join-Path $Root 'dependencies.windows.json'

function Assert-InProject([string]$Candidate) {
    $full = [IO.Path]::GetFullPath($Candidate)
    $prefix = $Root.TrimEnd('\') + '\'
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escaped the project root: $full"
    }
    $cursor = $full
    while ($cursor.Length -ge $Root.Length) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse points are not allowed in runtime paths: $cursor" }
        }
        if ($cursor -eq $Root) { break }
        $cursor = Split-Path -Parent $cursor
    }
    return $full
}

function Remove-ProjectItem([string]$Candidate, [switch]$Recurse) {
    $full = Assert-InProject $Candidate
    if (Test-Path -LiteralPath $full) {
        Remove-Item -LiteralPath $full -Force -Recurse:$Recurse
    }
}

function Test-Tool([string]$File, [string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    try {
        & $File @Arguments *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Test-FileSha256([string]$File, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
    if ($Sha256 -notmatch '^[0-9a-fA-F]{64}$') { return $false }
    try {
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash
        return $actual.Equals($Sha256, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

function Download-VerifiedFile([string]$Destination, [object[]]$Urls, [string]$Sha256) {
    $Destination = Assert-InProject $Destination
    $part = Assert-InProject ($Destination + '.part')
    $lastError = $null
    foreach ($url in $Urls) {
        try {
            Remove-ProjectItem $part
            Write-Host "  Download: $url"
            # Use literal .NET file IO: Windows PowerShell's -OutFile rejects some bracketed paths.
            $request = [Net.HttpWebRequest]::Create([string]$url)
            $request.Timeout = 180000
            $request.ReadWriteTimeout = 180000
            if ($script:DownloadProxy) { $request.Proxy = New-Object Net.WebProxy($script:DownloadProxy) }
            $response = $null; $output = $null; $inputStream = $null
            try {
                $response = $request.GetResponse()
                $inputStream = $response.GetResponseStream()
                $output = [IO.File]::Open($part, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                $inputStream.CopyTo($output)
            } finally {
                if ($output) { $output.Dispose() }
                if ($inputStream) { $inputStream.Dispose() }
                if ($response) { $response.Dispose() }
            }
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $part).Hash.ToLowerInvariant()
            if ($actual -ne $Sha256.ToLowerInvariant()) {
                throw "SHA-256 mismatch (actual: $actual)"
            }
            Move-Item -LiteralPath $part -Destination $Destination -Force
            return
        } catch {
            $lastError = $_
            Write-Warning "Download source failed: $url ($($_.Exception.Message); line $($_.InvocationInfo.ScriptLineNumber))"
        }
    }
    Remove-ProjectItem $part
    throw "All download sources failed: $($lastError.Exception.Message)"
}

if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {
    throw 'Only 64-bit Windows 10/11 is currently supported.'
}
if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw 'dependencies.windows.json is missing.'
}

$deps = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$null = Assert-InProject $Bin
New-Item -ItemType Directory -Force -Path $Bin | Out-Null
$script:DownloadProxy = @($env:HTTPS_PROXY, $env:HTTP_PROXY) | Where-Object { $_ -match '^https?://' } | Select-Object -First 1
if (-not $script:DownloadProxy) {
    foreach ($proxyPort in @(7897, 7890, 10809)) {
        $client = New-Object Net.Sockets.TcpClient
        try { if ($client.ConnectAsync('127.0.0.1', $proxyPort).Wait(200) -and $client.Connected) { $script:DownloadProxy = "http://127.0.0.1:$proxyPort"; break } } catch {} finally { $client.Dispose() }
    }
}
$installLock = $null
$lockPath = Assert-InProject (Join-Path $Bin '.bootstrap.lock')
for ($attempt = 0; $attempt -lt 120 -and -not $installLock; $attempt++) {
    try { $installLock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { Start-Sleep -Milliseconds 500 }
}
if (-not $installLock) { throw 'Another runtime setup is still running. Wait for it to finish and retry.' }
try {

$node = Assert-InProject (Join-Path $Bin 'node.exe')
if ($Force -or -not (Test-FileSha256 $node $deps.node.executableSha256)) {
    Write-Host '[1/4] Preparing Node.js...'
    $archive = Join-Path $Bin $deps.node.archive
    $stage = Join-Path $Bin ('.node-stage-' + [guid]::NewGuid().ToString('N'))
    Download-VerifiedFile $archive $deps.node.urls $deps.node.sha256
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    # Only node.exe is needed; avoid unpacking npm and its long nested paths.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $source = Join-Path $stage 'node.exe'
    try {
        $entry = $zip.GetEntry("node-$($deps.node.version)-win-x64/node.exe")
        if (-not $entry) { throw 'Unexpected Node.js archive layout.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $source, $false)
    } finally { $zip.Dispose() }
    if (-not (Test-FileSha256 $source $deps.node.executableSha256)) { throw 'Node.js executable SHA-256 mismatch.' }
    Move-Item -LiteralPath $source -Destination $node -Force
    Remove-ProjectItem $stage -Recurse
    Remove-ProjectItem $archive
}

$ffmpeg = Assert-InProject (Join-Path $Bin 'ffmpeg.exe')
if ($Force -or -not (Test-FileSha256 $ffmpeg $deps.ffmpeg.sha256)) {
    Write-Host '[2/4] Preparing FFmpeg...'
    Download-VerifiedFile $ffmpeg $deps.ffmpeg.urls $deps.ffmpeg.sha256
}

$ytdlp = Assert-InProject (Join-Path $Bin 'yt-dlp.exe')
if ($Force -or -not (Test-FileSha256 $ytdlp $deps.ytDlp.sha256)) {
    Write-Host '[3/4] Preparing yt-dlp...'
    Download-VerifiedFile $ytdlp $deps.ytDlp.urls $deps.ytDlp.sha256
}

$focusSource = Join-Path $Root 'focus-explorer.cs'
$focusExe = Join-Path $Bin 'focus-explorer-v2.exe'
if (($Force -or -not (Test-Path -LiteralPath $focusExe)) -and (Test-Path -LiteralPath $focusSource)) {
    Write-Host '[4/4] Building the Explorer focus helper...'
    $newFocus = Join-Path $Bin 'focus-explorer-v2.new.exe'
    try {
        Remove-ProjectItem $newFocus
        # CodeDOM takes a literal output path; Add-Type treats brackets as wildcards.
        $compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
        try {
            $parameters = New-Object System.CodeDom.Compiler.CompilerParameters
            $parameters.GenerateExecutable = $true
            $parameters.OutputAssembly = $newFocus
            $parameters.ReferencedAssemblies.AddRange([string[]]@('System.dll', 'System.Core.dll', 'Microsoft.CSharp.dll'))
            $compiled = $compiler.CompileAssemblyFromSource($parameters, [string[]]@([IO.File]::ReadAllText($focusSource)))
            if ($compiled.Errors.HasErrors) { throw ($compiled.Errors | Out-String) }
        } finally { $compiler.Dispose() }
        Move-Item -LiteralPath $newFocus -Destination $focusExe -Force
    } catch {
        Remove-ProjectItem $newFocus
        Write-Warning "Folders can still open, but the focus helper could not be built: $($_.Exception.Message)"
    }
}

if (-not (Test-FileSha256 $node $deps.node.executableSha256)) { throw 'Node.js integrity check failed.' }
if (-not (Test-FileSha256 $ffmpeg $deps.ffmpeg.sha256)) { throw 'FFmpeg integrity check failed.' }
if (-not (Test-FileSha256 $ytdlp $deps.ytDlp.sha256)) { throw 'yt-dlp integrity check failed.' }
if (-not (Test-Tool $node @('--version'))) { throw 'Node.js is not ready.' }
if (-not (Test-Tool $ffmpeg @('-version'))) { throw 'FFmpeg is not ready.' }
if (-not (Test-Tool $ytdlp @('--version'))) { throw 'yt-dlp is not ready.' }

Write-Host 'Runtime is ready.' -ForegroundColor Green
} finally {
    $installLock.Dispose()
    if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-ProjectItem $stage -Recurse }
}
