// Global error boundary logging to neutralinojs.log
window.onerror = function (message, source, lineno, colno, error) {
    // Do not log tokens - sanitize
    const safeMsg = String(message).substring(0, 500);
    try { Neutralino.debug.log(`JS Error: ${safeMsg} at ${source}:${lineno}:${colno}`, 'ERROR'); } catch(e) {}
    return false;
};
window.onunhandledrejection = function (event) {
    try { Neutralino.debug.log(`JS Unhandled: ${String(event.reason).substring(0,500)}`, 'ERROR'); } catch(e) {}
};

let accessToken = null;
let playbackPollInterval = null;
let lastTrackId = null;
let spotifyClientId = '';

// Playback and Synced Lyrics state
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

Neutralino.init();
Neutralino.window.setDraggableRegion('drag-handle');

closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
loginBtn.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtn.addEventListener('click', () => { Neutralino.app.exit(); });
Neutralino.events.on('windowClose', () => { Neutralino.app.exit(); });

// --- Secure helpers ---
function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function generatePkce() {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(64));
    const verifier = base64UrlEncode(verifierBytes);
    const challenge = base64UrlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return { verifier, challenge };
}
function getRandomPort() { return 8888; }

async function loadEnv() {
    let envContent = '';
    try { envContent = await Neutralino.filesystem.readFile('.env'); }
    catch { try { envContent = await Neutralino.filesystem.readFile('../.env'); } catch {
        songInfoEl.innerText = 'Configuration Error';
        lyricsTextEl.innerText = 'Failed to find .env file. Create .env with SPOTIFY_CLIENT_ID=...';
        return;
    }}
    try {
        // Handle BOM and CRLF
        envContent = envContent.replace(/^\uFEFF/, '');
        envContent.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const idx = trimmed.indexOf('=');
            if (idx === -1) return;
            const key = trimmed.substring(0, idx).trim();
            const val = trimmed.substring(idx+1).trim().replace(/^["']|["']$/g, '');
            if (key === 'SPOTIFY_CLIENT_ID') spotifyClientId = val;
        });
    } catch (err) {
        console.error('Failed to parse env');
    }
}

function updateUI(songInfo, placeholderText) {
    songInfoEl.innerText = songInfo;
    if (placeholderText) displayPlaceholderLyric(placeholderText);
}
function displayPlaceholderLyric(text) {
    lyricsTextEl.innerHTML = '';
    const lineEl = document.createElement('div');
    lineEl.className = 'lyric-line active';
    lineEl.innerText = text;
    lyricsTextEl.appendChild(lineEl);
}
function showAuthRequired() { authSection.style.display = 'flex'; lyricsSection.style.display = 'none'; }
function hideAuthRequired() { authSection.style.display = 'none'; lyricsSection.style.display = 'flex'; }

// --- PKCE Token Exchange via fetch (NO PowerShell, NO secret) ---
async function exchangeCodeViaFetch(code, verifier, port) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `http://127.0.0.1:${port}/callback`,
        client_id: spotifyClientId,
        code_verifier: verifier
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
    return await res.json();
}
async function refreshSpotifyToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    if (!refreshToken) throw new Error('No refresh token');
    const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: spotifyClientId
    });
    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const data = await res.json();
    accessToken = data.access_token;
    localStorage.setItem('spotify_access_token', accessToken);
    if (data.refresh_token) localStorage.setItem('spotify_refresh_token', data.refresh_token);
    localStorage.setItem('spotify_token_expires_at', (Date.now() + (data.expires_in||3600)*1000).toString());
    return accessToken;
}

async function performLogin() {
    if (!spotifyClientId) { alert('SPOTIFY_CLIENT_ID missing in .env'); return; }
    updateUI('Connecting to Spotify...', 'Browser opened for login...');
    loginBtn.disabled = true;
    loginBtn.innerText = 'Logging in...';
    try {
        const { verifier, challenge } = await generatePkce();
        const state = crypto.randomUUID();
        const port = getRandomPort();
        sessionStorage.setItem('pkce_verifier', verifier);
        sessionStorage.setItem('oauth_state', state);
        sessionStorage.setItem('oauth_port', port.toString());

        const authUrl = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(spotifyClientId)}&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}&response_type=code&scope=user-read-currently-playing&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&show_dialog=true`;
        await Neutralino.os.open(authUrl);

        // Secure: port and state are validated ints/UUIDs, no user input
        const listenerCommand = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/auth_listener.ps1" -Port ${port} -ExpectedState ${state}`;
        const result = await Neutralino.os.execCommand(listenerCommand);
        if (!result.stdOut) throw new Error(result.stdErr || 'No code returned');

        let parsed;
        try { parsed = JSON.parse(result.stdOut.trim()); } catch { throw new Error('Invalid auth response'); }
        if (!parsed.code || !parsed.state || parsed.state !== state) throw new Error('State mismatch or missing code');

        const tokenData = await exchangeCodeViaFetch(parsed.code, verifier, port);
        accessToken = tokenData.access_token;
        localStorage.setItem('spotify_access_token', tokenData.access_token);
        localStorage.setItem('spotify_refresh_token', tokenData.refresh_token);
        localStorage.setItem('spotify_token_expires_at', (Date.now() + (tokenData.expires_in||3600)*1000).toString());

        hideAuthRequired();
        updateUI('Connecting...', 'Authenticated. Resolving playback...');
        startPlaybackMonitoring();
    } catch (err) {
        console.error('Login error', err);
        alert('Auth failed: ' + err.message);
        showAuthRequired();
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerText = 'Login to Spotify';
    }
}

