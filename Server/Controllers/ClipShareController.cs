using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using ClipShare.Services;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace ClipShare.Controllers
{
    [ApiController]
    [Route("ClipShare")]
    public class ClipShareController : ControllerBase
    {
        private static readonly ConcurrentDictionary<string, ClipInfo> Clips = new();
        public static IEnumerable<ClipInfo> GetAllClips() => Clips.Values;
        public static void RemoveClip(string id) => Clips.TryRemove(id, out _);
        private readonly ILibraryManager _libraryManager;
        private readonly ClipGenerator _generator = new();

        public ClipShareController(ILibraryManager libraryManager)
        {
            _libraryManager = libraryManager;
        }

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            var item = _libraryManager.GetItemById(new Guid(request.ItemId));
            if (item == null)
                return NotFound("Media not found");

            var path = item.Path;
            var id = Guid.NewGuid().ToString("N");

            var folder = Path.Combine(AppContext.BaseDirectory, "clipshare");
            Directory.CreateDirectory(folder);

            var output = Path.Combine(folder, $"{id}.mp4");

            await _generator.GenerateClip(path, output, request.StartSeconds, request.EndSeconds);

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
