# SelfRelay distribution contract

SelfRelay is not considered finished if a non-developer must install development tooling, build the repository, configure environment variables, or edit source files before using it.

The repository is the source of truth for implementation and review. User-ready builds are separate release artifacts.

## Chrome Extension

Required deliverable:

`SelfRelay-Chrome.zip`

The ZIP must contain the compiled Manifest V3 extension directly, including `manifest.json`, compiled JavaScript, HTML/CSS assets, and official icons. It must not contain a repository checkout that requires a build step.

Expected user flow:

1. Download `SelfRelay-Chrome.zip`.
2. Extract it.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Choose Load unpacked.
6. Select the extracted SelfRelay folder.
7. Use SelfRelay.

The user must not need Node.js, npm, TypeScript, Git, terminal, PowerShell, CMD, dependency installation, compilation, environment variables, or source modifications.

`apps/extension/dist` is the compiled extension output used to create the ZIP. `artifacts/chrome-extension-unpacked` remains historical parity reference only and must not be distributed as the current build.

## Desktop

Desktop is mandatory before the final CoderCup AI 2026 submission.

Primary Windows deliverable:

`SelfRelay-Setup.exe`

Expected user flow:

1. Download the installer.
2. Run it normally.
3. Install SelfRelay.
4. Open SelfRelay.
5. Use it without manually installing runtimes or development dependencies.

Future macOS or other supported platforms must receive their normal native package formats rather than source-only instructions.

## GitHub Actions and Releases

`.github/workflows/package.yml` validates and packages the Chrome extension automatically. Pull requests and `main` builds produce a packaging artifact for validation. Version tags matching `v*` publish `SelfRelay-Chrome.zip` as a GitHub Release asset after the full extension check succeeds.

Stable releases should contain the user-ready artifacts appropriate to the state of the project, for example:

- `SelfRelay-Chrome.zip`
- `SelfRelay-Setup.exe`
- future supported-platform installers when they exist

Do not call a release stable merely because compilation succeeds. Physical Chrome validation remains required before treating the Chrome build as validated for users.

## CoderCup delivery

A private repository by itself is not an accessible submission. Before final delivery, explicitly ensure that evaluators can access the source repository and/or the required downloadable release assets.

The evaluator must not be required to build SelfRelay.
