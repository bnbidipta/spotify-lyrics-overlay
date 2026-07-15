let accessToken = null;
let playbackPollInterval = null;
let lastTrackId = null;

let spotifyClientId = '';

// Playback and Synced Lyrics state variables
let parsedLyrics = [];
let progressMsLastPoll = 0;
let timestampLastPoll = 0;
let isPlaying = false;
let animationFrameId = null;
let lastActiveIndex = -1;

const authSection = document.getElementById('auth-section');
const lyricsSection = document.getElementById('lyrics-section');
const songInfoEl = document.getElementById('song-info');
const lyricsTextEl = document.getElementById('lyrics-text');
const loginBtn = document.getElementById('login-btn');
const closeBtn = document.getElementById('close-btn');

// Initialize Neutralino
Neutralino.init();

// Setup move handler for draggable window
Neutralino.window.setDraggableRegion('drag-handle');

// Prevent drag interception on buttons
loginBtn.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());

closeBtn.addEventListener('click', () => {
    Neutralino.app.exit();
});

Neutralino.events.on('windowClose', () => {
    Neutralino.app.exit();
});

// Sanitized global error handler to prevent access tokens, refresh tokens, or auth codes leaking to logs
window.onerror = function (message, source, lineno, colno, error) {
    let logMsg = `Error: ${message} at ${source}:${lineno}:${colno}`;
    logMsg = logMsg.replace(/access_token=[a-zA-Z0-9_\-]+/g, 'access_token=[REDACTED]');
    logMsg = logMsg.replace(/refresh_token=[a-zA-Z0-9_\-]+/g, 'refresh_token=[REDACTED]');
    logMsg = logMsg.replace(/code=[a-zA-Z0-9_\-]+/g, 'code=[REDACTED]');
    logMsg = logMsg.replace(/Bearer\s+[a-zA-Z0-9_\-]+/g, 'Bearer [REDACTED]');
    console.error(logMsg);
    return false; // Let browser process it normally
};

// DPAPI Token Encryption (Windows-only, falls back to plaintext if other OS)
async function encryptToken(token) {
    if (!token) return '';
    if (window.NL_OS !== 'Windows') return token;
    try {
        const base64Token = btoa(unescape(encodeURIComponent(token)));
        const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/secure_store.ps1" "encrypt" "${base64Token}"`;
        const result = await Neutralino.os.execCommand(command);
        if (result.stdOut) {
            return result.stdOut.trim();
        }
    } catch (e) {
        console.error('Failed to encrypt token:', e);
    }
    return token;
}

// DPAPI Token Decryption (Windows-only, falls back to plaintext if other OS)
async function decryptToken(encryptedToken) {
    if (!encryptedToken) return '';
    if (window.NL_OS !== 'Windows') return encryptedToken;
    if (encryptedToken.startsWith("ERROR:")) return '';
    
    // DPAPI output is Base64 of a Windows encrypted byte stream. Verify character set before invoking.
    if (!/^[a-zA-Z0-9+/=]+$/.test(encryptedToken)) {
        return encryptedToken;
    }
    
    try {
        const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/secure_store.ps1" "decrypt" "${encryptedToken}"`;
        const result = await Neutralino.os.execCommand(command);
        if (result.stdOut) {
            const output = result.stdOut.trim();
            if (output && !output.startsWith("ERROR:")) {
                return decodeURIComponent(escape(atob(output)));
            }
        }
    } catch (e) {
        console.error('Failed to decrypt token:', e);
    }
    return encryptedToken;
}

// Load Env variables
async function loadEnv() {
    let envContent = '';
    try {
        // Read strictly from absolute executable directory
        envContent = await Neutralino.filesystem.readFile(`${window.NL_PATH}/.env`);
    } catch (err) {
        console.error('Failed to find .env in executable folder:', err);
        songInfoEl.innerText = 'Configuration Error';
        lyricsTextEl.innerText = 'Failed to find .env file containing Spotify credentials in the application directory.';
        return;
    }

    try {
        envContent.split(/\r?\n/).forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                const cleanVal = val.replace(/^["']|["']$/g, '');
                if (key === 'SPOTIFY_CLIENT_ID') {
                    spotifyClientId = cleanVal;
                }
            }
        });
        console.log('Env variables loaded.');
    } catch (err) {
        console.error('Failed to parse env:', err);
        songInfoEl.innerText = 'Configuration Error';
        lyricsTextEl.innerText = 'Failed to parse credentials from .env';
    }
}

