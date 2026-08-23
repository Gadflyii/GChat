# Makefile for GChat - Build, Lint, Test, and Clean

REPORT_PORTAL_URL ?= ""
REPORT_PORTAL_API_KEY ?= ""
REPORT_PORTAL_PROJECT_NAME ?= ""
	REPORT_PORTAL_LAUNCH_NAME ?= "GChat App"
REPORT_PORTAL_DESCRIPTION ?= "GChat App report"

# Default target, does nothing
all:
	@echo "Specify a target to run"

# Installs yarn dependencies and builds core and extensions
install-and-build:
ifeq ($(OS),Windows_NT)
	echo "skip"
else ifeq ($(shell uname -s),Linux)
	chmod +x src-tauri/build-utils/*
endif
	yarn install
	yarn build:tauri:plugin:api
	yarn build:core
	yarn build:extensions

# Install required Rust targets for macOS universal builds
install-rust-targets:
ifeq ($(shell uname -s),Darwin)
	@echo "Detected macOS, installing universal build targets..."
	rustup target add x86_64-apple-darwin
	rustup target add aarch64-apple-darwin
	@echo "Rust targets installed successfully!"
else
	@echo "Not macOS; skipping Rust target installation."
endif

# Install required Rust targets for Android builds
install-android-rust-targets:
	@echo "Checking and installing Android Rust targets..."
	@rustup target list --installed | grep -q "aarch64-linux-android" || rustup target add aarch64-linux-android
	@rustup target list --installed | grep -q "armv7-linux-androideabi" || rustup target add armv7-linux-androideabi
	@rustup target list --installed | grep -q "i686-linux-android" || rustup target add i686-linux-android
	@rustup target list --installed | grep -q "x86_64-linux-android" || rustup target add x86_64-linux-android
	@echo "Android Rust targets ready!"

# Install required Rust targets for iOS builds
install-ios-rust-targets:
	@echo "Checking and installing iOS Rust targets..."
	@rustup target list --installed | grep -q "aarch64-apple-ios" || rustup target add aarch64-apple-ios
	@rustup target list --installed | grep -q "aarch64-apple-ios-sim" || rustup target add aarch64-apple-ios-sim
	@rustup target list --installed | grep -q "x86_64-apple-ios" || rustup target add x86_64-apple-ios
	@echo "iOS Rust targets ready!"

dev: install-and-build
	yarn download:bin
	make build-cli-dev
	yarn dev

# Same as `dev`, but reuses already-downloaded artefacts where possible.
dev-fast: install-and-build
	yarn download:bin
	make build-cli-dev
	yarn dev

# Запуск глазами НОВОГО пользователя (как dev-fast по скорости). FRESH_INSTALL
# очищает localStorage webview на каждом старте приложения: срабатывает вся
# fresh-install ветка — онбординг с нуля. Настоящий dev-профиль
# (провайдеры,
# API-ключи, флаги) бэкапится и автоматически восстанавливается при следующем
# обычном `make dev` / `make dev-fast`; всё, что сделано во fresh-запусках,
# отбрасывается. Модели на диске не удаляются (общий каталог data), поэтому
# после онбординга они снова видны в списке.
dev-fresh: install-and-build
	yarn download:bin
	make build-cli-dev
	FRESH_INSTALL=true FORCE_ONBOARDING=true yarn dev

# Dev-режим с форсированным SetupScreen (онбординг) без удаления моделей.
# Флаг FORCE_ONBOARDING прокидывается в vite как compile-time константа.
dev-onboarding: install-and-build
	yarn download:bin
	make build-cli-dev
	FORCE_ONBOARDING=true yarn dev

# Путь к соседнему чекауту atomic-chat-conf. Переопределяется:
#   make dev-onboarding-low-spec ATOMIC_CHAT_CONF=~/work/atomic-chat-conf
ATOMIC_CHAT_CONF ?= ../atomic-chat-conf

# Онбординг глазами пользователя со слабой машиной: FORCE_HARDWARE_TIER=low
# минует определение железа, и пикер показывает low-spec рекомендации (LFM)
# на любом компьютере.
#
# Манифест берём из локального чекаута conf, пока правка туда не влита: в
# удалённом ещё нет `low_spec_recommendations`, а без него клиент штатно
# откатывается на стандартную пару, и низкий тир было бы не увидеть.
dev-onboarding-low-spec: install-and-build
	yarn download:bin
	make build-cli-dev
	@if [ -f "$(ATOMIC_CHAT_CONF)/models/recommended.json" ]; then \
		cp "$(ATOMIC_CHAT_CONF)/models/recommended.json" web-app/public/dev-recommended.json; \
		echo "[dev] манифест: $(ATOMIC_CHAT_CONF)/models/recommended.json"; \
		FORCE_ONBOARDING=true FORCE_HARDWARE_TIER=low \
			VITE_RECOMMENDED_MODELS_REGISTRY_URL=/dev-recommended.json yarn dev; \
	else \
		echo "[dev] $(ATOMIC_CHAT_CONF) не найден — манифест из сети (задайте ATOMIC_CHAT_CONF=...)"; \
		FORCE_ONBOARDING=true FORCE_HARDWARE_TIER=low yarn dev; \
	fi

# ──────────────────────────────────────────────────────────────
# Windows Development
# ──────────────────────────────────────────────────────────────

# One-time setup: installs Rust, nvm-windows, Node.js 20, Python, jq, Yarn
setup-windows:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
else
	@echo "This target is for Windows only. Use 'make dev' instead."
endif

# Full dev workflow for Windows (mirrors CI pipeline)
dev-windows:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1
else
	@echo "This target is for Windows only. Use 'make dev' instead."
endif

# Same as `dev-windows`, but skips re-downloading the backend binary
# (analogue of `dev-fast` for macOS). Fast iteration on the currently
# installed backend without re-downloading.
dev-windows-fast:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/dev-windows.ps1 -SkipBackendDownload
else
	@echo "This target is for Windows only. Use 'make dev-fast' instead."
endif

# Full wipe of all GChat data on Windows — used to simulate a true
# first-launch as if the app had never been installed. Removes the three
# default APPDATA / LOCALAPPDATA directories (see DEVELOP.md → "Where GChat
# stores data on Windows"). Does NOT touch a custom data_folder if the
# user relocated it via the in-app setting — that is the user's responsibility.
#
# Guarded by CONFIRM=1 so an accidental `make clean-windows-all` only prints
# what would be removed.
clean-windows-all:
ifeq ($(OS),Windows_NT)
ifeq ($(CONFIRM),1)
	powershell -ExecutionPolicy Bypass -Command "\
		Get-Process ginfer-serve -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'GChat','gchat' -ErrorAction SilentlyContinue | Stop-Process -Force; \
		Get-Process -Name 'msedgewebview2' -ErrorAction SilentlyContinue | Where-Object { try { $$_.MainModule.FileName -like '*app.gchat*' -or $$_.MainModule.FileName -like '*GChat*' } catch { $$false } } | Stop-Process -Force; \
		Start-Sleep -Seconds 2; \
		$$paths = @( \
			(Join-Path $$env:APPDATA 'GChat'), \
			(Join-Path $$env:APPDATA 'app.gchat'), \
			(Join-Path $$env:LOCALAPPDATA 'app.gchat') \
		); \
		foreach ($$p in $$paths) { \
			if (Test-Path $$p) { \
				Write-Host ('Removing ' + $$p) -ForegroundColor Yellow; \
				Remove-Item $$p -Recurse -Force -ErrorAction SilentlyContinue; \
				if (Test-Path $$p) { Write-Host ('  WARN: failed to fully remove ' + $$p) -ForegroundColor Red } \
			} else { \
				Write-Host ('Not present: ' + $$p) -ForegroundColor Gray; \
			} \
		}; \
		Write-Host 'GChat: full data wipe done.' -ForegroundColor Green; \
	"
else
	@powershell -NoProfile -ExecutionPolicy Bypass -Command "\
		Write-Host 'DRY RUN. Nothing was deleted.' -ForegroundColor Yellow; \
		Write-Host 'These paths WOULD be removed when re-run with CONFIRM=1:' -ForegroundColor Yellow; \
		$$paths = @( \
			(Join-Path $$env:APPDATA 'GChat'), \
			(Join-Path $$env:APPDATA 'app.gchat'), \
			(Join-Path $$env:LOCALAPPDATA 'app.gchat') \
		); \
		foreach ($$p in $$paths) { \
			$$exists = if (Test-Path $$p) { '[exists]' } else { '[not present]' }; \
			Write-Host ('  ' + $$p + '  ' + $$exists) -ForegroundColor Gray; \
		}; \
		Write-Host ''; \
		Write-Host 'Run again with CONFIRM=1 to actually delete:' -ForegroundColor Yellow; \
		Write-Host '  make clean-windows-all CONFIRM=1' -ForegroundColor Cyan; \
	"
endif
else
	@echo "This target is for Windows only."
endif

# Web application targets
install-web-app:
	yarn install

dev-web-app: install-web-app
	yarn build:core
	yarn dev:web-app

build-web-app: install-web-app
	yarn build:core
	yarn build:web-app

serve-web-app:
	yarn serve:web-app

build-serve-web-app: build-web-app
	yarn serve:web-app

# Mobile
dev-android: install-and-build install-android-rust-targets
	@echo "Setting up Android development environment..."
	@if [ ! -d "src-tauri/gen/android" ]; then \
		echo "Android app not initialized. Initializing..."; \
		yarn tauri android init; \
	fi
	@echo "Sourcing Android environment setup..."
	@bash autoqa/scripts/setup-android-env.sh echo "Android environment ready"
	@echo "Starting Android development server..."
	yarn dev:android

dev-ios: install-and-build install-ios-rust-targets
	@echo "Setting up iOS development environment..."
ifeq ($(shell uname -s),Darwin)
	@if [ ! -d "src-tauri/gen/ios" ]; then \
		echo "iOS app not initialized. Initializing..."; \
		yarn tauri ios init; \
	fi
	@echo "Checking iOS development requirements..."
	@xcrun --version > /dev/null 2>&1 || (echo "❌ Xcode command line tools not found. Install with: xcode-select --install" && exit 1)
	@xcrun simctl list devices available | grep -q "iPhone\|iPad" || (echo "❌ No iOS simulators found. Install simulators through Xcode." && exit 1)
	@echo "Starting iOS development server..."
	yarn dev:ios
else
	@echo "❌ iOS development is only supported on macOS"
	@exit 1
endif

# Linting
lint: install-and-build
	yarn lint

# Testing
.PHONY: test test-all test-local test-web test-extensions test-rust stub-resources \
	typecheck verify-fast verify test-quality test-hardening-contracts \
	test-coverage-critical capture-capabilities capture-hw-profile \
	sync-upstream-baseline gen-amd-rocm-pci-ids test-live test-live-cloud mutants

test-web:
	yarn test

test-extensions:
	yarn --cwd extensions workspaces foreach -A \
		--include '@gchat/ginfer-extension' \
		--include '@gchat/download-extension' \
		run test:run

# Tauri validates bundle.resources and externalBin paths while compiling the
# test target. Tests never execute these artefacts, so create only missing
# placeholders and never overwrite a real local build.
stub-resources:
ifeq ($(OS),Windows_NT)
	powershell -NoProfile -Command "\
		$$files = @( \
			'src-tauri/resources/LICENSE', \
			'src-tauri/resources/pre-install/test-placeholder', \
			'src-tauri/resources/bin/gchat-cli.exe', \
			'src-tauri/resources/bin/bun-x86_64-pc-windows-msvc.exe', \
			'src-tauri/resources/bin/uv-x86_64-pc-windows-msvc.exe' \
		); \
		foreach ($$file in $$files) { \
			$$parent = Split-Path -Parent $$file; \
			New-Item -ItemType Directory -Force -Path $$parent | Out-Null; \
			if (-not (Test-Path $$file)) { New-Item -ItemType File -Path $$file | Out-Null } \
		}"
else ifeq ($(shell uname -s),Darwin)
	@mkdir -p src-tauri/resources/bin src-tauri/resources/pre-install
	@[ -e src-tauri/resources/LICENSE ] || touch src-tauri/resources/LICENSE
	@[ -e src-tauri/resources/pre-install/test-placeholder ] || touch src-tauri/resources/pre-install/test-placeholder
	@[ -e src-tauri/resources/bin/gchat-cli ] || touch src-tauri/resources/bin/gchat-cli
	@[ -e src-tauri/resources/bin/bun-aarch64-apple-darwin ] || touch src-tauri/resources/bin/bun-aarch64-apple-darwin
	@[ -e src-tauri/resources/bin/bun-x86_64-apple-darwin ] || touch src-tauri/resources/bin/bun-x86_64-apple-darwin
	@[ -e src-tauri/resources/bin/uv-aarch64-apple-darwin ] || touch src-tauri/resources/bin/uv-aarch64-apple-darwin
	@[ -e src-tauri/resources/bin/uv-x86_64-apple-darwin ] || touch src-tauri/resources/bin/uv-x86_64-apple-darwin
else
	@mkdir -p src-tauri/resources/bin src-tauri/resources/pre-install
	@[ -e src-tauri/resources/LICENSE ] || touch src-tauri/resources/LICENSE
	@[ -e src-tauri/resources/pre-install/test-placeholder ] || touch src-tauri/resources/pre-install/test-placeholder
	@[ -e src-tauri/resources/bin/gchat-cli ] || touch src-tauri/resources/bin/gchat-cli
	@[ -e src-tauri/resources/bin/sqlite-vec.so ] || touch src-tauri/resources/bin/sqlite-vec.so
	@[ -e src-tauri/resources/bin/uv-x86_64-unknown-linux-gnu ] || touch src-tauri/resources/bin/uv-x86_64-unknown-linux-gnu
endif

test-rust: export TAURI_CONFIG := {"bundle":{"icon":["icons/icon.png"]}}
test-rust: stub-resources
	cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features test-tauri -- --test-threads=1
	cargo test --manifest-path src-tauri/plugins/tauri-plugin-ginfer/Cargo.toml
	cargo test --manifest-path src-tauri/plugins/tauri-plugin-hardware/Cargo.toml
	cargo test --manifest-path src-tauri/utils/Cargo.toml

# Fast local suite: root Vitest, extension Vitest, and every test-bearing
# Rust crate supported on the current platform.
test-local: test-web test-extensions test-rust

# Deterministic local gate for agent-authored changes. Coverage replaces the
# ordinary Vitest runs here, so the suites execute once while also producing
# the critical-flow summaries consumed by check-coverage-floor.mjs.
test-quality:
	node scripts/check-test-quality.mjs

test-hardening-contracts:
	node --test tests/registry-contracts.test.mjs

test-coverage-critical:
	yarn test:coverage
	yarn --cwd extensions workspaces foreach -A \
		--include '@gchat/ginfer-extension' \
		run test:coverage
	node scripts/check-coverage-floor.mjs

# The same `tsc -b` the release build runs inside `yarn build:web`. ESLint and
# Vitest never check types (vite strips them unchecked), so without this the
# first tsc a change ever meets is the tag-triggered release build.
typecheck:
	yarn workspace @gchat/web-app run tsc -b

verify-fast:
	yarn lint
	"$(MAKE)" typecheck
	"$(MAKE)" test-quality
	"$(MAKE)" test-hardening-contracts
	"$(MAKE)" test-coverage-critical

verify: verify-fast test-rust

# Explicitly live capture commands. The caller supplies paths/identity so these
# never download artifacts or mutate fixtures during a normal verification run.
capture-capabilities:
	@test -n "$(PROVIDER)" || (echo "PROVIDER is required" && exit 2)
	@test -n "$(BINARY)" || (echo "BINARY is required" && exit 2)
	@test -n "$(OUTPUT)" || (echo "OUTPUT is required" && exit 2)
	node scripts/capture-capabilities.mjs "$(PROVIDER)" "$(BINARY)" "$(OUTPUT)" "$(VERSION)"

capture-hw-profile:
	@test -n "$(OUTPUT)" || (echo "OUTPUT is required" && exit 2)
	node scripts/capture-hw-profile.mjs "$(OUTPUT)"

# Regenerate the offline backend baseline (and its fixture) from the live
# atomic-chat-conf manifest. Live network, so it is not part of verify.
sync-upstream-baseline:
	node scripts/sync-upstream-baseline.mjs $(if $(REVISION),--revision $(REVISION),)

# Regenerate the AMD PCI device id -> gfx table that gates the Windows ROCm
# backend, from AMD's HIP SDK support matrix and pci.ids. Live network.
gen-amd-rocm-pci-ids:
	node scripts/gen-amd-rocm-pci-ids.mjs

# Opt-in acceptance against live local binaries and moving external registries.
# Missing sidecar env vars are reported as skips; use REQUIRE=1 to make them
# mandatory. These targets are intentionally excluded from verify/verify-fast.
test-live:
	python3 scripts/test-local-sidecars.py $(if $(filter 1,$(REQUIRE)),--require,)
	ATOMIC_TEST_LIVE_REGISTRIES=1 yarn workspace @gchat/web-app vitest --run \
		src/services/__tests__/external-contracts.test.ts

test-live-cloud:
	python3 scripts/record-cloud-live.py $(if $(filter 1,$(REQUIRE)),--require,)

mutants:
	bash scripts/test-cargo-mutants.sh

test-agent:
	cargo test --manifest-path src-tauri/Cargo.toml -p gchat core::agent

test: lint install-rust-targets
	yarn download:bin
ifeq ($(OS),Windows_NT)
endif
	yarn copy:assets:tauri
	yarn build:icon
	make build-cli
	$(MAKE) test-local

# Exhaustive developer verification: prepare every bundled artefact, run the
# deterministic quality/coverage/Rust gate, then exercise live contracts.
# Unconfigured sidecars and cloud providers are reported as skips. REQUIRE=1
# makes those live prerequisites mandatory.
test-all: install-and-build install-rust-targets
	yarn download:bin
	yarn copy:assets:tauri
	yarn build:icon
	$(MAKE) build-cli
	python3 scripts/run_test_all.py \
		--make "$(MAKE)" \
		$(if $(filter 1,$(REQUIRE)),--require-live,)

# Full Windows release build (local, no code signing).
# Mirrors CI pipeline from release.yml: CPU-only backend, NSIS + MSI installers.
# Output: src-tauri/target/release/bundle/nsis/*.exe
build-windows-release:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/build-windows-release.ps1
else
	@echo "This target is for Windows only."
endif

# Build gchat CLI (release, platform-aware) → src-tauri/resources/bin/gchat[.exe]
build-cli:
ifeq ($(shell uname -s),Darwin)
	cd src-tauri && cargo build --release --features cli --bin gchat-cli --target aarch64-apple-darwin
	cd src-tauri && cargo build --release --features cli --bin gchat-cli --target x86_64-apple-darwin
	lipo -create \
		src-tauri/target/aarch64-apple-darwin/release/gchat-cli \
		src-tauri/target/x86_64-apple-darwin/release/gchat-cli \
		-output src-tauri/resources/bin/gchat-cli
	chmod +x src-tauri/resources/bin/gchat-cli
	mkdir -p src-tauri/target/universal-apple-darwin/release

	echo "Checking for code signing identity..."; \
	SIGNING_IDENTITY=$$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)".*/\1/'); \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		echo "Signing gchat-cli with identity: $$SIGNING_IDENTITY"; \
		codesign --force --options runtime --timestamp --sign "$$SIGNING_IDENTITY" src-tauri/resources/bin/gchat-cli; \
		echo "Code signing completed successfully"; \
	else \
		echo "Warning: No Developer ID Application identity found. Skipping code signing (notarization will fail)."; \
	fi

	cp src-tauri/resources/bin/gchat-cli src-tauri/target/universal-apple-darwin/release/gchat-cli
