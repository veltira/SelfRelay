# SelfRelay

SelfRelay reduces the cost of resuming interrupted work.

Core product loop:

**context → exit → checkpoint → return → automatic recovery**

This repository is the canonical home for the CoderCup AI 2026 project.

## Repository layout

- `apps/extension` — Chrome extension source (pending recovery of the original TypeScript monorepo)
- `apps/desktop` — Desktop application
- `apps/web` — Optional web surface
- `packages/shared` — Shared models and product semantics
- `supabase` — Future backend/migrations; not required for the local-first MVP
- `docs` — Product and technical status
- `artifacts` — Preserved runnable/build outputs

## Important

The current runnable Chrome build is preserved under `artifacts/chrome-extension-unpacked/`. It is compiled output, not a replacement for the original source monorepo.

Do not mix this project with BBTY, TNcesito, or any other project.
