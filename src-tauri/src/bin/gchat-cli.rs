//! gchat-cli — headless CLI for GChat.
//!
//! Four things, all local: see which ginfer chat models are installed, serve
//! one over an OpenAI-compatible API, wire a coding agent to it, and check
//! whether the desktop app's Local API Server is up.
//!
//! Shares all core logic with the GChat desktop app.
//! Build with: cargo build --features cli --bin gchat-cli

use std::path::PathBuf;
use std::sync::Arc;

use clap::{Args, CommandFactory, FromArgMatches, Parser, Subcommand};
use console::Style;
use indicatif::{ProgressBar, ProgressStyle};

// Import the library crate so we can access core modules.
// The lib target is named "app_lib" (see [lib] section in Cargo.toml).
use app_lib::core::cli::{
    cli_get_data_folder, discover_ginfer_binary, download_hf_model, fetch_hf_ginfer_files,
    init_ginfer_state, integrations, list_chat_models, load_ginfer_model_impl, looks_like_hf_repo,
    resolve_model_by_id, GinferConfig, HfFileInfo,
};
use app_lib::core::server::state_file::{self, LocalApiServerState};

use integrations::{Agent, RunMode};

// ── Top-level CLI ──────────────────────────────────────────────────────────

#[derive(Parser)]
#[command(
    name = "gchat-cli",
    about = "Run local ginfer chat models and wire coding agents to them",
    long_about = "GChat runs ginfer chat models on your own hardware and exposes\n\
them through an OpenAI-compatible API, then points coding agents like\n\
Claude Code or Codex at that endpoint — no cloud account, no usage fees.\n\n\
Models downloaded in the GChat desktop app are available here\n\
automatically; both read the same folder.",
    after_help = "Examples:\n\
  \x20 # Show the chat models you have installed\n\
  \x20 gchat-cli models list\n\n\
  \x20 # Expose one at localhost:6767/v1 (--detach runs it in the background)\n\
  \x20 gchat-cli serve GadflyII/Qwen3.5-9B\n\n\
  \x20 # Start a model and drop into a coding agent wired to it\n\
  \x20 gchat-cli launch claude\n\n\
  \x20 # Is the desktop app's Local API Server up?\n\
  \x20 gchat-cli server status",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Load a local model and expose it at localhost:6767/v1
    #[command(display_order = 1)]
    Serve {
        #[command(flatten)]
        args: ServeArgs,
    },
    /// Start a local model, then launch a coding agent already wired to it
    #[command(display_order = 2)]
    Launch {
        #[command(flatten)]
        args: LaunchArgs,
    },
    /// List the chat models installed in the GChat data folder
    #[command(display_order = 10)]
    Models {
        #[command(subcommand)]
        cmd: ModelsCommands,
    },
    /// Inspect the desktop app's Local API Server
    #[command(display_order = 11)]
    Server {
        #[command(subcommand)]
        cmd: ServerCommands,
    },
}

// ── Serve args ─────────────────────────────────────────────────────────────

#[derive(Args)]
struct ServeArgs {
    /// Model ID to load (omit to pick interactively from installed models)
    model_id: Option<String>,
    /// Path to the .ginfer file (auto-resolved from model.yml when omitted)
    #[arg(long)]
    model_path: Option<String>,
    /// Path to the ginfer-serve binary (auto-discovered from the GChat data folder when omitted)
    #[arg(long)]
    bin: Option<String>,
    /// Port the model server listens on (0 = pick a random free port)
    #[arg(long, default_value_t = 6767)]
    port: u16,
    /// Treat the model as an embedding model
    #[arg(long, default_value_t = false)]
    embedding: bool,
    /// Seconds to wait for the model server to become ready
    #[arg(long, default_value_t = 120)]
    timeout: u64,
    /// Context window size in tokens (0 = model default)
    #[arg(long, default_value_t = 32768)]
    ctx_size: i32,
    /// Load the model with vision support
    #[arg(long, default_value_t = false)]
    vision: bool,
    /// API key required by clients
    #[arg(long, default_value = "")]
    api_key: String,
    /// Run in the background (detach from terminal) and print the PID
    #[arg(long, short = 'd', default_value_t = false)]
    detach: bool,
    /// Log file for background mode (default: <data-folder>/logs/serve.log)
    #[arg(long)]
    log: Option<String>,
    /// Print full ginfer-serve logs instead of the loading spinner
    #[arg(long, short = 'v', default_value_t = false)]
    verbose: bool,
    /// When downloading a model, show the file selection list
    #[arg(long, default_value_t = false)]
    select: bool,
}

