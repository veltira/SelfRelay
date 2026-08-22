# Manual Chrome validation — SelfRelay extension

This checklist validates real browser behavior that automated tests cannot prove by themselves.

## Load the packaged build

Required artifact: `SelfRelay-Chrome.zip`.

1. Download and extract `SelfRelay-Chrome.zip`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder that directly contains `manifest.json`.
6. Confirm the extension is named **SelfRelay** and uses the official icon.

Do not load `artifacts/chrome-extension-unpacked`; that directory is historical reference only. The tester must not install Node.js/npm/TypeScript/Git or run a build.

## Scenario A — one selected tab

1. Create a SelfRelay context containing one normal `https://` page.
2. Close that page while Chrome remains open.
3. Expect exactly one `¿Dónde quedaste?` capture.
4. Because the context has one member, no redundant `Esta pestaña / Todo el contexto` selector should appear.
5. Save and reopen the page.
6. Expect one recovery surface and resolve it.

Pass: the simple `context → exit → checkpoint → return → automatic recovery` loop remains intact.

## Scenario B — close any member of a four-tab workset

Create A/B/C/D as one workset.

1. Close A while B/C/D remain open.
2. Expect one capture immediately.
3. The context line should identify A (`Cerraste …`).
4. `Guardar para` should default to **Esta pestaña**.
5. Save for that default.
6. Reopen A: the checkpoint must appear.
7. Open B/C/D: that member-specific checkpoint must not appear there.

Pass: closing any selected member is an exit event; SelfRelay no longer waits for the last member.

## Scenario C — aggregate rapid closes without window spam

1. With A/B/C/D, close A.
2. Leave the capture open and close B.
3. Verify there is still only one capture window.
4. The capture should update to `Cerraste 2 pestañas de este contexto`.
5. Save for **Estas pestañas**.
6. Verify one checkpoint was created for A+B, not two checkpoint copies.
7. Later, after that pending is processed, close C and verify a new capture appears.

Pass: unprocessed exits from the same workset/session aggregate explicitly; processed exits do not.

## Scenario D — targeting choices

For a context A/B/C/D and an open capture:

1. Save once for **Esta pestaña / Estas pestañas**.
2. On another exit choose **Todo el contexto** and verify one general checkpoint recovers from any member.
3. On another exit choose **Elegir…**, select A+C and save.
4. Verify that checkpoint appears on A/C and not B/D.
5. If specific, subset and general checkpoints coexist, verify priority is specific → subset → general.

Pass: targeting controls eligibility without duplicating one checkpoint record.

## Scenario E — pending remains stable while tabs/context change

1. Close A and keep its capture open.
2. Reopen A before saving.
3. Save for A and verify the checkpoint still uses A's logical member identity.
4. Repeat and modify the workset while the capture is open; saving/discarding must not error or corrupt the context.
5. `No guardar` must discard only that exit event and must not stop following the workset.

## Scenario F — duplicate URL and cross-workset ownership

1. Open two browser tabs whose normalized URLs are identical.
2. Add both to a workset; verify SelfRelay represents them as one logical member and restoration never creates duplicate copies.
3. Try to add a logical page already owned by another workset.
4. Verify the picker marks the conflict clearly and SelfRelay refuses silent double membership.

## Scenario G — window close grouping

1. Put A/B/C from a workset in one Chrome window and D elsewhere.
2. Close the A/B/C window.
3. Do not expect three capture windows during `isWindowClosing`.
4. After the window closes, expect one capture describing three closed tabs.
5. The default should be **Estas pestañas** because D is still open.
6. Put the entire workset in one window and close it; expect one grouped capture with **Todo el contexto** preselected.

## Scenario H — full Chrome shutdown

1. Keep one or more worksets active.
2. Close all Chrome windows so Chrome exits completely.
3. SelfRelay must not force Chrome back open or create popup windows during shutdown.
4. Start Chrome normally.
5. Expect one coherent pending capture per context, with same-context members grouped.
6. Different worksets must remain separate and advance through the existing serial queue.

Pass: the durable journal remains authoritative and idempotent.

## Scenario I — missing-tab restoration

1. Save a checkpoint in a four-member context.
2. Return through only one member.
3. Recovery should offer `Abrir X pestañas restantes` when appropriate.
4. Use it and verify only missing supported URLs open; already-open pages are not duplicated.
5. Nothing should restore automatically.

## Scenario J — audio and deferred local transcription

1. Record a short Spanish audio checkpoint and save it.
2. Verify no transcription begins during record/stop/save/exit/return.
3. Return and play audio immediately.
4. Select **Transcribir audio** explicitly.
5. Verify processing begins only then; on success the transcript is editable and persisted.
6. On failure, audio remains intact and retry is available.

Pass: transcription remains packaged/local/on-demand and independent from the saved audio.

## Scenario K — one recovery surface and visual identity

1. Open several member tabs for the same unresolved general checkpoint.
2. Verify only one recovery card is visible at a time.
3. Inspect popup, capture, injected recovery and audio player.
4. Every visible SelfRelay surface must show `[logo] SelfRelay` with the isotipo immediately left of the name.
5. Confirm navy brand headers, cold neutral surfaces, compact controls, restrained blue/cyan usage, keyboard focus and no decorative gradients/glows/pill-heavy UI.

## Record failures precisely

Record Chrome version, operating system, exact scenario/step, number of workset members, number of capture/recovery surfaces, targeting choice, and any extension service-worker/offscreen errors shown by `chrome://extensions`.

Automated CI validates logic/build/package integrity. Physical browser validation must not be reported as completed for a new build until performed in a normal Chrome installation.
