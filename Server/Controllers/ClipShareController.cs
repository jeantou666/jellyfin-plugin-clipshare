using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Logging;

namespace ClipShare.Controllers
{
    [ApiController]
    [Route("ClipShare")]
    public class ClipShareController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, ClipInfo> Clips = new();
        public static IEnumerable<ClipInfo> GetAllClips() => Clips.Values;
        public static void RemoveClip(string id) => Clips.TryRemove(id, out _);

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            var logger = HttpContext.RequestServices.GetService(typeof(ILogger<ClipShareController>)) as ILogger<ClipShareController>;
            
            logger?.LogInformation("[ClipShare] Create clip request: ItemId={ItemId}, Start={Start}, End={End}", 
                request.ItemId, request.StartSeconds, request.EndSeconds);

            // Use media path provided by client
            var mediaPath = request.MediaPath;

            if (string.IsNullOrEmpty(mediaPath))
            {
                return BadRequest("Media path is required. Please refresh the page and try again.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                logger?.LogError("[ClipShare] Media file not found: {Path}", mediaPath);
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = GetClipFolder(logger);
            var output = Path.Combine(folder, $"{id}.mp4");

            logger?.LogInformation("[ClipShare] Output path: {Output}", output);
            logger?.LogInformation("[ClipShare] Folder exists: {Exists}", Directory.Exists(folder));
            logger?.LogInformation("[ClipShare] Folder writable: checking...");

            // Test write permission
            try
            {
                var testFile = Path.Combine(folder, "test.txt");
                await System.IO.File.WriteAllTextAsync(testFile, "test");
                System.IO.File.Delete(testFile);
                logger?.LogInformation("[ClipShare] Folder is writable");
            }
            catch (Exception ex)
            {
                logger?.LogError("[ClipShare] Folder not writable: {Error}", ex.Message);
                return StatusCode(500, $"Output folder not writable: {ex.Message}");
            }

            try
            {
                await GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds, logger);
            }
            catch (Exception ex)
            {
                logger?.LogError("[ClipShare] Failed to generate clip: {Error}", ex.Message);
                return StatusCode(500, $"Failed to generate clip: {ex.Message}");
            }

            var expire = DateTime.UtcNow.AddHours(
                request.ExpireHours > 0 ? request.ExpireHours : ClipSharePlugin.Instance!.Configuration.DefaultExpirationHours
            );

            Clips[id] = new ClipInfo
            {
                Id = id,
                FilePath = output,
                ExpirationDate = expire
            };

            var url = $"{Request.Scheme}://{Request.Host}/ClipShare/video/{id}";
            logger?.LogInformation("[ClipShare] Clip created: {Url}", url);
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

        private string GetClipFolder(ILogger? logger)
        {
            // Priority 1: /tmp - should always be writable
            var tmpFolder = "/tmp/jellyfin-clipshare";
            try
            {
                Directory.CreateDirectory(tmpFolder);
                logger?.LogInformation("[ClipShare] Using /tmp folder: {Dir}", tmpFolder);
                return tmpFolder;
            }
            catch (Exception ex)
            {
                logger?.LogWarning("[ClipShare] Cannot use /tmp: {Error}", ex.Message);
            }

            // Priority 2: Jellyfin cache directory
            var cachePath = Environment.GetEnvironmentVariable("JELLYFIN_CACHE_DIR");
            if (!string.IsNullOrEmpty(cachePath) && Directory.Exists(cachePath))
            {
                var clipFolder = Path.Combine(cachePath, "clipshare");
                try
                {
                    Directory.CreateDirectory(clipFolder);
                    logger?.LogInformation("[ClipShare] Using cache directory: {Dir}", clipFolder);
                    return clipFolder;
                }
                catch (Exception ex)
                {
                    logger?.LogWarning("[ClipShare] Cannot use cache dir: {Error}", ex.Message);
                }
            }

            // Priority 3: System temp
            var tempPath = Path.GetTempPath();
            var tempClipFolder = Path.Combine(tempPath, "jellyfin-clipshare");
            Directory.CreateDirectory(tempClipFolder);
            logger?.LogInformation("[ClipShare] Using system temp: {Dir}", tempClipFolder);
            return tempClipFolder;
        }

        private async Task GenerateClip(string input, string output, double start, double end, ILogger? logger)
        {
            var duration = end - start;

            // Use Jellyfin's ffmpeg
            var ffmpegPath = "/usr/lib/jellyfin-ffmpeg/ffmpeg";

            // FFmpeg command: -ss before -i for fast seeking, -t for duration
            // -y to overwrite output
            // -c copy for stream copy (fast)
            var args = $"-y -ss {start:F2} -t {duration:F2} -i \"{input}\" -c copy -avoid_negative_ts make_zero \"{output}\"";

            logger?.LogInformation("[ClipShare] Running: {Ffmpeg} {Args}", ffmpegPath, args);

            var process = new System.Diagnostics.Process
            {
                StartInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = ffmpegPath,
                    Arguments = args,
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            var errorOutput = new System.Text.StringBuilder();
            var standardOutput = new System.Text.StringBuilder();

            process.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    errorOutput.AppendLine(e.Data);
                    logger?.LogDebug("[ClipShare] FFmpeg stderr: {Line}", e.Data);
                }
            };

            process.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                {
                    standardOutput.AppendLine(e.Data);
                    logger?.LogDebug("[ClipShare] FFmpeg stdout: {Line}", e.Data);
                }
            };

            process.Start();
            process.BeginErrorReadLine();
            process.BeginOutputReadLine();

            await process.WaitForExitAsync();

            var exitCode = process.ExitCode;
            var error = errorOutput.ToString();

            logger?.LogInformation("[ClipShare] FFmpeg exit code: {Code}", exitCode);
            logger?.LogInformation("[ClipShare] FFmpeg output file exists: {Exists}", System.IO.File.Exists(output));

            if (exitCode != 0)
            {
                // Log last 10 lines of error output
                var errorLines = error.Split('\n').Where(l => !string.IsNullOrWhiteSpace(l)).TakeLast(10);
                logger?.LogError("[ClipShare] FFmpeg last error lines: {Errors}", string.Join("\n", errorLines));
                throw new Exception($"FFmpeg failed with exit code {exitCode}");
            }

            if (!System.IO.File.Exists(output))
            {
                throw new Exception("FFmpeg completed but output file was not created");
            }

            var fileInfo = new FileInfo(output);
            logger?.LogInformation("[ClipShare] Clip created: {Output}, Size: {Size} bytes", output, fileInfo.Length);
        }
    }
}
