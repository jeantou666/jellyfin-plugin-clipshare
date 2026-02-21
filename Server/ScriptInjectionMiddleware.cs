using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace ClipShare;

/// <summary>
/// Middleware that injects the ClipShare script into HTML pages.
/// </summary>
public class ScriptInjectionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ScriptInjectionMiddleware> _logger;
    
    private static readonly string ScriptTag = @"
<script>
(function() {
    if (window.__clipshare_injected) return;
    window.__clipshare_injected = true;
    var script = document.createElement('script');
    script.src = '/ClipShare/script';
    script.onload = function() { console.log('[ClipShare] Script loaded'); };
    document.head ? document.head.appendChild(script) : document.documentElement.appendChild(script);
})();
</script>
</body>";

    public ScriptInjectionMiddleware(RequestDelegate next, ILogger<ScriptInjectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";
        var isWebRequest = path == "/" || path.Equals("/index.html", StringComparison.OrdinalIgnoreCase) ||
                          (path.StartsWith("/web", StringComparison.OrdinalIgnoreCase) && !Path.HasExtension(path));

        if (!isWebRequest)
        {
            await _next(context);
            return;
        }

        var originalBody = context.Response.Body;
        using var memStream = new MemoryStream();
        context.Response.Body = memStream;

        try
        {
            await _next(context);
        }
        catch
        {
            context.Response.Body = originalBody;
            throw;
        }

        memStream.Seek(0, SeekOrigin.Begin);
        var contentType = context.Response.ContentType ?? "";

        if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("[ClipShare] Injecting script into: {Path}", path);
            
            using var reader = new StreamReader(memStream, leaveOpen: true);
            var html = await reader.ReadToEndAsync();
            var injected = html.Replace("</body>", ScriptTag, StringComparison.OrdinalIgnoreCase);

            var bytes = Encoding.UTF8.GetBytes(injected);
            context.Response.ContentLength = bytes.Length;
            context.Response.Body = originalBody;
            await context.Response.Body.WriteAsync(bytes);
        }
        else
        {
            context.Response.Body = originalBody;
            await memStream.CopyToAsync(context.Response.Body);
        }
    }
}
