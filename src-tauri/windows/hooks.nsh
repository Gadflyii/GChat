; GChat — NSIS installer hooks
; Extends the default Tauri uninstaller to:
;   1. Kill helper processes that hold file locks BEFORE removing files.
;   2. Clean application data directories that live outside the Tauri-managed
;      bundle ID path when the user opts in to "Delete app data".
;
; On Windows the app stores data in three locations:
;   1. %APPDATA%\app.gchat\                  — Tauri-internal store +
;                                               settings.json.
;                                               Cleaned by Tauri default.
;   2. %APPDATA%\GChat\                      — User data folder
;                                               (models, threads, backends,
;                                               logs, store.json,
;                                               mcp_config.json).
;                                               NOT cleaned by Tauri default.
;   3. %LOCALAPPDATA%\app.gchat\EBWebView    — WebView2 cache + localStorage.
;                                               Cleaned by Tauri default,
;                                               but on perUser/passive
;                                               installs lockfiles can be
;                                               left behind, so we redo it.
;
; A custom data_folder set by the user via "Change data folder location"
; is NOT covered by these hooks — the user is responsible for cleaning it.

!macro NSIS_HOOK_PREUNINSTALL
  ; Tauri's CheckIfAppIsRunning macro (called later in the Section Uninstall
  ; from the bundle template) already handles the main binary. Here we kill
  ; helper processes that the app spawns and that frequently keep WebView2
  ; / data files locked when the uninstaller tries to RmDir /r.
  ;
  ; We use taskkill so we don't depend on the nsProcess plugin being bundled.
  ; /T terminates child processes too. Errors are silently ignored — the
  ; process may simply not be running.
  nsExec::Exec 'taskkill /F /T /IM "llama-server.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "bun.exe"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM "uv.exe"'
  Pop $0

  ; msedgewebview2.exe is shared with other Edge-based apps on the system —
  ; we must only kill instances that belong to *our* WebView2 user data
  ; directory (%LOCALAPPDATA%\app.gchat). PowerShell filters by the
  ; process MainModule path. -EA SilentlyContinue + try/catch so we never
  ; abort uninstall if PowerShell is missing or a process exits mid-query.
  nsExec::Exec 'powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process msedgewebview2 -ErrorAction SilentlyContinue | Where-Object { try { $_.MainModule.FileName -like \"*app.gchat*\" } catch { $false } } | Stop-Process -Force -ErrorAction SilentlyContinue"'
  Pop $0

  ; Give the kernel a moment to release file handles after TerminateProcess.
  Sleep 1500
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    ; Clean the user data folder (models, backends, threads, logs, ...).
    RmDir /r "$APPDATA\GChat"
    ; Tauri default already removes %LOCALAPPDATA%\app.gchat, but
    ; perUser/passive uninstalls sometimes leave EBWebView lockfiles behind.
    ; Redo it idempotently — no-op if the directory is already gone.
    RmDir /r "$LOCALAPPDATA\app.gchat"
    ; Drop the per-user AUMID registration used by Toast notifications in dev builds.
    DeleteRegKey HKCU "Software\Classes\AppUserModelId\app.gchat"
  ${EndIf}
!macroend
