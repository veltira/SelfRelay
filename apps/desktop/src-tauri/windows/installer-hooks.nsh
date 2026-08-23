; SelfRelay installer lifecycle hooks.
; 0.1.x could remain resident in the tray while a new installer replaced files.
; Ask the UI thread behind every historical SelfRelay main-window title to leave
; its native message loop before installation proceeds. This uses Win32 directly
; from NSIS and does not launch cmd.exe, PowerShell or a console helper.

!macro SELFRELAY_QUIT_WINDOW TITLE
  FindWindow $0 "" "${TITLE}"
  StrCmp $0 0 +4
    System::Call 'user32::GetWindowThreadProcessId(p r0, *i .r1) i .r2'
    System::Call 'user32::PostThreadMessageW(i r2, i 0x0012, p 0, p 0) i .r3'
    Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay"
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay — v0.1.1"
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay — Desktop"
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\selfrelay-desktop-core.exe"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay"
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay — v0.1.1"
  !insertmacro SELFRELAY_QUIT_WINDOW "SelfRelay — Desktop"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SelfRelay"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; User checkpoints and audio in AppData are intentionally preserved.
!macroend