// Update UI text
function updateUI(songInfo, placeholderText) {
    songInfoEl.innerText = songInfo;
    if (placeholderText) {
        displayPlaceholderLyric(placeholderText);
    }
}

// Display simple placeholder text in the lyric display box
function displayPlaceholderLyric(text) {
    lyricsTextEl.innerHTML = '';
    const lineEl = document.createElement('div');
    lineEl.className = 'lyric-line active';
    lineEl.innerText = text;
    lyricsTextEl.appendChild(lineEl);
}

// Show auth section
function showAuthRequired() {
    authSection.style.display = 'flex';
    lyricsSection.style.display = 'none';
}

// Hide auth section
function hideAuthRequired() {
    authSection.style.display = 'none';
    lyricsSection.style.display = 'flex';
}

// PKCE Cryptographic Helpers
function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(a) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generateChallenge(verifier) {
    const hashed = await sha256(verifier);
    return base64urlencode(hashed);
}

// Request login flow via browser (PKCE Authorization Code Flow)
async function performLogin() {
    if (!spotifyClientId) {
        alert('SPOTIFY_CLIENT_ID missing in .env!');
        return;
    }
    
    updateUI('Connecting to Spotify...', 'Please log in using the opened browser window.');
    loginBtn.disabled = true;
    loginBtn.innerText = 'Logging in...';

    try {
        // 1. Generate PKCE values & State to prevent CSRF
        const verifier = generateRandomString(64);
        const challenge = await generateChallenge(verifier);
        const state = generateRandomString(16);

        localStorage.setItem('spotify_code_verifier', verifier);
        localStorage.setItem('spotify_auth_state', state);

        // 2. Run PowerShell listener with absolute path and 30s timeout
        const listenerCommand = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/auth_listener.ps1"`;
        
        // 3. Open Spotify Auth page in default system browser
        const authUrl = `https://accounts.spotify.com/authorize?client_id=${spotifyClientId}&redirect_uri=http://127.0.0.1:8888/callback&response_type=code&scope=user-read-currently-playing&code_challenge_method=S256&code_challenge=${challenge}&state=${state}&show_dialog=true`;
        await Neutralino.os.open(authUrl);

        // 4. Await PowerShell command result
        const result = await Neutralino.os.execCommand(listenerCommand);
        if (result.stdOut) {
            let parsedResult = {};
            try {
                parsedResult = JSON.parse(result.stdOut.trim());
            } catch (e) {
                throw new Error('Failed to parse authorization listener response: ' + result.stdOut);
            }

            if (parsedResult.error) {
                if (parsedResult.error === "TIMEOUT") {
                    throw new Error('Authentication timed out. Please try again.');
                }
                throw new Error(parsedResult.error);
            }

            const { code, state: returnedState } = parsedResult;

            // CSRF State Validation
            if (returnedState !== state) {
                throw new Error('CSRF State validation failed.');
            }

            if (code) {
                // 5. Exchange code for Access and Refresh Tokens via direct fetch (CORS supported by Spotify for PKCE!)
                const tokenData = await exchangeCodeForToken(code, verifier);
                accessToken = tokenData.access_token;
                
                // Store tokens encrypted via DPAPI
                const encAccessToken = await encryptToken(tokenData.access_token);
                const encRefreshToken = await encryptToken(tokenData.refresh_token);
                
                localStorage.setItem('spotify_access_token', encAccessToken);
                localStorage.setItem('spotify_refresh_token', encRefreshToken);
                
                const expiresAt = Date.now() + (tokenData.expires_in || 3600) * 1000;
                localStorage.setItem('spotify_token_expires_at', expiresAt.toString());

                hideAuthRequired();
                updateUI('Connecting to Spotify...', 'Successfully authenticated. Resolving playback...');
                startPlaybackMonitoring();
                return;
            }
        }
        throw new Error('No code returned from auth listener.');
    } catch (err) {
        console.error('Login error:', err);
        alert('Authentication failed: ' + err.message);
        showAuthRequired();
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerText = 'Login to Spotify';
    }
}

