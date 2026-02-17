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
            // Try to get API key from various sources
            let apiKey = null;

            // Method 1: From ApiClient
            if (window.ApiClient) {
                apiKey = window.ApiClient.accessToken || window.ApiClient._serverInfo?.AccessToken;
            }

            // Method 2: From URL parameters
            if (!apiKey) {
                const urlParams = new URLSearchParams(window.location.search);
                apiKey = urlParams.get('api_key');
            }

            // Method 3: From localStorage
            if (!apiKey) {
                try {
                    const serverInfo = JSON.parse(localStorage.getItem('jellyfin_credentials') || '{}');
                    apiKey = serverInfo.Servers?.[0]?.AccessToken;
                } catch (e) {}
            }

            if (!apiKey) {
                console.warn('[ClipShare] No API key found');
                return null;
            }

            // Fetch item info from Jellyfin API
            const response = await fetch(`/Items?Ids=${itemId}&Fields=Path`, {
                headers: {
                    'X-Emby-Token': apiKey
                }
            });

            if (!response.ok) {
                console.warn('[ClipShare] Failed to fetch item info:', response.status);
                return null;
            }

            const data = await response.json();

            if (data.Items && data.Items.length > 0 && data.Items[0].Path) {
                console.log('[ClipShare] Got media path from API:', data.Items[0].Path);
                return data.Items[0].Path;
            }

        } catch (e) {
            console.error('[ClipShare] Error fetching media path:', e);
        }

        return null;
    }

    /**
     * Create the clip button (fixed position for visibility)
     */
    function createClipButton() {
        if (document.getElementById(CONFIG.buttonId)) return;

        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.innerHTML = '✂️ Clip';
        clipButton.title = 'Create Clip (C)';
        clipButton.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 99999;
            background: #00a4dc;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: transform 0.2s, background-color 0.2s;
        `;

        clipButton.onmouseenter = () => clipButton.style.transform = 'scale(1.05)';
        clipButton.onmouseleave = () => clipButton.style.transform = 'scale(1)';
        clipButton.onclick = toggleSelectionMode;

        document.body.appendChild(clipButton);
        console.log('[ClipShare] Button created');

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
            top: 70px;
            right: 20px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 20px;
            border-radius: 12px;
            z-index: 99999;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-width: 250px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        `;

        document.body.appendChild(selectionOverlay);
    }

    /**
     * Update the overlay display
     */
    function updateOverlay(text, showInput = false) {
        if (!selectionOverlay) return;

        let content = `<div style="margin-bottom: 10px; line-height: 1.5;">${text}</div>`;

        if (showInput) {
            content += `
                <div style="margin-top: 15px;">
                    <label style="font-size: 0.9em; display: block; margin-bottom: 5px; color: #aaa;">Expiration (hours):</label>
                    <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}"
                           style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box;">
                </div>
                <div style="margin-top: 15px; display: flex; gap: 10px;">
                    <button id="clipshare-create" style="flex: 1; padding: 10px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        Create Clip
                    </button>
                    <button id="clipshare-cancel" style="flex: 1; padding: 10px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            `;
        }

        selectionOverlay.innerHTML = content;
        selectionOverlay.style.display = 'block';

        const createBtn = document.getElementById('clipshare-create');
        const cancelBtn = document.getElementById('clipshare-cancel');

        if (createBtn) createBtn.onclick = createClip;
        if (cancelBtn) cancelBtn.onclick = resetSelection;
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
            alert('No video found');
            return;
        }

        startTime = video.currentTime;
        endTime = null;
        isSelecting = true;

        clipButton.innerHTML = '⏹ End';
        clipButton.style.background = '#ff9800';

        updateOverlay(`
            <strong style="font-size: 1.1em;">🎬 Clip Selection</strong><br><br>
            Start: <span style="color: #00a4dc; font-weight: bold;">${formatTime(startTime)}</span><br><br>
            <em style="font-size: 0.85em; color: #aaa;">
                Click the button again to set the end time,<br>
                or press <kbd style="background: #333; padding: 2px 8px; border-radius: 4px;">C</kbd>
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
                <strong style="color: #f44336;">⚠️ Invalid Selection</strong><br><br>
                End time must be after start time.<br>
                <em style="font-size: 0.85em;">Current: ${formatTime(potentialEnd)}, Start: ${formatTime(startTime)}</em>
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

        clipButton.innerHTML = '✂️ Clip';
        clipButton.style.background = '#00a4dc';

        updateOverlay(`
            <strong style="font-size: 1.1em;">🎬 Clip Ready</strong><br><br>
            Start: <span style="color: #00a4dc; font-weight: bold;">${formatTime(startTime)}</span><br>
            End: <span style="color: #00a4dc; font-weight: bold;">${formatTime(endTime)}</span><br>
            Duration: <span style="color: #4caf50; font-weight: bold;">${formatTime(duration)}</span>
        `, true);
    }

    async function createClip() {
        if (!startTime || !endTime) return;

        const expireInput = document.getElementById('clipshare-expire');
        const expireHours = expireInput ? parseInt(expireInput.value) || CONFIG.defaultExpireHours : CONFIG.defaultExpireHours;

        updateOverlay('<strong>⏳ Creating clip...</strong>');

        try {
            // Get video ID
            const videoId = getVideoId();
            if (!videoId) {
                throw new Error('No video ID found. Try refreshing the page.');
            }

            // Get media path
            let mediaPath = currentMediaPath || await fetchMediaPath(videoId);
            if (!mediaPath) {
                throw new Error('Could not get media path. Please try again.');
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
                throw new Error(error || `Server error: ${response.status}`);
            }

            const data = await response.json();

            updateOverlay(`
                <strong style="color: #4caf50; font-size: 1.1em;">✅ Clip Created!</strong><br><br>
                <input type="text" value="${data.url}" readonly
                       style="width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box;"
                       id="clipshare-url" onclick="this.select();">
                <div style="margin-top: 10px;">
                    <button onclick="navigator.clipboard.writeText(document.getElementById('clipshare-url').value); this.textContent='✓ Copied!'; this.style.background='#4caf50';"
                            style="width: 100%; padding: 10px; background: #00a4dc; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                        📋 Copy URL
                    </button>
                </div>
            `);

            setTimeout(() => {
                hideOverlay();
                resetSelection();
            }, 15000);

        } catch (error) {
            console.error('[ClipShare] Error:', error);
            updateOverlay(`
                <strong style="color: #f44336;">❌ Error</strong><br><br>
                <span style="font-size: 0.9em;">${error.message}</span><br><br>
                <button onclick="window.__clipshare_reset && window.__clipshare_reset();" style="padding: 8px 16px; background: #444; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Close
                </button>
            `);
        }
    }

    function resetSelection() {
        startTime = null;
        endTime = null;
        isSelecting = false;
        hideOverlay();

        if (clipButton) {
            clipButton.innerHTML = '✂️ Clip';
            clipButton.style.background = '#00a4dc';
        }
    }

    // Export reset function for inline onclick handlers
    window.__clipshare_reset = resetSelection;

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

    function init() {
        console.log('[ClipShare] Starting initialization...');

        // Wait for video element
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

        document.addEventListener('keydown', handleKeyboard);
        console.log('[ClipShare] Initialization complete');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
