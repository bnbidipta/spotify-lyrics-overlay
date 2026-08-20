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

const BUILTIN_DEFAULT_SPOTIFY_CLIENT_ID = 'ca6cf029ccd648068df4e49165bb139b';

let accessToken = null;
let playbackPollInterval = null;
let lastTrackId = null;
let spotifyClientId = BUILTIN_DEFAULT_SPOTIFY_CLIENT_ID;

// Playback and Synced Lyrics state
let parsedLyrics = [];
let progressMsLastPoll = 0;
let timestampLastPoll = 0;
let isPlaying = false;
let animationFrameId = null;
let lastActiveIndex = -1;

const authSection = document.getElementById('auth-section');
const lyricsSection = document.getElementById('lyrics-section');
const setupSection = document.getElementById('setup-section');
const songInfoEl = document.getElementById('song-info');
const lyricsTextEl = document.getElementById('lyrics-text');
const loginBtn = document.getElementById('login-btn');
const closeBtn = document.getElementById('close-btn');
const getIdBtn = document.getElementById('get-id-btn');
const watchLoomBtn = document.getElementById('watch-loom-btn');

// Window controls
const pinBtn = document.getElementById('pin-btn');
const lockBtn = document.getElementById('lock-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const opacitySlider = document.getElementById('opacity-slider');
const opacityVal = document.getElementById('opacity-val');
const blurSlider = document.getElementById('blur-slider');
const blurVal = document.getElementById('blur-val');
const lyricsContainer = document.getElementById('lyrics-container');

// Update elements
const updateBanner = document.getElementById('update-banner');
const updateLinkBtn = document.getElementById('update-link-btn');
const updateCloseBtn = document.getElementById('update-close-btn');

let isAlwaysOnTop = true;
let isClickThrough = false;

// Premium integrations
let trackDurationMs = 0;
let isTranslationActive = false;
let currentLikedTrackId = null;
let isCurrentTrackLiked = false;

// Manual search fallback
let lastSearchTrackName = '';
let lastSearchArtistName = '';
const manualSearchPanel = document.getElementById('manual-search-panel');
const manualSearchInput = document.getElementById('manual-search-input');
const manualSearchBtn = document.getElementById('manual-search-btn');
const pasteLrcBtn = document.getElementById('paste-lrc-btn');
const lrcPasteArea = document.getElementById('lrc-paste-area');
const lrcPasteActions = document.getElementById('lrc-paste-actions');
const lrcApplyBtn = document.getElementById('lrc-apply-btn');
const lrcCancelBtn = document.getElementById('lrc-cancel-btn');

Neutralino.init();
Neutralino.window.setDraggableRegion('drag-handle');

closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
loginBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (getIdBtn) getIdBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (watchLoomBtn) watchLoomBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (updateBanner) updateBanner.addEventListener('mousedown', (e) => e.stopPropagation());
if (pinBtn) pinBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (lockBtn) lockBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (settingsBtn) settingsBtn.addEventListener('mousedown', (e) => e.stopPropagation());
if (settingsPanel) settingsPanel.addEventListener('mousedown', (e) => e.stopPropagation());
if (manualSearchPanel) manualSearchPanel.addEventListener('mousedown', (e) => e.stopPropagation());

let currentConfig = {
    window_width: 600,
    window_height: 400,
    window_x: 100,
    window_y: 100,
    always_on_top: true,
    window_opacity: 80,
    window_blur: 12,
    font_size: 18,
    font_family: "Inter",
    line_scale: 1.2,
    sync_offset: 0,
    theme: "dark",
    provider_order: ["lrclib", "netease", "lyricsovh"],
    song_offsets: {},
    streamer_mode: false,
    autostart: false,
    custom_client_id: "",
    telemetry: {
        opt_in: false,
        cache_hits: 0,
        cache_misses: 0,
        total_searches: 0,
        provider_wins: { lrclib: 0, netease: 0, musixmatch: 0, lyricsovh: 0 },
        total_fetch_time_ms: 0
    }
};

let currentTrackName = '';
let currentArtistName = '';
let currentAlbumArtUrl = '';
let obsServerRunning = false;
let lastObsBroadcastMs = 0;

async function startObsServer() {
    if (obsServerRunning) return;
    try {
        const command = `"${window.NL_PATH}/obs_server.exe" -Port 5001`;
        Neutralino.os.execCommand(command, { background: true });
        obsServerRunning = true;
    } catch (e) {
        console.error("Failed to start OBS server", e);
    }
}

async function stopObsServer() {
    try {
        await Neutralino.os.execCommand('taskkill /IM obs_server.exe /F >nul 2>&1');
        obsServerRunning = false;
    } catch (e) {}
}

async function updateObsServerState() {
    if (!currentConfig.streamer_mode) return;
    
    const now = Date.now();
    if (now - lastObsBroadcastMs < 200) return;
    lastObsBroadcastMs = now;

    let prevText = '';
    let currentText = '';
    let nextText = '';

    if (parsedLyrics && parsedLyrics.length > 0) {
        if (lastActiveIndex >= 0 && lastActiveIndex < parsedLyrics.length) {
            currentText = parsedLyrics[lastActiveIndex].text || '';
            if (lastActiveIndex > 0) prevText = parsedLyrics[lastActiveIndex - 1].text || '';
            if (lastActiveIndex + 1 < parsedLyrics.length) nextText = parsedLyrics[lastActiveIndex + 1].text || '';
        } else if (parsedLyrics.length === 1) {
            currentText = parsedLyrics[0].text || '';
        }
    }

    const currentProgress = progressMsLastPoll + getEffectiveSyncOffset() + (isPlaying ? (Date.now() - timestampLastPoll) : 0);

    const payload = {
        trackName: currentTrackName || '',
        artistName: currentArtistName || '',
        albumArt: currentAlbumArtUrl || '',
        progressMs: Math.max(0, Math.round(currentProgress)),
        durationMs: trackDurationMs || 0,
        isPlaying: isPlaying,
        prevLine: prevText,
        currentLine: currentText,
        nextLine: nextText
    };

    try {
        await fetch('http://127.0.0.1:5001/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {}
}

async function loadConfig() {
    try {
        const content = await Neutralino.filesystem.readFile('config.json');
        if (content) {
            currentConfig = { ...currentConfig, ...JSON.parse(content) };
            isAlwaysOnTop = currentConfig.always_on_top;
        }
    } catch (e) {
        console.log("No config.json found. Using defaults.");
    }
}

async function saveConfig() {
    try {
        let size = { width: 600, height: 400 };
        let pos = { x: 100, y: 100 };
        if (window.NL_MODE === 'window') {
            try {
                size = await Neutralino.window.getSize();
                pos = await Neutralino.window.getPosition();
                currentConfig.window_width = size.width;
                currentConfig.window_height = size.height;
                currentConfig.window_x = pos.x;
                currentConfig.window_y = pos.y;
            } catch (err) {}
        }
        await Neutralino.filesystem.writeFile('config.json', JSON.stringify(currentConfig, null, 2));
    } catch (e) {
        console.error("Failed to save config.json", e);
    }
}

let windowBoundsSaveTimer = null;
function queueWindowBoundsSave() {
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = setTimeout(async () => {
        if (window.NL_MODE === 'window') {
            try {
                const size = await Neutralino.window.getSize();
                const pos = await Neutralino.window.getPosition();
                currentConfig.window_width = size.width;
                currentConfig.window_height = size.height;
                currentConfig.window_x = pos.x;
                currentConfig.window_y = pos.y;
                await Neutralino.filesystem.writeFile('config.json', JSON.stringify(currentConfig, null, 2));
            } catch (e) {}
        }
    }, 500);
}

function setupWindowBoundsListeners() {
    if (window.NL_MODE === 'window') {
        try {
            Neutralino.events.on('windowMove', () => queueWindowBoundsSave());
            Neutralino.events.on('windowResize', () => queueWindowBoundsSave());
        } catch (e) {}
    }
}

async function restoreWindowGeometry() {
    try {
        if (window.NL_MODE === 'window') {
            const x = currentConfig.window_x !== undefined ? currentConfig.window_x : 100;
            const y = currentConfig.window_y !== undefined ? currentConfig.window_y : 100;
            const w = currentConfig.window_width || 600;
            const h = currentConfig.window_height || 400;

            let isValid = true;
            try {
                const cmd = `"${window.NL_PATH}/window_utils.exe" -Action validate-bounds -X ${x} -Y ${y} -Width ${w} -Height ${h}`;
                const res = await Neutralino.os.execCommand(cmd);
                if (res && res.stdOut) {
                    const data = JSON.parse(res.stdOut.trim());
                    if (data && data.valid === false) isValid = false;
                }
            } catch (e) {}

            await Neutralino.window.setSize({ width: w, height: h });
            if (isValid) {
                await Neutralino.window.move(x, y);
            } else {
                await Neutralino.window.center();
            }
        }
    } catch (e) {
        console.error('Failed to restore window geometry', e);
    }
}

async function handleExit() {
    try { await saveConfig(); } catch (e) {}
    Neutralino.app.exit();
}

async function handleCloseButton() {
    // Hide window (minimize to tray)
    await Neutralino.window.hide();
}
closeBtn.addEventListener('click', handleCloseButton);
Neutralino.events.on('windowClose', handleCloseButton);

if (getIdBtn) {
    getIdBtn.addEventListener('click', () => {
        Neutralino.os.open('https://developer.spotify.com/dashboard');
    });
}
if (watchLoomBtn) {
    watchLoomBtn.addEventListener('click', () => {
        Neutralino.os.open('https://www.loom.com/share/placeholder');
    });
}

// Opacity & Blur Slider Logic
function applyOpacity(val) {
    if (!lyricsContainer) return;
    lyricsContainer.style.opacity = val / 100;
    if (opacityVal) opacityVal.innerText = `${val}%`;
}

// Blur Logic
function applyBlur(val) {
    if (!lyricsContainer) return;
    lyricsContainer.style.backdropFilter = `blur(${val}px)`;
    lyricsContainer.style.webkitBackdropFilter = `blur(${val}px)`;
    if (blurVal) blurVal.innerText = `${val}px`;
}

if (opacitySlider) {
    opacitySlider.addEventListener('input', async (e) => {
        currentConfig.window_opacity = parseInt(e.target.value, 10);
        applyOpacity(e.target.value);
        await saveConfig();
    });
}
if (blurSlider) {
    blurSlider.addEventListener('input', async (e) => {
        currentConfig.window_blur = parseInt(e.target.value, 10);
        applyBlur(e.target.value);
        await saveConfig();
    });
}

// Button controls UI updates & toggle handlers
function updatePinButton() {
    if (!pinBtn) return;
    if (isAlwaysOnTop) {
        pinBtn.classList.add('active');
        pinBtn.innerText = '📌';
        pinBtn.title = 'Unpin Window (Always on Top: ON)';
    } else {
        pinBtn.classList.remove('active');
        pinBtn.innerText = '📍';
        pinBtn.title = 'Pin Window (Always on Top: OFF)';
    }
}

function updateLockButton() {
    if (!lockBtn) return;
    if (isClickThrough) {
        lockBtn.classList.add('active');
        lockBtn.innerText = '🔒';
        lockBtn.title = 'Unlock Window (Click-Through: ON)';
    } else {
        lockBtn.classList.remove('active');
        lockBtn.innerText = '🔓';
        lockBtn.title = 'Lock Window (Click-Through: OFF)';
    }
}

async function enableClickThrough() {
    isClickThrough = true;
    updateLockButton();
    try {
        const command = `"${window.NL_PATH}/window_utils.exe" -Action enable-clickthrough`;
        await Neutralino.os.execCommand(command);
    } catch (e) {
        console.error("Failed to enable clickthrough", e);
    }
}

async function disableClickThrough() {
    isClickThrough = false;
    updateLockButton();
    try {
        const command = `"${window.NL_PATH}/window_utils.exe" -Action disable-clickthrough`;
        await Neutralino.os.execCommand(command);
    } catch (e) {
        console.error("Failed to disable clickthrough", e);
    }
}

if (pinBtn) {
    pinBtn.addEventListener('click', async () => {
        isAlwaysOnTop = !isAlwaysOnTop;
        currentConfig.always_on_top = isAlwaysOnTop;
        await Neutralino.window.setAlwaysOnTop(isAlwaysOnTop);
        updatePinButton();
        await saveConfig();
    });
}

if (lockBtn) {
    lockBtn.addEventListener('click', async () => {
        if (!isClickThrough) {
            await enableClickThrough();
            alert("Click-Through locked! All mouse clicks will now pass through the window to applications underneath.\n\nTo unlock, right-click the system tray icon and select 'Unlock Window'.");
        } else {
            await disableClickThrough();
        }
    });
}

if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener('click', () => {
        if (settingsPanel.style.display === 'none') {
            settingsPanel.style.display = 'flex';
            settingsBtn.classList.add('active');
        } else {
            settingsPanel.style.display = 'none';
            settingsBtn.classList.remove('active');
        }
    });
}

// System Tray Logic
async function setupSystemTray() {
    if (window.NL_MODE !== 'window') return;
    try {
        const tray = {
            icon: "/resources/icons/trayIcon.png",
            menuItems: [
                { id: "SHOW", text: "Show Overlay" },
                { id: "HIDE", text: "Hide Overlay" },
                { id: "SEP1", text: "-" },
                { id: "PIN", text: "Pin Window (Always on Top)" },
                { id: "UNPIN", text: "Unpin Window" },
                { id: "SEP2", text: "-" },
                { id: "LOCK", text: "Lock Window (Click-Through)" },
                { id: "UNLOCK", text: "Unlock Window" },
                { id: "SEP3", text: "-" },
                { id: "QUIT", text: "Quit App" }
            ]
        };
        await Neutralino.os.setTray(tray);
    } catch (e) {
        console.error("Failed to setup system tray", e);
    }
}

Neutralino.events.on("trayMenuItemClicked", async (event) => {
    switch (event.detail.id) {
        case "SHOW":
            await Neutralino.window.show();
            break;
        case "HIDE":
            await Neutralino.window.hide();
            break;
        case "PIN":
            isAlwaysOnTop = true;
            currentConfig.always_on_top = true;
            await Neutralino.window.setAlwaysOnTop(true);
            updatePinButton();
            await saveConfig();
            break;
        case "UNPIN":
            isAlwaysOnTop = false;
            currentConfig.always_on_top = false;
            await Neutralino.window.setAlwaysOnTop(false);
            updatePinButton();
            await saveConfig();
            break;
        case "LOCK":
            await enableClickThrough();
            break;
        case "UNLOCK":
            await disableClickThrough();
            break;
        case "QUIT":
            await handleExit();
            break;
    }
});

setupSystemTray();

function renderProviderList() {
    const providerListEl = document.getElementById('provider-list');
    if (!providerListEl) return;
    providerListEl.innerHTML = '';
    currentConfig.provider_order.forEach((provider, index) => {
        const item = document.createElement('div');
        item.className = 'provider-item';
        item.addEventListener('mousedown', (e) => e.stopPropagation());
        
        const name = document.createElement('span');
        name.className = 'provider-name';
        name.innerText = provider === 'lyricsovh' ? 'Lyrics.ovh' : provider;
        item.appendChild(name);

        const controls = document.createElement('div');
        controls.className = 'provider-controls';

        if (index > 0) {
            const upBtn = document.createElement('button');
            upBtn.className = 'order-btn';
            upBtn.innerText = '▲';
            upBtn.title = 'Move Up';
            upBtn.addEventListener('click', async () => {
                const temp = currentConfig.provider_order[index];
                currentConfig.provider_order[index] = currentConfig.provider_order[index - 1];
                currentConfig.provider_order[index - 1] = temp;
                renderProviderList();
                await saveConfig();
            });
            controls.appendChild(upBtn);
        }

        if (index < currentConfig.provider_order.length - 1) {
            const downBtn = document.createElement('button');
            downBtn.className = 'order-btn';
            downBtn.innerText = '▼';
            downBtn.title = 'Move Down';
            downBtn.addEventListener('click', async () => {
                const temp = currentConfig.provider_order[index];
                currentConfig.provider_order[index] = currentConfig.provider_order[index + 1];
                currentConfig.provider_order[index + 1] = temp;
                renderProviderList();
                await saveConfig();
            });
            controls.appendChild(downBtn);
        }

        item.appendChild(controls);
        providerListEl.appendChild(item);
    });
}

function applySettings() {
    if (window.NL_MODE === 'window') {
        Neutralino.window.setAlwaysOnTop(currentConfig.always_on_top);
    }
    updatePinButton();
    updateLockButton();

    applyOpacity(currentConfig.window_opacity);
    if (opacitySlider) opacitySlider.value = currentConfig.window_opacity;
    if (opacityVal) opacityVal.innerText = `${currentConfig.window_opacity}%`;

    applyBlur(currentConfig.window_blur);
    if (blurSlider) blurSlider.value = currentConfig.window_blur;
    if (blurVal) blurVal.innerText = `${currentConfig.window_blur}px`;

    document.documentElement.style.setProperty('--font-family', `'${currentConfig.font_family}', sans-serif`);
    const familySelect = document.getElementById('font-family-select');
    if (familySelect) familySelect.value = currentConfig.font_family;

    document.documentElement.style.setProperty('--font-size', `${currentConfig.font_size}px`);
    const sizeSlider = document.getElementById('font-size-slider');
    if (sizeSlider) sizeSlider.value = currentConfig.font_size;
    const sizeVal = document.getElementById('font-size-val');
    if (sizeVal) sizeVal.innerText = `${currentConfig.font_size}px`;

    document.documentElement.style.setProperty('--active-scale', currentConfig.line_scale);
    const r12 = document.getElementById('line-scale-12');
    const r15 = document.getElementById('line-scale-15');
    if (currentConfig.line_scale === 1.5) {
        if (r15) r15.checked = true;
    } else {
        if (r12) r12.checked = true;
    }

    const offsetSlider = document.getElementById('sync-offset-slider');
    if (offsetSlider) offsetSlider.value = currentConfig.sync_offset;
    const offsetVal = document.getElementById('sync-offset-val');
    if (offsetVal) offsetVal.innerText = `${currentConfig.sync_offset > 0 ? '+' : ''}${currentConfig.sync_offset}ms`;

    if (lyricsContainer) {
        lyricsContainer.className = `theme-${currentConfig.theme}`;
    }
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = currentConfig.theme;

    const musixmatchOptinEl = document.getElementById('musixmatch-optin');
    if (musixmatchOptinEl) {
        musixmatchOptinEl.checked = currentConfig.provider_order.includes('musixmatch');
    }

    const streamerModeOptinEl = document.getElementById('streamer-mode-optin');
    const streamerModeInfoEl = document.getElementById('streamer-mode-info');
    if (streamerModeOptinEl) {
        streamerModeOptinEl.checked = !!currentConfig.streamer_mode;
        if (streamerModeInfoEl) {
            streamerModeInfoEl.style.display = currentConfig.streamer_mode ? 'flex' : 'none';
        }
        if (currentConfig.streamer_mode) {
            startObsServer();
        }
    }

    const telemetryOptinEl = document.getElementById('telemetry-optin');
    const telemetryCardEl = document.getElementById('telemetry-stats-card');
    if (telemetryOptinEl) {
        const isOptin = !!(currentConfig.telemetry && currentConfig.telemetry.opt_in);
        telemetryOptinEl.checked = isOptin;
        if (telemetryCardEl) {
            telemetryCardEl.style.display = isOptin ? 'flex' : 'none';
        }
        if (isOptin) renderTelemetryStats();
    }

    const customClientInput = document.getElementById('custom-client-id-input');
    if (customClientInput) {
        customClientInput.value = currentConfig.custom_client_id || '';
    }

    const disconnectBtn = document.getElementById('disconnect-account-btn');
    if (disconnectBtn) {
        disconnectBtn.style.display = accessToken ? 'block' : 'none';
    }

    renderProviderList();
}
async function checkForUpdates() {
    try {
        const response = await fetch('https://api.github.com/repos/bnbidipta/spotify-lyrics-overlay/releases/latest');
        if (!response.ok) return;
        const data = await response.json();
        if (!data || !data.tag_name) return;
        const latestTag = data.tag_name;
        const latestVersion = latestTag.replace(/^v/, '');
        const currentVersion = window.NL_APPVERSION;
        
        if (isNewerVersion(latestVersion, currentVersion)) {
            if (updateBanner && updateLinkBtn && updateCloseBtn) {
                updateBanner.style.display = 'flex';
                updateLinkBtn.onclick = () => {
                    Neutralino.os.open(data.html_url);
                };
                updateCloseBtn.onclick = () => {
                    updateBanner.style.display = 'none';
                };
            }
        }
    } catch (e) {
        console.error("Failed to check for updates", e);
    }
}

function isNewerVersion(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
        const lVal = l[i] || 0;
        const cVal = c[i] || 0;
        if (lVal > cVal) return true;
        if (lVal < cVal) return false;
    }
    return false;
}

// Bind UI changes
const familySelect = document.getElementById('font-family-select');
if (familySelect) {
    familySelect.addEventListener('mousedown', (e) => e.stopPropagation());
    familySelect.addEventListener('change', async (e) => {
        currentConfig.font_family = e.target.value;
        document.documentElement.style.setProperty('--font-family', `'${e.target.value}', sans-serif`);
        await saveConfig();
    });
}

const sizeSlider = document.getElementById('font-size-slider');
if (sizeSlider) {
    sizeSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    sizeSlider.addEventListener('input', async (e) => {
        currentConfig.font_size = parseInt(e.target.value, 10);
        document.documentElement.style.setProperty('--font-size', `${e.target.value}px`);
        const sizeVal = document.getElementById('font-size-val');
        if (sizeVal) sizeVal.innerText = `${e.target.value}px`;
        await saveConfig();
    });
}

const r12 = document.getElementById('line-scale-12');
const r15 = document.getElementById('line-scale-15');
if (r12) {
    r12.addEventListener('mousedown', (e) => e.stopPropagation());
    r12.addEventListener('change', async (e) => {
        if (e.target.checked) {
            currentConfig.line_scale = 1.2;
            document.documentElement.style.setProperty('--active-scale', '1.2');
            await saveConfig();
        }
    });
}
if (r15) {
    r15.addEventListener('mousedown', (e) => e.stopPropagation());
    r15.addEventListener('change', async (e) => {
        if (e.target.checked) {
            currentConfig.line_scale = 1.5;
            document.documentElement.style.setProperty('--active-scale', '1.5');
            await saveConfig();
        }
    });
}

const offsetSlider = document.getElementById('sync-offset-slider');
if (offsetSlider) {
    offsetSlider.addEventListener('mousedown', (e) => e.stopPropagation());
    offsetSlider.addEventListener('input', async (e) => {
        const val = parseInt(e.target.value, 10);
        if (lastTrackId) {
            if (!currentConfig.song_offsets) currentConfig.song_offsets = {};
            currentConfig.song_offsets[lastTrackId] = val;
        } else {
            currentConfig.sync_offset = val;
        }
        const offsetVal = document.getElementById('sync-offset-val');
        if (offsetVal) offsetVal.innerText = `${val > 0 ? '+' : ''}${val}ms`;
        await saveConfig();
    });
}

const themeSelect = document.getElementById('theme-select');
if (themeSelect) {
    themeSelect.addEventListener('mousedown', (e) => e.stopPropagation());
    themeSelect.addEventListener('change', async (e) => {
        currentConfig.theme = e.target.value;
        if (lyricsContainer) lyricsContainer.className = `theme-${e.target.value}`;
        await saveConfig();
    });
}

const musixmatchOptin = document.getElementById('musixmatch-optin');
if (musixmatchOptin) {
    musixmatchOptin.addEventListener('mousedown', (e) => e.stopPropagation());
    musixmatchOptin.addEventListener('change', async (e) => {
        if (e.target.checked) {
            if (!currentConfig.provider_order.includes('musixmatch')) {
                currentConfig.provider_order.push('musixmatch');
            }
        } else {
            currentConfig.provider_order = currentConfig.provider_order.filter(p => p !== 'musixmatch');
        }
        renderProviderList();
        await saveConfig();
    });
}

const streamerModeOptin = document.getElementById('streamer-mode-optin');
const streamerModeInfo = document.getElementById('streamer-mode-info');
const copyObsUrlBtn = document.getElementById('copy-obs-url-btn');

if (streamerModeOptin) {
    streamerModeOptin.addEventListener('mousedown', (e) => e.stopPropagation());
    streamerModeOptin.addEventListener('change', async (e) => {
        currentConfig.streamer_mode = e.target.checked;
        if (streamerModeInfo) {
            streamerModeInfo.style.display = e.target.checked ? 'flex' : 'none';
        }
        if (e.target.checked) {
            await startObsServer();
        } else {
            await stopObsServer();
        }
        await saveConfig();
    });
}

if (copyObsUrlBtn) {
    copyObsUrlBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    copyObsUrlBtn.addEventListener('click', async () => {
        try {
            await Neutralino.clipboard.writeText('http://127.0.0.1:5001/overlay');
            copyObsUrlBtn.innerText = 'Copied!';
            setTimeout(() => { copyObsUrlBtn.innerText = 'Copy OBS Link'; }, 1500);
        } catch (e) {}
    });
}

async function checkAutostartRegistry() {
    const autostartCheckbox = document.getElementById('autostart-checkbox');
    if (!autostartCheckbox) return;
    try {
        const cmd = `"${window.NL_PATH}/window_utils.exe" -Action check-autostart`;
        const res = await Neutralino.os.execCommand(cmd);
        if (res && res.stdOut) {
            const data = JSON.parse(res.stdOut.trim());
            if (data && data.autostart !== undefined) {
                autostartCheckbox.checked = data.autostart;
                currentConfig.autostart = data.autostart;
            }
        }
    } catch (e) {}
}

const autostartCheckbox = document.getElementById('autostart-checkbox');
if (autostartCheckbox) {
    autostartCheckbox.addEventListener('mousedown', (e) => e.stopPropagation());
    autostartCheckbox.addEventListener('change', async (e) => {
        const enable = e.target.checked;
        currentConfig.autostart = enable;
        try {
            const action = enable ? 'enable-autostart' : 'disable-autostart';
            const cmd = `"${window.NL_PATH}/window_utils.exe" -Action ${action}`;
            await Neutralino.os.execCommand(cmd);
        } catch (e) {}
        await saveConfig();
    });
}

function initTelemetryConfig() {
    if (!currentConfig.telemetry) {
        currentConfig.telemetry = {
            opt_in: false,
            cache_hits: 0,
            cache_misses: 0,
            total_searches: 0,
            provider_wins: { lrclib: 0, netease: 0, musixmatch: 0, lyricsovh: 0 },
            total_fetch_time_ms: 0
        };
    }
}

function recordTelemetryHit() {
    initTelemetryConfig();
    currentConfig.telemetry.cache_hits = (currentConfig.telemetry.cache_hits || 0) + 1;
    currentConfig.telemetry.total_searches = (currentConfig.telemetry.total_searches || 0) + 1;
    saveConfig();
    renderTelemetryStats();
}

function recordTelemetryMiss() {
    initTelemetryConfig();
    currentConfig.telemetry.cache_misses = (currentConfig.telemetry.cache_misses || 0) + 1;
    currentConfig.telemetry.total_searches = (currentConfig.telemetry.total_searches || 0) + 1;
    saveConfig();
    renderTelemetryStats();
}

function recordTelemetryProviderWin(provider, elapsedMs) {
    initTelemetryConfig();
    if (!currentConfig.telemetry.provider_wins) {
        currentConfig.telemetry.provider_wins = { lrclib: 0, netease: 0, musixmatch: 0, lyricsovh: 0 };
    }
    const p = (provider || 'unknown').toLowerCase();
    currentConfig.telemetry.provider_wins[p] = (currentConfig.telemetry.provider_wins[p] || 0) + 1;
    currentConfig.telemetry.total_fetch_time_ms = (currentConfig.telemetry.total_fetch_time_ms || 0) + elapsedMs;
    saveConfig();
    renderTelemetryStats();
}

function renderTelemetryStats() {
    initTelemetryConfig();
    const t = currentConfig.telemetry;
    const statHitEl = document.getElementById('stat-cache-hit');
    const statScraperEl = document.getElementById('stat-top-scraper');
    const statSpeedEl = document.getElementById('stat-avg-speed');

    if (statHitEl) {
        const hitRate = t.total_searches > 0 ? Math.round((t.cache_hits / t.total_searches) * 100) : 0;
        statHitEl.innerText = `${hitRate}% (${t.cache_hits}/${t.total_searches})`;
    }

    if (statScraperEl) {
        let topName = 'Lrclib';
        let maxCount = 0;
        let totalWins = 0;
        const wins = t.provider_wins || {};
        for (let k in wins) {
            totalWins += wins[k];
            if (wins[k] > maxCount) {
                maxCount = wins[k];
                topName = k;
            }
        }
        const pct = totalWins > 0 ? Math.round((maxCount / totalWins) * 100) : 0;
        statScraperEl.innerText = `${topName.toUpperCase()} (${pct}%)`;
    }

    if (statSpeedEl) {
        const fetchCount = t.cache_misses || 1;
        const avgMs = t.total_fetch_time_ms > 0 ? Math.round(t.total_fetch_time_ms / fetchCount) : 0;
        statSpeedEl.innerText = `${avgMs}ms`;
    }
}

function setupSponsorAndTelemetryListeners() {
    const githubBtn = document.getElementById('sponsor-github-btn');
    const bmacBtn = document.getElementById('sponsor-bmac-btn');
    const telemetryOptin = document.getElementById('telemetry-optin');
    const telemetryCard = document.getElementById('telemetry-stats-card');

    if (githubBtn) {
        githubBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        githubBtn.addEventListener('click', () => {
            Neutralino.os.open('https://github.com/sponsors/bnbidipta');
        });
    }

    if (bmacBtn) {
        bmacBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        bmacBtn.addEventListener('click', () => {
            Neutralino.os.open('https://buymeacoffee.com/bnbidipta');
        });
    }

    if (telemetryOptin) {
        telemetryOptin.addEventListener('mousedown', (e) => e.stopPropagation());
        telemetryOptin.addEventListener('change', async (e) => {
            initTelemetryConfig();
            currentConfig.telemetry.opt_in = e.target.checked;
            if (telemetryCard) {
                telemetryCard.style.display = e.target.checked ? 'flex' : 'none';
            }
            if (e.target.checked) {
                renderTelemetryStats();
            }
            await saveConfig();
        });
    }
}
setupSponsorAndTelemetryListeners();

function setupAccountAndCustomClientListeners() {
    const customClientInput = document.getElementById('custom-client-id-input');
    const disconnectBtn = document.getElementById('disconnect-account-btn');

    if (customClientInput) {
        customClientInput.addEventListener('mousedown', (e) => e.stopPropagation());
        customClientInput.value = currentConfig.custom_client_id || '';
        customClientInput.addEventListener('change', async (e) => {
            const val = e.target.value.trim();
            currentConfig.custom_client_id = val;
            spotifyClientId = val || BUILTIN_DEFAULT_SPOTIFY_CLIENT_ID;
            await saveConfig();
        });
    }

    if (disconnectBtn) {
        disconnectBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        disconnectBtn.addEventListener('click', async () => {
            if (confirm('Disconnect your Spotify account from the overlay?')) {
                if (playbackPollInterval) clearInterval(playbackPollInterval);
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                await clearSession();
                showAuthRequired();
            }
        });
    }
}
setupAccountAndCustomClientListeners();

// --- Premium overlay control bindings ---
const prevBtn = document.getElementById('prev-btn');
if (prevBtn) {
    prevBtn.addEventListener('click', async () => {
        await spotifyControl('previous', 'POST');
        pollPlaybackStatusOnce();
    });
}

const playBtn = document.getElementById('play-btn');
if (playBtn) {
    playBtn.addEventListener('click', async () => {
        const action = isPlaying ? 'pause' : 'play';
        isPlaying = !isPlaying;
        playBtn.innerText = isPlaying ? '⏸️' : '▶️';
        await spotifyControl(action, 'PUT');
    });
}

const nextBtn = document.getElementById('next-btn');
if (nextBtn) {
    nextBtn.addEventListener('click', async () => {
        await spotifyControl('next', 'POST');
        pollPlaybackStatusOnce();
    });
}

const likeBtn = document.getElementById('like-btn');
if (likeBtn) {
    likeBtn.addEventListener('click', async () => {
        if (!lastTrackId) return;
        const targetLike = !isCurrentTrackLiked;
        const success = await likeTrack(lastTrackId, targetLike);
        if (success) {
            isCurrentTrackLiked = targetLike;
            updateLikeButtonUI();
        }
    });
}

const translateBtn = document.getElementById('translate-btn');
if (translateBtn) {
    translateBtn.addEventListener('click', async () => {
        isTranslationActive = !isTranslationActive;
        translateBtn.classList.toggle('active', isTranslationActive);
        if (isTranslationActive && parsedLyrics.length > 0) {
            const needsTranslation = parsedLyrics.some(l => !l.translation && l.time !== -1);
            if (needsTranslation) {
                await translateLyrics(parsedLyrics);
            }
        }
        renderLyrics(parsedLyrics);
    });
}

// Stop propagation to prevent window dragging when clicking controls
const controlsButtons = document.querySelectorAll('#controls-bar button');
controlsButtons.forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
});