// TODO: encrypt with DPAPI before localStorage: ConvertFrom-SecureString

function evictLyricsCache(maxEntries = 50) {
    try {
        const keys = [];
        for (let i=0;i<localStorage.length;i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('lyrics_cache_')) keys.push(k);
        }
        if (keys.length > maxEntries) {
            // Simple LRU: remove oldest by sort (keys have no timestamp, so remove first)
            keys.slice(0, keys.length - maxEntries).forEach(k => localStorage.removeItem(k));
        }
    } catch {}
}

function startPlaybackMonitoring() {
    if (playbackPollInterval) clearInterval(playbackPollInterval);
    startLyricsSyncLoop();
    playbackPollInterval = setInterval(async () => {
        if (!accessToken) return;
        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.status === 204) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false; parsedLyrics = []; return;
            }
            if (response.status === 401) {
                try { await refreshSpotifyToken(); return; } catch {
                    accessToken = null;
                    localStorage.removeItem('spotify_access_token');
                    localStorage.removeItem('spotify_refresh_token');
                    localStorage.removeItem('spotify_token_expires_at');
                    clearInterval(playbackPollInterval);
                    if (animationFrameId) cancelAnimationFrame(animationFrameId);
                    showAuthRequired(); return;
                }
            }
            if (response.status === 429) return; // rate limited, skip
            const data = await response.json();
            if (!data || !data.item) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false; parsedLyrics = []; return;
            }
            progressMsLastPoll = data.progress_ms;
            timestampLastPoll = Date.now();
            isPlaying = data.is_playing;
            const track = data.item;
            const trackId = track.id;
            if (trackId !== lastTrackId) {
                lastTrackId = trackId;
                const songInfo = `${track.name} - ${track.artists.map(a=>a.name).join(', ')}`;
                updateUI(songInfo, 'Searching for lyrics...');
                lastActiveIndex = -1;
                const cacheKey = `lyrics_cache_${trackId}`;
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    try {
                        const result = JSON.parse(cached);
                        parsedLyrics = result.lines;
                        renderLyrics(parsedLyrics);
                        updateUI(songInfo, null);
                        return;
                    } catch {}
                }
                const result = await fetchLyrics(track.name, track.artists[0].name);
                parsedLyrics = result.lines;
                renderLyrics(parsedLyrics);
                updateUI(songInfo, null);
                const isError = result.lines.length===0 || (result.lines.length===1 && result.lines[0].text==="Lyrics not found for this track.");
                if (!isError) {
                    try { localStorage.setItem(cacheKey, JSON.stringify(result)); evictLyricsCache(); } catch {}
                }
            }
        } catch (err) { console.error('Playback poll error', err); }
    }, 3000);
}

async function fetchLyrics(trackName, artistName) {
    try {
        // Secure Base64 args - no shell interpolation of track names
        const payload = btoa(JSON.stringify({ track: trackName.substring(0,200), artist: artistName.substring(0,200) }));
        const command = `chcp 65001 >nul && powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${window.NL_PATH}/fetch_lyrics.ps1" -EncodedArgs ${payload}`;
        const result = await Neutralino.os.execCommand(command);
        if (!result.stdOut) throw new Error('Empty lyrics response');
        let data;
        try { data = JSON.parse(result.stdOut.trim()); } catch { throw new Error('Invalid lyrics JSON'); }
        if (data && data.lyrics) {
            if (data.synced) return { synced:true, lines: parseSyncedLyrics(data.lyrics) };
            else return { synced:false, lines: parsePlainLyrics(data.lyrics) };
        }
    } catch (err) { console.error('Lyrics query error', err); }
    return { synced:false, lines: [{ time:-1, text:"Lyrics not found for this track." }] };
}

