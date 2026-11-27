; Version is passed by build.ps1 (/DAppVersion=x.y.z); fallback for manual ISCC runs.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; AppId pinned to the pre-rename implicit id so Overtone upgrades the old
; "Spotify Lyrics Overlay" install in place instead of adding a second entry.
AppId=Spotify Lyrics Overlay
AppName=Overtone
AppVersion={#AppVersion}
AppPublisher=Bidipta Nandan
AppPublisherURL=https://github.com/bnbidipta/spotify-lyrics-overlay
AppSupportURL=https://github.com/bnbidipta/spotify-lyrics-overlay/issues
AppUpdatesURL=https://github.com/bnbidipta/spotify-lyrics-overlay/releases
WizardStyle=modern
DefaultDirName={localappdata}\Programs\Overtone
DefaultGroupName=Overtone
SetupIconFile=neutralino-release\appIcon.ico
UninstallDisplayIcon={app}\appIcon.ico
UninstallDisplayName=Overtone
LicenseFile=LICENSE.txt
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=Overtone-Setup-{#AppVersion}
PrivilegesRequired=lowest
CloseApplications=yes
CloseApplicationsFilter=overtone.exe,spotify-lyrics-overlay.exe,obs_server.exe,spotify_watcher.exe,neutralino-win_x64.exe

[InstallDelete]
; Pre-rename leftovers
Type: files; Name: "{app}\spotify-lyrics-overlay.exe"
Type: files; Name: "{userdesktop}\Spotify Lyrics Overlay.lnk"
Type: filesandordirs; Name: "{userprograms}\Spotify Lyrics Overlay"

[Files]
Source: "neutralino-release\overtone.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\resources.neu"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\appIcon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\auth_listener.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\fetch_lyrics.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\secure_store.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\window_utils.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\obs_server.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\spotify_watcher.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Overtone"; Filename: "{app}\overtone.exe"; IconFilename: "{app}\appIcon.ico"
Name: "{group}\Uninstall Overtone"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Overtone"; Filename: "{app}\overtone.exe"; IconFilename: "{app}\appIcon.ico"

[Run]
Filename: "{app}\overtone.exe"; Description: "Launch Overtone"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Remove the watcher's Run key and stop helpers so nothing points at deleted files
Filename: "{app}\window_utils.exe"; Parameters: "-Action disable-spotify-watcher"; Flags: runhidden; RunOnceId: "DisableWatcher"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM obs_server.exe"; Flags: runhidden; RunOnceId: "KillObs"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM overtone.exe"; Flags: runhidden; RunOnceId: "KillApp"
