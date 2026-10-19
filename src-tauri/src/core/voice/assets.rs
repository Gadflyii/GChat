//! The one model voice input needs, downloaded on first use from a pinned URL and verified.
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

pub struct Asset {
    pub name: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// whisper.cpp base.en (MIT), at a pinned commit of ggerganov/whisper.cpp on Hugging Face.
pub const SPEECH_MODEL: Asset = Asset {
    name: "ggml-base.en.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin",
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    bytes: 147_964_211,
};

pub fn model_path(data_root: &Path) -> PathBuf {
    data_root.join("voice").join(SPEECH_MODEL.name)
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// True only when the file has the pinned size and SHA-256.
pub fn verified(path: &Path, asset: &Asset) -> bool {
    use std::io::Read;
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if meta.len() != asset.bytes {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buffer[..n]),
            Err(_) => return false,
        }
    }
    hex(&hasher.finalize()) == asset.sha256
}

/// Downloads `asset` into `destination` (via a .part file) and keeps it only if the hash matches.
pub async fn download(
    asset: &Asset,
    url: &str,
    destination: &Path,
    mut progress: impl FnMut(u64, u64) + Send,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not prepare the voice folder: {e}"))?;
    }
    let part = destination.with_extension("part");
    let result = async {
        let mut response = reqwest::Client::new()
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Could not reach the download server: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("The download server answered {}", response.status()));
        }
        let mut file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| format!("Could not write the download: {e}"))?;
        let mut hasher = Sha256::new();
        let mut done = 0u64;
        while let Some(chunk) = response.chunk().await.map_err(|e| format!("The download was interrupted: {e}"))? {
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|e| format!("Could not write the download: {e}"))?;
            done += chunk.len() as u64;
            progress(done, asset.bytes);
        }
        file.flush().await.map_err(|e| format!("Could not write the download: {e}"))?;
        if done != asset.bytes || hex(&hasher.finalize()) != asset.sha256 {
            return Err("The downloaded speech model did not match its expected checksum and was discarded.".into());
        }
        tokio::fs::rename(&part, destination)
            .await
            .map_err(|e| format!("Could not save the download: {e}"))
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_pinned_file_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.bin");
        let asset = Asset { name: "m.bin", url: "", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", bytes: 3 };
        assert!(!verified(&path, &asset));
        std::fs::write(&path, b"abc").unwrap();
        assert!(verified(&path, &asset));
        std::fs::write(&path, b"abd").unwrap();
        assert!(!verified(&path, &asset));
        std::fs::write(&path, b"abcd").unwrap();
        assert!(!verified(&path, &asset));
    }

    #[tokio::test]
    async fn a_download_with_the_wrong_checksum_is_discarded() {
        let dir = tempfile::tempdir().unwrap();
        let (url, server) = serve(b"not the model".to_vec()).await;
        let asset = Asset { name: "m.bin", url: "", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", bytes: 13 };
        let target = dir.path().join("voice/m.bin");
        let error = download(&asset, &url, &target, |_, _| {}).await.unwrap_err();
        assert!(error.contains("checksum"), "{error}");
        assert!(!target.exists() && !target.with_extension("part").exists());
        server.abort();
        // The right bytes are kept and progress reaches the total.
        let (url, server) = serve(b"abc".to_vec()).await;
        let asset = Asset { bytes: 3, ..asset };
        let mut last = 0;
        download(&asset, &url, &target, |done, _| last = done).await.unwrap();
        assert_eq!(last, 3);
        assert!(verified(&target, &asset));
        server.abort();
    }

    async fn serve(body: Vec<u8>) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/m.bin", listener.local_addr().unwrap());
        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let body = body.clone();
                tokio::spawn(async move {
                    let mut request = [0u8; 1024];
                    let _ = socket.read(&mut request).await;
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = socket.write_all(head.as_bytes()).await;
                    let _ = socket.write_all(&body).await;
                });
            }
        });
        (url, handle)
    }
}
