/**
 * ClipShare - Jellyfin Clip Creator Plugin v2.3
 * Client fetches media path via Jellyfin API (bypasses ILibraryManager DI issues)
 */
(function() {
    'use strict';

    if (window.__clipshare_loaded) return;
    window.__clipshare_loaded = true;

    console.log('[ClipShare] ====== LOADED v2.4.2 ======');

    let currentItemId = null;
    let currentMediaPath = null;
    let startTime = null;
    let endTime = null;
    let clipButton = null;
    let selectionOverlay = null;

    const CONFIG = { defaultExpireHours: 72, buttonId: 'clipshare-btn', overlayId: 'clipshare-overlay' };

    function formatGuid(id) {
        if (!id) return null;
        id = String(id).replace(/[-\s]/g, '');
        if (!/^[a-f0-9]{32}$/i.test(id)) return id;
        return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20,32)}`;
    }

    function getApiKey() {
        try {
            const creds = localStorage.getItem('jellyfin_credentials');
            if (creds) {
                const parsed = JSON.parse(creds);
                if (parsed.Servers?.[0]?.AccessToken) return parsed.Servers[0].AccessToken;
            }
            return window.ApiClient?.accessToken || window.ApiClient?._serverInfo?.AccessToken;
        } catch (e) { return null; }
    }

    function getUserId() {
        try {
            const creds = localStorage.getItem('jellyfin_credentials');
            if (creds) {
                const parsed = JSON.parse(creds);
                if (parsed.Servers?.[0]?.UserId) return parsed.Servers[0].UserId;
            }
            return window.ApiClient?._currentUser?.Id || window.ApiClient?._serverInfo?.UserId;
        } catch (e) { return null; }
    }

    async function fetchMediaPath(itemId) {
        try {
            const apiKey = getApiKey();
            const userId = getUserId();
            if (!apiKey || !userId) return null;

            const resp = await fetch(`/Users/${userId}/Items/${itemId}`, {
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });

            if (!resp.ok) return null;

            const item = await resp.json();
            console.log('[ClipShare] Item info:', item.Name, item.Path);
            return item.Path || null;
        } catch (e) {
            console.error('[ClipShare] Error fetching media path:', e);
            return null;
        }
    }

    async function getCurrentPlayingId() {
        try {
            const apiKey = getApiKey();
            if (!apiKey) return null;

            const resp = await fetch('/Sessions', {
                headers: { 'X-Emby-Token': apiKey },
                credentials: 'include'
            });

            if (!resp.ok) return null;

            const sessions = await resp.json();
            const userId = getUserId();

            for (const session of sessions) {
                if (session.NowPlayingItem) {
                    if (session.UserId === userId || !userId) {
                        const id = formatGuid(session.NowPlayingItem.Id);
                        console.log('[ClipShare] Sessions API found:', session.NowPlayingItem.Name, id);
                        return id;
                    }
                }
            }
        } catch (e) { console.error('[ClipShare] Sessions error:', e); }
        return null;
    }

    function getIdFromNetwork() {
        try {
            const resources = performance.getEntriesByType('resource');
            for (let i = resources.length - 1; i >= 0; i--) {
                const name = resources[i].name;
                let m = name.match(/\/videos\/([a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12})(?:\/|$)/i);
                if (m) return formatGuid(m[1]);
                m = name.match(/\/videos\/([a-f0-9]{32})(?:\/|$)/i);
                if (m) return formatGuid(m[1]);
            }
        } catch (e) {}
        return null;
    }

    async function updateCurrentItemId() {
        let id = getIdFromNetwork();
        if (!id) id = await getCurrentPlayingId();
        if (id && id !== currentItemId) {
            currentItemId = id;
            currentMediaPath = null; // Reset path when ID changes
            console.log('[ClipShare] Updated ID:', id);
        }
        return currentItemId;
    }

    function isVideoPage() {
        const hash = window.location.hash || '';
        return hash.includes('video') || hash.includes('play') || !!document.querySelector('video');
    }

    function updateButtonState() {
        if (!clipButton) return;
        clipButton.innerHTML = startTime !== null && endTime === null
            ? '<span class="material-icons" style="font-size:1.4em">stop</span>'
            : '<span class="material-icons" style="font-size:1.4em">content_cut</span>';
        clipButton.style.color = startTime !== null && endTime === null ? '#ff9800' : '';
    }

    function createClipButton() {
        document.getElementById(CONFIG.buttonId)?.remove();
        const video = document.querySelector('video');
        if (!video) return false;

        // Try multiple selectors for different Jellyfin versions/layouts
        const selectors = [
            '.videoOsdBottom .buttonsFocusContainer',
            '.videoOsdBottom .flex',
            '.osdControls .buttonsFocusContainer',
            '.videoOsdBottom',
            '.osdControls',
            '.buttonsFocusContainer',
            '.videoOsdBottom .btnPause',
            '.videoOsdBottom .btnFastForward'
        ];
        let container = null;
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.offsetParent) {
                container = el;
                console.log('[ClipShare] Found container:', sel);
                break;
            }
        }

        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.type = 'button';
        clipButton.className = 'paper-icon-button-light';
        clipButton.innerHTML = '<span class="material-icons" style="font-size:1.4em">content_cut</span>';
        clipButton.title = 'Créer un clip (C)';
        
        // Make sure button is always clickable
        const baseStyle = 'background:transparent!important;color:inherit!important;border:none!important;padding:0!important;margin:0 0.3em!important;cursor:pointer!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;width:2.8em!important;height:2.8em!important;border-radius:50%!important;pointer-events:auto!important;';
        clipButton.style.cssText = baseStyle;
        
        // Use both click and touch events for better compatibility
        const handleClick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[ClipShare] Button clicked!');
            toggleSelectionMode();
        };
        clipButton.addEventListener('click', handleClick, true);
        clipButton.addEventListener('touchend', handleClick, true);
        clipButton.addEventListener('mousedown', (e) => { e.stopPropagation(); }, true);

        if (container) {
            // Try to insert before volume or at the end
            const insertBefore = container.querySelector('.volumeSliderContainer, [class*="volume"], .osdTimeText');
            if (insertBefore) {
                container.insertBefore(clipButton, insertBefore);
            } else {
                container.appendChild(clipButton);
            }
            console.log('[ClipShare] Button added to container');
            return true;
        }

        // Fallback: position absolute on video container
        const vc = document.querySelector('.videoPlayerContainer') || video.parentElement?.parentElement;
        if (vc) {
            clipButton.style.cssText = 'position:absolute;bottom:90px;right:20px;z-index:2147483647;background:#00a4dc!important;color:white!important;border:none!important;padding:12px!important;border-radius:50%!important;cursor:pointer!important;pointer-events:auto!important;';
            vc.appendChild(clipButton);
            console.log('[ClipShare] Button added as fallback');
            return true;
        }
        
        console.log('[ClipShare] Could not find container for button');
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
        let html = `<div style="margin-bottom:10px;line-height:1.6">${text}</div>`;
        if (showActions) {
            html += `<div style="margin-top:15px"><label style="font-size:0.9em;color:#aaa">Expiration (heures):</label>
                <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}" style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#222;color:white;box-sizing:border-box;margin-top:5px"></div>
                <div style="margin-top:15px;display:flex;gap:10px">
                <button id="clipshare-create" style="flex:1;padding:12px;background:#00a4dc;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold">✂️ Créer</button>
                <button id="clipshare-cancel" style="flex:1;padding:12px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">Annuler</button></div>
                <button id="clipshare-close" style="width:100%;margin-top:10px;padding:10px;background:#222;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer">Fermer</button>`;
        } else {
            html += `<div style="margin-top:15px"><button id="clipshare-close" style="width:100%;padding:10px;background:#333;color:white;border:none;border-radius:6px;cursor:pointer">Fermer</button></div>`;
        }
        selectionOverlay.innerHTML = html;
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

        const startSec = parseFloat(startTime);
        const endSec = parseFloat(endTime);
        const expire = parseInt(document.getElementById('clipshare-expire')?.value) || CONFIG.defaultExpireHours;

        updateOverlay('<strong style="font-size:1.2em">⏳ Création...</strong>');

        try {
            await updateCurrentItemId();

            if (!currentItemId) {
                throw new Error('ID vidéo non trouvé. Rafraîchissez la page.');
            }

            // Fetch media path from Jellyfin API
            if (!currentMediaPath) {
                updateOverlay('<strong style="font-size:1.2em">⏳ Récupération du fichier...</strong>');
                currentMediaPath = await fetchMediaPath(currentItemId);
            }

            if (!currentMediaPath) {
                throw new Error('Impossible de récupérer le chemin du fichier média.');
            }

            console.log('[ClipShare] Creating clip:', { itemId: currentItemId, mediaPath: currentMediaPath });

            const resp = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: currentItemId,
                    mediaPath: currentMediaPath,
                    startSeconds: startSec,
                    endSeconds: endSec,
                    expireHours: expire
                })
            });

            const text = await resp.text();
            console.log('[ClipShare] Response:', resp.status, text);

            if (!resp.ok) throw new Error(text || 'Erreur serveur');

            const data = JSON.parse(text);
            showSuccess(data.url);
        } catch (err) {
            console.error('[ClipShare] Error:', err);
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

    async function mainLoop() {
        if (isVideoPage()) {
            if (!currentItemId) await updateCurrentItemId();
            if (!document.getElementById(CONFIG.buttonId)) createClipButton();
        }
    }

    function setupListeners() {
        document.addEventListener('play', e => {
            if (e.target.tagName === 'VIDEO') {
                currentItemId = null;
                currentMediaPath = null;
                setTimeout(() => updateCurrentItemId(), 500);
            }
        }, true);

        window.addEventListener('hashchange', () => {
            currentItemId = null;
            currentMediaPath = null;
            document.getElementById(CONFIG.buttonId)?.remove();
            setTimeout(() => updateCurrentItemId(), 500);
        });

        document.addEventListener('keydown', handleKeyboard);
    }

    function init() {
        console.log('[ClipShare] INIT v2.3');
        setupListeners();
        setInterval(mainLoop, 1500);
        setTimeout(() => { updateCurrentItemId(); createClipButton(); }, 500);
        setTimeout(() => { updateCurrentItemId(); createClipButton(); }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.__clipshare_getId = () => currentItemId;
    window.__clipshare_getPath = () => currentMediaPath;
    window.__clipshare_update = updateCurrentItemId;
    window.__clipshare_debug = () => ({ currentItemId, currentMediaPath, startTime, endTime });
})();
