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

    public ScriptInjectionMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Store the original response stream
        var originalBodyStream = context.Response.Body;

        // Only process GET requests for HTML pages
        if (context.Request.Method.Equals("GET", StringComparison.OrdinalIgnoreCase))
        {
            using var memoryStream = new MemoryStream();
            context.Response.Body = memoryStream;

            try
            {
                await _next(context);

                // Check if response is HTML
                var contentType = context.Response.ContentType;
                if (contentType != null && contentType.Contains("text/html", StringComparison.OrdinalIgnoreCase))
                {
                    memoryStream.Seek(0, SeekOrigin.Begin);
                    using var reader = new StreamReader(memoryStream, leaveOpen: true);
                    var html = await reader.ReadToEndAsync();

                    // Inject script before </body> or at the end of head
                    var scriptTag = "<script src=\"/ClipShare/script\" defer></script>";
                    if (html.Contains("</body>", StringComparison.OrdinalIgnoreCase))
                    {
                        html = html.Replace("</body>", $"{scriptTag}</body>", StringComparison.OrdinalIgnoreCase);
                    }
                    else if (html.Contains("</head>", StringComparison.OrdinalIgnoreCase))
                    {
                        html = html.Replace("</head>", $"{scriptTag}</head>", StringComparison.OrdinalIgnoreCase);
                    }

                    var bytes = Encoding.UTF8.GetBytes(html);
                    context.Response.ContentLength = bytes.Length;
                    context.Response.Body = originalBodyStream;
                    await context.Response.Body.WriteAsync(bytes, 0, bytes.Length);
                    return;
                }

                // Not HTML, just copy the original response
                memoryStream.Seek(0, SeekOrigin.Begin);
                context.Response.Body = originalBodyStream;
                await memoryStream.CopyToAsync(context.Response.Body);
            }
            catch
            {
                context.Response.Body = originalBodyStream;
                throw;
            }
        }
        else
        {
            await _next(context);
        }
    }
}
