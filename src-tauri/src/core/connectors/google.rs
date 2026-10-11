//! Google Workspace REST tools. Account consent and caller approval belong to the shared runtime.
use super::{AccountsState, ConnectorTool, Provider};
use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine};
use reqwest::{header::{HeaderMap, HeaderValue, CONTENT_TYPE}, Method, Url};
use serde_json::{json, Map, Value};
use tokio_util::sync::CancellationToken;

fn text() -> Value { json!({"type":"string"}) }
fn nonempty() -> Value { json!({"type":"string","minLength":1}) }
fn boolean() -> Value { json!({"type":"boolean"}) }
fn integer(min: i64, max: i64) -> Value { json!({"type":"integer","minimum":min,"maximum":max}) }
fn choice(values: &[&str]) -> Value { json!({"type":"string","enum":values}) }
fn array(item: Value) -> Value { json!({"type":"array","items":item}) }
fn object(fields: &[(&str, Value)], required: &[&str]) -> Value {
    let properties: Map<String, Value> = fields.iter().map(|(k,v)| ((*k).into(),v.clone())).collect();
    json!({"type":"object","properties":properties,"required":required,"additionalProperties":false})
}
fn tool(name: &'static str, description: &'static str, service: &'static str, write: bool, fields: &[(&str, Value)], required: &[&str]) -> ConnectorTool {
    let mut fields = fields.to_vec();
    fields.push(("account_id", text()));
    ConnectorTool { name, description, service, write, input_schema: object(&fields, required) }
}
fn date_time() -> Value { object(&[("date",text()),("dateTime",text()),("timeZone",text())], &[]) }
fn event() -> Value {
    object(&[("summary",text()),("description",text()),("location",text()),("start",date_time()),("end",date_time()),
        ("attendees",array(object(&[("email",nonempty()),("displayName",text()),("optional",boolean()),("responseStatus",choice(&["needsAction","declined","tentative","accepted"]))], &["email"]))),
        ("recurrence",array(text())),("visibility",choice(&["default","public","private","confidential"])),("transparency",choice(&["opaque","transparent"])),
        ("reminders",object(&[("useDefault",boolean()),("overrides",array(object(&[("method",choice(&["email","popup"])),("minutes",integer(0,40320))], &["method","minutes"])))], &["useDefault"]))], &[])
}
fn contact() -> Value {
    object(&[("names",array(object(&[("givenName",text()),("familyName",text()),("middleName",text()),("displayName",text())], &[]))),
        ("emailAddresses",array(object(&[("value",nonempty()),("type",text())], &["value"]))),
        ("phoneNumbers",array(object(&[("value",nonempty()),("type",text())], &["value"]))),
        ("organizations",array(object(&[("name",text()),("title",text()),("department",text()),("current",boolean())], &[]))),
        ("biographies",array(object(&[("value",text()),("contentType",choice(&["TEXT_PLAIN","TEXT_HTML"]))], &["value"]))),
        ("addresses",array(object(&[("streetAddress",text()),("city",text()),("region",text()),("postalCode",text()),("country",text()),("type",text())], &[]))),
        ("urls",array(object(&[("value",nonempty()),("type",text())], &["value"])))], &[])
}
fn mail() -> Value {
    object(&[("to",array(nonempty())),("cc",array(nonempty())),("bcc",array(nonempty())),("subject",text()),("text",text()),("html",text()),
        ("attachments",array(object(&[("filename",nonempty()),("mime_type",nonempty()),("data_base64",text())], &["filename","mime_type","data_base64"])))], &["to","subject"])
}
fn reply_mail() -> Value {
    let mut schema=mail();
    schema["required"]=json!(["to"]);
    schema
}
fn doc_range() -> Value { object(&[("startIndex",integer(1,i32::MAX.into())),("endIndex",integer(1,i32::MAX.into())),("tabId",text()),("segmentId",text())], &["startIndex","endIndex"]) }
fn text_style() -> Value {
    object(&[("bold",boolean()),("italic",boolean()),("underline",boolean()),("strikethrough",boolean()),("fontSize",object(&[("magnitude",json!({"type":"number","minimum":0})),("unit",choice(&["PT"]))], &["magnitude","unit"])),
        ("weightedFontFamily",object(&[("fontFamily",nonempty()),("weight",integer(100,900))], &["fontFamily"])),("link",object(&[("url",nonempty())], &["url"]))], &[])
}
fn doc_requests() -> Value {
    let location = object(&[("index",integer(1,i32::MAX.into())),("tabId",text()),("segmentId",text())], &["index"]);
    let contains = object(&[("text",nonempty()),("matchCase",boolean())], &["text","matchCase"]);
    let variants = vec![
        object(&[("insertText",object(&[("text",text()),("location",location.clone())], &["text","location"]))], &["insertText"]),
        object(&[("replaceAllText",object(&[("containsText",contains),("replaceText",text())], &["containsText","replaceText"]))], &["replaceAllText"]),
        object(&[("deleteContentRange",object(&[("range",doc_range())], &["range"]))], &["deleteContentRange"]),
        object(&[("updateTextStyle",object(&[("range",doc_range()),("textStyle",text_style()),("fields",nonempty())], &["range","textStyle","fields"]))], &["updateTextStyle"]),
        object(&[("insertTable",object(&[("rows",integer(1,1000)),("columns",integer(1,1000)),("location",location.clone())], &["rows","columns","location"]))], &["insertTable"]),
        object(&[("insertInlineImage",object(&[("uri",nonempty()),("location",location)], &["uri","location"]))], &["insertInlineImage"]),
        object(&[("createParagraphBullets",object(&[("range",doc_range()),("bulletPreset",choice(&["BULLET_DISC_CIRCLE_SQUARE","BULLET_DIAMONDX_ARROW3D_SQUARE","NUMBERED_DIGIT_ALPHA_ROMAN","NUMBERED_UPPERALPHA_ALPHA_ROMAN"]))], &["range","bulletPreset"]))], &["createParagraphBullets"]),
        object(&[("deleteParagraphBullets",object(&[("range",doc_range())], &["range"]))], &["deleteParagraphBullets"]),
    ];
    array(json!({"oneOf":variants}))
}
fn slide_text_style() -> Value {
    let mut style=text_style();
    let properties=style["properties"].as_object_mut().unwrap();
    properties.remove("weightedFontFamily");
    properties.insert("fontFamily".into(),nonempty());
    style
}
fn slide_requests() -> Value {
    let range = object(&[("type",choice(&["ALL","FIXED_RANGE","FROM_START_INDEX"])),("startIndex",integer(0,i32::MAX.into())),("endIndex",integer(0,i32::MAX.into()))], &["type"]);
    let size = object(&[("magnitude",json!({"type":"number"})),("unit",choice(&["PT","EMU"]))], &["magnitude","unit"]);
    let transform = object(&[("scaleX",json!({"type":"number"})),("scaleY",json!({"type":"number"})),("shearX",json!({"type":"number"})),("shearY",json!({"type":"number"})),("translateX",json!({"type":"number"})),("translateY",json!({"type":"number"})),("unit",choice(&["PT","EMU"]))], &["scaleX","scaleY","unit"]);
    let properties = object(&[("pageObjectId",nonempty()),("size",object(&[("width",size.clone()),("height",size)], &["width","height"])),("transform",transform)], &["pageObjectId"]);
    array(json!({"oneOf":[
        object(&[("createSlide",object(&[("objectId",text()),("insertionIndex",integer(0,i32::MAX.into())),("slideLayoutReference",object(&[("predefinedLayout",choice(&["BLANK","TITLE","TITLE_AND_BODY","TITLE_ONLY","SECTION_HEADER","TWO_COLUMNS","CAPTION_ONLY"]))], &["predefinedLayout"]))], &[]))], &["createSlide"]),
        object(&[("createShape",object(&[("objectId",text()),("shapeType",choice(&["TEXT_BOX","RECTANGLE","ELLIPSE","ROUND_RECTANGLE","TRIANGLE"])),("elementProperties",properties.clone())], &["shapeType","elementProperties"]))], &["createShape"]),
        object(&[("createImage",object(&[("objectId",text()),("url",nonempty()),("elementProperties",properties)], &["url","elementProperties"]))], &["createImage"]),
        object(&[("insertText",object(&[("objectId",nonempty()),("text",text()),("insertionIndex",integer(0,i32::MAX.into()))], &["objectId","text"]))], &["insertText"]),
        object(&[("deleteText",object(&[("objectId",nonempty()),("textRange",range.clone())], &["objectId","textRange"]))], &["deleteText"]),
        object(&[("replaceAllText",object(&[("containsText",object(&[("text",nonempty()),("matchCase",boolean())], &["text","matchCase"])),("replaceText",text()),("pageObjectIds",array(nonempty()))], &["containsText","replaceText"]))], &["replaceAllText"]),
        object(&[("updateTextStyle",object(&[("objectId",nonempty()),("textRange",range),("style",slide_text_style()),("fields",nonempty())], &["objectId","style","fields"]))], &["updateTextStyle"]),
        object(&[("deleteObject",object(&[("objectId",nonempty())], &["objectId"]))], &["deleteObject"]),
        object(&[("duplicateObject",object(&[("objectId",nonempty())], &["objectId"]))], &["duplicateObject"])
    ]}))
}

