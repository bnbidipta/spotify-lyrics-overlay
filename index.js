const { app, BrowserWindow, ipcMain } = require('electron');
const axios = require('axios');
const http = require('http');
const url = require('url');
const path = require('path');
require('dotenv').config();

let accessToken = null;
let mainWindow = null;
let loginWindow = null;
let playbackPollInterval = null;

// Create a main window to display lyrics
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    show: true,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('did-finish-load', () => {
    if (!accessToken) {
      mainWindow.webContents.send('auth-required', true);
    } else {
      mainWindow.webContents.send('auth-status', 'authenticated');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (playbackPollInterval) {
      clearInterval(playbackPollInterval);
    }
  });

  return mainWindow;
}

// Start local auth server
function startAuthServer() {
  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/callback' && parsedUrl.query.code) {
      const code = parsedUrl.query.code;
      const tokenUrl = 'https://accounts.spotify.com/api/token';
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://127.0.0.1:8888/callback',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      });
      axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      .then(response => {
        accessToken = response.data.access_token;
        
        // Notify the renderer
        if (mainWindow) {
          mainWindow.webContents.send('auth-status', 'authenticated');
        }

        // Close login popup automatically
        if (loginWindow) {
          loginWindow.close();
          loginWindow = null;
        }

        // Start polling currently playing song
        startPlaybackMonitoring();

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body>Login successful. You can close this window.</body></html>');
      })
      .catch(error => {
        console.error('Token exchange error:', error);
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body>Login failed.</body></html>');
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Spotify Login</body></html>');
    }
  });
  server.listen(8888, () => {
    console.log('Auth server listening on http://127.0.0.1:8888');
  });
}

// Handle login request from renderer
ipcMain.on('request-login', () => {
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${process.env.SPOTIFY_CLIENT_ID}&redirect_uri=http://127.0.0.1:8888/callback&response_type=code&scope=user-read-currently-playing`;
  
  if (loginWindow) {
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 600,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  loginWindow.loadURL(authUrl);

  loginWindow.on('closed', () => {
    loginWindow = null;
  });
});

// Periodic monitoring of the Spotify Web API
let lastTrackId = null;
function startPlaybackMonitoring() {
  if (playbackPollInterval) {
    clearInterval(playbackPollInterval);
  }

  playbackPollInterval = setInterval(async () => {
    if (!accessToken) return;

    try {
      const response = await axios.get('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (response.status === 204 || !response.data || !response.data.is_playing) {
        if (mainWindow) {
          mainWindow.webContents.send('update-lyrics', {
            songInfo: 'No music playing',
            lyrics: 'Play a song on Spotify to view lyrics.'
          });
        }
        return;
      }

      const track = response.data.item;
      if (!track) return;
      
      const trackId = track.id;

      if (trackId !== lastTrackId) {
        lastTrackId = trackId;
        const songInfo = `${track.name} - ${track.artists.map(a => a.name).join(', ')}`;
        
        // Retrieve lyrics
        const lyrics = await fetchLyrics(track.name, track.artists[0].name);

        if (mainWindow) {
          mainWindow.webContents.send('update-lyrics', { songInfo, lyrics });
        }
      }
    } catch (error) {
      console.error('Error fetching playback:', error.message);
      if (error.response && error.response.status === 401) {
        // Access token expired, ask for login again
        accessToken = null;
        if (playbackPollInterval) clearInterval(playbackPollInterval);
        if (mainWindow) {
          mainWindow.webContents.send('auth-required', true);
        }
      }
    }
  }, 3000);
}

// Lyric fetcher logic using Lrclib API
async function fetchLyrics(trackName, artistName) {
  try {
    const response = await axios.get('https://lrclib.net/api/get', {
      params: {
        artist_name: artistName,
        track_name: trackName
      }
    });
    if (response.data && (response.data.plainLyrics || response.data.syncedLyrics)) {
      return response.data.plainLyrics || cleanSyncedLyrics(response.data.syncedLyrics);
    }
    return "Lyrics not found for this track.";
  } catch (err) {
    return "Lyrics not found for this track.";
  }
}

// Clean timestamps from synced lyrics if plainLyrics is missing
function cleanSyncedLyrics(syncedLyrics) {
  return syncedLyrics
    .split('\n')
    .map(line => line.replace(/^\[\d+:\d+(?:\.\d+)?\]\s*/, ''))
    .join('\n');
}

app.whenReady().then(() => {
  startAuthServer();
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});