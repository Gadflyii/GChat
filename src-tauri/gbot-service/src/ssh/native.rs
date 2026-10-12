//! Native controls use foreground input; typed browser operations stay Driver-owned.
use super::guest::DesktopTool;
use serde_json::{json, Map, Value};

const READS: &[&str] = &[
    "list_windows",
    "get_window_state",
    "get_desktop_state",
    "verify_state",
];

// The pinned Driver owns page binding, session-scoped refs and browser delivery.
// Preserve its schemas rather than applying the native window-input adapter.
const BROWSER_TOOLS: &[&str] = &[
    "get_browser_state",
    "browser_prepare",
    "browser_navigate",
    "browser_click",
    "browser_type",
    "browser_dialog",
    "browser_set_input_files",
    "browser_download",
    "browser_pointer",
];

fn fields(tool: &str) -> &'static [&'static str] {
    match tool {
        "click" => &[
            "session",
            "pid",
            "window_id",
            "element_token",
            "button",
            "count",
            "modifier",
        ],
        "type_text" => &["session", "pid", "window_id", "text"],
        "press_key" => &["session", "pid", "window_id", "key", "modifiers"],
        "hotkey" => &["session", "pid", "window_id", "keys"],
        _ => &[],
    }
}

pub(super) fn catalog(tools: Vec<DesktopTool>) -> Vec<DesktopTool> {
    tools.into_iter().filter_map(|mut tool| {
        if READS.contains(&tool.name.as_str()) || BROWSER_TOOLS.contains(&tool.name.as_str()) {
            return Some(tool);
        }
        let allowed = fields(&tool.name);
        if allowed.is_empty() { return None; }
        let mut properties = tool.input_schema["properties"].as_object()?.clone();
        properties.retain(|key, _| allowed.contains(&key.as_str()));
        properties.insert("pid".into(), json!({"type":"integer","minimum":1}));
        properties.insert("window_id".into(), json!({"type":"integer","minimum":1}));
        let mut required = vec!["pid", "window_id"];
        let action_field = match tool.name.as_str() {
            "click" => "element_token", "type_text" => "text", "press_key" => "key", _ => "keys",
        };
        required.push(action_field);
        tool.input_schema = json!({"type":"object","properties":properties,"required":required,"additionalProperties":false});
        tool.description = match tool.name.as_str() {
            "click" => "Click the visible control identified by element_token from the latest get_window_state for pid/window_id, using real foreground input. Hidden or disabled controls are refused; open their menu first. Reinspect after input before using another token.",
            "type_text" => "Type text into the focused control of pid/window_id using real foreground keyboard input. Click the desired visible control first. This does not set accessibility values.",
            "press_key" => "Press key with optional modifiers in pid/window_id using real foreground keyboard input.",
            _ => "Press the keys chord in pid/window_id using real foreground keyboard input.",
        }.into();
        Some(tool)
    }).collect()
}

#[derive(Default)]
pub(super) struct Input {
    snapshot: Option<Value>,
    browser_observation_required: bool,
}

fn refused(code: &str, text: &str) -> Value {
    json!({"isError":true,"structuredContent":{"code":code,"effect":"none"},"content":[{"type":"text","text":text}]})
}

impl Input {
    pub(super) fn observe(&mut self, tool: &str, result: &Value) {
        if tool == "get_desktop_state" && result["isError"] != true {
            self.snapshot = None;
            self.browser_observation_required = true;
        }
        if tool == "get_browser_state" && result["isError"] != true {
            self.browser_observation_required = false;
        }
        if tool == "get_window_state" {
            self.snapshot =
                (result["isError"] != true).then(|| result["structuredContent"].clone());
        }
    }

