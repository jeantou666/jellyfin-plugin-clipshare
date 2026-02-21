using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace ClipShare;

/// <summary>
/// Startup filter to register the script injection middleware early in the pipeline.
/// </summary>
public class ScriptInjectionStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return builder =>
        {
            // Add our middleware early in the pipeline
            builder.UseMiddleware<ScriptInjectionMiddleware>();
            next(builder);
        };
    }
}
