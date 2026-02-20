using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using MediaBrowser.Common;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace ClipShare.Middleware;

/// <summary>
/// Middleware that injects the ClipShare script into HTML pages.
/// </summary>
public class ScriptInjectionMiddleware
{
    private readonly RequestDelegate _next;
    private const string ScriptTag = "<script src=\"/ClipShare/script\" defer></script></head>";

    public ScriptInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        // Skip for API and our own endpoints
        if (ShouldSkip(path))
        {
            await _next(context);
            return;
        }

        // Capture response
        var originalBody = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;

        try
        {
            await _next(context);

            var contentType = context.Response.ContentType ?? "";

            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                buffer.Seek(0, SeekOrigin.Begin);
                using var reader = new StreamReader(buffer, leaveOpen: true);
                var html = await reader.ReadToEndAsync();

                // Inject script before </head> if not already present
                if (html.Contains("</head>", StringComparison.OrdinalIgnoreCase) &&
                    !html.Contains("/ClipShare/script", StringComparison.OrdinalIgnoreCase))
                {
                    html = html.Replace("</head>", ScriptTag, StringComparison.OrdinalIgnoreCase);
                }

                var bytes = Encoding.UTF8.GetBytes(html);
                context.Response.ContentLength = bytes.Length;
                context.Response.Body = originalBody;
                await context.Response.Body.WriteAsync(bytes);
                return;
            }

            // Not HTML, copy original response
            buffer.Seek(0, SeekOrigin.Begin);
            context.Response.Body = originalBody;
            await buffer.CopyToAsync(context.Response.Body);
        }
        catch
        {
            context.Response.Body = originalBody;
            throw;
        }
    }

    private static bool ShouldSkip(string path)
    {
        if (path.StartsWith("/ClipShare/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("/web/", StringComparison.OrdinalIgnoreCase)) return true;
        if (path.StartsWith("/socket", StringComparison.OrdinalIgnoreCase)) return true;

        var skipExts = new[] { ".js", ".css", ".woff", ".woff2", ".ttf", ".eot",
                               ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
                               ".webp", ".mp4", ".webm", ".mp3", ".ogg", ".json", ".xml" };

        foreach (var ext in skipExts)
        {
            if (path.EndsWith(ext, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }
}

/// <summary>
/// Registers the middleware with Jellyfin's HTTP pipeline.
/// Jellyfin automatically discovers classes implementing IPluginServiceRegistrator.
/// </summary>
public class ScriptInjectionRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        // No DI services needed
    }

    public void RegisterServices(IApplicationBuilder applicationBuilder)
    {
        applicationBuilder.UseMiddleware<ScriptInjectionMiddleware>();
    }
}
