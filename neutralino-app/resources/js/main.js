// Global error boundary logging to neutralinojs.log
window.onerror = function (message, source, lineno, colno, error) {
    const errorMsg = `JS Error: ${message} at ${source}:${lineno}:${colno}`;
    try {
        Neutralino.debug.log(errorMsg, 'ERROR');
    } catch(e) {}
    return false;
};

window.onunhandledrejection = function (event) {
    const errorMsg = `JS Unhandled Rejection: ${event.reason}`;
    try {
        Neutralino.debug.log(errorMsg, 'ERROR');
    } catch(e) {}
};

let accessToken = null;
let playbackPollInterval = null;
let lastTrackId = null;

let spotifyClientId = '';
let spotifyClientSecret = '';

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
closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
loginBtn.addEventListener('mousedown', (e) => e.stopPropagation());

// Exit application when window close or close-btn is clicked
closeBtn.addEventListener('click', () => {
    Neutralino.app.exit();
});

Neutralino.events.on('windowClose', () => {
    Neutralino.app.exit();
});

// Load Env variables
async function loadEnv() {
    let envContent = '';
    try {
        // Try current directory first (for packaged app)
        envContent = await Neutralino.filesystem.readFile('.env');
    } catch (err1) {
        try {
            // Try parent directory (for dev mode)
            envContent = await Neutralino.filesystem.readFile('../.env');
        } catch (err2) {
            console.error('Failed to find .env in both ./ and ../');
            songInfoEl.innerText = 'Configuration Error';
            lyricsTextEl.innerText = 'Failed to find .env file containing Spotify credentials.';
            return;
        }
    }

    try {
        envContent.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const val = parts.slice(1).join('=').trim();
                if (key === 'SPOTIFY_CLIENT_ID') {
                    spotifyClientId = val;
                } else if (key === 'SPOTIFY_CLIENT_SECRET') {
                    spotifyClientSecret = val;
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

// Request login flow via browser & PowerShell
async function performLogin() {
    if (!spotifyClientId || !spotifyClientSecret) {
        alert('Credentials missing in .env!');
        return;
    }
    
    updateUI('Connecting to Spotify...', 'Please log in using the opened browser window.');
    loginBtn.disabled = true;
    loginBtn.innerText = 'Logging in...';

    try {
        // 1. Run PowerShell listener
        // The script blocks until it receives the Spotify redirect callback
        const listenerCommand = 'powershell -ExecutionPolicy Bypass -File auth_listener.ps1';
        
        // 2. Open Spotify Auth page in default system browser
        const authUrl = `https://accounts.spotify.com/authorize?client_id=${spotifyClientId}&redirect_uri=http://127.0.0.1:8888/callback&response_type=code&scope=user-read-currently-playing&show_dialog=true`;
        await Neutralino.os.open(authUrl);

        // 3. Await PowerShell command result
        const result = await Neutralino.os.execCommand(listenerCommand);
        if (result.stdOut) {
            const code = result.stdOut.trim();
            if (code) {
                // 4. Exchange code for Access Token
                const token = await exchangeCodeForToken(code);
                accessToken = token;
                localStorage.setItem('spotify_access_token', token);
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

// Exchange code using PowerShell RestMethod to bypass browser CORS
async function exchangeCodeForToken(code) {
    const exchangeCommand = `powershell -Command "Invoke-RestMethod -Uri 'https://accounts.spotify.com/api/token' -Method Post -Body @{ grant_type='authorization_code'; code='${code}'; redirect_uri='http://127.0.0.1:8888/callback'; client_id='${spotifyClientId}'; client_secret='${spotifyClientSecret}' } -ContentType 'application/x-www-form-urlencoded' | ConvertTo-Json"`;
    
    const result = await Neutralino.os.execCommand(exchangeCommand);
    if (result.stdOut) {
        const response = JSON.parse(result.stdOut);
        if (response && response.access_token) {
            return response.access_token;
        }
    }
    throw new Error(result.stdErr || 'Could not retrieve access token.');
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
                // Token expired
                accessToken = null;
                localStorage.removeItem('spotify_access_token');
                clearInterval(playbackPollInterval);
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                showAuthRequired();
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

                // Resolve lyrics from backend (Lrclib with Musixmatch fallback)
                const result = await fetchLyrics(track.name, track.artists[0].name);

                parsedLyrics = result.lines;
                renderLyrics(parsedLyrics);
                updateUI(songInfo, null);
            }
        } catch (err) {
            console.error('Error during playback polling:', err);
        }
    }, 3000);
}

// Fetch lyrics from Lrclib (primary) or Musixmatch (fallback) via backend PowerShell script
async function fetchLyrics(trackName, artistName) {
    try {
        // Escape single quotes inside single-quoted strings for PowerShell
        const cleanTrack = trackName.replace(/'/g, "''");
        const cleanArtist = artistName.replace(/'/g, "''");
        
        const command = `powershell -ExecutionPolicy Bypass -File "${window.NL_PATH}/fetch_lyrics.ps1" -trackName '${cleanTrack}' -artistName '${cleanArtist}'`;
        const result = await Neutralino.os.execCommand(command);
        
        if (result.stdOut) {
            const data = JSON.parse(result.stdOut.trim());
            if (data && data.lyrics) {
                if (data.synced) {
                    return { synced: true, lines: parseSyncedLyrics(data.lyrics) };
                } else {
                    return { synced: false, lines: parsePlainLyrics(data.lyrics) };
                }
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
        if (accessToken && parsedLyrics.length > 0) {
            let currentProgress = progressMsLastPoll;
            if (isPlaying) {
                currentProgress += (Date.now() - timestampLastPoll);
            }
            highlightActiveLyric(currentProgress);
        }
        animationFrameId = requestAnimationFrame(update);
    }
    animationFrameId = requestAnimationFrame(update);
}

// Highlight the active lyric and auto-scroll it into view center
function highlightActiveLyric(currentProgress) {
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (parsedLyrics[i].time !== -1 && parsedLyrics[i].time <= currentProgress) {
            activeIndex = i;
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
    if (!spotifyClientId || !spotifyClientSecret) {
        authSection.style.display = 'none';
        lyricsSection.style.display = 'flex';
        songInfoEl.innerText = 'Configuration Error';
        lyricsTextEl.innerText = 'SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET is missing. Please verify that a valid .env file is present in the same folder as the executable.';
        return;
    }
    
    // Check if we have a persisted access token
    const savedToken = localStorage.getItem('spotify_access_token');
    if (savedToken) {
        accessToken = savedToken;
        hideAuthRequired();
        updateUI('Connecting to Spotify...', 'Restoring session...');
        startPlaybackMonitoring();
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
