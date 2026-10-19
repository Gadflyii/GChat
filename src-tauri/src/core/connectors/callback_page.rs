//! The page the browser shows after a Microsoft or Google sign-in, in GChat's own look: its name and
//! lockup, colours and Geist type, in plain words. One page serves both providers and has three outcomes.
//! It is self-contained (images and font are inlined) so it needs no request to any other site, and it
//! never contains anything the provider sent back.
use std::sync::OnceLock;

use base64::Engine;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    /// The account was connected and saved.
    SignedIn,
    /// The person or the provider declined, so nothing was connected.
    Declined,
    /// Something went wrong after sign-in (exchange or saving).
    Failed,
}

const LOCKUP: &[u8] = include_bytes!("../../../../web-app/public/images/gchat-lockup.png");
const LOCKUP_REVERSED: &[u8] = include_bytes!("../../../../web-app/public/images/gchat-lockup-reversed.png");
const GEIST: &[u8] = include_bytes!("../../../../web-app/public/fonts/geist/Geist-Variable.woff2");

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn words(outcome: Outcome) -> (&'static str, &'static str, &'static str, &'static str) {
    // (window title, heading, body, mark colour)
    match outcome {
        Outcome::SignedIn => (
            "You're signed in - GChat",
            "You're signed in.",
            "You can close this tab and return to GChat.",
            "#3dd3c8",
        ),
        Outcome::Declined => (
            "Sign-in wasn't approved - GChat",
            "Sign-in wasn't approved.",
            "Nothing was connected. You can close this tab and return to GChat to try again.",
            "#e5e042",
        ),
        Outcome::Failed => (
            "Sign-in didn't finish - GChat",
            "Sign-in didn't finish.",
            "Return to GChat to see what happened and try again. You can close this tab.",
            "#e5e042",
        ),
    }
}

pub fn html(outcome: Outcome) -> String {
    static ASSETS: OnceLock<(String, String, String)> = OnceLock::new();
    let (light, dark, font) = ASSETS.get_or_init(|| (encode(LOCKUP), encode(LOCKUP_REVERSED), encode(GEIST)));
    let (title, heading, body, mark) = words(outcome);
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
@font-face{{font-family:Geist;src:url(data:font/woff2;base64,{font}) format("woff2");font-weight:100 900;font-display:swap}}
:root{{color-scheme:light dark;--paper:#fafbfc;--ink:#0a0c0f;--muted:#5a6068;--rule:#e3e5e8;--teal:#0b6b6b;--panel:#ffffff;
font-family:Geist,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
@media(prefers-color-scheme:dark){{:root{{--paper:#08090b;--ink:#f3f5f7;--muted:#9aa0a8;--rule:#23272e;--teal:#3dd3c8;--panel:#101216}}}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink)}}
main{{box-sizing:border-box;width:min(30rem,calc(100% - 2rem));padding:2.5rem 2rem;border:1px solid var(--rule);border-radius:1.25rem;background:var(--panel);text-align:center}}
.lockup{{width:14rem;max-width:80%;height:auto}}.dark{{display:none}}
@media(prefers-color-scheme:dark){{.light{{display:none}}.dark{{display:inline}}}}
.mark{{width:.75rem;height:.75rem;border-radius:50%;background:{mark};margin:1.75rem auto 1rem}}
h1{{margin:0 0 .75rem;font-size:1.6rem;font-weight:600;letter-spacing:-.01em}}
p{{margin:0;line-height:1.6;color:var(--muted);font-size:1.05rem}}
</style></head><body><main>
<img class="lockup light" alt="GChat" src="data:image/png;base64,{light}">
<img class="lockup dark" alt="GChat" src="data:image/png;base64,{dark}">
<div class="mark" aria-hidden="true"></div>
<h1>{heading}</h1><p>{body}</p>
</main></body></html>"#
    )
}

/// The whole HTTP response for the browser, with the same strict headers on every outcome.
pub fn response(outcome: Outcome) -> Vec<u8> {
    let body = html(outcome);
    let mut reply = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; frame-ancestors 'none'\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    reply.extend_from_slice(body.as_bytes());
    reply
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_three_outcomes_use_gchats_name_lockup_font_and_plain_words() {
        let signed_in = html(Outcome::SignedIn);
        assert!(signed_in.contains("<title>You're signed in - GChat</title>"));
        assert!(signed_in.contains("<h1>You're signed in.</h1>"));
        assert!(signed_in.contains("You can close this tab and return to GChat."));
        assert!(signed_in.contains("font-family:Geist"));
        assert!(signed_in.matches("data:image/png;base64,").count() == 2, "light and dark lockups");
        assert!(signed_in.contains("#3dd3c8") && signed_in.contains("#0b6b6b"), "brand teal");
        let declined = html(Outcome::Declined);
        assert!(declined.contains("Sign-in wasn't approved.") && declined.contains("Nothing was connected."));
        let failed = html(Outcome::Failed);
        assert!(failed.contains("Sign-in didn't finish.") && failed.contains("Return to GChat to see what happened and try again."));
        for page in [&signed_in, &declined, &failed] {
            assert!(!page.contains("<script") && !page.contains("http://") && !page.contains("https://"));
            assert!(!page.contains("Microsoft") && !page.contains("Google"), "one page for both providers");
        }
    }

    #[test]
    fn the_response_keeps_the_strict_headers_and_only_allows_inline_images_and_fonts() {
        let text = String::from_utf8(response(Outcome::Failed)).unwrap();
        assert!(text.starts_with("HTTP/1.1 200 OK"));
        for header in ["Cache-Control: no-store", "Referrer-Policy: no-referrer", "X-Content-Type-Options: nosniff", "frame-ancestors 'none'"] {
            assert!(text.contains(header), "{header}");
        }
        assert!(text.contains("default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"));
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        let length: usize = head.lines().find_map(|l| l.strip_prefix("Content-Length: ")).unwrap().parse().unwrap();
        assert_eq!(length, body.len());
    }
}