// ── Launch args ────────────────────────────────────────────────────────────

#[derive(Args)]
struct LaunchArgs {
    /// Agent to configure and run (e.g. claude, codex, opencode).
    /// Omit to pick interactively from the agents installed on this machine.
    agent: Option<String>,
    /// Arguments forwarded to the agent
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    agent_args: Vec<String>,
    /// Model ID to load (omit to pick interactively)
    #[arg(long)]
    model: Option<String>,
    /// Path to the ginfer-serve binary (auto-discovered when omitted)
    #[arg(long)]
    bin: Option<String>,
    /// Port the model server listens on (0 = pick a random free port)
    #[arg(long, default_value_t = 6767)]
    port: u16,
    /// API key the agent is configured with
    #[arg(long, default_value = "gchat")]
    api_key: String,
    /// Context window size in tokens (default: 32768)
    #[arg(long)]
    ctx_size: Option<i32>,
    /// Print full ginfer-serve logs instead of the loading spinner
    #[arg(long, short = 'v', default_value_t = false)]
    verbose: bool,
    /// When downloading a model, show the file selection list
    #[arg(long, default_value_t = false)]
    select: bool,
    /// List the agents this CLI can configure and exit
    #[arg(long, default_value_t = false)]
    list: bool,
}

// ── Models subcommands ─────────────────────────────────────────────────────

#[derive(Subcommand)]
enum ModelsCommands {
    /// Print the installed chat models (embedding models are not listed)
    List {
        /// Print raw JSON instead of a table
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

// ── Server subcommands ─────────────────────────────────────────────────────

#[derive(Subcommand)]
enum ServerCommands {
    /// Report whether the desktop app's Local API Server is reachable
    Status {
        /// Host to probe (default: whatever the app last started the server on)
        #[arg(long)]
        host: Option<String>,
        /// Port to probe (default: whatever the app last started the server on)
        #[arg(long)]
        port: Option<u16>,
        /// API prefix (default: whatever the app last started the server on)
        #[arg(long)]
        prefix: Option<String>,
        /// API key, if the server requires one. Needed only to list loaded
        /// models; the reachability probe works without it.
        /// Falls back to the GCHAT_API_KEY environment variable.
        #[arg(long)]
        api_key: Option<String>,
        /// Print raw JSON instead of a summary
        #[arg(long, default_value_t = false)]
        json: bool,
    },
}

// ── ASCII logo ─────────────────────────────────────────────────────────────

/// Build a left-aligned ASCII logo for the help header.
fn make_logo() -> String {
    // "GCHAT" in ANSI Shadow block letters
    let lines = [
        r" ██████╗  ██████╗██╗  ██╗ █████╗ ████████╗",
        r"██╔════╝ ██╔════╝██║  ██║██╔══██╗╚══██╔══╝",
        r"██║  ███╗██║     ███████║███████║   ██║   ",
        r"██║   ██║██║     ██╔══██║██╔══██║   ██║   ",
        r"╚██████╔╝╚██████╗██║  ██║██║  ██║   ██║   ",
        r" ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ",
    ];

    // Fixed left-aligned indent (2 spaces)
    let indent = "  ";

    let mark = Style::new().white().bold();
    let subtle = Style::new().dim();

    let mut out: Vec<String> = Vec::new();

    // Add padding at top
    out.push(String::new());
    out.push(String::new());

    // Logo lines
    for l in &lines {
        out.push(format!("{}{}", indent, mark.apply_to(l)));
    }

    // Wordmark tagline under the logo
    out.push(format!(
        "{}{}",
        indent,
        subtle.apply_to("GChat · local models, no cloud")
    ));

    out.join("\n")
}

// ── Entry point ────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    restore_default_sigpipe();

    // Pre-scan raw args for --verbose / -v before full parse so we can set
    // the log level before any logging happens.
    let verbose = std::env::args().any(|a| a == "--verbose" || a == "-v");
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(if verbose {
        "info"
    } else {
        "warn"
    }))
    .init();

    // Inject the logo at runtime so we can use ANSI styling.
    let logo = make_logo();
    let matches = Cli::command()
        // Pin the usage line to the branded name — clap would otherwise derive it
        // from argv[0], which is the build artifact name during development.
        .bin_name("gchat-cli")
        .before_help(logo.clone())
        .before_long_help(logo)
        .get_matches();
    let cli = Cli::from_arg_matches(&matches).unwrap_or_else(|e| e.exit());

