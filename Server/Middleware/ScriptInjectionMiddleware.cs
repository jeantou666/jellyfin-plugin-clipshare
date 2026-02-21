using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ClipShare.Middleware;

/// <summary>
/// Middleware that injects the ClipShare script into HTML pages.
/// </summary>
public class ScriptInjectionMiddleware
{
    private readonly RequestDelegate _next;
    private const string ScriptTag = "<script src=\"/ClipShare/Script/clipshare.js\" defer></script>";

    public ScriptInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var originalBodyStream = context.Response.Body;
        var path = context.Request.Path.Value ?? "";

        // Skip for API calls, static files, ClipShare endpoints
        if (path.StartsWith("/ClipShare/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/socket", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/web/", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".js", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".css", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".ico", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".png", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".jpg", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".woff", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".woff2", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".ttf", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".svg", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        using var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        try
        {
            await _next(context);

            var contentType = context.Response.ContentType ?? "";
            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                memoryStream.Position = 0;
                using var reader = new StreamReader(memoryStream, leaveOpen: true);
                var html = await reader.ReadToEndAsync();

                if (!html.Contains("/ClipShare/Script/clipshare.js"))
                {
                    var headCloseIndex = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                    if (headCloseIndex > 0)
                    {
                        html = html.Insert(headCloseIndex, ScriptTag);
                    }
                    else
                    {
                        var bodyIndex = html.IndexOf("<body", StringComparison.OrdinalIgnoreCase);
                        if (bodyIndex > 0)
                        {
                            html = html.Insert(bodyIndex, ScriptTag);
                        }
                    }
                }

                var bytes = Encoding.UTF8.GetBytes(html);
                context.Response.ContentLength = bytes.Length;
                context.Response.Body = originalBodyStream;
                await context.Response.Body.WriteAsync(bytes, 0, bytes.Length);
                return;
            }

            memoryStream.Position = 0;
            context.Response.Body = originalBodyStream;
            await memoryStream.CopyToAsync(context.Response.Body);
        }
        catch
        {
            context.Response.Body = originalBodyStream;
            throw;
        }
    }
}
