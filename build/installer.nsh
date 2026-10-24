; Included by electron-builder in the NSIS installer.
; Removes the Explorer menu entry that the app writes (see src/main/explorer-menu.js).
; An update also runs the old uninstaller; the entry stays then, so the user's choice is kept.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\Directory\shell\Diskbloom"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Diskbloom"
    DeleteRegKey HKCU "Software\Classes\Drive\shell\Diskbloom"
  ${endIf}
!macroend
