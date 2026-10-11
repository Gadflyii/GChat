//! Delegated Microsoft Graph v1.0 operations. Authentication and caller policy
//! belong to AccountsState and the shared capability executor.
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header::HeaderMap, Method, Url};
use serde_json::{json, Map, Value};
use tokio_util::sync::CancellationToken;

use super::{AccountsState, ConnectorTool, Provider};

const GRAPH: &str = "https://graph.microsoft.com/v1.0";

fn string() -> Value {
    json!({"type":"string", "minLength":1})
}

fn choice(values: &[&str]) -> Value {
    json!({"type":"string", "enum":values})
}

fn array(items: Value) -> Value {
    json!({"type":"array", "items":items})
}

fn nonempty_array(items: Value) -> Value {
    json!({"type":"array", "items":items, "minItems":1})
}

fn object(fields: &[(&str, Value)], required: &[&str]) -> Value {
    let properties: Map<String, Value> = fields
        .iter()
        .map(|(name, schema)| ((*name).into(), schema.clone()))
        .collect();
    json!({"type":"object", "properties":properties, "required":required, "additionalProperties":false})
}

fn changes(mut schema: Value) -> Value {
    schema["minProperties"] = json!(1);
    schema
}

fn body() -> Value {
    object(
        &[
            ("contentType", choice(&["Text", "HTML"])),
            ("content", json!({"type":"string"})),
        ],
        &["contentType", "content"],
    )
}

fn time() -> Value {
    object(
        &[("dateTime", string()), ("timeZone", string())],
        &["dateTime", "timeZone"],
    )
}

fn email() -> Value {
    object(&[("address", string()), ("name", string())], &["address"])
}

fn recipients() -> Value {
    array(object(&[("emailAddress", email())], &["emailAddress"]))
}

fn message(required: &[&str]) -> Value {
    object(
        &[
            ("subject", string()),
            ("body", body()),
            ("toRecipients", recipients()),
            ("ccRecipients", recipients()),
            ("bccRecipients", recipients()),
            ("importance", choice(&["low", "normal", "high"])),
        ],
        required,
    )
}

fn event(required: &[&str]) -> Value {
    object(
        &[
            ("subject", string()),
            ("body", body()),
            ("start", time()),
            ("end", time()),
            (
                "location",
                object(&[("displayName", string())], &["displayName"]),
            ),
            (
                "attendees",
                array(object(
                    &[
                        ("emailAddress", email()),
                        ("type", choice(&["required", "optional", "resource"])),
                    ],
                    &["emailAddress", "type"],
                )),
            ),
            ("isAllDay", json!({"type":"boolean"})),
            ("isOnlineMeeting", json!({"type":"boolean"})),
            (
                "onlineMeetingProvider",
                choice(&["teamsForBusiness", "skypeForBusiness", "skypeForConsumer"]),
            ),
            (
                "showAs",
                choice(&[
                    "free",
                    "tentative",
                    "busy",
                    "oof",
                    "workingElsewhere",
                    "unknown",
                ]),
            ),
            ("transactionId", string()),
        ],
        required,
    )
}

fn contact(required: &[&str]) -> Value {
    object(
        &[
            ("givenName", string()),
            ("surname", string()),
            ("displayName", string()),
            ("emailAddresses", array(email())),
            ("businessPhones", array(string())),
            ("homePhones", array(string())),
            ("mobilePhone", string()),
            ("companyName", string()),
            ("jobTitle", string()),
            ("personalNotes", json!({"type":"string"})),
        ],
        required,
    )
}

fn task(required: &[&str]) -> Value {
    object(
        &[
            ("title", string()),
            ("body", body()),
            ("dueDateTime", time()),
            ("reminderDateTime", time()),
            ("isReminderOn", json!({"type":"boolean"})),
            ("importance", choice(&["low", "normal", "high"])),
            (
                "status",
                choice(&[
                    "notStarted",
                    "inProgress",
                    "completed",
                    "waitingOnOthers",
                    "deferred",
                ]),
            ),
            ("categories", array(string())),
        ],
        required,
    )
}

fn tool(
    name: &'static str,
    description: &'static str,
    service: &'static str,
    write: bool,
    fields: &[(&str, Value)],
    required: &[&str],
) -> ConnectorTool {
    let mut fields = fields.to_vec();
    fields.push(("account_id", json!({"type":"string", "description":"Connected Microsoft account ID. Omit or use an empty string for the selected Microsoft account."})));
    ConnectorTool {
        name,
        description,
        service,
        write,
        input_schema: object(&fields, required),
    }
}

fn list(
    name: &'static str,
    description: &'static str,
    service: &'static str,
    fields: &[(&str, Value)],
    required: &[&str],
) -> ConnectorTool {
    let mut fields = fields.to_vec();
    fields.push(("next_link", json!({"type":"string", "minLength":1, "description":"Unmodified @odata.nextLink returned by this same operation and resource. Account ID must remain the same."})));
    tool(name, description, service, false, &fields, required)
}

