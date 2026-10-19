//! Per-bot website rules for the bot's browser tools. "Blocked" sites are never opened; when
//! "allowed" sites are listed the bot may open only those (blocked still wins). An entry matches
//! the site and its subdomains. Nothing is restricted until the person adds a rule.
use serde::{Deserialize, Serialize};

use crate::contract::WorkspaceId;

pub const MAX_ENTRIES: usize = 200;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BotSiteRules {
    pub workspace_id: WorkspaceId,
    #[serde(default)]
    pub allowed: Vec<String>,
    #[serde(default)]
    pub blocked: Vec<String>,
}

/// The host of an http(s) URL (userinfo, port, path and a trailing dot removed, lower case).
pub fn host_of(url: &str) -> Option<String> {
    let rest = url.trim();
    let lower = rest.to_ascii_lowercase();
    let after = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"))?;
    let authority = after.split(['/', '?', '#', '\\']).next()?;
    // Whatever precedes the last @ is credentials, never the host.
    let host_port = authority.rsplit('@').next()?;
    let host = if let Some(inner) = host_port.strip_prefix('[') {
        let end = inner.find(']')?;
        format!("[{}]", &inner[..end])
    } else {
        host_port.split(':').next()?.trim_end_matches('.').to_owned()
    };
    (!host.is_empty()).then_some(host)
}

/// Accepts "example.com", "www.example.com/path", "https://example.com" or "*.example.com".
pub fn normalize_entry(text: &str) -> Option<String> {
    let text = text.trim();
    let candidate = text.trim_start_matches("*.");
    let with_scheme =
        if candidate.contains("://") { candidate.to_owned() } else { format!("https://{candidate}") };
    let host = host_of(&with_scheme)?;
    let valid = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !label.starts_with('-')
            && !label.ends_with('-')
    });
    (valid && host.contains('.') || host == "localhost").then_some(host)
}

fn matches(host: &str, entry: &str) -> bool {
    host == entry || host.strip_suffix(entry).is_some_and(|rest| rest.ends_with('.'))
}

impl BotSiteRules {
    pub fn is_empty(&self) -> bool {
        self.allowed.is_empty() && self.blocked.is_empty()
    }

    /// Normalises entries (dropping blanks and repeats). Err names the first entry that is not a website.
    pub fn cleaned(mut self) -> Result<Self, String> {
        for list in [&mut self.allowed, &mut self.blocked] {
            let mut seen = Vec::new();
            for entry in list.iter().filter(|e| !e.trim().is_empty()) {
                let host = normalize_entry(entry)
                    .ok_or_else(|| format!("\"{}\" is not a website address.", entry.trim()))?;
                if !seen.contains(&host) {
                    seen.push(host);
                }
            }
            if seen.len() > MAX_ENTRIES {
                return Err(format!("Use at most {MAX_ENTRIES} websites in each list."));
            }
            *list = seen;
        }
        Ok(self)
    }

    /// Ok when the bot may open `url`; otherwise a plain explanation it can act on.
    pub fn check(&self, url: &str) -> Result<(), String> {
        if self.is_empty() {
            return Ok(());
        }
        let trimmed = url.trim();
        if trimmed.eq_ignore_ascii_case("about:blank") {
            return Ok(());
        }
        let Some(host) = host_of(trimmed) else {
            return Err("This kind of address cannot be opened while website rules are set for this bot.".into());
        };
        if self.blocked.iter().any(|entry| matches(&host, entry)) {
            return Err(format!("{host} is a blocked website for this bot. Do not open it; choose another way or ask the person."));
        }
        if !self.allowed.is_empty() && !self.allowed.iter().any(|entry| matches(&host, entry)) {
            return Err(format!(
                "{host} is not one of the websites this bot may open. Allowed websites: {}.",
                self.allowed.join(", ")
            ));
        }
        Ok(())
    }
}

/// The address of the page a get_browser_state result describes, read only from the tab's own
/// fields (never from links or text on the page).
pub fn page_url(result: &serde_json::Value) -> Option<String> {
    let content = result.get("structuredContent").unwrap_or(result);
    for holder in [Some(content), content.get("tab"), content.get("page"), content.get("snapshot")]
        .into_iter()
        .flatten()
    {
        for key in ["url", "tab_url", "page_url", "current_url"] {
            if let Some(url) = holder.get(key).and_then(serde_json::Value::as_str) {
                return Some(url.to_owned());
            }
        }
    }
    None
}