    match cli.command {
        Commands::Serve { args } => handle_serve(args).await,
        Commands::Launch { args } => handle_launch(args).await,
        Commands::Models { cmd } => handle_models(cmd),
        Commands::Server { cmd } => handle_server(cmd).await,
    }
}

/// Restore the default SIGPIPE disposition.
///
/// Rust's runtime ignores SIGPIPE, which turns the ordinary `… | head` into a
/// panic on a broken pipe instead of a quiet exit. `models list` and
/// `launch --list` are exactly the sort of output people pipe, so behave like
/// every other Unix tool.
fn restore_default_sigpipe() {
    #[cfg(unix)]
    unsafe {
        use nix::sys::signal::{signal, SigHandler, Signal};
        let _ = signal(Signal::SIGPIPE, SigHandler::SigDfl);
    }
}

/// Print an error and exit non-zero. Every failure path funnels through here so
/// the exit-code contract stays consistent.
fn fail(msg: impl AsRef<str>) -> ! {
    eprintln!("Error: {}", msg.as_ref());
    std::process::exit(1);
}

// ── Models handlers ────────────────────────────────────────────────────────

fn handle_models(cmd: ModelsCommands) {
    match cmd {
        ModelsCommands::List { json } => {
            let models = list_chat_models();

            if json {
                let output: Vec<serde_json::Value> = models
                    .iter()
                    .map(|(id, yml)| {
                        serde_json::json!({
                            "id": id,
                            "name": yml.name,
                            "model_path": yml.model_path,
                            "size_bytes": yml.size_bytes,
                        })
                    })
                    .collect();
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
                return;
            }

            if models.is_empty() {
                eprintln!("No chat models installed.");
                eprintln!();
                eprintln!("  Download one in the GChat desktop app, or serve a");
                eprintln!("  HuggingFace repo directly:");
                eprintln!();
                eprintln!("    gchat-cli serve <owner>/<repo>");
                return;
            }

            let id_width = models
                .iter()
                .map(|(id, _)| id.chars().count())
                .max()
                .unwrap_or(0)
                .max(8);

            let dim = Style::new().dim();
            println!();
            println!(
                "  {:<id_width$}  {:>9}",
                dim.apply_to("MODEL ID"),
                dim.apply_to("SIZE"),
                id_width = id_width
            );
            for (id, yml) in &models {
                let size = if yml.size_bytes == 0 {
                    "-".to_string()
                } else {
                    fmt_bytes(yml.size_bytes)
                };
                println!("  {id:<id_width$}  {size:>9}", id_width = id_width);
            }
            println!();
        }
    }
}

// ── Server handlers ────────────────────────────────────────────────────────

async fn handle_server(cmd: ServerCommands) {
    match cmd {
        ServerCommands::Status {
            host,
            port,
            prefix,
            api_key,
            json,
        } => {
            // The app mirrors its live proxy settings to disk because they
            // otherwise live in the webview's localStorage, which a headless
            // process cannot read. The file is only a hint: a crashed app
            // leaves `running: true` behind, so the HTTP probe below decides.
            let mut state = state_file::read_state();
            if let Some(h) = host {
                state.host = h;
            }
            if let Some(p) = port {
                state.port = p;
            }
            if let Some(p) = prefix {
                state.prefix = p;
            }

            let api_key = api_key
                .or_else(|| std::env::var("GCHAT_API_KEY").ok())
                .filter(|k| !k.is_empty());

            let reachable = probe_server(&state).await;
            let models = if reachable {
                fetch_server_models(&state, api_key.as_deref()).await
            } else {
                Err("server not reachable".to_string())
            };

            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "running": reachable,
                        "url": state.api_url(),
                        "host": state.host,
                        "port": state.port,
                        "prefix": state.prefix,
                        "requires_api_key": state.requires_api_key,
                        "models": models.as_ref().ok(),
                        "models_error": models.as_ref().err(),
                    }))
                    .unwrap()
                );
            } else {
                print_server_status(&state, reachable, &models);
            }

            if !reachable {
                std::process::exit(1);
            }
        }
    }
}

