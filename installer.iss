[Setup]
AppName=Spotify Lyrics Overlay
AppVersion=2.0.0
WizardStyle=modern
DefaultDirName={localappdata}\Programs\SpotifyLyricsOverlay
DefaultGroupName=Spotify Lyrics Overlay
UninstallDisplayIcon={app}\spotify-lyrics-overlay.exe
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=SpotifyLyricsOverlay-Setup-2.0.0
PrivilegesRequired=lowest

[Files]
Source: "neutralino-release\spotify-lyrics-overlay.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\resources.neu"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\auth_listener.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\fetch_lyrics.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\secure_store.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "neutralino-release\window_utils.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Spotify Lyrics Overlay"; Filename: "{app}\spotify-lyrics-overlay.exe"
Name: "{userdesktop}\Spotify Lyrics Overlay"; Filename: "{app}\spotify-lyrics-overlay.exe"

[Run]
Filename: "{app}\spotify-lyrics-overlay.exe"; Description: "Launch Spotify Lyrics Overlay"; Flags: nowait postinstall skipifsilent