    pub(super) fn prepare(&mut self, tool: &str, arguments: &Value) -> Result<Value, Value> {
        if READS.contains(&tool) {
            return Ok(arguments.clone());
        }
        if BROWSER_TOOLS.contains(&tool) {
            if self.browser_observation_required
                && !matches!(tool, "get_browser_state" | "browser_prepare")
            {
                return Err(refused("stale_browser_state", "Read get_browser_state after the desktop changed before using browser actions or refs."));
            }
            if tool != "get_browser_state" {
                self.snapshot = None;
            }
            return Ok(arguments.clone());
        }
        let allowed = fields(tool);
        let invalid = || {
            refused("invalid_native_input", "Use the tool's foreground-input schema; accessibility actions and targeting are unavailable.")
        };
        let Some(args) = arguments.as_object() else {
            return Err(invalid());
        };
        if allowed.is_empty()
            || args.keys().any(|key| !allowed.contains(&key.as_str()))
            || args
                .get("pid")
                .and_then(Value::as_u64)
                .is_none_or(|n| n == 0)
            || args
                .get("window_id")
                .and_then(Value::as_u64)
                .is_none_or(|n| n == 0)
        {
            return Err(invalid());
        }
        let mut native: Map<String, Value> = args.clone();
        if tool == "click" {
            let token = args
                .get("element_token")
                .and_then(Value::as_str)
                .ok_or_else(invalid)?;
            let snapshot = self.snapshot.as_ref().filter(|snapshot|
                snapshot["pid"] == args["pid"] && snapshot["window_id"] == args["window_id"])
                .ok_or_else(|| refused("stale_element", "Inspect this window before clicking; the previous input invalidated its tokens."))?;
            let element = snapshot["elements"]
                .as_array()
                .and_then(|elements| {
                    elements
                        .iter()
                        .find(|element| element["element_token"] == token)
                })
                .ok_or_else(|| {
                    refused(
                        "stale_element",
                        "The token is not in the current window observation.",
                    )
                })?;
            let frame = &element["frame"];
            let bounds = &snapshot["window_bounds"];
            let point = (|| {
                if element["enabled"] == false || element["showing"] == false { return None; }
                let x = frame["x"].as_f64()?;
                let y = frame["y"].as_f64()?;
                let w = frame["w"].as_f64()?;
                let h = frame["h"].as_f64()?;
                let bx = bounds["x"].as_f64()?;
                let by = bounds["y"].as_f64()?;
                let bw = bounds["width"].as_f64()?;
                let bh = bounds["height"].as_f64()?;
                let cx = x + w / 2.;
                let cy = y + h / 2.;
                (w > 0. && h > 0. && cx >= bx && cy >= by && cx < bx + bw && cy < by + bh)
                    .then_some((cx, cy))
            })().ok_or_else(|| refused("element_not_visible", "No enabled control geometry lies in this window. Open the menu or inspect its popup window first."))?;
            native.remove("element_token");
            native.insert("x".into(), point.0.into());
            native.insert("y".into(), point.1.into());
            native.insert("coordinate_frame".into(), "desktop".into());
        } else {
            let valid = match tool {
                "type_text" => args.get("text").is_some_and(Value::is_string),
                "press_key" => args
                    .get("key")
                    .and_then(Value::as_str)
                    .is_some_and(|key| !key.is_empty()),
                "hotkey" => args
                    .get("keys")
                    .and_then(Value::as_array)
                    .is_some_and(|keys| {
                        keys.len() >= 2
                            && keys
                                .iter()
                                .all(|key| key.as_str().is_some_and(|key| !key.is_empty()))
                    }),
                _ => false,
            };
            if !valid {
                return Err(invalid());
            }
        }
        native.insert("delivery_mode".into(), "foreground".into());
        self.snapshot = None;
        Ok(Value::Object(native))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observed() -> Input {
        let mut input = Input::default();
        input.observe("get_window_state", &json!({"structuredContent":{"pid":42,"window_id":7,
            "window_bounds":{"x":100,"y":200,"width":640,"height":480},
            "elements":[{"element_token":"fresh","frame":{"x":120,"y":230,"w":40,"h":20},"enabled":true},
                {"element_token":"hidden"},{"element_token":"disabled","enabled":false,"frame":{"x":120,"y":230,"w":40,"h":20}},
                {"element_token":"outside","frame":{"x":-500,"y":-500,"w":40,"h":20}}]}}));
        input
    }

    #[test]
    fn visible_click_uses_native_coordinates_and_consumes_tokens() {
        let mut input = observed();
        let args = json!({"pid":42,"window_id":7,"element_token":"fresh","count":2});
        assert_eq!(
            input.prepare("click", &args).unwrap(),
            json!({"pid":42,"window_id":7,"x":140.0,"y":240.0,"count":2,"coordinate_frame":"desktop","delivery_mode":"foreground"})
        );
        assert_eq!(
            input.prepare("click", &args).unwrap_err()["structuredContent"]["code"],
            "stale_element"
        );
    }

    #[test]
    fn browser_catalog_and_actions_preserve_driver_capabilities() {
        use crate::contract::{GuestCapability, GuestOperationKind};

        let schema = json!({"type":"object","properties":{
            "session":{"type":"string"},"target_id":{"type":"string"},
            "tab_id":{"type":"string"},"ref":{"type":"string"},
            "profile":{"type":"object"},"allow_launch":{"type":"boolean"},
            "snapshot_format":{"enum":["dom_refs_v1","semantic_v2"]},
            "include_screenshot":{"type":"boolean"},
            "delivery_mode":{"enum":["background","foreground"]}
        },"additionalProperties":false});
        let tools = catalog(
            BROWSER_TOOLS
                .iter()
                .chain(["execute_javascript"].iter())
                .map(|name| DesktopTool {
                    name: (*name).into(),
                    description: format!("Driver {name}"),
                    input_schema: schema.clone(),
                })
                .collect(),
        );
        assert_eq!(tools.len(), BROWSER_TOOLS.len());
        for tool in &tools {
            assert_eq!(tool.input_schema, schema);
            assert_eq!(tool.description, format!("Driver {}", tool.name));
        }

        let mut input = observed();
        for (tool, arguments) in [
            (
                "browser_prepare",
                json!({"session":"owned","allow_launch":true,"profile":{"mode":"isolated_new"}}),
            ),
            (
                "get_browser_state",
                json!({"session":"owned","pid":42,"window_id":7}),
            ),
            (
                "browser_navigate",
                json!({"session":"owned","target_id":"target","tab_id":"tab","url":"http://127.0.0.1:8000/"}),
            ),
            (
                "get_browser_state",
                json!({"session":"owned","target_id":"target","tab_id":"tab","snapshot_format":"semantic_v2","include_screenshot":false}),
            ),
            (
                "browser_type",
                json!({"session":"owned","target_id":"target","tab_id":"tab","ref":"p1:2","text":"Hello from Gbot."}),
            ),
            (
                "browser_click",
                json!({"session":"owned","target_id":"target","tab_id":"tab","ref":"p2:3","delivery_mode":"foreground"}),
            ),
            (
                "browser_dialog",
                json!({"session":"owned","target_id":"target","tab_id":"tab","action":"inspect"}),
            ),
            (
                "browser_set_input_files",
                json!({"session":"owned","target_id":"target","tab_id":"tab","ref":"p3:4","files":["/home/bot/hello.txt"]}),
            ),
            (
                "browser_download",
                json!({"session":"owned","target_id":"target","tab_id":"tab","ref":"p3:5","destination_root":"/home/bot/Downloads"}),
            ),
            (
                "browser_pointer",
                json!({"session":"owned","target_id":"target","tab_id":"tab","action":"hover","ref":"p3:5"}),
            ),
        ] {
            assert!(tools.iter().any(|definition| definition.name == tool));
            assert_eq!(input.prepare(tool, &arguments).unwrap(), arguments);
            let capability = GuestOperationKind::Desktop {
                tool: tool.into(),
                arguments,
            }
            .capability();
            assert_eq!(
                capability,
                if tool == "get_browser_state" {
                    GuestCapability::DesktopCapture
                } else {
                    GuestCapability::DesktopInput
                }
            );
        }
        assert_eq!(
            input
                .prepare(
                    "click",
                    &json!({"pid":42,"window_id":7,"element_token":"fresh"})
                )
                .unwrap_err()["structuredContent"]["code"],
            "stale_element"
        );
        assert!(input
            .prepare("execute_javascript", &json!({"script":"1+1"}))
            .is_err());

        let page = json!({"status":"ok","target_id":"target","tab_id":"tab",
            "binding_quality":"exact","mutation_allowed":true,"snapshot":{"id":"p3"},
            "outline":[{"role":"textbox","name":"Message","ref":"p3:2"}],
            "refs":{"p3:2":{"role":"textbox","actions":["type"],"value":"Hello from Gbot."}},
            "content_refs":{"p3:3":{"text":"Saved"}}});
        let raw = json!({"isError":false,"structuredContent":page,"content":[{"type":"text","text":"duplicate page"}]});
        let mut expected = page;
        expected["isError"] = false.into();
        assert_eq!(
            super::super::projection::desktop_model_result(&raw),
            expected
        );

        let mut input = observed();
        input.observe(
            "get_desktop_state",
            &json!({"isError":false,"structuredContent":{"windows":[]}}),
        );
        assert_eq!(
            input
                .prepare(
                    "browser_click",
                    &json!({"target_id":"target","tab_id":"tab","ref":"old"})
                )
                .unwrap_err()["structuredContent"]["effect"],
            "none"
        );
        input.observe("get_browser_state", &raw);
        assert!(input
            .prepare(
                "browser_click",
                &json!({"target_id":"target","tab_id":"tab","ref":"fresh"})
            )
            .is_ok());
        assert_eq!(
            input
                .prepare(
                    "click",
                    &json!({"pid":42,"window_id":7,"element_token":"fresh"})
                )
                .unwrap_err()["structuredContent"]["code"],
            "stale_element"
        );
    }

    #[test]
    fn hidden_disabled_wrong_window_and_ax_targeting_never_dispatch() {
        for token in ["hidden", "disabled", "outside", "old"] {
            assert_eq!(
                observed()
                    .prepare(
                        "click",
                        &json!({"pid":42,"window_id":7,"element_token":token})
                    )
                    .unwrap_err()["structuredContent"]["effect"],
                "none"
            );
        }
        assert!(observed()
            .prepare(
                "click",
                &json!({"pid":43,"window_id":7,"element_token":"fresh"})
            )
            .is_err());
        for tool in [
            "invoke_menu",
            "set_value",
            "type_text",
            "press_key",
            "hotkey",
        ] {
            assert!(observed().prepare(tool, &json!({"pid":42,"window_id":7,"element_token":"fresh","text":"hello","key":"enter","keys":["ctrl","s"]})).is_err());
        }
        for (tool, field) in [
            ("type_text", json!({"text":"hello"})),
            ("press_key", json!({"key":"enter"})),
            ("hotkey", json!({"keys":["ctrl","s"]})),
        ] {
            let mut args = field;
            args["pid"] = 42.into();
            args["window_id"] = 7.into();
            let result = observed().prepare(tool, &args).unwrap();
            assert_eq!(result["delivery_mode"], "foreground");
            assert!(result.get("element_token").is_none());
        }
    }
}
