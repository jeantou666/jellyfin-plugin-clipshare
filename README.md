# Jellyfin ClipShare Plugin

Create temporary public shareable clips from your Jellyfin videos.

## Features
- ✂️ Select start/end time directly in the player
- 🔗 Generate public shareable link
- 📺 Discord / browser compatible MP4
- ⏰ Automatic expiration (default 72h)
- 🧹 Auto cleanup of expired clips
- ⌨️ Keyboard shortcut (C) for quick clip creation

---

## Installation

### 1. Add Plugin Repository

1. Go to Jellyfin **Dashboard**
2. Navigate to **Plugins** → **Repositories** → **Add**
3. Enter the repository URL:

```
https://raw.githubusercontent.com/jeantou666/jellyfin-plugin-clipshare/main/repository/manifest.json
```

4. Save

### 2. Install Plugin

1. Go to **Catalog** tab
2. Find **ClipShare** and click **Install**
3. Restart Jellyfin

### 3. Enable Web UI

Since Jellyfin doesn't support client-side plugins, you need to enable the ClipShare button manually:

**Option A: Browser Console (Quick Test)**
1. Open Jellyfin
2. Press `F12` to open browser console
3. Paste and press Enter:
```javascript
(function(){var s=document.createElement('script');s.src='/ClipShare/script';document.head.appendChild(s);})();
```

**Option B: Bookmarklet (Recommended)**
1. Go to **Dashboard** → **Plugins** → **ClipShare**
2. Drag the "ClipShare" bookmarklet to your bookmarks bar
3. Click the bookmark when watching a video

**Option C: Userscript (Best Experience)**
1. Install [Tampermonkey](https://www.tampermonkey.net/)
2. Go to **Dashboard** → **Plugins** → **ClipShare**
3. Click "Install Userscript"
4. The ClipShare button will auto-load on every page

---

## Usage

1. **Play a video** in Jellyfin
2. **Click the ✂️ Clip button** in the player controls, or press **C**
3. **First click**: Set start time
4. **Second click**: Set end time
5. **Create Clip**: The clip URL will be generated
6. **Share**: Copy and share the URL

### Keyboard Shortcuts
- `C` - Toggle clip selection mode
- `Escape` - Cancel selection

---

## Building from Source

Requirements:
- .NET 8.0 SDK
- Jellyfin submodule

```bash
# Clone with submodules
git clone --recursive https://github.com/jeantou666/jellyfin-plugin-clipshare.git

# Build
cd jellyfin-plugin-clipshare
dotnet publish Server/ClipShare.csproj -c Release -o publish

# Package
cd publish && zip -r ../clipshare.zip .
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ClipShare/Create` | POST | Create a new clip |
| `/ClipShare/video/{id}` | GET | Get clip video |
| `/ClipShare/script` | GET | Get ClipShare JavaScript |
| `/web/clipshare/clipshare` | GET | Configuration page |

### Create Clip Request
```json
{
  "itemId": "uuid-of-video",
  "startSeconds": 10.5,
  "endSeconds": 45.0,
  "expireHours": 72
}
```

---

## Configuration

Access the configuration page at: **Dashboard** → **Plugins** → **ClipShare**

Settings:
- Default expiration time (hours)

---

## Troubleshooting

### Button doesn't appear
1. Make sure the script is loaded (check browser console for errors)
2. Try refreshing the page
3. Check that the plugin is installed and enabled

### Clip creation fails
1. Check Jellyfin logs
2. Verify ffmpeg is available on the server
3. Ensure the video file is accessible

---

## License

MIT License
