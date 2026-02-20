/**
 * ClipShare - Jellyfin Clip Creator Plugin
 * Allows creating video clips directly from the Jellyfin player.
 */
(function() {
    'use strict';

    if (window.__clipshare_loaded) return;
    window.__clipshare_loaded = true;

    console.log('[ClipShare] ====== LOADED v1.6 ======');

    // State - persisted across navigation
    let currentItemId = null;
    let currentMediaPath = null;
    let currentVideoName = null;
    let startTime = null;
    let endTime = null;
    let clipButton = null;
    let selectionOverlay = null;
    let lastHash = window.location.hash;
    let idFetchInProgress = false;
    let lastSuccessfulId = null;  // Backup ID

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
            // Try localStorage first
            const creds = localStorage.getItem('jellyfin_credentials');
            if (creds) {
                const parsed = JSON.parse(creds);
                if (parsed.Servers?.[0]?.AccessToken) {
                    console.log('[ClipShare] API key from localStorage');
                    return parsed.Servers[0].AccessToken;
                }
            }
            // Try ApiClient
            if (window.ApiClient?.accessToken) {
                console.log('[ClipShare] API key from ApiClient.accessToken');
                return window.ApiClient.accessToken;
            }
            if (window.ApiClient?._serverInfo?.AccessToken) {
                console.log('[ClipShare] API key from ApiClient._serverInfo');
                return window.ApiClient._serverInfo.AccessToken;
            }
        } catch (e) {
            console.error('[ClipShare] getApiKey error:', e);
        }
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
     * Get video ID from Sessions API (most reliable)
     */
    async function fetchCurrentPlayingItem() {
        if (idFetchInProgress) {
            console.log('[ClipShare] ID fetch already in progress, waiting...');
            await new Promise(r => setTimeout(r, 500));
        }
        
        idFetchInProgress = true;
        
        try {
            const apiKey = getApiKey();
            if (!apiKey) {
                console.log('[ClipShare] No API key for Sessions');
                return null;
            }

            console.log('[ClipShare] Fetching Sessions...');
            const resp = await fetch('/Sessions', { 
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });
            
            if (!resp.ok) {
                console.log('[ClipShare] Sessions response:', resp.status);
                return null;
            }

            const sessions = await resp.json();
            console.log('[ClipShare] Sessions:', sessions.length, 'sessions');

            const userId = getUserId();
            console.log('[ClipShare] Current userId:', userId);

            // Find session with NowPlayingItem - prioritize current user
            let bestMatch = null;
            
            for (const session of sessions) {
                if (session.NowPlayingItem) {
                    const rawId = session.NowPlayingItem.Id;
                    const id = formatGuid(rawId);
                    const name = session.NowPlayingItem.Name || 'Unknown';
                    
                    console.log('[ClipShare] Session has NowPlayingItem:', name, 'ID:', id, 
                                'UserId match:', session.UserId === userId);
                    
                    // Prioritize current user's session
                    if (session.UserId === userId || !bestMatch) {
                        bestMatch = { id, name, session };
                    }
                }
            }

            if (bestMatch) {
                console.log('[ClipShare] Best match:', bestMatch.name, bestMatch.id);
                return bestMatch;
            }

            console.log('[ClipShare] No NowPlayingItem found in sessions');
        } catch (e) {
            console.error('[ClipShare] Sessions API error:', e);
        } finally {
            idFetchInProgress = false;
        }
        return null;
    }

    /**
     * Get video ID synchronously (fallbacks)
     */
    function getCurrentVideoIdSync() {
        // URL patterns - try multiple formats
        const url = window.location.href;
        const hash = window.location.hash;
        
        console.log('[ClipShare] Checking URL for ID:', url);
        console.log('[ClipShare] Hash:', hash);
        
        // Pattern 1: Query parameter
        let match = url.match(/[?&]id=([a-f0-9-]+)/i);
        if (match) {
            console.log('[ClipShare] Found ID in query param:', match[1]);
            return formatGuid(match[1]);
        }
        
        // Pattern 2: Hash-based URL like #/video?id=xxx
        match = hash.match(/id=([a-f0-9-]+)/i);
        if (match) {
            console.log('[ClipShare] Found ID in hash:', match[1]);
            return formatGuid(match[1]);
        }
        
        // Pattern 3: /video/ID or /items/ID in hash
        match = hash.match(/\/(video|items)\/([a-f0-9-]+)/i);
        if (match) {
            console.log('[ClipShare] Found ID in hash path:', match[2]);
            return formatGuid(match[2]);
        }

        // Pattern 4: Network requests - look for video stream URLs
        try {
            const resources = performance.getEntriesByType('resource');
            for (let i = resources.length - 1; i >= 0; i--) {
                const name = resources[i].name;
                // Match video stream URLs
                const m = name.match(/\/videos\/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})/i);
                if (m) {
                    console.log('[ClipShare] Found ID in network resource:', m[1]);
                    return formatGuid(m[1]);
                }
            }
        } catch (e) {}

        console.log('[ClipShare] No ID found sync');
        return null;
    }

    /**
     * Get media path from server
     */
    async function fetchMediaPath(itemId) {
        try {
            const apiKey = getApiKey();
            if (!apiKey || !itemId) return null;

            console.log('[ClipShare] Fetching item info for:', itemId);
            const resp = await fetch(`/Items?Ids=${itemId}&Fields=Path,Name`, {
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });
            
            if (!resp.ok) {
                console.log('[ClipShare] Items response:', resp.status);
                return null;
            }

            const data = await resp.json();
            console.log('[ClipShare] Items response:', data);
            
            if (data.Items?.[0]) {
                const item = data.Items[0];
                if (item.Path) {
                    console.log('[ClipShare] Media path:', item.Path);
                    currentVideoName = item.Name;
                    return item.Path;
                }
            }
        } catch (e) {
            console.error('[ClipShare] fetchMediaPath error:', e);
        }
        return null;
    }

    /**
     * Store ID persistently
     */
    function storeVideoInfo(id, path, name) {
        try {
            const info = { id, path, name, timestamp: Date.now() };
            sessionStorage.setItem('clipshare_current_video', JSON.stringify(info));
            lastSuccessfulId = id;
            console.log('[ClipShare] Stored video info:', info);
        } catch (e) {}
    }

    /**
     * Retrieve stored video info
     */
    function getStoredVideoInfo() {
        try {
            const stored = sessionStorage.getItem('clipshare_current_video');
            if (stored) {
                const info = JSON.parse(stored);
                // Valid for 30 minutes
                if (Date.now() - info.timestamp < 30 * 60 * 1000) {
                    return info;
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * Check if video page
     */
    function isVideoPage() {
        const hash = window.location.hash || '';
        if (hash.includes('video') || hash.includes('play')) return true;
        if (document.querySelector('video')?.readyState >= 1) return true;
        if (document.querySelector('.videoPlayerContainer, .htmlVideoPlayer')) return true;
        return false;
    }

    function resetForNewVideo() {
        startTime = endTime = null;
        currentMediaPath = null;
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

        // Fallback
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
        if (!startTime || !endTime) return;
        const expire = parseInt(document.getElementById('clipshare-expire')?.value) || CONFIG.defaultExpireHours;
        updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Recherche de la vidéo...');

        try {
            console.log('[ClipShare] ========== CREATE CLIP ==========');
            console.log('[ClipShare] currentItemId:', currentItemId);
            console.log('[ClipShare] lastSuccessfulId:', lastSuccessfulId);

            // Try to get ID from multiple sources
            let id = null;
            let mediaPath = null;

            // 1. Try stored info first (most reliable if we captured it during playback)
            const stored = getStoredVideoInfo();
            if (stored?.id) {
                console.log('[ClipShare] Using stored ID:', stored.id);
                id = stored.id;
                mediaPath = stored.path;
            }

            // 2. Try currentItemId
            if (!id && currentItemId) {
                console.log('[ClipShare] Using currentItemId:', currentItemId);
                id = currentItemId;
            }

            // 3. Try sync detection
            if (!id) {
                id = getCurrentVideoIdSync();
                if (id) console.log('[ClipShare] Found ID via sync:', id);
            }

            // 4. Try Sessions API
            if (!id) {
                updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Recherche via Sessions API...');
                const result = await fetchCurrentPlayingItem();
                if (result) {
                    id = result.id;
                    console.log('[ClipShare] Found ID via Sessions:', id);
                }
            }

            if (!id) {
                throw new Error('Impossible de trouver l\'ID vidéo. Essayez de rafraîchir la page et de lancer la vidéo à nouveau.');
            }

            currentItemId = id;
            console.log('[ClipShare] Final ID:', currentItemId);

            // Get media path if not already known
            if (!mediaPath) {
                updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Récupération du chemin...');
                mediaPath = await fetchMediaPath(currentItemId);
            }

            if (!mediaPath) {
                throw new Error('Impossible de trouver le chemin du fichier média. Vérifiez que vous avez les permissions nécessaires.');
            }
            
            currentMediaPath = mediaPath;
            console.log('[ClipShare] Media path:', currentMediaPath);

            // Store for future use
            storeVideoInfo(currentItemId, currentMediaPath, currentVideoName);

            updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong><br><br>Génération du clip en cours...');

            // Send request
            const requestBody = {
                itemId: currentItemId,
                mediaPath: currentMediaPath,
                startSeconds: startTime,
                endSeconds: endTime,
                expireHours: expire
            };
            
            console.log('[ClipShare] Sending request:', requestBody);

            const resp = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            console.log('[ClipShare] Response status:', resp.status);

            const responseText = await resp.text();
            console.log('[ClipShare] Response body:', responseText);

            if (!resp.ok) {
                throw new Error(responseText || 'Erreur serveur');
            }

            const data = JSON.parse(responseText);
            console.log('[ClipShare] Success:', data);
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
        setTimeout(resetSelection, 20000);
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
     * Update video info proactively
     */
    async function updateVideoInfo() {
        const video = document.querySelector('video');
        if (!video) return;

        // Try to get ID
        let id = getCurrentVideoIdSync();
        let result = null;
        
        if (!id) {
            result = await fetchCurrentPlayingItem();
            if (result) id = result.id;
        }

        if (id && id !== currentItemId) {
            console.log('[ClipShare] Updated video ID:', id);
            currentItemId = id;
            
            // Get path and store
            const path = await fetchMediaPath(id);
            if (path) {
                currentMediaPath = path;
                storeVideoInfo(id, path, currentVideoName);
            }
            
            resetForNewVideo();
        }
    }

    /**
     * Main initialization
     */
    async function initUI() {
        console.log('[ClipShare] initUI');

        const video = document.querySelector('video');
        if (!video) return;

        // Update video info
        await updateVideoInfo();

        if (!document.getElementById(CONFIG.buttonId)) {
            createClipButton();
        }
    }

    /**
     * Main loop
     */
    async function mainLoop() {
        // Hash change detection
        if (window.location.hash !== lastHash) {
            console.log('[ClipShare] Hash changed from', lastHash, 'to', window.location.hash);
            lastHash = window.location.hash;
            // Don't reset ID on hash change - keep the stored one
            document.getElementById(CONFIG.buttonId)?.remove();
        }

        // Video page check
        const video = document.querySelector('video');
        if (video && isVideoPage()) {
            // Periodically update video info
            if (!currentItemId && !idFetchInProgress) {
                await updateVideoInfo();
            }
            if (!document.getElementById(CONFIG.buttonId)) {
                createClipButton();
            }
        }
    }

    function init() {
        console.log('[ClipShare] ====== INIT ======');
        document.addEventListener('keydown', handleKeyboard);
        setInterval(mainLoop, 1500);
        setTimeout(initUI, 100);
        setTimeout(initUI, 1000);
        setTimeout(initUI, 3000);
        
        window.addEventListener('hashchange', () => {
            // Don't reset ID, just reinit UI
            setTimeout(initUI, 500);
        });
        
        // Listen for video events
        document.addEventListener('play', () => {
            console.log('[ClipShare] Video play event');
            setTimeout(updateVideoInfo, 500);
        }, true);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Debug helpers
    window.__clipshare_init = initUI;
    window.__clipshare_getId = () => currentItemId;
    window.__clipshare_getPath = () => currentMediaPath;
    window.__clipshare_fetchId = fetchCurrentPlayingItem;
    window.__clipshare_debug = () => ({
        currentItemId,
        currentMediaPath,
        currentVideoName,
        startTime,
        endTime,
        lastSuccessfulId,
        storedInfo: getStoredVideoInfo()
    });

})();
