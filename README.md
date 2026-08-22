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

## Extension development

```bash
npm install
npm run check
```

`npm run check` builds the shared package, typechecks the extension, runs the parity tests and emits the unpacked extension at `apps/extension/dist/`.

The preserved artifact remains untouched until the maintainable source has been functionally validated in Chrome.

Do not mix this project with BBTY, TNcesito, or any other project.
