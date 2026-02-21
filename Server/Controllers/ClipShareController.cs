using System;
using System.Collections.Concurrent;
using System.Globalization;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;
using System.Reflection;

namespace ClipShare.Controllers
{
    [ApiController]
    [Route("ClipShare")]
    public class ClipShareController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, ClipInfo> Clips = new();
        public static IEnumerable<ClipInfo> GetAllClips() => Clips.Values;
        public static void RemoveClip(string id) => Clips.TryRemove(id, out _);

        private static readonly string DebugLogFile = "/tmp/clipshare-debug.log";
        private static void DebugLog(string message)
        {
            try
            {
                var line = $"[{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}] {message}\n";
                System.IO.File.AppendAllText(DebugLogFile, line);
            } catch { }
        }

        /// <summary>
        /// Simple test endpoint to verify the controller is working.
        /// </summary>
        [HttpGet]
        [HttpGet("test")]
        public IActionResult Test()
        {
            return Ok(new {
                status = "ok",
                version = "2.2.4",
                plugin = ClipSharePlugin.Instance != null ? "loaded" : "not loaded"
            });
        }

        /// <summary>
        /// Serves the ClipShare JavaScript file.
        /// </summary>
        [HttpGet("script")]
        [HttpGet("Script/clipshare.js")]
        public IActionResult GetScript()
        {
            try
            {
                // Use executing assembly instead of plugin type
                var assembly = Assembly.GetExecutingAssembly();
                var resources = assembly.GetManifestResourceNames();

                // Find the script resource
                string? resourceName = null;
                foreach (var r in resources)
                {
                    if (r.EndsWith("clipshare.js", StringComparison.OrdinalIgnoreCase))
                    {
                        resourceName = r;
                        break;
                    }
                }

                if (resourceName == null)
                {
                    DebugLog($"Script not found. Resources: {string.Join(", ", resources)}");
                    return NotFound($"Script not found. Available resources: {string.Join(", ", resources)}");
                }

                using var stream = assembly.GetManifestResourceStream(resourceName);
                if (stream == null)
                {
                    return NotFound("Script stream is null");
                }

                using var reader = new StreamReader(stream);
                var script = reader.ReadToEnd();

                DebugLog($"Script served: {script.Length} bytes");
                return Content(script, "application/javascript");
            }
            catch (Exception ex)
            {
                DebugLog($"Error serving script: {ex}");
                return StatusCode(500, $"Error: {ex.Message}\n{ex.StackTrace}");
            }
        }

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            var logger = HttpContext.RequestServices.GetService(typeof(ILogger<ClipShareController>)) as ILogger<ClipShareController>;

            DebugLog($"=== CREATE CLIP v2.2.4 ===");
            DebugLog($"ItemId: {request.ItemId}");
            DebugLog($"Start: {request.StartSeconds}, End: {request.EndSeconds}");

            logger?.LogInformation("[ClipShare] Create clip: ItemId={ItemId}, Start={Start}, End={End}",
                request.ItemId, request.StartSeconds, request.EndSeconds);

            if (string.IsNullOrEmpty(request.ItemId))
            {
                DebugLog("ERROR: ItemId is empty");
                return BadRequest("ItemId is required");
            }

            if (!Guid.TryParse(request.ItemId, out var itemGuid))
            {
                DebugLog($"ERROR: Invalid ItemId format: {request.ItemId}");
                return BadRequest("Invalid ItemId format");
            }

            string? mediaPath = null;
            var plugin = ClipSharePlugin.Instance;

            if (plugin != null)
            {
                mediaPath = plugin.GetItemPath(itemGuid);
                DebugLog($"Server path lookup: {mediaPath}");
            }

            if (string.IsNullOrEmpty(mediaPath) && !string.IsNullOrEmpty(request.MediaPath))
            {
                mediaPath = request.MediaPath;
                DebugLog($"Using client path: {mediaPath}");
            }

