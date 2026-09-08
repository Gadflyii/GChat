//! Self-contained public response handles; no host-name guessing or routing cache.
use crate::engine_registry::InstanceRef;
use serde_json::Value;
use uuid::Uuid;

pub const PREFIX: &str = "resp_ginfer_";
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResponseScope {
    pub instance: InstanceRef,
    pub session: Uuid,
}
impl ResponseScope {
    pub fn encode(&self, upstream: &str) -> String {
        format!(
            "{PREFIX}{}_{}_{}_{}",
            self.instance.host_id.simple(),
            self.instance.instance_id.simple(),
            self.session.simple(),
            hex::encode(upstream)
        )
    }
    pub fn rewrite(&self, value: &mut Value) -> bool {
        let mut changed = false;
        if matches!(
            value.get("object").and_then(Value::as_str),
            Some("response" | "response.deleted")
        ) {
            for field in ["id", "previous_response_id"] {
                if let Some(id) = value.get_mut(field).filter(|v| v.is_string()) {
                    *id = self.encode(id.as_str().unwrap()).into();
                    changed = true;
                }
            }
        }
        if let Some(response) = value.get_mut("response") {
            changed |= self.rewrite(response);
        }
        changed
    }
    pub fn decode_previous(&self, body: &mut Value) -> Result<(), String> {
        if let Some(previous) = body
            .get_mut("previous_response_id")
            .filter(|v| !v.is_null())
        {
            let (scope, id) = decode(
                previous
                    .as_str()
                    .ok_or("previous_response_id must be a string")?,
            )?;
            if scope != *self {
                return Err(
                    "previous response belongs to a different host, instance, or session".into(),
                );
            }
            *previous = id.into();
        }
        Ok(())
    }
}
pub fn decode(id: &str) -> Result<(ResponseScope, String), String> {
    let fields: Vec<_> = id
        .strip_prefix(PREFIX)
        .ok_or("response handle is not a GInfer host handle")?
        .split('_')
        .collect();
    if fields.len() != 4 {
        return Err("invalid GInfer response handle".into());
    }
    let uuid = |s: &str| Uuid::parse_str(s).map_err(|e| e.to_string());
    let upstream = String::from_utf8(hex::decode(fields[3]).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if upstream.is_empty()
        || !upstream
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("invalid upstream response ID".into());
    }
    Ok((
        ResponseScope {
            instance: InstanceRef {
                host_id: uuid(fields[0])?,
                instance_id: uuid(fields[1])?,
            },
            session: uuid(fields[2])?,
        },
        upstream,
    ))
}

pub fn request_target(
    method: &str,
    path: &str,
    query: Option<&str>,
) -> Result<(ResponseScope, String), String> {
    let tail = path
        .strip_prefix("/responses/")
        .ok_or("invalid response route")?;
    let (handle, operation) = tail.split_once('/').unwrap_or((tail, ""));
    if !matches!(
        (method, operation),
        ("GET", "") | ("GET", "input_items") | ("DELETE", "") | ("POST", "cancel")
    ) {
        return Err("unsupported response operation".into());
    }
    let (scope, upstream) = decode(handle)?;
    let mut target = format!("/v1/responses/{upstream}");
    if !operation.is_empty() {
        target.push('/');
        target.push_str(operation);
    }
    if let Some(query) = query {
        target.push('?');
        target.push_str(query);
    }
    Ok((scope, target))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_handles_disambiguate_hosts_and_reject_cross_session_continuation() {
        let scope = ResponseScope {
            instance: InstanceRef {
                host_id: Uuid::new_v4(),
                instance_id: Uuid::new_v4(),
            },
            session: Uuid::new_v4(),
        };
        let id = scope.encode("resp_same");
        assert_eq!(decode(&id).unwrap(), (scope.clone(), "resp_same".into()));
        let mut other = scope.clone();
        other.instance.host_id = Uuid::new_v4();
        assert_ne!(id, other.encode("resp_same"));
        let mut body = serde_json::json!({"previous_response_id":id,"input":[{"id":"item_keep"}]});
        assert!(other.decode_previous(&mut body).is_err());
        let mut restarted = scope.clone();
        restarted.session = Uuid::new_v4();
        assert!(restarted.decode_previous(&mut body).is_err());
        scope.decode_previous(&mut body).unwrap();
        assert_eq!(body["previous_response_id"], "resp_same");
        assert_eq!(body["input"][0]["id"], "item_keep");
        assert!(decode(&scope.encode("../../wrong")).is_err());
        let path = format!("/responses/{id}");
        assert_eq!(
            request_target("GET", &path, None).unwrap(),
            (scope.clone(), "/v1/responses/resp_same".into())
        );
        assert_eq!(
            request_target("DELETE", &path, None).unwrap().1,
            "/v1/responses/resp_same"
        );
        assert_eq!(
            request_target("POST", &format!("{path}/cancel"), None)
                .unwrap()
                .1,
            "/v1/responses/resp_same/cancel"
        );
        assert_eq!(
            request_target(
                "GET",
                &format!("{path}/input_items"),
                Some("limit=2&after=item_123")
            )
            .unwrap()
            .1,
            "/v1/responses/resp_same/input_items?limit=2&after=item_123"
        );
        assert!(request_target("POST", &format!("{path}/anything"), None).is_err());
    }
}
