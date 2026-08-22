# Project status

## Product

SelfRelay is not a task manager, notes app, calendar, bookmark manager, session manager, second brain, or chatbot.

Its core loop is:

**context → exit → checkpoint → return → automatic recovery**

## Extension source state

The preserved implementation in `artifacts/chrome-extension-unpacked/` remains a historical behavior reference. Maintainable TypeScript lives under `apps/extension` and shared product models live in `packages/shared`.

The current extension includes:

- Chrome Extension Manifest V3 source/build pipeline.
- Backward-compatible legacy tracking by tab, exact URL, or site.
- Explicit browser work contexts (worksets) composed of one or more user-selected supported logical pages.
- Workset members retain URL, title, favicon and stable order; identical normalized URLs collapse to one logical member and internal/browser URLs are never added automatically.
- A logical page already owned by another workset is rejected explicitly instead of being silently attached to two worksets.
- Closing **any** selected workset tab is now a valid exit event and immediately offers a checkpoint; the context remains followed even while other members stay open.
- Rapid individual closes from the same workset/session aggregate into one pending exit and at most one visible capture surface.
- Pending workset exits snapshot the affected member IDs, URL/title/favicon and source keys so reopening a tab or editing the workset cannot invalidate the event.
- Capture can save one checkpoint for the closed tab(s), the whole context, or a custom subset. A one-member context keeps the simple capture flow because those choices are equivalent.
- Whole-window close still groups affected members by context and never opens one capture per tab during `isWindowClosing`.
- Full-Chrome shutdown still relies on the durable journal: no window is forced during shutdown; stale snapshots are grouped by context and surfaced serially at the next startup.
- Text and local audio checkpoints with discard/save paths.
- Binary audio stored in IndexedDB rather than `chrome.storage.local`.
- Audio saving is immediate: recording, stopping, saving, exiting and returning never start transcription.
- Transcription starts only when the user explicitly selects `Transcribir audio` from recovery.
- Local transcription uses the packaged Whisper.cpp/WASM runtime with multilingual `base-q5_1`; no browser speech service, API, token, backend or post-install model download is required.
- Audio is decoded before Whisper, downmixed to mono, speech-band filtered, resampled with Web Audio to 16 kHz Float32 PCM, silence-trimmed and normalized conservatively.
- Spanish uses an explicit `es` language hint and translation is disabled.
- Successful transcripts are persisted on the existing checkpoint and remain editable; failure never removes the original audio and can be retried.
- Checkpoints can target the entire workset, a subset of members, or one explicit member without duplicating checkpoint records.
- A checkpoint targeted to one member outranks subset checkpoints, which outrank a general workset checkpoint on that page.
- Recovery from any eligible workset member uses one claimed surface at a time and can open only the missing supported tabs on explicit request.
- Resolve action and checkpoint history remain available; resolution/deletion cleans referenced binary audio without destructively migrating older text checkpoints.
- Deterministic window/shutdown idempotency uses explicit source keys rather than timing windows.
- Startup reconciliation of durable shutdown state remains idempotent.
- SelfRelay branding and official icons remain packaged; popup, capture, recovery and audio player all show the official logo immediately to the left of `SelfRelay`.
- Popup, capture, recovery and player use a stronger utility design: navy brand header, cold neutral canvas, compact high-contrast controls, restrained blue/cyan accents and local IBM Plex Sans.
- Motion is functional and short, with `prefers-reduced-motion` respected.
- Local-first storage; no backend/sync dependency.

## Transcription quality decision

The previous `tiny-q5_1` fallback was physically reported as insufficient for Spanish. The current build packages multilingual `base-q5_1` and uses beam search for short checkpoints.

The packaging job performs a pinned real-Spanish speech smoke test. It runs both `tiny-q5_1` and `base-q5_1` against the same short WAV, logs both transcripts, checks Spanish keyword recall, requires the base result to reach the minimum quality gate, and requires it not to regress against tiny. The tiny model is downloaded only for this CI comparison and is never included in the release ZIP.

## Exit-event semantics

A selected tab close no longer means “ignore this because another workset member is still open.” It means the user left at least one part of the context, so SelfRelay offers to capture where they were.

For worksets, unprocessed exits from the same browser session/context are folded into one pending record with immutable `closedMembers` snapshots and multiple idempotency source keys. Saving or discarding removes that pending; a later exit therefore becomes a new event. Closing an unselected tab has no effect.

Window close and full-browser shutdown remain grouped operations. They use the same pending model but preserve their hardened lifecycle rules: window-close prompts are surfaced only after the closing window is gone, and full shutdown is reconciled only at startup.

## Validation

`npm run check` is the developer/CI merge gate and runs:

1. shared TypeScript build;
2. extension typecheck;
3. extension tests;
4. extension unpacked build.

The original shutdown/recovery tests remain part of the suite. Additional coverage verifies per-tab workset exits, aggregation of rapid closes, window/shutdown grouping, immutable exit snapshots, general/subset/member-specific targeting, checkpoint specificity, duplicate URL semantics, cross-workset ownership conflicts, missing-tab restoration, recovery-surface claims, deferred/cached/retried transcription, PCM preparation and legacy audio cleanup behavior.

The original text/shutdown core was physically validated by the user from a packaged ZIP. Automated tests still do not substitute for final physical validation of the new per-tab capture UX in a normal Chrome installation.

## Distribution

Distribution requirements are defined in `docs/DISTRIBUTION.md`.

A non-developer must never be required to install Node.js/npm/TypeScript/Git or compile SelfRelay. The Chrome deliverable is `SelfRelay-Chrome.zip`, containing the compiled extension directly.

`.github/workflows/package.yml` installs the pinned IBM Plex assets, builds the pinned Whisper.cpp/WASM runtime, verifies multilingual `base-q5_1` by SHA-256, runs the Spanish quality smoke, runs the full extension check, validates fonts/offscreen/runtime/model/logo assets and creates the user-ready Chrome ZIP. Pull requests and `main` builds produce a validation artifact. Version tags matching `v*` publish the same ZIP to GitHub Releases.

Desktop must ultimately ship as a normal installer, with `SelfRelay-Setup.exe` as the primary Windows deliverable.

## Next priorities

1. Physically validate this packaged per-tab workset capture build in Chrome.
2. Fix only concrete browser/audio/workset bugs found by that validation.
3. Then build the mandatory Desktop MVP.
4. Align Extension/Desktop behavior and design language.

## Explicitly deferred

- Supabase/backend/sync unless it materially improves an already-solid local MVP.
- Mobile beyond roadmap.
- Any invasive screen monitoring, indiscriminate capture or hidden microphone use.
