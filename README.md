# Spotify Lyrics Overlay

An ultra-lightweight, customizable, and responsive desktop lyrics overlay for Spotify on Windows. Built using **Neutralinojs**, it leverages your system's native Edge/WebView2 rendering engine to display stunning glassmorphic, Apple Music-style synchronized scrolling lyrics at a tiny size of **under 2 Megabytes** (a 98% reduction from its original 91.6MB Electron implementation).

<p align="center">
  <img src="neutralino-app/resources/icons/appIcon.png" width="128" height="128" alt="Spotify Lyrics Overlay App Icon" />
</p>

## Features

- **Apple Music-Style Synced Scrolling**: Integrates a real-time local timing loop (`requestAnimationFrame`) interpolating Spotify's playback to center, scale, glow, and scroll the active lyrics line with smooth gradient masks.
- **Musixmatch Fallback Lyrics**: If the track is missing in Lrclib (primary provider), the application automatically falls back to query Musixmatch dynamically via a local background PowerShell API helper.
- **Token Caching & Session Persistence**: Caches Spotify authentication tokens and Musixmatch API search tokens locally to ensure instant load times and completely prevent API rate limiting.
- **WebView2 Transparency & Control Fixes**:
  - Drag the borderless window easily from the designated top header bar.
  - Jitter-free window resizing using Pointer Events and pointer captures.
  - Hover and click events are properly captured on transparent handles without clicking through to the desktop.
  - Account mismatch auto-validation via forced `show_dialog=true` authentication checking.
- **Ultra-Lightweight**: Only ~2MB in package size and extremely low memory footprint compared to Chrome-packaged shells.

---

## Installation & Running

1. Download the latest release `.zip` from the [GitHub Releases](https://github.com/bnbidipta/spotify-lyrics-overlay/releases) page.
2. Extract the folder.
3. Make sure you have a `.env` file in the folder with your Spotify Developer credentials:
   ```env
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   ```
4. Double-click **`spotify-lyrics-overlay.exe`** to launch the overlay.
5. Click **Login to Spotify** (this launches your browser to verify your account).
6. Play any song on Spotify!

---

## Workspace Directory Structure

The project has been cleaned of all heavy Electron leftovers and organized cleanly:

```
├── neutralino-app/              # Application source code
│   ├── resources/               # HTML, CSS, JavaScript, and asset files
│   │   ├── css/
│   │   ├── js/                  # main.js startup and rendering logic
│   │   ├── icons/               # 3D Glossy App Icon
│   │   └── index.html
│   ├── neutralino.config.json   # Neutralino configuration and mode profiles
│   └── fetch_lyrics.ps1         # Unified background scraper for Lrclib & Musixmatch
│
├── neutralino-release/          # Distribution folder
│   ├── spotify-lyrics-overlay.exe # Native compiled C++ execution engine
│   ├── resources.neu            # Bundled front-end app assets
│   ├── auth_listener.ps1        # Native OAuth listener script (port 8888)
│   └── fetch_lyrics.ps1         # Released copy of the unified helper
│
├── .agents/
│   └── AGENTS.md                # Neutralinojs development rules & guardrails
│
└── .env                         # Spotify developer credential keys
```

---

## Building and Developing

### Prerequisites
- Node.js installed.
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Windows 10/11).

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
