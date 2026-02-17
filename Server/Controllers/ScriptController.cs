using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace ClipShare.Controllers
{
    /// <summary>
    /// Controller for serving the ClipShare JavaScript without any DI dependencies.
    /// </summary>
    [ApiController]
    [Route("ClipShare")]
    public class ScriptController : ControllerBase
    {
        /// <summary>
        /// Serves the ClipShare JavaScript for injection into Jellyfin Web.
        /// </summary>
        [HttpGet("script")]
        [ResponseCache(Duration = 3600)] // Cache for 1 hour
        public IActionResult GetScript()
        {
            var script = GetEmbeddedScript();
            if (string.IsNullOrEmpty(script))
                return Content("// ClipShare script not found", "application/javascript");

            return Content(script, "application/javascript");
        }

        private static string GetEmbeddedScript()
        {
            var assembly = typeof(ClipSharePlugin).Assembly;

            // List all manifest resources for debugging
            var resourceNames = assembly.GetManifestResourceNames();

            // Find the clipshare.js resource
            foreach (var name in resourceNames)
            {
                if (name.EndsWith("clipshare.js"))
                {
                    using var stream = assembly.GetManifestResourceStream(name);
                    if (stream != null)
                    {
                        using var reader = new StreamReader(stream);
                        return reader.ReadToEnd();
                    }
                }
            }

            return null;
        }
    }
}
