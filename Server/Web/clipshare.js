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

    console.log('[ClipShare] Script loaded, initializing...');

    // State
    let currentItemId = null;
    let currentMediaPath = null;
    let startTime = null;
    let endTime = null;
    let isSelecting = false;
    let clipButton = null;
    let selectionOverlay = null;
    let lastUrl = window.location.href;
    let lastVideoSrc = null;

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
     * Get video ID - prioritize most recent/current video
     */
    function getCurrentVideoId() {
        // Method 1: From URL (most reliable for current page)
        const url = window.location.href;
        const urlPatterns = [
            /id=([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            /\/video\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
            /\/play\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
        ];

        for (const pattern of urlPatterns) {
            const match = url.match(pattern);
            if (match) {
                console.log('[ClipShare] Got ID from URL:', match[1]);
                return match[1];
            }
        }

        // Method 2: From video element src (most recent)
        const video = document.querySelector('video');
        if (video && video.src) {
            const match = video.src.match(/videos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
            if (match) {
                console.log('[ClipShare] Got ID from video.src:', match[1]);
                return match[1];
            }
        }

        // Method 3: From most recent network request (LAST entry, not first)
        try {
            const resources = performance.getEntriesByType('resource');
            // Iterate backwards to find the most recent video request
            for (let i = resources.length - 1; i >= 0; i--) {
                const r = resources[i];
                if (r.name && r.name.includes('/videos/')) {
                    const match = r.name.match(/videos\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
                    if (match) {
                        console.log('[ClipShare] Got ID from most recent resource:', match[1]);
                        return match[1];
                    }
                }
            }
        } catch (e) {
            console.warn('[ClipShare] Performance API error:', e);
        }

        // Method 4: From Jellyfin playback manager
        try {
            if (window.playbackManager) {
                const player = window.playbackManager.getCurrentPlayer();
                if (player && player.currentItem) {
                    console.log('[ClipShare] Got ID from playbackManager:', player.currentItem.Id);
                    return player.currentItem.Id;
                }
            }
        } catch (e) {}

        // Method 5: From Jellyfin API client
        try {
            if (window.ApiClient && window.ApiClient._currentItem) {
                console.log('[ClipShare] Got ID from ApiClient:', window.ApiClient._currentItem.Id);
                return window.ApiClient._currentItem.Id;
            }
        } catch (e) {}

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
        const url = window.location.href;
        return video && (
            url.includes('/video') ||
            url.includes('/play') ||
            url.includes('id=') ||
            document.querySelector('.videoPlayerContainer') ||
            document.querySelector('.htmlVideoPlayer')
        );
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
     * Create the clip button inside video player controls
     */
    function createClipButton() {
        // Remove existing button first
        const existingBtn = document.getElementById(CONFIG.buttonId);
        if (existingBtn) existingBtn.remove();

        // Find the video player controls container
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
        clipButton.type = 'button';
        clipButton.innerHTML = '<span class="material-icons" style="font-size: 1.4em;">content_cut</span>';
        clipButton.title = 'Créer un clip (C)';
        clipButton.className = 'paper-icon-button-light';

        // Match Jellyfin button style - use !important to override any conflicts
        clipButton.style.cssText = `
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
        `;

        // Use addEventListener instead of onclick
        clipButton.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[ClipShare] Button clicked');
            toggleSelectionMode();
        }, true);

        clipButton.addEventListener('mouseenter', function() {
            this.style.background = 'rgba(255, 255, 255, 0.1) !important';
        });

        clipButton.addEventListener('mouseleave', function() {
            this.style.background = 'transparent !important';
        });

        if (controlsContainer) {
            // Insert before volume slider or at the end
            const volumeSlider = controlsContainer.querySelector('.volumeSliderContainer') ||
                                controlsContainer.querySelector('[class*="volume"]');
            if (volumeSlider) {
                controlsContainer.insertBefore(clipButton, volumeSlider);
            } else {
                controlsContainer.appendChild(clipButton);
            }
            console.log('[ClipShare] Button added to player controls');
            return true;
        }

        // Fallback: position relative to video container
        const videoContainer = document.querySelector('.videoPlayerContainer') ||
                               document.querySelector('.htmlVideoPlayer')?.parentElement ||
                               document.querySelector('video')?.parentElement?.parentElement;
        if (videoContainer) {
            videoContainer.style.position = 'relative';
            clipButton.style.cssText = `
                position: absolute;
                bottom: 80px;
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
            `;
            videoContainer.appendChild(clipButton);
            console.log('[ClipShare] Button added to video container (fallback)');
            return true;
        }

        console.warn('[ClipShare] Could not find a container for button');
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

        if (createBtn) {
            createBtn.addEventListener('click', function(e) {
                e.preventDefault();
                createClip();
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                e.preventDefault();
                resetSelection();
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', function(e) {
                e.preventDefault();
                resetSelection();
            });
        }
    }

    function hideOverlay() {
        if (selectionOverlay) {
            selectionOverlay.style.display = 'none';
        }
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

        if (urlInput) {
            urlInput.addEventListener('click', function() { this.select(); });
        }

        if (copyBtn) {
            copyBtn.addEventListener('click', function() {
                navigator.clipboard.writeText(url).then(() => {
                    this.textContent = '✓ Copié !';
                    this.style.background = '#4caf50';
                }).catch(() => {
                    urlInput.select();
                    document.execCommand('copy');
                    this.textContent = '✓ Copié !';
                    this.style.background = '#4caf50';
                });
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', resetSelection);
        }

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
        if (closeBtn) {
            closeBtn.addEventListener('click', resetSelection);
        }
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

        if (h > 0) {
            return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
        }
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function handleKeyboard(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleSelectionMode();
        }

        if (e.key === 'Escape') {
            resetSelection();
        }
    }

    /**
     * Main initialization - called when video page is detected
     */
    function initUI() {
        const videoId = getCurrentVideoId();
        console.log('[ClipShare] initUI - current video ID:', videoId, 'stored ID:', currentItemId);

        // Check if this is a new video
        if (videoId && videoId !== currentItemId) {
            console.log('[ClipShare] New video detected:', videoId);
            currentItemId = videoId;
            currentMediaPath = null;
            resetForNewVideo();
        }

        // Create button if not exists
        if (!document.getElementById(CONFIG.buttonId)) {
            if (createClipButton()) {
                console.log('[ClipShare] UI initialized for video:', videoId);
            }
        }
    }

    /**
     * URL change detection
     */
    function checkUrlChange() {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            console.log('[ClipShare] URL changed from:', lastUrl, 'to:', currentUrl);
            lastUrl = currentUrl;

            // Reset video ID when URL changes to force re-detection
            currentItemId = null;
            currentMediaPath = null;
            resetForNewVideo();
            cleanupUI();

            // Check if we're on a video page
            if (isVideoPage()) {
                setTimeout(initUI, 500);
            }
        }
    }

    /**
     * Video src change detection
     */
    function checkVideoChange() {
        const video = document.querySelector('video');
        if (video) {
            const src = video.currentSrc || video.src;
            if (src && src !== lastVideoSrc) {
                console.log('[ClipShare] Video src changed');
                lastVideoSrc = src;

                // Re-detect video ID
                const newId = getCurrentVideoId();
                if (newId && newId !== currentItemId) {
                    console.log('[ClipShare] New video via src:', newId);
                    currentItemId = newId;
                    currentMediaPath = null;
                    resetForNewVideo();
                }
            }
        }
    }

    /**
     * Main observer
     */
    function startObserver() {
        // Watch for URL changes (Jellyfin is SPA)
        setInterval(checkUrlChange, 500);

        // Watch for video element changes
        setInterval(checkVideoChange, 1000);

        // Watch for DOM changes
        const observer = new MutationObserver((mutations) => {
            const video = document.querySelector('video');

            if (video && isVideoPage()) {
                // Ensure button exists
                if (!document.getElementById(CONFIG.buttonId)) {
                    console.log('[ClipShare] DOM change detected, initializing UI');
                    initUI();
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[ClipShare] Observer started');
    }

    /**
     * Initialize
     */
    function init() {
        console.log('[ClipShare] Initializing...');
        console.log('[ClipShare] Current URL:', window.location.href);

        // Add keyboard listener
        document.addEventListener('keydown', handleKeyboard);

        // Start observer
        startObserver();

        // Initial check
        if (isVideoPage()) {
            console.log('[ClipShare] Video page detected, initializing UI');
            setTimeout(initUI, 500);
        } else {
            console.log('[ClipShare] Not a video page, waiting...');
        }

        console.log('[ClipShare] Initialization complete');
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