/// Liveness probe. `GET /` is on the proxy's whitelist, so it answers even when
/// the server is configured to require an API key.
async fn probe_server(state: &LocalApiServerState) -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(format!("{}/", state.base_url()))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Ask the proxy which models are currently loaded. Unlike the liveness probe
/// this route is behind the API key when one is configured.
async fn fetch_server_models(
    state: &LocalApiServerState,
    api_key: Option<&str>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.get(format!("{}/models", state.api_url()));
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("server requires an API key — pass --api-key or set GCHAT_API_KEY".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("server returned {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(body["data"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m["id"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

fn print_server_status(
    state: &LocalApiServerState,
    reachable: bool,
    models: &Result<Vec<String>, String>,
) {
    let dim = Style::new().dim();
    println!();
    if reachable {
        println!(
            "  {} Local API Server is running",
            Style::new().green().apply_to("●")
        );
        println!("  {}  {}", dim.apply_to("Endpoint"), state.api_url());
        match models {
            Ok(ids) if ids.is_empty() => {
                println!("  {}    none loaded", dim.apply_to("Models"));
            }
            Ok(ids) => {
                println!("  {}    {}", dim.apply_to("Models"), ids.join(", "));
            }
            Err(e) => {
                println!("  {}    {}", dim.apply_to("Models"), dim.apply_to(e));
            }
        }
    } else {
        println!(
            "  {} Local API Server is not running",
            Style::new().red().apply_to("○")
        );
        println!("  {}  {}", dim.apply_to("Expected"), state.api_url());
        println!();
        println!("  Start it from the GChat desktop app:");
        println!("  Settings → Local API Server.");
    }
    println!();
}

// ── Spinner / progress helpers ─────────────────────────────────────────────

fn make_spinner(msg: impl Into<std::borrow::Cow<'static, str>>) -> ProgressBar {
    let pb = ProgressBar::new_spinner();
    pb.set_style(
        ProgressStyle::default_spinner()
            .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"])
            .template("{spinner:.cyan} {msg}")
            .unwrap(),
    );
    pb.set_message(msg);
    pb.enable_steady_tick(std::time::Duration::from_millis(80));
    pb
}

/// Start a spinner, or print a plain status line if verbose mode is on.
/// Returns `None` in verbose mode so callers know to skip spinner updates.
fn start_progress(verbose: bool, msg: impl Into<String>) -> Option<ProgressBar> {
    if verbose {
        eprintln!("{}", msg.into());
        None
    } else {
        Some(make_spinner(msg.into()))
    }
}

/// Finish the spinner with a final message, or print the message plainly in verbose mode.
fn finish_progress(pb: Option<ProgressBar>, msg: impl AsRef<str>) {
    match pb {
        Some(pb) => {
            pb.finish_and_clear();
            eprintln!("{}", msg.as_ref());
        }
        None => eprintln!("{}", msg.as_ref()),
    }
}

// ── HuggingFace auto-download ──────────────────────────────────────────────

/// Read `HF_TOKEN` or `HUGGING_FACE_HUB_TOKEN` from the environment.
fn hf_token() -> Option<String> {
    std::env::var("HF_TOKEN")
        .or_else(|_| std::env::var("HUGGING_FACE_HUB_TOKEN"))
        .ok()
        .filter(|s| !s.is_empty())
}

/// Format a byte count as a human-readable string (GB / MB / KB).
fn fmt_bytes(b: u64) -> String {
    if b >= 1_000_000_000 {
        format!("{:.1} GB", b as f64 / 1_000_000_000.0)
    } else if b >= 1_000_000 {
        format!("{:.0} MB", b as f64 / 1_000_000.0)
    } else {
        format!("{:.0} KB", b as f64 / 1_000.0)
    }
}

/// Show an interactive picker for a list of HF `.ginfer` files and return the
/// index of the chosen one. Returns 0 immediately when there is only one file.
async fn pick_hf_file(files: &[HfFileInfo]) -> usize {
    if files.len() == 1 {
        return 0;
    }

    let labels: Vec<String> = files
        .iter()
        .map(|f| format!("{:<55} {}", f.filename, fmt_bytes(f.size)))
        .collect();

    prompt_select("Select a file to download", labels).await
}

/// Run a blocking `dialoguer` prompt off the async runtime's worker threads.
async fn prompt_select(prompt: &'static str, labels: Vec<String>) -> usize {
    tokio::task::spawn_blocking(move || {
        dialoguer::Select::new()
            .with_prompt(prompt)
            .items(&labels)
            .default(0)
            .interact()
            .unwrap_or_else(|_| std::process::exit(1))
    })
    .await
    .unwrap_or_else(|_| std::process::exit(1))
}

/// Fetch `.ginfer` files from HuggingFace, pick one, download it, and return
/// the local model ID ready to load.
///
/// Exits the process on any unrecoverable error.
async fn auto_download_hf_model(repo_id: &str, select_file: bool) -> String {
    let token = hf_token();
    let tok_ref = token.as_deref();

    // Fetch available .ginfer files from the HF API
    eprintln!();
    let fetch_pb = make_spinner(format!(
        "Fetching file list for '{repo_id}' from HuggingFace…"
    ));
    let files = match fetch_hf_ginfer_files(repo_id, tok_ref).await {
        Ok(f) => f,
        Err(e) => {
            fetch_pb.finish_with_message(format!("✗ {e}"));
            std::process::exit(1);
        }
    };
    fetch_pb.finish_and_clear();

    // Show the picker on request, otherwise take the largest file.
    let chosen = if select_file {
        &files[pick_hf_file(&files).await]
    } else {
        files.iter().max_by_key(|f| f.size).unwrap()
    };
    eprintln!("  Downloading  {}", chosen.filename);
    eprintln!("  Size         {}", fmt_bytes(chosen.size));
    eprintln!();

    // Progress bar — byte-count style
    let dl_pb = ProgressBar::new(chosen.size);
    dl_pb.set_style(
        ProgressStyle::default_bar()
            .template("  {bar:45.yellow/dim}  {bytes:>9}/{total_bytes}  {bytes_per_sec}  eta {eta}")
            .unwrap()
            .progress_chars("█▉▊▋▌▍▎▏  "),
    );

    let dl_pb_clone = dl_pb.clone();
    let model_id = match download_hf_model(repo_id, chosen, tok_ref, move |done, _total| {
        dl_pb_clone.set_position(done);
    })
    .await
    {
        Ok(id) => id,
        Err(e) => {
            dl_pb.finish_with_message(format!("✗ Download failed: {e}"));
            std::process::exit(1);
        }
    };

    dl_pb.finish_and_clear();
    eprintln!("  ✓ Saved to the GChat data folder\n");

    model_id
}

// ── Interactive pickers ────────────────────────────────────────────────────

/// Present an interactive menu of the agents installed on this machine.
async fn select_agent_interactively() -> &'static Agent {
    let installed: Vec<&'static Agent> = integrations::AGENTS
        .iter()
        .filter(|a| is_command_installed(a.detect_bin))
        .collect();

    if installed.is_empty() {
        eprintln!("No supported coding agents are installed.");
        eprintln!();
        eprintln!("  Install one, then run `gchat-cli launch <agent>`:");
        eprintln!();
        for agent in integrations::AGENTS {
            eprintln!("    {:<12} {}", agent.id, agent.docs_url);
        }
        std::process::exit(1);
    }

    println!();
    println!(
        "{}",
        Style::new().cyan().bold().apply_to("━━━ Select Agent ━━━")
    );
    println!();

    if installed.len() == 1 {
        println!("  Using {}", installed[0].name);
        println!();
        return installed[0];
    }

    let labels: Vec<String> = installed
        .iter()
        .map(|a| format!("{:<18} {}", a.name, Style::new().dim().apply_to(a.id)))
        .collect();

    let idx = prompt_select("Choose an agent to launch", labels).await;
    installed[idx]
}

/// Present an interactive menu of installed chat models.
async fn select_model_interactively() -> String {
    let models = list_chat_models();

    if models.is_empty() {
        eprintln!("No chat models installed.");
        eprintln!();
        eprintln!("  Download one in the GChat desktop app, or name a");
        eprintln!("  HuggingFace repo and it will be fetched:");
        eprintln!();
        eprintln!("    gchat-cli serve <owner>/<repo>");
        std::process::exit(1);
    }

    if models.len() == 1 {
        println!();
        println!("  Using model: {}", models[0].0);
        println!();
        return models[0].0.clone();
    }

    println!();
    println!(
        "{}",
        Style::new().cyan().bold().apply_to("━━━ Select Model ━━━")
    );
    println!();

    let labels: Vec<String> = models
        .iter()
        .map(|(id, yml)| {
            if yml.size_bytes == 0 {
                id.clone()
            } else {
                format!(
                    "{:<48} {}",
                    id,
                    Style::new().dim().apply_to(fmt_bytes(yml.size_bytes))
                )
            }
        })
        .collect();

    let idx = prompt_select("Choose a model", labels).await;
    models[idx].0.clone()
}

// ── Port helpers ───────────────────────────────────────────────────────────

/// Resolve `--port 0` to a concrete free port.
///
/// The plugin's own random-port helper needs a Tauri `AppHandle`, which a
/// headless process has no way to build — and passing 0 straight through breaks
/// everything downstream (the readiness poll would dial port 0, and the printed
/// endpoint would say `:0`). Binding an ephemeral port and releasing it is
/// inherently racy, but the window is a few milliseconds wide.
fn resolve_port(port: u16) -> u16 {
    if port != 0 {
        return port;
    }
    match std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()) {
        Ok(addr) => addr.port(),
        Err(e) => fail(format!("Cannot find a free port: {e}")),
    }
}

// ── Backend resolution ─────────────────────────────────────────────────────

/// Locate the `ginfer-serve` binary.
fn resolve_ginfer_bin(bin: Option<String>) -> PathBuf {
    match bin {
        Some(b) => PathBuf::from(b),
        None => discover_ginfer_binary().unwrap_or_else(|| {
            eprintln!("Error: ginfer-serve binary not found.");
            eprintln!();
            eprintln!("  Install a backend in the GChat desktop app");
            eprintln!("  (Settings → Model Providers), or pass --bin <path>.");
            std::process::exit(1);
        }),
    }
}

/// Resolve a model to a local .ginfer path, downloading it from HuggingFace
/// when the id looks like `owner/repo` and nothing is installed under that name.
async fn resolve_or_download(model_id: &str, select_file: bool) -> PathBuf {
    match resolve_model_by_id(model_id) {
        Ok(path) => path,
        Err(_) if looks_like_hf_repo(model_id) => {
            auto_download_hf_model(model_id, select_file).await;
            resolve_model_by_id(model_id).unwrap_or_else(|e| fail(format!("after download: {e}")))
        }
        Err(e) => fail(e),
    }
}

// ── Detached spawn ─────────────────────────────────────────────────────────

/// Re-exec ourselves detached from the terminal. `port` is the already-resolved
/// port, not `args.port`: resolving `--port 0` in the parent is what lets us
/// report the real address instead of handing back a PID and nothing else.
fn spawn_detached(model_id: &str, args: &ServeArgs, port: u16) {
    let exe = std::env::current_exe().expect("cannot resolve current exe");

    // Rebuild argv from ServeArgs fields so we have full control
    // (avoids needing to filter --detach/-d from the raw OS args).
    let mut argv: Vec<String> = vec!["serve".into(), model_id.to_string()];
    if let Some(p) = &args.model_path {
        argv.push(format!("--model-path={p}"));
    }
    if let Some(b) = &args.bin {
        argv.push(format!("--bin={b}"));
    }
    argv.push(format!("--port={port}"));
    if args.embedding {
        argv.push("--embedding".into());
    }
    if args.vision {
        argv.push("--vision".into());
    }
    argv.push(format!("--timeout={}", args.timeout));
    argv.push(format!("--ctx-size={}", args.ctx_size));
    if !args.api_key.is_empty() {
        argv.push(format!("--api-key={}", args.api_key));
    }
    if args.verbose {
        argv.push("--verbose".into());
    }

    // Resolve log file path
    let log_path: PathBuf = args
        .log
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| cli_get_data_folder().join("logs").join("serve.log"));

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .unwrap_or_else(|e| fail(format!("cannot open log file {}: {e}", log_path.display())));
    let log_out = log_file.try_clone().expect("clone log file");

    let mut cmd = std::process::Command::new(&exe);
    cmd.args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(log_out)
        .stderr(log_file);

    // Detach from the current terminal session on Unix
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                nix::unistd::setsid()
                    .map(|_| ())
                    .map_err(|e| std::io::Error::other(e.to_string()))
            });
        }
    }

    // Detach from the console on Windows, which has no setsid: without these
    // flags the "background" child dies with the terminal that started it.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }

    // Not waited on by design: the child outlives us, which is the whole point
    // of --detach. It is reparented to init (setsid on Unix, DETACHED_PROCESS on
    // Windows), so it cannot become our zombie.
    #[allow(clippy::zombie_processes)]
    let child = cmd
        .spawn()
        .unwrap_or_else(|e| fail(format!("failed to spawn detached process: {e}")));

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "pid":      child.id(),
            "model_id": model_id,
            "port":     port,
            "url":      format!("http://127.0.0.1:{port}/v1"),
            "log":      log_path.display().to_string(),
        }))
        .unwrap()
    );
}

