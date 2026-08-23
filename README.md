# SelfRelay

SelfRelay reduces the cost of resuming interrupted work.

**context → exit → checkpoint → return → automatic recovery**

This repository is the canonical source repository for the CoderCup AI 2026 project.

## CoderCup evaluators — start here

SelfRelay helps preserve the mental context that is normally lost when work is interrupted. Instead of relying on memory, the user leaves a short text or voice checkpoint when leaving a tracked work context and receives that unresolved context when returning.

The fastest way to evaluate the product is:

1. Open this repository's **Releases** page.
2. Download the SelfRelay product you want to test.
3. Follow the short installation steps below — no source build, terminal, API key or paid AI service is required.
4. Try the core loop: **select/follow a context → leave it → save a checkpoint → return → recover it**.

SelfRelay keeps checkpoint data locally. Voice transcription is explicit and on-demand, using a packaged local Whisper runtime rather than a remote transcription API.

### Windows SmartScreen / security notice

SelfRelay's Windows installer is currently distributed without a commercial Authenticode code-signing certificate. Because of that, Microsoft Defender SmartScreen may show an **Unknown publisher** or **Windows protected your PC** reputation warning even when the file was downloaded from the official SelfRelay release.

A SmartScreen reputation warning is not, by itself, a malware detection. Evaluators should only run the installer when it was downloaded from the official `veltira/SelfRelay` GitHub Release and, when a SHA-256 checksum is provided with the release, verify that it matches before proceeding. Do not bypass a malware detection from antivirus software.

## Download SelfRelay

End users and evaluators should **not** download the repository source ZIP or build SelfRelay themselves.

User-ready builds belong in **GitHub Releases** and are intentionally separated by platform:

| Product | Download asset | Status |
| --- | --- | --- |
| Chrome Extension | `SelfRelay-Chrome.zip` | Chrome v0.4.3 validated and ready for stable release |
| Windows Desktop | `SelfRelay-Setup.exe` | Published only after the current Windows candidate completes physical validation |

Open the repository's **Releases** page to download the product you want to test. A stable release may contain both assets; you only download the one you need.

### Chrome installation

1. Download `SelfRelay-Chrome.zip` from Releases.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted SelfRelay folder.

No Node.js, npm, Git, terminal, API key, model download or build step is required.

### Quick Chrome test

1. Open SelfRelay and follow a browser context.
2. Work in that context and then leave or close it.
3. Save a short text or voice checkpoint when SelfRelay captures the interruption.
4. Return to the same followed context.
5. Confirm that SelfRelay restores the unresolved checkpoint.
6. Mark it as resumed when you no longer need it.

### Windows installation

When `SelfRelay-Setup.exe` is present in the stable Release:

1. Download `SelfRelay-Setup.exe` from the official SelfRelay Release.
2. Verify the SHA-256 checksum shown with that release when provided.
3. Double-click the installer.
4. If SmartScreen shows a reputation warning, first confirm that the file and checksum are the official ones described above.
5. Install and open SelfRelay normally.

No development runtime or build tooling should be required by the evaluator.

### Quick Windows test

1. Add an eligible Windows application to SelfRelay.
2. Open and use that application normally.
3. Exit the tracked application/context.
4. Save the checkpoint that SelfRelay presents.
5. Reopen the same application/context.
6. Confirm that the unresolved checkpoint is automatically offered for recovery.

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
