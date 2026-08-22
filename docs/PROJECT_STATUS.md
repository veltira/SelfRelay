# Project status

## Product

SelfRelay is not a task manager, notes app, calendar, bookmark manager, session manager, second brain, or chatbot.

Its core loop is:

**context → exit → checkpoint → return → automatic recovery**

## Extension source state

The preserved implementation in `artifacts/chrome-extension-unpacked/` remains a historical behavior reference. Maintainable TypeScript lives under `apps/extension` and shared product models live in `packages/shared`.

The current extension includes:

- Chrome Extension Manifest V3 source/build pipeline.
- Tracking by tab, exact URL, or site.
- Minimal snapshots only for explicitly followed contexts.
- Text checkpoint capture with discard/save paths.
- Local audio checkpoints recorded only after explicit microphone action.
- Binary audio stored in IndexedDB rather than `chrome.storage.local`.
- Local transcription: on-device Chrome recognition when it can explicitly guarantee `processLocally`, then a packaged Whisper.cpp/WASM multilingual fallback.
- Automatic recovery of the latest unresolved checkpoint when returning to the matching context; transcript is primary when present and audio playback is secondary.
- Resolve action and checkpoint history capability; resolution/deletion cleans the referenced binary asset without destructively migrating old text checkpoints.
- Deterministic full-window deduplication: one interruption per context for one closing window.
- A durable local exit journal written while tracked tabs are alive, so full-browser shutdown recovery does not depend solely on asynchronous work after Chrome has already exited.
- Startup reconciliation of durable shutdown state into pending checkpoint captures.
- One visible capture surface at a time; multiple legitimate pending items advance serially after save/discard.
- SelfRelay branding, official extension icons and official master logo on product surfaces.
- Redesigned compact popup, checkpoint composer and recovery surface using cold neutrals, navy, blue and cyan accents.
- Local-first storage; no backend/sync dependency.

## Validation

`npm run check` is the developer/CI merge gate and runs:

1. shared TypeScript build;
2. extension typecheck;
3. extension tests;
4. extension unpacked build.

The original shutdown/recovery test suite remains intact. Additional tests cover audio-only/text-only/mixed checkpoints, local transcript metadata, transcription failure preserving audio, playback routing, cleanup on resolve/delete and safe cleanup failure behavior, plus static assertions for the redesigned product surfaces.

The text/shutdown core was physically validated by the user from the packaged ZIP before this audio/UX phase. The new audio/UX build still requires physical browser validation after packaging; automated tests must not be described as a completed microphone/transcription E2E.

## Distribution

Distribution requirements are defined in `docs/DISTRIBUTION.md`.

A non-developer must never be required to install Node.js/npm/TypeScript/Git or compile SelfRelay. The Chrome deliverable is `SelfRelay-Chrome.zip`, containing the compiled extension directly.

`.github/workflows/package.yml` runs the full extension check, builds and pins the local Whisper.cpp/WASM fallback, verifies the multilingual `tiny-q5_1` model digest, validates the compiled package layout, and creates the user-ready Chrome ZIP automatically. Pull requests and `main` builds produce a validation artifact. Version tags matching `v*` publish the same ZIP to GitHub Releases.

Desktop must ultimately ship as a normal installer, with `SelfRelay-Setup.exe` as the primary Windows target.

## Next priorities

1. Physically validate the packaged audio/UX extension in Chrome.
2. Fix only concrete browser/audio bugs found by that validation.
3. Then build the mandatory Desktop MVP.
4. Align Extension/Desktop behavior and design language.

## Explicitly deferred

- Supabase/backend/sync unless it materially improves an already-solid local MVP.
- Mobile beyond roadmap.
- Any invasive screen monitoring, indiscriminate capture or hidden microphone use.
