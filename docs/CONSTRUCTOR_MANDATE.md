# SelfRelay — Constructor Mandate

## Mission

Continue SelfRelay from the existing repository. Do not start a new product, do not mix it with BBTY, TNcesito, or any unrelated project, and do not change the core problem.

SelfRelay solves one problem: after interrupting work, people often remember where they were working but not exactly what they were doing, thinking, or supposed to do next.

The core mechanic is non-negotiable:

**context → exit → checkpoint → return → automatic recovery**

SelfRelay is not a task manager, notes app, calendar, bookmark manager, second brain, chatbot, or session manager.

## Repository

Canonical repository: `veltira/SelfRelay`

Work directly from this repository. Inspect before modifying. Preserve working behavior. Commit coherent changes with clear messages.

Current repository organization:

- `apps/extension`
- `apps/desktop`
- `apps/web`
- `packages/shared`
- `supabase`
- `docs`
- `artifacts/chrome-extension-unpacked`

Important: the currently preserved implementation is under `artifacts/chrome-extension-unpacked`. It is a compiled/unpacked Chrome extension artifact, not the original TypeScript monorepo source. Treat it as the behavioral reference. Do not delete it until a maintainable source implementation reproduces its behavior and passes validation.

The historical local source reportedly had commit SHA `9ae55515beac6259cd8aeabe23ec83b4dd36b449`, but that history is not currently present in this GitHub repository.

## What the preserved Chrome extension already does

The existing artifact implements Manifest V3 and can:

- follow a browser context by tab, exact URL, or site/domain;
- retain only minimal metadata for explicitly followed contexts;
- detect tab removal;
- create a pending checkpoint capture;
- open a dedicated capture popup after a normal tab close;
- allow the user to discard or save a text checkpoint;
- automatically recover the latest unresolved checkpoint when the user returns to the matching context;
- display recovery inside the page without requiring the extension popup;
- resolve checkpoints;
- keep checkpoint history;
- preserve pending capture when an entire Chrome window closes and attempt recovery on the next browser startup.

The previous isolated source reportedly passed TypeScript/build checks and 6/6 tests, including an integration flow for:

`follow URL → tabs.onRemoved → checkpoint capture → save text → return → automatic recovery → resolve`

Do not claim those tests apply to newly reconstructed code until they are recreated and run successfully.

## Immediate objective

Turn this repository into the maintainable, official SelfRelay codebase and then complete the MVP for CoderCup AI 2026.

### Phase 1 — Establish maintainable source without regressions

1. Inspect every file in `artifacts/chrome-extension-unpacked` and document existing behavior.
2. Create/restore the real source structure under `apps/extension` and shared models under `packages/shared`.
3. Use TypeScript where appropriate and establish a reproducible build that emits the unpacked extension.
4. Preserve the compiled artifact as a reference until parity is verified.
5. Recreate automated tests for the existing core flow.
6. Build and verify the extension output.
7. Do not add backend/cloud infrastructure yet.

Acceptance: the new source reproduces the existing text-checkpoint behavior before adding new features.

### Phase 2 — Fix and formalize full-browser-close recovery

Chrome extensions cannot reliably interrupt the operating system/browser shutdown to force a popup after the last Chrome window has already closed. Do not fake this capability.

Required behavior:

- normal tab close while Chrome remains open → show capture popup immediately;
- full Chrome/window shutdown → persist the pending checkpoint safely;
- next Chrome startup → surface the pending checkpoint promptly and clearly;
- never force Chrome to reopen itself after the user intentionally exits;
- prevent duplicate pending captures caused by closing multiple tracked tabs/windows together.

Add tests around shutdown/startup state persistence as far as Chrome APIs can be simulated.

### Phase 3 — SelfRelay product identity and extension UX

Replace generic `Checkpoint` branding with `SelfRelay` while keeping the checkpoint terminology as the product mechanic.

The extension must feel like a product, not a developer demo.

Required surfaces:

- browser-action popup / tracking controls;
- exit checkpoint capture;
- recovery card shown when returning;
- checkpoint history;
- clear states for followed/not-followed context;
- resolve/dismiss behavior;
- unobtrusive error and success states.

Design principles:

- minimal, calm, modern, legible;
- low friction;
- no project folders, priorities, labels, or task-management clutter;
- clear hierarchy around `where you left off` and `next step`;
- the user should be able to save a checkpoint in seconds.

Do not redesign the core interaction into a dashboard-first workflow.

### Phase 4 — Audio checkpoints

