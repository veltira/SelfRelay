# Preserved extension behavior reference

This document records the behavior reconstructed from `artifacts/chrome-extension-unpacked/`. The artifact remains unchanged and is the parity oracle until the maintainable TypeScript source is validated.

## Storage

- `chrome.storage.local`
  - `checkpoint:contexts`
  - `checkpoint:checkpoints`
  - `checkpoint:pendingCaptures`
- `chrome.storage.session`
  - `checkpoint:tabSnapshots`

The source intentionally keeps these keys so an existing unpacked installation can continue reading its local data when the rebuilt extension is loaded with the same extension identity/environment.

## Follow scopes

- `tab`: follows the current tab identity while it exists; navigation updates the context URL/title.
- `url`: follows the normalized exact HTTP(S) URL. Hashes and trailing path slashes are ignored.
- `site`: follows the HTTP(S) origin.

When several contexts match, specificity is `tab → url → site`, then most recently updated.

## Exit flow

A snapshot is retained only for an explicitly followed context. `tabs.onRemoved` consumes that snapshot and creates a pending capture. A normal tab close attempts to open `checkpoint.html` as a popup. A full-window close does not force Chrome to reopen; the pending capture remains in local storage.

## Capture

The capture page can discard the pending capture or save a text checkpoint. Text is trimmed, NUL characters are removed, and content is capped at 12,000 characters. Saving consumes the pending capture.

## Return flow

A content script on HTTP(S) pages requests the latest unresolved checkpoint for the matching context. When present, it renders a shadow-DOM recovery card without requiring the browser-action popup. The user can dismiss the card for the current page view or resolve the checkpoint permanently.

## Startup fallback

On Chrome startup, the service worker refreshes tab snapshots and attempts to surface the oldest pending capture in the checkpoint popup.

## History

`GET_CONTEXT_HISTORY` returns all checkpoints for a context sorted newest-first. The preserved artifact exposes this service-worker capability even though it does not yet have a dedicated history surface.