function parseSyncedLyrics(syncedLyrics) {
    const lines = syncedLyrics.split('\n');
    const parsed = [];
    const regex = /^\[(\d+):(\d+)(?:[\.:](\d+))?\]\s*(.*)$/;
    for (let line of lines) {
        const match = line.match(regex);
        if (match) {
            const minutes = parseInt(match[1],10);
            const seconds = parseInt(match[2],10);
            const msStr = match[3]||'0';
            const ms = parseInt(msStr.padEnd(3,'0').substring(0,3),10);
            const totalMs = (minutes*60+seconds)*1000+ms;
            const text = match[4].trim();
            if (text) parsed.push({ time: totalMs, text });
        }
    }
    return parsed;
}
function parsePlainLyrics(plainLyrics) {
    return plainLyrics.split('\n').map(l=>({ time:-1, text:l.trim() })).filter(l=>l.text);
}
function renderLyrics(parsedLines) {
    lyricsTextEl.innerHTML = '';
    parsedLines.forEach((line,index)=>{
        const el = document.createElement('div');
        el.className = 'lyric-line';
        el.innerText = line.text || ' '; // innerText prevents XSS
        if (line.time !== -1) el.dataset.time = line.time;
        el.id = `line-${index}`;
        lyricsTextEl.appendChild(el);
    });
}
function startLyricsSyncLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    function update() {
        if (accessToken && parsedLyrics.length>0) {
            let currentProgress = progressMsLastPoll;
            if (isPlaying) currentProgress += (Date.now() - timestampLastPoll);
            highlightActiveLyric(currentProgress);
        }
        animationFrameId = requestAnimationFrame(update);
    }
    animationFrameId = requestAnimationFrame(update);
}
function highlightActiveLyric(currentProgress) {
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        const t = parsedLyrics[i].time;
        if (t !== -1 && t <= currentProgress) {
            activeIndex = i;
        }
    }
    if (activeIndex!==-1 && activeIndex!==lastActiveIndex) {
        if (lastActiveIndex!==-1) {
            const prev = document.getElementById(`line-${lastActiveIndex}`);
            if (prev) prev.classList.remove('active');
        }
        const activeEl = document.getElementById(`line-${activeIndex}`);
        if (activeEl) {
            activeEl.classList.add('active');
            activeEl.scrollIntoView({ behavior:'smooth', block:'center' });
        }
        lastActiveIndex = activeIndex;
    }
}

// Resize logic
const resizeHandle = document.getElementById('resize-handle');
let isResizing=false, startWidth, startHeight, startX, startY;
resizeHandle.addEventListener('pointerdown', async (e)=>{
    isResizing=true;
    try {
        const size = await Neutralino.window.getSize();
        startWidth=size.width; startHeight=size.height; startX=e.screenX; startY=e.screenY;
        resizeHandle.setPointerCapture(e.pointerId);
    } catch{}
    e.preventDefault();
});
resizeHandle.addEventListener('pointermove', async (e)=>{
    if(!isResizing) return;
    const diffX=e.screenX-startX, diffY=e.screenY-startY;
    try { await Neutralino.window.setSize({ width: Math.max(300,startWidth+diffX), height: Math.max(200,startHeight+diffY) }); } catch{}
});
const stopResizing = (e)=>{ if(isResizing){ isResizing=false; try{ resizeHandle.releasePointerCapture(e.pointerId);}catch{}}};
resizeHandle.addEventListener('pointerup', stopResizing);
resizeHandle.addEventListener('pointercancel', stopResizing);
window.addEventListener('blur', stopResizing);

async function onStart() {
    await loadEnv();
    if (!spotifyClientId) {
        authSection.style.display='none'; lyricsSection.style.display='flex';
        songInfoEl.innerText='Configuration Error';
        lyricsTextEl.innerText='SPOTIFY_CLIENT_ID missing. Add to .env (no secret needed with PKCE).';
        return;
    }
    const savedToken = localStorage.getItem('spotify_access_token');
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    const expiresAt = parseInt(localStorage.getItem('spotify_token_expires_at')||'0');
    if (savedToken && refreshToken) {
        if (Date.now() > expiresAt - 300000) {
            try { hideAuthRequired(); updateUI('Connecting...','Refreshing session...'); await refreshSpotifyToken(); }
            catch { showAuthRequired(); return; }
        } else accessToken = savedToken;
        hideAuthRequired(); updateUI('Connecting...','Restoring session...'); startPlaybackMonitoring();
    } else showAuthRequired();
}
function setupContextMenu() {
    const contextMenu=document.getElementById('context-menu');
    const copyBtn=document.getElementById('copy-lyrics-btn');
    window.addEventListener('contextmenu',(e)=>{
        e.preventDefault();
        const hasNoLyrics = parsedLyrics.length===0 || (parsedLyrics.length===1 && parsedLyrics[0].text==="Lyrics not found for this track.");
        if (hasNoLyrics) { copyBtn.classList.add('disabled'); copyBtn.querySelector('span').innerText='No Lyrics to Copy'; }
        else { copyBtn.classList.remove('disabled'); copyBtn.querySelector('span').innerText='Copy Lyrics'; }
        contextMenu.style.left=`${e.clientX}px`; contextMenu.style.top=`${e.clientY}px`; contextMenu.style.display='block';
    });
    window.addEventListener('click',(e)=>{ if(e.target.closest('#copy-lyrics-btn')) return; contextMenu.style.display='none'; });
    copyBtn.addEventListener('click', async ()=>{
        if(copyBtn.classList.contains('disabled')) return;
        try {
            const text = parsedLyrics.map(l=>l.text).join('\n');
            await Neutralino.clipboard.writeText(text);
            copyBtn.querySelector('span').innerText='Copied!'; copyBtn.style.color='#1DB954';
            setTimeout(()=>{ copyBtn.querySelector('span').innerText='Copy Lyrics'; copyBtn.style.color=''; contextMenu.style.display='none'; },1000);
        } catch { contextMenu.style.display='none'; }
    });
}
setupContextMenu();
loginBtn.onclick = performLogin;
onStart();
