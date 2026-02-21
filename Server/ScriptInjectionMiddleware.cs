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
        // Only process HTML responses
        if (context.Response.ContentType?.Contains("text/html", StringComparison.OrdinalIgnoreCase) == true)
        {
            var originalBodyStream = context.Response.Body;
            using var memoryStream = new MemoryStream();
            context.Response.Body = memoryStream;

            try
            {
                await _next(context);

                memoryStream.Seek(0, SeekOrigin.Begin);
                using var reader = new StreamReader(memoryStream, leaveOpen: true);
                var html = await reader.ReadToEndAsync();

                // Inject script before </body>
                var scriptTag = "<script src=\"/ClipShare/script\" defer></script>";
                var injected = html.Replace("</body>", $"{scriptTag}</body>", StringComparison.OrdinalIgnoreCase);

                var bytes = Encoding.UTF8.GetBytes(injected);
                context.Response.ContentLength = bytes.Length;
                context.Response.Body = originalBodyStream;
                await context.Response.Body.WriteAsync(bytes, 0, bytes.Length);
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
