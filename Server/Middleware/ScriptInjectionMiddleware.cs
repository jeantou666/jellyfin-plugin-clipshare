using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace ClipShare.Middleware;

/// <summary>
/// Middleware that injects the ClipShare script into HTML pages.
/// Intercepts all responses and injects script into HTML content.
/// </summary>
public class ScriptInjectionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ScriptInjectionMiddleware> _logger;
    private const string ScriptTag = "<script src=\"/ClipShare/Script/clipshare.js\" defer></script>";
    private static bool _injected = false;

    public ScriptInjectionMiddleware(RequestDelegate next, ILogger<ScriptInjectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "";

        // Skip ClipShare endpoints to avoid recursion
        if (path.StartsWith("/ClipShare/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // Wrap the response
        var originalBodyStream = context.Response.Body;
        using var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        try
        {
            await _next(context);

            memoryStream.Position = 0;
            var contentType = context.Response.ContentType ?? "";

            // Check if this is an HTML response
            var isHtml = contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase) ||
                         contentType.Contains("application/xhtml", StringComparison.OrdinalIgnoreCase) ||
                         (string.IsNullOrEmpty(contentType) && memoryStream.Length > 0);

            if (isHtml && memoryStream.Length > 0)
            {
                using var reader = new StreamReader(memoryStream, leaveOpen: true);
                var html = await reader.ReadToEndAsync();

                // Check if this looks like HTML
                if (html.Contains("<html", StringComparison.OrdinalIgnoreCase) ||
                    html.Contains("<head", StringComparison.OrdinalIgnoreCase) ||
                    html.Contains("<!DOCTYPE", StringComparison.OrdinalIgnoreCase))
                {
                    if (!html.Contains("/ClipShare/Script/clipshare.js"))
                    {
                        var headCloseIndex = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                        if (headCloseIndex > 0)
                        {
                            html = html.Insert(headCloseIndex, ScriptTag);
                            _logger.LogInformation("[ClipShare] Script injected into: {Path}", path);
                        }
                    }

                    var bytes = Encoding.UTF8.GetBytes(html);
                    context.Response.ContentLength = bytes.Length;
                    context.Response.Body = originalBodyStream;
                    await context.Response.Body.WriteAsync(bytes);
                    return;
                }
            }

            // Not HTML or couldn't modify, pass through
            memoryStream.Position = 0;
            context.Response.Body = originalBodyStream;
            await memoryStream.CopyToAsync(context.Response.Body);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ClipShare] Middleware error for path: {Path}", path);
            context.Response.Body = originalBodyStream;

            // Try to copy any captured content
            memoryStream.Position = 0;
            await memoryStream.CopyToAsync(context.Response.Body);
        }
    }
}
