pub(crate) fn is_context_limit_error(status: u16, body: &str) -> bool {
    if !matches!(status, 400 | 413 | 500 | 503) {
        return false;
    }
    let body = body.to_lowercase();
    if body.contains("the request exceeds the available context size") {
        return true;
    }
    if body.contains("max_kv_size") || body.contains("max-kv-size") || body.contains("max kv size")
    {
        return true;
    }
    if body.contains("kv cache")
        && (body.contains("exceed") || body.contains("overflow") || body.contains("too"))
    {
        return true;
    }
    body.contains("context")
        && (body.contains("size")
            || body.contains("length")
            || body.contains("limit")
            || body.contains("exceed")
            || body.contains("overflow")
            || body.contains("too long")
            || body.contains("too large"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_only_context_failures_on_supported_statuses() {
        assert!(is_context_limit_error(
            400,
            r#"{"error":"the request exceeds the available context size"}"#
        ));
        assert!(is_context_limit_error(500, "MAX_KV_SIZE is too small"));
        assert!(!is_context_limit_error(429, "context limit exceeded"));
        assert!(!is_context_limit_error(500, "internal server error"));
    }
}
