; NSIS installer hooks (docs/maintenance sections 54 and 70). ASCII only, CRLF.
;
; Section 54: Tauri registers the .ysm association (bundle.fileAssociations)
; with the exe icon; point the file class at the separate .ysm file icon
; instead. The class name is the association "name" in tauri.conf.json; the
; icon is installed by bundle.resources. The uninstaller deletes the whole
; class key itself.
;
; Section 69: Explorer thumbnails of .ysm files come from the separate
; ysm_thumbnail.dll (thumbnail-provider/, installed by bundle.resources). It is
; registered per user with DisableProcessIsolation=1 (the isolated surrogate
; ignores HKCU classes), so Explorer keeps it loaded: a loaded DLL cannot be
; overwritten or deleted, but it can be renamed, so upgrades and the
; uninstaller move it aside and delete it on reboot. Keep the CLSID in step
; with thumbnail-provider/src/lib.rs and tools/explorer-thumbnail-register.ps1.
!define YSM_THUMB_CLSID "{F6A5A6A3-58D9-4762-82C8-B325D784819C}"
!define YSM_THUMB_HANDLER "{e357fccd-a995-4576-b01f-234630154e96}"

!macro YSM_THUMB_MOVE_ASIDE
  Delete "$INSTDIR\ysm_thumbnail.*.old"
  IfFileExists "$INSTDIR\ysm_thumbnail.dll" 0 +5
    Push $0
    System::Call "kernel32::GetTickCount() i .r0"
    Rename "$INSTDIR\ysm_thumbnail.dll" "$INSTDIR\ysm_thumbnail.$0.old"
    Pop $0
  Delete /REBOOTOK "$INSTDIR\ysm_thumbnail.*.old"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro YSM_THUMB_MOVE_ASIDE
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\YSMModelTool.ysm\DefaultIcon" "" "$INSTDIR\icons\ysm-file.ico"
  WriteRegStr SHCTX "Software\Classes\CLSID\${YSM_THUMB_CLSID}" "" "YSM Thumbnail Provider"
  WriteRegDWORD SHCTX "Software\Classes\CLSID\${YSM_THUMB_CLSID}" "DisableProcessIsolation" 1
  WriteRegStr SHCTX "Software\Classes\CLSID\${YSM_THUMB_CLSID}\InprocServer32" "" "$INSTDIR\ysm_thumbnail.dll"
  WriteRegStr SHCTX "Software\Classes\CLSID\${YSM_THUMB_CLSID}\InprocServer32" "ThreadingModel" "Apartment"
  WriteRegStr SHCTX "Software\Classes\.ysm\ShellEx\${YSM_THUMB_HANDLER}" "" "${YSM_THUMB_CLSID}"
  ; SHCNE_ASSOCCHANGED: refresh the icons and thumbnails Explorer has cached
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\.ysm\ShellEx\${YSM_THUMB_HANDLER}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.ysm\ShellEx"
  DeleteRegKey SHCTX "Software\Classes\CLSID\${YSM_THUMB_CLSID}"
  System::Call "shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)"
  !insertmacro YSM_THUMB_MOVE_ASIDE
!macroend
