# Project status

## Product

SelfRelay is not a task manager, notes app, calendar, bookmark manager, session manager, second brain, or chatbot.

Its core loop is:

**context → exit → checkpoint → return → automatic recovery**

## Reconstructed source state

The preserved implementation in `artifacts/chrome-extension-unpacked/` has been inspected file-by-file and its text-checkpoint behavior is now reconstructed as maintainable TypeScript under `apps/extension`.

The official source now includes:

- Chrome Extension Manifest V3 source/build pipeline.
- Tracking by tab, exact URL, or site.
- Minimal snapshots only for explicitly followed contexts.
- Pending checkpoint creation on `tabs.onRemoved`.
- Text checkpoint capture with discard/save paths.
- Automatic recovery of the latest unresolved checkpoint when returning to the matching context.
- Resolve action and checkpoint history service-worker capability.
- Full-window-close behavior that persists the pending capture without forcing Chrome to reopen.
- Startup fallback that surfaces the oldest pending capture.
- Shared `Context` and `Checkpoint` models in `packages/shared`.
- Local-first storage; no backend/sync dependency.
- CI running typecheck, 6 parity/core tests and extension build.

The historical local SHA `9ae55515beac6259cd8aeabe23ec83b4dd36b449` remains historical context only; this GitHub repository is now the canonical source.

## Validation completed

The reconstructed code has automated coverage for:

1. URL normalization and supported-scheme rejection.
2. Tab/URL/site matching and specificity.
3. `follow → close → capture → save → return → automatic recovery → resolve`.
4. Full-window close persisting capture without a popup.
5. Startup surfacing the oldest pending capture.
6. Unsupported browser pages not being tracked.

CI must remain green before parity work is considered safe to merge.

## Next priorities

1. Validate the rebuilt `apps/extension/dist` in a normal Chrome installation against the preserved artifact.
2. Harden full-browser-close recovery, including duplicate-pending prevention during multi-tab/window shutdown.
3. Apply SelfRelay branding and UX polish without changing the mechanic.
4. Add local audio checkpoints.
5. Build the mandatory Desktop MVP.
6. Align Extension/Desktop behavior and design language.

## Explicitly deferred

- Supabase/backend/sync unless it materially improves an already-solid local MVP.
- Mobile beyond roadmap.
- Any invasive screen monitoring, indiscriminate capture or hidden microphone use.