else ifeq ($(OS),Windows_NT)
	cd src-tauri && cargo build --release --features cli --bin gchat-cli
	powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'src-tauri/resources/bin' | Out-Null; Copy-Item 'src-tauri/target/release/gchat-cli.exe' 'src-tauri/resources/bin/gchat-cli.exe' -Force"
else
	cd src-tauri && cargo build --release --features cli --bin gchat-cli
	cp src-tauri/target/release/gchat-cli src-tauri/resources/bin/gchat-cli
endif

# Debug build for local dev (faster, native arch only)
build-cli-dev:
ifeq ($(OS),Windows_NT)
	cd src-tauri && cargo build --features cli --bin gchat-cli
	powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'src-tauri/resources/bin' | Out-Null; Copy-Item 'src-tauri/target/debug/gchat-cli.exe' 'src-tauri/resources/bin/gchat-cli.exe' -Force"
else
	mkdir -p src-tauri/resources/bin
	cd src-tauri && cargo build --features cli --bin gchat-cli
	install -m755 src-tauri/target/debug/gchat-cli src-tauri/resources/bin/gchat-cli
endif

# Build
build: install-and-build install-rust-targets
	yarn build

# ──────────────────────────────────────────────────────────────
# macOS release build: universal .app + .dmg с версией в VOLNAME
# ──────────────────────────────────────────────────────────────
# Шаги:
#   1. yarn tauri build (universal-apple-darwin, macos-конфиг)
#      — Tauri подписывает и нотаризует .app, создаёт и подписывает .dmg
#   2. scripts/rename-dmg-volume.sh
#      — переименовывает том DMG в "Atomic Chat v<version>"
#      — ломает только подпись DMG-контейнера; .app внутри остаётся нотаризованным
#   3. scripts/notarize-dmg-macos.sh
#      — восстанавливает подпись DMG + нотаризует + стейплит (если заданы APPLE_ID/PASSWORD/TEAM_ID)
#
# Для локальной сборки достаточно `make build-mac`; нотаризация автоматически
# пропустится при отсутствии Apple credentials в окружении.
build-mac:
ifeq ($(shell uname -s),Darwin)
	yarn tauri build --target universal-apple-darwin --config src-tauri/tauri.macos.conf.json
	@DMG=$$(ls -t src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1); \
	if [ -z "$$DMG" ] || [ ! -f "$$DMG" ]; then \
		echo "Error: DMG not found after tauri build"; \
		exit 1; \
	fi; \
	echo "=== DMG located: $$DMG ==="; \
	bash scripts/rename-dmg-volume.sh "$$DMG"; \
	SIGNING_IDENTITY=$${APPLE_SIGNING_IDENTITY:-$$(security find-identity -v -p codesigning 2>/dev/null | grep "Developer ID Application" | head -1 | sed -n 's/.*"\(.*\)".*/\1/p')}; \
	if [ -n "$$SIGNING_IDENTITY" ]; then \
		bash scripts/notarize-dmg-macos.sh "$$DMG"; \
	else \
		echo "Warning: no Developer ID Application identity found — skipping DMG re-sign/notarize."; \
		echo "Note: DMG volume was renamed but container signature is broken. Set APPLE_SIGNING_IDENTITY or install cert to fix."; \
	fi
