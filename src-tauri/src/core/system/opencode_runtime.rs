use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};

use super::commands::{apply_login_path, apply_proxy_env, apply_runtime_path, ProxyEnv};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenCodeOwnership {
    Custom,
    Managed,
    Native,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedOpenCode {
    pub executable: PathBuf,
    pub ownership: OpenCodeOwnership,
}

fn runtime_directory(data: &Path) -> PathBuf {
    super::opencode_config::config_directory(data).join("runtime")
}

fn cache_directory(data: &Path) -> PathBuf {
    super::opencode_config::config_directory(data).join("npm-cache")
}

pub fn managed_executable(data: &Path) -> PathBuf {
    runtime_directory(data)
        .join("node_modules/.bin")
        .join(if cfg!(windows) {
            "opencode.cmd"
        } else {
            "opencode"
        })
}

fn resolve_with(
    data: &Path,
    custom: Option<&str>,
    native: impl FnOnce() -> Result<Option<PathBuf>, String>,
) -> Result<Option<ResolvedOpenCode>, String> {
    if let Some(custom) = custom.map(str::trim).filter(|path| !path.is_empty()) {
        let executable = PathBuf::from(custom);
        if !executable.is_absolute() || !executable.is_file() {
            return Err("The custom Code executable must be an absolute file path. Choose the installed program, or clear the custom path to use GChat's copy.".into());
        }
        return Ok(Some(ResolvedOpenCode {
            executable,
            ownership: OpenCodeOwnership::Custom,
        }));
    }
    let executable = managed_executable(data);
    if executable.is_file() {
        return Ok(Some(ResolvedOpenCode {
            executable,
            ownership: OpenCodeOwnership::Managed,
        }));
    }
    Ok(native()?.map(|executable| ResolvedOpenCode {
        executable,
        ownership: OpenCodeOwnership::Native,
    }))
}

/// Resolve once per operation, using that operation's selected GChat data root.
pub fn resolve(data: &Path, custom: Option<&str>) -> Result<Option<ResolvedOpenCode>, String> {
    resolve_with(data, custom, || native_executable("opencode"))
}

fn native_executable(bin: &str) -> Result<Option<PathBuf>, String> {
    // Prefer npm's application shim over its PowerShell script shim.
    let lookup = if cfg!(windows) { "where.exe" } else { "which" };
    let names = if cfg!(windows) && matches!(bin, "opencode" | "npm") {
        vec![format!("{bin}.cmd"), format!("{bin}.exe")]
    } else {
        vec![bin.to_owned()]
    };
    for name in names {
        let mut cmd = Command::new(lookup);
        cmd.arg(name);
        apply_login_path(&mut cmd);
        apply_runtime_path(&mut cmd);
        hide_window(&mut cmd);
        let output = cmd
            .output()
            .map_err(|error| format!("Could not look for {bin}: {error}"))?;
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .map(PathBuf::from)
                .find(|path| path.is_absolute() && path.is_file())
            {
                return Ok(Some(path));
            }
        }
    }
    Ok(None)
}

#[cfg(any(windows, test))]
fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(any(windows, test))]
fn powershell_command(executable: &Path, args: &[&str]) -> String {
    format!(
        "{}; exit $LASTEXITCODE",
        powershell_invocation(executable, args)
    )
}

