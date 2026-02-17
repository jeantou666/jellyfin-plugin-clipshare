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
    let startTime = null;
    let endTime = null;
    let isSelecting = false;
    let clipButton = null;
    let selectionOverlay = null;
    let statusDisplay = null;

    // Configuration
    const CONFIG = {
        defaultExpireHours: 72,
        buttonId: 'clipshare-btn',
        overlayId: 'clipshare-overlay',
        statusId: 'clipshare-status'
    };

    /**
     * Create the clip button in the player controls
     */
    function createClipButton() {
        // Don't create if already exists
        if (document.getElementById(CONFIG.buttonId)) return;

        // Find the video player controls
        const controls = document.querySelector('.videoOsdBottom .osdControls') ||
                        document.querySelector('.videoOsdBottom') ||
                        document.querySelector('.osdControls');

        if (!controls) {
            console.log('[ClipShare] Controls not found, retrying...');
            setTimeout(createClipButton, 1000);
            return;
        }

        // Create button
        clipButton = document.createElement('button');
        clipButton.id = CONFIG.buttonId;
        clipButton.className = 'osdControlButton';
        clipButton.title = 'Create Clip (C)';
        clipButton.innerHTML = `
            <span class="material-icons" style="font-size: 1.4em;">content_cut</span>
            <span style="margin-left: 5px; font-size: 0.9em;">Clip</span>
        `;

        // Add styles
        clipButton.style.cssText = `
            background: transparent;
            border: none;
            color: white;
            cursor: pointer;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            border-radius: 4px;
            transition: background-color 0.2s;
        `;

        clipButton.onmouseenter = () => clipButton.style.backgroundColor = 'rgba(255,255,255,0.1)';
        clipButton.onmouseleave = () => clipButton.style.backgroundColor = 'transparent';

        clipButton.onclick = toggleSelectionMode;

        // Insert button
        const buttonsContainer = controls.querySelector('.osdButtons') || controls;
        buttonsContainer.appendChild(clipButton);

        console.log('[ClipShare] Button created');

        // Create selection overlay
        createSelectionOverlay();

        // Get current video item ID
        updateCurrentItemId();
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
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 99999;
            display: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-width: 200px;
        `;

        document.body.appendChild(selectionOverlay);
    }

    /**
     * Update the overlay display
     */
    function updateOverlay(text, showInput = false) {
        if (!selectionOverlay) return;

        let content = `<div style="margin-bottom: 10px;">${text}</div>`;

        if (showInput) {
            content += `
                <div style="margin-top: 10px;">
                    <label style="font-size: 0.9em; display: block; margin-bottom: 5px;">Expiration (hours):</label>
                    <input type="number" id="clipshare-expire" value="${CONFIG.defaultExpireHours}"
                           style="width: 100%; padding: 5px; border-radius: 4px; border: none;">
                </div>
                <div style="margin-top: 10px; display: flex; gap: 10px;">
                    <button id="clipshare-create" style="flex: 1; padding: 8px; background: #00a4dc; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Create Clip
                    </button>
                    <button id="clipshare-cancel" style="flex: 1; padding: 8px; background: #333; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Cancel
                    </button>
                </div>
            `;
        }

        selectionOverlay.innerHTML = content;
        selectionOverlay.style.display = 'block';

        // Add event listeners if buttons exist
        const createBtn = document.getElementById('clipshare-create');
        const cancelBtn = document.getElementById('clipshare-cancel');

        if (createBtn) createBtn.onclick = createClip;
        if (cancelBtn) cancelBtn.onclick = resetSelection;
    }

    /**
     * Hide the overlay
     */
    function hideOverlay() {
        if (selectionOverlay) {
            selectionOverlay.style.display = 'none';
        }
    }

    /**
     * Toggle selection mode
     */
    function toggleSelectionMode() {
        if (startTime !== null && endTime !== null) {
            // Already have selection, show confirmation
            showClipConfirmation();
        } else if (startTime !== null) {
            // Set end time
            setEndTime();
        } else {
            // Start selection
            startSelection();
        }
    }

    /**
     * Start the selection process
     */
    function startSelection() {
        const video = document.querySelector('video');
        if (!video) {
            alert('No video found');
            return;
        }

        startTime = video.currentTime;
        endTime = null;
        isSelecting = true;

        const startFormatted = formatTime(startTime);
        updateOverlay(`
            <strong>🎬 Clip Selection</strong><br>
            Start: <span style="color: #00a4dc;">${startFormatted}</span><br>
            <br>
            <em style="font-size: 0.85em; color: #aaa;">
                Click the clip button again to set the end time,<br>
                or press <kbd style="background: #333; padding: 2px 6px; border-radius: 3px;">C</kbd> key
            </em>
        `);

        // Update button appearance
        clipButton.innerHTML = `
            <span class="material-icons" style="font-size: 1.4em; color: #00a4dc;">content_cut</span>
            <span style="margin-left: 5px; font-size: 0.9em; color: #00a4dc;">End</span>
        `;

        console.log(`[ClipShare] Start time set: ${startTime}`);
    }

    /**
     * Set the end time
     */
    function setEndTime() {
        const video = document.querySelector('video');
        if (!video) return;

        const potentialEnd = video.currentTime;

        // Validate: end must be after start
        if (potentialEnd <= startTime) {
            updateOverlay(`
                <strong style="color: #f44336;">⚠️ Invalid Selection</strong><br>
                End time must be after start time.<br>
                <em style="font-size: 0.85em;">Current: ${formatTime(potentialEnd)}, Start: ${formatTime(startTime)}</em>
            `);
            setTimeout(() => {
                startSelection(); // Restart selection
            }, 2000);
            return;
        }

        endTime = potentialEnd;
        isSelecting = false;

        showClipConfirmation();
    }

    /**
     * Show clip creation confirmation
     */
    function showClipConfirmation() {
        const duration = endTime - startTime;

        updateOverlay(`
            <strong>🎬 Clip Ready</strong><br>
            Start: <span style="color: #00a4dc;">${formatTime(startTime)}</span><br>
            End: <span style="color: #00a4dc;">${formatTime(endTime)}</span><br>
            Duration: <span style="color: #4caf50;">${formatTime(duration)}</span>
        `, true);

        // Reset button
        clipButton.innerHTML = `
            <span class="material-icons" style="font-size: 1.4em;">content_cut</span>
            <span style="margin-left: 5px; font-size: 0.9em;">Clip</span>
        `;
    }

    /**
     * Create the clip via API
     */
    async function createClip() {
        if (!startTime || !endTime) return;

        const expireInput = document.getElementById('clipshare-expire');
        const expireHours = expireInput ? parseInt(expireInput.value) || CONFIG.defaultExpireHours : CONFIG.defaultExpireHours;

        updateOverlay('<strong>⏳ Creating clip...</strong>');

        try {
            // Get the item ID
            const itemId = getCurrentItemId();
            if (!itemId) {
                throw new Error('Could not determine video ID');
            }

            const response = await fetch('/ClipShare/Create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    itemId: itemId,
                    startSeconds: startTime,
                    endSeconds: endTime,
                    expireHours: expireHours
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(error || 'Server error');
            }

            const data = await response.json();

            // Show success with copy button
            updateOverlay(`
                <strong style="color: #4caf50;">✅ Clip Created!</strong><br>
                <div style="margin-top: 10px;">
                    <input type="text" value="${data.url}" readonly
                           style="width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white;"
                           id="clipshare-url">
                </div>
                <div style="margin-top: 10px;">
                    <button onclick="navigator.clipboard.writeText(document.getElementById('clipshare-url').value); this.textContent='Copied!';"
                            style="width: 100%; padding: 8px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                        Copy URL
                    </button>
                </div>
            `);

            // Auto-hide after 10 seconds
            setTimeout(() => {
                hideOverlay();
                resetSelection();
            }, 10000);

        } catch (error) {
            console.error('[ClipShare] Error:', error);
            updateOverlay(`
                <strong style="color: #f44336;">❌ Error</strong><br>
                ${error.message}
            `);
            setTimeout(hideOverlay, 3000);
        }
    }

    /**
     * Reset the selection
     */
    function resetSelection() {
        startTime = null;
        endTime = null;
        isSelecting = false;
        hideOverlay();

        // Reset button
        if (clipButton) {
            clipButton.innerHTML = `
                <span class="material-icons" style="font-size: 1.4em;">content_cut</span>
                <span style="margin-left: 5px; font-size: 0.9em;">Clip</span>
            `;
        }
    }

    /**
     * Get the current video item ID from Jellyfin
     */
    function getCurrentItemId() {
        // Try multiple ways to get the item ID
        if (currentItemId) return currentItemId;

        // Method 1: From window.ApiClient
        if (window.ApiClient) {
            // Try _currentItem
            if (window.ApiClient._currentItem?.Id) {
                return window.ApiClient._currentItem.Id;
            }
            // Try _serverInfo
            if (window.ApiClient._serverInfo?.ItemId) {
                return window.ApiClient._serverInfo.ItemId;
            }
        }

        // Method 2: From URL
        const urlMatch = window.location.href.match(/\/(?:video|play)\/([a-f0-9-]+)/i);
        if (urlMatch) return urlMatch[1];

        // Method 3: From playbackManager
        if (window.playbackManager?._currentItem?.Id) {
            return window.playbackManager._currentItem.Id;
        }

        return null;
    }

    /**
     * Update the current item ID
     */
    function updateCurrentItemId() {
        // Listen for playback state changes
        document.addEventListener('viewshow', (e) => {
            if (e.detail?.options?.itemId) {
                currentItemId = e.detail.options.itemId;
            }
        });
    }

    /**
     * Format seconds to HH:MM:SS
     */
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

    /**
     * Handle keyboard shortcuts
     */
    function handleKeyboard(e) {
        if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Check if we're in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            e.preventDefault();
            toggleSelectionMode();
        }

        // Escape to cancel
        if (e.key === 'Escape' && (startTime !== null || endTime !== null)) {
            resetSelection();
        }
    }

    /**
     * Initialize
     */
    function init() {
        console.log('[ClipShare] Starting initialization...');

        // Wait for player to be ready
        const checkPlayer = setInterval(() => {
            const video = document.querySelector('video');
            const controls = document.querySelector('.videoOsdBottom, .osdControls');

            if (video && controls) {
                clearInterval(checkPlayer);
                console.log('[ClipShare] Player detected, creating UI');
                createClipButton();
            }
        }, 500);

        // Stop checking after 30 seconds
        setTimeout(() => clearInterval(checkPlayer), 30000);

        // Add keyboard listener
        document.addEventListener('keydown', handleKeyboard);

        // Watch for navigation/view changes (Jellyfin SPA)
        document.addEventListener('viewshow', () => {
            setTimeout(createClipButton, 500);
        });

        console.log('[ClipShare] Initialization complete');
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
