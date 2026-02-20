/**
 * ClipShare - Jellyfin Clip Creator Plugin
 * Allows creating video clips directly from the Jellyfin player.
 */
(function() {
    'use strict';

    // Prevent double loading
    if (window.__clipshare_loaded) {
        console.log('[ClipShare] Already loaded, skipping');
        return;
    }
    window.__clipshare_loaded = true;

    console.log('[ClipShare] ====== SCRIPT LOADED ======');
    console.log('[ClipShare] URL:', window.location.href);
    console.log('[ClipShare] Hash:', window.location.hash);

    // State
    let currentItemId = null;
    let currentMediaPath = null;
    let startTime = null;
    let endTime = null;
    let isSelecting = false;
    let clipButton = null;
    let selectionOverlay = null;
    let lastUrl = window.location.href;
    let lastHash = window.location.hash;
    let initAttempts = 0;

    // Configuration
    const CONFIG = {
        defaultExpireHours: 72,
        buttonId: 'clipshare-btn',
        overlayId: 'clipshare-overlay'
    };

    /**
     * Debug helper - log all possible sources of video ID
     */
    function debugVideoIdSources() {
        console.log('[ClipShare] === DEBUG Video ID Sources ===');

        console.log('[ClipShare] window.location.href:', window.location.href);
        console.log('[ClipShare] window.location.hash:', window.location.hash);
        console.log('[ClipShare] window.location.search:', window.location.search);

        // Video element
        const video = document.querySelector('video');
        if (video) {
            console.log('[ClipShare] video.src:', video.src);
            console.log('[ClipShare] video.currentSrc:', video.currentSrc);
        }

        // Jellyfin globals
        console.log('[ClipShare] window.ApiClient:', !!window.ApiClient);
        console.log('[ClipShare] window.playbackManager:', !!window.playbackManager);
        console.log('[ClipShare] window.Events:', !!window.Events);
        console.log('[ClipShare] window.connectionManager:', !!window.connectionManager);
        console.log('[ClipShare] window.appHost:', !!window.appHost);
        console.log('[ClipShare] window.appRouter:', !!window.appRouter);

        // Explore ApiClient deeply
        if (window.ApiClient) {
            const ac = window.ApiClient;
            console.log('[ClipShare] ApiClient keys:', Object.keys(ac).slice(0, 20).join(', '));

            // Check for current item
            if (ac._currentItem) console.log('[ClipShare] ApiClient._currentItem:', ac._currentItem);
            if (ac.currentItem) console.log('[ClipShare] ApiClient.currentItem:', ac.currentItem);
            if (ac.currentItemId) console.log('[ClipShare] ApiClient.currentItemId:', ac.currentItemId);

            // Check for playback state
            if (ac._playbackState) console.log('[ClipShare] ApiClient._playbackState:', ac._playbackState);
            if (ac.playbackState) console.log('[ClipShare] ApiClient.playbackState:', ac.playbackState);
        }

        // Explore Events
        if (window.Events) {
            console.log('[ClipShare] Events type:', typeof window.Events);
            if (window.Events._events) console.log('[ClipShare] Events._events:', window.Events._events);
            if (window.Events.listeners) console.log('[ClipShare] Events.listeners:', window.Events.listeners);
        }

        // Try to find state stores (React/Redux)
        const rootEl = document.getElementById('reactRoot') || document.querySelector('[data-reactroot]') || document.body;
        if (rootEl._reactRootContainer) {
            console.log('[ClipShare] React root found');
        }

        // Check for __INITIAL_STATE__
        if (window.__INITIAL_STATE__) console.log('[ClipShare] __INITIAL_STATE__:', window.__INITIAL_STATE__);

        // Look for any global with 'player' or 'video' in name
        const relevantGlobals = Object.keys(window).filter(k =>
            k.toLowerCase().includes('player') ||
            k.toLowerCase().includes('video') ||
            k.toLowerCase().includes('playback') ||
            k.toLowerCase().includes('current')
        );
        console.log('[ClipShare] Relevant globals:', relevantGlobals.join(', '));

        // Check each relevant global
        relevantGlobals.forEach(key => {
            const val = window[key];
            if (val && typeof val === 'object') {
                const subKeys = Object.keys(val).slice(0, 5);
                console.log(`[ClipShare] window.${key}:`, subKeys.join(', '));
                // Look for Id in the object
                if (val.Id) console.log(`[ClipShare] window.${key}.Id =`, val.Id);
                if (val.id) console.log(`[ClipShare] window.${key}.id =`, val.id);
                if (val.currentItem?.Id) console.log(`[ClipShare] window.${key}.currentItem.Id =`, val.currentItem.Id);
            }
        });

        // Network requests - look for video-related requests
        try {
            const resources = performance.getEntriesByType('resource');
            const videoResources = resources.filter(r =>
                r.name.includes('/video') ||
                r.name.includes('/Video') ||
                r.name.includes('/Items') ||
                r.name.includes('/Playback') ||
                r.name.includes('/stream')
            );
            console.log('[ClipShare] Video-related requests (last 5):');
            videoResources.slice(-5).forEach(r => {
                console.log('  -', r.name);
                const idMatch = r.name.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                if (idMatch) console.log('    -> ID:', idMatch[1]);
            });
        } catch(e) {}

        // Check localStorage for playback info
        try {
            const playbackInfo = localStorage.getItem('playbackinfo') || localStorage.getItem('jellyfin_playback');
            if (playbackInfo) console.log('[ClipShare] Playback info in localStorage:', playbackInfo);
        } catch(e) {}

        console.log('[ClipShare] === END DEBUG ===');
    }

    /**
     * Get API key from localStorage
     */
    function getApiKey() {
        try {
            const credentials = localStorage.getItem('jellyfin_credentials');
            if (credentials) {
                const parsed = JSON.parse(credentials);
                if (parsed.Servers && parsed.Servers.length > 0) {
                    const token = parsed.Servers[0].AccessToken;
                    if (token) return token;
                }
            }

            if (window.ApiClient) {
                if (window.ApiClient.accessToken) return window.ApiClient.accessToken;
                if (window.ApiClient._serverInfo?.AccessToken) return window.ApiClient._serverInfo.AccessToken;
            }
        } catch (e) {
            console.error('[ClipShare] Error getting API key:', e);
        }
        return null;
    }

    /**
     * Get video ID - try ALL possible sources
     */
    function getCurrentVideoId() {
        let videoId = null;

        // Method 1: Check hash for ID patterns (some Jellyfin versions include ID in hash)
        const hash = window.location.hash;
        if (hash) {
            // Try various hash patterns
            const hashPatterns = [
                /id=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
                /\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            ];
            for (const pattern of hashPatterns) {
                const match = hash.match(pattern);
                if (match) {
                    console.log('[ClipShare] Found ID in hash:', match[1]);
                    return match[1];
                }
            }
        }

        // Method 2: URL query params
        const urlParams = new URLSearchParams(window.location.search);
        videoId = urlParams.get('id') || urlParams.get('Id') || urlParams.get('videoId');
        if (videoId) {
            console.log('[ClipShare] Found ID in URL params:', videoId);
            return videoId;
        }

        // Method 3: URL path patterns
        const url = window.location.href;
        const urlPatterns = [
            /[?&]id=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            /\/video\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            /\/play\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            /\/items\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
        ];
        for (const pattern of urlPatterns) {
            const match = url.match(pattern);
            if (match) {
                console.log('[ClipShare] Found ID in URL:', match[1]);
                return match[1];
            }
        }

        // Method 4: Network requests (most recent first)
        try {
            const resources = performance.getEntriesByType('resource');
            for (let i = resources.length - 1; i >= 0; i--) {
                const name = resources[i].name;
                // Look for video/stream URLs with UUID
                if (name.includes('/videos/') || name.includes('/Video/') ||
                    name.includes('/stream') || name.includes('/Items/')) {
                    const match = name.match(/(?:videos|Video|Items)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (match) {
                        console.log('[ClipShare] Found ID from network request:', match[1]);
                        return match[1];
                    }
                }
            }
        } catch(e) {}

        // Method 5: Check global objects that might have current item
        // Try various global objects
        const globalObjects = [
            () => window.ApiClient?._currentItem?.Id,
            () => window.ApiClient?.currentItem?.Id,
            () => window.currentItem?.Id,
            () => window.currentPlayer?.currentItem?.Id,
            () => window.player?.currentItem?.Id,
            () => window.playbackManager?.getCurrentPlayer?.()?.currentItem?.Id,
            () => window.playbackManager?.getCurrentItem?.()?.Id,
        ];

        for (const getter of globalObjects) {
            try {
                const id = getter();
                if (id) {
                    console.log('[ClipShare] Found ID from global object:', id);
                    return id;
                }
            } catch(e) {}
        }

        // Method 6: Check all window properties for an object with Id
        try {
            for (const key of Object.keys(window)) {
                const val = window[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    // Check for currentItem with Id
                    if (val.currentItem?.Id && typeof val.currentItem.Id === 'string') {
                        console.log(`[ClipShare] Found ID in window.${key}.currentItem.Id:`, val.currentItem.Id);
                        return val.currentItem.Id;
                    }
                    // Check direct Id property
                    if (val.Id && typeof val.Id === 'string' && val.Id.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i)) {
                        // Skip server IDs
                        if (!val.Name || !val.ManualAddress) {
                            console.log(`[ClipShare] Found ID in window.${key}.Id:`, val.Id);
                            return val.Id;
                        }
                    }
                }
            }
        } catch(e) {}

        // Method 7: ApiClient - fetch current playing item via API
        // This is async so we'll return null here and rely on the event listener

        console.log('[ClipShare] Could not find video ID synchronously');
        return null;
    }

    /**
     * Try to get current playing item from Jellyfin API
     */
    async function fetchCurrentPlayingItem() {
        try {
            const apiKey = getApiKey();
            if (!apiKey) return null;

            // Try to get sessions - current user should have active session
            const response = await fetch('/Sessions', {
                headers: { 'X-Emby-Token': apiKey }
            });

            if (!response.ok) return null;

            const sessions = await response.json();
            const userId = window.ApiClient?._currentUser?.Id || window.ApiClient?._serverInfo?.UserId;

            // Find current user's session
            const currentSession = sessions.find(s =>
                s.UserId === userId ||
                s.UserName === window.ApiClient?._currentUser?.Name
            );

            if (currentSession?.NowPlayingItem?.Id) {
                console.log('[ClipShare] Found ID from Sessions API:', currentSession.NowPlayingItem.Id);
                return currentSession.NowPlayingItem.Id;
            }
        } catch (e) {
            console.log('[ClipShare] Could not fetch sessions:', e.message);
        }
        return null;
    }

    /**
     * Get media path via Jellyfin API
     */
    async function fetchMediaPath(itemId) {
        try {
            const apiKey = getApiKey();
            if (!apiKey) return null;

            console.log('[ClipShare] Fetching media path for:', itemId);

            const response = await fetch(`/Items?Ids=${itemId}&Fields=Path`, {
                headers: { 'X-Emby-Token': apiKey }
            });

            if (!response.ok) return null;

            const data = await response.json();
            if (data.Items?.[0]?.Path) {
                console.log('[ClipShare] Got media path:', data.Items[0].Path);
                return data.Items[0].Path;
            }
        } catch (e) {
            console.error('[ClipShare] Error fetching media path:', e);
        }
        return null;
    }

    /**
     * Check if we're on a video playback page
     */
    function isVideoPage() {
        const hash = window.location.hash || '';
        const url = window.location.href;

        // Check hash for video indicator
        if (hash.includes('video') || hash.includes('play')) return true;

        // Check URL
        if (url.includes('/video') || url.includes('/play') || url.includes('id=')) return true;

        // Check for video element with readyState > 0
        const video = document.querySelector('video');
        if (video && video.readyState >= 1) return true;

        // Check for player container
        if (document.querySelector('.videoPlayerContainer') ||
            document.querySelector('.htmlVideoPlayer')) return true;

        return false;
    }

    /**
     * Reset all state for new video
     */
    function resetForNewVideo() {
        console.log('[ClipShare] Resetting state for new video');
        startTime = null;
        endTime = null;
        isSelecting = false;
        currentMediaPath = null;
        hideOverlay();
        updateButtonState();
    }

    /**
     * Update button appearance
     */
    function updateButtonState() {
        if (!clipButton) return;

        if (startTime !== null && endTime === null) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">stop</span>';
            clipButton.style.color = '#ff9800';
            clipButton.title = 'Définir la fin';
        } else {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
            clipButton.style.color = '';
            clipButton.title = 'Créer un clip (C)';
        }
    }

    /**
     * Remove UI elements
     */
    function cleanupUI() {
        document.getElementById(CONFIG.buttonId)?.remove();
        document.getElementById(CONFIG.overlayId)?.remove();
        clipButton = null;
        selectionOverlay = null;
    }

    /**
     * Create clip button
     */
    function createClipButton() {
        console.log('[ClipShare] Creating button...');

        // Remove existing
        document.getElementById(CONFIG.buttonId)?.remove();

        const video = document.querySelector('video');
        if (!video) {
            console.log('[ClipShare] No video element');
            return false;
        }

        // Find controls container
        const selectors = [
            '.videoOsdBottom .buttonsFocusContainer',
            '.videoOsdBottom .flex',
            '.osdControls .buttonsFocusContainer',
            '.videoOsdBottom',
            '.osdControls'
        ];

        let container = null;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.offsetParent !== null) {
                container = el;
                break;
            }
        }

        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.type = 'button';
        clipButton.className = 'paper-icon-button-light';
        clipButton.innerHTML = '<span class="material-icons" style="font-size:1.4em">content_cut</span>';
        clipButton.title = 'Créer un clip (C)';

        clipButton.setAttribute('style', `
            background:transparent!important;
            color:inherit!important;
            border:none!important;
            padding:0!important;
            margin:0 0.3em!important;
            cursor:pointer!important;
            display:inline-flex!important;
            align-items:center!important;
            justify-content:center!important;
            width:2.8em!important;
            height:2.8em!important;
            border-radius:50%!important;
            outline:none!important;
        `);

        clipButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleSelectionMode();
        }, true);

        if (container) {
            const insertBefore = container.querySelector('.volumeSliderContainer') ||
                                container.querySelector('[class*="volume"]');
            container.insertBefore(clipButton, insertBefore);
            console.log('[ClipShare] Button added to controls');
            return true;
        }

        // Fallback
        const videoContainer = document.querySelector('.videoPlayerContainer') ||
                               video.parentElement?.parentElement;
        if (videoContainer) {
            clipButton.setAttribute('style', `
                position:absolute;
                bottom:90px;
                right:20px;
                z-index:99999;
                background:#00a4dc!important;
                color:white!important;
                border:none!important;
                padding:12px!important;
                border-radius:50%!important;
                cursor:pointer!important;
            `);
            videoContainer.appendChild(clipButton);
            console.log('[ClipShare] Button added as fallback');
            return true;
        }

        return false;
    }

    /**
     * Create overlay
     */
    function createSelectionOverlay() {
        if (document.getElementById(CONFIG.overlayId)) return;

        selectionOverlay = document.createElement('div');
        selectionOverlay.id = CONFIG.overlayId;
        selectionOverlay.style.cssText = `
            position:fixed;
            top:50%;
            left:50%;
            transform:translate(-50%,-50%);
            background:rgba(0,0,0,0.95);
            color:white;
            padding:24px;
            border-radius:12px;
            z-index:999999;
            display:none;
            font-family:sans-serif;
            min-width:300px;
            max-width:400px;
            box-shadow:0 8px 32px rgba(0,0,0,0.6);
        `;
        document.body.appendChild(selectionOverlay);
    }

    function updateOverlay(text, showActions = false) {
        if (!selectionOverlay) createSelectionOverlay();
        if (!selectionOverlay) return;

        let content = `<div style="margin-bottom:10px;line-height:1.6">${text}</div>`;

        if (showActions) {
            content += `
                <div style="margin-top:15px">
                    <label style="font-size:0.9em;display:block;margin-bottom:5px;color:#aaa">Expiration (heures):</label>
                    <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}"
                           style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#222;color:white;box-sizing:border-box">
                </div>
                <div style="margin-top:15px;display:flex;gap:10px">
                    <button id="clipshare-create" style="flex:1;padding:12px;background:#00a4dc;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">
                        ✂️ Créer
                    </button>
                    <button id="clipshare-cancel" style="flex:1;padding:12px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">
                        Annuler
                    </button>
                </div>
                <button id="clipshare-close" style="width:100%;margin-top:10px;padding:10px;background:#222;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer">
                    Fermer
                </button>
            `;
        } else {
            content += `
                <div style="margin-top:15px">
                    <button id="clipshare-close" style="width:100%;padding:10px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">
                        Fermer
                    </button>
                </div>
            `;
        }

        selectionOverlay.innerHTML = content;
        selectionOverlay.style.display = 'block';

        document.getElementById('clipshare-create')?.addEventListener('click', createClip);
        document.getElementById('clipshare-cancel')?.addEventListener('click', resetSelection);
        document.getElementById('clipshare-close')?.addEventListener('click', resetSelection);
    }

    function hideOverlay() {
        selectionOverlay && (selectionOverlay.style.display = 'none');
    }

    function toggleSelectionMode() {
        if (startTime !== null && endTime !== null) {
            showClipConfirmation();
        } else if (startTime !== null) {
            setEndTime();
        } else {
            startSelection();
        }
    }

    function startSelection() {
        const video = document.querySelector('video');
        if (!video) return alert('Aucune vidéo');

        startTime = video.currentTime;
        endTime = null;
        updateButtonState();

        updateOverlay(`
            <strong style="font-size:1.2em">🎬 Sélection</strong><br><br>
            Début: <span style="color:#00a4dc;font-weight:bold">${formatTime(startTime)}</span><br><br>
            <em style="font-size:0.9em;color:#aaa">
                Cliquez à nouveau pour définir la fin<br>
                ou appuyez sur <kbd style="background:#333;padding:2px 8px;border-radius:4px">C</kbd>
            </em>
        `);
    }

    function setEndTime() {
        const video = document.querySelector('video');
        if (!video) return;

        const end = video.currentTime;
        if (end <= startTime) {
            updateOverlay(`<strong style="color:#f44336">⚠️ Invalide</strong><br><br>La fin doit être après le début`);
            return setTimeout(startSelection, 2000);
        }

        endTime = end;
        showClipConfirmation();
    }

    function showClipConfirmation() {
        updateOverlay(`
            <strong style="font-size:1.2em">🎬 Clip prêt</strong><br><br>
            Début: <span style="color:#00a4dc;font-weight:bold">${formatTime(startTime)}</span><br>
            Fin: <span style="color:#00a4dc;font-weight:bold">${formatTime(endTime)}</span><br>
            Durée: <span style="color:#4caf50;font-weight:bold">${formatTime(endTime - startTime)}</span>
        `, true);
        updateButtonState();
    }

    async function createClip() {
        if (!startTime || !endTime) return;

        const expire = parseInt(document.getElementById('clipshare-expire')?.value) || CONFIG.defaultExpireHours;
        updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong>');

        try {
            // Try to get ID if we don't have it
            if (!currentItemId) {
                currentItemId = getCurrentVideoId();
                if (!currentItemId) {
                    currentItemId = await fetchCurrentPlayingItem();
                }
            }

            if (!currentItemId) {
                throw new Error('ID vidéo non trouvé');
            }

            let mediaPath = currentMediaPath || await fetchMediaPath(currentItemId);
            if (!mediaPath) {
                throw new Error('Chemin média non trouvé');
            }
            currentMediaPath = mediaPath;

            console.log('[ClipShare] Creating clip:', currentItemId, mediaPath);

            const resp = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: currentItemId,
                    mediaPath,
                    startSeconds: startTime,
                    endSeconds: endTime,
                    expireHours: expire
                })
            });

            if (!resp.ok) throw new Error(await resp.text());

            const data = await resp.json();
            showSuccess(data.url);
        } catch (err) {
            console.error('[ClipShare] Error:', err);
            showError(err.message);
        }
    }

    function showSuccess(url) {
        selectionOverlay.innerHTML = `
            <div style="text-align:center">
                <strong style="color:#4caf50;font-size:1.3em">✅ Clip créé !</strong><br><br>
                <input type="text" value="${url}" readonly id="clipshare-url"
                       style="width:100%;padding:12px;border-radius:6px;border:1px solid #444;background:#222;color:white;box-sizing:border-box;text-align:center">
                <div style="margin-top:15px">
                    <button id="clipshare-copy" style="width:100%;padding:12px;background:#00a4dc;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">
                        📋 Copier
                    </button>
                </div>
                <button id="clipshare-close-ok" style="width:100%;margin-top:10px;padding:10px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">
                    Fermer
                </button>
            </div>
        `;

        const urlInput = document.getElementById('clipshare-url');
        document.getElementById('clipshare-copy')?.addEventListener('click', function() {
            navigator.clipboard.writeText(url).then(() => {
                this.textContent = '✓ Copié !';
                this.style.background = '#4caf50';
            });
        });
        document.getElementById('clipshare-close-ok')?.addEventListener('click', resetSelection);
        if (urlInput) urlInput.onclick = function() { this.select(); };

        setTimeout(resetSelection, 20000);
    }

    function showError(msg) {
        selectionOverlay.innerHTML = `
            <div style="text-align:center">
                <strong style="color:#f44336;font-size:1.2em">❌ Erreur</strong><br><br>
                <span style="color:#ccc">${msg}</span><br><br>
                <button id="clipshare-close-err" style="padding:12px 24px;background:#444;color:white;border:none;border-radius:6px;cursor:pointer">
                    Fermer
                </button>
            </div>
        `;
        document.getElementById('clipshare-close-err')?.addEventListener('click', resetSelection);
    }

    function resetSelection() {
        startTime = endTime = null;
        hideOverlay();
        updateButtonState();
    }

    function formatTime(s) {
        if (!s || isNaN(s)) return '00:00';
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
    }

    function handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            toggleSelectionMode();
        }
        if (e.key === 'Escape') resetSelection();
    }

    /**
     * Main initialization
     */
    async function initUI() {
        console.log('[ClipShare] initUI attempt', ++initAttempts);

        const video = document.querySelector('video');
        if (!video) {
            console.log('[ClipShare] No video yet');
            return false;
        }

        // Try to get video ID
        let videoId = getCurrentVideoId();

        // If not found, try async methods
        if (!videoId) {
            videoId = await fetchCurrentPlayingItem();
        }

        console.log('[ClipShare] Video ID:', videoId);

        if (videoId && videoId !== currentItemId) {
            currentItemId = videoId;
            currentMediaPath = null;
            resetForNewVideo();
        }

        // Create button
        if (!document.getElementById(CONFIG.buttonId)) {
            createClipButton();
        }

        return true;
    }

    /**
     * Setup event listeners for Jellyfin events
     */
    function setupJellyfinEventListeners() {
        // Listen for playback events
        if (window.Events) {
            // Common Jellyfin events
            const events = ['playbackstart', 'playbackstop', 'itemplayed', 'playstatechange'];

            events.forEach(eventName => {
                try {
                    window.Events.on(null, eventName, function(e, data) {
                        console.log(`[ClipShare] Event: ${eventName}`, data);
                        if (data?.Item?.Id || data?.Id) {
                            const newId = data.Item?.Id || data.Id;
                            if (newId !== currentItemId) {
                                console.log('[ClipShare] New video from event:', newId);
                                currentItemId = newId;
                                currentMediaPath = null;
                                resetForNewVideo();
                            }
                        }
                    });
                } catch(err) {}
            });
        }

        // Hash change
        window.addEventListener('hashchange', () => {
            console.log('[ClipShare] Hash changed:', window.location.hash);
            currentItemId = null;
            currentMediaPath = null;
            cleanupUI();
            setTimeout(initUI, 500);
        });

        // Popstate
        window.addEventListener('popstate', () => {
            console.log('[ClipShare] Popstate');
            setTimeout(initUI, 500);
        });
    }

    /**
     * Main loop
     */
    function startMainLoop() {
        setInterval(async () => {
            const video = document.querySelector('video');

            // URL/hash change
            if (window.location.href !== lastUrl || window.location.hash !== lastHash) {
                console.log('[ClipShare] Navigation detected');
                lastUrl = window.location.href;
                lastHash = window.location.hash;
                currentItemId = null;
                currentMediaPath = null;
                cleanupUI();
            }

            // Video page detection
            if (video && isVideoPage()) {
                // Try to get ID if we don't have it
                if (!currentItemId) {
                    const id = getCurrentVideoId() || await fetchCurrentPlayingItem();
                    if (id) {
                        currentItemId = id;
                        console.log('[ClipShare] Got ID from loop:', id);
                    }
                }

                // Ensure button exists
                if (!document.getElementById(CONFIG.buttonId)) {
                    createClipButton();
                }
            }
        }, 1500);
    }

    /**
     * Initialize
     */
    function init() {
        console.log('[ClipShare] ====== INIT ======');

        document.addEventListener('keydown', handleKeyboard);

        setupJellyfinEventListeners();
        startMainLoop();

        // Initial attempts
        setTimeout(initUI, 100);
        setTimeout(initUI, 500);
        setTimeout(initUI, 1500);
        setTimeout(initUI, 3000);

        console.log('[ClipShare] Init complete');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose debug functions
    window.__clipshare_debug = debugVideoIdSources;
    window.__clipshare_init = initUI;
    window.__clipshare_getId = getCurrentVideoId;
    window.__clipshare_fetchId = fetchCurrentPlayingItem;

})();
