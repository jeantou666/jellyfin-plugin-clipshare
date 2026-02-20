using System.IO;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;

namespace ClipShare.Controllers
{
    /// <summary>
    /// Serves the ClipShare configuration page.
    /// </summary>
    [ApiController]
    [Route("configurationpage")]
    public class ConfigController : ControllerBase
    {
        [HttpGet("clipshare")]
        public IActionResult GetConfigPage()
        {
            var html = GetEmbeddedConfigPage();
            if (string.IsNullOrEmpty(html))
            {
                return Content("<html><body><h1>ClipShare</h1><p>Configuration page not found. Plugin is active.</p></body></html>", "text/html");
            }
            return Content(html, "text/html");
        }

        private static string? GetEmbeddedConfigPage()
        {
            var assembly = typeof(ClipSharePlugin).Assembly;

            foreach (var name in assembly.GetManifestResourceNames())
            {
                if (name.EndsWith("index.html"))
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
