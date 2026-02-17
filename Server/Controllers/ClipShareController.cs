using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using ClipShare.Services;
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

        private readonly ClipGenerator _generator;
        private readonly ILogger<ClipShareController> _logger;

        public ClipShareController(ClipGenerator generator, ILogger<ClipShareController> logger)
        {
            _generator = generator;
            _logger = logger;
        }

        private string GetClipFolder()
        {
            // Use Jellyfin's cache directory or temp directory
            var cachePath = Environment.GetEnvironmentVariable("JELLYFIN_CACHE_DIR");
            if (!string.IsNullOrEmpty(cachePath) && Directory.Exists(cachePath))
            {
                var clipFolder = Path.Combine(cachePath, "clipshare");
                Directory.CreateDirectory(clipFolder);
                _logger.LogInformation("Using cache directory: {Dir}", clipFolder);
                return clipFolder;
            }

            // Try /var/cache/jellyfin
            var varCache = "/var/cache/jellyfin";
            if (Directory.Exists(varCache))
            {
                var clipFolder = Path.Combine(varCache, "clipshare");
                Directory.CreateDirectory(clipFolder);
                _logger.LogInformation("Using /var/cache/jellyfin: {Dir}", clipFolder);
                return clipFolder;
            }

            // Fallback to temp directory
            var tempPath = Path.GetTempPath();
            var tempClipFolder = Path.Combine(tempPath, "jellyfin-clipshare");
            Directory.CreateDirectory(tempClipFolder);
            _logger.LogInformation("Using temp directory: {Dir}", tempClipFolder);
            return tempClipFolder;
        }

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            _logger.LogInformation("Create clip request: ItemId={ItemId}, Start={Start}, End={End}", 
                request.ItemId, request.StartSeconds, request.EndSeconds);

            // Use media path provided by client
            var mediaPath = request.MediaPath;

            if (string.IsNullOrEmpty(mediaPath))
            {
                return BadRequest("Media path is required. Please refresh the page and try again.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                _logger.LogError("Media file not found: {Path}", mediaPath);
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = GetClipFolder();
            var output = Path.Combine(folder, $"{id}.mp4");

            _logger.LogInformation("Output path: {Output}", output);

            try
            {
                await _generator.GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to generate clip");
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
            _logger.LogInformation("Clip created: {Url}", url);
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
    }
}
