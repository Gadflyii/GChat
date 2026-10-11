; GChat — NSIS installer hooks
; Hands per-user installation to the shared Host and extends the uninstaller
; to clean application data directories
; outside the Tauri-managed bundle ID path when the user opts in to
; "Delete app data".
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

!macro NSIS_HOOK_POSTINSTALL
  ; The GChat CLI resolves the same saved/custom data folder as the desktop,
  ; installs its verified runtime and returns after shared Host job handoff.
  ; Wait only for verified copying and bounded Host handoff, so an immediate
  ; desktop launch cannot race runtime installation. Never wait for calibration.
  SetShellVarContext current
  StrCpy $0 -1
  ClearErrors
  ExecWait '"$INSTDIR\resources\bin\gchat-cli.exe" prepare-hardware --resource-directory "$INSTDIR" --app-data-directory "$APPDATA\${BUNDLEID}"' $0
  ${If} ${Errors}
    StrCpy $0 -1
  ${EndIf}
  ${If} $0 <> 0
    DetailPrint "Hardware preparation handoff failed (exit $0). Open GChat or GInfer Manager to review hardware readiness and retry."
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "GChat was installed, but hardware preparation could not be handed to the shared Host. Open GChat or GInfer Manager to review hardware readiness and retry. No calibration success is claimed."
    ${EndIf}
  ${EndIf}
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
