# Third-party notices

Components added for Gbot voice. Each is used under its own license; nothing here is bundled with a
download of a GPL-licensed program.

| Component | Use | License |
| --- | --- | --- |
| whisper.cpp (ggerganov) | Speech to text engine, built into GChat through whisper-rs | MIT |
| whisper-rs 0.16.0 / whisper-rs-sys | Rust bindings to whisper.cpp | Unlicense |
| Whisper `base.en` model, ggml format (OpenAI Whisper weights, converted in ggerganov/whisper.cpp) | Speech recognition model, downloaded on first use, SHA-256 `a03779c8…c6d002` | MIT |
| cpal 0.18.2 | Microphone capture | Apache-2.0 |
| libspeechd (speech-dispatcher client library) | Reading replies aloud on Linux; loaded at run time with dlopen only, never statically linked or bundled | LGPL-2.1-or-later |
| Windows SAPI (System.Speech) | Reading replies aloud on Windows; part of the operating system | Operating system component |
