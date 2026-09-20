# Security policy

## Supported source

Security fixes target the latest commit on the `main` branch. The Windows launcher and bootstrap are the supported distribution path.

## Reporting a vulnerability

Use [private vulnerability reporting](https://github.com/Lyee0011/leetools/security/advisories/new). For ordinary usage problems, open an [Issue](https://github.com/Lyee0011/leetools/issues).

Do not publish working exploits that expose browser cookies, local paths, or executable-download weaknesses before a fix is available. Open a private GitHub security advisory for the repository owner and include:

- affected commit and Windows version;
- exact request, URL, file, or dependency involved;
- the security boundary that was crossed;
- the smallest safe reproduction and expected result.

Do not include real cookies, account tokens, private video links, or personal filesystem paths.

## Security invariants

- The service binds only to `127.0.0.1`, accepts only loopback Host values, and requires a random per-process token for every POST.
- HTTP JSON bodies are limited to 64 KiB. Browser cross-site requests and unexpected content types are rejected before parsing.
- Explorer actions resolve either the configured download directory or a completed server-side job ID; clients cannot submit arbitrary local paths.
- Xiaohongshu is the only path permitted to use `--cookies-from-browser`, after its public path fails. Cookie files must never be exported or committed.
- Generic browser discovery uses only a new temporary Chrome/Edge profile and public HTTP(S) destinations. It does not attach to personal browser sessions, import accounts, bypass challenges, or decrypt protected media. The loopback test origin is an internal test injection, never an HTTP/CLI option.
- Discovery is serialized and bounded, and closes its own temporary browser after success or failure. Existing personal browser processes must not be closed by this feature.
- URLs are passed as child-process arguments after `--`; they are never interpolated into a shell command.
- Runtime versions and SHA-256 digests are immutable repository data. Mirrors are transport fallbacks only.
- `bin/`, `config.json`, downloaded media, browser profiles, cookies, and temporary files must remain outside Git.

## Validation

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows.ps1
```

Network-dependent changes additionally require an authorized public test URL for each affected platform and verification that the result has both video and audio streams.