/// Tools expose provider IDs, never an arbitrary authenticated URL or verb.
pub fn tools() -> Vec<ConnectorTool> {
    let page = (
        "page_size",
        json!({"type":"integer", "minimum":1, "maximum":50}),
    );
    let drive_item = [("drive_id", string()), ("item_id", string())];
    let channel = [("team_id", string()), ("channel_id", string())];
    let todo_task = [("list_id", string()), ("task_id", string())];
    let worksheet = [("item_id", string()), ("worksheet_id", string())];
    let mut result = vec![
        list("microsoft.outlook.search", "Search Outlook mail with KQL; query is quoted by the adapter. Scope: Mail.Read.", "outlook", &[("query", string()), ("folder_id", string()), page.clone()], &["query"]),
        list("microsoft.outlook.list_messages", "List messages in a mail folder or the mailbox. Scope: Mail.Read.", "outlook", &[("folder_id", string()), page.clone()], &[]),
        list("microsoft.outlook.list_folders", "List root mail folders, or child folders of folder_id. Scope: Mail.Read.", "outlook", &[("folder_id", string()), page.clone()], &[]),
        tool("microsoft.outlook.read", "Read an Outlook message including its body. Scope: Mail.Read.", "outlook", false, &[("message_id", string())], &["message_id"]),
        tool("microsoft.outlook.draft", "Create an unsent draft. Scope: Mail.ReadWrite.", "outlook", true, &[("message", message(&["subject", "body", "toRecipients"]))], &["message"]),
        tool("microsoft.outlook.update_draft", "Update an unsent draft's content or recipients. Scope: Mail.ReadWrite.", "outlook", true, &[("message_id", string()), ("message", changes(message(&[])))], &["message_id", "message"]),
        tool("microsoft.outlook.send", "Send a new message now; Graph acceptance is not proof of delivery. Scope: Mail.Send.", "outlook", true, &[("message", message(&["subject", "body", "toRecipients"])), ("save_to_sent_items", json!({"type":"boolean"}))], &["message"]),
        tool("microsoft.outlook.send_draft", "Send an existing draft now. Scope: Mail.Send.", "outlook", true, &[("message_id", string())], &["message_id"]),
        tool("microsoft.outlook.reply", "Send a reply to the sender now. Scope: Mail.Send.", "outlook", true, &[("message_id", string()), ("comment", string())], &["message_id", "comment"]),
        tool("microsoft.outlook.forward", "Forward an existing message now. Scope: Mail.Send.", "outlook", true, &[("message_id", string()), ("comment", json!({"type":"string"})), ("to_recipients", recipients())], &["message_id", "to_recipients"]),
        tool("microsoft.outlook.move", "Move mail to an exact destination folder ID. Scope: Mail.ReadWrite.", "outlook", true, &[("message_id", string()), ("destination_folder_id", string())], &["message_id", "destination_folder_id"]),
        tool("microsoft.outlook.trash", "Move mail to Deleted Items; recoverable subject to mailbox retention. Scope: Mail.ReadWrite.", "outlook", true, &[("message_id", string())], &["message_id"]),
        tool("microsoft.outlook.delete", "Delete an Outlook message using Graph DELETE; retention may still apply. Scope: Mail.ReadWrite.", "outlook", true, &[("message_id", string())], &["message_id"]),
        list("microsoft.outlook.list_attachments", "List message attachment metadata. Scope: Mail.Read.", "outlook", &[("message_id", string())], &["message_id"]),
        tool("microsoft.outlook.read_attachment", "Read attachment metadata and contentBytes for a fileAttachment. Scope: Mail.Read.", "outlook", false, &[("message_id", string()), ("attachment_id", string())], &["message_id", "attachment_id"]),
        tool("microsoft.outlook.attach_file", "Add a base64 file attachment smaller than 3 MB to a draft. Scope: Mail.ReadWrite.", "outlook", true, &[("message_id", string()), ("name", string()), ("content_base64", string()), ("content_type", string())], &["message_id", "name", "content_base64", "content_type"]),
        list("microsoft.calendar.list", "List calendars. Scope: Calendars.Read.", "calendar", &[page.clone()], &[]),
        tool("microsoft.calendar.create_calendar", "Create an additional calendar. Scope: Calendars.ReadWrite.", "calendar", true, &[("name", string())], &["name"]),
        tool("microsoft.calendar.rename_calendar", "Rename an exact calendar. Scope: Calendars.ReadWrite.", "calendar", true, &[("calendar_id", string()), ("name", string())], &["calendar_id", "name"]),
        tool("microsoft.calendar.delete_calendar", "Delete a non-default calendar and its events. Scope: Calendars.ReadWrite.", "calendar", true, &[("calendar_id", string())], &["calendar_id"]),
        list("microsoft.calendar.events", "List calendar event masters and single events, not expanded recurrences. Scope: Calendars.Read.", "calendar", &[("calendar_id", string()), page.clone()], &[]),
        list("microsoft.calendar.view", "List calendar events and expanded recurrences within start/end ISO8601 timestamps. Scope: Calendars.Read.", "calendar", &[("calendar_id", string()), ("start", string()), ("end", string()), page.clone()], &["start", "end"]),
        tool("microsoft.calendar.read", "Read an event by ID. Scope: Calendars.Read.", "calendar", false, &[("event_id", string())], &["event_id"]),
        tool("microsoft.calendar.create", "Create an event and invite specified attendees; Teams online events require a supported work/school calendar. Scope: Calendars.ReadWrite.", "calendar", true, &[("calendar_id", string()), ("event", event(&["subject", "start", "end"]))], &["event"]),
        tool("microsoft.calendar.update", "Update specified event fields; attendee changes can send invitations. Scope: Calendars.ReadWrite.", "calendar", true, &[("event_id", string()), ("event", changes(event(&[])))], &["event_id", "event"]),
        tool("microsoft.calendar.delete", "Delete an event; deleting an organizer meeting sends cancellation. Scope: Calendars.ReadWrite.", "calendar", true, &[("event_id", string())], &["event_id"]),
        tool("microsoft.calendar.free_busy", "Read free/busy for up to 20 SMTP addresses. Work/school accounts only. Scope: Calendars.ReadBasic (Calendars.Read also grants access).", "calendar", false, &[("schedules", json!({"type":"array", "items":string(), "minItems":1, "maxItems":20})), ("start", time()), ("end", time()), ("interval_minutes", json!({"type":"integer", "minimum":5, "maximum":1440}))], &["schedules", "start", "end"]),
        list("microsoft.contacts.list", "List Outlook contacts. Scope: Contacts.Read.", "contacts", &[page.clone()], &[]),
        tool("microsoft.contacts.read", "Read an Outlook contact. Scope: Contacts.Read.", "contacts", false, &[("contact_id", string())], &["contact_id"]),
        tool("microsoft.contacts.create", "Create an Outlook contact. Scope: Contacts.ReadWrite.", "contacts", true, &[("contact", contact(&["givenName"]))], &["contact"]),
        tool("microsoft.contacts.update", "Update specified Outlook contact fields. Scope: Contacts.ReadWrite.", "contacts", true, &[("contact_id", string()), ("contact", changes(contact(&[])))], &["contact_id", "contact"]),
        tool("microsoft.contacts.delete", "Delete an Outlook contact. Scope: Contacts.ReadWrite.", "contacts", true, &[("contact_id", string())], &["contact_id"]),
        list("microsoft.onedrive.drives", "List the user's drives. Scope: Files.Read.", "onedrive", &[], &[]),
        tool("microsoft.onedrive.my_drive", "Get the user's default drive and its ID. Scope: Files.Read.", "onedrive", false, &[], &[]),
        list("microsoft.onedrive.children", "List children of an exact folder; item_id=root selects the drive root. Works with SharePoint drive IDs. Scope: Files.Read.", "onedrive", &[drive_item[0].clone(), drive_item[1].clone(), page.clone()], &["drive_id", "item_id"]),
        list("microsoft.onedrive.search", "Search file names/content within an exact drive. Scope: Files.Read.", "onedrive", &[("drive_id", string()), ("query", string()), page.clone()], &["drive_id", "query"]),
        tool("microsoft.onedrive.read", "Get an exact drive item's metadata. Scope: Files.Read.", "onedrive", false, &drive_item, &["drive_id", "item_id"]),
        tool("microsoft.onedrive.download", "Download an exact file as base64. No authenticated download URL is exposed. Scope: Files.Read.", "onedrive", false, &drive_item, &["drive_id", "item_id"]),
        tool("microsoft.onedrive.upload", "Upload a new base64 file into an exact folder (up to Graph's 250 MB simple-upload limit); existing same-name files are replaced. Scope: Files.ReadWrite.", "onedrive", true, &[("drive_id", string()), ("parent_id", string()), ("name", string()), ("content_base64", json!({"type":"string"}))], &["drive_id", "parent_id", "name", "content_base64"]),
        tool("microsoft.onedrive.replace", "Replace the bytes of an exact file using base64 (up to 250 MB). Scope: Files.ReadWrite.", "onedrive", true, &[drive_item[0].clone(), drive_item[1].clone(), ("content_base64", json!({"type":"string"}))], &["drive_id", "item_id", "content_base64"]),
        tool("microsoft.onedrive.create_folder", "Create a folder under an exact parent; a name conflict fails instead of renaming silently. Scope: Files.ReadWrite.", "onedrive", true, &[("drive_id", string()), ("parent_id", string()), ("name", string())], &["drive_id", "parent_id", "name"]),
        tool("microsoft.onedrive.move", "Move or rename an item within the same drive. Scope: Files.ReadWrite.", "onedrive", true, &[drive_item[0].clone(), drive_item[1].clone(), ("parent_id", string()), ("name", string())], &["drive_id", "item_id", "parent_id"]),
        tool("microsoft.onedrive.delete", "Delete an item to its drive recycle bin. Scope: Files.ReadWrite.", "onedrive", true, &drive_item, &["drive_id", "item_id"]),
        tool("microsoft.onedrive.share_link", "Create a view/edit link. Organization scope requires work/school; anonymous links can be disabled by tenant policy. Scope: Files.ReadWrite.", "onedrive", true, &[drive_item[0].clone(), drive_item[1].clone(), ("type", choice(&["view", "edit"])), ("scope", choice(&["anonymous", "organization"]))], &["drive_id", "item_id", "type", "scope"]),
        tool("microsoft.onedrive.invite", "Grant named recipients read/write access; send_invitation controls notification. Scope: Files.ReadWrite.", "onedrive", true, &[drive_item[0].clone(), drive_item[1].clone(), ("emails", nonempty_array(string())), ("role", choice(&["read", "write"])), ("send_invitation", json!({"type":"boolean"}))], &["drive_id", "item_id", "emails", "role", "send_invitation"]),
        list("microsoft.sharepoint.search_sites", "Search SharePoint sites by keywords. Work/school accounts only. Scope: Sites.Read.All.", "sharepoint", &[("query", string())], &["query"]),
        tool("microsoft.sharepoint.read_site", "Get a SharePoint site by its Graph site ID. Work/school accounts only. Scope: Sites.Read.All.", "sharepoint", false, &[("site_id", string())], &["site_id"]),
        list("microsoft.sharepoint.drives", "List a site's document-library drives; use returned IDs with OneDrive tools. Work/school accounts only. Scope: Sites.Read.All.", "sharepoint", &[("site_id", string())], &["site_id"]),
        list("microsoft.teams.joined", "List teams of which the user is a direct member (not every shared-channel host). Work/school only. Scope: Team.ReadBasic.All.", "teams", &[], &[]),
        list("microsoft.teams.channels", "List channels in an exact team. Work/school only. Scope: Channel.ReadBasic.All.", "teams", &[("team_id", string())], &["team_id"]),
        list("microsoft.teams.channel_messages", "List top-level channel messages, without replies. Work/school only. Scope: ChannelMessage.Read.All.", "teams", &[channel[0].clone(), channel[1].clone(), page.clone()], &["team_id", "channel_id"]),
        list("microsoft.teams.channel_replies", "List replies to an exact channel message. Work/school only. Scope: ChannelMessage.Read.All.", "teams", &[channel[0].clone(), channel[1].clone(), ("message_id", string())], &["team_id", "channel_id", "message_id"]),
        tool("microsoft.teams.post_channel", "Post a user-visible channel message. Work/school only. Scope: ChannelMessage.Send.", "teams", true, &[channel[0].clone(), channel[1].clone(), ("content", string()), ("content_type", choice(&["text", "html"]))], &["team_id", "channel_id", "content", "content_type"]),
        tool("microsoft.teams.reply_channel", "Reply to an exact channel message. Work/school only. Scope: ChannelMessage.Send.", "teams", true, &[channel[0].clone(), channel[1].clone(), ("message_id", string()), ("content", string()), ("content_type", choice(&["text", "html"]))], &["team_id", "channel_id", "message_id", "content", "content_type"]),
        list("microsoft.teams.chats", "List the user's chats. Work/school only. Scope: Chat.ReadBasic.", "teams", &[page.clone()], &[]),
        list("microsoft.teams.chat_messages", "List messages in an exact chat. Work/school only. Scope: Chat.Read.", "teams", &[("chat_id", string()), page.clone()], &["chat_id"]),
        tool("microsoft.teams.read_chat_message", "Read an exact chat message. Work/school only. Scope: Chat.Read.", "teams", false, &[("chat_id", string()), ("message_id", string())], &["chat_id", "message_id"]),
        tool("microsoft.teams.post_chat", "Send a user-visible message in an exact chat. Work/school only. Scope: ChatMessage.Send.", "teams", true, &[("chat_id", string()), ("content", string()), ("content_type", choice(&["text", "html"]))], &["chat_id", "content", "content_type"]),
        tool("microsoft.teams.create_meeting", "Create a standalone Teams meeting, not a calendar event. Use calendar.create for invitations. Work/school only. Scope: OnlineMeetings.ReadWrite.", "teams", true, &[("subject", string()), ("start", string()), ("end", string())], &["subject", "start", "end"]),
        tool("microsoft.teams.read_meeting", "Read a standalone online meeting by ID. Work/school only. Scope: OnlineMeetings.Read.", "teams", false, &[("meeting_id", string())], &["meeting_id"]),
        tool("microsoft.teams.update_meeting", "Update a standalone online meeting's subject or time. Work/school only. Scope: OnlineMeetings.ReadWrite.", "teams", true, &[("meeting_id", string()), ("meeting", changes(object(&[("subject", string()), ("startDateTime", string()), ("endDateTime", string())], &[])))], &["meeting_id", "meeting"]),
        tool("microsoft.teams.delete_meeting", "Delete a standalone online meeting by ID. Work/school only. Scope: OnlineMeetings.ReadWrite.", "teams", true, &[("meeting_id", string())], &["meeting_id"]),
        list("microsoft.todo.lists", "List Microsoft To Do task lists. Scope: Tasks.Read.", "todo", &[], &[]),
        tool("microsoft.todo.create_list", "Create a named To Do task list. Scope: Tasks.ReadWrite.", "todo", true, &[("name", string())], &["name"]),
        tool("microsoft.todo.rename_list", "Rename a user-created To Do list; built-in lists cannot be renamed. Scope: Tasks.ReadWrite.", "todo", true, &[("list_id", string()), ("name", string())], &["list_id", "name"]),
        tool("microsoft.todo.delete_list", "Delete a user-created To Do list and its tasks; built-in lists cannot be deleted. Scope: Tasks.ReadWrite.", "todo", true, &[("list_id", string())], &["list_id"]),
        list("microsoft.todo.tasks", "List tasks in an exact To Do list. Scope: Tasks.Read.", "todo", &[("list_id", string()), page.clone()], &["list_id"]),
        tool("microsoft.todo.read_task", "Read an exact To Do task. Scope: Tasks.Read.", "todo", false, &todo_task, &["list_id", "task_id"]),
        tool("microsoft.todo.create_task", "Create a To Do task. Scope: Tasks.ReadWrite.", "todo", true, &[("list_id", string()), ("task", task(&["title"]))], &["list_id", "task"]),
        tool("microsoft.todo.update_task", "Update task fields, including status=completed. Scope: Tasks.ReadWrite.", "todo", true, &[todo_task[0].clone(), todo_task[1].clone(), ("task", changes(task(&[])))], &["list_id", "task_id", "task"]),
        tool("microsoft.todo.delete_task", "Delete an exact To Do task. Scope: Tasks.ReadWrite.", "todo", true, &todo_task, &["list_id", "task_id"]),
        list("microsoft.onenote.notebooks", "List OneNote notebooks. Scope: Notes.Read.", "onenote", &[], &[]),
        tool("microsoft.onenote.create_notebook", "Create a OneNote notebook. Scope: Notes.Create (Notes.ReadWrite also grants access).", "onenote", true, &[("name", string())], &["name"]),
        tool("microsoft.onenote.create_section", "Create a section in an exact notebook. Scope: Notes.Create (Notes.ReadWrite also grants access).", "onenote", true, &[("notebook_id", string()), ("name", string())], &["notebook_id", "name"]),
        list("microsoft.onenote.sections", "List direct sections of a notebook (not nested section groups). Scope: Notes.Read.", "onenote", &[("notebook_id", string())], &["notebook_id"]),
        list("microsoft.onenote.pages", "List pages in a section. Scope: Notes.Read.", "onenote", &[("section_id", string())], &["section_id"]),
        tool("microsoft.onenote.read_page", "Read a OneNote page's HTML content. Scope: Notes.Read.", "onenote", false, &[("page_id", string())], &["page_id"]),
        tool("microsoft.onenote.create_page", "Create a page from complete HTML in an exact section. Scope: Notes.Create (Notes.ReadWrite also grants access).", "onenote", true, &[("section_id", string()), ("html", string())], &["section_id", "html"]),
        tool("microsoft.onenote.delete_page", "Delete a OneNote page. Scope: Notes.ReadWrite.", "onenote", true, &[("page_id", string())], &["page_id"]),
        list("microsoft.excel.worksheets", "List worksheets in an Excel workbook in the user's drive. Scope: Files.ReadWrite, including for reads; provider workbook/account limitations apply.", "excel", &[("item_id", string())], &["item_id"]),
        tool("microsoft.excel.add_worksheet", "Add a named worksheet to an online workbook. Scope: Files.ReadWrite.", "excel", true, &[("item_id", string()), ("name", string())], &["item_id", "name"]),
        tool("microsoft.excel.read_range", "Read values/formulas of an A1 range in an exact worksheet. Scope: Files.ReadWrite, including for reads.", "excel", false, &[worksheet[0].clone(), worksheet[1].clone(), ("address", string())], &["item_id", "worksheet_id", "address"]),
        tool("microsoft.excel.write_range", "Write values/formulas/number formats in an exact worksheet range. Null cells leave existing values unchanged. Scope: Files.ReadWrite.", "excel", true, &[worksheet[0].clone(), worksheet[1].clone(), ("address", string()), ("range", changes(object(&[("values", array(array(json!({"type":["string", "number", "boolean", "null"]})))), ("formulas", array(array(json!({"type":["string", "null"]})))), ("numberFormat", array(array(json!({"type":["string", "null"]}))))], &[])))], &["item_id", "worksheet_id", "address", "range"]),
    ];
    result.push(tool(
        "microsoft.onenote.update_page",
        "Apply targeted HTML edits to a OneNote page. Scope: Notes.ReadWrite.",
        "onenote",
        true,
        &[
            ("page_id", string()),
            (
                "changes",
                nonempty_array(object(
                    &[
                        ("target", string()),
                        (
                            "action",
                            choice(&["append", "prepend", "insert", "replace", "delete"]),
                        ),
                        ("position", choice(&["before", "after"])),
                        ("content", string()),
                    ],
                    &["target", "action"],
                )),
            ),
        ],
        &["page_id", "changes"],
    ));
    result
}

