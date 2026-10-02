using System.Text.Json;

namespace ValveDatabaseUploader;

public sealed class AppConfig
{
    public string HardwareDatabasePath { get; set; } = "";
    public string ManufacturingDatabasePath { get; set; } = "";
    public string SupabaseUrl { get; set; } = "https://wypktkhfeiaebllftxll.supabase.co";
    public string PublishableKey { get; set; } = "sb_publishable_4OJAxRbN6KkcyRNWFAoD4w_qhwl2tkE";
    public string UploaderEmail { get; set; } = "";
    public int CheckIntervalMinutes { get; set; } = 5;
    public int StableSeconds { get; set; } = 60;
    public bool AutomaticSync { get; set; }
    public bool StartWithWindows { get; set; } = true;
    public bool StartupPreferenceSet { get; set; }
    public string? LastHardwareHash { get; set; }
    public string? LastManufacturingHash { get; set; }
    public DateTimeOffset? LastHardwareUpload { get; set; }
    public DateTimeOffset? LastManufacturingUpload { get; set; }

    public static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CVS Controls", "Valve Database Supabase Uploader");
    public static string ConfigPath => Path.Combine(DataDirectory, "config.json");
    public static string LogPath => Path.Combine(DataDirectory, "uploader.log");

    public static AppConfig Load()
    {
        Directory.CreateDirectory(DataDirectory);
        try { return File.Exists(ConfigPath) ? JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(ConfigPath)) ?? new() : new(); }
        catch { return new(); }
    }

    public void Save()
    {
        Directory.CreateDirectory(DataDirectory);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
    }
}
