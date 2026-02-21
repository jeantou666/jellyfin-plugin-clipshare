using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.Loader;
using ClipShare.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace ClipShare;

/// <summary>
/// ClipShare Plugin - Allows creating video clips from the Jellyfin player.
/// </summary>
public class ClipSharePlugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    private readonly ILibraryManager _libraryManager;
    private readonly IPluginManager _pluginManager;

    public static ClipSharePlugin? Instance { get; private set; }

    public override string Name => "ClipShare";

    public override string Description => "Create video clips directly from the Jellyfin video player.";

    public override Guid Id => Guid.Parse("7f4a3b2c-6d5e-4a11-9c2b-5e3a7d4f8a21");

    public ClipSharePlugin(
        IServerApplicationPaths applicationPaths,
        IXmlSerializer xmlSerializer,
        ILibraryManager libraryManager,
        IPluginManager pluginManager)
        : base(applicationPaths, xmlSerializer)
    {
        _libraryManager = libraryManager;
        _pluginManager = pluginManager;
        Instance = this;

        // Check if FileTransformation plugin is installed
        // FileTransformation plugin ID: 5e87cc92-571a-4d8d-8d98-d2d4147f9f90
        Configuration.FileTransformationAvailable = _pluginManager
            .Plugins
            .Any(p => p.Id == Guid.Parse("5e87cc92-571a-4d8d-8d98-d2d4147f9f90"));
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