fn text<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} must be a nonempty string"))
}

fn optional_text<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn graph(segments: &[&str]) -> Result<Url, String> {
    let mut url = Url::parse(GRAPH).map_err(|e| e.to_string())?;
    let mut path = url
        .path_segments_mut()
        .map_err(|_| "Invalid Graph endpoint")?;
    for segment in segments {
        if segment.is_empty()
            || matches!(*segment, "." | "..")
            || segment.chars().any(char::is_control)
        {
            return Err("Invalid Microsoft resource ID/path segment".into());
        }
        path.push(segment);
    }
    drop(path);
    Ok(url)
}

fn paged(mut url: Url, args: &Value) -> Result<Url, String> {
    if let Some(cursor) = optional_text(args, "next_link") {
        let next = Url::parse(cursor).map_err(|_| "Invalid Microsoft next_link")?;
        if next.scheme() != "https"
            || next.host_str() != Some("graph.microsoft.com")
            || next.port_or_known_default() != Some(443)
            || !next.username().is_empty()
            || next.password().is_some()
            || next.fragment().is_some()
            || path_segments(&next)? != path_segments(&url)?
        {
            return Err("Microsoft next_link must address this exact Graph collection".into());
        }
        return Ok(next);
    }
    if let Some(size) = args.get("page_size").and_then(Value::as_u64) {
        url.query_pairs_mut().append_pair("$top", &size.to_string());
    }
    Ok(url)
}

