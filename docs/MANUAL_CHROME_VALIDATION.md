# Manual Chrome validation — shutdown/recovery milestone

This checklist validates the real browser behavior that automated tests cannot prove by themselves.

## Build artifact and load

Physical validation must use the compiled package produced by SelfRelay packaging, not a developer build performed by the tester.

Required artifact:

`SelfRelay-Chrome.zip`

The package workflow builds the extension, runs the automated merge gate, validates the ZIP layout, and publishes the ZIP as a GitHub Actions artifact. Stable version tags will publish the same ZIP as a GitHub Release asset.

Load it in Chrome:

1. Download `SelfRelay-Chrome.zip`.
2. Extract it to a normal folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked**.
6. Choose the extracted folder that directly contains `manifest.json`.
7. Confirm the extension is named **SelfRelay** and the official SelfRelay icon appears in the extension list and toolbar.

Do not load `artifacts/chrome-extension-unpacked`; that directory is only the preserved behavior reference.

The tester must not install Node.js, npm, TypeScript, Git, dependencies, or run a build manually.

## Scenario A — normal tab close

1. Open a normal `https://` page.
2. Open SelfRelay and choose **Seguir esta URL**.
3. Close only that tab while Chrome stays open.
4. Expect exactly one SelfRelay checkpoint capture window.
5. Save a short checkpoint.
6. Reopen the same URL.
7. Expect the saved checkpoint to appear automatically in the page.
8. Mark it resolved.

Pass condition: behavior matches `context → exit → checkpoint → return → automatic recovery` and no duplicate capture window appears.

## Scenario B — whole window, several tabs, same context

1. Open a dedicated Chrome window.
2. Open two or more pages on the same site.
3. Follow that site with **Seguir todo este sitio**.
4. Leave at least one other Chrome window open.
5. Close the dedicated window using its window close control.
6. Expect only one pending checkpoint for that followed context and at most one visible capture surface.

Pass condition: multiple tab removals from the same window/context do not create duplicate pending captures.

## Scenario C — whole window, different contexts

1. Open a dedicated Chrome window with two different pages.
2. Follow each as a distinct exact-URL context.
3. Leave another Chrome window open.
4. Close the dedicated window.
5. Expect one visible capture first.
6. Save or discard it.
7. Expect the same capture window to advance to the next legitimate pending item rather than opening multiple windows.

Pass condition: distinct contexts are preserved and processed serially.

## Scenario D — full Chrome shutdown and next startup

1. Follow at least one normal page.
2. Close **all Chrome windows** so Chrome exits completely.
3. Do not expect SelfRelay to reopen Chrome or force a capture window during shutdown.
4. Start Chrome again normally.
5. Expect one pending checkpoint capture to appear automatically.
6. If several legitimate pending contexts existed, save or discard the first and verify the same capture surface advances to the next one in deterministic order.

Pass condition: the pending interruption survives a complete Chrome exit and only one capture surface is visible at a time.

## Scenario E — branding and small icon

1. Inspect SelfRelay in `chrome://extensions`.
2. Pin the extension to the toolbar.
3. Confirm the official symbol remains recognizable at toolbar size.
4. Confirm popup/capture surfaces say **SelfRelay** while the functional term **checkpoint** remains used for the interruption note itself.

## Record failures precisely

If a scenario fails, record:

- Chrome version;
- operating system;
- exact scenario and step;
- whether Chrome was still running in another window;
- number of followed tabs/contexts;
- number of capture windows shown;
- whether the extension service worker reports an error in `chrome://extensions`.

Automated CI validates logic/build/package integrity. This document is the required physical Chrome validation and must not be reported as completed until performed in a normal Chrome installation.