// ── Serve handler ─────────────────────────────────────────────────────────

async fn handle_serve(args: ServeArgs) {
    // Resolve model_id:
    // 1. Use the explicit model_id if it is non-empty.
    // 2. When --model-path is given, derive the id from the filename stem (e.g.
    //    "/path/to/my-model.ginfer" → "my-model") so the user never has to pass
    //    a dummy empty-string id.
    // 3. Fall back to the interactive picker only when neither is available.
    let model_id = match args.model_id.as_deref() {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            if let Some(ref path) = args.model_path {
                PathBuf::from(path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "model".to_string())
            } else {
                select_model_interactively().await
            }
        }
    };

    // Resolve `--port 0` before the fork so the detached path can report the
    // address it will actually listen on.
    let port = resolve_port(args.port);

    if args.detach {
        spawn_detached(&model_id, &args, port);
        return;
    }

    // An explicit --model-path skips resolution entirely.
    let model_path = match args.model_path {
        Some(p) => PathBuf::from(p),
        None => resolve_or_download(&model_id, args.select).await,
    };

    let bin_path = resolve_ginfer_bin(args.bin);

    let pb = start_progress(args.verbose, format!("Loading {model_id}…"));

    let ginfer_state = Arc::new(init_ginfer_state());
    let config = GinferConfig {
        vision: args.vision,
        max_context: args.ctx_size.max(0) as u32,
        ..GinferConfig::default()
    };

    match load_ginfer_model_impl(
        ginfer_state.ginfer_process.clone(),
        &bin_path.to_string_lossy(),
        model_id.clone(),
        model_path.to_string_lossy().into_owned(),
        port,
        config,
        args.api_key.clone(),
        args.embedding,
        args.timeout,
    )
    .await
    {
        Ok(info) => {
            let url = format!("http://127.0.0.1:{}", info.port);
            finish_progress(pb, format!("✓ {model_id} ready · {url}"));
            eprintln!();
            eprintln!("  Endpoint  {url}/v1");
            if args.api_key.is_empty() {
                eprintln!(
                    "  {}",
                    Style::new()
                        .dim()
                        .apply_to("No API key set — pass --api-key to require one.")
                );
            }
            eprintln!();
            eprintln!("  Press Ctrl+C to stop.");
            wait_for_shutdown(info.pid).await;
        }
        Err(e) => {
            finish_progress(pb, format!("✗ Failed to load {model_id}"));
            eprintln!(
                "\n{}",
                serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}"))
            );
            std::process::exit(1);
        }
    }
}

