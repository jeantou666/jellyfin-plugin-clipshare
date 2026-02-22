using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace ClipShare;

/// <summary>
/// Middleware that injects the ClipShare JavaScript into HTML pages.
/// </summary>
public class ScriptInjectionMiddleware
{
    private readonly RequestDelegate _next;
    private static readonly byte[] ScriptTag = Encoding.UTF8.GetBytes("<script src=\"/ClipShare/script\" defer></script>");

    public ScriptInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Only process GET requests for HTML pages, skip API and static files
        var path = context.Request.Path.Value ?? "";
        if (!context.Request.Method.Equals("GET", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/api", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/web", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("/socket", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".js", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".css", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".woff", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".png", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".jpg", StringComparison.OrdinalIgnoreCase) ||
            path.Contains(".ico", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        // Capture the original response
        var originalBodyStream = context.Response.Body;
        var originalContentType = context.Response.ContentType;

        using var memoryStream = new MemoryStream();
        context.Response.Body = memoryStream;

        try
        {
            await _next(context);

            var contentType = context.Response.ContentType ?? "";
            if (contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
            {
                memoryStream.Seek(0, SeekOrigin.Begin);
                using var reader = new StreamReader(memoryStream, leaveOpen: true);
                var html = await reader.ReadToEndAsync();

                // Inject script before </body>
                var scriptTagStr = "<script src=\"/ClipShare/script\" defer></script>";
                var insertPoint = html.IndexOf("</body>", StringComparison.OrdinalIgnoreCase);
                if (insertPoint > 0)
                {
                    html = html.Insert(insertPoint, scriptTagStr);
                }
                else
                {
                    // Fallback: insert before </head>
                    insertPoint = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                    if (insertPoint > 0)
                    {
                        html = html.Insert(insertPoint, scriptTagStr);
                    }
                }

                var bytes = Encoding.UTF8.GetBytes(html);
                context.Response.Body = originalBodyStream;
                context.Response.ContentLength = bytes.Length;
                await context.Response.Body.WriteAsync(bytes, 0, bytes.Length);
            }
            else
            {
                // Not HTML - just copy the response back
                memoryStream.Seek(0, SeekOrigin.Begin);
                context.Response.Body = originalBodyStream;
                await memoryStream.CopyToAsync(context.Response.Body);
            }
        }
        catch (Exception)
        {
            // Restore original stream on error
            context.Response.Body = originalBodyStream;
            throw;
        }
    }
}
