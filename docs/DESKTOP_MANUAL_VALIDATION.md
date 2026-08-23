# SelfRelay Desktop D0 manual validation

This checklist distinguishes physical Windows behavior from automated unit/build coverage. Simulated Rust tests do not prove Win32 event delivery.

## Install and launch

- [ ] Download the GitHub Actions artifact `SelfRelay-Windows-Installer` and confirm it contains `SelfRelay-Setup.exe`.
- [ ] Run `SelfRelay-Setup.exe` as a normal user on Windows 10 or 11.
- [ ] Confirm installation succeeds without an elevation/admin requirement.
- [ ] Launch SelfRelay and confirm the logo plus `SelfRelay` identity render correctly with the compact product UI.
- [ ] Confirm the status is `Activo`.

## Resident lifecycle

- [ ] Confirm a SelfRelay tray icon is present.
- [ ] Close the main SelfRelay window with the standard window close control.
- [ ] Confirm the main window disappears but the SelfRelay process and tray icon remain alive.
- [ ] Use `Abrir SelfRelay` from the tray and confirm the same process reopens/focuses its main window.
- [ ] Launch SelfRelay again while the first instance is alive and confirm a second independent observer/process is not left running.
- [ ] Confirm `Guardar checkpoint ahora — disponible en D1` is visibly disabled.
- [ ] Select `Pausar seguimiento`; confirm the UI reports `Pausado` and newly opened/renamed windows are not incorporated while paused.
- [ ] Select `Reanudar seguimiento`; confirm the registry reconciles and current eligible windows appear again.
- [ ] Select `Salir`; confirm SelfRelay, its observer and tray terminate cleanly.

## Native observer

- [ ] With SelfRelay active, open VS Code and confirm `Visual Studio Code` appears without manually refreshing SelfRelay.
- [ ] Open a VS Code workspace named `SelfRelay`; confirm the derived context displays `SelfRelay`.
- [ ] Switch the active file from `main.ts` to `README.md`; confirm the displayed context remains `SelfRelay` rather than becoming a new durable identity.
- [ ] Close the VS Code top-level window; confirm it disappears from the detected list.
- [ ] Open Word with `Proposal.docx`; confirm Word and `Proposal.docx` are derived.
- [ ] Open Excel with `Metrics.xlsx`; confirm Excel and `Metrics.xlsx` are derived.
- [ ] Open another normal desktop application and confirm it appears through the generic adapter where it has useful title/executable identity.
- [ ] Open Chrome and Edge; confirm neither appears in Desktop detection.
- [ ] Confirm SelfRelay's own window never appears in its detected-work list.

## Privacy inspection

- [ ] Confirm no screenshot/screen-capture permission or surface is used.
- [ ] Confirm no keyboard, clipboard, microphone/audio or browser-history capture occurs.
- [ ] Confirm no Internet request is required for observer operation.
- [ ] Inspect the local database and confirm there is no durable table containing the full open-window registry or HWND/PID as a persistent context identity.

## Known D0 boundaries

Checkpoint capture, recovery prompts, Whisper/audio, multi-application work contexts and Extension↔Desktop integration are not expected in this checklist.
