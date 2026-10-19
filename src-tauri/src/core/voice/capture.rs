//! Microphone capture. The stream lives on its own thread (audio streams are not always Send).
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};

use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat,
};

pub const TARGET_RATE: u32 = 16_000;
/// A task request is a sentence or two; this bounds memory if the user forgets to stop.
pub const MAX_SECONDS: u32 = 120;

pub struct Recorder {
    stop: Arc<AtomicBool>,
    samples: Arc<Mutex<Vec<f32>>>,
    rate: u32,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Average interleaved channels into one.
pub fn downmix(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks_exact(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32).collect()
}

/// Linear resampling to the rate whisper expects.
pub fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let out_len = (input.len() as u64 * to as u64 / from as u64) as usize;
    (0..out_len)
        .map(|i| {
            let position = i as f64 * from as f64 / to as f64;
            let index = position as usize;
            let next = (index + 1).min(input.len() - 1);
            let fraction = (position - index as f64) as f32;
            input[index] * (1.0 - fraction) + input[next] * fraction
        })
        .collect()
}

impl Recorder {
    pub fn start() -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
        let (stop2, samples2) = (stop.clone(), samples.clone());
        let thread = std::thread::spawn(move || {
            let build = || -> Result<(cpal::Stream, u32), String> {
                let host = cpal::default_host();
                let device = host
                    .default_input_device()
                    .ok_or("No microphone was found. Connect one and try again.")?;
                let config = device
                    .default_input_config()
                    .map_err(|_| "The microphone could not be opened.".to_string())?;
                let rate = config.sample_rate();
                let channels = config.channels() as usize;
                let format = config.sample_format();
                let limit = (rate as usize) * MAX_SECONDS as usize;
                let sink = samples2.clone();
                let push = move |mono: Vec<f32>| {
                    if let Ok(mut buffer) = sink.lock() {
                        if buffer.len() < limit {
                            buffer.extend(mono);
                        }
                    }
                };
                let error = |_| {};
                let stream = match format {
                    SampleFormat::F32 => device.build_input_stream(
                        config.into(),
                        move |data: &[f32], _: &_| push(downmix(data, channels)),
                        error,
                        None,
                    ),
                    SampleFormat::I16 => device.build_input_stream(
                        config.into(),
                        move |data: &[i16], _: &_| {
                            let floats: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                            push(downmix(&floats, channels))
                        },
                        error,
                        None,
                    ),
                    other => return Err(format!("The microphone format {other} is not supported.")),
                }
                .map_err(|_| "The microphone could not be opened.".to_string())?;
                stream.play().map_err(|_| "The microphone could not be started.".to_string())?;
                Ok((stream, rate))
            };
            match build() {
                Ok((stream, rate)) => {
                    let _ = ready_tx.send(Ok(rate));
                    while !stop2.load(Ordering::Acquire) {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    drop(stream);
                }
                Err(message) => {
                    let _ = ready_tx.send(Err(message));
                }
            }
        });
        match ready_rx.recv_timeout(std::time::Duration::from_secs(10)) {
            Ok(Ok(rate)) => Ok(Self { stop, samples, rate, thread: Some(thread) }),
            Ok(Err(message)) => Err(message),
            Err(_) => {
                stop.store(true, Ordering::Release);
                Err("The microphone did not respond.".into())
            }
        }
    }

    /// Ends the recording and returns 16 kHz mono samples.
    pub fn finish(mut self) -> Vec<f32> {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let recorded = self.samples.lock().map(|b| b.clone()).unwrap_or_default();
        resample(&recorded, self.rate, TARGET_RATE)
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stereo_is_averaged_and_resampling_keeps_duration() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25, 0.75], 1), vec![0.25, 0.75]);
        let tone: Vec<f32> = (0..48_000).map(|i| (i as f32 / 48.0).sin()).collect();
        let out = resample(&tone, 48_000, TARGET_RATE);
        assert_eq!(out.len(), 16_000);
        assert!((out[100] - tone[300]).abs() < 0.01);
        assert_eq!(resample(&tone, 16_000, TARGET_RATE), tone);
        assert!(resample(&[], 44_100, TARGET_RATE).is_empty());
    }
}
