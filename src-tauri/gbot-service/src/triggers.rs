//! What a bot's event schedules look at: plain, testable helpers. A watcher lists names
//! (and sizes) in a folder; only names it has not seen, whose size stopped changing since
//! the last look, start a task.

use std::collections::BTreeMap;

/// Names remembered per schedule; the oldest are forgotten first.
pub const MAX_SEEN: usize = 2000;
/// Tasks one event schedule may have waiting or running at once.
pub const MAX_OUTSTANDING: usize = 5;
/// Seconds between looks at a folder.
pub const POLL_SECONDS: u64 = 30;
/// How much of a message's text a task is given.
pub const MAIL_BODY_CHARS: usize = 2000;

/// One entry in a watched folder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub bytes: u64,
}

/// Output of `find <dir> -maxdepth 1 -type f -printf '%f\t%s\0'`.
pub fn parse_find(output: &[u8]) -> Vec<Entry> {
    output
        .split(|byte| *byte == 0)
        .filter_map(|record| {
            let text = String::from_utf8_lossy(record);
            let (name, size) = text.rsplit_once('\t')?;
            if name.is_empty() || name.starts_with('.') {
                return None;
            }
            Some(Entry {
                name: name.to_owned(),
                bytes: size.trim().parse().ok()?,
            })
        })
        .collect()
}

/// Entries that are new and finished arriving: not in `seen`, non-empty, and the same size
/// as at the previous look (`before`). Returns the entries to start tasks for, oldest name
/// first, at most `room` of them.
pub fn arrivals(
    entries: &[Entry],
    seen: &[String],
    before: &BTreeMap<String, u64>,
    room: usize,
) -> Vec<Entry> {
    let mut ready: Vec<Entry> = entries
        .iter()
        .filter(|entry| {
            entry.bytes > 0
                && !seen.iter().any(|name| name == &entry.name)
                && before.get(&entry.name) == Some(&entry.bytes)
        })
        .cloned()
        .collect();
    ready.sort_by(|a, b| a.name.cmp(&b.name));
    ready.truncate(room);
    ready
}

pub fn remember(seen: &mut Vec<String>, names: impl IntoIterator<Item = String>) {
    for name in names {
        if !seen.contains(&name) {
            seen.push(name);
        }
    }
    if seen.len() > MAX_SEEN {
        let extra = seen.len() - MAX_SEEN;
        seen.drain(..extra);
    }
}

pub fn file_context(folder: &str, entry: &Entry) -> String {
    let folder = folder.trim_end_matches('/');
    format!(
        "A new file arrived on this computer: {} ({} bytes), in the folder {folder}. Its full path is {folder}/{}.",
        entry.name, entry.bytes, entry.name
    )
}

/// The first line of a header, unfolded, from raw message text.
fn header(text: &str, wanted: &str) -> Option<String> {
    let head = text.split("\r\n\r\n").next()?.split("\n\n").next()?;
    let mut value: Option<String> = None;
    for line in head.lines() {
        if let Some(current) = value.as_mut() {
            if line.starts_with([' ', '\t']) {
                current.push(' ');
                current.push_str(line.trim());
                continue;
            }
            break;
        }
        let (name, rest) = line.split_once(':')?;
        if name.eq_ignore_ascii_case(wanted) {
            value = Some(rest.trim().to_owned());
        }
    }
    value.filter(|value| !value.is_empty())
}

/// What the task is told about a message in a mail folder. Only the headers a person would
/// look at and the start of the plain text are included.
pub fn mail_context(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let from = header(&text, "From").unwrap_or_else(|| "an unknown sender".into());
    let subject = header(&text, "Subject").unwrap_or_else(|| "(no subject)".into());
    let body = text
        .split_once("\r\n\r\n")
        .or_else(|| text.split_once("\n\n"))
        .map_or("", |(_, body)| body);
    let body: String = body
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(MAIL_BODY_CHARS)
        .collect();
    format!(
        "A new email arrived. From: {from}. Subject: {subject}.\nThe start of the message:\n{}",
        body.trim()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_output_lists_files_and_skips_hidden_ones() {
        let entries = parse_find(b"a.txt\t12\0.hidden\t5\0b c.csv\t0\0broken\0");
        assert_eq!(
            entries,
            vec![
                Entry { name: "a.txt".into(), bytes: 12 },
                Entry { name: "b c.csv".into(), bytes: 0 },
            ]
        );
    }

    #[test]
    fn only_new_finished_files_start_tasks_and_room_is_respected() {
        let entries: Vec<Entry> = [("a", 5), ("b", 7), ("c", 0), ("d", 9), ("e", 3)]
            .into_iter()
            .map(|(name, bytes)| Entry { name: name.into(), bytes })
            .collect();
        let before: BTreeMap<String, u64> = [("a", 5), ("b", 6), ("c", 0), ("d", 9), ("e", 3)]
            .into_iter()
            .map(|(name, bytes)| (name.to_owned(), bytes))
            .collect();
        let seen = vec!["a".to_owned()];
        // a is seen, b is still growing, c is empty: d and e are ready.
        let ready = arrivals(&entries, &seen, &before, 5);
        assert_eq!(ready.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["d", "e"]);
        assert_eq!(arrivals(&entries, &seen, &before, 1).len(), 1);
        assert!(arrivals(&entries, &seen, &before, 0).is_empty());
    }

    #[test]
    fn remembered_names_are_bounded_oldest_first() {
        let mut seen = Vec::new();
        remember(&mut seen, (0..MAX_SEEN + 5).map(|n| n.to_string()));
        assert_eq!(seen.len(), MAX_SEEN);
        assert_eq!(seen[0], "5");
        remember(&mut seen, ["5".to_owned()]);
        assert_eq!(seen.len(), MAX_SEEN);
    }

    #[test]
    fn mail_context_names_sender_subject_and_the_start_of_the_text() {
        let raw = b"From: Ada <ada@example.com>\r\nSubject: Quarterly\r\n numbers\r\nDate: Mon, 19 Oct 2026 09:00:00 +0000\r\n\r\nHello team,\r\nthe figures are attached.\r\n";
        let context = mail_context(raw);
        assert!(context.contains("From: Ada <ada@example.com>"));
        assert!(context.contains("Subject: Quarterly numbers."));
        assert!(context.contains("the figures are attached."));
        assert!(mail_context(b"\n\nbody only").contains("(no subject)"));
        let long = format!("Subject: x\n\n{}", "y".repeat(10_000));
        assert!(mail_context(long.as_bytes()).len() < MAIL_BODY_CHARS + 200);
    }

    #[test]
    fn file_context_gives_the_full_path() {
        let text = file_context("/home/gbot/Inbox/", &Entry { name: "invoice.pdf".into(), bytes: 2048 });
        assert!(text.contains("/home/gbot/Inbox/invoice.pdf"));
        assert!(text.contains("2048 bytes"));
    }
}
