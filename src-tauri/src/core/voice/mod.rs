//! Voice for Gbot. Speak a task: the microphone is recorded and turned into text on this computer
//! by whisper.cpp (base.en, downloaded once and checked against a pinned SHA-256). Hear a reply: the
//! operating system's own speech service (Windows SAPI, speech-dispatcher on Linux).
pub mod assets;
pub mod capture;
pub mod commands;
pub mod speak;
pub mod stt;