pub fn page_tab(result: &serde_json::Value) -> Option<String> {
    let content = result.get("structuredContent").unwrap_or(result);
    content.get("tab_id").and_then(serde_json::Value::as_str).map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(allowed: &[&str], blocked: &[&str]) -> BotSiteRules {
        BotSiteRules {
            workspace_id: WorkspaceId::new(),
            allowed: allowed.iter().map(|s| s.to_string()).collect(),
            blocked: blocked.iter().map(|s| s.to_string()).collect(),
        }
        .cleaned()
        .unwrap()
    }

    #[test]
    fn hosts_ignore_credentials_ports_paths_and_case() {
        assert_eq!(host_of("https://Example.COM:8443/a?b#c").as_deref(), Some("example.com"));
        assert_eq!(host_of("https://good.com@evil.com/").as_deref(), Some("evil.com"));
        assert_eq!(host_of("http://evil.com\\@good.com/").as_deref(), Some("evil.com"));
        assert_eq!(host_of("https://example.com./").as_deref(), Some("example.com"));
        assert_eq!(host_of("http://[::1]:80/x").as_deref(), Some("[::1]"));
        assert_eq!(host_of("file:///etc/passwd"), None);
        assert_eq!(host_of("javascript:alert(1)"), None);
    }

    #[test]
    fn entries_are_normalised_and_bad_ones_named() {
        let cleaned = rules(&["https://www.Example.com/docs", "*.news.org", "example.com", " "], &["Bad.Site"]);
        assert_eq!(cleaned.allowed, ["www.example.com", "news.org", "example.com"]);
        assert_eq!(cleaned.blocked, ["bad.site"]);
        let error = BotSiteRules { workspace_id: WorkspaceId::new(), allowed: vec!["not a site".into()], blocked: vec![] }
            .cleaned()
            .unwrap_err();
        assert!(error.contains("not a site"));
    }

    #[test]
    fn the_page_address_comes_from_the_tab_not_from_links_on_the_page() {
        let state = serde_json::json!({"structuredContent": {"tab_id": "t1", "url": "https://bank.com/x",
            "outline": [{"role": "link", "name": "Go", "url": "https://ok.com"}]}});
        assert_eq!(page_url(&state).as_deref(), Some("https://bank.com/x"));
        assert_eq!(page_tab(&state).as_deref(), Some("t1"));
        let only_links = serde_json::json!({"structuredContent": {"outline": [{"url": "https://bank.com"}]}});
        assert_eq!(page_url(&only_links), None);
    }

    #[test]
    fn nothing_is_restricted_until_a_rule_exists() {
        let none = rules(&[], &[]);
        assert!(none.check("https://anything.example/").is_ok());
        assert!(none.check("file:///etc/passwd").is_ok());
    }

    #[test]
    fn blocked_sites_and_their_subdomains_are_refused_and_look_alikes_are_not() {
        let r = rules(&[], &["bank.com"]);
        assert!(r.check("https://bank.com/login").unwrap_err().contains("blocked"));
        assert!(r.check("https://www.bank.com").is_err());
        assert!(r.check("https://bank.com.evil.net").is_ok());
        assert!(r.check("https://notbank.com").is_ok());
        assert!(r.check("https://good.com@bank.com/").is_err());
    }

    #[test]
    fn an_allowed_list_limits_the_bot_to_those_sites_and_blocks_still_win() {
        let r = rules(&["docs.example.com", "news.org"], &["private.news.org"]);
        assert!(r.check("https://docs.example.com/page").is_ok());
        assert!(r.check("https://a.news.org").is_ok());
        let refused = r.check("https://other.com").unwrap_err();
        assert!(refused.contains("Allowed websites: docs.example.com, news.org"));
        assert!(r.check("https://private.news.org").unwrap_err().contains("blocked"));
        assert!(r.check("about:blank").is_ok());
        assert!(r.check("file:///home/gbot/secret").is_err());
        assert!(r.check("https://example.com").is_err());
    }
}