fn path_segments(url: &Url) -> Result<Vec<Vec<u8>>, String> {
    url.path_segments()
        .ok_or("Invalid Microsoft collection URL")?
        .map(|segment| {
            let mut result = Vec::new();
            let mut bytes = segment.bytes();
            while let Some(byte) = bytes.next() {
                if byte == b'%' {
                    let high = bytes
                        .next()
                        .and_then(|digit| char::from(digit).to_digit(16))
                        .ok_or("Invalid URL escape")?;
                    let low = bytes
                        .next()
                        .and_then(|digit| char::from(digit).to_digit(16))
                        .ok_or("Invalid URL escape")?;
                    result.push((high * 16 + low) as u8);
                } else {
                    result.push(byte);
                }
            }
            Ok(result)
        })
        .collect()
}

enum ResponseKind {
    Json,
    Binary,
    Html,
}

struct Request {
    method: Method,
    url: Url,
    json: Option<Value>,
    bytes: Option<Vec<u8>>,
    content_type: Option<&'static str>,
    response: ResponseKind,
}

impl Request {
    fn json(method: Method, segments: &[&str], payload: Option<Value>) -> Result<Self, String> {
        Ok(Self {
            method,
            url: graph(segments)?,
            json: payload,
            bytes: None,
            content_type: None,
            response: ResponseKind::Json,
        })
    }

    fn list(segments: &[&str], args: &Value) -> Result<Self, String> {
        let mut request = Self::json(Method::GET, segments, None)?;
        request.url = paged(request.url, args)?;
        Ok(request)
    }
}

fn drive_segments<'a>(args: &'a Value, key: &str) -> Result<Vec<&'a str>, String> {
    let drive = text(args, "drive_id")?;
    let item = text(args, key)?;
    Ok(if item == "root" {
        vec!["drives", drive, "root"]
    } else {
        vec!["drives", drive, "items", item]
    })
}

