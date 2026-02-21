using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;

namespace ClipShare;

/// <summary>
/// Startup filter to add middleware early in the pipeline.
/// </summary>
public class ScriptInjectionStartupFilter : IStartupFilter
{
    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next)
    {
        return app =>
        {
            app.UseMiddleware<ScriptInjectionMiddleware>();
            next(app);
        };
    }
}
