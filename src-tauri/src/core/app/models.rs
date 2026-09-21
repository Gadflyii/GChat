use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutostartPreference {
    PendingDefaultOn,
    Unmanaged,
    Enabled,
    Disabled,
}

fn existing_install_autostart_preference() -> AutostartPreference {
    AutostartPreference::Unmanaged
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppConfiguration {
    pub data_folder: String,
    #[serde(default = "existing_install_autostart_preference")]
    pub autostart_preference: AutostartPreference,
}

impl Default for AppConfiguration {
    fn default() -> Self {
        Self {
            data_folder: String::from("./data"),
            autostart_preference: AutostartPreference::Unmanaged,
        }
    }
}

impl AppConfiguration {
    /// New installations leave autostart opt-in.
    pub fn new_install() -> Self {
        Self {
            autostart_preference: AutostartPreference::Unmanaged,
            ..Self::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{AppConfiguration, AutostartPreference};

    #[test]
    fn fallback_config_does_not_enable_autostart() {
        assert_eq!(
            AppConfiguration::default().autostart_preference,
            AutostartPreference::Unmanaged
        );
    }

    #[test]
    fn new_install_does_not_enable_autostart() {
        assert_eq!(
            AppConfiguration::new_install().autostart_preference,
            AutostartPreference::Unmanaged
        );
    }

    #[test]
    fn existing_config_without_preference_remains_unmanaged() {
        let config: AppConfiguration = serde_json::from_str(r#"{"data_folder":"./data"}"#).unwrap();

        assert_eq!(config.autostart_preference, AutostartPreference::Unmanaged);
    }
}