fn request(name: &str, args: &Value) -> Result<Request, String> {
    let get = Method::GET;
    let post = Method::POST;
    let patch = Method::PATCH;
    let delete = Method::DELETE;
    match name {
        "microsoft.outlook.search" | "microsoft.outlook.list_messages" => {
            let segments = if let Some(folder) = optional_text(args, "folder_id") {
                vec!["me", "mailFolders", folder, "messages"]
            } else {
                vec!["me", "messages"]
            };
            let mut url = graph(&segments)?;
            if name.ends_with(".search") {
                let query = text(args, "query")?;
                url.query_pairs_mut()
                    .append_pair("$search", &format!("\"{}\"", query.replace('"', "\\\"")));
            }
            let mut result = Request::json(get, &segments, None)?;
            result.url = paged(url, args)?;
            Ok(result)
        }
        "microsoft.outlook.list_folders" => Request::list(
            &if let Some(folder) = optional_text(args, "folder_id") {
                vec!["me", "mailFolders", folder, "childFolders"]
            } else {
                vec!["me", "mailFolders"]
            },
            args,
        ),
        "microsoft.outlook.read" => {
            Request::json(get, &["me", "messages", text(args, "message_id")?], None)
        }
        "microsoft.outlook.draft" => {
            Request::json(post, &["me", "messages"], Some(args["message"].clone()))
        }
        "microsoft.outlook.update_draft" => Request::json(
            patch,
            &["me", "messages", text(args, "message_id")?],
            Some(args["message"].clone()),
        ),
        "microsoft.outlook.send" => Request::json(
            post,
            &["me", "sendMail"],
            Some(
                json!({"message":args["message"], "saveToSentItems":args.get("save_to_sent_items").and_then(Value::as_bool).unwrap_or(true)}),
            ),
        ),
        "microsoft.outlook.send_draft" => Request::json(
            post,
            &["me", "messages", text(args, "message_id")?, "send"],
            None,
        ),
        "microsoft.outlook.reply" => Request::json(
            post,
            &["me", "messages", text(args, "message_id")?, "reply"],
            Some(json!({"comment":text(args, "comment")?})),
        ),
        "microsoft.outlook.forward" => Request::json(
            post,
            &["me", "messages", text(args, "message_id")?, "forward"],
            Some(
                json!({"comment":optional_text(args, "comment").unwrap_or(""), "toRecipients":args["to_recipients"]}),
            ),
        ),
        "microsoft.outlook.move" | "microsoft.outlook.trash" => Request::json(
            post,
            &["me", "messages", text(args, "message_id")?, "move"],
            Some(
                json!({"destinationId": if name.ends_with(".trash") { "deleteditems" } else { text(args, "destination_folder_id")? }}),
            ),
        ),
        "microsoft.outlook.delete" => {
            Request::json(delete, &["me", "messages", text(args, "message_id")?], None)
        }
        "microsoft.outlook.list_attachments" => Request::list(
            &["me", "messages", text(args, "message_id")?, "attachments"],
            args,
        ),
        "microsoft.outlook.read_attachment" => Request::json(
            get,
            &[
                "me",
                "messages",
                text(args, "message_id")?,
                "attachments",
                text(args, "attachment_id")?,
            ],
            None,
        ),
        "microsoft.outlook.attach_file" => {
            let encoded = text(args, "content_base64")?;
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "content_base64 is invalid")?;
            if bytes.len() >= 3 * 1024 * 1024 {
                return Err(
                    "Graph's simple mail attachment API requires a file smaller than 3 MB".into(),
                );
            }
            Request::json(
                post,
                &["me", "messages", text(args, "message_id")?, "attachments"],
                Some(
                    json!({"@odata.type":"#microsoft.graph.fileAttachment", "name":text(args, "name")?, "contentType":text(args, "content_type")?, "contentBytes":encoded}),
                ),
            )
        }
        "microsoft.calendar.list" => Request::list(&["me", "calendars"], args),
        "microsoft.calendar.create_calendar" => Request::json(
            post,
            &["me", "calendars"],
            Some(json!({"name":args["name"]})),
        ),
        "microsoft.calendar.rename_calendar" | "microsoft.calendar.delete_calendar" => {
            Request::json(
                if name.ends_with(".rename_calendar") {
                    patch
                } else {
                    delete
                },
                &["me", "calendars", text(args, "calendar_id")?],
                if name.ends_with(".rename_calendar") {
                    Some(json!({"name":args["name"]}))
                } else {
                    None
                },
            )
        }
        "microsoft.calendar.events" | "microsoft.calendar.view" | "microsoft.calendar.create" => {
            let mut segments = if let Some(calendar) = optional_text(args, "calendar_id") {
                vec!["me", "calendars", calendar]
            } else {
                vec!["me"]
            };
            segments.push(if name.ends_with(".view") {
                "calendarView"
            } else {
                "events"
            });
            if name.ends_with(".create") {
                return Request::json(post, &segments, Some(args["event"].clone()));
            }
            let mut result = Request::json(get, &segments, None)?;
            if name.ends_with(".view") {
                result
                    .url
                    .query_pairs_mut()
                    .append_pair("startDateTime", text(args, "start")?)
                    .append_pair("endDateTime", text(args, "end")?);
            }
            result.url = paged(result.url, args)?;
            Ok(result)
        }
        "microsoft.calendar.read" | "microsoft.calendar.update" | "microsoft.calendar.delete" => {
            Request::json(
                if name.ends_with(".update") {
                    patch
                } else if name.ends_with(".delete") {
                    delete
                } else {
                    get
                },
                &["me", "events", text(args, "event_id")?],
                if name.ends_with(".update") {
                    Some(args["event"].clone())
                } else {
                    None
                },
            )
        }
        "microsoft.calendar.free_busy" => {
            let mut payload = json!({"schedules":args["schedules"], "startTime":args["start"], "endTime":args["end"]});
            if let Some(interval) = args.get("interval_minutes") {
                payload["availabilityViewInterval"] = interval.clone();
            }
            Request::json(post, &["me", "calendar", "getSchedule"], Some(payload))
        }
        "microsoft.contacts.list" => Request::list(&["me", "contacts"], args),
        "microsoft.contacts.create" => {
            Request::json(post, &["me", "contacts"], Some(args["contact"].clone()))
        }
        "microsoft.contacts.read" | "microsoft.contacts.update" | "microsoft.contacts.delete" => {
            Request::json(
                if name.ends_with(".update") {
                    patch
                } else if name.ends_with(".delete") {
                    delete
                } else {
                    get
                },
                &["me", "contacts", text(args, "contact_id")?],
                if name.ends_with(".update") {
                    Some(args["contact"].clone())
                } else {
                    None
                },
            )
        }
        "microsoft.onedrive.drives" => Request::list(&["me", "drives"], args),
        "microsoft.onedrive.my_drive" => Request::json(get, &["me", "drive"], None),
        "microsoft.onedrive.search" => {
            let query = format!("search(q='{}')", text(args, "query")?.replace('\'', "''"));
            Request::list(&["drives", text(args, "drive_id")?, "root", &query], args)
        }
        "microsoft.onedrive.children"
        | "microsoft.onedrive.read"
        | "microsoft.onedrive.download"
        | "microsoft.onedrive.delete"
        | "microsoft.onedrive.replace"
        | "microsoft.onedrive.move"
        | "microsoft.onedrive.share_link"
        | "microsoft.onedrive.invite" => {
            let mut segments = drive_segments(args, "item_id")?;
            match name {
                "microsoft.onedrive.children" => {
                    segments.push("children");
                    Request::list(&segments, args)
                }
                "microsoft.onedrive.download" => {
                    segments.push("content");
                    let mut result = Request::json(get, &segments, None)?;
                    result.response = ResponseKind::Binary;
                    Ok(result)
                }
                "microsoft.onedrive.replace" => {
                    segments.push("content");
                    upload_request(&segments, args)
                }
                "microsoft.onedrive.move" => {
                    let mut payload = json!({"parentReference":{"id":text(args, "parent_id")?}});
                    if let Some(name) = optional_text(args, "name") {
                        payload["name"] = json!(file_name(name)?);
                    }
                    Request::json(patch, &segments, Some(payload))
                }
                "microsoft.onedrive.share_link" => {
                    segments.push("createLink");
                    Request::json(
                        post,
                        &segments,
                        Some(json!({"type":args["type"], "scope":args["scope"]})),
                    )
                }
                "microsoft.onedrive.invite" => {
                    segments.push("invite");
                    let emails = args["emails"].as_array().ok_or("emails must be an array")?;
                    Request::json(
                        post,
                        &segments,
                        Some(
                            json!({"recipients":emails.iter().map(|email| json!({"email":email})).collect::<Vec<_>>(), "roles":[args["role"]], "requireSignIn":true, "sendInvitation":args["send_invitation"]}),
                        ),
                    )
                }
                _ => Request::json(
                    if name.ends_with(".delete") {
                        delete
                    } else {
                        get
                    },
                    &segments,
                    None,
                ),
            }
        }
        "microsoft.onedrive.upload" => {
            let parent = text(args, "parent_id")?;
            let anchor = if parent == "root" {
                "root:".into()
            } else {
                format!("{}:", parent)
            };
            let name = format!("{}:", file_name(text(args, "name")?)?);
            let segments = if parent == "root" {
                vec!["drives", text(args, "drive_id")?, &anchor, &name, "content"]
            } else {
                vec![
                    "drives",
                    text(args, "drive_id")?,
                    "items",
                    &anchor,
                    &name,
                    "content",
                ]
            };
            upload_request(&segments, args)
        }
        "microsoft.onedrive.create_folder" => {
            let mut segments = drive_segments(args, "parent_id")?;
            segments.push("children");
            Request::json(
                post,
                &segments,
                Some(
                    json!({"name":file_name(text(args, "name")?)?, "folder":{}, "@microsoft.graph.conflictBehavior":"fail"}),
                ),
            )
        }
        "microsoft.sharepoint.search_sites" => {
            let mut result = Request::json(get, &["sites"], None)?;
            result
                .url
                .query_pairs_mut()
                .append_pair("search", text(args, "query")?);
            result.url = paged(result.url, args)?;
            Ok(result)
        }
        "microsoft.sharepoint.read_site" => {
            Request::json(get, &["sites", text(args, "site_id")?], None)
        }
        "microsoft.sharepoint.drives" => {
            Request::list(&["sites", text(args, "site_id")?, "drives"], args)
        }
        "microsoft.teams.joined" => Request::list(&["me", "joinedTeams"], args),
        "microsoft.teams.channels" => {
            Request::list(&["teams", text(args, "team_id")?, "channels"], args)
        }
        "microsoft.teams.channel_messages"
        | "microsoft.teams.channel_replies"
        | "microsoft.teams.post_channel"
        | "microsoft.teams.reply_channel" => {
            let mut segments = vec![
                "teams",
                text(args, "team_id")?,
                "channels",
                text(args, "channel_id")?,
                "messages",
            ];
            if name.ends_with("_replies") || name.ends_with(".reply_channel") {
                segments.extend([text(args, "message_id")?, "replies"]);
            }
            if name.ends_with(".post_channel") || name.ends_with(".reply_channel") {
                Request::json(
                    post,
                    &segments,
                    Some(
                        json!({"body":{"content":args["content"], "contentType":args["content_type"]}}),
                    ),
                )
            } else {
                Request::list(&segments, args)
            }
        }
        "microsoft.teams.chats" => Request::list(&["me", "chats"], args),
        "microsoft.teams.chat_messages" => {
            Request::list(&["chats", text(args, "chat_id")?, "messages"], args)
        }
        "microsoft.teams.read_chat_message" => Request::json(
            get,
            &[
                "chats",
                text(args, "chat_id")?,
                "messages",
                text(args, "message_id")?,
            ],
            None,
        ),
        "microsoft.teams.post_chat" => Request::json(
            post,
            &["chats", text(args, "chat_id")?, "messages"],
            Some(json!({"body":{"content":args["content"], "contentType":args["content_type"]}})),
        ),
        "microsoft.teams.create_meeting" => Request::json(
            post,
            &["me", "onlineMeetings"],
            Some(
                json!({"subject":args["subject"], "startDateTime":args["start"], "endDateTime":args["end"]}),
            ),
        ),
        "microsoft.teams.read_meeting" | "microsoft.teams.delete_meeting" => Request::json(
            if name.ends_with(".delete_meeting") {
                delete
            } else {
                get
            },
            &["me", "onlineMeetings", text(args, "meeting_id")?],
            None,
        ),
        "microsoft.teams.update_meeting" => Request::json(
            patch,
            &["me", "onlineMeetings", text(args, "meeting_id")?],
            Some(args["meeting"].clone()),
        ),
        "microsoft.todo.lists" => Request::list(&["me", "todo", "lists"], args),
        "microsoft.todo.create_list" => Request::json(
            post,
            &["me", "todo", "lists"],
            Some(json!({"displayName":args["name"]})),
        ),
        "microsoft.todo.rename_list" | "microsoft.todo.delete_list" => Request::json(
            if name.ends_with(".rename_list") {
                patch
            } else {
                delete
            },
            &["me", "todo", "lists", text(args, "list_id")?],
            if name.ends_with(".rename_list") {
                Some(json!({"displayName":args["name"]}))
            } else {
                None
            },
        ),
        "microsoft.todo.tasks" => Request::list(
            &["me", "todo", "lists", text(args, "list_id")?, "tasks"],
            args,
        ),
        "microsoft.todo.create_task" => Request::json(
            post,
            &["me", "todo", "lists", text(args, "list_id")?, "tasks"],
            Some(args["task"].clone()),
        ),
        "microsoft.todo.read_task"
        | "microsoft.todo.update_task"
        | "microsoft.todo.delete_task" => Request::json(
            if name.ends_with(".update_task") {
                patch
            } else if name.ends_with(".delete_task") {
                delete
            } else {
                get
            },
            &[
                "me",
                "todo",
                "lists",
                text(args, "list_id")?,
                "tasks",
                text(args, "task_id")?,
            ],
            if name.ends_with(".update_task") {
                Some(args["task"].clone())
            } else {
                None
            },
        ),
        "microsoft.onenote.notebooks" => Request::list(&["me", "onenote", "notebooks"], args),
        "microsoft.onenote.create_notebook" => Request::json(
            post,
            &["me", "onenote", "notebooks"],
            Some(json!({"displayName":args["name"]})),
        ),
        "microsoft.onenote.create_section" => Request::json(
            post,
            &[
                "me",
                "onenote",
                "notebooks",
                text(args, "notebook_id")?,
                "sections",
            ],
            Some(json!({"displayName":args["name"]})),
        ),
        "microsoft.onenote.sections" => Request::list(
            &[
                "me",
                "onenote",
                "notebooks",
                text(args, "notebook_id")?,
                "sections",
            ],
            args,
        ),
        "microsoft.onenote.pages" => Request::list(
            &[
                "me",
                "onenote",
                "sections",
                text(args, "section_id")?,
                "pages",
            ],
            args,
        ),
        "microsoft.onenote.read_page" => {
            let mut result = Request::json(
                get,
                &["me", "onenote", "pages", text(args, "page_id")?, "content"],
                None,
            )?;
            result.response = ResponseKind::Html;
            Ok(result)
        }
        "microsoft.onenote.create_page" => {
            let mut result = Request::json(
                post,
                &[
                    "me",
                    "onenote",
                    "sections",
                    text(args, "section_id")?,
                    "pages",
                ],
                None,
            )?;
            result.bytes = Some(text(args, "html")?.as_bytes().to_vec());
            result.content_type = Some("text/html");
            Ok(result)
        }
        "microsoft.onenote.update_page" => {
            for change in args["changes"]
                .as_array()
                .ok_or("changes must be an array")?
            {
                let action = text(change, "action")?;
                if action != "delete" {
                    text(change, "content")?;
                }
                if action == "insert" {
                    text(change, "position")?;
                }
            }
            Request::json(
                patch,
                &["me", "onenote", "pages", text(args, "page_id")?, "content"],
                Some(args["changes"].clone()),
            )
        }
        "microsoft.onenote.delete_page" => Request::json(
            delete,
            &["me", "onenote", "pages", text(args, "page_id")?],
            None,
        ),
        "microsoft.excel.worksheets" => Request::list(
            &[
                "me",
                "drive",
                "items",
                text(args, "item_id")?,
                "workbook",
                "worksheets",
            ],
            args,
        ),
        "microsoft.excel.add_worksheet" => Request::json(
            post,
            &[
                "me",
                "drive",
                "items",
                text(args, "item_id")?,
                "workbook",
                "worksheets",
                "add",
            ],
            Some(json!({"name":args["name"]})),
        ),
        "microsoft.excel.read_range" | "microsoft.excel.write_range" => {
            let address = text(args, "address")?;
            if !address
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '$'))
            {
                return Err(
                    "address must use A1 cell/range notation without a sheet prefix".into(),
                );
            }
            let range = format!("range(address='{address}')");
            Request::json(
                if name.ends_with(".write_range") {
                    patch
                } else {
                    get
                },
                &[
                    "me",
                    "drive",
                    "items",
                    text(args, "item_id")?,
                    "workbook",
                    "worksheets",
                    text(args, "worksheet_id")?,
                    &range,
                ],
                if name.ends_with(".write_range") {
                    Some(args["range"].clone())
                } else {
                    None
                },
            )
        }
        _ => Err(format!("Unknown Microsoft connector tool: {name}")),
    }
}

