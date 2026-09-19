use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const API: &str = "https://sectilelabs.ai/gbench/api/v1";

#[derive(Deserialize)]
struct Challenge {
    id: String,
    payload_hash: String,
    key_id: String,
    expires_at: u64,
}

#[derive(Serialize, Deserialize)]
pub struct Receipt {
    run_id: String,
    delete_token: String,
}

fn signing_message(challenge: &Challenge) -> String {
    format!("gbench-submit-v1\n{}\n{}\n{}\n{}", challenge.id,
        challenge.payload_hash, challenge.expires_at, challenge.key_id)
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn reserved_nickname(name: &str) -> bool {
    name.chars().filter(|c| !matches!(c, ' ' | '.' | '_' | '-')).collect::<String>().to_ascii_lowercase().contains("sectile")
}

async fn response_json(response: reqwest::Response) -> Result<serde_json::Value, String> {
    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|_| "Invalid leaderboard response")?;
    if !status.is_success() {
        return Err(body["error"].as_str().unwrap_or("Leaderboard submission failed").to_owned());
    }
    Ok(body)
}

/// Only the fixed leaderboard destination is reachable; the private key never crosses IPC.
#[tauri::command]
pub async fn submit_benchmark(payload: String, owner_token: String) -> Result<Receipt, String> {
    let seed = option_env!("GBENCH_SIGNING_SEED_HEX").ok_or("Leaderboard signing is not configured in this build")?;
    let key_id = option_env!("GBENCH_SIGNING_KEY_ID").ok_or("Leaderboard signing key ID is missing")?;
    if payload.len() > 32768 { return Err("Benchmark submission is too large".into()); }
    if !is_hex(&owner_token, 64) { return Err("Invalid private submission ownership token".into()); }
    let value: serde_json::Value = serde_json::from_str(&payload).map_err(|_| "Invalid benchmark submission")?;
    if reserved_nickname(value["nickname"].as_str().unwrap_or_default()) {
        return Err("Sectile.labs is reserved for official Sectile Labs results".into());
    }
    if value["schema"] != "gbench-submission-v1" || value["benchmark_id"] != "standard" {
        return Err("Only Standard Benchmark results may be submitted".into());
    }
    let seed: [u8; 32] = hex::decode(seed).map_err(|_| "Invalid leaderboard signing configuration")?
        .try_into().map_err(|_| "Invalid leaderboard signing configuration")?;
    let key = SigningKey::from_bytes(&seed);
    let hash = hex::encode(Sha256::digest(format!("{payload}\n{owner_token}").as_bytes()));
    let client = reqwest::Client::builder().timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let challenge: Challenge = serde_json::from_value(response_json(client.post(format!("{API}/challenges"))
        .json(&serde_json::json!({"payload_hash":hash,"key_id":key_id})).send().await.map_err(|e| e.to_string())?).await?)
        .map_err(|_| "Invalid leaderboard challenge")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| "Check your system clock")?.as_secs();
    if !is_hex(&challenge.id, 64) || challenge.payload_hash != hash || challenge.key_id != key_id
        || challenge.expires_at <= now || challenge.expires_at > now + 600 {
        return Err("Invalid or expired leaderboard challenge; check your system clock".into());
    }
    let signature = hex::encode(key.sign(signing_message(&challenge).as_bytes()).to_bytes());
    let receipt: Receipt = serde_json::from_value(response_json(client.post(format!("{API}/submissions"))
        .json(&serde_json::json!({"payload":payload,"owner_token":owner_token,"challenge_id":challenge.id,"key_id":key_id,"signature":signature}))
        .send().await.map_err(|e| e.to_string())?).await?).map_err(|_| "Invalid leaderboard receipt")?;
    if Some(receipt.run_id.as_str()) != value["run_id"].as_str() || !is_hex(&receipt.delete_token, 64) { return Err("Invalid leaderboard receipt".into()); }
    Ok(receipt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;

    #[test]
    fn public_client_cannot_use_the_official_nickname() {
        for name in ["Sectile.labs", "SECTILE.LABS", "Sectile Labs", "sectile_labs", "sectile-labs", "Sectile Research Laboratories", "Official Sectile", "s.e.c.t.i.l.e"] {
            assert!(reserved_nickname(name));
        }
        assert!(!reserved_nickname("Player One"));
    }

    #[test]
    fn matches_php_sodium_signature_vector() {
        // Shared disposable test seed, not a release key.
        let key = SigningKey::from_bytes(&[7; 32]);
        let challenge = Challenge { id: "a".repeat(64),
            payload_hash: hex::encode(Sha256::digest(format!("{{\"test\":\"signed bytes\"}}\n{}", "d".repeat(64)).as_bytes())),
            key_id: "test".into(), expires_at: 12345 };
        assert_eq!(hex::encode(key.verifying_key().to_bytes()), "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c");
        assert_eq!(hex::encode(key.sign(signing_message(&challenge).as_bytes()).to_bytes()),
            "c8ab010b0385810e65e5c684d29a8353cb346bd7c7422a479c5d91fcfdab6165dd21a1f0cfbb2ad53c485076da5980ce1a5087fd2962e607094b2921dca19a09");
    }

    #[test]
    fn signature_binds_the_result_challenge_expiry_and_key() {
        let key = SigningKey::from_bytes(&[7; 32]);
        let mut challenge = Challenge { id: "a".repeat(64), payload_hash: "b".repeat(64), key_id: "test".into(), expires_at: 12345 };
        let message = signing_message(&challenge);
        let signature = key.sign(message.as_bytes());
        assert!(key.verifying_key().verify(message.as_bytes(), &signature).is_ok());
        challenge.payload_hash = "c".repeat(64);
        assert!(key.verifying_key().verify(signing_message(&challenge).as_bytes(), &signature).is_err());
        assert!(!is_hex(&"A".repeat(64), 64));
    }
}