pub fn tools() -> Vec<ConnectorTool> {
    let mut out = vec![
        tool("google.gmail.search","Search Gmail messages using Gmail query syntax.","gmail",false,&[("query",text()),("max_results",integer(1,500)),("page_token",text()),("label_ids",array(nonempty())),("include_spam_trash",boolean())],&[]),
        tool("google.gmail.read","Read a Gmail message including MIME parts and headers.","gmail",false,&[("message_id",nonempty()),("format",choice(&["full","metadata","raw","minimal"])),("metadata_headers",array(nonempty()))],&["message_id"]),
        tool("google.gmail.thread","Read all messages in a Gmail thread.","gmail",false,&[("thread_id",nonempty()),("format",choice(&["full","metadata","minimal"]))],&["thread_id"]),
        tool("google.gmail.labels.list","List Gmail labels.","gmail",false,&[],&[]),
        tool("google.gmail.labels.read","Read a Gmail label and its message/thread counts.","gmail",false,&[("label_id",nonempty())],&["label_id"]),
        tool("google.gmail.labels.create","Create a Gmail label.","gmail",true,&[("name",nonempty()),("label_list_visibility",choice(&["labelShow","labelShowIfUnread","labelHide"])),("message_list_visibility",choice(&["show","hide"]))],&["name"]),
        tool("google.gmail.labels.update","Patch a Gmail label name or visibility.","gmail",true,&[("label_id",nonempty()),("name",text()),("label_list_visibility",choice(&["labelShow","labelShowIfUnread","labelHide"])),("message_list_visibility",choice(&["show","hide"]))],&["label_id"]),
        tool("google.gmail.labels.delete","Delete a user-created Gmail label.","gmail",true,&[("label_id",nonempty())],&["label_id"]),
        tool("google.gmail.labels.modify","Add or remove labels on a Gmail message.","gmail",true,&[("message_id",nonempty()),("add_label_ids",array(nonempty())),("remove_label_ids",array(nonempty()))],&["message_id"]),
        tool("google.gmail.drafts.list","List Gmail drafts.","gmail",false,&[("max_results",integer(1,500)),("page_token",text()),("query",text())],&[]),
        tool("google.gmail.drafts.read","Read a Gmail draft.","gmail",false,&[("draft_id",nonempty()),("format",choice(&["full","metadata","raw","minimal"]))],&["draft_id"]),
        tool("google.gmail.drafts.create","Compose and save a Gmail draft with optional attachments.","gmail",true,&[("message",mail())],&["message"]),
        tool("google.gmail.drafts.update","Replace a draft's complete composed message.","gmail",true,&[("draft_id",nonempty()),("message",mail())],&["draft_id","message"]),
        tool("google.gmail.drafts.delete","Delete a Gmail draft.","gmail",true,&[("draft_id",nonempty())],&["draft_id"]),
        tool("google.gmail.drafts.send","Send an existing Gmail draft.","gmail",true,&[("draft_id",nonempty())],&["draft_id"]),
        tool("google.gmail.send","Compose and send email with optional MIME attachments.","gmail",true,&[("message",mail())],&["message"]),
        tool("google.gmail.reply","Reply to a message, preserving its subject and RFC thread headers. Explicit recipients required; subject may be omitted.","gmail",true,&[("message_id",nonempty()),("message",reply_mail())],&["message_id","message"]),
        tool("google.gmail.attachment","Get an attachment's base64url-encoded bytes.","gmail",false,&[("message_id",nonempty()),("attachment_id",nonempty())],&["message_id","attachment_id"]),
        tool("google.calendar.calendars","List calendars in the account calendar list.","calendar",false,&[("page_token",text()),("max_results",integer(1,250)),("show_hidden",boolean())],&[]),
        tool("google.calendar.list","List events in a calendar.","calendar",false,&[("calendar_id",nonempty()),("query",text()),("time_min",text()),("time_max",text()),("max_results",integer(1,2500)),("page_token",text()),("sync_token",text()),("single_events",boolean()),("order_by",choice(&["startTime","updated"])),("show_deleted",boolean())],&["calendar_id"]),
        tool("google.calendar.read","Read a calendar event.","calendar",false,&[("calendar_id",nonempty()),("event_id",nonempty())],&["calendar_id","event_id"]),
        tool("google.calendar.create","Create an event. start and end required; send_updates controls attendee notifications.","calendar",true,&[("calendar_id",nonempty()),("event",event()),("send_updates",choice(&["all","externalOnly","none"])),("create_meet",boolean())],&["calendar_id","event"]),
        tool("google.calendar.update","Patch selected event fields; supplied arrays replace existing arrays.","calendar",true,&[("calendar_id",nonempty()),("event_id",nonempty()),("event",event()),("send_updates",choice(&["all","externalOnly","none"]))],&["calendar_id","event_id","event"]),
        tool("google.calendar.delete","Delete a calendar event.","calendar",true,&[("calendar_id",nonempty()),("event_id",nonempty()),("send_updates",choice(&["all","externalOnly","none"]))],&["calendar_id","event_id"]),
        tool("google.calendar.freebusy","Query free/busy intervals without changing calendars.","calendar",false,&[("time_min",nonempty()),("time_max",nonempty()),("calendar_ids",array(nonempty())),("time_zone",text())],&["time_min","time_max","calendar_ids"]),
        tool("google.drive.search","Search Drive files with Drive query syntax and paginated results.","drive",false,&[("query",text()),("page_size",integer(1,1000)),("page_token",text()),("fields",text()),("order_by",text()),("drive_id",text())],&[]),
        tool("google.drive.metadata","Read file metadata, permissions or export links using a fields mask.","drive",false,&[("file_id",nonempty()),("fields",text())],&["file_id"]),
        tool("google.drive.download","Download ordinary Drive file bytes as base64. Use Docs export for Workspace documents.","drive",false,&[("file_id",nonempty())],&["file_id"]),
        tool("google.drive.upload","Upload base64 bytes and metadata as a new Drive file.","drive",true,&[("name",nonempty()),("mime_type",nonempty()),("data_base64",text()),("parent_ids",array(nonempty())),("description",text())],&["name","mime_type","data_base64"]),
        tool("google.drive.createfolder","Create a Drive folder.","drive",true,&[("name",nonempty()),("parent_ids",array(nonempty()))],&["name"]),
        tool("google.drive.update","Patch a file's metadata and optionally replace its bytes.","drive",true,&[("file_id",nonempty()),("name",text()),("description",text()),("starred",boolean()),("mime_type",nonempty()),("data_base64",text())],&["file_id"]),
        tool("google.drive.move","Move a file by explicitly adding/removing parent folder IDs.","drive",true,&[("file_id",nonempty()),("add_parent_ids",array(nonempty())),("remove_parent_ids",array(nonempty()))],&["file_id"]),
        tool("google.drive.share","Create a file permission; ownership transfer requires explicit transfer_ownership=true.","drive",true,&[("file_id",nonempty()),("type",choice(&["user","group","domain","anyone"])),("role",choice(&["owner","organizer","fileOrganizer","writer","commenter","reader"])),("email_address",text()),("domain",text()),("allow_file_discovery",boolean()),("send_notification_email",boolean()),("email_message",text()),("transfer_ownership",boolean())],&["file_id","type","role"]),
        tool("google.docs.read","Read a Google document, including tabs.","docs",false,&[("document_id",nonempty())],&["document_id"]),
        tool("google.docs.create","Create a blank Google document.","docs",true,&[("title",nonempty())],&["title"]),
        tool("google.docs.edit","Apply typed text, formatting, image, table or bullet document edits.","docs",true,&[("document_id",nonempty()),("requests",doc_requests()),("required_revision_id",text())],&["document_id","requests"]),
        tool("google.docs.export","Export a Workspace document through Drive to the requested supported MIME type as base64. Requires Drive access.","drive",false,&[("document_id",nonempty()),("mime_type",nonempty())],&["document_id","mime_type"]),
        tool("google.sheets.read","Read spreadsheet cell values for an A1 range.","sheets",false,&[("spreadsheet_id",nonempty()),("range",nonempty()),("value_render_option",choice(&["FORMATTED_VALUE","UNFORMATTED_VALUE","FORMULA"])),("date_time_render_option",choice(&["SERIAL_NUMBER","FORMATTED_STRING"]))],&["spreadsheet_id","range"]),
        tool("google.sheets.metadata","Read spreadsheet properties and sheet identifiers.","sheets",false,&[("spreadsheet_id",nonempty())],&["spreadsheet_id"]),
        tool("google.sheets.create","Create a spreadsheet with named sheets.","sheets",true,&[("title",nonempty()),("sheet_titles",array(nonempty()))],&["title"]),
        tool("google.slides.read","Read a Google Slides presentation.","slides",false,&[("presentation_id",nonempty())],&["presentation_id"]),
        tool("google.slides.create","Create a blank presentation.","slides",true,&[("title",nonempty())],&["title"]),
        tool("google.slides.edit","Apply typed slide, shape, image, text and formatting edits.","slides",true,&[("presentation_id",nonempty()),("requests",slide_requests()),("required_revision_id",text())],&["presentation_id","requests"]),
        tool("google.people.list","List contacts, preserving metadata source etags for later updates.","people",false,&[("person_fields",text()),("page_size",integer(1,1000)),("page_token",text())],&[]),
        tool("google.people.read","Read one contact by people/resource ID.","people",false,&[("resource_name",nonempty()),("person_fields",text())],&["resource_name"]),
        tool("google.people.search","Warm the contacts cache and search contacts by prefix.","people",false,&[("query",nonempty()),("read_mask",text()),("page_size",integer(1,30))],&["query"]),
        tool("google.people.create","Create a contact.","people",true,&[("person",contact())],&["person"]),
        tool("google.people.update","Replace explicitly selected contact fields using the last-read CONTACT source etag.","people",true,&[("resource_name",nonempty()),("person",contact()),("update_fields",array(choice(&["names","emailAddresses","phoneNumbers","organizations","biographies","addresses","urls"]))), ("source_id",nonempty()),("source_etag",nonempty())],&["resource_name","person","update_fields","source_id","source_etag"]),
        tool("google.people.delete","Delete a contact.","people",true,&[("resource_name",nonempty())],&["resource_name"]),
    ];
    for (name, description) in [("google.gmail.trash","Move a message to Trash."),("google.gmail.untrash","Restore a message from Trash."),("google.gmail.delete","Permanently delete a message; requires full mail.google.com scope.")] {
        out.push(tool(name,description,"gmail",true,&[("message_id",nonempty())],&["message_id"]));
    }
    out.push(tool("google.drive.trash","Move a Drive file to Trash.","drive",true,&[("file_id",nonempty())],&["file_id"]));
    for (name, description) in [("google.sheets.write","Replace cell values in an A1 range."),("google.sheets.append","Append rows after the table found in an A1 range.")] {
        out.push(tool(name,description,"sheets",true,&[("spreadsheet_id",nonempty()),("range",nonempty()),("values",array(array(json!({"type":["string","number","boolean","null"]})))),("value_input_option",choice(&["RAW","USER_ENTERED"])),("major_dimension",choice(&["ROWS","COLUMNS"])),("insert_data_option",choice(&["OVERWRITE","INSERT_ROWS"]))],&["spreadsheet_id","range","values","value_input_option"]));
    }
    let task = object(&[("title",text()),("notes",text()),("due",text()),("status",choice(&["needsAction","completed"]))], &[]);
    out.extend([
        tool("google.tasks.lists","List task lists.","tasks",false,&[("max_results",integer(1,1000)),("page_token",text())],&[]),
        tool("google.tasks.list_create","Create a task list.","tasks",true,&[("title",nonempty())],&["title"]),
        tool("google.tasks.list_update","Rename a task list.","tasks",true,&[("task_list_id",nonempty()),("title",nonempty())],&["task_list_id","title"]),
        tool("google.tasks.list_delete","Delete a task list.","tasks",true,&[("task_list_id",nonempty())],&["task_list_id"]),
        tool("google.tasks.list","List tasks, including completed/hidden tasks when requested.","tasks",false,&[("task_list_id",nonempty()),("max_results",integer(1,100)),("page_token",text()),("show_completed",boolean()),("show_hidden",boolean()),("show_deleted",boolean()),("due_min",text()),("due_max",text()),("updated_min",text())],&["task_list_id"]),
        tool("google.tasks.read","Read a task.","tasks",false,&[("task_list_id",nonempty()),("task_id",nonempty())],&["task_list_id","task_id"]),
        tool("google.tasks.create","Create a task. Due uses an RFC3339 date; Tasks discards time-of-day.","tasks",true,&[("task_list_id",nonempty()),("task",task.clone()),("parent",text()),("previous",text())],&["task_list_id","task"]),
        tool("google.tasks.update","Patch a task title, notes, due date or completion status.","tasks",true,&[("task_list_id",nonempty()),("task_id",nonempty()),("task",task)],&["task_list_id","task_id","task"]),
        tool("google.tasks.delete","Delete a task.","tasks",true,&[("task_list_id",nonempty()),("task_id",nonempty())],&["task_list_id","task_id"]),
        tool("google.tasks.move","Move a task within a list by parent and previous sibling.","tasks",true,&[("task_list_id",nonempty()),("task_id",nonempty()),("parent",text()),("previous",text())],&["task_list_id","task_id"]),
    ]);
    out
}

