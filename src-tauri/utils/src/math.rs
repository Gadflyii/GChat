const MCP_BASE_RESTART_DELAY_MS: u64 = 1000;
const MCP_MAX_RESTART_DELAY_MS: u64 = 30000;
const MCP_BACKOFF_MULTIPLIER: f64 = 2.0;

/// Return capped millisecond backoff for a one-based restart attempt.
pub fn calculate_exponential_backoff_delay(attempt: u32) -> u64 {
    use std::cmp;

    let exponential_delay =
        (MCP_BASE_RESTART_DELAY_MS as f64) * MCP_BACKOFF_MULTIPLIER.powi((attempt - 1) as i32);

    let capped_delay = cmp::min(exponential_delay as u64, MCP_MAX_RESTART_DELAY_MS);

    let jitter_range = (capped_delay as f64 * 0.25) as u64;
    let jitter = if jitter_range > 0 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Deterministic jitter keyed by attempt.
        let mut hasher = DefaultHasher::new();
        attempt.hash(&mut hasher);
        let hash = hasher.finish();

        // The upper jitter bound is exclusive.
        (hash % (jitter_range * 2)) as i64 - jitter_range as i64
    } else {
        0
    };

    // Bound jittered delay to 100 ms through the configured cap.
    ((capped_delay as i64 + jitter) as u64).clamp(100, MCP_MAX_RESTART_DELAY_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_exponential_backoff_delay_basic() {
        let delay1 = calculate_exponential_backoff_delay(1);
        let delay2 = calculate_exponential_backoff_delay(2);
        let delay3 = calculate_exponential_backoff_delay(3);

        // First attempt should be around base delay (1000ms) ± jitter
        assert!(delay1 >= 100 && delay1 <= 2000);

        // Second attempt should be roughly double
        assert!(delay2 >= 1000 && delay2 <= 4000);

        // Third attempt should be roughly quadruple
        assert!(delay3 >= 2000 && delay3 <= 6000);

        // Generally increasing pattern
        assert!(delay1 < delay3);
    }

    #[test]
    fn test_calculate_exponential_backoff_delay_max_cap() {
        // Very high attempt numbers should be capped at MAX_RESTART_DELAY_MS
        let high_attempt_delay = calculate_exponential_backoff_delay(100);
        assert!(high_attempt_delay <= MCP_MAX_RESTART_DELAY_MS);
        assert!(high_attempt_delay >= 100); // Minimum delay
    }

    #[test]
    fn test_calculate_exponential_backoff_delay_minimum() {
        // Even with jitter, should never go below minimum
        for attempt in 1..=10 {
            let delay = calculate_exponential_backoff_delay(attempt);
            assert!(
                delay >= 100,
                "Delay {} for attempt {} is below minimum",
                delay,
                attempt
            );
        }
    }

    #[test]
    fn test_calculate_exponential_backoff_delay_deterministic() {
        // Same attempt number should produce same delay (deterministic jitter)
        let delay1_a = calculate_exponential_backoff_delay(5);
        let delay1_b = calculate_exponential_backoff_delay(5);
        assert_eq!(delay1_a, delay1_b);

        let delay2_a = calculate_exponential_backoff_delay(10);
        let delay2_b = calculate_exponential_backoff_delay(10);
        assert_eq!(delay2_a, delay2_b);
    }

    #[test]
    fn test_calculate_exponential_backoff_delay_progression() {
        // Test the general progression pattern
        let mut delays = Vec::new();
        for attempt in 1..=8 {
            delays.push(calculate_exponential_backoff_delay(attempt));
        }

        // Should not exceed maximum
        for delay in &delays {
            assert!(*delay <= MCP_MAX_RESTART_DELAY_MS);
        }

        // Earlier attempts should generally be smaller than later ones
        // (allowing some variance due to jitter)
        assert!(delays[0] < delays[6]); // 1st vs 7th attempt
        assert!(delays[1] < delays[7]); // 2nd vs 8th attempt
    }

    #[test]
    fn test_constants() {
        // Verify our constants are reasonable
        assert_eq!(MCP_BASE_RESTART_DELAY_MS, 1000);
        assert_eq!(MCP_MAX_RESTART_DELAY_MS, 30000);
        assert_eq!(MCP_BACKOFF_MULTIPLIER, 2.0);

        // Max should be greater than base
        assert!(MCP_MAX_RESTART_DELAY_MS > MCP_BASE_RESTART_DELAY_MS);
    }
}
