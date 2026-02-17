using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using ClipShare.Services;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Linq;

namespace ClipShare.Controllers
{
    [ApiController]
    [Route("ClipShare")]
    public class ClipShareController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, ClipInfo> Clips = new();
        public static IEnumerable<ClipInfo> GetAllClips() => Clips.Values;
        public static void RemoveClip(string id) => Clips.TryRemove(id, out _);

        private readonly ClipGenerator _generator = new();

        private string GetClipFolder()
        {
            // Use Jellyfin's cache directory or temp directory
            var cachePath = Environment.GetEnvironmentVariable("JELLYFIN_CACHE_DIR");
            if (!string.IsNullOrEmpty(cachePath) && Directory.Exists(cachePath))
            {
                var clipFolder = Path.Combine(cachePath, "clipshare");
                Directory.CreateDirectory(clipFolder);
                return clipFolder;
            }

            // Fallback to temp directory
            var tempPath = Path.GetTempPath();
            var tempClipFolder = Path.Combine(tempPath, "jellyfin-clipshare");
            Directory.CreateDirectory(tempClipFolder);
            return tempClipFolder;
        }

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            // Use media path provided by client
            var mediaPath = request.MediaPath;

            if (string.IsNullOrEmpty(mediaPath))
            {
                return BadRequest("Media path is required. Please refresh the page and try again.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = GetClipFolder();
            var output = Path.Combine(folder, $"{id}.mp4");

            try
            {
                await _generator.GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds);
            }
            catch (Exception ex)
            {
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
