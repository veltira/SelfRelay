# SelfRelay Desktop status

## Milestone

D0 — Windows foundation.

Base `main`: `bc47bc9a36994c07d37ed6e15633112dbed3e251`

Branch: `desktop/d0-windows-foundation`

Final SHA: use the current PR head. A Git commit cannot embed its own final SHA without changing that SHA; the handoff and PR head are the authoritative immutable value.

## What works in D0

- Tauri 2 + React/Vite Desktop application structure.
- Product UI using the SelfRelay brand asset and locally bundled IBM Plex Sans.
- Per-user local SQLite schema v1 with migration tracking, settings, tracking rules and active-context journal foundation.
- Tauri single-instance guard to avoid concurrent SelfRelay observer instances.
- Native Windows observer built around `SetWinEventHook` plus startup/resume `EnumWindows` reconciliation.
- Dedicated WinEvent message-loop thread; callback only enqueues compact events and lifecycle work runs on a separate engine thread.
- Ephemeral HWND registry with PID/executable/title/visibility/adapter/context metadata.
- VS Code, Word, Excel and generic adapters.
- Stable VS Code workspace identity across active-file title changes.
- Conservative top-level classification with Chrome, Edge and SelfRelay exclusions.
- Resident system tray with open, disabled D0 checkpoint action, pause, resume and exit.
- Closing the main window hides it rather than terminating the resident process.
- NSIS per-user packaging configuration with embedded WebView2 bootstrapper.

## Automated coverage

Rust unit tests cover adapter parsing, normalization, VS Code identity stability, classification/exclusion, schema migration idempotence, journal persistence and observer command-channel behavior. Frontend tests cover normalized context presentation. Windows CI performs frontend typecheck/tests, `cargo check`, `cargo test` and a no-bundle Tauri integration build. A separate Windows packaging workflow builds and asserts the NSIS installer before artifact upload.

Automated build/tests validate code paths and compilation but do not constitute physical proof of native WinEvent delivery or tray behavior. Those are explicitly covered by `DESKTOP_MANUAL_VALIDATION.md`.

## Not implemented in D0

- checkpoint capture;
- recovery prompt/automatic recovery;
- audio or Whisper transcription;
- multi-application work contexts;
- Extension↔Desktop integration;
- Figma-specific adapter;
- stable document identity beyond the title-derived Word/Excel heuristic;
- code signing or automated stable release publication.

## Real risks / limitations

Win32 exposes heterogeneous top-level surfaces, so some vendor-specific splash/tool windows can pass generic classification if they are visible and expose a useful executable/title. Generic identity is intentionally marked lower-stability. Word/Excel identity is title-derived and can change if the document is renamed. VS Code parsing assumes the standard title convention and falls back to the remaining title segment for atypical windows. Hook callbacks are bounded and deliberately non-blocking, so under extreme event pressure an event can be dropped; explicit reconciliation on resume and startup provides a recovery mechanism without aggressive polling.

The D0 installer is unsigned. No claim is made that it avoids SmartScreen warnings.

## Next phase after review

After D0 is accepted, D1/D2 can connect native context disappearance/reappearance to the first real loop: close VS Code → ask `¿Dónde quedaste?` → save text against stable workspace identity → detect workspace return → show recovery → `Ya lo retomé`.
