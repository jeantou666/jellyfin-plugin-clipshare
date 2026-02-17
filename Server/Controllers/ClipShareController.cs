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
            
            logger?.LogInformation("Create clip request: ItemId={ItemId}, Start={Start}, End={End}", 
                request.ItemId, request.StartSeconds, request.EndSeconds);

            // Use media path provided by client
            var mediaPath = request.MediaPath;

            if (string.IsNullOrEmpty(mediaPath))
            {
                return BadRequest("Media path is required. Please refresh the page and try again.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                logger?.LogError("Media file not found: {Path}", mediaPath);
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = GetClipFolder(logger);
            var output = Path.Combine(folder, $"{id}.mp4");

            logger?.LogInformation("Output path: {Output}", output);

            try
            {
                await GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds, logger);
            }
            catch (Exception ex)
            {
                logger?.LogError(ex, "Failed to generate clip");
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
            logger?.LogInformation("Clip created: {Url}", url);
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
            // Use Jellyfin's cache directory or temp directory
            var cachePath = Environment.GetEnvironmentVariable("JELLYFIN_CACHE_DIR");
            if (!string.IsNullOrEmpty(cachePath) && Directory.Exists(cachePath))
            {
                var clipFolder = Path.Combine(cachePath, "clipshare");
                Directory.CreateDirectory(clipFolder);
                logger?.LogInformation("Using cache directory: {Dir}", clipFolder);
                return clipFolder;
            }

            // Try /var/cache/jellyfin
            var varCache = "/var/cache/jellyfin";
            if (Directory.Exists(varCache))
            {
                var clipFolder = Path.Combine(varCache, "clipshare");
                Directory.CreateDirectory(clipFolder);
                logger?.LogInformation("Using /var/cache/jellyfin: {Dir}", clipFolder);
                return clipFolder;
            }

            // Fallback to temp directory
            var tempPath = Path.GetTempPath();
            var tempClipFolder = Path.Combine(tempPath, "jellyfin-clipshare");
            Directory.CreateDirectory(tempClipFolder);
            logger?.LogInformation("Using temp directory: {Dir}", tempClipFolder);
            return tempClipFolder;
        }

        private async Task GenerateClip(string input, string output, double start, double end, ILogger? logger)
        {
            var duration = end - start;

            // Use Jellyfin's ffmpeg if available, otherwise fallback to system ffmpeg
            var ffmpegPath = "/usr/lib/jellyfin-ffmpeg/ffmpeg";
            if (!System.IO.File.Exists(ffmpegPath))
            {
                ffmpegPath = "ffmpeg";
            }

            // Ensure output directory exists and is writable
            var outputDir = Path.GetDirectoryName(output);
            if (!string.IsNullOrEmpty(outputDir))
            {
                Directory.CreateDirectory(outputDir);
                logger?.LogInformation("Output directory: {Dir}", outputDir);
            }

            // Check input file
            if (!System.IO.File.Exists(input))
            {
                throw new Exception($"Input file not found: {input}");
            }

            // Use -ss before -i for fast seeking, then -t for duration
            // -c copy for stream copy (fast, no re-encoding)
            var args = $"-ss {start:F2} -t {duration:F2} -i \"{input}\" -c copy -avoid_negative_ts make_zero \"{output}\"";

            logger?.LogInformation("Running FFmpeg: {Ffmpeg} {Args}", ffmpegPath, args);

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
                    errorOutput.AppendLine(e.Data);
            };

            process.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data))
                    standardOutput.AppendLine(e.Data);
            };

            process.Start();
            process.BeginErrorReadLine();
            process.BeginOutputReadLine();

            await process.WaitForExitAsync();

            var exitCode = process.ExitCode;
            var error = errorOutput.ToString();

            logger?.LogInformation("FFmpeg exit code: {Code}", exitCode);

            if (exitCode != 0)
            {
                logger?.LogError("FFmpeg error output: {Error}", error);
                throw new Exception($"FFmpeg failed with exit code {exitCode}");
            }

            if (!System.IO.File.Exists(output))
            {
                throw new Exception("FFmpeg completed but output file was not created");
            }

            logger?.LogInformation("Clip created successfully: {Output}", output);
        }
    }
}
