/**
 * ClipShare - Jellyfin Clip Creator Plugin
 * Allows creating video clips directly from the Jellyfin player.
 */
(function() {
    'use strict';

    if (window.__clipshare_loaded) return;
    window.__clipshare_loaded = true;

    console.log('[ClipShare] ====== LOADED v1.8 ======');

    // State
    let currentItemId = null;
    let currentMediaPath = null;
    let currentVideoName = null;
    let startTime = null;
    let endTime = null;
    let clipButton = null;
    let selectionOverlay = null;
    let lastVideoSrc = null;
    let isFetchingId = false;

    const CONFIG = { defaultExpireHours: 72, buttonId: 'clipshare-btn', overlayId: 'clipshare-overlay' };

    /**
     * Format GUID with dashes if missing
     */
    function formatGuid(id) {
        if (!id) return null;
        id = String(id).replace(/[-\s]/g, '');
        if (!/^[a-f0-9]{32}$/i.test(id)) return id;
        return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20,32)}`;
    }

    /**
     * Get API key from various sources
     */
    function getApiKey() {
        try {
            const creds = localStorage.getItem('jellyfin_credentials');
            if (creds) {
                const parsed = JSON.parse(creds);
                if (parsed.Servers?.[0]?.AccessToken) return parsed.Servers[0].AccessToken;
            }
            if (window.ApiClient?.accessToken) return window.ApiClient.accessToken;
            if (window.ApiClient?._serverInfo?.AccessToken) return window.ApiClient._serverInfo.AccessToken;
        } catch (e) {}
        return null;
    }

    /**
     * Get current user ID
     */
    function getUserId() {
        try {
            const creds = localStorage.getItem('jellyfin_credentials');
            if (creds) {
                const parsed = JSON.parse(creds);
                if (parsed.Servers?.[0]?.UserId) return parsed.Servers[0].UserId;
            }
            if (window.ApiClient?._currentUser?.Id) return window.ApiClient._currentUser.Id;
            if (window.ApiClient?._serverInfo?.UserId) return window.ApiClient._serverInfo.UserId;
        } catch (e) {}
        return null;
    }

    /**
     * Get video ID from Sessions API
     */
    async function fetchCurrentPlayingItem() {
        if (isFetchingId) return null;
        isFetchingId = true;

        try {
            const apiKey = getApiKey();
            if (!apiKey) return null;

            console.log('[ClipShare] Fetching Sessions API...');
            const resp = await fetch('/Sessions', {
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });

            if (!resp.ok) return null;

            const sessions = await resp.json();
            const userId = getUserId();

            // Find session with NowPlayingItem
            let bestMatch = null;
            for (const session of sessions) {
                if (session.NowPlayingItem) {
                    const id = formatGuid(session.NowPlayingItem.Id);
                    const name = session.NowPlayingItem.Name || 'Unknown';
                    console.log('[ClipShare] Session:', name, id, 'UserId match:', session.UserId === userId);

                    if (session.UserId === userId || !bestMatch) {
                        bestMatch = { id, name };
                    }
                }
            }

            return bestMatch;
        } catch (e) {
            console.error('[ClipShare] fetchCurrentPlayingItem error:', e);
        } finally {
            isFetchingId = false;
        }
        return null;
    }

    /**
     * Get video ID from URL - improved detection
     */
    function getIdFromUrl() {
        const url = window.location.href;
        const hash = window.location.hash;

        // Try various patterns with both dashed and non-dashed IDs
        const patterns = [
            /[?&]id=([a-f0-9-]+)/i,
            /id=([a-f0-9-]+)/i,
            /\/video\/([a-f0-9-]+)/i,
            /\/items\/([a-f0-9-]+)/i
        ];

        for (const p of patterns) {
            const m = (url.match(p) || hash.match(p));
            if (m) {
                console.log('[ClipShare] Found ID in URL/hash:', m[1]);
                return formatGuid(m[1]);
            }
        }

        return null;
    }

    /**
     * Get video ID from network resources (streaming URLs)
     */
    function getIdFromNetwork() {
        try {
            const resources = performance.getEntriesByType('resource');
            // Look for video streaming URLs - most recent first
            for (let i = resources.length - 1; i >= 0; i--) {
                const name = resources[i].name;
                // Match /videos/ID/ pattern - ID can be with or without dashes
                const m = name.match(/\/videos\/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})(?:\/|$)/i);
                if (m) {
                    console.log('[ClipShare] Found ID in network resource:', m[1], 'from', name);
                    return formatGuid(m[1]);
                }
                // Also try without strict pattern (32 hex chars)
                const m2 = name.match(/\/videos\/([a-f0-9]{32})(?:\/|$)/i);
                if (m2) {
                    console.log('[ClipShare] Found ID (no dashes) in network resource:', m2[1]);
                    return formatGuid(m2[1]);
                }
            }
        } catch (e) {
            console.error('[ClipShare] getIdFromNetwork error:', e);
        }
        return null;
    }

    /**
     * Get media path from server
     */
    async function fetchMediaPath(itemId) {
        try {
            const apiKey = getApiKey();
            if (!apiKey || !itemId) return null;

            const resp = await fetch(`/Items?Ids=${itemId}&Fields=Path,Name`, {
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });

            if (!resp.ok) return null;

            const data = await resp.json();
            if (data.Items?.[0]?.Path) {
                currentVideoName = data.Items[0].Name;
                return data.Items[0].Path;
            }
        } catch (e) {
            console.error('[ClipShare] fetchMediaPath error:', e);
        }
        return null;
    }

    /**
     * Store video info in session
     */
    function storeVideoInfo(id, path, name) {
        try {
            sessionStorage.setItem('clipshare_current_video', JSON.stringify({
                id, path, name, timestamp: Date.now()
            }));
        } catch (e) {}
    }

    /**
     * Get stored video info
     */
    function getStoredVideoInfo() {
        try {
            const stored = sessionStorage.getItem('clipshare_current_video');
            if (stored) {
                const info = JSON.parse(stored);
                if (Date.now() - info.timestamp < 30 * 60 * 1000) return info;
            }
        } catch (e) {}
        return null;
    }

    /**
     * Clear stored video info
     */
    function clearStoredVideoInfo() {
        try {
            sessionStorage.removeItem('clipshare_current_video');
        } catch (e) {}
    }

    /**
     * Check if on video page
     */
    function isVideoPage() {
        const hash = window.location.hash || '';
        return hash.includes('video') || hash.includes('play') || document.querySelector('video')?.readyState >= 1;
    }

    /**
     * Update video info - call this when video changes
     */
    async function updateVideoInfo(force = false) {
        if (isFetchingId && !force) return;

        console.log('[ClipShare] updateVideoInfo called, force=', force);

        // Priority 1: Network resources (most reliable for streaming)
        let id = getIdFromNetwork();

        // Priority 2: URL hash
        if (!id) {
            id = getIdFromUrl();
        }

        // Priority 3: Sessions API
        if (!id) {
            const result = await fetchCurrentPlayingItem();
            if (result) id = result.id;
        }

        if (id && (id !== currentItemId || force)) {
            console.log('[ClipShare] New video detected! ID:', id, '(was:', currentItemId + ')');

            currentItemId = id;
            currentMediaPath = null;
            startTime = null;
            endTime = null;
            hideOverlay();
            updateButtonState();

            // Fetch path
            const path = await fetchMediaPath(id);
            if (path) {
                currentMediaPath = path;
                storeVideoInfo(id, path, currentVideoName);
                console.log('[ClipShare] Video info updated:', currentVideoName, currentItemId, currentMediaPath);
            }
        }

        return id;
    }

    /**
     * Check if video element changed (new video src)
     */
    function checkVideoChange() {
        const video = document.querySelector('video');
        if (!video) return false;

        const src = video.currentSrc || video.src;
        if (src && src !== lastVideoSrc) {
            console.log('[ClipShare] Video src changed:', lastVideoSrc, '->', src);
            lastVideoSrc = src;
            currentItemId = null;
            currentMediaPath = null;
            clearStoredVideoInfo();
            return true;
        }
        return false;
    }

    function resetForNewVideo() {
        startTime = endTime = null;
        hideOverlay();
        updateButtonState();
    }

    function updateButtonState() {
        if (!clipButton) return;
        if (startTime !== null && endTime === null) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size:1.4em">stop</span>';
            clipButton.style.color = '#ff9800';
        } else {
            clipButton.innerHTML = '<span class="material-icons" style="font-size:1.4em">content_cut</span>';
            clipButton.style.color = '';
        }
    }

    function createClipButton() {
        document.getElementById(CONFIG.buttonId)?.remove();

        const video = document.querySelector('video');
        if (!video) return false;

        const selectors = [
            '.videoOsdBottom .buttonsFocusContainer',
            '.videoOsdBottom .flex',
            '.osdControls .buttonsFocusContainer',
            '.videoOsdBottom', '.osdControls'
        ];
        let container = null;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.offsetParent) { container = el; break; }
        }

        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.type = 'button';
        clipButton.className = 'paper-icon-button-light';
        clipButton.innerHTML = '<span class="material-icons" style="font-size:1.4em">content_cut</span>';
        clipButton.title = 'Créer un clip (C)';
        clipButton.style.cssText = 'background:transparent!important;color:inherit!important;border:none!important;padding:0!important;margin:0 0.3em!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:2.8em!important;height:2.8em!important;border-radius:50%!important;outline:none!important;';

        clipButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleSelectionMode(); }, true);

        if (container) {
            const insertBefore = container.querySelector('.volumeSliderContainer, [class*="volume"]');
            container.insertBefore(clipButton, insertBefore);
            console.log('[ClipShare] Button created in controls');
            return true;
        }

        const vc = document.querySelector('.videoPlayerContainer') || video.parentElement?.parentElement;
        if (vc) {
            clipButton.style.cssText = 'position:absolute;bottom:90px;right:20px;z-index:99999;background:#00a4dc!important;color:white!important;border:none!important;padding:12px!important;border-radius:50%!important;cursor:pointer!important;';
            vc.appendChild(clipButton);
            console.log('[ClipShare] Button created (fallback)');
            return true;
        }
        return false;
    }

    function createOverlay() {
        if (document.getElementById(CONFIG.overlayId)) return;
        selectionOverlay = document.createElement('div');
        selectionOverlay.id = CONFIG.overlayId;
        selectionOverlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.95);color:white;padding:24px;border-radius:12px;z-index:999999;display:none;font-family:sans-serif;min-width:300px;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
        document.body.appendChild(selectionOverlay);
    }

    function updateOverlay(text, showActions = false) {
        if (!selectionOverlay) createOverlay();
        let c = `<div style="margin-bottom:10px;line-height:1.6">${text}</div>`;
        if (showActions) {
            c += `<div style="margin-top:15px"><label style="font-size:0.9em;color:#aaa">Expiration (heures):</label>
                  <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}" style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#222;color:white;box-sizing:border-box;margin-top:5px"></div>
                  <div style="margin-top:15px;display:flex;gap:10px">
                  <button id="clipshare-create" style="flex:1;padding:12px;background:#00a4dc;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">✂️ Créer</button>
                  <button id="clipshare-cancel" style="flex:1;padding:12px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">Annuler</button></div>
                  <button id="clipshare-close" style="width:100%;margin-top:10px;padding:10px;background:#222;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer">Fermer</button>`;
        } else {
            c += `<div style="margin-top:15px"><button id="clipshare-close" style="width:100%;padding:10px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">Fermer</button></div>`;
        }
        selectionOverlay.innerHTML = c;
        selectionOverlay.style.display = 'block';
        document.getElementById('clipshare-create')?.addEventListener('click', createClip);
        document.getElementById('clipshare-cancel')?.addEventListener('click', resetSelection);
        document.getElementById('clipshare-close')?.addEventListener('click', resetSelection);
    }

    function hideOverlay() { selectionOverlay && (selectionOverlay.style.display = 'none'); }

    function toggleSelectionMode() {
        if (startTime !== null && endTime !== null) showClipConfirmation();
        else if (startTime !== null) setEndTime();
        else startSelection();
    }

    function startSelection() {
        const video = document.querySelector('video');
        if (!video) return alert('Aucune vidéo');
        startTime = video.currentTime;
        endTime = null;
        updateButtonState();
        updateOverlay(`<strong style="font-size:1.2em">🎬 Sélection</strong><br><br>Début: <span style="color:#00a4dc;font-weight:bold">${formatTime(startTime)}</span><br><br><em style="font-size:0.9em;color:#aaa">Cliquez à nouveau pour définir la fin</em>`);
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
        updateOverlay(`<strong style="font-size:1.2em">🎬 Clip prêt</strong><br><br>Début: <span style="color:#00a4dc;font-weight:bold">${formatTime(startTime)}</span><br>Fin: <span style="color:#00a4dc;font-weight:bold">${formatTime(endTime)}</span><br>Durée: <span style="color:#4caf50;font-weight:bold">${formatTime(endTime - startTime)}</span>`, true);
        updateButtonState();
    }

    async function createClip() {
        if (startTime === null || endTime === null) return;

        // Ensure times are valid numbers
        const startSec = parseFloat(startTime);
        const endSec = parseFloat(endTime);
        const expire = parseInt(document.getElementById('clipshare-expire')?.value) || CONFIG.defaultExpireHours;

        if (isNaN(startSec) || isNaN(endSec)) {
            showError('Temps de clip invalides');
            return;
        }

        updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Récupération des infos vidéo...');

        try {
            console.log('[ClipShare] ========== CREATE CLIP ==========');

            // Force refresh video info before creating clip
            await updateVideoInfo(true);

            let id = currentItemId;
            let mediaPath = currentMediaPath;

            // Fallback to stored info
            if (!id || !mediaPath) {
                const stored = getStoredVideoInfo();
                if (stored) {
                    if (!id) id = stored.id;
                    if (!mediaPath) mediaPath = stored.path;
                }
            }

            // Last resort: fetch from network/Sessions
            if (!id) {
                id = getIdFromNetwork();
            }
            if (!id) {
                const result = await fetchCurrentPlayingItem();
                if (result) id = result.id;
            }

            if (!id) {
                throw new Error('Impossible de trouver l\'ID vidéo. Rafraîchissez la page.');
            }

            if (!mediaPath) {
                mediaPath = await fetchMediaPath(id);
            }

            if (!mediaPath) {
                throw new Error('Impossible de trouver le chemin du fichier.');
            }

            currentItemId = id;
            currentMediaPath = mediaPath;
            storeVideoInfo(id, mediaPath, currentVideoName);

            console.log('[ClipShare] Creating clip for:', currentVideoName);
            console.log('[ClipShare] ID:', id);
            console.log('[ClipShare] Path:', mediaPath);
            console.log('[ClipShare] Start:', startSec, 'End:', endSec);

            updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Génération du clip...');

            const requestBody = {
                itemId: id,
                mediaPath: mediaPath,
                startSeconds: startSec,
                endSeconds: endSec,
                expireHours: expire
            };

            console.log('[ClipShare] Request body:', JSON.stringify(requestBody));

            const resp = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const responseText = await resp.text();
            console.log('[ClipShare] Response:', resp.status, responseText);

            if (!resp.ok) {
                throw new Error(responseText || 'Erreur serveur');
            }

            const data = JSON.parse(responseText);
            showSuccess(data.url);
        } catch (err) {
            console.error('[ClipShare] createClip error:', err);
            showError(err.message);
        }
    }

    function showSuccess(url) {
        selectionOverlay.innerHTML = `<div style="text-align:center"><strong style="color:#4caf50;font-size:1.3em">✅ Clip créé !</strong><br><br><input type="text" value="${url}" readonly id="clipshare-url" style="width:100%;padding:12px;border-radius:6px;border:1px solid #444;background:#222;color:white;box-sizing:border-box;text-align:center"><div style="margin-top:15px"><button id="clipshare-copy" style="width:100%;padding:12px;background:#00a4dc;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">📋 Copier</button></div><button id="clipshare-close-ok" style="width:100%;margin-top:10px;padding:10px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">Fermer</button></div>`;
        document.getElementById('clipshare-copy')?.addEventListener('click', function() {
            navigator.clipboard.writeText(url).then(() => { this.textContent = '✓ Copié!'; this.style.background = '#4caf50'; });
        });
        document.getElementById('clipshare-close-ok')?.addEventListener('click', resetSelection);
        document.getElementById('clipshare-url').onclick = function() { this.select(); };
    }

    function showError(msg) {
        selectionOverlay.innerHTML = `<div style="text-align:center"><strong style="color:#f44336;font-size:1.2em">❌ Erreur</strong><br><br><span style="color:#ccc">${msg}</span><br><br><button id="clipshare-close-err" style="padding:12px 24px;background:#444;color:white;border:none;border-radius:6px;cursor:pointer">Fermer</button></div>`;
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
        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleSelectionMode(); }
        if (e.key === 'Escape') resetSelection();
    }

    /**
     * Main loop - check for video changes
     */
    async function mainLoop() {
        // Check if video src changed
        const videoChanged = checkVideoChange();

        // Check if on video page
        if (isVideoPage()) {
            // If video changed or no ID, fetch new ID
            if (videoChanged || !currentItemId) {
                console.log('[ClipShare] Video changed or no ID, fetching...');
                await updateVideoInfo();
            }

            // Ensure button exists
            if (!document.getElementById(CONFIG.buttonId)) {
                createClipButton();
            }
        }
    }

    /**
     * Setup video event listeners
     */
    function setupVideoListeners() {
        // Listen for video events on document (event delegation)
        document.addEventListener('play', async (e) => {
            if (e.target.tagName === 'VIDEO') {
                console.log('[ClipShare] Video play event');
                currentItemId = null;
                currentMediaPath = null;
                lastVideoSrc = null;
                clearStoredVideoInfo();
                // Small delay to let network resources populate
                setTimeout(() => updateVideoInfo(), 500);
            }
        }, true);

        document.addEventListener('loadedmetadata', async (e) => {
            if (e.target.tagName === 'VIDEO') {
                console.log('[ClipShare] Video loadedmetadata event');
                if (!currentItemId) {
                    await updateVideoInfo();
                }
            }
        }, true);

        // Hash change
        window.addEventListener('hashchange', async () => {
            console.log('[ClipShare] Hash changed to:', window.location.hash);
            currentItemId = null;
            currentMediaPath = null;
            lastVideoSrc = null;
            clearStoredVideoInfo();
            document.getElementById(CONFIG.buttonId)?.remove();
            setTimeout(async () => {
                await updateVideoInfo();
            }, 500);
        });
    }

    function init() {
        console.log('[ClipShare] ====== INIT v1.8 ======');
        document.addEventListener('keydown', handleKeyboard);

        // Setup video change detection
        setupVideoListeners();

        // Main loop - more frequent for better detection
        setInterval(mainLoop, 1500);

        // Initial setup with delays to wait for player
        setTimeout(() => { updateVideoInfo(); createClipButton(); }, 500);
        setTimeout(() => { updateVideoInfo(); createClipButton(); }, 2000);
        setTimeout(() => { updateVideoInfo(); createClipButton(); }, 5000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Debug helpers
    window.__clipshare_init = () => { updateVideoInfo(); createClipButton(); };
    window.__clipshare_getId = () => currentItemId;
    window.__clipshare_getPath = () => currentMediaPath;
    window.__clipshare_getName = () => currentVideoName;
    window.__clipshare_fetchId = fetchCurrentPlayingItem;
    window.__clipshare_update = () => updateVideoInfo(true);
    window.__clipshare_getNetworkId = getIdFromNetwork;
    window.__clipshare_debug = () => ({
        currentItemId,
        currentMediaPath,
        currentVideoName,
        startTime,
        endTime,
        lastVideoSrc,
        storedInfo: getStoredVideoInfo()
    });

})();
