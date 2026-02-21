using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace ClipShare.Middleware;

/// <summary>
/// Startup filter to register the script injection middleware early in the pipeline.
/// </summary>
public class ScriptInjectionStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            // Register our middleware first (before other middleware)
            app.UseMiddleware<ScriptInjectionMiddleware>();
            next(app);
        };
    }
}
