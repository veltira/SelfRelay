# SelfRelay Desktop architecture

## Milestone D0

D0 establishes the Windows-native foundation for SelfRelay Desktop. It deliberately stops before checkpoint capture and recovery. The milestone proves the three risky primitives needed by later phases: an installable Windows application, a resident tray lifecycle, and real top-level work-window observation.

## Why Tauri 2 instead of Electron

SelfRelay needs a small resident utility whose lifecycle and Windows integration are native concerns. Tauri 2 keeps the long-lived core in Rust while using the system WebView2 runtime for the compact React surface. That gives the observer, tray, SQLite ownership and process lifecycle one native core rather than placing Win32 orchestration behind a JavaScript runtime. Electron remains a fallback only if a reproducible Tauri blocker appears; none was found in D0.

## Frontend / core boundary

The React/Vite frontend is a presentation surface only. It requests a normalized detected-context snapshot through Tauri commands and listens for `desktop://windows-changed` / `desktop://tracking-changed` events. It does not enumerate processes, poll Win32, own persistence, or derive durable identities.

The Rust core owns:

- application lifecycle and single-instance enforcement;
- system tray and hide-on-close behavior;
- Win32 window observation;
- classification and adapters;
- the ephemeral HWND registry;
- local SQLite initialization.

No backend or Internet service is involved.

## Win32 observer

On Windows, startup performs one `EnumWindows` reconciliation to establish the current set of candidate top-level windows. A dedicated hook thread then registers `SetWinEventHook` out-of-context hooks for creation/destruction, show/hide, title/name changes and foreground changes. That thread runs a Windows message loop as required by WinEvent delivery.

The WinEvent callback performs no window inspection or adapter parsing. It attempts only to enqueue a compact raw event into a bounded channel. A separate lifecycle-engine thread consumes those events, inspects only the affected HWND, classifies it, runs the matching adapter and updates the in-memory registry. Explicit reconciliation is available for resume/recovery from missed events; it is not an aggressive polling loop.

The ephemeral registry is keyed by HWND because HWND is useful for the lifetime of an open window. Each record includes HWND, PID, executable path/identity, raw title, visibility, adapter id, normalized context and minimal observation timestamps. HWND and PID are never part of a durable context identity.

## Window classification

Classification is intentionally conservative rather than claiming universal knowledge of every Windows shell surface. Pure testable rules reject child windows, invisible windows, common menu/tooltip classes, windows without executable/title identity, SelfRelay itself, Chrome and Edge. Chrome and Edge are excluded because browser work remains the Extension's domain in this milestone.

Some vendor-specific splash/tool windows may still transiently look like normal top-level windows. That limitation is documented instead of adding process-wide surveillance or brittle global heuristics.

## Application adapters and stable identity

Adapters map native window metadata to two future tracking scopes:

- `application`: the executable/application as a whole;
- `work context/member`: a stable unit inside that application where a trustworthy derivation exists.

D0 implements VS Code, Word, Excel and generic adapters.

VS Code derives workspace identity from the workspace segment rather than the complete title. Therefore `main.ts — SelfRelay — Visual Studio Code` and `README.md — SelfRelay — Visual Studio Code` both resolve to `vscode:selfrelay`. Word and Excel derive document/workbook identities from their normalized document titles. The generic fallback combines executable identity and normalized title and is explicitly marked lower-stability.

These identities are local strings designed for lifecycle correlation, not global document identifiers. D0 does not create multi-application work contexts.

## SQLite and journal

SQLite is embedded through `rusqlite` and lives in the per-user application data directory. Schema v1 is migration-controlled and idempotent. It provides:

- `schema_migrations`;
- minimal `settings`;
- `tracking_rules` with application/context scope ready for D1 selection;
- `active_context_journal` ready for durable lifecycle state.

The open-window registry is not persisted as history. The journal schema contains stable application/context IDs and serialized lifecycle payload, never HWND/PID identity. D0 creates the journal infrastructure but does not write checkpoint content to it during normal observation.

## Tray and process lifecycle

The tray is owned by the Rust application and remains alive when the main window is hidden. Closing the main window intercepts `CloseRequested`, prevents process shutdown and hides the window. The tray can reopen the surface, pause/resume observation, and explicitly exit. `Guardar checkpoint ahora` is present but disabled and labeled as a D1 capability.

The Tauri single-instance plugin is registered before application setup. A second launch focuses/shows the existing main window rather than starting another observer.

## Installer

Tauri's NSIS bundler targets a per-user install (`currentUser`) and embeds the WebView2 bootstrapper. CI normalizes the produced installer to `SelfRelay-Setup.exe`. End users do not need Node, Rust or npm. D0 does not claim that an unsigned executable bypasses Windows SmartScreen.

## Future capture/recovery surfaces

D1/D2 can connect the registry and durable journal to a lifecycle such as: context disappears → ask where the user stopped → persist text against the stable context → detect the context again → show recovery → mark resumed. The current frontend/core boundary allows capture and recovery windows to be added without moving Win32 ownership into React.

Audio, Whisper, multi-app work contexts and Extension↔Desktop integration are explicitly outside D0.

## Privacy boundary

D0 observes only the minimum top-level window metadata required for classification and a future selector. It does not capture screenshots, screen pixels, keystrokes, clipboard content, document content, audio, browser history, or a durable history of all processes/windows. Nothing is sent to the Internet.