// Exchange code via direct fetch
async function exchangeCodeForToken(code, verifier) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://127.0.0.1:8888/callback',
        client_id: spotifyClientId,
        code_verifier: verifier
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Token exchange failed: ${errBody}`);
    }

    return await response.json();
}

// Silent Token Refresh using stored Refresh Token via direct fetch (No PowerShell required!)
async function refreshSpotifyToken() {
    const encRefreshToken = localStorage.getItem('spotify_refresh_token');
    if (!encRefreshToken) throw new Error('No refresh token available');
    
    const refreshToken = await decryptToken(encRefreshToken);
    if (!refreshToken) throw new Error('Failed to decrypt refresh token');

    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: spotifyClientId
    });

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Token refresh failed: ${errBody}`);
    }

    const responseData = await response.json();
    if (responseData && responseData.access_token) {
        accessToken = responseData.access_token;
        const encAccess = await encryptToken(accessToken);
        localStorage.setItem('spotify_access_token', encAccess);
        
        if (responseData.refresh_token) {
            const encRefresh = await encryptToken(responseData.refresh_token);
            localStorage.setItem('spotify_refresh_token', encRefresh);
        }
        
        const expiresAt = Date.now() + (responseData.expires_in || 3600) * 1000;
        localStorage.setItem('spotify_token_expires_at', expiresAt.toString());
        console.log('Spotify access token refreshed successfully.');
        return accessToken;
    }
    throw new Error('No access token returned in refresh response.');
}

// Monitoring Spotify Web API
function startPlaybackMonitoring() {
    if (playbackPollInterval) clearInterval(playbackPollInterval);
    
    // Begin the animation frame sync loop
    startLyricsSyncLoop();

    playbackPollInterval = setInterval(async () => {
        if (!accessToken) return;

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });

            if (response.status === 204) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false;
                parsedLyrics = [];
                return;
            }

            if (response.status === 401) {
                // Token expired - try silent refresh
                try {
                    await refreshSpotifyToken();
                    return;
                } catch (refreshErr) {
                    console.error('Failed to silently refresh Spotify token:', refreshErr);
                    accessToken = null;
                    localStorage.removeItem('spotify_access_token');
                    localStorage.removeItem('spotify_refresh_token');
                    localStorage.removeItem('spotify_token_expires_at');
                    clearInterval(playbackPollInterval);
                    if (animationFrameId) cancelAnimationFrame(animationFrameId);
                    showAuthRequired();
                    return;
                }
            }

            // Treat non-200/5xx errors safely to prevent CORS errors from bubbling up to crash
            if (!response.ok) {
                return; 
            }

            const data = await response.json();
            if (!data || !data.item) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false;
                parsedLyrics = [];
                return;
            }

            // Sync current playback timing values
            progressMsLastPoll = data.progress_ms;
            timestampLastPoll = Date.now();
            isPlaying = data.is_playing;

            const track = data.item;
            const trackId = track.id;

            if (trackId !== lastTrackId) {
                lastTrackId = trackId;
                const songInfo = `${track.name} - ${track.artists.map(a => a.name).join(', ')}`;
                updateUI(songInfo, 'Searching for lyrics...');
                lastActiveIndex = -1;

                // 1. Try to load from localStorage cache first (0ms load time)
                const cacheKey = `lyrics_cache_${trackId}`;
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const result = JSON.parse(cached);
                        parsedLyrics = result.lines;
                        renderLyrics(parsedLyrics);
                        updateUI(songInfo, null);
                        console.log(`Lyrics resolved instantly from local cache for track: ${trackId}`);
                        return;
                    } catch (e) {
                        console.error('Failed to parse cached lyrics:', e);
                    }
                }

                // 2. Resolve lyrics from backend (Lrclib -> NetEase -> Musixmatch -> Lyrics.ovh)
                const result = await fetchLyrics(track.name, track.artists[0].name);

                parsedLyrics = result.lines;
                renderLyrics(parsedLyrics);
                updateUI(songInfo, null);

                // Save to persistent cache (only if valid lyrics were returned)
                const isErrorResult = result.lines.length === 0 || 
                    (result.lines.length === 1 && result.lines[0].text === "Lyrics not found for this track.");
                if (!isErrorResult) {
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify(result));
                        
                        // Maintain cache size under 100 entries (LRU Eviction)
                        let cacheKeys = [];
                        try {
                            cacheKeys = JSON.parse(localStorage.getItem('lyrics_cache_keys') || '[]');
                        } catch (e) {}
                        
                        cacheKeys = cacheKeys.filter(k => k !== cacheKey);
                        cacheKeys.push(cacheKey);
                        
                        while (cacheKeys.length > 100) {
                            const oldestKey = cacheKeys.shift();
                            localStorage.removeItem(oldestKey);
                        }
                        localStorage.setItem('lyrics_cache_keys', JSON.stringify(cacheKeys));
                    } catch (e) {
                        console.error('Failed to write to lyrics cache:', e);
                    }
                }
            }
        } catch (err) {
            console.error('Error during playback polling:', err);
        }
    }, 3000);
}

