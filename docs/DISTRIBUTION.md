# SelfRelay distribution contract

SelfRelay is not considered finished if a non-developer must install development tooling, build the repository, configure environment variables, or edit source files before using it.

The repository is the source of truth for implementation and review. User-ready builds are separate release assets.

## Public download surface

The canonical evaluator-facing download surface is **GitHub Releases**, not GitHub Actions artifacts and not the repository's `Code → Download ZIP` action.

Why:

- Actions artifacts are temporary validation outputs and can expire.
- `Code → Download ZIP` downloads the monorepo source, not a ready-to-use product.
- GitHub Release assets remain attached to the published release and provide a stable place for evaluators and normal users to choose a platform build.

A stable SelfRelay release should present platform artifacts separately, for example:

- `SelfRelay-Chrome.zip`
- `SelfRelay-Setup.exe`

The source monorepo can remain unified while the downloadable products stay clearly separated.

## Chrome Extension

Required deliverable:

`SelfRelay-Chrome.zip`

The ZIP must contain the compiled Manifest V3 extension directly, including `manifest.json`, compiled JavaScript, HTML/CSS assets, local fonts, official icons and the packaged local Whisper runtime/model. It must not contain a repository checkout that requires a build step.

Expected user flow:

1. Download `SelfRelay-Chrome.zip` from a stable GitHub Release.
2. Extract it.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Choose Load unpacked.
6. Select the extracted SelfRelay folder.
7. Use SelfRelay.

The user must not need Node.js, npm, TypeScript, Git, terminal, PowerShell, CMD, dependency installation, compilation, environment variables, API keys, model downloads or source modifications.

`apps/extension/dist` is CI build output. `artifacts/chrome-extension-unpacked` remains historical parity reference only and must not be presented as the current stable download.

The current physically and automatically validated Chrome product is v0.4.3.

## Desktop

Desktop is required for the intended final CoderCup presentation if the native checkpoint loop passes physical Windows validation.

Primary Windows deliverable:

`SelfRelay-Setup.exe`

Expected user flow:

1. Download the installer from a stable GitHub Release.
2. Run it normally.
3. Install SelfRelay.
4. Open SelfRelay.
5. Use it without manually installing runtimes or development dependencies.

The Windows installer must not be called stable until the native app has passed physical install, tray lifecycle, single-instance, observer and checkpoint-loop validation.

Future macOS or other supported platforms must receive their normal native package formats rather than source-only instructions.

## GitHub Actions and Releases

`.github/workflows/package.yml` validates and packages the Chrome extension automatically. Pull requests and `main` builds produce temporary packaging artifacts for validation. Version tags matching `v*` are configured to publish `SelfRelay-Chrome.zip` as a GitHub Release asset after the extension checks succeed.

Desktop packaging should follow the same principle: Windows CI produces `SelfRelay-Setup.exe`; the stable installer is attached to a GitHub Release after physical validation.

Do not use an expiring Actions artifact as the final link in the CoderCup submission or presentation video.

## Recommended final CoderCup release

A final stable release should let an evaluator choose either product without understanding the monorepo:

```text
SelfRelay stable release

SelfRelay-Chrome.zip     Chrome Extension
SelfRelay-Setup.exe      Windows Desktop
```

The README should point evaluators to Releases first, then provide the two short installation flows.

## CoderCup delivery

A private repository by itself is not an accessible submission. Before final delivery, explicitly ensure that CoderCup evaluators can access both the repository and the stable Release assets.

The evaluator must not be required to build SelfRelay.
