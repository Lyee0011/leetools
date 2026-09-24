# macOS preview operating contract

Read README.md and INSTALL.md first. This is an independent macOS preview, copied from the Windows tool at commit bac9ed1. Do not edit ../video-downloader or replace its release assets to work on this version.

- Target macOS 13+, native Apple Silicon arm64 first; Intel x64 is also prepared. Apple Silicon macOS 26.2 automated acceptance is recorded in tests/VALIDATION.md; native UI and real-platform downloads still need manual acceptance. Never describe host-only tests as Mac validation.
- Keep source, rules, license, tests and launchers inside this directory. No root .github or root documentation.
- No npm dependencies, sudo, global install, security disabling, or blanket quarantine removal.
- Download only immutable dependencies from dependencies.macos.json. Pin SHA-256 in the repository; verify existing files before execution, even a version probe. Do not discover arbitrary PATH versions.
- bin/, config.json, media, browser profiles, cookies, logs and dist/ must stay out of Git and public packages. Release source and launchers only; third-party binary redistribution has separate license/source obligations.
- Never export or read personal browser cookies in this preview. Anonymous browser fallback uses a disposable profile. No account access, DRM/paid/private-content bypass.
- Preserve loopback binding, Host allowlist, per-process mutation token, same-origin checks, request-size bound, safe argument arrays, bounded jobs, job-ID file reveal and audio+video completion checks.
- Default download directory is ~/Downloads/视频素材. Stop only the identified service from this install; refuse while downloading. Never kill all Node/browser processes.
- Run node tests/source-smoke.js, node tests/runtime.js, node tests/macos-platform.js, node tests/service-macos.js, node tests/yangshipin.js, node tests/browser-resolver.js, node tests/http-security.js on the development host. Use /bin/bash tests/smoke-macos.sh on a real Mac, with --browser for the optional local browser test.
- Update README, INSTALL, dependency notices and validation record together. Preserve the maintainer's MIT copyright and GitHub noreply commit identity.
