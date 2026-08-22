# Manual Chrome validation — SelfRelay extension

This checklist validates real browser behavior that automated tests cannot prove by themselves.

## Load the packaged build

Required artifact: `SelfRelay-Chrome.zip`.

1. Download `SelfRelay-Chrome.zip`.
2. Extract it.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted folder that directly contains `manifest.json`.
7. Confirm the extension is named **SelfRelay** and uses the official icon.

Do not load `artifacts/chrome-extension-unpacked`; that directory is historical reference only. The tester must not install Node.js/npm/TypeScript/Git or run a build.

## Scenario A — single-page compatibility

1. Open a normal `https://` page.
2. Create a SelfRelay context containing only that page, or use the secondary legacy page scope.
3. Close the page while Chrome stays open.
4. Expect exactly one `¿Dónde quedaste?` capture.
5. Save a text checkpoint.
6. Reopen the page.
7. Expect one recovery surface.
8. Resolve it.

Pass: the original `context → exit → checkpoint → return → automatic recovery` loop remains intact.

## Scenario B — explicit multi-tab context

1. Open four related work tabs, for example an issue, documentation, local app and reference page.
2. From SelfRelay choose multiple tabs for one context.
3. Confirm only the selected supported tabs appear in the context list.
4. Close one selected tab while at least one other selected tab remains open.
5. Expect no exit checkpoint yet.
6. Close the remaining selected tabs.
7. Expect one capture for the context, not one capture per tab.
8. Save one general checkpoint.
9. Reopen any one member URL.
10. Expect the same checkpoint to recover.

Pass: one work context can be resumed from any member and only the last-member exit creates its general pending capture.

## Scenario C — checkpoint targeting

With a context containing A, B, C and D:

1. Leave the context and open the capture.
2. Save once with the default target, **todo el contexto**.
3. On another exit, use **Elegir pestañas** and select A, B and D.
4. Verify the subset checkpoint appears when returning through A/B/D but not C.
5. Repeat selecting only one member to validate explicit per-tab targeting.
6. If a member-specific and a general checkpoint are both unresolved, verify the member-specific checkpoint appears first on that member.

Pass: targeting changes eligibility/specificity without creating duplicate copies of one checkpoint.

## Scenario D — missing-tab restoration

1. Create a context with four tabs A/B/C/D.
2. Leave and save a general checkpoint.
3. Return by opening only A.
4. Recovery should offer to open the three missing tabs.
5. Activate that action.
6. Verify B/C/D open in the current work window, A is not duplicated, and already-open tabs elsewhere are not duplicated.
7. If all four are already open, the restoration action should not appear.

Pass: restoration is explicit, safe and opens only missing supported URLs.

## Scenario E — audio exits immediately, transcription is deferred

1. Leave a followed context and record a short Spanish audio checkpoint.
2. Stop recording.
3. Verify the player appears immediately and no transcription UI or processing starts.
4. Save the audio checkpoint.
5. Verify the capture closes without waiting for transcription.
6. Return to the context.
7. Verify audio can be played immediately and no transcription starts automatically.
8. Select **Transcribir audio**.
9. Verify `Transcribiendo…` appears only now and the page remains usable.
10. On success, verify the transcript appears, is editable, and remains present after revisiting the checkpoint.
11. Verify the original audio remains playable.

Pass: Whisper runs only after the explicit recovery action and the saved audio is independently useful.

## Scenario F — transcription retry

1. With an audio checkpoint, request transcription.
2. If transcription cannot complete, verify SelfRelay shows `No se pudo transcribir` and `Intentar otra vez`.
3. Verify the audio is still playable and the checkpoint is still unresolved.
4. Retry.

Pass: failure never destroys or resolves the original audio checkpoint.

## Scenario G — one recovery surface across multiple workset tabs

1. Leave one unresolved general checkpoint for a four-tab context.
2. Open several member tabs together.
3. Verify SelfRelay does not show four simultaneous copies of the same checkpoint.
4. Dismiss/close the owning page and then revisit another member.

Pass: at most one live recovery surface owns a checkpoint at once.

## Scenario H — window close and full Chrome shutdown

1. Put all members of one workset in a dedicated Chrome window while another Chrome window remains open.
2. Close the workset window.
3. Expect one pending capture for the workset.
4. Repeat with members split between two windows: closing only one window must not end the context if members remain in the other.
5. Finally close all Chrome windows so Chrome exits completely.
6. Start Chrome again normally.
7. Expect the durable pending recovery behavior to remain intact and serial.

Pass: worksets reuse the existing hardened window/shutdown journal without duplicate pendings.

## Scenario I — visual system and packaging

1. Inspect popup, capture, recovery and audio player.
2. Confirm the UI is predominantly neutral with restrained blue action color, compact controls, IBM Plex Sans, thin separators and moderate radii.
3. Confirm there are no permanent `Local` badges, eyebrow labels, decorative gradients/glows or old cream/green styling.
4. Disconnect networking after the extension is loaded and verify saved audio playback works. Requesting transcription must not require an API key or external model download.

## Record failures precisely

Record Chrome version, operating system, exact scenario/step, URLs or number of workset members, number of capture/recovery surfaces, and any extension service-worker/offscreen errors shown by `chrome://extensions`.

Automated CI validates logic/build/package integrity. Physical browser validation must not be reported as completed for a new build until performed in a normal Chrome installation.
