# SelfRelay

SelfRelay reduces the cost of resuming interrupted work.

Core product loop:

**context → exit → checkpoint → return → automatic recovery**

This repository is the canonical home for the CoderCup AI 2026 project.

## Repository layout

- `apps/extension` — Maintainable TypeScript source for the Chrome extension.
- `apps/desktop` — Desktop application placeholder; implementation follows the completed extension phase.
- `apps/web` — Optional web surface; intentionally deferred.
- `packages/shared` — Shared Context/Checkpoint models and product semantics.
- `supabase` — Reserved for a future backend only if local-first stops being sufficient.
- `docs` — Product, behavioral reference and technical status.
- `artifacts/chrome-extension-unpacked` — Preserved historical extension artifact; no longer the current product build.

## Chrome product

The extension follows explicitly selected browser contexts by tab, exact page or site. When work is interrupted it captures a checkpoint; when the user returns it automatically restores the latest unresolved checkpoint in that context.

Checkpoints support text and local audio. Audio binaries live in IndexedDB. Transcription never requires an account, API key, token or backend: SelfRelay prefers Chrome on-device recognition only when Chrome explicitly guarantees local processing, then falls back to a Whisper.cpp/WASM multilingual runtime and model bundled in the extension package.

## User distribution

End users and CoderCup evaluators must not build SelfRelay from source.

The Chrome deliverable is:

`SelfRelay-Chrome.zip`

Expected use is download → extract → `chrome://extensions` → Developer mode → Load unpacked → select the extracted folder.

The tester must not need Node.js, npm, TypeScript, Git, terminal commands, dependencies, environment variables, model downloads, API keys or source edits. See `docs/DISTRIBUTION.md` for the full delivery contract.

Desktop will use a normal installer when implemented, with `SelfRelay-Setup.exe` as the primary Windows deliverable.

## Extension development

The commands below are for contributors and CI only, not product users:

```bash
npm install
npm run check
```

`npm run check` builds the shared package, typechecks the extension, runs tests and emits the unpacked extension at `apps/extension/dist/`.

`.github/workflows/package.yml` additionally builds the pinned local Whisper/WASM fallback, verifies its model digest, validates the complete extension and creates `SelfRelay-Chrome.zip` automatically. Tagged versions can publish the same artifact through GitHub Releases.

Do not mix this project with BBTY, TNcesito, or any other project.