// Fetch lyrics via backend PowerShell script with Base64 JSON args to prevent RCE
async function fetchLyrics(trackName, artistName) {
    try {
        const argsJson = JSON.stringify({ track: trackName, artist: artistName });
        const base64Args = btoa(unescape(encodeURIComponent(argsJson)));
        
        const command = `chcp 65001 >nul && powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/fetch_lyrics.ps1" "${base64Args}"`;
        const result = await Neutralino.os.execCommand(command);
        
        if (result.stdOut) {
            try {
                const data = JSON.parse(result.stdOut.trim());
                if (data && data.lyrics) {
                    if (data.synced) {
                        return { synced: true, lines: parseSyncedLyrics(data.lyrics) };
                    } else {
                        return { synced: false, lines: parsePlainLyrics(data.lyrics) };
                    }
                }
            } catch (parseErr) {
                console.error('Failed to parse stdout JSON:', parseErr, result.stdOut);
            }
        }
    } catch (err) {
        console.error('Lyrics query error:', err);
    }
    return { synced: false, lines: [{ time: -1, text: "Lyrics not found for this track." }] };
}

// Parse synced lyrics string into array of { time: ms, text: String }
function parseSyncedLyrics(syncedLyrics) {
    const lines = syncedLyrics.split('\n');
    const parsed = [];
    const regex = /^\[(\d+):(\d+)(?:\.(\d+))?\]\s*(.*)$/;
    
    for (let line of lines) {
        const match = line.match(regex);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const msStr = match[3] || '0';
            const ms = parseInt(msStr.padEnd(3, '0').substring(0, 3), 10);
            const totalMs = (minutes * 60 + seconds) * 1000 + ms;
            const text = match[4].trim();
            parsed.push({ time: totalMs, text: text });
        }
    }
    return parsed;
}

// Parse plain lyrics string into array of { time: -1, text: String }
function parsePlainLyrics(plainLyrics) {
    return plainLyrics.split('\n').map(line => ({ time: -1, text: line.trim() }));
}

// Render lyrics lines in UI
function renderLyrics(parsedLines) {
    lyricsTextEl.innerHTML = '';
    parsedLines.forEach((line, index) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'lyric-line';
        lineEl.innerText = line.text || ' ';
        if (line.time !== -1) {
            lineEl.dataset.time = line.time;
        }
        lineEl.id = `line-${index}`;
        lyricsTextEl.appendChild(lineEl);
    });
}

// Sync loop using requestAnimationFrame
function startLyricsSyncLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    function update() {
        // Only run sync loop calculations if music is actively playing
        if (isPlaying && accessToken && parsedLyrics.length > 0) {
            const currentProgress = progressMsLastPoll + (Date.now() - timestampLastPoll);
            highlightActiveLyric(currentProgress);
        }
        animationFrameId = requestAnimationFrame(update);
    }
    animationFrameId = requestAnimationFrame(update);
}

// Highlight the active lyric and auto-scroll it into view center using O(log n) Binary Search
function highlightActiveLyric(currentProgress) {
    if (parsedLyrics.length === 0) return;
    
    let low = 0;
    let high = parsedLyrics.length - 1;
    let activeIndex = -1;
    
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const lyricTime = parsedLyrics[mid].time;
        
        if (lyricTime !== -1 && lyricTime <= currentProgress) {
            activeIndex = mid;
            low = mid + 1; // Try to search later timestamps
        } else {
            high = mid - 1;
        }
    }
    
    if (activeIndex !== -1 && activeIndex !== lastActiveIndex) {
        // Remove active class from previous active line
        if (lastActiveIndex !== -1) {
            const prevEl = document.getElementById(`line-${lastActiveIndex}`);
            if (prevEl) prevEl.classList.remove('active');
        }
        
        // Add active class to current active line
        const activeEl = document.getElementById(`line-${activeIndex}`);
        if (activeEl) {
            activeEl.classList.add('active');
            activeEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
        lastActiveIndex = activeIndex;
    }
}

// Bind button listener
loginBtn.onclick = performLogin;

// Window resizing logic using Pointer Capture for robust bounds-independent tracking
const resizeHandle = document.getElementById('resize-handle');
let isResizing = false;
let startWidth, startHeight, startX, startY;

resizeHandle.addEventListener('pointerdown', async (e) => {
    isResizing = true;
    try {
        const size = await Neutralino.window.getSize();
        startWidth = size.width;
        startHeight = size.height;
        startX = e.screenX;
        startY = e.screenY;
        
        // Capture all pointer movements to this element (even outside the window)
        resizeHandle.setPointerCapture(e.pointerId);
    } catch (err) {
        console.error('Failed to get window size:', err);
    }
    e.preventDefault();
});

