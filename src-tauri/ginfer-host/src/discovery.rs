use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

pub const SERVICE_TYPE: &str = "_ginfer._tcp.local.";

pub fn advertise(host_id: uuid::Uuid, name: &str, port: u16) -> Result<ServiceDaemon, String> {
    let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
    let properties = [
        ("version", "1"),
        ("host_id", &host_id.to_string()),
        ("name", name),
        ("tls", "1"),
    ];
    let info = ServiceInfo::new(
        SERVICE_TYPE,
        &host_id.to_string(),
        &format!("ginfer-{host_id}.local."),
        "",
        port,
        &properties[..],
    )
    .map_err(|e| e.to_string())?
    .enable_addr_auto();
    daemon.register(info).map_err(|e| e.to_string())?;
    Ok(daemon)
}

#[derive(Clone, Serialize)]
pub struct DiscoveredHost {
    pub host_id: String,
    pub name: String,
    pub urls: Vec<String>,
}
pub struct Discovery {
    daemon: ServiceDaemon,
    found: Arc<Mutex<BTreeMap<String, DiscoveredHost>>>,
}
impl Discovery {
    pub fn start() -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| e.to_string())?;
        let events = daemon.browse(SERVICE_TYPE).map_err(|e| e.to_string())?;
        let found = Arc::new(Mutex::new(BTreeMap::new()));
        let worker_found = found.clone();
        std::thread::spawn(move || {
            while let Ok(event) = events.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        if info.get_property_val_str("version") != Some("1")
                            || info.get_property_val_str("tls") != Some("1")
                        {
                            continue;
                        }
                        let Some(id) = info
                            .get_property_val_str("host_id")
                            .filter(|id| uuid::Uuid::parse_str(id).is_ok())
                        else {
                            continue;
                        };
                        let urls = info
                            .get_addresses()
                            .iter()
                            .filter(|ip| !ip.is_unspecified())
                            .map(|ip| match ip {
                                std::net::IpAddr::V4(ip) => {
                                    format!("https://{ip}:{}", info.get_port())
                                }
                                std::net::IpAddr::V6(ip) => {
                                    format!("https://[{ip}]:{}", info.get_port())
                                }
                            })
                            .collect();
                        worker_found.lock().unwrap().insert(
                            info.get_fullname().into(),
                            DiscoveredHost {
                                host_id: id.into(),
                                name: info
                                    .get_property_val_str("name")
                                    .unwrap_or("GInfer host")
                                    .into(),
                                urls,
                            },
                        );
                    }
                    ServiceEvent::ServiceRemoved(_, name) => {
                        worker_found.lock().unwrap().remove(&name);
                    }
                    _ => {}
                }
            }
        });
        Ok(Self { daemon, found })
    }
    pub fn hosts(&self) -> Vec<DiscoveredHost> {
        self.found.lock().unwrap().values().cloned().collect()
    }
}
impl Drop for Discovery {
    fn drop(&mut self) {
        let _ = self.daemon.stop_browse(SERVICE_TYPE);
        let _ = self.daemon.shutdown();
    }
}
