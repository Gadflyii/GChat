# Стабильный запуск и доработка GChat

## Что произошло в логе

1. **Ошибки Vite/esbuild** (`The service was stopped` / `The service is no longer running`) появились **после того, как ты закрыл окно GChat**. При закрытии приложения завершается процесс `cargo run` → завершается весь `yarn dev` → останавливается дочерний Vite. В момент остановки Vite ещё успевает попытаться обработать запросы (HMR и т.д.) и пишет, что сервис уже не запущен. Это не баг кода, а следствие остановки dev-процесса.

2. **Иконки генерируются при каждом запуске** — скрипт `dev:tauri` каждый раз вызывает `yarn build:icon`. Так задумано в проекте, добавляет несколько секунд к старту.

3. **Rust пересобирается** — при первом после изменений запуске cargo делает инкрементальную сборку (~13–40 с). Без изменений в Rust сборка почти мгновенная.

---

## Как запускать стабильно

### Один терминал, один процесс

```bash
cd /path/to/gchat
yarn dev
```

- Дождись в логе: `Running target/debug/GChat` и появления окна GChat.
- **Не закрывай этот терминал** и по возможности **не закрывай окно GChat** во время разработки.
- Редактируй код в `web-app/` — Vite подхватит изменения (hot reload), перезапуск не нужен.
- Редактируешь Rust в `src-tauri/` — после сохранения Tauri сам пересоберёт и перезапустит приложение.

**Когда закончил работу:** закрой окно GChat, затем в терминале нажми **Ctrl+C** один раз. Так и Vite, и Tauri завершатся предсказуемо, без лишних сообщений об остановленном сервисе.

---

## Порядок при каждом «приходе за компьютер»

1. Открыть терминал.
2. `cd /path/to/gchat`
3. `yarn dev`
4. Дождаться открытия окна GChat.
5. Дорабатывать фронт в `web-app/` или бэкенд в `src-tauri/`.
6. В конце: закрыть окно GChat → в терминале **Ctrl+C**.

Повторный запуск — снова только `yarn dev` (без `make dev`), если не менял зависимости и не делал `make clean`.

---

## Что где править

| Задача | Где код |
|--------|--------|
| UI, экраны, компоненты | `web-app/src/` |
| Логика расширений, ядро (TypeScript) | `core/`, `extensions/` |
| Нативное API, плагины, CLI | `src-tauri/` (Rust) |

После правок в **web-app** перезапуск не нужен — сработает hot reload. После правок в **Rust** Tauri сам пересоберёт и перезапустит приложение.

---

## Если что-то пошло не так

- **«The service is no longer running»** — обычно значит, что процесс уже завершён (закрыли окно или нажали Ctrl+C). Просто заново запусти `yarn dev`.
- **Окно не открывается / зависает** — убедись, что порт 1420 свободен (`lsof -i :1420`), заверши старые процессы и снова `yarn dev`.
- **После смены ветки или pull** — при необходимости выполни `make dev` один раз (полная установка и сборка), дальше снова только `yarn dev`.

---

## Where GChat stores data on Windows

Dev (`make dev-windows` / `yarn dev`) and the installed `GChat.exe` **share the same data folders** — there is no separate dev profile. Anything you delete from these paths affects both.

| Path | Contents | Cleared by |
|---|---|---|
| `%APPDATA%\GChat\data\ginfer\models\` | Downloaded `.ginfer` models (local ginfer model cache) | factory reset (UI), `make clean-windows-all`, uninstaller |
| `%APPDATA%\GChat\data\threads\` | Chat history | factory reset, `make clean-windows-all`, uninstaller |
| `%APPDATA%\GChat\data\extensions\` | Installed extensions (`@gchat/*`) | factory reset, `make clean-windows-all`, uninstaller |
| `%APPDATA%\GChat\data\logs\app.log` | Application logs (`tauri_plugin_log`) | factory reset, `make clean-windows-all`, uninstaller |
| `%APPDATA%\GChat\data\store.json` | Migration / version store | factory reset, `make clean-windows-all`, uninstaller |
| `%APPDATA%\GChat\data\mcp_config.json` | MCP servers config | factory reset, `make clean-windows-all`, uninstaller |
| `%APPDATA%\app.gchat\settings.json` | Current `AppConfiguration` (`{ data_folder: ... }`) | `make clean-windows-all`, uninstaller (Tauri default) |
| `%LOCALAPPDATA%\app.gchat\EBWebView\` | WebView2 storage incl. `localStorage` (`setupCompleted`, …) | `make clean-windows-all`, uninstaller |

Unlike the upstream layout there is no legacy-folder baggage: the fork is clean-slate branded, so the data folder is `GChat` (product name) and the Tauri config/WebView2 folders use the bundle id `app.gchat`.

### How to reset for testing

| Need | Command |
|---|---|
| Full wipe (all data, settings, WebView2 cache) — true first-launch | `make clean-windows-all CONFIRM=1` |
| In-app reset | `Settings → General → Reset to Factory Default` |
| End-user uninstall + delete data | Uninstaller → enable **Delete app data** checkbox |

### Custom data folder

If a user has relocated the data folder via `Settings → Advanced → Change data folder location` (`change_app_data_folder`), the uninstaller and `make clean-windows-all` **do not** delete that custom path — only the default `%APPDATA%\GChat\` is cleaned. Removing a custom data folder is the user's responsibility.