resizeHandle.addEventListener('pointermove', async (e) => {
    if (!isResizing) return;
    const diffX = e.screenX - startX;
    const diffY = e.screenY - startY;
    const newWidth = Math.max(300, startWidth + diffX);
    const newHeight = Math.max(200, startHeight + diffY);
    
    try {
        await Neutralino.window.setSize({
            width: newWidth,
            height: newHeight
        });
    } catch (err) {
        console.error('Failed to set window size:', err);
    }
});

const stopResizing = (e) => {
    if (isResizing) {
        isResizing = false;
        try {
            resizeHandle.releasePointerCapture(e.pointerId);
        } catch (err) {}
    }
};

resizeHandle.addEventListener('pointerup', stopResizing);
resizeHandle.addEventListener('pointercancel', stopResizing);
window.addEventListener('blur', stopResizing);

// Startup logic
async function onStart() {
    await loadEnv();
    
    // If credentials couldn't be loaded, display a clear, permanent error on the UI
    if (!spotifyClientId) {
        authSection.style.display = 'none';
        lyricsSection.style.display = 'flex';
        songInfoEl.innerText = 'Configuration Error';
        lyricsTextEl.innerText = 'SPOTIFY_CLIENT_ID is missing. Please verify that a valid .env file is present in the same folder as the executable.';
        return;
    }
    
    // Check if we have persisted tokens and decrypt them safely
    const encSavedToken = localStorage.getItem('spotify_access_token');
    const encRefreshToken = localStorage.getItem('spotify_refresh_token');
    const expiresAt = parseInt(localStorage.getItem('spotify_token_expires_at') || '0', 10);

    if (encSavedToken && encRefreshToken) {
        try {
            accessToken = await decryptToken(encSavedToken);
            
            // If expired or expiring in less than 5 minutes, refresh silently on launch
            if (Date.now() > expiresAt - 300000) {
                hideAuthRequired();
                updateUI('Connecting to Spotify...', 'Refreshing session...');
                await refreshSpotifyToken();
            }
            
            hideAuthRequired();
            updateUI('Connecting to Spotify...', 'Restoring session...');
            startPlaybackMonitoring();
        } catch (err) {
            console.error('Failed to restore/refresh Spotify session on startup:', err);
            showAuthRequired();
        }
    } else {
        showAuthRequired();
    }
}

// Setup Context Menu for copying lyrics
function setupContextMenu() {
    const contextMenu = document.getElementById('context-menu');
    const copyBtn = document.getElementById('copy-lyrics-btn');

    // Show context menu on right click anywhere in the window
    window.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        
        // Check if there are active lyrics to copy
        const hasNoLyrics = parsedLyrics.length === 0 || 
            (parsedLyrics.length === 1 && 
             (parsedLyrics[0].text === "Lyrics not found for this track." || 
              parsedLyrics[0].text === "Play a song on Spotify to view lyrics." || 
              parsedLyrics[0].text.startsWith("Searching")));

        if (hasNoLyrics) {
            copyBtn.classList.add('disabled');
            copyBtn.querySelector('span').innerText = 'No Lyrics to Copy';
        } else {
            copyBtn.classList.remove('disabled');
            copyBtn.querySelector('span').innerText = 'Copy Lyrics';
        }

        // Position menu at cursor coordinates
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.style.display = 'block';
    });

    // Hide context menu on left click anywhere
    window.addEventListener('click', (e) => {
        if (e.target.closest('#copy-lyrics-btn')) return;
        contextMenu.style.display = 'none';
    });

    // Copy lyrics button handler
    copyBtn.addEventListener('click', async () => {
        if (copyBtn.classList.contains('disabled')) return;
        
        try {
            // Map text from lines and join with newline
            const lyricsText = parsedLyrics.map(line => line.text).join('\n');
            await Neutralino.clipboard.writeText(lyricsText);
            
            // Show feedback
            copyBtn.querySelector('span').innerText = 'Copied!';
            copyBtn.style.color = '#1DB954';
            
            setTimeout(() => {
                copyBtn.querySelector('span').innerText = 'Copy Lyrics';
                copyBtn.style.color = '';
                contextMenu.style.display = 'none';
            }, 1000);
        } catch (err) {
            console.error('Failed to copy lyrics:', err);
            contextMenu.style.display = 'none';
        }
    });
}

setupContextMenu();
onStart();
