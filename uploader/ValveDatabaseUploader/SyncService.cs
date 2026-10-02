using System.Security.Cryptography;

namespace ValveDatabaseUploader;

public sealed record SyncResult(DatabaseKind Kind, bool Uploaded, string Message, ValidationReport? Report = null);

public sealed class SyncService
{
    private readonly AppConfig _config;
    private readonly SemaphoreSlim _gate = new(1, 1);
    public event Action<string>? StatusChanged;

    public SyncService(AppConfig config) => _config = config;

    public async Task<string> TestSupabaseAsync(CancellationToken token = default)
    {
        var password = CredentialStore.Read();
        if (string.IsNullOrWhiteSpace(password)) throw new InvalidOperationException("Save a Supabase password first.");
        using var cloud = new SupabaseStorageClient(_config, password);
        return await cloud.TestConnectionAsync(token);
    }

    public async Task<SyncResult> ValidateOnlyAsync(DatabaseKind kind, CancellationToken token = default)
    {
        var path = PathFor(kind);
        Status($"Validating {Label(kind)}…");
        var (snapshot, report) = await DatabaseValidator.SnapshotAndValidateAsync(path, kind, token);
        DatabaseValidator.TryDelete(snapshot);
        var message = $"{Label(kind)} is valid · {string.Join(" · ", report.RowCounts.Select(pair => $"{pair.Value:N0} {pair.Key}"))}";
        Status(message); return new(kind, false, message, report);
    }

    public async Task<SyncResult> SyncAsync(DatabaseKind kind, bool force = false, CancellationToken token = default)
    {
        if (!await _gate.WaitAsync(0, token)) return new(kind, false, "Another synchronization is already running.");
        string? snapshot = null;
        try
        {
            var source = PathFor(kind);
            if (!File.Exists(source)) throw new FileNotFoundException($"Select the {Label(kind).ToLowerInvariant()} database first.", source);
            if (!force && DateTime.UtcNow - File.GetLastWriteTimeUtc(source) < TimeSpan.FromSeconds(Math.Max(10, _config.StableSeconds))) return new(kind, false, $"Waiting for {Label(kind).ToLowerInvariant()} to stop changing.");
            Status($"Creating a safe {Label(kind).ToLowerInvariant()} snapshot…");
            ValidationReport report;
            (snapshot, report) = await DatabaseValidator.SnapshotAndValidateAsync(source, kind, token);
            var bytes = await File.ReadAllBytesAsync(snapshot, token);
            if (bytes.LongLength > 50L * 1024 * 1024) throw new InvalidOperationException("The database exceeds the uploader's 50 MB safety limit.");
            var hash = Convert.ToHexString(SHA256.HashData(bytes));
            if (!force && string.Equals(HashFor(kind), hash, StringComparison.OrdinalIgnoreCase)) return new(kind, false, $"{Label(kind)} has not changed.", report);
            var password = CredentialStore.Read();
            if (string.IsNullOrWhiteSpace(password)) throw new InvalidOperationException("Save a Supabase password before synchronizing.");
            Status($"Uploading {Label(kind).ToLowerInvariant()} to Supabase…");
            using var cloud = new SupabaseStorageClient(_config, password);
            await cloud.UploadDatabaseAndMetadataAsync(kind, snapshot, report, token);
            SetSuccessful(kind, hash);
            _config.Save();
            var message = $"{Label(kind)} synchronized successfully at {DateTime.Now:t}.";
            AppLog.Write(message); Status(message); return new(kind, true, message, report);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var message = $"{Label(kind)} sync failed: {exception.Message}";
            AppLog.Write(message); Status(message); throw;
        }
        finally { if (snapshot is not null) DatabaseValidator.TryDelete(snapshot); _gate.Release(); }
    }

    public async Task<IReadOnlyList<SyncResult>> SyncAllAsync(bool force = false, CancellationToken token = default)
    {
        var results = new List<SyncResult>();
        foreach (var kind in new[] { DatabaseKind.Hardware, DatabaseKind.Manufacturing })
        {
            try { results.Add(await SyncAsync(kind, force, token)); }
            catch (Exception exception) { results.Add(new(kind, false, $"{Label(kind)} sync failed: {exception.Message}")); }
        }
        return results;
    }

    private string PathFor(DatabaseKind kind) => kind == DatabaseKind.Hardware ? _config.HardwareDatabasePath : _config.ManufacturingDatabasePath;
    private string? HashFor(DatabaseKind kind) => kind == DatabaseKind.Hardware ? _config.LastHardwareHash : _config.LastManufacturingHash;
    private static string Label(DatabaseKind kind) => kind == DatabaseKind.Hardware ? "Hardware database" : "Manufacturing log";
    private void SetSuccessful(DatabaseKind kind, string hash)
    {
        if (kind == DatabaseKind.Hardware) { _config.LastHardwareHash = hash; _config.LastHardwareUpload = DateTimeOffset.Now; }
        else { _config.LastManufacturingHash = hash; _config.LastManufacturingUpload = DateTimeOffset.Now; }
    }
    private void Status(string text) { StatusChanged?.Invoke(text); AppLog.Write(text); }
}
