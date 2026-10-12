//! Accessibility observations identify controls; only foreground input activates them.
use super::guest::DesktopTool;
use serde_json::{json, Map, Value};

#[derive(serde::Deserialize, serde::Serialize)]
pub(super) struct WindowBinding {
    target_window: u64,
    active_window: u64,
    target_pid: Option<u64>,
    active_pid: Option<u64>,
    override_redirect: bool,
    mapped: bool,
    transient_for: Option<u64>,
    same_client: bool,
}

pub(super) fn bind_popup(native: &mut Value, binding: &WindowBinding) -> Result<(), Value> {
    let target = native["window_id"].as_u64();
    if target != Some(binding.target_window) {
        return Err(refused("window_changed", "The observed window no longer matches the input target."));
    }
    if !binding.override_redirect && binding.transient_for.is_none()
        || binding.active_window == binding.target_window
    {
        return Ok(());
    }
    let owner = binding.active_pid.filter(|pid| *pid > 0);
    let requested_pid = native["pid"].as_u64();
    let observed_owner = binding.target_pid.or(owner);
    let owned = owner.is_some() && requested_pid == observed_owner
        && (binding.same_client
            || binding.target_pid == owner
            || binding.transient_for == Some(binding.active_window));
    if !binding.mapped || binding.active_window == 0 || !owned {
        return Err(refused("popup_owner_unverified", "The popup is not owned by the active window; no foreground input was sent."));
    }
    native["window_id"] = binding.active_window.into();
    native["pid"] = owner.unwrap().into();
    Ok(())
}

const READS: &[&str] = &[
    "list_windows",
    "get_window_state",
    "get_desktop_state",
    "verify_state",
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
        if READS.contains(&tool.name.as_str()) {
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
}

pub(super) fn refused(code: &str, text: &str) -> Value {
    json!({"isError":true,"structuredContent":{"code":code,"effect":"none"},"content":[{"type":"text","text":text}]})
}

impl Input {
    pub(super) fn observe(&mut self, tool: &str, result: &Value) {
        if tool == "get_window_state" {
            self.snapshot =
                (result["isError"] != true).then(|| result["structuredContent"].clone());
        }
    }

    pub(super) fn prepare(&mut self, tool: &str, arguments: &Value) -> Result<Value, Value> {
        if READS.contains(&tool) {
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

    #[test]
    fn popup_routing_requires_active_owner_and_preserves_screen_geometry() {
        let mut binding = WindowBinding { target_window: 7, active_window: 8,
            target_pid: None, active_pid: Some(42), override_redirect: true,
            mapped: true, transient_for: None, same_client: true };
        let original = json!({"window_id":7,"pid":42,"x":140.0,"y":240.0,
            "coordinate_frame":"desktop","delivery_mode":"foreground"});
        let mut input = original.clone();
        bind_popup(&mut input, &binding).unwrap();
        assert_eq!(input["window_id"], 8);
        assert_eq!(input["x"], original["x"]);
        assert_eq!(input["y"], original["y"]);
        assert_eq!(input["delivery_mode"], "foreground");
        binding.same_client = false;
        assert!(bind_popup(&mut original.clone(), &binding).is_err());
        binding.target_pid = Some(42);
        assert!(bind_popup(&mut original.clone(), &binding).is_ok());
        binding.active_pid = Some(84);
        assert!(bind_popup(&mut original.clone(), &binding).is_err());
        binding.transient_for = Some(8);
        input = original.clone();
        bind_popup(&mut input, &binding).unwrap();
        assert_eq!(input["pid"], 84);
        binding.mapped = false;
        assert!(bind_popup(&mut original.clone(), &binding).is_err());
        binding.mapped = true;
        binding.active_pid = None;
        assert!(bind_popup(&mut original.clone(), &binding).is_err());
        binding.target_window = 99;
        assert!(bind_popup(&mut original.clone(), &binding).is_err());
    }

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