            if (string.IsNullOrEmpty(mediaPath))
            {
                DebugLog("ERROR: No media path found");
                return BadRequest("Could not find media file. Try refreshing your library.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                DebugLog($"ERROR: File not found: {mediaPath}");
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = GetClipFolder();
            var output = Path.Combine(folder, $"{id}.mp4");

            try
            {
                Directory.CreateDirectory(folder);
                await GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds);
            }
            catch (Exception ex)
            {
                DebugLog($"ERROR: {ex.Message}");
                return StatusCode(500, $"Failed to create clip: {ex.Message}");
            }

            var expire = DateTime.UtcNow.AddHours(
                request.ExpireHours > 0 ? request.ExpireHours : 72
            );

            Clips[id] = new ClipInfo
            {
                Id = id,
                FilePath = output,
                ExpirationDate = expire
            };

            var url = $"{Request.Scheme}://{Request.Host}/ClipShare/video/{id}";
            return Ok(new { url });
        }

        [HttpGet("video/{id}")]
        public IActionResult GetVideo(string id)
        {
            if (!Clips.TryGetValue(id, out var clip))
                return NotFound();

            if (DateTime.UtcNow > clip.ExpirationDate)
            {
                System.IO.File.Delete(clip.FilePath);
                Clips.TryRemove(id, out _);
                return NotFound("Clip expired");
            }

            var stream = new FileStream(clip.FilePath, FileMode.Open, FileAccess.Read, FileShare.Read);
            return File(stream, "video/mp4", enableRangeProcessing: true);
        }

        [HttpGet("Item/{id}")]
        public IActionResult GetItemInfo(string id)
        {
            if (!Guid.TryParse(id, out var itemGuid))
                return BadRequest("Invalid ID format");

            var plugin = ClipSharePlugin.Instance;
            if (plugin == null)
                return StatusCode(500, "Plugin not initialized");

            var item = plugin.GetItem(itemGuid);
            if (item == null)
                return NotFound($"Item not found: {id}");

            return Ok(new { Id = item.Id, Name = item.Name, Path = item.Path });
        }

        private string GetClipFolder()
        {
            var tmpFolder = "/tmp/jellyfin-clipshare";
            try
            {
                Directory.CreateDirectory(tmpFolder);
                return tmpFolder;
            }
            catch { }

            var tempPath = Path.GetTempPath();
            var tempClipFolder = Path.Combine(tempPath, "jellyfin-clipshare");
            Directory.CreateDirectory(tempClipFolder);
            return tempClipFolder;
        }

        private async Task GenerateClip(string input, string output, double start, double end)
        {
            var duration = end - start;
            var ffmpegPath = "/usr/lib/jellyfin-ffmpeg/ffmpeg";

            var startInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = ffmpegPath,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            startInfo.ArgumentList.Add("-y");
            startInfo.ArgumentList.Add("-ss");
            startInfo.ArgumentList.Add(start.ToString("F2", CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("-t");
            startInfo.ArgumentList.Add(duration.ToString("F2", CultureInfo.InvariantCulture));
            startInfo.ArgumentList.Add("-i");
            startInfo.ArgumentList.Add(input);
            startInfo.ArgumentList.Add("-c");
            startInfo.ArgumentList.Add("copy");
            startInfo.ArgumentList.Add("-avoid_negative_ts");
            startInfo.ArgumentList.Add("make_zero");
            startInfo.ArgumentList.Add(output);

            var process = new System.Diagnostics.Process { StartInfo = startInfo };

            process.Start();
            process.BeginErrorReadLine();
            process.BeginOutputReadLine();
            await process.WaitForExitAsync();

            if (process.ExitCode != 0)
            {
                throw new Exception($"FFmpeg failed with exit code {process.ExitCode}");
            }

            if (!System.IO.File.Exists(output))
            {
                throw new Exception("Output file was not created");
            }
        }
    }
}
