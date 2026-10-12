//! One text-only model representation; raw MCP replies remain the task receipt.
use serde_json::{json, Value};

pub fn desktop_model_result(reply: &Value) -> Value {
    let Some(structured) = reply.get("structuredContent").and_then(Value::as_object) else {
        let mut result = reply.clone();
        if let Some(content) = result.get_mut("content").and_then(Value::as_array_mut) {
            content.retain(|item| item["type"] != "image");
        }
        return result;
    };
    let mut result = structured.clone();
    result.remove("tree_markdown");
    result.remove("_note");
    if let Some(elements) = result.get_mut("elements").and_then(Value::as_array_mut) {
        for element in elements {
            if let Some(fields) = element.as_object() {
                let mut state = fields.clone();
                state.remove("actions");
                let role = state.remove("role").unwrap_or(Value::Null);
                let name = state.remove("label").unwrap_or(Value::Null);
                let token = state.remove("element_token").unwrap_or(Value::Null);
                *element = json!({"role":role,"name":name,"element_token":token,"state":state});
            }
        }
    }
    if let Some(error) = reply.get("isError") {
        result.insert("isError".into(), error.clone());
        if error == &Value::Bool(true) {
            if let Some(content) = reply.get("content").and_then(Value::as_array) {
                result.insert(
                    "content".into(),
                    Value::Array(
                        content
                            .iter()
                            .filter(|item| item["type"] != "image")
                            .cloned()
                            .collect(),
                    ),
                );
            }
        }
    }
    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_tree_preserves_action_state_and_raw_reply() {
        let raw = json!({"content":[{"type":"text","text":"duplicate tree"},{"type":"image","data":"raw-frame"}],"structuredContent":{"tree_markdown":"duplicate tree","_note":"prefer elements","snapshot_id":"s1","truncated":true,"elements_complete":false,"elements":[{"role":"entry","label":"Filename","element_token":"s1:4","enabled":true,"focused":true,"value":"hello.txt","actions":["set_value"],"element_index":4,"frame":{"x":10}}]}});
        let saved = raw.clone();
        let projected = desktop_model_result(&raw);
        assert_eq!(
            projected,
            json!({"snapshot_id":"s1","truncated":true,"elements_complete":false,"elements":[{"role":"entry","name":"Filename","element_token":"s1:4","state":{"enabled":true,"focused":true,"value":"hello.txt","element_index":4,"frame":{"x":10}}}]})
        );
        assert_eq!(raw, saved);
    }

    #[test]
    fn refusals_and_unstructured_text_remain_visible() {
        let error = json!({"isError":true,"structuredContent":{"code":"session_ended"},"content":[{"type":"text","text":"not dispatched"},{"type":"image","data":"frame"}]});
        assert_eq!(
            desktop_model_result(&error),
            json!({"isError":true,"code":"session_ended","content":[{"type":"text","text":"not dispatched"}]})
        );
        assert_eq!(
            desktop_model_result(
                &json!({"content":[{"type":"text","text":"ready"},{"type":"image","data":"frame"}]})
            ),
            json!({"content":[{"type":"text","text":"ready"}]})
        );
    }
}
