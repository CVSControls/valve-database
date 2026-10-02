using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace ValveDatabaseUploader;

public sealed class SupabaseStorageClient : IDisposable
{
    private readonly AppConfig _config;
    private readonly string _password;
    private readonly HttpClient _http;
    private string? _userId;
    public SupabaseStorageClient(AppConfig config, string password, HttpMessageHandler? handler = null)
    {
        _config = config; _password = password;
        if (!Uri.TryCreate(config.SupabaseUrl, UriKind.Absolute, out var url)
            || url.Scheme != "https" || !url.Host.EndsWith(".supabase.co", StringComparison.OrdinalIgnoreCase)
            || url.AbsolutePath != "/" || !string.IsNullOrEmpty(url.UserInfo))
            throw new InvalidOperationException("Enter the HTTPS Supabase project URL.");
        if (!config.PublishableKey.StartsWith("sb_publishable_", StringComparison.Ordinal))
            throw new InvalidOperationException("Use the project's publishable key, never a secret/service-role key.");
        _http = handler is null ? new HttpClient() : new HttpClient(handler);
        _http.BaseAddress = url; _http.Timeout = TimeSpan.FromMinutes(3);
        _http.DefaultRequestHeaders.Add("apikey", config.PublishableKey);
    }
    private async Task SignInAsync(CancellationToken token)
    {
        if (_userId is not null) return;
        using var response = await _http.PostAsJsonAsync("auth/v1/token?grant_type=password",
            new { email = _config.UploaderEmail.Trim(), password = _password }, token);
        await EnsureSuccessAsync(response, token);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        var accessToken = json.RootElement.GetProperty("access_token").GetString()!;
        var id = json.RootElement.GetProperty("user").GetProperty("id").GetString()!;
        _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var responseProfile = await _http.GetAsync($"rest/v1/profiles?id=eq.{Uri.EscapeDataString(id)}&select=role,is_active", token);
        await EnsureSuccessAsync(responseProfile, token);
        using var profile = JsonDocument.Parse(await responseProfile.Content.ReadAsStringAsync(token));
        if (profile.RootElement.GetArrayLength() != 1 || !profile.RootElement[0].GetProperty("is_active").GetBoolean()
            || profile.RootElement[0].GetProperty("role").GetString() is not ("admin" or "uploader"))
            throw new InvalidOperationException("This account needs an active uploader or administrator role.");
        _userId = id;
    }
    public async Task<string> TestConnectionAsync(CancellationToken token = default)
    {
        await SignInAsync(token);
        using var response = await _http.GetAsync("rest/v1/database_sources?select=source_type", token);
        await EnsureSuccessAsync(response, token);
        return $"{_http.BaseAddress!.Host} as {_config.UploaderEmail}";
    }
    public async Task UploadDatabaseAndMetadataAsync(DatabaseKind kind, string snapshot, ValidationReport report, CancellationToken token)
    {
        await SignInAsync(token);
        var bytes = await File.ReadAllBytesAsync(snapshot, token);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var type = kind == DatabaseKind.Hardware ? "hardware_configurator" : "manufacturing_log";
        if (!report.Valid || report.SourceType != type) throw new InvalidOperationException("Database validation must succeed before uploading.");
        var path = $"{type}/{hash}.db";
        using var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var upload = await _http.PostAsync($"storage/v1/object/valve-databases/{path}", content, token);
        if (!upload.IsSuccessStatusCode)
        {
            var body = await upload.Content.ReadAsStringAsync(token);
            bool duplicate = false;
            try
            {
                using var detail = JsonDocument.Parse(body);
                duplicate = detail.RootElement.TryGetProperty("error", out var code)
                    && code.GetString() is "Duplicate" or "ResourceAlreadyExists";
            }
            catch (JsonException) { }
            if (!duplicate) await EnsureSuccessAsync(upload, token);
        }
        using var activate = await _http.PostAsJsonAsync("rest/v1/rpc/activate_database", new
        {
            p_type = type, p_path = path, p_sha = hash,
            p_name = Path.GetFileName(kind == DatabaseKind.Hardware ? _config.HardwareDatabasePath : _config.ManufacturingDatabasePath),
            p_size = bytes.LongLength,
            p_report = new { valid = report.Valid, sourceType = report.SourceType,
                integrityCheck = report.IntegrityCheck, rowCounts = report.RowCounts,
                details = new { desktopValidation = true } }
        }, token);
        await EnsureSuccessAsync(activate, token);
    }
    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken token)
    {
        if (response.IsSuccessStatusCode) return;
        var message = "Check your Supabase connection and account permissions.";
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
            foreach (var key in new[] { "msg", "message", "error_description", "error" })
                if (json.RootElement.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String)
                { message = value.GetString()!; break; }
        }
        catch (JsonException) { }
        throw new InvalidOperationException($"Supabase request failed ({(int)response.StatusCode}): {message}");
    }
    public void Dispose() => _http.Dispose();
}