else
	@echo "build-mac is macOS-only"
	@exit 1
endif

clean:
ifeq ($(OS),Windows_NT)
	-powershell -Command "Get-ChildItem -Path . -Include node_modules, .next, dist, build, out, .turbo, .yarn -Recurse -Directory | Remove-Item -Recurse -Force"
	-powershell -Command "Get-ChildItem -Path . -Include package-lock.json, tsconfig.tsbuildinfo -Recurse -File | Remove-Item -Recurse -Force"
	-powershell -Command "Remove-Item -Recurse -Force ./pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./extensions/*/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./electron/pre-install/*.tgz"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/resources"
	-powershell -Command "Remove-Item -Recurse -Force ./src-tauri/target"
	-powershell -Command "if (Test-Path \"$($env:USERPROFILE)\gchat\extensions\") { Remove-Item -Path \"$($env:USERPROFILE)\gchat\extensions\" -Recurse -Force }"
else ifeq ($(shell uname -s),Linux)
	find . -name "node_modules" -type d -prune -exec rm -rf '{}' +
	find . -name ".next" -type d -exec rm -rf '{}' +
	find . -name "dist" -type d -exec rm -rf '{}' +
	find . -name "build" -type d -exec rm -rf '{}' +
	find . -name "out" -type d -exec rm -rf '{}' +
	find . -name ".turbo" -type d -exec rm -rf '{}' +
	find . -name ".yarn" -type d -exec rm -rf '{}' +
	find . -name "packake-lock.json" -type f -exec rm -rf '{}' +
	find . -name "package-lock.json" -type f -exec rm -rf '{}' +
	rm -rf ./pre-install/*.tgz
	rm -rf ./extensions/*/*.tgz
	rm -rf ./electron/pre-install/*.tgz
	rm -rf ./src-tauri/resources
	rm -rf ./src-tauri/target
	rm -rf "~/gchat/extensions"
	rm -rf "~/.cache/gchat*"
	rm -rf "./.cache"
else
	find . -name "node_modules" -type d -prune -exec rm -rfv '{}' +
	find . -name ".next" -type d -exec rm -rfv '{}' +
	find . -name "dist" -type d -exec rm -rfv '{}' +
	find . -name "build" -type d -exec rm -rfv '{}' +
	find . -name "out" -type d -exec rm -rfv '{}' +
	find . -name ".turbo" -type d -exec rm -rfv '{}' +
	find . -name ".yarn" -type d -exec rm -rfv '{}' +
	find . -name "package-lock.json" -type f -exec rm -rfv '{}' +
	rm -rfv ./pre-install/*.tgz
	rm -rfv ./extensions/*/*.tgz
	rm -rfv ./electron/pre-install/*.tgz
	rm -rfv ./src-tauri/resources
	rm -rfv ./src-tauri/target
	rm -rfv ~/gchat/extensions
	rm -rfv ~/Library/Caches/gchat*
endif
