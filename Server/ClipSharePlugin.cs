using System;
using System.Collections.Generic;
using ClipShare.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace ClipShare;

/// <summary>
/// ClipShare Plugin - Allows creating video clips from the Jellyfin player.
/// </summary>
public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private readonly ILibraryManager _libraryManager;

    public static ClipSharePlugin? Instance { get; private set; }

    public override string Name => "ClipShare";

    public override string Description => "Create video clips directly from the Jellyfin video player.";

    public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

    public ClipSharePlugin(
        IServerApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        ILibraryManager libraryManager)
        : base(applicationPaths, xmlSerializer)
    {
        _libraryManager = libraryManager;
        Instance = this;
    }

    /// <summary>
    /// Get a media item by its ID.
    /// </summary>
    public BaseItem? GetItem(Guid id) => id != Guid.Empty ? _libraryManager.GetItemById(id) : null;

    /// <summary>
    /// Get the file path for a media item.
    /// </summary>
    public string GetItemPath(Guid id) => GetItem(id) is { } item ? item.Path : string.Empty;

    public IEnumerable<PluginPageInfo> GetPages() => new[]
    {
        new PluginPageInfo
        {
            Name = "clipshare",
            EmbeddedResourcePath = $"{GetType().Namespace}.Web.index.html"
        }
    };
}