#[cfg(any(windows, test))]
fn powershell_invocation(executable: &Path, args: &[&str]) -> String {
    let path = executable.to_string_lossy();
    let path = path
        .strip_prefix(r"\\?\UNC\")
        .map(|path| format!(r"\\{path}"))
        .or_else(|| path.strip_prefix(r"\\?\").map(str::to_owned))
        .unwrap_or_else(|| path.into_owned());
    let arguments = args
        .iter()
        .map(|arg| powershell_literal(arg))
        .collect::<Vec<_>>()
        .join(" ");
    let suffix = if arguments.is_empty() {
        String::new()
    } else {
        format!(" {arguments}")
    };
    format!("& {}{suffix}", powershell_literal(&path))
}

pub(crate) fn shell_invocation(executable: &Path, args: &[&str]) -> String {
    #[cfg(windows)]
    {
        powershell_invocation(executable, args)
    }
    #[cfg(not(windows))]
    {
        std::iter::once(executable.to_string_lossy().into_owned())
            .chain(args.iter().map(|arg| (*arg).to_owned()))
            .map(|value| format!("'{}'", value.replace('\'', "'\\''")))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Leave stdin/stdout/stderr to the caller, including interactive CLI children.
pub fn command(executable: &Path, args: &[&str]) -> Command {
    #[cfg(windows)]
    let mut cmd = if executable
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("cmd") || ext.eq_ignore_ascii_case("bat"))
    {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command"])
            .arg(powershell_command(executable, args));
        cmd
    } else {
        let mut cmd = Command::new(executable);
        cmd.args(args);
        cmd
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut cmd = Command::new(executable);
        cmd.args(args);
        cmd
    };
    apply_login_path(&mut cmd);
    apply_runtime_path(&mut cmd);
    cmd
}

fn hide_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

fn managed_environment(cmd: &mut Command, data: &Path, proxy: Option<&ProxyEnv>) {
    cmd.envs(super::opencode_config::child_env(
        &super::opencode_config::config_directory(data),
    ))
    .env("npm_config_cache", cache_directory(data))
    .env("NO_COLOR", "1");
    if let Some(proxy) = proxy {
        apply_proxy_env(cmd, proxy);
    }
    hide_window(cmd);
}

pub(crate) fn version(executable: &Path, data: &Path) -> Result<String, String> {
    let mut cmd = command(executable, &["--version"]);
    managed_environment(&mut cmd, data, None);
    let output = cmd
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Code could not start. Retry setup. Details: {error}"))?;
    let version = String::from_utf8_lossy(&output.stdout)
        .trim()
        .trim_start_matches('v')
        .to_owned();
    if !output.status.success() || version.is_empty() {
        return Err(
            "Code setup did not produce a working program. Retry setup to repair the installation."
                .into(),
        );
    }
    Ok(version)
}

pub(crate) fn install_managed(
    data: &Path,
    target: Option<&str>,
    proxy: Option<&ProxyEnv>,
    log_name: &str,
    progress: impl Fn(&str) + Sync,
) -> Result<PathBuf, String> {
    if target.is_some_and(|target| {
        let parts: Vec<_> = target.split('.').collect();
        parts.len() != 3
            || parts
                .iter()
                .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    }) {
        return Err(
            "The Code release has an invalid version. Try checking for updates again.".into(),
        );
    }
    install_with_probe(data, target, proxy, log_name, native_executable, progress)
}

fn install_with_probe(
    data: &Path,
    target: Option<&str>,
    proxy: Option<&ProxyEnv>,
    log_name: &str,
    probe: impl Fn(&str) -> Result<Option<PathBuf>, String>,
    progress: impl Fn(&str) + Sync,
) -> Result<PathBuf, String> {
    let missing = "GChat needs Node.js and npm to set up Code. Install Node.js LTS from https://nodejs.org, then try again.";
    let node = probe("node")
        .map_err(|error| format!("{missing} Details: {error}"))?
        .ok_or(missing)?;
    let npm = probe("npm")
        .map_err(|error| format!("{missing} Details: {error}"))?
        .ok_or(missing)?;
    for executable in [&node, &npm] {
        let mut cmd = command(executable, &["--version"]);
        managed_environment(&mut cmd, data, proxy);
        let result = cmd
            .stdin(Stdio::null())
            .output()
            .map_err(|_| missing.to_owned())?;
        if !result.status.success() || String::from_utf8_lossy(&result.stdout).trim().is_empty() {
            return Err(missing.into());
        }
    }
    let runtime = runtime_directory(data);
    let cache = cache_directory(data);
    std::fs::create_dir_all(&runtime).map_err(|error| format!("GChat could not create its Code folder. Check that your data folder is writable and try again. Details: {error}"))?;
    std::fs::create_dir_all(&cache).map_err(|error| error.to_string())?;
    let log_path = super::opencode_config::config_directory(data).join(log_name);
    let log = std::fs::File::create(&log_path).map_err(|error| error.to_string())?;
    let package = target
        .map(|target| format!("opencode-ai@{target}"))
        .unwrap_or_else(|| "opencode-ai".into());
    let runtime_text = runtime
        .to_str()
        .ok_or("The GChat data folder must have a valid Unicode path.")?;
    let cache_text = cache
        .to_str()
        .ok_or("The GChat data folder must have a valid Unicode path.")?;
    let mut cmd = command(
        &npm,
        &[
            "install",
            "--global=false",
            "--prefix",
            runtime_text,
            "--cache",
            cache_text,
            &package,
        ],
    );
    managed_environment(&mut cmd, data, proxy);
    let mut child = cmd.current_dir(&runtime).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|error| format!("GChat could not start Code setup. Check Node.js and npm, then try again. Details: {error}"))?;
    let captured = Mutex::new((log, String::new()));
    let consume = |stream: Box<dyn std::io::Read + Send>| {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            {
                let mut captured = captured.lock().unwrap_or_else(|error| error.into_inner());
                let _ = writeln!(captured.0, "{line}");
                captured.1.push_str(&line);
                captured.1.push('\n');
                let mut excess = captured.1.len().saturating_sub(16_384);
                while !captured.1.is_char_boundary(excess) {
                    excess += 1;
                }
                captured.1.drain(..excess);
            }
            progress(&line);
        }
    };
    std::thread::scope(|scope| {
        let consume = &consume;
        if let Some(stdout) = child.stdout.take() {
            scope.spawn(move || consume(Box::new(stdout)));
        }
        if let Some(stderr) = child.stderr.take() {
            scope.spawn(move || consume(Box::new(stderr)));
        }
    });
    let status = child.wait().map_err(|error| error.to_string())?;
    if !status.success() {
        let (_, output) = captured
            .into_inner()
            .unwrap_or_else(|error| error.into_inner());
        return Err(format!("Code setup could not finish. Check the network connection and retry. Diagnostic log: {}\n{output}", log_path.display()));
    }
    let executable = managed_executable(data);
    let installed = version(&executable, data)?;
    if target.is_some_and(|target| installed != target) {
        return Err(format!(
            "Code did not reach the requested version. Retry the update. Diagnostic log: {}",
            log_path.display()
        ));
    }
    Ok(executable)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "test executable").unwrap();
    }

    #[test]
    fn resolver_uses_custom_then_managed_then_native_without_falling_back_from_custom() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("selected data");
        let custom = root.path().join("custom code");
        let native = root.path().join("native code");
        let managed = managed_executable(&data);
        for path in [&custom, &native, &managed] {
            file(path);
        }
        let resolved = resolve_with(&data, custom.to_str(), || panic!("custom must win"))
            .unwrap()
            .unwrap();
        assert_eq!(
            resolved,
            ResolvedOpenCode {
                executable: custom.clone(),
                ownership: OpenCodeOwnership::Custom
            }
        );
        let resolved = resolve_with(&data, None, || panic!("managed must win"))
            .unwrap()
            .unwrap();
        assert_eq!(
            resolved,
            ResolvedOpenCode {
                executable: managed.clone(),
                ownership: OpenCodeOwnership::Managed
            }
        );
        let missing = root.path().join("missing");
        for invalid in [
            "relative-code",
            root.path().to_str().unwrap(),
            missing.to_str().unwrap(),
        ] {
            assert!(resolve_with(&data, Some(invalid), || panic!(
                "invalid custom must not fall back"
            ))
            .is_err());
        }
        std::fs::remove_file(managed).unwrap();
        let resolved = resolve_with(&data, Some("  "), || Ok(Some(native.clone())))
            .unwrap()
            .unwrap();
        assert_eq!(
            resolved,
            ResolvedOpenCode {
                executable: native,
                ownership: OpenCodeOwnership::Native
            }
        );
        assert!(resolve_with(&data, None, || Ok(None)).unwrap().is_none());
    }

    #[test]
    fn updater_rejects_nonrelease_package_specifiers_before_starting_npm() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("private data");
        for target in [
            "latest",
            "1.2.3; anything",
            "1.2.3-beta",
            "file:../external",
            "1..3",
        ] {
            assert!(
                install_managed(&data, Some(target), None, "update.log", |_| {})
                    .unwrap_err()
                    .contains("invalid version")
            );
        }
        assert!(!data.exists());
    }

    #[test]
    fn windows_shim_command_preserves_literal_arguments_and_normalizes_extended_paths() {
        assert_eq!(
            powershell_command(
                Path::new(r"\\?\C:\user's data\npm.cmd"),
                &["install", "a & $b; 'c'"]
            ),
            "& 'C:\\user''s data\\npm.cmd' 'install' 'a & $b; ''c'''; exit $LASTEXITCODE"
        );
        assert_eq!(
            powershell_command(Path::new(r"\\?\UNC\server\share\opencode.cmd"), &[]),
            "& '\\\\server\\share\\opencode.cmd'; exit $LASTEXITCODE"
        );
    }

    #[cfg(unix)]
    mod unix {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        fn executable(path: &Path, script: &str) {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, script).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }

        struct Tools {
            root: tempfile::TempDir,
            node: PathBuf,
            npm: PathBuf,
        }

        impl Tools {
            fn new(version: &str, install_exit: u8, write_shim: bool, version_exit: u8) -> Self {
                let root = tempfile::tempdir().unwrap();
                let node = root.path().join("tools with spaces/node");
                let npm = root.path().join("tools with spaces/npm");
                executable(&node, "#!/bin/sh\necho v18.19.1\n");
                executable(
                    &npm,
                    &format!(
                        r##"#!/bin/sh
if [ "$1" = '--version' ]; then echo 9.2.0; exit 0; fi
[ "$1" = install ] && [ "$2" = --global=false ] && [ "$3" = --prefix ] && [ "$5" = --cache ] || exit 8
prefix="$4"
[ "$PWD" = "$prefix" ] || exit 8
printf '%s\n' "$@" >> "$prefix/npm-arguments"
printf '%s\n' "$npm_config_cache" "$HTTPS_PROXY" "$NO_PROXY" "$XDG_CONFIG_HOME" "$OPENCODE_CONFIG_DIR" "$OPENCODE_CONFIG" "$HOME" > "$prefix/npm-environment"
read answer && exit 9
echo 'private npm diagnostic'
echo 'private stderr diagnostic' >&2
[ {install_exit} = 0 ] || exit {install_exit}
if [ '{write_shim}' = true ]; then
  mkdir -p "$prefix/node_modules/.bin"
  cat > "$prefix/node_modules/.bin/opencode" <<'SHIM'
#!/bin/sh
printf '%s\n' "$XDG_CONFIG_HOME" "$OPENCODE_CONFIG_DIR" "$OPENCODE_CONFIG" > "$OPENCODE_CONFIG_DIR/version-environment"
printf '%s\n' '{version}'
exit {version_exit}
SHIM
  chmod 700 "$prefix/node_modules/.bin/opencode"
fi
"##
                    ),
                );
                Self { root, node, npm }
            }

            fn probe(&self, name: &str) -> Result<Option<PathBuf>, String> {
                Ok(match name {
                    "node" => Some(self.node.clone()),
                    "npm" => Some(self.npm.clone()),
                    _ => None,
                })
            }
        }

        #[test]
        fn local_install_and_pinned_update_share_the_selected_prefix_cache_and_proxy() {
            let tools = Tools::new("1.2.3", 0, true, 0);
            let data = tools.root.path().join("selected user's data $(never run)");
            let unrelated = tools.root.path().join("global installation");
            std::fs::write(&unrelated, "untouched").unwrap();
            let proxy = ProxyEnv {
                url: "http://proxy.example:3128".into(),
                username: Some("user".into()),
                password: Some("pass".into()),
                no_proxy: Some("example.test".into()),
            };
            let progress = Mutex::new(Vec::new());
            let install = |target, log_name| {
                install_with_probe(
                    &data,
                    target,
                    Some(&proxy),
                    log_name,
                    |bin| tools.probe(bin),
                    |line| progress.lock().unwrap().push(line.to_owned()),
                )
            };
            let first = install(None, "gchat-install.log").unwrap();
            let updated = install(Some("1.2.3"), "gchat-update.log").unwrap();
            assert_eq!(first, managed_executable(&data));
            assert_eq!(updated, first);
            assert_eq!(std::fs::read_to_string(&unrelated).unwrap(), "untouched");
            let runtime = runtime_directory(&data);
            let cache = cache_directory(&data);
            let expected = |package: &str| {
                format!(
                    "install\n--global=false\n--prefix\n{}\n--cache\n{}\n{package}\n",
                    runtime.display(),
                    cache.display()
                )
            };
            assert_eq!(
                std::fs::read_to_string(runtime.join("npm-arguments")).unwrap(),
                expected("opencode-ai") + &expected("opencode-ai@1.2.3")
            );
            let directory = super::super::super::opencode_config::config_directory(&data);
            let environment = std::fs::read_to_string(runtime.join("npm-environment")).unwrap();
            let environment: Vec<_> = environment.lines().collect();
            assert_eq!(environment[0], cache.to_str().unwrap());
            assert_eq!(environment[1], "http://user:pass@proxy.example:3128");
            for excluded in ["example.test", "localhost", "127.0.0.1", "::1"] {
                assert!(environment[2].split(',').any(|part| part == excluded));
            }
            assert_eq!(environment[3], data.join("code").to_str().unwrap());
            assert_eq!(environment[4], directory.to_str().unwrap());
            assert_eq!(
                environment[5],
                directory.join("opencode.jsonc").to_str().unwrap()
            );
            assert_eq!(environment[6], std::env::var("HOME").unwrap());
            assert_eq!(
                std::fs::read_to_string(directory.join("version-environment")).unwrap(),
                format!(
                    "{}\n{}\n{}\n",
                    data.join("code").display(),
                    directory.display(),
                    directory.join("opencode.jsonc").display()
                )
            );
            for log in ["gchat-install.log", "gchat-update.log"] {
                let log = std::fs::read_to_string(directory.join(log)).unwrap();
                assert!(log.contains("private npm diagnostic"));
                assert!(log.contains("private stderr diagnostic"));
            }
            assert!(progress
                .lock()
                .unwrap()
                .iter()
                .any(|line| line == "private npm diagnostic"));
            assert!(!tools.root.path().join("never run").exists());
        }

        #[test]
        fn missing_or_broken_node_and_npm_stop_before_installing_anything() {
            for missing in ["node", "npm"] {
                let tools = Tools::new("1.2.3", 0, true, 0);
                let data = tools.root.path().join("private data");
                let error = install_with_probe(
                    &data,
                    None,
                    None,
                    "install.log",
                    |bin| {
                        if bin == missing {
                            Ok(None)
                        } else {
                            tools.probe(bin)
                        }
                    },
                    |_| {},
                )
                .unwrap_err();
                assert!(error.contains("Node.js and npm"));
                assert!(error.contains("https://nodejs.org"));
                assert!(!data.exists());
            }
            let tools = Tools::new("1.2.3", 0, true, 0);
            executable(&tools.node, "#!/bin/sh\nexit 7\n");
            let data = tools.root.path().join("private data");
            assert!(install_with_probe(
                &data,
                None,
                None,
                "install.log",
                |bin| tools.probe(bin),
                |_| {}
            )
            .unwrap_err()
            .contains("Node.js and npm"));
            assert!(!data.exists());
        }

        #[test]
        fn failed_install_missing_shim_and_failed_or_empty_version_are_not_success() {
            for (version, install_exit, write_shim, version_exit) in [
                ("1.2.3", 7, true, 0),
                ("1.2.3", 0, false, 0),
                ("", 0, true, 0),
                ("1.2.3", 0, true, 7),
                ("1.2.2", 0, true, 0),
            ] {
                let tools = Tools::new(version, install_exit, write_shim, version_exit);
                let data = tools.root.path().join("private data");
                assert!(install_with_probe(&data, Some("1.2.3"), None, "update.log", |bin| tools.probe(bin), |_| {}).is_err(), "version={version:?}, npm exit={install_exit}, shim={write_shim}, version exit={version_exit}");
            }
        }

        #[test]
        fn child_builder_allows_callers_to_supply_interactive_input() {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("interactive code");
            executable(&path, "#!/bin/sh\nread answer\nprintf '%s' \"$answer\"\n");
            let mut child = command(&path, &[])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(b"user input\n")
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(output.status.success());
            assert_eq!(output.stdout, b"user input");
        }
    }
}
