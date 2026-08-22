# Contributing to GChat

First off, thank you for considering contributing to GChat. It's people like you that make GChat such an amazing project.

GChat is an AI assistant that can run 100% offline on your device, powered by the ginfer inference engine. Think ChatGPT, but private, local, and under your complete control. If you're thinking about contributing, you're already awesome - let's make AI accessible to everyone, one commit at a time.

## Quick Links to Component Guides

- **[Web App](./web-app/CONTRIBUTING.md)** - React UI and logic
- **[Core SDK](./core/CONTRIBUTING.md)** - TypeScript SDK and extension system
- **[Extensions](./extensions/CONTRIBUTING.md)** - Supportive modules for the frontend
- **[Tauri Backend](./src-tauri/CONTRIBUTING.md)** - Rust native integration
- **[Tauri Plugins](./src-tauri/plugins/CONTRIBUTING.md)** - Hardware and system plugins

## How GChat Actually Works

GChat is a desktop app that runs local AI models through the ginfer inference engine. Here's how the components actually connect:

```
┌──────────────────────────────────────────────────────────┐
│                   Web App (Frontend)                     │
│                      (web-app/)                          │
│  • React UI                                              │
│  • Chat Interface                                        │
│  • Settings Pages                                        │
│  • Model Hub                                             │
└────────────┬─────────────────────────────┬───────────────┘
             │                             │
             │ imports                     │ imports
             ▼                             ▼
  ┌──────────────────────┐      ┌──────────────────────┐
  │     Core SDK         │      │     Extensions       │
  │      (core/)         │      │   (extensions/)      │
  │                      │      │                      │
  │ • TypeScript APIs    │◄─────│ • Assistant Mgmt     │
  │ • Extension System   │ uses │ • Conversations      │
  │ • Event Bus          │      │ • Downloads          │
  │ • Type Definitions   │      │ • GInfer             │
  └──────────┬───────────┘      └───────────┬──────────┘
             │                              │
             │   ┌──────────────────────┐   │
             │   │       Web App        │   │
             │   └──────────┬───────────┘   │
             │              │               │
             └──────────────┼───────────────┘
                            │
                            ▼
                        Tauri IPC
                    (invoke commands)
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Tauri Backend (Rust)                    │
│                      (src-tauri/)                         │
│                                                           │
│  • Window Management        • File System Access          │
│  • Process Control          • System Integration          │
│  • IPC Command Handler      • Security & Permissions      │
└───────────────────────────┬───────────────────────────────┘
                            │
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                   Tauri Plugins (Rust)                    │
│                   (src-tauri/plugins/)                    │
│                                                           │
│     ┌──────────────────┐        ┌──────────────────┐      │
│     │  Hardware Plugin │        │  GInfer Plugin   │      │
│     │                  │        │                  │      │
│     │ • CPU/GPU Info   │        │ • Process Mgmt   │      │
│     │ • Memory Stats   │        │ • Model Serving  │      │
│     │ • System Info    │        │ • NVIDIA Gate    │      │
│     └──────────────────┘        └──────────────────┘      │
└───────────────────────────────────────────────────────────┘
```

### The Communication Flow

1. **JavaScript Layer Relationships**:
   - Web App imports Core SDK and Extensions as JavaScript modules
   - Extensions use Core SDK for shared functionality
   - All run in the browser/webview context

2. **All Three → Backend**: Through Tauri IPC
   - **Web App** → Backend: `await invoke('app_command', data)`
   - **Core SDK** → Backend: `await invoke('core_command', data)`
   - **Extensions** → Backend: `await invoke('ext_command', data)`
   - Each component can independently call backend commands

3. **Backend → Plugins**: Native Rust integration
   - Backend loads plugins as Rust libraries
   - Direct function calls, no IPC overhead

4. **Response Flow**:
   - Plugin → Backend → IPC → Requester (Web App/Core/Extension) → UI updates

### Real-World Example: Loading a Model

Here's what actually happens when you click "Download" on a ginfer model:

1. **Web App** (`web-app/`) - User clicks download button
2. **Extension** (`extensions/download-extension`) - Handles the download logic
3. **Tauri Backend** (`src-tauri/`) - Actually downloads the `.ginfer` file to disk
4. **Extension** (`extensions/ginfer-extension`) - Registers the model with the ginfer engine
5. **Tauri Plugin** (`src-tauri/plugins/tauri-plugin-ginfer`) - Manages the `ginfer-serve` process
6. **Hardware Plugin** (`src-tauri/plugins/tauri-plugin-hardware`) - Detects the NVIDIA GPU, enforces the CUDA 13.1 gate
7. **Model ready!** - User can start chatting

## Project Structure

```
gchat/
├── web-app/              # React frontend (what users see)
├── src-tauri/            # Rust backend (system integration)
│   ├── src/core/         # Core Tauri commands
│   └── plugins/          # Tauri plugins (ginfer, hardware, rag, vector-db)
├── core/                 # TypeScript SDK (API layer)
├── extensions/           # JavaScript extensions
│   ├── assistant-extension/
│   ├── conversational-extension/
│   ├── download-extension/
│   ├── ginfer-extension/
│   ├── rag-extension/
│   └── vector-db-extension/
├── pre-install/          # Pre-built extension tarballs
├── docs/                 # Documentation website
├── autoqa/               # Automated testing
├── scripts/              # Build utilities
├── tests/                # Top-level Vitest + quality fixtures
│
├── package.json          # Root workspace configuration
├── Makefile              # Build automation commands
├── LICENSE               # Apache 2.0 license
└── README.md             # Project overview
```

## Development Setup

### The Scenic Route (Build from Source)