/// Block until we are asked to stop, then terminate the model server.
///
/// SIGTERM is honoured alongside Ctrl+C because `serve --detach` prints this
/// process's PID: a plain `kill <pid>` has to take ginfer-serve down with it,
/// or the PID we handed the user is worse than useless — it leaves an orphaned
/// server holding the port and the GPU.
async fn wait_for_shutdown(pid: i32) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut term) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {}
                    _ = term.recv() => {}
                }
            }
            Err(e) => {
                log::warn!("Cannot listen for SIGTERM ({e}); Ctrl+C only");
                tokio::signal::ctrl_c().await.ok();
            }
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await.ok();
    }

    eprintln!("\nShutting down (pid {pid})...");
    kill_process(pid);
}

/// Send a termination signal to a child process by PID.
fn kill_process(pid: i32) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let _ = kill(Pid::from_raw(pid), Signal::SIGTERM);
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status();
    }
}

/// Check if a command is available in PATH.
fn is_command_installed(cmd: &str) -> bool {
    let which = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(which)
        .arg(cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ── Launch handler ─────────────────────────────────────────────────────────

async fn handle_launch(args: LaunchArgs) {
    if args.list {
        print_agent_list();
        return;
    }

    let agent: &'static Agent = match args.agent.as_deref() {
        Some(name) => integrations::find(name).unwrap_or_else(|| {
            eprintln!("Error: unknown agent '{name}'.");
            eprintln!();
            print_agent_list();
            std::process::exit(1);
        }),
        None => select_agent_interactively().await,
    };

    if !is_command_installed(agent.detect_bin) {
        eprintln!("Error: {} is not installed.", agent.name);
        eprintln!();
        eprintln!("  Install it first — the GChat desktop app can do this");
        eprintln!("  for you from the Launch page, or see:");
        eprintln!();
        eprintln!("    {}", agent.docs_url);
        std::process::exit(1);
    }

    let model_id = match args.model {
        Some(m) => m,
        None => select_model_interactively().await,
    };

    let ctx_size = args.ctx_size.unwrap_or(32768);

    let port = resolve_port(args.port);
    let (pid, actual_port) = start_model_server(
        &model_id,
        args.bin,
        port,
        args.api_key.clone(),
        ctx_size,
        args.verbose,
        args.select,
    )
    .await;

    // Model is ready — silence request/response logs so they don't flood the
    // launched agent's terminal.
    if args.verbose {
        log::set_max_level(log::LevelFilter::Warn);
    }

    let base_url = format!("http://127.0.0.1:{actual_port}");
    let api_url = integrations::api_url_for(agent, &base_url, "/v1");

    if let Err(e) = integrations::configure(agent, &api_url, &model_id, &args.api_key).await {
        kill_process(pid);
        fail(format!("could not configure {}: {e}", agent.name));
    }

    let dim = Style::new().dim();
    eprintln!();
    eprintln!("  {}     {}", dim.apply_to("Agent"), agent.name);
    eprintln!("  {}  {}", dim.apply_to("Endpoint"), api_url);
    eprintln!("  {}     {}", dim.apply_to("Model"), model_id);
    eprintln!();

    // Config is written; hand over to the agent.
    let mut argv: Vec<String> = agent.run_args.iter().map(|s| s.to_string()).collect();
    argv.extend(args.agent_args.clone());

    if agent.run_mode == RunMode::Gui {
        // A GUI launcher returns immediately, so exiting here would take the
        // model server down with it. Keep serving until the user stops us.
        let mut cmd = std::process::Command::new(agent.detect_bin);
        cmd.args(&argv)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        apply_agent_env(&mut cmd, agent, &api_url, &model_id, &args.api_key);
        if let Err(e) = cmd.spawn() {
            kill_process(pid);
            fail(format!("could not launch {}: {e}", agent.name));
        }
        eprintln!(
            "  {} opened. The model stays up until you press Ctrl+C.",
            agent.name
        );
        eprintln!();
        wait_for_shutdown(pid).await;
        return;
    }

    eprintln!("  → Launching: {} {}", agent.detect_bin, argv.join(" "));
    eprintln!();

    let mut cmd = std::process::Command::new(agent.detect_bin);
    cmd.args(&argv);
    apply_agent_env(&mut cmd, agent, &api_url, &model_id, &args.api_key);
    let status = cmd.status();

    // Kill the model server when the agent exits.
    kill_process(pid);

    match status {
        Ok(s) => std::process::exit(s.code().unwrap_or(0)),
        Err(e) => fail(format!("launching '{}': {e}", agent.detect_bin)),
    }
}

/// Prepare the agent's environment.
///
/// Ambient provider credentials are cleared first: they would otherwise
/// override the config we just wrote and silently send traffic to a cloud
/// provider. Agents configured purely through environment variables then get
/// theirs set explicitly — `configure_*` persisted them to the user's shell rc,
/// which is not live in a process we are about to spawn.
fn apply_agent_env(
    cmd: &mut std::process::Command,
    agent: &Agent,
    api_url: &str,
    model_id: &str,
    api_key: &str,
) {
    for var in integrations::CONFLICTING_PROVIDER_ENV {
        cmd.env_remove(var);
    }
    for (key, value) in integrations::child_env(agent, api_url, model_id, api_key) {
        cmd.env(key, value);
    }
}

fn print_agent_list() {
    println!("Agents this CLI can configure:");
    println!();
    for agent in integrations::AGENTS {
        let mark = if is_command_installed(agent.detect_bin) {
            Style::new().green().apply_to("●").to_string()
        } else {
            Style::new().dim().apply_to("○").to_string()
        };
        println!("  {mark} {:<12} {}", agent.id, agent.docs_url);
    }
    println!();
    println!(
        "  {}",
        Style::new()
            .dim()
            .apply_to("● installed   ○ not found on PATH")
    );
}

/// Start the model server and return `(pid, actual_port)`.
async fn start_model_server(
    model_id: &str,
    bin: Option<String>,
    port: u16,
    api_key: String,
    ctx_size: i32,
    verbose: bool,
    select_file: bool,
) -> (i32, u16) {
    let model_path = resolve_or_download(model_id, select_file).await;
    let bin_path = resolve_ginfer_bin(bin);

    let pb = start_progress(verbose, format!("Loading {model_id}…"));

    let ginfer_state = Arc::new(init_ginfer_state());
    let config = GinferConfig {
        max_context: ctx_size.max(0) as u32,
        ..GinferConfig::default()
    };

    let info = match load_ginfer_model_impl(
        ginfer_state.ginfer_process.clone(),
        &bin_path.to_string_lossy(),
        model_id.to_string(),
        model_path.to_string_lossy().into_owned(),
        port,
        config,
        api_key,
        false,
        120,
    )
    .await
    {
        Ok(info) => info,
        Err(e) => {
            finish_progress(pb, format!("✗ Failed to load {model_id}"));
            eprintln!(
                "{}",
                serde_json::to_string_pretty(&e).unwrap_or_else(|_| format!("{e:?}"))
            );
            std::process::exit(1);
        }
    };

    let url = format!("http://127.0.0.1:{}", info.port);
    finish_progress(pb, format!("✓ {model_id} ready · {url}"));
    (info.pid, info.port)
}