fn file_name(name: &str) -> Result<&str, String> {
    if name.is_empty()
        || matches!(name, "." | "..")
        || name.chars().any(|c| {
            c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
    {
        return Err("name must be one valid file/folder name, not a path".into());
    }
    Ok(name)
}

fn upload_request(segments: &[&str], args: &Value) -> Result<Request, String> {
    let bytes = STANDARD
        .decode(optional_text(args, "content_base64").ok_or("content_base64 must be a string")?)
        .map_err(|_| "content_base64 is invalid")?;
    if bytes.len() > 250 * 1024 * 1024 {
        return Err("Graph simple upload supports files up to 250 MB; upload sessions are not exposed by this tool".into());
    }
    let mut result = Request::json(Method::PUT, segments, None)?;
    result.bytes = Some(bytes);
    result.content_type = Some("application/octet-stream");
    Ok(result)
}

fn validate(value: &Value, schema: &Value, path: &str) -> Result<(), String> {
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(value) {
            return Err(format!("{path} has an unsupported value"));
        }
    }
    if let Some(types) = schema.get("type").and_then(Value::as_array) {
        if !types
            .iter()
            .filter_map(Value::as_str)
            .any(|kind| match kind {
                "string" => value.is_string(),
                "number" => value.is_number(),
                "boolean" => value.is_boolean(),
                "null" => value.is_null(),
                _ => false,
            })
        {
            return Err(format!("{path} has an unsupported cell value"));
        }
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("object") => {
            let fields = value
                .as_object()
                .ok_or_else(|| format!("{path} must be an object"))?;
            if (fields.len() as u64)
                < schema
                    .get("minProperties")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            {
                return Err(format!("{path} must contain at least one change"));
            }
            let properties = schema["properties"]
                .as_object()
                .ok_or("Invalid Microsoft tool schema")?;
            for required in schema["required"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
            {
                if !fields.contains_key(required) {
                    return Err(format!("{path}.{required} is required"));
                }
            }
            for (name, child) in fields {
                let child_schema = properties
                    .get(name)
                    .ok_or_else(|| format!("Unknown argument: {path}.{name}"))?;
                validate(child, child_schema, &format!("{path}.{name}"))?;
            }
        }
        Some("array") => {
            let items = value
                .as_array()
                .ok_or_else(|| format!("{path} must be an array"))?;
            if (items.len() as u64) < schema.get("minItems").and_then(Value::as_u64).unwrap_or(0) {
                return Err(format!("{path} cannot be empty"));
            }
            if (items.len() as u64)
                > schema
                    .get("maxItems")
                    .and_then(Value::as_u64)
                    .unwrap_or(u64::MAX)
            {
                return Err(format!("{path} contains too many items"));
            }
            for item in items {
                validate(item, &schema["items"], path)?;
            }
        }
        Some("string") => {
            let string = value
                .as_str()
                .ok_or_else(|| format!("{path} must be a string"))?;
            if schema.get("minLength").and_then(Value::as_u64).unwrap_or(0)
                > string.chars().count() as u64
            {
                return Err(format!("{path} cannot be empty"));
            }
        }
        Some("integer") => {
            let number = value
                .as_u64()
                .ok_or_else(|| format!("{path} must be a nonnegative integer"))?;
            if number < schema.get("minimum").and_then(Value::as_u64).unwrap_or(0)
                || number
                    > schema
                        .get("maximum")
                        .and_then(Value::as_u64)
                        .unwrap_or(u64::MAX)
            {
                return Err(format!("{path} is out of range"));
            }
        }
        Some("boolean") if !value.is_boolean() => return Err(format!("{path} must be a boolean")),
        _ => {}
    }
    Ok(())
}

fn public_response(mut value: Value) -> Value {
    match &mut value {
        Value::Object(fields) => {
            // Graph embeds credential-equivalent storage URLs in ordinary item
            // responses, including nested remoteItem and collection entries.
            fields.remove("@microsoft.graph.downloadUrl");
            fields.remove("uploadUrl");
            for child in fields.values_mut() {
                *child = public_response(child.take());
            }
        }
        Value::Array(items) => {
            for child in items {
                *child = public_response(child.take());
            }
        }
        _ => {}
    }
    value
}

pub async fn execute(
    accounts: &AccountsState,
    name: &str,
    args: &Value,
    cancel: &CancellationToken,
) -> Result<Value, String> {
    let descriptor = tools()
        .into_iter()
        .find(|tool| tool.name == name)
        .ok_or_else(|| format!("Unknown Microsoft connector tool: {name}"))?;
    validate(args, &descriptor.input_schema, "arguments")?;
    let request = request(name, args)?;
    let account = optional_text(args, "account_id").unwrap_or("");
    if matches!(
        name,
        "microsoft.outlook.update_draft" | "microsoft.outlook.attach_file"
    ) {
        let mut url = graph(&["me", "messages", text(args, "message_id")?])?;
        url.query_pairs_mut().append_pair("$select", "isDraft");
        let message = accounts
            .request_json(
                Provider::Microsoft,
                account,
                "outlook",
                Method::GET,
                url.as_str(),
                None,
                cancel,
            )
            .await?;
        if message.get("isDraft").and_then(Value::as_bool) != Some(true) {
            return Err("This mail operation requires an unsent draft".into());
        }
    }
    if request.bytes.is_some() || !matches!(request.response, ResponseKind::Json) {
        let mut headers = HeaderMap::new();
        if let Some(content_type) = request.content_type {
            headers.insert(
                reqwest::header::CONTENT_TYPE,
                reqwest::header::HeaderValue::from_static(content_type),
            );
        }
        let bytes = accounts
            .request_bytes(
                Provider::Microsoft,
                account,
                descriptor.service,
                request.method,
                request.url.as_str(),
                headers,
                request.bytes,
                cancel,
            )
            .await?;
        match request.response {
            ResponseKind::Binary => {
                Ok(json!({"content_base64":STANDARD.encode(&bytes), "byte_length":bytes.len()}))
            }
            ResponseKind::Html => Ok(
                json!({"html":String::from_utf8(bytes).map_err(|_| "Microsoft returned invalid UTF-8 HTML")?}),
            ),
            ResponseKind::Json => {
                if bytes.is_empty() {
                    Ok(json!({"accepted":true}))
                } else {
                    serde_json::from_slice(&bytes)
                        .map(public_response)
                        .map_err(|_| "Microsoft returned invalid JSON".into())
                }
            }
        }
    } else {
        accounts
            .request_json(
                Provider::Microsoft,
                account,
                descriptor.service,
                request.method,
                request.url.as_str(),
                request.json,
                cancel,
            )
            .await
            .map(public_response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mail_and_calendar_requests_preserve_operation_and_payload() {
        let message = json!({"subject":"Draft", "body":{"contentType":"Text", "content":"Text"}, "toRecipients":[{"emailAddress":{"address":"a@example.test"}}]});
        let draft = request("microsoft.outlook.draft", &json!({"message":message})).unwrap();
        assert_eq!(draft.method, Method::POST);
        assert_eq!(
            draft.url.as_str(),
            "https://graph.microsoft.com/v1.0/me/messages"
        );
        assert_eq!(draft.json, Some(message.clone()));
        let send = request(
            "microsoft.outlook.send",
            &json!({"message":message, "save_to_sent_items":false}),
        )
        .unwrap();
        assert_eq!(send.url.path(), "/v1.0/me/sendMail");
        assert_eq!(send.json.unwrap()["saveToSentItems"], false);
        let trash = request(
            "microsoft.outlook.trash",
            &json!({"message_id":"mail/with?reserved"}),
        )
        .unwrap();
        assert_eq!(
            trash.url.path(),
            "/v1.0/me/messages/mail%2Fwith%3Freserved/move"
        );
        assert_eq!(trash.json.unwrap()["destinationId"], "deleteditems");
        let schedule = request("microsoft.calendar.free_busy", &json!({"schedules":["a@example.test"], "start":{"dateTime":"2026-10-10T10:00:00", "timeZone":"UTC"}, "end":{"dateTime":"2026-10-10T11:00:00", "timeZone":"UTC"}, "interval_minutes":15})).unwrap();
        assert_eq!(schedule.method, Method::POST);
        assert_eq!(schedule.url.path(), "/v1.0/me/calendar/getSchedule");
        assert_eq!(schedule.json.unwrap()["availabilityViewInterval"], 15);
        assert!(
            !tools()
                .iter()
                .find(|tool| tool.name == "microsoft.calendar.free_busy")
                .unwrap()
                .write
        );
    }

    #[test]
    fn pagination_cannot_change_origin_account_resource_or_operation() {
        let url = "https://graph.microsoft.com/v1.0/me/messages?$skip=50";
        let args = json!({"next_link":url});
        assert_eq!(
            request("microsoft.outlook.list_messages", &args)
                .unwrap()
                .url
                .as_str(),
            url
        );
        for bad in [
            "https://example.test/v1.0/me/messages",
            "http://graph.microsoft.com/v1.0/me/messages",
            "https://graph.microsoft.com/v1.0/users/other/messages",
            "https://graph.microsoft.com/v1.0/me/contacts",
            "https://token@graph.microsoft.com/v1.0/me/messages",
            "https://graph.microsoft.com/v1.0/me/messages#fragment",
        ] {
            assert!(
                request("microsoft.outlook.list_messages", &json!({"next_link":bad})).is_err(),
                "{bad}"
            );
        }
        let escaped =
            "https://graph.microsoft.com/v1.0/me/mailFolders/folder%2fid/messages?$skip=50";
        assert_eq!(
            request(
                "microsoft.outlook.list_messages",
                &json!({"folder_id":"folder/id", "next_link":escaped})
            )
            .unwrap()
            .url
            .as_str(),
            escaped
        );
        assert!(request("microsoft.outlook.list_messages", &json!({"folder_id":"folder/id", "next_link":"https://graph.microsoft.com/v1.0/me/mailFolders/folder/id/messages?$skip=50"})).is_err());
    }

    #[test]
    fn file_and_teams_requests_use_exact_ids_and_typed_bodies() {
        let upload = request("microsoft.onedrive.upload", &json!({"drive_id":"drive", "parent_id":"root", "name":"hello.txt", "content_base64":"aGk="})).unwrap();
        assert_eq!(upload.method, Method::PUT);
        assert_eq!(
            upload.url.path(),
            "/v1.0/drives/drive/root:/hello.txt:/content"
        );
        assert_eq!(upload.bytes.unwrap(), b"hi");
        assert!(request("microsoft.onedrive.upload", &json!({"drive_id":"drive", "parent_id":"root", "name":"../elsewhere", "content_base64":"aGk="})).is_err());
        let reply = request("microsoft.teams.reply_channel", &json!({"team_id":"team", "channel_id":"channel", "message_id":"message", "content":"Reply", "content_type":"text"})).unwrap();
        assert_eq!(
            reply.url.path(),
            "/v1.0/teams/team/channels/channel/messages/message/replies"
        );
        assert_eq!(
            reply.json.unwrap(),
            json!({"body":{"content":"Reply", "contentType":"text"}})
        );
        let excel = request("microsoft.excel.write_range", &json!({"item_id":"file", "worksheet_id":"sheet", "address":"A1:B2", "range":{"values":[[1,2],[3,null]]}})).unwrap();
        assert_eq!(excel.method, Method::PATCH);
        assert_eq!(excel.json.unwrap(), json!({"values":[[1,2],[3,null]]}));
    }

    #[test]
    fn schemas_reject_unadvertised_mutation_fields_and_unknown_tools() {
        let draft = tools()
            .into_iter()
            .find(|tool| tool.name == "microsoft.outlook.draft")
            .unwrap();
        assert!(validate(&json!({"message":{"subject":"x", "body":{"contentType":"Text", "content":"x"}, "toRecipients":[], "url":"https://example.test"}}), &draft.input_schema, "arguments").is_err());
        assert!(request("microsoft.http", &json!({"url":"https://example.test"})).is_err());
        let read = tools()
            .into_iter()
            .find(|tool| tool.name == "microsoft.outlook.read")
            .unwrap();
        assert!(validate(
            &json!({"message_id":"id", "account_id":3}),
            &read.input_schema,
            "arguments"
        )
        .is_err());
        let range = tools()
            .into_iter()
            .find(|tool| tool.name == "microsoft.excel.write_range")
            .unwrap();
        assert!(validate(
            &json!({"item_id":"file", "worksheet_id":"sheet", "address":"A1", "range":{}}),
            &range.input_schema,
            "arguments"
        )
        .is_err());
        assert!(validate(&json!({"item_id":"file", "worksheet_id":"sheet", "address":"A1", "range":{"values":[[{"url":"https://example.test"}]]}}), &range.input_schema, "arguments").is_err());
        assert!(request("microsoft.onenote.update_page", &json!({"page_id":"page", "changes":[{"target":"#paragraph", "action":"insert", "content":"text"}]})).is_err());
    }

    #[test]
    fn collection_and_upload_results_never_expose_preauthenticated_urls() {
        let response = json!({"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=cursor", "value":[{"id":"file", "webUrl":"https://example.sharepoint.com/file", "@microsoft.graph.downloadUrl":"https://storage.test/secret", "remoteItem":{"id":"remote", "@microsoft.graph.downloadUrl":"https://storage.test/other-secret"}}], "uploadUrl":"https://storage.test/upload-secret"});
        assert_eq!(
            public_response(response),
            json!({"@odata.nextLink":"https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=cursor", "value":[{"id":"file", "webUrl":"https://example.sharepoint.com/file", "remoteItem":{"id":"remote"}}]})
        );
    }
}
