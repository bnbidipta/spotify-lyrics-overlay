[Setup]
AppName=Spotify Lyrics Overlay
AppVersion=2.3.0
WizardStyle=modern
DefaultDirName={localappdata}\Programs\SpotifyLyricsOverlay
DefaultGroupName=Spotify Lyrics Overlay
UninstallDisplayIcon={app}\spotify-lyrics-overlay.exe
Compression=lzma2
SolidCompression=yes
OutputDir=.
OutputBaseFilename=SpotifyLyricsOverlay-Setup-2.3.0
PrivilegesRequired=lowest

[Files]
Source: "dist_release\spotify-lyrics-overlay.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist_release\resources.neu"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist_release\auth_listener.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist_release\fetch_lyrics.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist_release\secure_store.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist_release\window_utils.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Spotify Lyrics Overlay"; Filename: "{app}\spotify-lyrics-overlay.exe"
Name: "{userdesktop}\Spotify Lyrics Overlay"; Filename: "{app}\spotify-lyrics-overlay.exe"

[Run]
Filename: "{app}\spotify-lyrics-overlay.exe"; Description: "Launch Spotify Lyrics Overlay"; Flags: nowait postinstall skipifsilent
