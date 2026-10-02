using Microsoft.Win32;

namespace ValveDatabaseUploader;

public static class StartupManager
{
    private const string KeyName = "CVS Controls Valve Database Uploader";
    private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, true) ?? throw new InvalidOperationException("Windows startup settings are unavailable.");
        if (enabled) key.SetValue(KeyName, StartupCommand); else key.DeleteValue(KeyName, false);
        key.Flush();
        if (enabled && !IsRegisteredForCurrentApp()) throw new InvalidOperationException("Windows did not save the automatic startup registration.");
    }

    public static bool IsRegisteredForCurrentApp()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
        return string.Equals(key?.GetValue(KeyName) as string, StartupCommand, StringComparison.OrdinalIgnoreCase);
    }

    public static string RegisteredCommand
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
            return key?.GetValue(KeyName) as string ?? "";
        }
    }

    private static string StartupCommand => $"\"{Application.ExecutablePath}\" --minimized";
}
