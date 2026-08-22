# SelfRelay audio architecture

SelfRelay audio checkpoints stay local-first and context-bound.

## Storage

- Microphone access happens only after the user presses the record control.
- Recorded binary audio is stored in extension IndexedDB, never in `chrome.storage.local`.
- Checkpoint metadata keeps only an `audioRef`, MIME type, duration, transcript and local transcription-engine marker.
- Draft recordings remain in memory until the user saves the checkpoint; cancelling/discarding does not leave a persisted blob.
- Resolving an audio checkpoint deletes its binary asset and clears the audio reference while retaining text/transcript history.
- Existing text-only checkpoints remain valid without migration.

## Transcription

SelfRelay never permits a silent remote fallback.

1. Prefer Chrome on-device speech recognition only when the unprefixed `SpeechRecognition` API exposes `processLocally`, `available()` and `install()`, and on-device Spanish support is reported as available/installable.
2. If that path is unavailable or fails, use the packaged Whisper.cpp WebAssembly fallback with multilingual `tiny-q5_1`.
3. The Whisper runtime and model are bundled into `SelfRelay-Chrome.zip`; runtime transcription makes no network requests and needs no API key, account or token.

The UI describes the operation simply as `Transcribiendo…` and `Procesado en este dispositivo`.

## Distribution

The source repository does not vendor the ~31 MiB Whisper model. Packaging CI downloads the pinned public model/runtime inputs, builds the pinned Whisper.cpp WebAssembly runtime, verifies the model digest, and copies all runtime assets into the extension before creating the downloadable ZIP. The installed extension therefore has no post-install model download dependency.
