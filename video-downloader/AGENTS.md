# Agent operating contract

This directory is the source of truth for a local Windows video downloader. Read this directory's `README.md` before making changes.

## Collection layout

- The `leetools` repository root contains only tool directories. Keep this tool in `video-downloader/`; future tools get their own sibling directories.
- Keep each tool's README, license, rules, ignore patterns, tests, and configuration inside its own directory. Do not recreate root README, LICENSE, AGENTS.md, or `.github` just to enable repository-wide features.
- The nested `.github/` preserves the first release's configuration as a reference. GitHub does not activate workflows or issue templates from this nested location; local tests remain available.
- Releases contain reviewed source and launchers. Third-party binaries may only be redistributed after completing their own licensing and corresponding-source requirements.
- Never commit `.env` files, credentials, personal configuration, browser profiles, cookies, runtime binaries or generated media. Maintain the tool-local `.gitignore`.
- Use the maintainer's GitHub noreply address for commits, not a personal email address.

## Supported target

- Primary target: Windows 10/11, 64-bit.
- The app is local-only and must listen on `127.0.0.1`, never `0.0.0.0`.
- There are no npm dependencies. Runtime tools are reconstructed by `scripts/bootstrap-windows.ps1`.

## Required invariants

1. Never commit `bin/`, `config.json`, browser profiles, cookies, downloaded media, or temporary files.
2. Never export browser cookies to disk or upload them. Xiaohongshu may use yt-dlp's in-memory `--cookies-from-browser` fallback only after a public request fails.
3. Do not add browser cookies to YouTube, Bilibili, or Douyin paths unless the user explicitly requests a reviewed change.
4. Douyin remains on the isolated guest path. Bilibili and YouTube remain on the general yt-dlp path.
5. A completed download must contain both a video stream and an audio stream. Keep the FFmpeg validation.
6. Preserve safe URL argument separation (`--`, then URL), filename limits, loopback binding, bounded job history, and asynchronous folder selection.
7. User-specific state belongs in ignored `config.json`. The source default is `%USERPROFILE%\Downloads\视频素材`.
8. Loopback is not authentication. Preserve the loopback Host allowlist, per-process POST token, same-origin checks, 64 KiB JSON limit, security headers, and server-side job-ID lookup for Explorer actions.
9. Every downloaded executable must have an immutable version and repository-pinned SHA-256. A mirror may transport bytes but must never provide the trusted checksum at runtime.

## Windows setup

For installation, follow `INSTALL.md` and use `scripts/install-windows.ps1 -Json`. Honor the receiving user's install-location preferences and choose a writable directory. Do not run `npm install`, change global execution policy, or copy another person's configuration.

Installation is complete only after the returned `ok`, `started`, build, instance, and component readiness match the actual local service. Never assume port 3210 or reuse a different installation directory. Use `-NoStart` only when startup is not requested.

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
```

Then start with `视频下载器-Windows.bat`.

## Validation

Before handing off a change, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\smoke-windows.ps1
```

For network-dependent download changes, additionally test one current, public, authorized video URL for each affected site. Confirm the final file has both video and audio. Do not commit test URLs that contain personal tokens.

## Distribution

- Source repositories exclude runtimes via `.gitignore`.
- Portable binaries belong in a GitHub Release ZIP, not Git history.
- Update `dependencies.windows.json`, its SHA-256 values, README, tests, and `THIRD_PARTY_NOTICES.md` when changing dependencies.
- Never use mutable dependency URLs such as `releases/latest`, and verify an existing `bin` executable before running even a version probe.
