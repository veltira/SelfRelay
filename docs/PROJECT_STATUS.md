# Project status

## Product

SelfRelay is not a task manager, notes app, calendar, bookmark manager, session manager, second brain, or chatbot.

Its core loop is:

**context → exit → checkpoint → return → automatic recovery**

## Verified inherited state

The inherited project previously reported:

- Monorepo with `apps/extension`, `apps/desktop`, `apps/web`, `packages/shared`, `supabase`, and `docs`.
- Chrome Extension Manifest V3.
- Tracking by tab, exact URL, or site.
- Pending checkpoint creation on `tabs.onRemoved`.
- Text checkpoint capture.
- Automatic checkpoint recovery when returning to the matching context.
- Resolve action and checkpoint history.
- Full-window-close fallback intended to preserve pending capture and recover it at next startup.
- Shared `Context` and `Checkpoint` models.
- Local-first architecture.
- Reported validation: `npm run check` PASS, TypeScript build PASS, extension build PASS, tests 6/6 PASS.
- Reported inherited local Git SHA: `9ae55515beac6259cd8aeabe23ec83b4dd36b449`.

## Current GitHub state

The original source monorepo has not yet been recovered into this repository. The only recovered executable material is the unpacked compiled Chrome extension, preserved in `artifacts/chrome-extension-unpacked/`.

Do not treat compiled JavaScript as the canonical source if the original source ZIP or Git bundle can be recovered.

## Immediate priorities

1. Recover/import the original source monorepo or Git bundle.
2. Verify the real Chrome flow: close tab → capture → save → return → automatic recovery.
3. Verify full Chrome close → pending capture recovered on next startup.
4. Polish extension UX.
5. Add audio checkpoints.
6. Build the Desktop MVP before the CoderCup final demo.

## Explicitly deferred

- Supabase/backend unless it materially improves the demo.
- Mobile beyond roadmap.
- Any invasive screen monitoring or indiscriminate capture.
