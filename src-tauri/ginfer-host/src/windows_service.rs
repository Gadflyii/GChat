//! SCM owns service lifetime; only the host's own inference children are stopped.
use ::windows_service::{
    define_windows_service,
    service::{
        ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult, ServiceStatusHandle},
    service_dispatcher,
};
use clap::Parser;
use std::{
    ffi::OsString,
    sync::{Arc, Mutex},
    time::Duration,
};

const NAME: &str = "GInferHost";
define_windows_service!(service_entry, service_main);

pub fn dispatch() -> ::windows_service::Result<()> {
    service_dispatcher::start(NAME, service_entry)
}

struct Status {
    handle: ServiceStatusHandle,
    state: ServiceState,
    checkpoint: u32,
}
impl Status {
    fn report(&mut self, state: ServiceState, failed: bool) -> Result<(), String> {
        let pending = matches!(
            state,
            ServiceState::StartPending | ServiceState::StopPending
        );
        self.checkpoint = if pending {
            if self.state == state {
                self.checkpoint + 1
            } else {
                1
            }
        } else {
            0
        };
        self.state = state;
        self.handle
            .set_service_status(ServiceStatus {
                service_type: ServiceType::OWN_PROCESS,
                current_state: state,
                controls_accepted: if state == ServiceState::Running {
                    ServiceControlAccept::STOP | ServiceControlAccept::SHUTDOWN
                } else {
                    ServiceControlAccept::empty()
                },
                exit_code: if failed {
                    ServiceExitCode::ServiceSpecific(1)
                } else {
                    ServiceExitCode::Win32(0)
                },
                checkpoint: self.checkpoint,
                wait_hint: if pending {
                    Duration::from_secs(15)
                } else {
                    Duration::ZERO
                },
                process_id: None,
            })
            .map_err(|e| e.to_string())
    }
}

fn service_main(_arguments: Vec<OsString>) {
    let (stop, mut stopped) = tokio::sync::watch::channel(false);
    let handle = match service_control_handler::register(NAME, move |event| match event {
        ServiceControl::Stop | ServiceControl::Shutdown => {
            let _ = stop.send(true);
            ServiceControlHandlerResult::NoError
        }
        ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
        _ => ServiceControlHandlerResult::NotImplemented,
    }) {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("SCM registration: {error}");
            return;
        }
    };
    let status = Arc::new(Mutex::new(Status {
        handle,
        state: ServiceState::StartPending,
        checkpoint: 0,
    }));
    if status
        .lock()
        .unwrap()
        .report(ServiceState::StartPending, false)
        .is_err()
    {
        return;
    }
    // Parse the registered executable command line, not SCM's start parameters.
    // Do not call Parser::parse here: its process exit would skip Stopped status.
    let result = (|| -> Result<(), String> {
        let args = super::Args::try_parse().map_err(|e| e.to_string())?;
        let diagnostics = args.data_dir.join("service-status.txt");
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .map_err(|e| e.to_string())?;
        let result = runtime.block_on(async {
            let progress_status = status.clone();
            let progress = tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(3));
                loop {
                    interval.tick().await;
                    let mut state = progress_status.lock().unwrap();
                    let current = state.state;
                    if matches!(
                        current,
                        ServiceState::StartPending | ServiceState::StopPending
                    ) {
                        let _ = state.report(current, false);
                    }
                }
            });
            let ready_status = status.clone();
            let stop_status = status.clone();
            let result = super::run(
                args,
                move || {
                    ready_status
                        .lock()
                        .unwrap()
                        .report(ServiceState::Running, false)
                },
                async move {
                    while !*stopped.borrow_and_update() {
                        if stopped.changed().await.is_err() {
                            break;
                        }
                    }
                    let _ = stop_status
                        .lock()
                        .unwrap()
                        .report(ServiceState::StopPending, false);
                },
            )
            .await;
            progress.abort();
            let _ = progress.await;
            result
        });
        let message = match &result {
            Ok(()) => "Service stopped normally.\n".to_string(),
            Err(error) => format!("Service failed: {error}\n"),
        };
        // SCM has no attached stderr console. Keep actionable diagnostics within
        // the installer-protected state directory, never in public discovery.
        let _ = ginfer_host::service::write_private(&diagnostics, message.as_bytes());
        result
    })();
    if let Err(error) = &result {
        eprintln!("GInferHost: {error}");
    }
    let _ = status
        .lock()
        .unwrap()
        .report(ServiceState::Stopped, result.is_err());
}