Add audio as a second checkpoint input mode, not as a separate recording product.

Required UX:

- user can choose text or audio from the checkpoint capture surface;
- request microphone permission only when the user explicitly starts recording;
- start/stop recording clearly;
- playback before saving where practical;
- persist the recording locally;
- when returning to the context, allow playback of the audio checkpoint;
- keep audio associated with the same `Checkpoint` domain model/semantics;
- handle permission denied and unsupported states gracefully.

Architecture:

- prefer local-first storage;
- use an appropriate local blob store such as IndexedDB for audio instead of forcing large binary blobs into unsuitable extension storage;
- store only metadata/references in checkpoint records;
- do not introduce Supabase just for audio.

Transcription is desirable after recording/playback is solid, but it is not allowed to block a reliable audio MVP. If transcription requires remote services, isolate it behind an interface and keep the base checkpoint usable without it.

### Phase 5 — Desktop MVP (mandatory for CoderCup)

Desktop is not roadmap-only. It must become a working downloadable application before the final submission.

The Desktop application should implement the same concept for selected work applications.

Minimum flow:

1. user chooses applications to follow;
2. SelfRelay detects entry/exit of supported application contexts using legitimate OS/process/window capabilities;
3. on leaving a followed context, offer a checkpoint;
4. save text initially and audio once the shared audio path is ready;
5. on returning to that application/context, automatically surface the latest unresolved checkpoint;
6. resolve it;
7. retain history.

Start with a small, robust supported set rather than pretending to support every application. Good demonstration targets include VS Code and a browser, then another common desktop app if reliable.

Do not implement indiscriminate screen recording, screenshots, keystroke logging, or invasive surveillance.

Desktop and Extension must share concepts/models/design language. They are surfaces of one product.

### Phase 6 — Web/backend only if justified

`apps/web` and `supabase` must not consume time merely because they exist.

Local-first is the default. Add accounts/sync only if the Chrome + Desktop MVP is already solid and cross-device sync materially improves the CoderCup demonstration.

Do not spend money or create paid infrastructure without explicit authorization.

## Shared domain rules

Keep or reconstruct shared domain models around at least:

- `Context`
- `Checkpoint`

Do not arbitrarily redefine their semantics. Extend them only when necessary for supported media/context types, preferably through backwards-compatible fields.

A checkpoint belongs to a context. That relationship is the product.

## Privacy rules

- Track only contexts explicitly selected by the user.
- Store the minimum metadata needed for recovery.
- No silent browsing-history harvesting.
- No screen capture by default.
- No keylogging.
- No hidden microphone recording.
- Ask for permissions at the moment they are needed.
- Keep data local unless a later feature explicitly requires remote sync.

## Engineering rules

For every meaningful change:

1. inspect existing code;
2. state what behavior is being changed;
3. implement the smallest coherent solution;
4. run typecheck/build/tests;
5. add or update tests for the affected behavior;
6. distinguish compile success from actual functional validation;
7. commit the result to the repository with a clear message.

Do not delete a functioning path before its replacement has parity.

Prefer incremental commits rather than one enormous rewrite.

## CoderCup optimization

The demo must communicate the product in seconds:

**Before:** “I came back to work and had to reconstruct what I was doing.”

**After:** close/leave → SelfRelay asks for a checkpoint → save/speak → return → checkpoint automatically appears → continue immediately.

Then show the same mechanic on Desktop to prove that SelfRelay is a cross-context product, not merely a Chrome extension.

Optimize for:

- real problem;
- execution quality;
- originality of the context-bound recovery mechanic;
- clarity.

Do not add features merely because they look technically impressive.

## Execution order

Unless a concrete blocker forces a change, work in this order:

1. inspect repository and preserved artifact;
2. establish maintainable extension source + tests/build;
3. reach behavior parity with the current artifact;
4. harden full-browser-close recovery;
5. polish SelfRelay extension UX/branding;
6. implement local audio checkpoints;
7. build Desktop MVP;
8. unify Extension/Desktop behavior and design;
9. only then evaluate transcription, sync, web/backend, or mobile roadmap.

## First action

Begin by inspecting `veltira/SelfRelay` on `main`, especially `artifacts/chrome-extension-unpacked`, `README.md`, and `docs/PROJECT_STATUS.md`.

Do not start a new repository or a new product. Work from the current repository and return an initial technical inventory plus the first implemented milestone. Do not stop at a plan if the repository is writable: make the first safe implementation progress and validate it.