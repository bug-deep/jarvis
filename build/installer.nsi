Unicode true
SetCompressor zlib

!include "MUI2.nsh"

!define APPNAME "Jarvis"
!define APPVERSION "0.2.0"
!define APPEXE "Jarvis.exe"
!define APPDIR "../dist/Jarvis"

Name "${APPNAME}"
OutFile "../dist/Jarvis-Setup-${APPVERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Jarvis"
InstallDirRegKey HKCU "Software\Jarvis" "InstallDir"
RequestExecutionLevel user
BrandingText "Jarvis"

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Russian"

Section "Jarvis" SecMain
  SetOutPath "$INSTDIR"
  File /r "${APPDIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$DESKTOP\Jarvis.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\${APPEXE}" 0
  CreateDirectory "$SMPROGRAMS\Jarvis"
  CreateShortcut "$SMPROGRAMS\Jarvis\Jarvis.lnk" "$INSTDIR\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\Jarvis\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Jarvis" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayName" "Jarvis"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "Publisher" "Jarvis"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "DisplayIcon" "$INSTDIR\${APPEXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Jarvis.lnk"
  RMDir /r "$SMPROGRAMS\Jarvis"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Jarvis"
  DeleteRegKey HKCU "Software\Jarvis"
SectionEnd
