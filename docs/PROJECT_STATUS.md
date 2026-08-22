# Project status

## Product

SelfRelay is not a task manager, notes app, calendar, bookmark manager, session manager, second brain, or chatbot.

Its core loop is:

**context → exit → checkpoint → return → automatic recovery**

## Extension source state

The preserved implementation in `artifacts/chrome-extension-unpacked/` remains the behavior reference. Maintainable TypeScript lives under `apps/extension` and shared product models live in `packages/shared`.

The current extension includes:

- Chrome Extension Manifest V3 source/build pipeline.
- Tracking by tab, exact URL, or site.
- Minimal snapshots only for explicitly followed contexts.
- Text checkpoint capture with discard/save paths.
- Automatic recovery of the latest unresolved checkpoint when returning to the matching context.
- Resolve action and checkpoint history capability.
- Deterministic full-window deduplication: one interruption per context for one closing window.
- A durable local exit journal written while tracked tabs are alive, so full-browser shutdown recovery does not depend solely on asynchronous work after Chrome has already exited.
- Startup reconciliation of durable shutdown state into pending checkpoint captures.
- One visible capture surface at a time; multiple legitimate pending items advance serially after save/discard.
- SelfRelay branding and official extension icons at 16/32/48/128 px.
- Local-first storage; no backend/sync dependency.

## Validation

`npm run check` is the developer/CI merge gate and runs:

1. shared TypeScript build;
2. extension typecheck;
3. extension tests;
4. extension unpacked build.

The extension suite contains 20 automated tests covering URL/scope parity, normal tab close, same-context multi-tab window close, different-context window close, duplicate prevention, queue ordering, durable full-Chrome restart recovery, preservation of older legitimate pending captures, unsupported schemes, preserved functional manifest capabilities and branding/icon integrity.

Physical Chrome validation remains separate and is documented in `docs/MANUAL_CHROME_VALIDATION.md`. Automated tests must not be described as a completed real-browser E2E.

## Distribution

Distribution requirements are defined in `docs/DISTRIBUTION.md`.

A non-developer must never be required to install Node.js/npm/TypeScript/Git or compile SelfRelay. The Chrome deliverable is `SelfRelay-Chrome.zip`, containing the compiled extension directly.

`.github/workflows/package.yml` runs the full extension check, validates the compiled package layout, and creates the user-ready Chrome ZIP automatically. Pull requests and `main` builds produce a validation artifact. Version tags matching `v*` publish the same ZIP to GitHub Releases.

Desktop must ultimately ship as a normal installer, with `SelfRelay-Setup.exe` as the primary Windows target.

## Next priorities after manual validation

1. Run the manual Chrome checklist using the packaged `SelfRelay-Chrome.zip`.
2. If that passes, proceed to local audio checkpoints.
3. Then build the mandatory Desktop MVP.
4. Align Extension/Desktop behavior and design language.

## Explicitly deferred

- Supabase/backend/sync unless it materially improves an already-solid local MVP.
- Mobile beyond roadmap.
- Any invasive screen monitoring, indiscriminate capture or hidden microphone use.
