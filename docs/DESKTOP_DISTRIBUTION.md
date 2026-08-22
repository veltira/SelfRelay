# SelfRelay Desktop distribution

## D0 output

The supported D0 distribution target is a Windows 10/11 NSIS installer named exactly:

`SelfRelay-Setup.exe`

Tauri builds the application in release mode and NSIS installs it for the current user. The configuration uses WebView2 `embedBootstrapper`; Node, npm, Rust and build tooling are builder/CI dependencies only and are not prerequisites for the end user.

## CI packaging

`.github/workflows/desktop-package.yml` runs on `windows-latest`, installs the locked frontend and Rust dependency graphs, builds the Tauri NSIS bundle, finds the produced NSIS executable, copies it to `dist/SelfRelay-Setup.exe`, asserts that file exists, and uploads it as the `SelfRelay-Windows-Installer` GitHub Actions artifact.

The workflow intentionally does not publish a stable GitHub Release. D0 installers are unsigned. Windows reputation/SmartScreen behavior must be treated as a distribution consideration; no bypass is claimed.

## Builder prerequisites

Local builders need a supported Windows toolchain, Rust, Node 22+, npm and the normal Tauri Windows prerequisites. These requirements apply only to developers/CI.

For a clean local build from `apps/desktop`:

```text
npm ci --workspaces=false
npm run typecheck
npm test
npm run tauri:build
```

For Rust-only checks from `apps/desktop/src-tauri`:

```text
cargo check --locked
cargo test --locked
```

## Installation smoke status

D0 packaging verifies generation and upload of the NSIS executable. A silent install/uninstall smoke is not enabled by default because installer-location and runner cleanup checks can become coupled to NSIS implementation details. Physical installation, tray persistence, native window events and explicit exit remain part of the manual Windows validation checklist.
