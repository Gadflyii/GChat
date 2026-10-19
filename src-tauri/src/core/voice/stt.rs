//! Speech to text on this computer with whisper.cpp (through whisper-rs), base.en model.
use std::path::Path;

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// `samples` are 16 kHz mono floats. Returns the spoken words as one line of text.
pub fn transcribe(model: &Path, samples: &[f32]) -> Result<String, String> {
    if samples.len() < 8_000 {
        return Err("Nothing was recorded. Hold the microphone button while you speak.".into());
    }
    let path = model.to_str().ok_or("The speech model path is not valid text.")?;
    let context = WhisperContext::new_with_params(path, WhisperContextParameters::default())
        .map_err(|_| "The speech model could not be loaded. Download it again from the voice button.".to_string())?;
    let mut state = context.create_state().map_err(|_| "Speech recognition could not start.".to_string())?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
    state.full(params, samples).map_err(|_| "Speech recognition failed.".to_string())?;
    let mut text = String::new();
    for segment in state.as_iter() {
        text.push_str(&segment.to_string());
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() || text == "[BLANK_AUDIO]" {
        return Err("No speech was heard. Try again closer to the microphone.".into());
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 16 kHz mono PCM16 WAV to floats; finds the `data` chunk.
    fn wav_samples(bytes: &[u8]) -> Vec<f32> {
        let mut at = 12;
        while at + 8 <= bytes.len() {
            let size = u32::from_le_bytes(bytes[at + 4..at + 8].try_into().unwrap()) as usize;
            if &bytes[at..at + 4] == b"data" {
                return bytes[at + 8..(at + 8 + size).min(bytes.len())]
                    .chunks_exact(2)
                    .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
                    .collect();
            }
            at += 8 + size;
        }
        panic!("no data chunk");
    }

    #[test]
    fn too_short_a_recording_is_explained_without_loading_the_model() {
        let error = transcribe(Path::new("/nonexistent"), &[0.0; 100]).unwrap_err();
        assert!(error.contains("Nothing was recorded"));
    }

    /// Needs the real model and a spoken sample, so it runs only on request:
    /// `GCHAT_VOICE_MODEL=<ggml-base.en.bin> GCHAT_VOICE_WAV=<jfk.wav> cargo test ... -- --ignored`.
    #[test]
    #[ignore]
    fn the_real_model_hears_a_spoken_sample() {
        let model = std::env::var("GCHAT_VOICE_MODEL").expect("GCHAT_VOICE_MODEL");
        let wav = std::fs::read(std::env::var("GCHAT_VOICE_WAV").expect("GCHAT_VOICE_WAV")).unwrap();
        let text = transcribe(Path::new(&model), &wav_samples(&wav)).unwrap().to_lowercase();
        assert!(text.contains("country") && text.contains("americans"), "{text}");
    }
}