fn validate(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    if let Some(variants) = schema["oneOf"].as_array() {
        if variants.iter().filter(|s| validate(s,value,path).is_ok()).count() != 1 { return Err(format!("{path}: expected exactly one supported operation")); }
        return Ok(());
    }
    let types: Vec<&str> = match &schema["type"] { Value::String(s) => vec![s], Value::Array(a) => a.iter().filter_map(Value::as_str).collect(), _ => Vec::new() };
    if !types.is_empty() && !types.iter().any(|t| match *t { "object"=>value.is_object(),"array"=>value.is_array(),"string"=>value.is_string(),"integer"=>value.is_i64()||value.is_u64(),"number"=>value.is_number(),"boolean"=>value.is_boolean(),"null"=>value.is_null(),_=>false }) { return Err(format!("{path}: invalid value type")); }
    if let Some(choices)=schema["enum"].as_array() { if !choices.contains(value) { return Err(format!("{path}: unsupported value")); } }
    if let Some(s)=value.as_str() { if s.chars().count() < schema["minLength"].as_u64().unwrap_or(0) as usize { return Err(format!("{path}: must not be empty")); } }
    if let Some(n)=value.as_f64() {
        if schema["minimum"].as_f64().is_some_and(|min| n<min) || schema["maximum"].as_f64().is_some_and(|max| n>max) { return Err(format!("{path}: number outside supported range")); }
    }
    if let Some(o)=value.as_object() {
        if let Some(required)=schema["required"].as_array() { for key in required.iter().filter_map(Value::as_str) { if !o.contains_key(key) { return Err(format!("{path}.{key}: required")); } } }
        let properties=&schema["properties"];
        for (key,v) in o { if let Some(s)=properties.get(key) { validate(s,v,&format!("{path}.{key}"))?; } else if schema["additionalProperties"] == false { return Err(format!("{path}.{key}: unsupported argument")); } }
    }
    if let Some(a)=value.as_array() { for (i,v) in a.iter().enumerate() { validate(&schema["items"],v,&format!("{path}[{i}]"))?; } }
    Ok(())
}
fn s<'a>(args: &'a Value,key: &str) -> &'a str { args[key].as_str().unwrap_or("") }
fn segment(value: &str) -> String {
    let mut out=String::new();
    for byte in value.bytes() { if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) { out.push(char::from(byte)); } else { out.push_str(&format!("%{byte:02X}")); } }
    out
}
fn endpoint(base: &str, path: &str) -> Result<Url,String> { Url::parse(&format!("{base}{path}")).map_err(|e|format!("Invalid Google endpoint: {e}")) }
fn query(url: &mut Url, args: &Value, keys: &[(&str,&str)]) {
    for (input,api) in keys { if let Some(v)=args.get(*input) { match v {
        Value::String(v)=>{url.query_pairs_mut().append_pair(api,v);},
        Value::Bool(v)=>{url.query_pairs_mut().append_pair(api,&v.to_string());},
        Value::Number(v)=>{url.query_pairs_mut().append_pair(api,&v.to_string());},
        Value::Array(a)=>{for v in a.iter().filter_map(Value::as_str){url.query_pairs_mut().append_pair(api,v);}},_=>{}
    } } }
}
fn csv(args:&Value,key:&str)->String { args[key].as_array().map(|a|a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(",")).unwrap_or_default() }
fn mapped(args:&Value,keys:&[(&str,&str)])->Value { let mut out=Map::new(); for (input,api) in keys { if let Some(v)=args.get(*input) { out.insert((*api).into(),v.clone()); } } Value::Object(out) }
fn person_path(args:&Value)->Result<String,String> {
    let resource=s(args,"resource_name").strip_prefix("people/").ok_or("resource_name must be people/{id}")?;
    if resource.is_empty() || resource.contains('/') || matches!(resource,"."|"..") { return Err("resource_name must be people/{id}".into()); }
    Ok(format!("/v1/people/{}",segment(resource)))
}
fn nonempty_list(args:&Value,key:&str)->Result<(),String> { if args[key].as_array().map_or(true, Vec::is_empty) { Err(format!("{key} must contain at least one item")) } else { Ok(()) } }
fn header(value:&str)->Result<(),String> { if value.contains(['\r','\n','\0']) { Err("Email headers must not contain CR, LF or NUL".into()) } else { Ok(()) } }
fn mime_base64(bytes:&[u8])->String {
    STANDARD.encode(bytes).as_bytes().chunks(76).map(|line|format!("{}\r\n",String::from_utf8_lossy(line))).collect()
}
fn encoded_subject(value:&str)->String {
    if value.is_empty() {return String::new();}
    let mut words=Vec::new();
    let mut chunk=String::new();
    for c in value.chars() {
        if chunk.len()+c.len_utf8()>42 {words.push(format!("=?UTF-8?B?{}?=",STANDARD.encode(chunk.as_bytes())));chunk.clear();}
        chunk.push(c);
    }
    words.push(format!("=?UTF-8?B?{}?=",STANDARD.encode(chunk.as_bytes())));
    words.join("\r\n ")
}
fn mime_message(message:&Value,reply:Option<(&str,&str,&str)>)->Result<String,String> {
    nonempty_list(message,"to")?;
    if message.get("text").is_none() && message.get("html").is_none() { return Err("message requires text or html".into()); }
    let mut result=String::new();
    for (key,label) in [("to","To"),("cc","Cc"),("bcc","Bcc")] {
        if let Some(values)=message[key].as_array() { let values=values.iter().filter_map(Value::as_str).collect::<Vec<_>>(); for v in &values {header(v)?;} if !values.is_empty(){result.push_str(&format!("{label}: {}\r\n",values.join(", ")));} }
    }
    header(s(message,"subject"))?;
    let subject=if let Some((_,_,subject))=reply {header(subject)?;subject.to_string()}else{encoded_subject(s(message,"subject"))};
    result.push_str(&format!("Subject: {subject}\r\nMIME-Version: 1.0\r\n"));
    if let Some((id,refs,_))=reply { header(id)?;header(refs)?; result.push_str(&format!("In-Reply-To: {id}\r\nReferences: {refs}\r\n")); }
    let alternative=format!("gchat-alt-{}",uuid::Uuid::new_v4());
    let mixed=format!("gchat-mixed-{}",uuid::Uuid::new_v4());
    let mut content=String::new();
    if message.get("text").is_some() && message.get("html").is_some() {
        content.push_str(&format!("Content-Type: multipart/alternative; boundary=\"{alternative}\"\r\n\r\n"));
        for (key,kind) in [("text","plain"),("html","html")] { content.push_str(&format!("--{alternative}\r\nContent-Type: text/{kind}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",mime_base64(s(message,key).as_bytes()))); }
        content.push_str(&format!("--{alternative}--\r\n"));
    } else { let key=if message.get("html").is_some(){"html"}else{"text"}; let kind=if key=="html"{"html"}else{"plain"}; content.push_str(&format!("Content-Type: text/{kind}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",mime_base64(s(message,key).as_bytes()))); }
    if let Some(attachments)=message["attachments"].as_array().filter(|a|!a.is_empty()) {
        result.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{mixed}\"\r\n\r\n--{mixed}\r\n{content}"));
        for attachment in attachments {
            let kind=s(attachment,"mime_type"); header(kind)?;
            if kind.contains([';', '"']) || !kind.contains('/') {return Err("Attachment MIME type must be a bare type/subtype".into());}
            let filename=s(attachment,"filename");header(filename)?;
            let bytes=STANDARD.decode(s(attachment,"data_base64")).map_err(|_|"Attachment data_base64 must be standard base64")?;
            let filename=segment(filename);
            result.push_str(&format!("--{mixed}\r\nContent-Type: {kind}\r\nContent-Disposition: attachment; filename*=UTF-8''{filename}\r\nContent-Transfer-Encoding: base64\r\n\r\n{}",mime_base64(&bytes)));
        }
        result.push_str(&format!("--{mixed}--\r\n"));
    } else { result.push_str(&content); }
    Ok(URL_SAFE_NO_PAD.encode(result))
}
fn multipart(metadata:&Value,mime:&str,data:&str)->Result<(HeaderMap,Vec<u8>),String> {
    header(mime)?;
    if mime.contains([';', '"']) || !mime.contains('/') {return Err("mime_type must be a bare type/subtype".into());}
    let bytes=STANDARD.decode(data).map_err(|_|"data_base64 must be standard base64")?;
    let boundary=format!("gchat-drive-{}",uuid::Uuid::new_v4());
    let mut body=format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n--{boundary}\r\nContent-Type: {mime}\r\n\r\n").into_bytes();
    body.extend_from_slice(&bytes);body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let mut headers=HeaderMap::new();headers.insert(CONTENT_TYPE,HeaderValue::from_str(&format!("multipart/related; boundary={boundary}")).map_err(|e|e.to_string())?);
    Ok((headers,body))
}

