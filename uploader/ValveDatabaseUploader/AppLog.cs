namespace ValveDatabaseUploader;

public static class AppLog
{
    private static readonly object Gate = new();
    public static event Action<string>? Written;

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}";
        lock (Gate)
        {
            Directory.CreateDirectory(AppConfig.DataDirectory);
            File.AppendAllText(AppConfig.LogPath, line + Environment.NewLine);
        }
        Written?.Invoke(line);
    }
}
