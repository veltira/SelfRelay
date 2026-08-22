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
- Explicit browser work contexts (worksets) composed of one or more user-selected supported tabs.
- Workset members retain URL, title, favicon and stable order; internal/browser URLs are never added automatically.
- Closing one member of a multi-tab context does not end the context while another member remains open.
- Closing the last member generates one pending context checkpoint; window close and full-Chrome durable recovery reuse the hardened journal architecture.
- Text and local audio checkpoints with discard/save paths.
- Binary audio stored in IndexedDB rather than `chrome.storage.local`.
- Audio saving is immediate: recording, stopping, saving, exiting and returning never start transcription.
- Transcription starts only when the user explicitly selects `Transcribir audio` from recovery.
- Local transcription uses the packaged Whisper.cpp/WASM runtime with multilingual `base-q5_1`; no browser speech service, API, token, backend or post-install model download is required.
- Audio is decoded before Whisper, downmixed to mono, silence-trimmed, resampled to 16 kHz Float32 PCM and normalized conservatively.
- Spanish uses an explicit `es` language hint and translation is disabled.
- Successful transcripts are persisted on the existing checkpoint and remain editable; failure never removes the original audio and can be retried.
- Checkpoints can target the entire workset (default), a subset of members, or one explicit member without duplicating checkpoint records.
- A checkpoint targeted to one member outranks subset checkpoints, which outrank a general workset checkpoint on that page.
- Recovery from any eligible workset member uses one surface at a time and can open only the missing supported tabs on explicit request.
- Resolve action and checkpoint history remain available; resolution/deletion cleans referenced binary audio without destructively migrating older text checkpoints.
- Deterministic full-window deduplication and the durable local exit journal remain in place.
- Startup reconciliation of durable shutdown state remains idempotent.
- SelfRelay branding and official icons remain packaged.
- Popup, capture and recovery use a compact IBM Plex Sans interface built from neutral separators and restrained controls rather than nested cards/badges.
- Local-first storage; no backend/sync dependency.

## Transcription quality decision

The previous `tiny-q5_1` fallback was physically reported as insufficient for Spanish. The new build packages multilingual `base-q5_1` and uses beam search for short checkpoints.

The packaging job also performs a pinned real-Spanish speech smoke test. It runs both `tiny-q5_1` and `base-q5_1` against the same short WAV, logs both transcripts, checks Spanish keyword recall, requires the base result to reach the minimum quality gate, and requires it not to regress against tiny. The tiny model is downloaded only for this CI comparison and is never included in the release ZIP.

## Validation

`npm run check` is the developer/CI merge gate and runs:

1. shared TypeScript build;
2. extension typecheck;
3. extension tests;
4. extension unpacked build.

The original shutdown/recovery tests remain part of the suite. Additional coverage verifies workset creation/editing, last-tab exit semantics, window/shutdown recovery, general/subset/member-specific targeting, checkpoint specificity, missing-tab restoration, unsafe URL rejection, deferred/cached/retried transcription, PCM preparation and legacy audio cleanup behavior.

The text/shutdown core was physically validated by the user from a packaged ZIP before this phase. The new multi-tab/transcription/UX build still requires physical browser validation after packaging; automated tests must not be described as a completed real-microphone Chrome E2E.

## Distribution

Distribution requirements are defined in `docs/DISTRIBUTION.md`.

A non-developer must never be required to install Node.js/npm/TypeScript/Git or compile SelfRelay. The Chrome deliverable is `SelfRelay-Chrome.zip`, containing the compiled extension directly.

`.github/workflows/package.yml` installs the pinned IBM Plex assets, builds the pinned Whisper.cpp/WASM runtime, verifies multilingual `base-q5_1` by SHA-256, runs the Spanish quality smoke, runs the full extension check, validates fonts/offscreen/runtime/model assets and creates the user-ready Chrome ZIP. Pull requests and `main` builds produce a validation artifact. Version tags matching `v*` publish the same ZIP to GitHub Releases.

Desktop must ultimately ship as a normal installer, with `SelfRelay-Setup.exe` as the primary Windows deliverable.

## Next priorities

1. Physically validate this packaged workset/on-demand-transcription extension in Chrome.
2. Fix only concrete browser/audio/workset bugs found by that validation.
3. Then build the mandatory Desktop MVP.
4. Align Extension/Desktop behavior and design language.

## Explicitly deferred

- Supabase/backend/sync unless it materially improves an already-solid local MVP.
- Mobile beyond roadmap.
- Any invasive screen monitoring, indiscriminate capture or hidden microphone use.