**Prerequisites:**
- Node.js ≥ 20.0.0
- Yarn ≥ 4.5.3
- Make ≥ 3.81
- Rust (for Tauri)
- Linux x86_64 with an NVIDIA GPU (CUDA 13.1, SM 86/89/120a) for local inference

**Option 1: The Easy Way (Make)**
```bash
git clone https://github.com/Gadflyii/gchat
cd gchat
make dev
```

## How Can I Contribute?

### Reporting Bugs

- **Ensure the bug was not already reported** by searching on GitHub under [Issues](https://github.com/Gadflyii/gchat/issues)
- If you're unable to find an open issue addressing the problem, [open a new one](https://github.com/Gadflyii/gchat/issues/new)
- Include your system specs and error logs - it helps a ton

### Suggesting Enhancements

- Open a new issue with a clear title and description
- Explain why this enhancement would be useful
- Include mockups or examples if you can

### Your First Code Contribution

**Choose Your Adventure:**
- **Frontend UI and logic** → `web-app/`
- **Shared API declarations** → `core/`
- **Backend system integration** → `src-tauri/`
- **Business logic features** → `extensions/`
- **Dedicated backend handler** → `src-tauri/plugins/`

**The Process:**
1. Fork the repo
2. Create a new branch (`git checkout -b feature-name`)
3. Make your changes (and write tests!)
4. Commit your changes (`git commit -am 'Add some feature'`)
5. Push to the branch (`git push origin feature-name`)
6. Open a new Pull Request against `main` branch

## Testing

```bash
make test-all   # Exhaustive: artefacts, verify, live registries/sidecars/cloud
make verify     # Required local gate: lint, guards, coverage floors, all Rust tests
make verify-fast # Same gate without Rust; also runs from the pre-push hook
make test-local # Root/extension Vitest and platform-supported Rust suites
make test-rust  # Rust suites with inert Tauri resource stubs
yarn test      # Root Vitest projects only
```

`make test-all` is the broadest developer command. Live sidecars and cloud
providers are skipped when their environment variables are absent; pass
`REQUIRE=1` to fail on missing live prerequisites. Its final summary aggregates
phase durations and Vitest, Rust, Node TAP, and live check totals.

`verify-fast` is deterministic: it does not download models, contact cloud
providers, or require API keys. It rejects new false-confidence test patterns
and regressions below the committed coverage floor for critical production
files. Existing exceptions live in `tests/test-quality-allowlist.json`; do not
add one when the test can assert a persisted, rendered, or serialized outcome.

Rust command tests use two layers:

- File-store and domain tests call path-based functions directly with `TempDir`.
- IPC tests register the real `#[tauri::command]` handlers and invoke them through
  the shared test harness in `src-tauri/src/test_support.rs`. These tests pin
  command names, camelCase argument decoding, result/error serialization, and
  Tauri dispatch behavior.

Keep direct tests for business rules and concurrency. Add or update an IPC test
when a command name, argument shape, or serialized response changes. The
`tauri::test` IPC APIs are unstable; access the IPC request/response primitives
through the shared harness instead of importing them into feature tests.

Frontend Tauri service tests also use two layers:

- UI and hook tests seed the real Zustand service store with explicit test
  services from `web-app/src/test/service-hub.ts`. Do not install a global
  `useServiceHub` module mock.
- IPC-boundary tests execute the real `services/*/tauri.ts` adapter and
  intercept the resulting call with `@tauri-apps/api/mocks`. Use `mockIPC` for
  commands, `mockWindows` for window metadata, and `mockConvertFileSrc` for
  asset URLs. The shared setup clears Tauri mock state after every test.

Do not combine `mockIPC` with a module mock of `@tauri-apps/api/core` in the
same suite: the module mock bypasses Tauri's IPC machinery and defeats the
contract test.

## Code Standards

### TypeScript/JavaScript
- TypeScript required (we're not animals)
- ESLint + Prettier
- Functional React components
- Proper typing (no `any` - seriously!)

### Rust
- `cargo fmt` + `cargo clippy`
- `Result<T, E>` for error handling
- Document public APIs

## Git Conventions

### Branches
- `main` - main branch with latest & completed commits (target this branch for PRs)
- `release/*` - stable releases or upcoming release candidate
- `feature/*` - new features
- `fix/*` - bug fixes

### Commit Messages
- Use the present tense ("Add feature" not "Added feature")
- Be descriptive but concise
- Reference issues when applicable

Examples:
```
feat: add support for Qwen models
fix: resolve memory leak in model loading
docs: update installation instructions
```

## Troubleshooting

If things go sideways:

1. **Check [GitHub Issues](https://github.com/Gadflyii/gchat/issues) for known problems**
2. **Clear everything and start fresh:** `make clean` then `make dev`
3. **Copy your error logs and system specs**
4. **Open an issue with the logs attached**

Common issues:
- **Build failures**: Check Node.js and Rust versions
- **Extension not loading**: Verify it's properly registered
- **Model not working**: Check the NVIDIA GPU (CUDA 13.1, SM 86/89/120a) and drivers

## Getting Help

- [Documentation](https://github.com/Gadflyii/gchat#readme) - Project overview and setup
- [GitHub Issues](https://github.com/Gadflyii/gchat/issues) - Report bugs here
- [GitHub Discussions](https://github.com/Gadflyii/gchat/discussions) - Ask questions

## License

Apache 2.0 - Because sharing is caring. See [LICENSE](./LICENSE) for the legal stuff.

## Additional Notes

We're building something pretty cool here — an AI assistant that respects your privacy and runs entirely on your machine. Every contribution, no matter how small, helps make AI more accessible to everyone.

Thanks for being part of the journey. Let's build the future of local AI together! 🚀
