using System;
using System.Collections.Concurrent;
using System.IO;
using System.Threading.Tasks;
using ClipShare.Models;
using ClipShare.Services;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Linq;
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

        private readonly ClipGenerator _generator = new();

        [HttpPost("Create")]
        public async Task<IActionResult> Create([FromBody] ClipRequest request)
        {
            // Try to get the media path using multiple approaches
            string mediaPath = null;

            // Approach 1: Try via ILibraryManager from DI
            try
            {
                var libraryManagerType = Type.GetType("MediaBrowser.Controller.Library.ILibraryManager, MediaBrowser.Controller");
                if (libraryManagerType != null)
                {
                    var service = HttpContext.RequestServices.GetService(libraryManagerType);
                    if (service != null)
                    {
                        var getItemMethod = libraryManagerType.GetMethod("GetItemById", new[] { typeof(Guid) });
                        if (getItemMethod != null)
                        {
                            var item = getItemMethod.Invoke(service, new object[] { new Guid(request.ItemId) });
                            if (item != null)
                            {
                                var pathProperty = item.GetType().GetProperty("Path");
                                if (pathProperty != null)
                                {
                                    mediaPath = pathProperty.GetValue(item)?.ToString();
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ClipShare] Approach 1 failed: {ex.Message}");
            }

            // Approach 2: Try via plugin instance
            if (string.IsNullOrEmpty(mediaPath))
            {
                try
                {
                    var plugin = ClipSharePlugin.Instance;
                    if (plugin != null)
                    {
                        // Try to get via application paths
                        var appPathsField = plugin.GetType().BaseType?.GetField("_applicationPaths",
                            BindingFlags.NonPublic | BindingFlags.Instance);
                        if (appPathsField != null)
                        {
                            // Can't easily access library from here
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ClipShare] Approach 2 failed: {ex.Message}");
                }
            }

            // Approach 3: Try to make internal API call to get item info
            if (string.IsNullOrEmpty(mediaPath))
            {
                try
                {
                    // Get item info via Jellyfin's internal API
                    using var client = new System.Net.Http.HttpClient();

                    // Try to find the API key from current request
                    var apiKey = Request.Headers["X-Emby-Token"].FirstOrDefault();
                    if (string.IsNullOrEmpty(apiKey))
                    {
                        apiKey = Request.Query["api_key"].FirstOrDefault();
                    }

                    if (!string.IsNullOrEmpty(apiKey))
                    {
                        var itemUrl = $"{Request.Scheme}://{Request.Host}/Items?Ids={request.ItemId}&Fields=Path";
                        client.DefaultRequestHeaders.Add("X-Emby-Token", apiKey);

                        var response = await client.GetAsync(itemUrl);
                        if (response.IsSuccessStatusCode)
                        {
                            var content = await response.Content.ReadAsStringAsync();
                            var json = System.Text.Json.JsonDocument.Parse(content);

                            if (json.RootElement.TryGetProperty("Items", out var items) &&
                                items.ValueKind == System.Text.Json.JsonValueKind.Array &&
                                items.GetArrayLength() > 0)
                            {
                                var firstItem = items[0];
                                if (firstItem.TryGetProperty("Path", out var pathElement))
                                {
                                    mediaPath = pathElement.GetString();
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ClipShare] Approach 3 failed: {ex.Message}");
                }
            }

            if (string.IsNullOrEmpty(mediaPath))
            {
                return StatusCode(500, "Could not find media path. Try providing the path directly.");
            }

            if (!System.IO.File.Exists(mediaPath))
            {
                return NotFound($"Media file not found: {mediaPath}");
            }

            var id = Guid.NewGuid().ToString("N");
            var folder = Path.Combine(AppContext.BaseDirectory, "clipshare");
            Directory.CreateDirectory(folder);
            var output = Path.Combine(folder, $"{id}.mp4");

            await _generator.GenerateClip(mediaPath, output, request.StartSeconds, request.EndSeconds);

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
            return Ok(new { url, path = mediaPath });
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