pub async fn execute(accounts:&AccountsState,name:&str,args:&Value,cancel:&CancellationToken)->Result<Value,String> {
    let descriptor=tools().into_iter().find(|t|t.name==name).ok_or_else(||format!("Unknown Google tool: {name}"))?;
    validate(&descriptor.input_schema,args,"arguments")?;
    if cancel.is_cancelled() { return Err("Workspace request cancelled".into()); }
    for key in ["message_id","thread_id","draft_id","label_id","attachment_id","calendar_id","event_id","file_id","document_id","spreadsheet_id","presentation_id","task_list_id","task_id","range"] {
        if matches!(s(args,key),"."|"..") {return Err(format!("{key}: dot path segments are not valid resource identifiers"));}
    }
    let account=s(args,"account_id");
    let service=descriptor.service;
    let mut method=Method::GET;
    let mut body=None;
    let mut url;
    if let Some(op)=name.strip_prefix("google.gmail.") {
        let base="https://gmail.googleapis.com/gmail/v1/users/me";
        let message=format!("/messages/{}",segment(s(args,"message_id")));
        let draft=format!("/drafts/{}",segment(s(args,"draft_id")));
        let label=format!("/labels/{}",segment(s(args,"label_id")));
        let path=match op {
            "search"=>"/messages".into(),"read"=>message.clone(),"thread"=>format!("/threads/{}",segment(s(args,"thread_id"))),
            "labels.list"|"labels.create"=>"/labels".into(),"labels.read"|"labels.update"|"labels.delete"=>label,
            "labels.modify"=>format!("{message}/modify"),"drafts.list"|"drafts.create"=>"/drafts".into(),
            "drafts.read"|"drafts.update"|"drafts.delete"=>draft,"drafts.send"=>"/drafts/send".into(),
            "send"|"reply"=>"/messages/send".into(),"attachment"=>format!("{message}/attachments/{}",segment(s(args,"attachment_id"))),
            "trash"|"untrash"=>format!("{message}/{op}"),"delete"=>message,_=>return Err("Unsupported Gmail operation".into())
        };
        url=endpoint(base,&path)?;
        query(&mut url,args,&[("query","q"),("max_results","maxResults"),("page_token","pageToken"),("label_ids","labelIds"),("include_spam_trash","includeSpamTrash"),("format","format"),("metadata_headers","metadataHeaders")]);
        match op {
            "labels.create"|"labels.update"=>{method=if op=="labels.create"{Method::POST}else{Method::PATCH};body=Some(mapped(args,&[("name","name"),("label_list_visibility","labelListVisibility"),("message_list_visibility","messageListVisibility")]));},
            "labels.delete"|"drafts.delete"|"delete"=>method=Method::DELETE,
            "labels.modify"=>{method=Method::POST;body=Some(mapped(args,&[("add_label_ids","addLabelIds"),("remove_label_ids","removeLabelIds")]));},
            "trash"|"untrash"=>{method=Method::POST;body=Some(json!({}));},
            "drafts.send"=>{method=Method::POST;body=Some(json!({"id":s(args,"draft_id")}));},
            "drafts.create"|"drafts.update"|"send"=>{
                method=if op=="drafts.update"{Method::PUT}else{Method::POST};
                let message=json!({"raw":mime_message(&args["message"],None)?});
                body=Some(if op.starts_with("drafts."){json!({"message":message})}else{message});
            },
            "reply"=>{
                let mut parent_url=endpoint(base,&message)?;
                parent_url.query_pairs_mut().append_pair("format","metadata");
                for field in ["Message-ID","References","Subject"] {parent_url.query_pairs_mut().append_pair("metadataHeaders",field);}
                let parent=accounts.request_json(Provider::Google,account,"gmail",Method::GET,parent_url.as_str(),None,cancel).await?;
                let headers=parent["payload"]["headers"].as_array().ok_or("Reply parent has no message headers")?;
                let find=|key:&str|->Option<&str>{headers.iter().find(|h|h["name"].as_str().is_some_and(|n|n.eq_ignore_ascii_case(key))).and_then(|h|h["value"].as_str())};
                let id=find("Message-ID").ok_or("Reply parent has no Message-ID")?;
                let subject=find("Subject").ok_or("Reply parent has no Subject")?;
                if args["message"].get("subject").is_some() && s(&args["message"],"subject")!=subject {return Err("Reply subject must exactly match the parent Subject header, or be omitted".into());}
                let mut reply_message=args["message"].clone();reply_message["subject"]=json!(subject);
                let refs=format!("{} {id}",find("References").unwrap_or("")).trim().to_string();
                let thread=parent["threadId"].as_str().ok_or("Reply parent has no threadId")?;
                method=Method::POST;body=Some(json!({"threadId":thread,"raw":mime_message(&reply_message,Some((id,&refs,subject)))?}));
            },_=>{}
        }
    } else if let Some(op)=name.strip_prefix("google.calendar.") {
        let path=match op {"calendars"=>"/users/me/calendarList".into(),"freebusy"=>"/freeBusy".into(),"list"|"create"=>format!("/calendars/{}/events",segment(s(args,"calendar_id"))),_=>format!("/calendars/{}/events/{}",segment(s(args,"calendar_id")),segment(s(args,"event_id")))};
        url=endpoint("https://www.googleapis.com/calendar/v3",&path)?;
        query(&mut url,args,&[("page_token","pageToken"),("max_results","maxResults"),("show_hidden","showHidden"),("query","q"),("time_min","timeMin"),("time_max","timeMax"),("sync_token","syncToken"),("single_events","singleEvents"),("order_by","orderBy"),("show_deleted","showDeleted"),("send_updates","sendUpdates")]);
        match op {
            "create"|"update"=>{
                let event=&args["event"];
                if op=="create" && (event.get("start").is_none()||event.get("end").is_none()){return Err("Event creation requires start and end".into());}
                for key in ["start","end"] {if let Some(time)=event.get(key){if time.get("date").is_some()==time.get("dateTime").is_some(){return Err(format!("event.{key} requires exactly one of date or dateTime"));}}}
                method=if op=="create"{Method::POST}else{Method::PATCH};let mut value=event.clone();
                if args["create_meet"]==true {url.query_pairs_mut().append_pair("conferenceDataVersion","1");value["conferenceData"]=json!({"createRequest":{"requestId":uuid::Uuid::new_v4().to_string(),"conferenceSolutionKey":{"type":"hangoutsMeet"}}});}
                body=Some(value);
            },
            "delete"=>method=Method::DELETE,
            "freebusy"=>{nonempty_list(args,"calendar_ids")?;method=Method::POST;body=Some(json!({"timeMin":s(args,"time_min"),"timeMax":s(args,"time_max"),"items":args["calendar_ids"].as_array().unwrap().iter().map(|id|json!({"id":id})).collect::<Vec<_>>()}));if let Some(tz)=args.get("time_zone"){body.as_mut().unwrap()["timeZone"]=tz.clone();}url.set_query(None);},_=>{}
        }
    } else if let Some(op)=name.strip_prefix("google.drive.") {
        let file=format!("/files/{}",segment(s(args,"file_id")));
        let path=match op {"search"|"upload"|"createfolder"=>"/files".into(),"share"=>format!("{file}/permissions"),_=>file};
        url=endpoint("https://www.googleapis.com/drive/v3",&path)?;
        url.query_pairs_mut().append_pair("supportsAllDrives","true");
        match op {
            "search"=>{
                url.set_query(None);query(&mut url,args,&[("query","q"),("page_size","pageSize"),("page_token","pageToken"),("fields","fields"),("order_by","orderBy"),("drive_id","driveId")]);
                url.query_pairs_mut().append_pair("includeItemsFromAllDrives","true").append_pair("supportsAllDrives","true");
                if args.get("fields").is_none(){url.query_pairs_mut().append_pair("fields","nextPageToken,files(id,name,mimeType,size,parents,modifiedTime,trashed)");}
                if args.get("drive_id").is_some(){url.query_pairs_mut().append_pair("corpora","drive");}
            },
            "metadata"=>{url.query_pairs_mut().append_pair("fields",args["fields"].as_str().unwrap_or("id,name,mimeType,size,parents,modifiedTime,trashed,capabilities,permissions"));},
            "download"=>{
                let mut meta=url.clone();meta.query_pairs_mut().append_pair("fields","id,name,mimeType,size");
                let metadata=accounts.request_json(Provider::Google,account,service,Method::GET,meta.as_str(),None,cancel).await?;
                if metadata["mimeType"].as_str().is_some_and(|m|m.starts_with("application/vnd.google-apps.")){return Err("Workspace documents require export, not alt=media download".into());}
                url.query_pairs_mut().append_pair("alt","media");
                let bytes=accounts.request_bytes(Provider::Google,account,service,Method::GET,url.as_str(),HeaderMap::new(),None,cancel).await?;
                return Ok(json!({"file":metadata,"encoding":"base64","data_base64":STANDARD.encode(&bytes),"byte_length":bytes.len()}));
            },
            "upload"|"createfolder"|"update"=>{
                method=if op=="update"{Method::PATCH}else{Method::POST};
                let mut metadata=mapped(args,&[("name","name"),("description","description"),("starred","starred"),("parent_ids","parents"),("mime_type","mimeType")]);
                if op=="createfolder" {metadata["mimeType"]=json!("application/vnd.google-apps.folder");}
                if args.get("data_base64").is_some(){
                    if s(args,"mime_type").is_empty(){return Err("mime_type is required when replacing file bytes".into());}
                    let upload_path=if op=="upload"{"/files".into()}else{format!("/files/{}",segment(s(args,"file_id")))};
                    let mut upload=endpoint("https://www.googleapis.com/upload/drive/v3",&upload_path)?;upload.query_pairs_mut().append_pair("uploadType","multipart").append_pair("supportsAllDrives","true").append_pair("fields","id,name,mimeType,size,parents");
                    let (headers,data)=multipart(&metadata,s(args,"mime_type"),s(args,"data_base64"))?;
                    let response=accounts.request_bytes(Provider::Google,account,service,method,upload.as_str(),headers,Some(data),cancel).await?;
                    return serde_json::from_slice(&response).map_err(|e|format!("Invalid Drive upload response: {e}"));
                }
                body=Some(metadata);
            },
            "move"=>{if csv(args,"add_parent_ids").is_empty()&&csv(args,"remove_parent_ids").is_empty(){return Err("Move requires parent IDs to add or remove".into());}method=Method::PATCH;body=Some(json!({}));for (input,api) in [("add_parent_ids","addParents"),("remove_parent_ids","removeParents")]{if args.get(input).is_some(){url.query_pairs_mut().append_pair(api,&csv(args,input));}}},
            "share"=>{
                let kind=s(args,"type");if matches!(kind,"user"|"group")&&s(args,"email_address").is_empty(){return Err("User/group permission requires email_address".into());}if kind=="domain"&&s(args,"domain").is_empty(){return Err("Domain permission requires domain".into());}
                if s(args,"role")=="owner"&&args["transfer_ownership"]!=true{return Err("Owner permission requires explicit transfer_ownership=true".into());}
                method=Method::POST;body=Some(mapped(args,&[("type","type"),("role","role"),("email_address","emailAddress"),("domain","domain"),("allow_file_discovery","allowFileDiscovery")]));
                query(&mut url,args,&[("send_notification_email","sendNotificationEmail"),("email_message","emailMessage"),("transfer_ownership","transferOwnership")]);
            },
            "trash"=>{method=Method::PATCH;body=Some(json!({"trashed":true}));},_=>{}
        }
    } else if name=="google.docs.export" {
        url=endpoint("https://www.googleapis.com/drive/v3",&format!("/files/{}/export",segment(s(args,"document_id"))))?;
        url.query_pairs_mut().append_pair("mimeType",s(args,"mime_type"));
        let bytes=accounts.request_bytes(Provider::Google,account,service,Method::GET,url.as_str(),HeaderMap::new(),None,cancel).await?;
        return Ok(json!({"document_id":s(args,"document_id"),"mime_type":s(args,"mime_type"),"encoding":"base64","data_base64":STANDARD.encode(&bytes),"byte_length":bytes.len()}));
    } else if name.starts_with("google.docs.")||name.starts_with("google.slides.") {
        let docs=service=="docs";let kind=if docs{"documents"}else{"presentations"};let id=s(args,if docs{"document_id"}else{"presentation_id"});
        let op=name.rsplit('.').next().unwrap_or("");
        let path=if op=="create"{format!("/v1/{kind}")}else{format!("/v1/{kind}/{}{}",segment(id),if op=="edit"{":batchUpdate"}else{""})};
        url=endpoint(if docs{"https://docs.googleapis.com"}else{"https://slides.googleapis.com"},&path)?;
        if op=="create"{method=Method::POST;body=Some(json!({"title":s(args,"title")}));}
        else if op=="edit"{nonempty_list(args,"requests")?;method=Method::POST;let mut value=json!({"requests":args["requests"]});if let Some(revision)=args.get("required_revision_id"){value["writeControl"]=json!({"requiredRevisionId":revision});}body=Some(value);}
        else if docs{url.query_pairs_mut().append_pair("includeTabsContent","true");}
    } else if let Some(op)=name.strip_prefix("google.sheets.") {
        let base="https://sheets.googleapis.com/v4/spreadsheets";
        let path=match op {"create"=>String::new(),"metadata"=>format!("/{}",segment(s(args,"spreadsheet_id"))),_=>format!("/{}/values/{}{}",segment(s(args,"spreadsheet_id")),segment(s(args,"range")),if op=="append"{":append"}else{""})};
        url=endpoint(base,&path)?;
        match op {
            "read"=>query(&mut url,args,&[("value_render_option","valueRenderOption"),("date_time_render_option","dateTimeRenderOption")]),
            "metadata"=>{url.query_pairs_mut().append_pair("fields","spreadsheetId,spreadsheetUrl,properties,sheets.properties");},
            "create"=>{method=Method::POST;let mut value=json!({"properties":{"title":s(args,"title")}});if let Some(titles)=args["sheet_titles"].as_array(){value["sheets"]=Value::Array(titles.iter().map(|title|json!({"properties":{"title":title}})).collect());}body=Some(value);},
            "write"|"append"=>{if op=="write"&&args.get("insert_data_option").is_some(){return Err("insert_data_option is only supported for append".into());}method=if op=="write"{Method::PUT}else{Method::POST};query(&mut url,args,&[("value_input_option","valueInputOption"),("insert_data_option","insertDataOption")]);body=Some(mapped(args,&[("range","range"),("values","values"),("major_dimension","majorDimension")]));},_=>{}
        }
    } else if let Some(op)=name.strip_prefix("google.people.") {
        let path=match op {"list"=>"/v1/people/me/connections".into(),"search"=>"/v1/people:searchContacts".into(),"create"=>"/v1/people:createContact".into(),"update"=>format!("{}:updateContact",person_path(args)?),"delete"=>format!("{}:deleteContact",person_path(args)?),_=>person_path(args)?};
        url=endpoint("https://people.googleapis.com",&path)?;
        let fields=args["person_fields"].as_str().unwrap_or("names,emailAddresses,phoneNumbers,organizations,metadata");
        match op {
            "list"|"read"=>{url.query_pairs_mut().append_pair("personFields",fields);query(&mut url,args,&[("page_size","pageSize"),("page_token","pageToken")]);},
            "search"=>{
                url.query_pairs_mut().append_pair("readMask",args["read_mask"].as_str().unwrap_or("names,emailAddresses,phoneNumbers,organizations,metadata"));
                query(&mut url,args,&[("page_size","pageSize")]);
                let mut warmup=url.clone();warmup.query_pairs_mut().append_pair("query","");
                accounts.request_json(Provider::Google,account,service,Method::GET,warmup.as_str(),None,cancel).await?;
                url.query_pairs_mut().append_pair("query",s(args,"query"));
            },
            "create"=>{method=Method::POST;body=Some(args["person"].clone());url.query_pairs_mut().append_pair("personFields",fields);},
            "update"=>{
                nonempty_list(args,"update_fields")?;
                for field in args["update_fields"].as_array().unwrap().iter().filter_map(Value::as_str){if args["person"].get(field).is_none(){return Err(format!("person.{field} must be explicitly supplied (empty array clears it)"));}}
                method=Method::PATCH;let mut person=args["person"].clone();person["resourceName"]=json!(s(args,"resource_name"));person["metadata"]=json!({"sources":[{"type":"CONTACT","id":s(args,"source_id"),"etag":s(args,"source_etag")}]});
                body=Some(person);url.query_pairs_mut().append_pair("updatePersonFields",&csv(args,"update_fields")).append_pair("personFields",fields);
            },"delete"=>method=Method::DELETE,_=>{}
        }
    } else if let Some(op)=name.strip_prefix("google.tasks.") {
        let list=format!("/users/@me/lists/{}",segment(s(args,"task_list_id")));
        let tasks=format!("/lists/{}/tasks",segment(s(args,"task_list_id")));
        let task=format!("{tasks}/{}",segment(s(args,"task_id")));
        let path=match op {"lists"|"list_create"=>"/users/@me/lists".into(),"list_update"|"list_delete"=>list,"list"|"create"=>tasks,"move"=>format!("{task}/move"),_=>task};
        url=endpoint("https://tasks.googleapis.com/tasks/v1",&path)?;
        query(&mut url,args,&[("max_results","maxResults"),("page_token","pageToken"),("show_completed","showCompleted"),("show_hidden","showHidden"),("show_deleted","showDeleted"),("due_min","dueMin"),("due_max","dueMax"),("updated_min","updatedMin"),("parent","parent"),("previous","previous")]);
        match op {"list_create"|"list_update"=>{method=if op=="list_create"{Method::POST}else{Method::PATCH};body=Some(json!({"title":s(args,"title")}));},"list_delete"|"delete"=>method=Method::DELETE,"create"|"update"=>{if op=="create"&&s(&args["task"],"title").is_empty(){return Err("New task requires a title".into());}method=if op=="create"{Method::POST}else{Method::PATCH};body=Some(args["task"].clone());},"move"=>{method=Method::POST;body=Some(json!({}));},_=>{}}
    } else { return Err("Unsupported Google operation".into()); }
    accounts.request_json(Provider::Google,account,service,method,url.as_str(),body,cancel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compose_unicode_mail_with_attachment_and_reply_headers() {
        let raw=mime_message(&json!({"to":["reader@example.com"],"subject":"Résumé","text":"Plain body","html":"<b>HTML</b>","attachments":[{"filename":"résumé.txt","mime_type":"text/plain","data_base64":"AAECAw=="}]}),Some(("<parent@example.com>","<old@example.com> <parent@example.com>","=?UTF-8?B?UsOpc3Vtw6k=?="))).unwrap();
        let decoded=String::from_utf8(URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(decoded.contains("Subject: =?UTF-8?B?UsOpc3Vtw6k=?=\r\n"));
        assert!(decoded.contains("In-Reply-To: <parent@example.com>\r\nReferences: <old@example.com> <parent@example.com>\r\n"));
        assert!(decoded.contains("Content-Type: multipart/alternative"));
        assert!(decoded.contains("filename*=UTF-8''r%C3%A9sum%C3%A9.txt"));
        assert!(decoded.contains("AAECAw==\r\n"));
        assert!(!decoded.contains("From:"));
    }

    #[test]
    fn rejects_header_injection_and_invalid_attachment_bytes() {
        let injected=json!({"to":["reader@example.com\r\nBcc: other@example.com"],"subject":"subject","text":"body"});
        assert!(mime_message(&injected,None).is_err());
        let corrupt=json!({"to":["reader@example.com"],"subject":"subject","text":"body","attachments":[{"filename":"a","mime_type":"text/plain","data_base64":"%%%"}]});
        assert!(mime_message(&corrupt,None).is_err());
    }

    #[test]
    fn strict_edit_schema_rejects_unadvertised_operations() {
        let descriptor=tools().into_iter().find(|t|t.name=="google.docs.edit").unwrap();
        assert!(validate(&descriptor.input_schema,&json!({"document_id":"d","requests":[{"insertText":{"text":"hello","location":{"index":1}}}]}),"args").is_ok());
        assert!(validate(&descriptor.input_schema,&json!({"document_id":"d","requests":[{"unadvertisedOperation":{}}]}),"args").is_err());
        assert!(validate(&descriptor.input_schema,&json!({"document_id":"d","requests":[{"insertText":{"text":"hello","location":{"index":1},"url":"https://elsewhere.invalid"}}]}),"args").is_err());
    }

    #[test]
    fn identifier_and_range_cannot_inject_paths_or_queries() {
        let id="a/b?alt=media#fragment";
        let url=endpoint("https://www.googleapis.com/drive/v3",&format!("/files/{}",segment(id))).unwrap();
        assert_eq!(url.host_str(),Some("www.googleapis.com"));
        assert_eq!(url.path(),"/drive/v3/files/a%2Fb%3Falt%3Dmedia%23fragment");
        assert!(url.query().is_none());
        assert!(url.fragment().is_none());
        let range="'Sales / Q1'!A1:C9";
        let url=endpoint("https://sheets.googleapis.com/v4/spreadsheets",&format!("/id/values/{}",segment(range))).unwrap();
        assert_eq!(url.path(),"/v4/spreadsheets/id/values/%27Sales%20%2F%20Q1%27%21A1%3AC9");
    }

    #[test]
    fn upload_multipart_preserves_raw_bytes_and_metadata() {
        let (headers,bytes)=multipart(&json!({"name":"résumé","parents":["folder"]}),"application/octet-stream","AAECAw==").unwrap();
        let mime=headers[CONTENT_TYPE].to_str().unwrap();
        let boundary=mime.strip_prefix("multipart/related; boundary=").unwrap();
        let prefix=format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{{\"name\":\"résumé\",\"parents\":[\"folder\"]}}\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\n\r\n");
        assert!(bytes.starts_with(prefix.as_bytes()));
        assert_eq!(&bytes[prefix.len()..prefix.len()+4],&[0,1,2,3]);
        assert!(bytes.ends_with(format!("\r\n--{boundary}--\r\n").as_bytes()));
    }
}
