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

    console.log('[ClipShare] Initializing...');

    // State
    let currentItemId = null;
    let currentMediaPath = null;
    let startTime = null;
    let endTime = null;
    let isSelecting = false;
    let clipButton = null;
    let selectionOverlay = null;

    // Configuration
    const CONFIG = {
        defaultExpireHours: 72,
        buttonId: 'clipshare-btn',
        overlayId: 'clipshare-overlay'
    };

    /**
     * Get API key from localStorage
     */
    function getApiKey() {
        try {
            // Method 1: From jellyfin_credentials in localStorage
            const credentials = localStorage.getItem('jellyfin_credentials');
            if (credentials) {
                const parsed = JSON.parse(credentials);
                if (parsed.Servers && parsed.Servers.length > 0) {
                    const token = parsed.Servers[0].AccessToken;
                    if (token) {
                        console.log('[ClipShare] Got API key from credentials');
                        return token;
                    }
                }
            }

            // Method 2: From ApiClient
            if (window.ApiClient) {
                if (window.ApiClient.accessToken) return window.ApiClient.accessToken;
                if (window.ApiClient._serverInfo?.AccessToken) return window.ApiClient._serverInfo.AccessToken;
            }

            // Method 3: From URL
            const urlParams = new URLSearchParams(window.location.search);
            const urlToken = urlParams.get('api_key');
            if (urlToken) return urlToken;

        } catch (e) {
            console.error('[ClipShare] Error getting API key:', e);
        }

        return null;
    }

    /**
     * Get video ID from loaded resources (performance API)
     */
    function getVideoId() {
        if (currentItemId) return currentItemId;

        try {
            const resources = performance.getEntriesByType('resource');
            for (const r of resources) {
                if (r.name && r.name.includes('/videos/')) {
                    const match = r.name.match(/videos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (match) {
                        currentItemId = match[1];
                        console.log('[ClipShare] Found video ID from resources:', currentItemId);
                        return currentItemId;
                    }
                }
            }
        } catch (e) {
            console.warn('[ClipShare] Performance API error:', e);
        }

        return null;
    }

    /**
     * Get media path via Jellyfin API
     */
    async function fetchMediaPath(itemId) {
        try {
            const apiKey = getApiKey();
            if (!apiKey) {
                console.error('[ClipShare] No API key found');
                return null;
            }

            console.log('[ClipShare] Fetching media path for:', itemId);

            const response = await fetch(`/Items?Ids=${itemId}&Fields=Path`, {
                headers: {
                    'X-Emby-Token': apiKey
                }
            });

            if (!response.ok) {
                console.error('[ClipShare] Failed to fetch item info:', response.status);
                return null;
            }

            const data = await response.json();
            console.log('[ClipShare] API response:', data);

            if (data.Items && data.Items.length > 0 && data.Items[0].Path) {
                console.log('[ClipShare] Got media path:', data.Items[0].Path);
                return data.Items[0].Path;
            }

        } catch (e) {
            console.error('[ClipShare] Error fetching media path:', e);
        }

        return null;
    }

    /**
     * Create the clip button inside video player controls
     */
    function createClipButton() {
        if (document.getElementById(CONFIG.buttonId)) return;

        // Try to find the video player controls container
        // Jellyfin 10.11+ uses different selectors
        const selectors = [
            '.videoOsdBottom .buttonsFocusContainer',
            '.videoOsdBottom .flex',
            '.osdControls .buttonsFocusContainer',
            '.videoPlayerControls .buttons',
            '.videoOsdBottom',
            '.osdControls'
        ];

        let controlsContainer = null;
        for (const selector of selectors) {
            controlsContainer = document.querySelector(selector);
            if (controlsContainer) {
                console.log('[ClipShare] Found controls container:', selector);
                break;
            }
        }

        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
        clipButton.title = 'Create Clip (C)';
        clipButton.className = 'paper-icon-button-light';

        // Style to match Jellyfin player buttons
        clipButton.style.cssText = `
            background: transparent;
            color: inherit;
            border: none;
            padding: 0;
            margin: 0 0.3em;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 2.8em;
            height: 2.8em;
            border-radius: 50%;
            transition: background 0.2s, transform 0.1s;
            font-size: inherit;
            vertical-align: middle;
        `;

        clipButton.onmouseenter = () => {
            clipButton.style.background = 'rgba(255, 255, 255, 0.1)';
        };
        clipButton.onmouseleave = () => {
            clipButton.style.background = 'transparent';
        };
        clipButton.onclick = toggleSelectionMode;

        if (controlsContainer) {
            // Insert before the volume slider or at the end
            const volumeSlider = controlsContainer.querySelector('.volumeSliderContainer');
            if (volumeSlider) {
                controlsContainer.insertBefore(clipButton, volumeSlider);
            } else {
                controlsContainer.appendChild(clipButton);
            }
            console.log('[ClipShare] Button added to player controls');
        } else {
            // Fallback: fixed position bottom right of video
            const videoContainer = document.querySelector('.videoPlayerContainer') || document.querySelector('.htmlVideoPlayer')?.parentElement;
            if (videoContainer) {
                clipButton.style.cssText = `
                    position: absolute;
                    bottom: 80px;
                    right: 20px;
                    z-index: 99999;
                    background: #00a4dc;
                    color: white;
                    border: none;
                    padding: 12px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 18px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                `;
                videoContainer.appendChild(clipButton);
                console.log('[ClipShare] Button added as fallback (absolute position)');
            } else {
                // Last resort: fixed position
                clipButton.style.cssText = `
                    position: fixed;
                    bottom: 100px;
                    right: 20px;
                    z-index: 99999;
                    background: #00a4dc;
                    color: white;
                    border: none;
                    padding: 12px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 18px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                `;
                document.body.appendChild(clipButton);
                console.log('[ClipShare] Button added as last resort (fixed position)');
            }
        }

        createSelectionOverlay();
    }

    /**
     * Create overlay for displaying selection status
     */
    function createSelectionOverlay() {
        if (document.getElementById(CONFIG.overlayId)) return;

        selectionOverlay = document.createElement('div');
        selectionOverlay.id = CONFIG.overlayId;
        selectionOverlay.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(0, 0, 0, 0.95);
            color: white;
            padding: 24px;
            border-radius: 12px;
            z-index: 999999;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-width: 300px;
            max-width: 400px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        `;

        document.body.appendChild(selectionOverlay);
    }

    /**
     * Update the overlay display
     */
    function updateOverlay(text, showActions = false) {
        if (!selectionOverlay) return;

        let content = `<div style="margin-bottom: 10px; line-height: 1.6;">${text}</div>`;

        if (showActions) {
            content += `
                <div style="margin-top: 15px;">
                    <label style="font-size: 0.9em; display: block; margin-bottom: 5px; color: #aaa;">Expiration (heures):</label>
                    <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}"
                           style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; font-size: 14px;">
                </div>
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button id="clipshare-create" style="flex: 1; padding: 12px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        ✂️ Créer le clip
                    </button>
                    <button id="clipshare-cancel" style="flex: 1; padding: 12px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                        Annuler
                    </button>
                </div>
                <button id="clipshare-close" style="width: 100%; margin-top: 10px; padding: 10px; background: #222; color: #aaa; border: 1px solid #444; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    Fermer
                </button>
            `;
        } else {
            // Add close button for non-action overlays
            content += `
                <div style="margin-top: 15px;">
                    <button id="clipshare-close" style="width: 100%; padding: 10px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                        Fermer
                    </button>
                </div>
            `;
        }

        selectionOverlay.innerHTML = content;
        selectionOverlay.style.display = 'block';

        // Attach event listeners
        const createBtn = document.getElementById('clipshare-create');
        const cancelBtn = document.getElementById('clipshare-cancel');
        const closeBtn = document.getElementById('clipshare-close');

        if (createBtn) createBtn.onclick = createClip;
        if (cancelBtn) cancelBtn.onclick = resetSelection;
        if (closeBtn) closeBtn.onclick = resetSelection;
    }

    function hideOverlay() {
        if (selectionOverlay) selectionOverlay.style.display = 'none';
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
        if (!video) {
            alert('Aucune vidéo trouvée');
            return;
        }

        startTime = video.currentTime;
        endTime = null;
        isSelecting = true;

        if (clipButton) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">stop</span>';
            clipButton.style.color = '#ff9800';
            clipButton.title = 'Définir la fin du clip';
        }

        updateOverlay(`
            <strong style="font-size: 1.2em;">🎬 Sélection du clip</strong><br><br>
            Début: <span style="color: #00a4dc; font-weight: bold;">${formatTime(startTime)}</span><br><br>
            <em style="font-size: 0.9em; color: #aaa;">
                Cliquez à nouveau sur le bouton pour définir la fin,<br>
                ou appuyez sur <kbd style="background: #333; padding: 2px 8px; border-radius: 4px;">C</kbd>
            </em>
        `);

        console.log(`[ClipShare] Start time set: ${startTime}`);
    }

    function setEndTime() {
        const video = document.querySelector('video');
        if (!video) return;

        const potentialEnd = video.currentTime;

        if (potentialEnd <= startTime) {
            updateOverlay(`
                <strong style="color: #f44336;">⚠️ Sélection invalide</strong><br><br>
                La fin doit être après le début.<br>
                <em style="font-size: 0.9em;">Actuel: ${formatTime(potentialEnd)}, Début: ${formatTime(startTime)}</em>
            `);
            setTimeout(startSelection, 2000);
            return;
        }

        endTime = potentialEnd;
        isSelecting = false;
        showClipConfirmation();
    }

    function showClipConfirmation() {
        const duration = endTime - startTime;

        if (clipButton) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
            clipButton.style.color = '';
            clipButton.title = 'Créer un clip (C)';
        }

        updateOverlay(`
            <strong style="font-size: 1.2em;">🎬 Clip prêt</strong><br><br>
            Début: <span style="color: #00a4dc; font-weight: bold;">${formatTime(startTime)}</span><br>
            Fin: <span style="color: #00a4dc; font-weight: bold;">${formatTime(endTime)}</span><br>
            Durée: <span style="color: #4caf50; font-weight: bold;">${formatTime(duration)}</span>
        `, true);
    }

    async function createClip() {
        if (!startTime || !endTime) return;

        const expireInput = document.getElementById('clipshare-expire');
        const expireHours = expireInput ? parseInt(expireInput.value) || CONFIG.defaultExpireHours : CONFIG.defaultExpireHours;

        updateOverlay('<strong style="font-size: 1.2em;">⏳ Création du clip...</strong>');

        try {
            // Get video ID
            const videoId = getVideoId();
            if (!videoId) {
                throw new Error('ID vidéo non trouvé. Rafraîchissez la page.');
            }

            // Get media path
            let mediaPath = currentMediaPath || await fetchMediaPath(videoId);
            if (!mediaPath) {
                throw new Error('Impossible d\'obtenir le chemin du média.');
            }
            currentMediaPath = mediaPath;

            console.log('[ClipShare] Creating clip for item:', videoId, 'path:', mediaPath);

            const response = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: videoId,
                    mediaPath: mediaPath,
                    startSeconds: startTime,
                    endSeconds: endTime,
                    expireHours: expireHours
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error || `Erreur serveur: ${response.status}`);
            }

            const data = await response.json();

            showSuccessOverlay(data.url);

        } catch (error) {
            console.error('[ClipShare] Error:', error);
            showErrorOverlay(error.message);
        }
    }

    function showSuccessOverlay(url) {
        if (!selectionOverlay) return;

        selectionOverlay.innerHTML = `
            <div style="text-align: center;">
                <strong style="color: #4caf50; font-size: 1.3em;">✅ Clip créé !</strong><br><br>
                <input type="text" value="${url}" readonly
                       style="width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; font-size: 14px; text-align: center;"
                       id="clipshare-url">
                <div style="margin-top: 15px;">
                    <button id="clipshare-copy" style="width: 100%; padding: 12px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        📋 Copier le lien
                    </button>
                </div>
                <button id="clipshare-close-success" style="width: 100%; margin-top: 10px; padding: 10px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    Fermer
                </button>
            </div>
        `;

        // Attach event listeners
        const urlInput = document.getElementById('clipshare-url');
        const copyBtn = document.getElementById('clipshare-copy');
        const closeBtn = document.getElementById('clipshare-close-success');

        if (urlInput) {
            urlInput.onclick = function() { this.select(); };
        }

        if (copyBtn) {
            copyBtn.onclick = function() {
                navigator.clipboard.writeText(url).then(() => {
                    this.textContent = '✓ Copié !';
                    this.style.background = '#4caf50';
                }).catch(() => {
                    urlInput.select();
                    document.execCommand('copy');
                    this.textContent = '✓ Copié !';
                    this.style.background = '#4caf50';
                });
            };
        }

        if (closeBtn) {
            closeBtn.onclick = resetSelection;
        }

        // Auto close after 20 seconds
        setTimeout(resetSelection, 20000);
    }

    function showErrorOverlay(message) {
        if (!selectionOverlay) return;

        selectionOverlay.innerHTML = `
            <div style="text-align: center;">
                <strong style="color: #f44336; font-size: 1.2em;">❌ Erreur</strong><br><br>
                <span style="font-size: 0.95em; color: #ccc;">${message}</span><br><br>
                <button id="clipshare-close-error" style="padding: 12px 24px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    Fermer
                </button>
            </div>
        `;

        const closeBtn = document.getElementById('clipshare-close-error');
        if (closeBtn) {
            closeBtn.onclick = resetSelection;
        }
    }

    function resetSelection() {
        startTime = null;
        endTime = null;
        isSelecting = false;
        hideOverlay();

        if (clipButton) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
            clipButton.style.color = '';
            clipButton.title = 'Créer un clip (C)';
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';

        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function handleKeyboard(e) {
        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            e.preventDefault();
            toggleSelectionMode();
        }

        if (e.key === 'Escape' && (startTime !== null || endTime !== null)) {
            resetSelection();
        }
    }

    function observeForPlayer() {
        // Watch for video player to appear (Jellyfin uses dynamic loading)
        const observer = new MutationObserver((mutations) => {
            const video = document.querySelector('video');
            const controlsContainer = document.querySelector('.videoOsdBottom') ||
                                     document.querySelector('.osdControls');

            if (video && !document.getElementById(CONFIG.buttonId)) {
                console.log('[ClipShare] Player detected via observer');
                createClipButton();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        return observer;
    }

    function init() {
        console.log('[ClipShare] Starting initialization...');

        // Check if video already exists
        const checkPlayer = setInterval(() => {
            if (document.querySelector('video')) {
                clearInterval(checkPlayer);
                console.log('[ClipShare] Player detected, creating UI');
                createClipButton();

                // Try to get video ID
                const id = getVideoId();
                if (id) {
                    console.log('[ClipShare] Video ID already available:', id);
                }
            }
        }, 500);

        setTimeout(() => clearInterval(checkPlayer), 30000);

        // Also observe for dynamic changes
        observeForPlayer();

        document.addEventListener('keydown', handleKeyboard);
        console.log('[ClipShare] Initialization complete');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
