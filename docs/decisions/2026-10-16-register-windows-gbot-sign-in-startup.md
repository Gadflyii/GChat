---
date: 2026-10-16
title: "Register per-user Windows Gbot sign-in startup"
---

# 2026-10-16 — Register per-user Windows Gbot sign-in startup

- **Context:** The desktop's Gbot enable command returned success on non-Linux platforms without registering startup. Linux already owns a separate per-data-root desktop entry for the background service.
- **Decision:** On Windows, use the current user's Run registry key through the existing `winreg` dependency and a fakeable boundary. Own one value per App Data root and launch the captured installed executable with its exact `--gbot-service`, data and resource arguments. Verify registry readback before saving the preference, restoring the prior value if saving fails. Keep Linux's implementation unchanged.
- **Consequences:** No administrator access, shell, credentials or new dependency is needed. Disable and paired-service selection remove only this root's entry. Registration failures are explicit; the GUI integration preference is separate from verified OS registration. Run commands over Windows' 260-character limit are rejected with shorter-path guidance. Windows policies can delay or disable startup, so fake-boundary tests do not qualify actual Windows sign-in. Native acceptance remains with the Windows release gate.
- **Owner:** team.
- **Links:** [Background lifetime](../gbot/background-service.md), [desktop boundary](../../src-tauri/src/core/gbot/login_windows.rs), [Microsoft Run key contract](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys).
