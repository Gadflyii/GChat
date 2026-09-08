//! TLS with an explicit certificate fingerprint obtained from the host pairing display.
use rustls::{Certificate, PrivateKey, ServerName};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, SystemTime},
};

/// Read-only address recovery: discovery proposes destinations, the pinned
/// certificate and snapshot identity authenticate them. Never retries mutations.
pub async fn host_snapshot_at(
    origin: &str,
    fingerprint: &str,
    token: &str,
    expected: uuid::Uuid,
) -> Result<serde_json::Value, String> {
    let mut url = reqwest::Url::parse(origin).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("discovered endpoint must be an HTTPS origin".into());
    }
    url.set_path("/host/v1/snapshot");
    let response = pinned_client(fingerprint)?
        .get(url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("host returned {}", response.status()));
    }
    let snapshot: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let parsed: crate::engine_registry::HostSnapshot =
        serde_json::from_value(snapshot.clone()).map_err(|e| e.to_string())?;
    if parsed.host_id != expected
        || parsed.protocol_version != crate::engine_registry::HOST_PROTOCOL_VERSION
    {
        return Err("endpoint identity or protocol does not match paired host".into());
    }
    Ok(snapshot)
}

#[derive(Serialize, Deserialize)]
pub struct HostCertificate {
    pub certificate_der: Vec<u8>,
    pub private_key_der: Vec<u8>,
}

impl HostCertificate {
    pub fn generate() -> Result<Self, String> {
        let cert = rcgen::generate_simple_self_signed(vec!["ginfer-host.local".into()])
            .map_err(|e| e.to_string())?;
        Ok(Self {
            certificate_der: cert.serialize_der().map_err(|e| e.to_string())?,
            private_key_der: cert.serialize_private_key_der(),
        })
    }
    pub fn fingerprint(&self) -> String {
        hex::encode(Sha256::digest(&self.certificate_der))
    }
    pub fn acceptor(&self) -> Result<tokio_rustls::TlsAcceptor, String> {
        let config = rustls::ServerConfig::builder()
            .with_safe_defaults()
            .with_no_client_auth()
            .with_single_cert(
                vec![Certificate(self.certificate_der.clone())],
                PrivateKey(self.private_key_der.clone()),
            )
            .map_err(|e| e.to_string())?;
        Ok(tokio_rustls::TlsAcceptor::from(Arc::new(config)))
    }
}

struct PinnedCertificate([u8; 32]);
impl rustls::client::ServerCertVerifier for PinnedCertificate {
    fn verify_server_cert(
        &self,
        end_entity: &Certificate,
        _intermediates: &[Certificate],
        _server_name: &ServerName,
        _scts: &mut dyn Iterator<Item = &[u8]>,
        _ocsp: &[u8],
        _now: SystemTime,
    ) -> Result<rustls::client::ServerCertVerified, rustls::Error> {
        if Sha256::digest(&end_entity.0).as_slice() != self.0 {
            return Err(rustls::Error::General(
                "paired host certificate has changed".into(),
            ));
        }
        // Identity is this exact out-of-band certificate, rather than WebPKI DNS.
        // Default rustls TLS signature verification still proves key possession.
        Ok(rustls::client::ServerCertVerified::assertion())
    }
}

pub fn pinned_client(fingerprint: &str) -> Result<reqwest::Client, String> {
    pinned_client_with_headers(fingerprint, reqwest::header::HeaderMap::new())
}

pub fn pinned_client_with_headers(
    fingerprint: &str,
    headers: reqwest::header::HeaderMap,
) -> Result<reqwest::Client, String> {
    let bytes =
        hex::decode(fingerprint).map_err(|_| "certificate fingerprint must be hexadecimal")?;
    let digest: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "certificate fingerprint must contain 32 bytes")?;
    let config = rustls::ClientConfig::builder()
        .with_safe_defaults()
        .with_custom_certificate_verifier(Arc::new(PinnedCertificate(digest)))
        .with_no_client_auth();
    reqwest::Client::builder()
        .default_headers(headers)
        .use_preconfigured_tls(config)
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())
}
