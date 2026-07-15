# Spotify Lyrics Overlay

An ultra-lightweight, customizable, and responsive desktop lyrics overlay for Spotify on Windows. Built using **Neutralinojs**, it leverages your system's native Edge/WebView2 rendering engine to display stunning glassmorphic, Apple Music-style synchronized scrolling lyrics at a tiny size of **under 2 Megabytes** (a 98% reduction from its original 91.6MB Electron implementation).

<p align="center">
  <img src="neutralino-app/resources/icons/appIcon.png" width="128" height="128" alt="Spotify Lyrics Overlay App Icon" />
</p>

## Features

- **Apple Music-Style Synced Scrolling**: Real-time sync loop (`requestAnimationFrame`) utilizing binary search (`O(log n)`) to scroll the active lyrics line smoothly with zero CPU overhead.
- **RCE-Safe Base64 Command Parsing**: Calls local helper scripts via Base64-JSON encoded arguments. This seals command parameter injection vulnerabilities from song metadata or redirect URLs.
- **Client-Side PKCE OAuth Flow**: Complete elimination of client secrets (`SPOTIFY_CLIENT_SECRET`). Uses browser-based PKCE (Proof Key for Code Exchange) flow directly over `fetch`, making credentials sharing obsolete.
- **CSRF Protection & Port Security**: Standard loopback address (`http://127.0.0.1:8888/callback`) with state verification matching UUID keys to block Cross-Site Request Forgery (CSRF).
- **Multi-Provider Scraper Pipeline (Lrclib, NetEase, Musixmatch & Lyrics.ovh)**: Calls a background PowerShell helper with a 4-level fallback search. Correctly sanitizes remaster/single suffixes strictly at the end of song titles.
- **LRU Lyrics Cache & Eviction**: Caches searched lyrics locally in `localStorage` for instant 0ms load times on replays. Keeps cache size under 50 items.
- **WebView2 Transparency & Control Fixes**:
  - Drag the borderless window easily from the designated top header bar.
  - Jitter-free window resizing using Pointer Events and pointer captures.
  - User-select disabled globally to prevent accidental text selections.

---

## Installation & Running

1. Download the latest release `.zip` or install via `SpotifyLyricsOverlay-Setup-2.0.0.exe` from [GitHub Releases](https://github.com/bnbidipta/spotify-lyrics-overlay/releases).
2. Create a `.env` file in the folder next to the executable:
   ```env
   SPOTIFY_CLIENT_ID=your_spotify_client_id_from_dashboard
   ```
   *(Note: No client secret is required under this secure PKCE flow).*
3. Add the redirect URI to your Spotify App settings:
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
   - Edit Settings of your App -> Add Redirect URI: `http://127.0.0.1:8888/callback`.
4. Double-click **`spotify-lyrics-overlay.exe`** to launch the overlay.
5. Click **Login to Spotify** (this launches your browser to verify your account).
6. Play any song on Spotify!

---

## Workspace Directory Structure

```
├── .github/workflows/           # GitHub Actions Build pipeline
│   └── build.yml
├── neutralino-app/              # Application source code
│   ├── resources/               # HTML, CSS, JavaScript, and asset files
│   │   ├── css/
│   │   ├── js/                  # main.js PKCE authentication & rendering logic
│   │   ├── icons/               # App Icons
│   │   └── index.html           # Frame layout and HTML structure (with CSP)
│   ├── neutralino.config.json   # Neutralino configuration and mode profiles
│   ├── auth_listener.ps1        # OAuth code callback loopback listener (port 8888)
│   └── fetch_lyrics.ps1         # Unified background lyrics scraper
│
├── neutralino-release/          # Distribution folder
│   ├── spotify-lyrics-overlay.exe # Native compiled C++ execution engine
│   ├── resources.neu            # Bundled front-end app assets
│   ├── auth_listener.ps1        # Released copy of redirect listener
│   └── fetch_lyrics.ps1         # Released copy of the unified helper
│
├── installer.iss                # Inno Setup Windows installer configuration
├── build_and_push.ps1           # Release build automation script
└── .env                         # Local configuration environment
```

---

## Building and Developing

### Prerequisites
- Node.js installed.
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 10/11).
- Inno Setup Compiler (optional, for compiling installers).

### Build steps:
1. Navigate into the source folder:
   ```bash
   cd neutralino-app
   ```
2. Build the distribution package:
   ```bash
   npx @neutralinojs/neu build
   ```
   This generates the compiled binaries and `resources.neu` inside `neutralino-app/dist/`.

---

## License

ISC License. Made with ❤️ for Spotify overlays.
