//! Gbot uses the shared native certificate, grant and engine-session owner.
use gbot_service::inference::{
    InferenceFuture, InferenceHost, InferenceResponse, PairedModel, PairedTarget,
};
use ginfer_host::{client::Client, engine_registry::InstanceRef};
use serde_json::Value;
use std::sync::Arc;

pub(super) struct NativeInferenceHost {
    client: Arc<Client>,
}
impl NativeInferenceHost {
    pub async fn open() -> Result<Self, String> {
        let client = crate::core::engine_hosts::shared_client().await?;
        client.initialize_from_local_owner().await?;
        Ok(Self { client })
    }
}
impl InferenceHost for NativeInferenceHost {
    fn models(&self) -> InferenceFuture<'_, Vec<PairedModel>> {
        Box::pin(async move {
            let ids: Vec<_> = self.client.view().await?.saved.keys().copied().collect();
            self.client.snapshots(&ids).await;
            let state = self.client.view().await?;
            let mut models = Vec::new();
            for (host_id, snapshot) in &state.snapshots {
                for instance in snapshot
                    .get("instances")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let Some(instance_id) = instance
                        .get("instance_id")
                        .and_then(Value::as_str)
                        .and_then(|id| id.parse().ok())
                    else {
                        continue;
                    };
                    let Ok(resolved) = state.registry.resolve(&InstanceRef {
                        host_id: *host_id,
                        instance_id,
                    }) else {
                        continue;
                    };
                    let Some(session_id) = resolved.session_id else {
                        continue;
                    };
                    let Some(context_tokens) = instance
                        .pointer("/configuration/max_context")
                        .and_then(Value::as_u64)
                        .filter(|n| *n > 0)
                    else {
                        continue;
                    };
                    models.push(PairedModel {
                        target: PairedTarget {
                            host_id: *host_id,
                            instance_id,
                            session_id,
                        },
                        host_name: snapshot
                            .get("display_name")
                            .and_then(Value::as_str)
                            .unwrap_or("GInfer Host")
                            .into(),
                        model: resolved.upstream_model_id.clone(),
                        context_tokens,
                    });
                }
            }
            models.sort_by(|a, b| {
                (&a.host_name, &a.model, a.target.instance_id).cmp(&(
                    &b.host_name,
                    &b.model,
                    b.target.instance_id,
                ))
            });
            Ok(models)
        })
    }
    fn request<'a>(
        &'a self,
        target: &'a PairedTarget,
        path: &'a str,
        body: Value,
    ) -> InferenceFuture<'a, InferenceResponse> {
        Box::pin(async move {
            let response = self
                .client
                .request_instance(
                    &InstanceRef {
                        host_id: target.host_id,
                        instance_id: target.instance_id,
                    },
                    target.session_id,
                    reqwest::Method::POST,
                    path,
                    Some(&body),
                )
                .await
                .map_err(|error| error.to_string())?;
            let status = response.status().as_u16();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/json")
                .to_owned();
            let body = response
                .bytes()
                .await
                .map_err(|error| error.to_string())?
                .to_vec();
            Ok(InferenceResponse {
                status,
                content_type,
                body,
            })
        })
    }
}
