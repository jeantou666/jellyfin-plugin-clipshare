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

    // State
    let currentItemId = null;
    let currentMediaPath = null;
    let startTime = null;
    let endTime = null;
    let isSelecting = false;
    let clipButton = null;
    let selectionOverlay = null;
    let lastUrl = window.location.href;
    let initAttempts = 0;
    let maxInitAttempts = 30; // 15 seconds max

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

        // URL
        console.log('[ClipShare] URL:', window.location.href);

        // Video element
        const video = document.querySelector('video');
        if (video) {
            console.log('[ClipShare] video.src:', video.src);
            console.log('[ClipShare] video.currentSrc:', video.currentSrc);
        } else {
            console.log('[ClipShare] No video element found');
        }

        // Jellyfin globals - try to find all possible sources
        console.log('[ClipShare] window.ApiClient exists:', !!window.ApiClient);
        console.log('[ClipShare] window.playbackManager exists:', !!window.playbackManager);
        console.log('[ClipShare] window.Events exists:', !!window.Events);

        // Try ApiClient
        if (window.ApiClient) {
            console.log('[ClipShare] ApiClient._serverInfo:', window.ApiClient._serverInfo);
            console.log('[ClipShare] ApiClient._currentUser:', window.ApiClient._currentUser);
        }

        // Try playbackManager (Jellyfin 10.9+)
        if (window.playbackManager) {
            try {
                const currentPlayer = window.playbackManager.getCurrentPlayer?.();
                console.log('[ClipShare] playbackManager.currentPlayer:', currentPlayer);
                if (currentPlayer) {
                    console.log('[ClipShare] currentPlayer.currentItem:', currentPlayer.currentItem);
                }
            } catch(e) {
                console.log('[ClipShare] playbackManager error:', e.message);
            }
        }

        // Check for item in URL params
        const urlParams = new URLSearchParams(window.location.search);
        console.log('[ClipShare] URL params id:', urlParams.get('id'));

        // Check data attributes on video container
        const playerContainer = document.querySelector('.videoPlayerContainer') ||
                               document.querySelector('.htmlVideoPlayer')?.closest('[class*="player"]');
        if (playerContainer) {
            console.log('[ClipShare] playerContainer dataset:', playerContainer.dataset);
            console.log('[ClipShare] playerContainer id attr:', playerContainer.getAttribute('data-id'));
        }

        // Check for meta tags or other elements with video info
        const metaId = document.querySelector('meta[itemprop="videoId"]') ||
                      document.querySelector('[data-video-id]');
        if (metaId) {
            console.log('[ClipShare] meta videoId:', metaId.content || metaId.dataset.videoId);
        }

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

            const urlParams = new URLSearchParams(window.location.search);
            const urlToken = urlParams.get('api_key');
            if (urlToken) return urlToken;

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

        // Method 1: URL query parameter (most common)
        const urlParams = new URLSearchParams(window.location.search);
        videoId = urlParams.get('id') || urlParams.get('Id') || urlParams.get('videoId');
        if (videoId) {
            console.log('[ClipShare] Found ID in URL params:', videoId);
            return videoId;
        }

        // Method 2: URL path patterns
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
                console.log('[ClipShare] Found ID in URL path:', match[1]);
                return match[1];
            }
        }

        // Method 3: Jellyfin playbackManager (Jellyfin 10.9+)
        if (window.playbackManager) {
            try {
                // Try different ways to access current item
                const pm = window.playbackManager;

                // Method 3a: getCurrentPlayer
                const player = pm.getCurrentPlayer?.() || pm.currentPlayer;
                if (player) {
                    if (player.currentItem?.Id) {
                        console.log('[ClipShare] Found ID from playbackManager.player.currentItem:', player.currentItem.Id);
                        return player.currentItem.Id;
                    }
                    if (player._currentItem?.Id) {
                        console.log('[ClipShare] Found ID from playbackManager.player._currentItem:', player._currentItem.Id);
                        return player._currentItem.Id;
                    }
                }

                // Method 3b: direct methods
                if (typeof pm.getCurrentItem === 'function') {
                    const item = pm.getCurrentItem();
                    if (item?.Id) {
                        console.log('[ClipShare] Found ID from playbackManager.getCurrentItem():', item.Id);
                        return item.Id;
                    }
                }

                // Method 3c: currentMediaSource
                if (typeof pm.getCurrentMediaSource === 'function') {
                    const source = pm.getCurrentMediaSource();
                    if (source?.Id) {
                        console.log('[ClipShare] Found ID from playbackManager.getCurrentMediaSource():', source.Id);
                        return source.Id;
                    }
                }
            } catch(e) {
                console.log('[ClipShare] playbackManager access error:', e.message);
            }
        }

        // Method 4: Video element src (HLS stream URL contains video ID)
        const video = document.querySelector('video');
        if (video) {
            const sources = [video.src, video.currentSrc];
            // Also check source children
            video.querySelectorAll('source').forEach(s => sources.push(s.src));

            for (const src of sources) {
                if (src) {
                    const match = src.match(/videos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) ||
                                 src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i);
                    if (match) {
                        console.log('[ClipShare] Found ID from video source:', match[1]);
                        return match[1];
                    }
                }
            }
        }

        // Method 5: Most recent network request
        try {
            const resources = performance.getEntriesByType('resource');
            // Search backwards for most recent
            for (let i = resources.length - 1; i >= 0; i--) {
                const name = resources[i].name;
                if (name.includes('/videos/') || name.includes('/Items/')) {
                    const match = name.match(/(?:videos|Items)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (match) {
                        console.log('[ClipShare] Found ID from recent network request:', match[1]);
                        return match[1];
                    }
                }
            }
        } catch(e) {}

        // Method 6: Check Jellyfin internal state/stores (if accessible)
        try {
            // Sometimes Jellyfin stores state in window.__INITIAL_STATE__ or similar
            const stateKeys = ['__INITIAL_STATE__', '__STATE__', 'store', 'reduxStore'];
            for (const key of stateKeys) {
                if (window[key]?.getState) {
                    const state = window[key].getState();
                    if (state?.videoPlayer?.currentItem?.Id) {
                        return state.videoPlayer.currentItem.Id;
                    }
                }
            }
        } catch(e) {}

        console.log('[ClipShare] Could not find video ID');
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
                headers: { 'X-Emby-Token': apiKey }
            });

            if (!response.ok) {
                console.error('[ClipShare] Failed to fetch item info:', response.status);
                return null;
            }

            const data = await response.json();
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
     * Check if we're on a video playback page
     */
    function isVideoPage() {
        const video = document.querySelector('video');
        if (!video) return false;

        // Check if video is actually playing or ready to play
        if (video.readyState >= 1) return true;

        // Check URL patterns
        const url = window.location.href;
        if (url.includes('/video') || url.includes('/play') || url.includes('id=')) return true;

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
     * Update button appearance based on state
     */
    function updateButtonState() {
        if (!clipButton) return;

        if (startTime !== null && endTime === null) {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">stop</span>';
            clipButton.style.color = '#ff9800';
            clipButton.title = 'Définir la fin du clip';
        } else {
            clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
            clipButton.style.color = '';
            clipButton.title = 'Créer un clip (C)';
        }
    }

    /**
     * Remove existing button and overlay
     */
    function cleanupUI() {
        const existingBtn = document.getElementById(CONFIG.buttonId);
        if (existingBtn) existingBtn.remove();
        const existingOverlay = document.getElementById(CONFIG.overlayId);
        if (existingOverlay) existingOverlay.remove();
        clipButton = null;
        selectionOverlay = null;
    }

    /**
     * Create the clip button - try multiple selectors and strategies
     */
    function createClipButton() {
        console.log('[ClipShare] Attempting to create button...');

        // Remove existing button first
        const existingBtn = document.getElementById(CONFIG.buttonId);
        if (existingBtn) {
            existingBtn.remove();
            clipButton = null;
        }

        // Check if video exists
        const video = document.querySelector('video');
        if (!video) {
            console.log('[ClipShare] No video element found, cannot create button');
            return false;
        }

        // Find the video player controls container - try many selectors
        const selectors = [
            '.videoOsdBottom .buttonsFocusContainer',
            '.videoOsdBottom .flex.flex-grow',
            '.videoOsdBottom .buttons',
            '.osdControls .buttonsFocusContainer',
            '.osdControls .buttons',
            '.videoPlayerControls .buttons',
            '.videoOsdBottom',
            '.osdControls',
            '.videoPlayerContainer .flex'
        ];

        let controlsContainer = null;
        for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) { // Check if visible
                controlsContainer = el;
                console.log('[ClipShare] Found visible controls container:', selector);
                break;
            }
        }

        // Create button
        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.type = 'button';
        clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
        clipButton.title = 'Créer un clip (C)';
        clipButton.className = 'paper-icon-button-light autoSizeButton';

        // Style matching Jellyfin buttons
        clipButton.setAttribute('style', `
            background: transparent !important;
            color: inherit !important;
            border: none !important;
            padding: 0 !important;
            margin: 0 0.3em !important;
            cursor: pointer !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 2.8em !important;
            height: 2.8em !important;
            border-radius: 50% !important;
            font-size: inherit !important;
            vertical-align: middle !important;
            outline: none !important;
            box-shadow: none !important;
            pointer-events: auto !important;
            position: relative !important;
        `);

        // Event listeners
        clipButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[ClipShare] Button clicked!');
            toggleSelectionMode();
        }, true);

        clipButton.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        }, true);

        clipButton.addEventListener('mouseup', function(e) {
            e.stopPropagation();
        }, true);

        if (controlsContainer) {
            // Find a good insertion point
            const insertBefore = controlsContainer.querySelector('.volumeSliderContainer') ||
                                controlsContainer.querySelector('[class*="volume"]') ||
                                controlsContainer.querySelector('.btnRewind') ||
                                null;

            if (insertBefore) {
                controlsContainer.insertBefore(clipButton, insertBefore);
            } else {
                controlsContainer.appendChild(clipButton);
            }
            console.log('[ClipShare] Button added to controls container');
            return true;
        }

        // Fallback: add to video container or body
        const videoContainer = document.querySelector('.videoPlayerContainer') ||
                               video.parentElement?.parentElement;

        if (videoContainer) {
            // Make sure container has position
            const computedStyle = window.getComputedStyle(videoContainer);
            if (computedStyle.position === 'static') {
                videoContainer.style.position = 'relative';
            }

            clipButton.setAttribute('style', `
                position: absolute;
                bottom: 90px;
                right: 20px;
                z-index: 99999;
                background: #00a4dc !important;
                color: white !important;
                border: none !important;
                padding: 12px !important;
                border-radius: 50% !important;
                cursor: pointer !important;
                font-size: 18px !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
                outline: none !important;
                pointer-events: auto !important;
            `);

            videoContainer.appendChild(clipButton);
            console.log('[ClipShare] Button added as fallback (absolute position)');
            return true;
        }

        console.warn('[ClipShare] Could not find any container for button');
        return false;
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
        if (!selectionOverlay) createSelectionOverlay();
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
                    <button id="clipshare-create" type="button" style="flex: 1; padding: 12px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        ✂️ Créer le clip
                    </button>
                    <button id="clipshare-cancel" type="button" style="flex: 1; padding: 12px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                        Annuler
                    </button>
                </div>
                <button id="clipshare-close" type="button" style="width: 100%; margin-top: 10px; padding: 10px; background: #222; color: #aaa; border: 1px solid #444; border-radius: 6px; cursor: pointer; font-size: 13px;">
                    Fermer
                </button>
            `;
        } else {
            content += `
                <div style="margin-top: 15px;">
                    <button id="clipshare-close" type="button" style="width: 100%; padding: 10px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
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

        if (createBtn) createBtn.onclick = (e) => { e.preventDefault(); createClip(); };
        if (cancelBtn) cancelBtn.onclick = (e) => { e.preventDefault(); resetSelection(); };
        if (closeBtn) closeBtn.onclick = (e) => { e.preventDefault(); resetSelection(); };
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
        updateButtonState();

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
        updateButtonState();
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
            const videoId = getCurrentVideoId();
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
                    <button id="clipshare-copy" type="button" style="width: 100%; padding: 12px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                        📋 Copier le lien
                    </button>
                </div>
                <button id="clipshare-close-success" type="button" style="width: 100%; margin-top: 10px; padding: 10px; background: #333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    Fermer
                </button>
            </div>
        `;

        const urlInput = document.getElementById('clipshare-url');
        const copyBtn = document.getElementById('clipshare-copy');
        const closeBtn = document.getElementById('clipshare-close-success');

        if (urlInput) urlInput.onclick = function() { this.select(); };
        if (copyBtn) copyBtn.onclick = function() {
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
        if (closeBtn) closeBtn.onclick = resetSelection;

        setTimeout(resetSelection, 20000);
    }

    function showErrorOverlay(message) {
        if (!selectionOverlay) return;

        selectionOverlay.innerHTML = `
            <div style="text-align: center;">
                <strong style="color: #f44336; font-size: 1.2em;">❌ Erreur</strong><br><br>
                <span style="font-size: 0.95em; color: #ccc;">${message}</span><br><br>
                <button id="clipshare-close-error" type="button" style="padding: 12px 24px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
                    Fermer
                </button>
            </div>
        `;

        const closeBtn = document.getElementById('clipshare-close-error');
        if (closeBtn) closeBtn.onclick = resetSelection;
    }

    function resetSelection() {
        startTime = null;
        endTime = null;
        isSelecting = false;
        hideOverlay();
        updateButtonState();
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelectionMode();
        }

        if (e.key === 'Escape') resetSelection();
    }

    /**
     * Main initialization
     */
    function initUI() {
        console.log('[ClipShare] initUI called (attempt', ++initAttempts, ')');

        // Debug: show all possible ID sources
        debugVideoIdSources();

        // Check for video
        const video = document.querySelector('video');
        if (!video) {
            console.log('[ClipShare] No video element yet');
            return false;
        }

        // Get current video ID
        const videoId = getCurrentVideoId();
        console.log('[ClipShare] Current video ID:', videoId, '(stored:', currentItemId, ')');

        // Check if video ID changed
        if (videoId && videoId !== currentItemId) {
            console.log('[ClipShare] Video ID changed from', currentItemId, 'to', videoId);
            currentItemId = videoId;
            currentMediaPath = null;
            resetForNewVideo();
        }

        // Create button if needed
        const existingBtn = document.getElementById(CONFIG.buttonId);
        if (!existingBtn || existingBtn.offsetParent === null) {
            if (existingBtn) existingBtn.remove();
            return createClipButton();
        }

        return true;
    }

    /**
     * Main loop - check periodically for changes
     */
    function startMainLoop() {
        let lastVideoId = null;

        // Check every second
        setInterval(() => {
            // URL change check
            if (window.location.href !== lastUrl) {
                console.log('[ClipShare] URL changed');
                lastUrl = window.location.href;
                currentItemId = null;
                currentMediaPath = null;
                cleanupUI();
                initAttempts = 0;
            }

            // Video detection
            const video = document.querySelector('video');
            if (video) {
                // Check for video change via ID
                const newVideoId = getCurrentVideoId();
                if (newVideoId && newVideoId !== lastVideoId) {
                    console.log('[ClipShare] Video ID changed in loop:', newVideoId);
                    lastVideoId = newVideoId;
                    currentItemId = newVideoId;
                    currentMediaPath = null;
                    resetForNewVideo();
                }

                // Ensure button exists and is visible
                const btn = document.getElementById(CONFIG.buttonId);
                if (!btn || btn.offsetParent === null) {
                    initUI();
                }
            }
        }, 1000);

        console.log('[ClipShare] Main loop started');
    }

    /**
     * Initialize
     */
    function init() {
        console.log('[ClipShare] ====== INITIALIZING ======');

        // Add keyboard listener
        document.addEventListener('keydown', handleKeyboard);

        // Try immediate init
        setTimeout(() => {
            initUI();
            startMainLoop();
        }, 100);

        // Also try on various events
        document.addEventListener('DOMContentLoaded', initUI);
        window.addEventListener('load', initUI);

        // Try after delays
        setTimeout(initUI, 500);
        setTimeout(initUI, 1000);
        setTimeout(initUI, 2000);
        setTimeout(initUI, 5000);

        console.log('[ClipShare] Initialization complete');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose debug function globally
    window.__clipshare_debug = debugVideoIdSources;
    window.__clipshare_init = initUI;

})();