async function spotifyControl(action, method = 'POST', body = null) {
    try {
        const url = `https://api.spotify.com/v1/me/player/${action}`;
        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(url, options);
        if (res.status === 401) {
            await refreshSpotifyToken();
            return spotifyControl(action, method, body);
        }
        return res;
    } catch (err) {
        console.error(`Spotify control ${action} failed`, err);
    }
}

async function likeTrack(trackId, isLiked) {
    try {
        const url = `https://api.spotify.com/v1/me/tracks?ids=${trackId}`;
        const res = await fetch(url, {
            method: isLiked ? 'PUT' : 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (res.status === 401) {
            await refreshSpotifyToken();
            return likeTrack(trackId, isLiked);
        }
        return res.ok;
    } catch (err) {
        console.error(`Spotify like track failed`, err);
    }
    return false;
}

async function checkIsLiked(trackId) {
    try {
        const url = `https://api.spotify.com/v1/me/tracks/contains?ids=${trackId}`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (res.status === 401) {
            await refreshSpotifyToken();
            return checkIsLiked(trackId);
        }
        if (res.ok) {
            const data = await res.json();
            return data[0];
        }
    } catch (err) {
        console.error(`Spotify check liked failed`, err);
    }
    return false;
}

async function checkTrackLikedStatus(trackId) {
    if (currentLikedTrackId === trackId) return;
    currentLikedTrackId = trackId;
    isCurrentTrackLiked = await checkIsLiked(trackId);
    updateLikeButtonUI();
}

function updateLikeButtonUI() {
    const likeBtn = document.getElementById('like-btn');
    if (likeBtn) {
        likeBtn.innerText = isCurrentTrackLiked ? '💚' : '🖤';
        likeBtn.title = isCurrentTrackLiked ? 'Unlike Track' : 'Like Track';
    }
}

async function pollPlaybackStatusOnce() {
    if (!accessToken) return;
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (response.status === 200) {
            const data = await response.json();
            if (data && data.item) {
                progressMsLastPoll = data.progress_ms;
                timestampLastPoll = Date.now();
                isPlaying = data.is_playing;
                const playBtn = document.getElementById('play-btn');
                if (playBtn) playBtn.innerText = isPlaying ? '⏸️' : '▶️';
            }
        }
    } catch {}
}

// --- Translation & Transliteration Helper ---
async function translateLyrics(lines) {
    try {
        const textToTranslate = lines.map(l => l.text).join('\n');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(textToTranslate)}`;
        const response = await fetch(url);
        if (!response.ok) return;
        const data = await response.json();
        if (data && data[0]) {
            const translatedParagraph = data[0].map(s => s[0]).join('');
            const translatedLines = translatedParagraph.split('\n');
            lines.forEach((line, idx) => {
                if (translatedLines[idx]) {
                    line.translation = translatedLines[idx].trim();
                }
            });
        }
    } catch (e) {
        console.error("Failed to translate lyrics", e);
    }
}

const devanagariMap = {
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
    'क': 'ka', 'ख': 'kha', 'ग': 'ga', 'घ': 'gha', 'ङ': 'nga',
    'च': 'cha', 'छ': 'chha', 'ज': 'ja', 'झ': 'jha', 'ञ': 'nya',
    'ट': 'ta', 'ठ': 'tha', 'ड': 'da', 'ढ': 'dha', 'ण': 'na',
    'त': 'ta', 'थ': 'tha', 'द': 'da', 'ध': 'dha', 'न': 'na',
    'प': 'pa', 'फ': 'pha', 'ब': 'ba', 'भ': 'bha', 'म': 'ma',
    'य': 'ya', 'र': 'ra', 'ल': 'la', 'व': 'va', 'श': 'sha', 'ष': 'sha', 'स': 'sa', 'ह': 'ha',
    'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ः': 'h', 'ँ': 'n'
};

function containsDevanagari(text) {
    return /[\u0900-\u097F]/.test(text);
}

function transliterateHindi(text) {
    let result = '';
    for (let char of text) {
        if (devanagariMap[char]) {
            result += devanagariMap[char];
        } else {
            result += char;
        }
    }
    return result
        .replace(/a{3,}/g, 'aa')
        .replace(/e{3,}/g, 'ee')
        .replace(/o{3,}/g, 'oo')
        .replace(/k+h/g, 'kh')
        .replace(/c+h/g, 'ch');
}

function parseEnhancedLrcLine(lineTime, text) {
    const words = [];
    const tags = [];
    let match;
    const tagRegex = /<([0-9]{2}):([0-9]{2})[.:]([0-9]{2,3})>/g;
    
    let lastIndex = 0;
    while ((match = tagRegex.exec(text)) !== null) {
        const tagTime = parseInt(match[1], 10) * 60 * 1000 + parseInt(match[2], 10) * 1000 + parseFloat("0." + match[3]) * 1000;
        tags.push({
            time: tagTime,
            index: match.index,
            rawLength: match[0].length
        });
    }
    
    if (tags.length === 0) return null;
    
    let currentStart = lineTime;
    let pos = 0;
    for (let i = 0; i <= tags.length; i++) {
        const endPos = (i < tags.length) ? tags[i].index : text.length;
        const wordText = text.substring(pos, endPos).trim();
        if (wordText) {
            words.push({
                text: wordText,
                time: currentStart
            });
        }
        if (i < tags.length) {
            currentStart = tags[i].time;
            pos = tags[i].index + tags[i].rawLength;
        }
    }
    
    return words;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    // 1. If user set a custom client ID in settings, use that
    if (currentConfig.custom_client_id && currentConfig.custom_client_id.trim()) {
        spotifyClientId = currentConfig.custom_client_id.trim();
        return;
    }

    // 2. Check local .env file if user provided one
    let envContent = '';
    try { envContent = await Neutralino.filesystem.readFile('.env'); }
    catch { try { envContent = await Neutralino.filesystem.readFile('../.env'); } catch {} }

    if (envContent) {
        try {
            envContent = envContent.replace(/^\uFEFF/, '');
            envContent.split(/\r?\n/).forEach(line => {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) return;
                const idx = trimmed.indexOf('=');
                if (idx === -1) return;
                const key = trimmed.substring(0, idx).trim();
                const val = trimmed.substring(idx+1).trim().replace(/^["']|["']$/g, '');
                if (key === 'SPOTIFY_CLIENT_ID' && val) spotifyClientId = val;
            });
        } catch (err) {
            console.warn('Failed to parse .env, falling back to built-in ID');
        }
    }

    // 3. Fallback to built-in default zero-setup public Client ID
    if (!spotifyClientId) {
        spotifyClientId = BUILTIN_DEFAULT_SPOTIFY_CLIENT_ID;
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
function showAuthRequired() {
    if (setupSection) setupSection.style.display = 'none';
    authSection.style.display = 'flex';
    lyricsSection.style.display = 'none';
    const disconnectBtn = document.getElementById('disconnect-account-btn');
    if (disconnectBtn) disconnectBtn.style.display = 'none';
}
function hideAuthRequired() {
    if (setupSection) setupSection.style.display = 'none';
    authSection.style.display = 'none';
    lyricsSection.style.display = 'flex';
    const disconnectBtn = document.getElementById('disconnect-account-btn');
    if (disconnectBtn) disconnectBtn.style.display = 'block';
}

// --- PKCE Token Exchange via fetch (NO PowerShell, NO secret) ---
let currentSession = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0
};
let proactiveRefreshTimer = null;
let refreshPromise = null;

async function saveSession(session) {
    currentSession = {
        accessToken: session.accessToken || null,
        refreshToken: session.refreshToken || null,
        expiresAt: session.expiresAt || 0
    };
    accessToken = currentSession.accessToken;

    // 1. Save to localStorage as fallback
    try {
        if (currentSession.accessToken) localStorage.setItem('spotify_access_token', currentSession.accessToken);
        if (currentSession.refreshToken) localStorage.setItem('spotify_refresh_token', currentSession.refreshToken);
        if (currentSession.expiresAt) localStorage.setItem('spotify_token_expires_at', currentSession.expiresAt.toString());
    } catch(e) {}

    // 2. Save encrypted via DPAPI secure_store.exe (survives origin/port changes & restarts)
    try {
        const payload = btoa(unescape(encodeURIComponent(JSON.stringify(currentSession))));
        const cmd = `"${window.NL_PATH}/secure_store.exe" save-b64 spotify_session ${payload}`;
        await Neutralino.os.execCommand(cmd);
    } catch(e) {
        console.warn('Failed to save to secure_store', e);
    }
}

async function loadSession() {
    // 1. Try loading from DPAPI secure_store.exe
    try {
        const cmd = `"${window.NL_PATH}/secure_store.exe" load spotify_session`;
        const res = await Neutralino.os.execCommand(cmd);
        if (res && res.stdOut && res.stdOut.trim()) {
            const rawJson = decodeURIComponent(escape(atob(res.stdOut.trim())));
            const data = JSON.parse(rawJson);
            if (data && (data.accessToken || data.refreshToken)) {
                currentSession = data;
                accessToken = data.accessToken;
                return currentSession;
            }
        }
    } catch(e) {
        console.warn('Failed to load from secure_store', e);
    }

    // 2. Fallback to localStorage
    try {
        const savedToken = localStorage.getItem('spotify_access_token');
        const refreshToken = localStorage.getItem('spotify_refresh_token');
        const expiresAt = parseInt(localStorage.getItem('spotify_token_expires_at') || '0', 10);
        if (savedToken || refreshToken) {
            currentSession = {
                accessToken: savedToken,
                refreshToken: refreshToken,
                expiresAt: expiresAt
            };
            accessToken = savedToken;
            return currentSession;
        }
    } catch(e) {}

    return currentSession;
}

async function clearSession() {
    currentSession = {
        accessToken: null,
        refreshToken: null,
        expiresAt: 0
    };
    accessToken = null;
    if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);

    try {
        localStorage.removeItem('spotify_access_token');
        localStorage.removeItem('spotify_refresh_token');
        localStorage.removeItem('spotify_token_expires_at');
    } catch(e) {}

    try {
        const cmd = `"${window.NL_PATH}/secure_store.exe" clear spotify_session`;
        await Neutralino.os.execCommand(cmd);
    } catch(e) {}
}

function scheduleProactiveRefresh(expiresAt) {
    if (proactiveRefreshTimer) clearTimeout(proactiveRefreshTimer);
    if (!expiresAt) return;
    
    // Refresh 5 minutes (300,000ms) before token expiration, or after at least 10 seconds
    const timeUntilRefresh = Math.max(10000, expiresAt - Date.now() - 300000);
    
    proactiveRefreshTimer = setTimeout(async () => {
        try {
            await refreshSpotifyToken();
        } catch (err) {
            console.warn('Proactive token refresh failed, will retry in 30s:', err);
            if (currentSession.refreshToken) {
                proactiveRefreshTimer = setTimeout(() => refreshSpotifyToken().catch(()=>{}), 30000);
            }
        }
    }, timeUntilRefresh);
}

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
    // If a refresh is already in flight, reuse that promise
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const session = await loadSession();
            const refreshToken = session ? session.refreshToken : null;
            if (!refreshToken) throw new Error('No refresh token available');

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

            if (!res.ok) {
                let errorData = null;
                try { errorData = await res.json(); } catch(e) {}
                
                // If Spotify explicitly returns 400 with invalid_grant, the token is revoked
                if (res.status === 400 && errorData && errorData.error === 'invalid_grant') {
                    console.error('Refresh token revoked:', errorData);
                    await clearSession();
                    throw new Error('Refresh token revoked: ' + (errorData.error_description || 'invalid_grant'));
                }
                
                throw new Error(`Token refresh HTTP error: ${res.status}`);
            }

            const data = await res.json();
            const newAccessToken = data.access_token;
            const newRefreshToken = data.refresh_token || refreshToken;
            const expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);

            await saveSession({
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
                expiresAt: expiresAt
            });

            scheduleProactiveRefresh(expiresAt);
            return newAccessToken;
        } finally {
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}

async function performLogin() {
    if (!spotifyClientId) spotifyClientId = BUILTIN_DEFAULT_SPOTIFY_CLIENT_ID;
    updateUI('Connecting to Spotify...', 'Browser opened for login...');
    loginBtn.disabled = true;
    loginBtn.innerHTML = `<span>Connecting...</span>`;
    try {
        const { verifier, challenge } = await generatePkce();
        const state = crypto.randomUUID();
        const port = getRandomPort();
        sessionStorage.setItem('pkce_verifier', verifier);
        sessionStorage.setItem('oauth_state', state);
        sessionStorage.setItem('oauth_port', port.toString());

        const authUrl = `https://accounts.spotify.com/authorize?client_id=${encodeURIComponent(spotifyClientId)}&redirect_uri=${encodeURIComponent(`http://127.0.0.1:${port}/callback`)}&response_type=code&scope=user-read-currently-playing%20user-modify-playback-state%20user-library-read%20user-library-modify&code_challenge=${challenge}&code_challenge_method=S256&state=${state}&show_dialog=true`;
        await Neutralino.os.open(authUrl);

        // Secure: port and state are validated ints/UUIDs, no user input
        const listenerCommand = `"${window.NL_PATH}/auth_listener.exe" -Port ${port} -ExpectedState ${state}`;
        const result = await Neutralino.os.execCommand(listenerCommand);
        if (!result.stdOut) throw new Error(result.stdErr || 'No code returned');

        let parsed;
        try { parsed = JSON.parse(result.stdOut.trim()); } catch { throw new Error('Invalid auth response'); }
        if (!parsed.code || !parsed.state || parsed.state !== state) throw new Error('State mismatch or missing code');

        const tokenData = await exchangeCodeViaFetch(parsed.code, verifier, port);
        const expiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000);
        await saveSession({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            expiresAt: expiresAt
        });
        scheduleProactiveRefresh(expiresAt);

        hideAuthRequired();
        updateUI('Connecting...', 'Authenticated. Resolving playback...');
        startPlaybackMonitoring();
    } catch (err) {
        console.error('Login error', err);
        alert('Auth failed: ' + err.message);
        showAuthRequired();
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.485 17.307c-.215.353-.675.465-1.028.25-2.82-1.722-6.37-2.112-10.55-1.157-.402.092-.803-.16-.895-.562-.092-.403.16-.804.563-.896 4.573-1.045 8.492-.596 11.66 1.338.353.215.465.674.25 1.027zm1.464-3.254c-.27.44-.848.58-1.288.31-3.228-1.984-8.148-2.558-11.967-1.398-.498.15-1.03-.133-1.18-.63-.152-.498.132-1.03.63-1.182 4.367-1.325 9.79-.687 13.495 1.59.44.27.58.847.31 1.288zm.126-3.39c-3.87-2.298-10.254-2.51-13.963-1.383-.593.18-1.224-.155-1.403-.748-.18-.593.155-1.224.748-1.403 4.26-1.293 11.31-1.043 15.762 1.6C15.22 8.97 15.39 9.72 14.88 10.2c-.44.52-1.2.68-1.8.463z"/></svg>
            <span>Login with Spotify</span>
        `;
    }
}

let lyricsCache = {};

async function loadLyricsCache() {
    try {
        const content = await Neutralino.filesystem.readFile('lyrics_cache.json');
        if (content) {
            lyricsCache = JSON.parse(content);
        }
    } catch (e) {
        lyricsCache = {};
    }
}

async function saveLyricsCache() {
    try {
        await Neutralino.filesystem.writeFile('lyrics_cache.json', JSON.stringify(lyricsCache, null, 2));
    } catch (e) {
        console.error("Failed to save lyrics_cache.json", e);
    }
}

async function getCachedLyrics(trackName, artistName) {
    const key = `${trackName.toLowerCase()} - ${artistName.toLowerCase()}`;
    if (lyricsCache[key]) {
        lyricsCache[key].last_accessed = Date.now();
        await saveLyricsCache();
        recordTelemetryHit();
        return lyricsCache[key].data;
    }
    recordTelemetryMiss();
    return null;
}

async function cacheLyrics(trackName, artistName, data) {
    const key = `${trackName.toLowerCase()} - ${artistName.toLowerCase()}`;
    const keys = Object.keys(lyricsCache);
    if (keys.length >= 50) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (let k of keys) {
            const time = lyricsCache[k].last_accessed || 0;
            if (time < oldestTime) {
                oldestTime = time;
                oldestKey = k;
            }
        }
        if (oldestKey) {
            delete lyricsCache[oldestKey];
        }
    }
    lyricsCache[key] = {
        last_accessed: Date.now(),
        data: data
    };
    await saveLyricsCache();
}

function startPlaybackMonitoring() {
    if (playbackPollInterval) clearInterval(playbackPollInterval);
    startLyricsSyncLoop();
    playbackPollInterval = setInterval(async () => {
        if (!accessToken) return;

        // Proactive token refresh if within 60s of expiration
        if (currentSession && currentSession.expiresAt && Date.now() > currentSession.expiresAt - 60000) {
            try { await refreshSpotifyToken(); } catch(e) {}
        }

        try {
            const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.status === 204) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false; parsedLyrics = []; return;
            }
            if (response.status === 401) {
                try {
                    await refreshSpotifyToken();
                    return;
                } catch (refreshErr) {
                    console.error('Refresh on 401 failed', refreshErr);
                    if (refreshErr.message && (refreshErr.message.includes('revoked') || !currentSession.refreshToken)) {
                        accessToken = null;
                        await clearSession();
                        clearInterval(playbackPollInterval);
                        if (animationFrameId) cancelAnimationFrame(animationFrameId);
                        showAuthRequired();
                        return;
                    }
                    // Transient network glitch: retry on next poll interval without logging out!
                    return;
                }
            }
            if (response.status === 429) return;
            const data = await response.json();
            if (!data || !data.item) {
                updateUI('No music playing', 'Play a song on Spotify to view lyrics.');
                isPlaying = false; parsedLyrics = []; return;
            }
            progressMsLastPoll = data.progress_ms;
            timestampLastPoll = Date.now();
            isPlaying = data.is_playing;
            
            const playBtn = document.getElementById('play-btn');
            if (playBtn) playBtn.innerText = isPlaying ? '⏸️' : '▶️';

            const track = data.item;
            trackDurationMs = track.duration_ms;
            currentTrackName = track.name;
            currentArtistName = track.artists ? track.artists.map(a=>a.name).join(', ') : '';
            currentAlbumArtUrl = (track.album && track.album.images && track.album.images.length > 0) ? track.album.images[0].url : '';
            
            const headerArt = document.getElementById('header-album-art');
            const headerTitle = document.getElementById('header-title');
            if (headerArt && track.album && track.album.images && track.album.images.length > 0) {
                headerArt.src = track.album.images[2].url;
                headerArt.style.display = 'block';
            }
            if (headerTitle) {
                headerTitle.innerText = `${track.name} - ${track.artists.map(a=>a.name).join(', ')}`;
            }

            const trackId = track.id;
            if (trackId !== lastTrackId) {
                lastTrackId = trackId;
                
                // Update sync offset slider for this track
                const offset = (currentConfig.song_offsets && currentConfig.song_offsets[trackId] !== undefined)
                    ? currentConfig.song_offsets[trackId]
                    : currentConfig.sync_offset;
                const offsetSlider = document.getElementById('sync-offset-slider');
                if (offsetSlider) offsetSlider.value = offset;
                const offsetVal = document.getElementById('sync-offset-val');
                if (offsetVal) offsetVal.innerText = `${offset > 0 ? '+' : ''}${offset}ms`;

                const songInfo = `${track.name} - ${track.artists.map(a=>a.name).join(', ')}`;
                updateUI(songInfo, 'Searching for lyrics...');
                lastActiveIndex = -1;
                const cached = await getCachedLyrics(track.name, track.artists[0].name);
                if (cached) {
                    parsedLyrics = cached.lines;
                    if (isTranslationActive) {
                        await translateLyrics(parsedLyrics);
                    }
                    renderLyrics(parsedLyrics);
                    updateUI(songInfo, null);
                    hideManualSearchPanel();
                    checkTrackLikedStatus(trackId);
                    return;
                }
                lastSearchTrackName = track.name;
                lastSearchArtistName = track.artists[0].name;
                const result = await fetchLyrics(track.name, track.artists[0].name);
                parsedLyrics = result.lines;
                if (isTranslationActive) {
                    await translateLyrics(parsedLyrics);
                }
                renderLyrics(parsedLyrics);
                updateUI(songInfo, null);
                const isError = result.lines.length===0 || (result.lines.length===1 && result.lines[0].text==="Lyrics not found for this track.");
                if (isError) {
                    showManualSearchPanel(track.artists[0].name, track.name);
                } else {
                    hideManualSearchPanel();
                    try { await cacheLyrics(track.name, track.artists[0].name, result); } catch {}
                }
                checkTrackLikedStatus(trackId);
            }
        } catch (err) { console.error('Playback poll error', err); }
    }, 3000);
}

async function fetchLyrics(trackName, artistName) {
    const startTime = Date.now();
    try {
        // Secure Base64 args - no shell interpolation of track names
        const payload = btoa(JSON.stringify({
            track: trackName.substring(0,200),
            artist: artistName.substring(0,200),
            providers: currentConfig.provider_order
        }));
        const command = `chcp 65001 >nul && "${window.NL_PATH}/fetch_lyrics.exe" -EncodedArgs ${payload}`;
        const result = await Neutralino.os.execCommand(command);
        const elapsed = Date.now() - startTime;
        if (!result.stdOut) throw new Error('Empty lyrics response');
        let data;
        try { data = JSON.parse(result.stdOut.trim()); } catch { throw new Error('Invalid lyrics JSON'); }
        if (data && data.lyrics) {
            recordTelemetryProviderWin(data.provider || 'unknown', elapsed);
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
            const rawText = match[4].trim();
            if (rawText) {
                const words = parseEnhancedLrcLine(totalMs, rawText);
                if (words) {
                    const cleanText = rawText.replace(/<[0-9]{2}:[0-9]{2}[.:][0-9]{2,3}>/g, '').trim();
                    parsed.push({ time: totalMs, text: cleanText, words });
                } else {
                    parsed.push({ time: totalMs, text: rawText });
                }
            }
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
        
        if (line.words && line.words.length > 0) {
            el.innerHTML = line.words.map(w => `<span class="word" data-time="${w.time}">${escapeHtml(w.text)}</span>`).join(' ');
        } else {
            el.innerText = line.text || ' ';
        }

        if (isTranslationActive && line.translation) {
            const transDiv = document.createElement('span');
            transDiv.className = 'translation-text';
            
            if (containsDevanagari(line.text)) {
                const translit = transliterateHindi(line.text);
                transDiv.innerText = `${translit}\n(${line.translation})`;
            } else {
                transDiv.innerText = line.translation;
            }
            el.appendChild(transDiv);
        }

        if (line.time !== -1) el.dataset.time = line.time;
        el.id = `line-${index}`;
        lyricsTextEl.appendChild(el);
    });
}

function getEffectiveSyncOffset() {
    if (lastTrackId && currentConfig.song_offsets && currentConfig.song_offsets[lastTrackId] !== undefined) {
        return currentConfig.song_offsets[lastTrackId];
    }
    return currentConfig.sync_offset;
}

function startLyricsSyncLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    function update() {
        if (accessToken) {
            let currentProgress = progressMsLastPoll + getEffectiveSyncOffset();
            if (isPlaying) currentProgress += (Date.now() - timestampLastPoll);
            highlightActiveLyric(currentProgress);

            const progressBar = document.getElementById('progress-bar');
            if (progressBar && trackDurationMs > 0) {
                const pct = Math.min(100, (currentProgress / trackDurationMs) * 100);
                progressBar.style.width = `${pct}%`;
            }

            if (currentConfig.streamer_mode) {
                updateObsServerState();
            }
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
    if (activeIndex!==-1) {
        if (activeIndex!==lastActiveIndex) {
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
        
        const activeEl = document.getElementById(`line-${activeIndex}`);
        if (activeEl) {
            const wordSpans = activeEl.querySelectorAll('.word');
            wordSpans.forEach(span => {
                const t = parseInt(span.getAttribute('data-time'), 10);
                if (currentProgress >= t) {
                    span.classList.add('active');
                } else {
                    span.classList.remove('active');
                }
            });
        }
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
    await loadConfig();
    await loadLyricsCache();
    await restoreWindowGeometry();
    applySettings();
    await checkAutostartRegistry();
    setupWindowBoundsListeners();
    checkForUpdates();
    await loadEnv();

    const session = await loadSession();
    if (session && session.refreshToken) {
        // If access token is missing or expires within 5 minutes, refresh it now
        if (!session.accessToken || Date.now() > (session.expiresAt - 300000)) {
            try {
                hideAuthRequired();
                updateUI('Connecting...', 'Refreshing session...');
                await refreshSpotifyToken();
                startPlaybackMonitoring();
            } catch (err) {
                console.error('Failed to refresh on start:', err);
                if (err.message && (err.message.includes('revoked') || !session.refreshToken)) {
                    showAuthRequired();
                    return;
                }
                // If offline / transient error, attempt playback monitoring with existing token or wait
                startPlaybackMonitoring();
            }
        } else {
            accessToken = session.accessToken;
            scheduleProactiveRefresh(session.expiresAt);
            hideAuthRequired();
            updateUI('Connecting...', 'Restoring session...');
            startPlaybackMonitoring();
        }
    } else {
        showAuthRequired();
    }
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
setupManualSearch();
loginBtn.onclick = performLogin;
onStart();

// ─── Manual Search Fallback ───
function showManualSearchPanel(artistName, trackName) {
    if (!manualSearchPanel) return;
    manualSearchInput.value = `${artistName} - ${trackName}`;
    manualSearchPanel.style.display = 'block';
    // Reset LRC paste state
    lrcPasteArea.style.display = 'none';
    lrcPasteActions.style.display = 'none';
    lrcPasteArea.value = '';
}

function hideManualSearchPanel() {
    if (!manualSearchPanel) return;
    manualSearchPanel.style.display = 'none';
    lrcPasteArea.style.display = 'none';
    lrcPasteActions.style.display = 'none';
    lrcPasteArea.value = '';
}

async function performManualSearch() {
    const query = manualSearchInput.value.trim();
    if (!query) return;

    // Parse "Artist - Title" or just use as title
    let artist, title;
    const dashIndex = query.indexOf(' - ');
    if (dashIndex > 0) {
        artist = query.substring(0, dashIndex).trim();
        title = query.substring(dashIndex + 3).trim();
    } else {
        artist = lastSearchArtistName || '';
        title = query;
    }

    if (!title) return;

    // Show searching state
    displayPlaceholderLyric('Searching...');
    hideManualSearchPanel();

    const result = await fetchLyrics(title, artist);
    parsedLyrics = result.lines;
    if (isTranslationActive) {
        await translateLyrics(parsedLyrics);
    }
    renderLyrics(parsedLyrics);

    const isError = result.lines.length===0 || (result.lines.length===1 && result.lines[0].text==="Lyrics not found for this track.");
    if (isError) {
        showManualSearchPanel(artist, title);
    } else {
        // Cache under both original and manual search keys
        try { await cacheLyrics(title, artist, result); } catch {}
        if (lastSearchTrackName && lastSearchArtistName) {
            try { await cacheLyrics(lastSearchTrackName, lastSearchArtistName, result); } catch {}
        }
    }
}

function applyPastedLrc(lrcContent) {
    if (!lrcContent || !lrcContent.trim()) return;

    const isSynced = /^\[\d+:\d+/.test(lrcContent.trim());
    if (isSynced) {
        parsedLyrics = parseSyncedLyrics(lrcContent);
    } else {
        parsedLyrics = parsePlainLyrics(lrcContent);
    }

    if (parsedLyrics.length === 0) {
        parsedLyrics = [{ time: -1, text: 'Could not parse pasted content.' }];
    }

    if (isTranslationActive) {
        translateLyrics(parsedLyrics);
    }
    renderLyrics(parsedLyrics);
    hideManualSearchPanel();

    // Cache the pasted lyrics for this track
    if (lastSearchTrackName && lastSearchArtistName) {
        const result = { synced: isSynced, lines: parsedLyrics };
        try { cacheLyrics(lastSearchTrackName, lastSearchArtistName, result); } catch {}
    }
}

function setupManualSearch() {
    if (!manualSearchBtn) return;

    // Search button click
    manualSearchBtn.addEventListener('click', performManualSearch);

    // Enter key in search input
    manualSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            performManualSearch();
        }
    });

    // Paste LRC toggle
    pasteLrcBtn.addEventListener('click', () => {
        const isVisible = lrcPasteArea.style.display !== 'none';
        lrcPasteArea.style.display = isVisible ? 'none' : 'block';
        lrcPasteActions.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) lrcPasteArea.focus();
    });

    // Apply pasted LRC
    lrcApplyBtn.addEventListener('click', () => {
        applyPastedLrc(lrcPasteArea.value);
    });

    // Cancel paste
    lrcCancelBtn.addEventListener('click', () => {
        lrcPasteArea.style.display = 'none';
        lrcPasteActions.style.display = 'none';
        lrcPasteArea.value = '';
    });
}
