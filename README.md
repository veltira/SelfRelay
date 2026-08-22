# SelfRelay

SelfRelay reduces the cost of resuming interrupted work.

Core product loop:

**context → exit → checkpoint → return → automatic recovery**

This repository is the canonical home for the CoderCup AI 2026 project.

## Repository layout

- `apps/extension` — Maintainable TypeScript source for the Chrome extension.
- `apps/desktop` — Desktop application placeholder; implementation follows extension hardening/audio.
- `apps/web` — Optional web surface; intentionally deferred.
- `packages/shared` — Shared Context/Checkpoint models and product semantics.
- `supabase` — Reserved for a future backend only if local-first stops being sufficient.
- `docs` — Product, behavioral reference and technical status.
- `artifacts/chrome-extension-unpacked` — Preserved compiled extension used as the parity oracle.

## User distribution

End users and CoderCup evaluators must not build SelfRelay from source.

The Chrome deliverable is:

`SelfRelay-Chrome.zip`

Expected use is download → extract → `chrome://extensions` → Developer mode → Load unpacked → select the extracted folder.

The tester must not need Node.js, npm, TypeScript, Git, terminal commands, dependencies, environment variables, or source edits. See `docs/DISTRIBUTION.md` for the full delivery contract.

Desktop will use a normal installer when implemented, with `SelfRelay-Setup.exe` as the primary Windows deliverable.

## Extension development

The commands below are for contributors and CI only, not product users:

```bash
npm install
npm run check
```

`npm run check` builds the shared package, typechecks the extension, runs the parity/tests and emits the unpacked extension at `apps/extension/dist/`.

`.github/workflows/package.yml` turns that validated output into `SelfRelay-Chrome.zip` automatically and prepares tagged versions for GitHub Releases.

The preserved artifact remains untouched until the maintainable source has been functionally validated in Chrome.

Do not mix this project with BBTY, TNcesito, or any other project.
