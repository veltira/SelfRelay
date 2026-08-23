# SelfRelay

SelfRelay reduces the cost of resuming interrupted work.

**context → exit → checkpoint → return → automatic recovery**

This repository is the canonical source repository for the CoderCup AI 2026 project.

## Download SelfRelay

End users and evaluators should **not** download the repository source ZIP or build SelfRelay themselves.

User-ready builds belong in **GitHub Releases** and are intentionally separated by platform:

| Product | Download asset | Status |
| --- | --- | --- |
| Chrome Extension | `SelfRelay-Chrome.zip` | Chrome v0.4.3 validated and ready for stable release |
| Windows Desktop | `SelfRelay-Setup.exe` | In active development; installer will be published after native validation |

Open the repository's **Releases** page to download the product you want to test. A stable release may contain both assets; you only download the one you need.

### Chrome installation

1. Download `SelfRelay-Chrome.zip` from Releases.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted SelfRelay folder.

No Node.js, npm, Git, terminal, API key, model download or build step is required.

### Windows installation

When the Windows build is published:

1. Download `SelfRelay-Setup.exe` from Releases.
2. Double-click the installer.
3. Install SelfRelay normally.
4. Open SelfRelay.

No development runtime or build tooling should be required by the evaluator.

See `docs/CODERCUP_DELIVERY.md` for the intended evaluator-facing delivery layout and `docs/DISTRIBUTION.md` for the packaging contract.

## Source layout

The folders below are implementation source, not end-user downloads:

- `apps/extension` — Chrome Extension TypeScript source.
- `apps/desktop` — Windows Desktop source once the Desktop milestone is merged into `main`.
- `apps/web` — Optional web surface; intentionally deferred.
- `packages/shared` — Shared Context/Checkpoint models and product semantics.
- `docs` — Product behavior, distribution and validation documentation.
- `artifacts/chrome-extension-unpacked` — Historical extension artifact only; not the current product build.

## Chrome product

The extension follows explicitly selected browser contexts by tab, exact page or site. When work is interrupted it captures a checkpoint; when the user returns it restores unresolved checkpoints relevant to that context.

Checkpoints support text and local audio. Audio lives locally in IndexedDB. Transcription is on-demand and local, using the packaged Whisper.cpp/WASM runtime rather than a remote API.

The current validated Chrome product version is **0.4.3**.

## Development

These commands are for contributors and CI only, not product users:

```bash
npm install
npm run check
```

`.github/workflows/package.yml` validates the extension, packages the local Whisper assets, runs browser QA, produces `SelfRelay-Chrome.zip`, and is configured so version tags can publish that package through GitHub Releases.

Do not mix this project with unrelated repositories or products.
