using System.Net;
using System.Text;
using System.Text.Json;
using Xunit;
namespace ValveDatabaseUploader.Tests;
public sealed class SupabaseStorageClientTests
{
    private sealed class FakeHandler : HttpMessageHandler
    {
        public bool Viewer, Duplicate, FailedActivation, FailedCleanup;
        public readonly List<string> Requests = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            var path = request.RequestUri!.AbsolutePath; Requests.Add(path);
            Assert.StartsWith("sb_publishable_", request.Headers.GetValues("apikey").Single());
            if (path == "/auth/v1/token")
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
                Assert.Equal(" password with spaces ", body.RootElement.GetProperty("password").GetString());
                return Json(HttpStatusCode.OK, """{"access_token":"test-jwt","user":{"id":"test-user"}}""");
            }
            Assert.Equal("test-jwt", request.Headers.Authorization!.Parameter);
            if (path == "/rest/v1/profiles")
                return Json(HttpStatusCode.OK, Viewer ? """[{"role":"user","is_active":true}]""" : """[{"role":"uploader","is_active":true}]""");
            if (path == "/rest/v1/rpc/retired_database_paths")
                return Json(HttpStatusCode.OK, """[{"storage_path":"manufacturing_log/old.db"}]""");
            if (request.Method == HttpMethod.Delete)
            {
                Assert.Equal("/storage/v1/object/valve-databases", path);
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
                Assert.Equal("manufacturing_log/old.db", body.RootElement.GetProperty("prefixes")[0].GetString());
                return FailedCleanup ? Json(HttpStatusCode.BadRequest, """{"message":"cleanup rejected"}""") : Json(HttpStatusCode.OK, "[]");
            }
            if (path.StartsWith("/storage/v1/object/"))
            {
                Assert.Equal("application/octet-stream", request.Content!.Headers.ContentType!.MediaType);
                Assert.EndsWith(".db", path); Assert.NotEmpty(await request.Content.ReadAsByteArrayAsync(token));
                return Duplicate ? Json(HttpStatusCode.BadRequest, """{"error":"Duplicate","message":"The resource already exists"}""") : Json(HttpStatusCode.OK, "{}");
            }
            if (path == "/rest/v1/rpc/activate_database")
            {
                using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(token));
                Assert.Equal("manufacturing_log", body.RootElement.GetProperty("p_type").GetString());
                Assert.Equal("selected.db", body.RootElement.GetProperty("p_name").GetString());
                Assert.Equal(64, body.RootElement.GetProperty("p_sha").GetString()!.Length);
                Assert.True(body.RootElement.GetProperty("p_report").GetProperty("valid").GetBoolean());
                return FailedActivation ? Json(HttpStatusCode.BadRequest, """{"message":"activation rejected"}""") : Json(HttpStatusCode.OK, "null");
            }
            return Json(HttpStatusCode.OK, "[]");
        }
        private static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    }
    private static AppConfig Config() => new() { UploaderEmail = "sync@example.test", ManufacturingDatabasePath = "selected.db" };
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task UploadAuthenticatesThenStoresSnapshotAndActivatesMetadata(bool duplicate)
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(path, [1, 2, 3], TestContext.Current.CancellationToken);
            var handler = new FakeHandler { Duplicate = duplicate };
            using var client = new SupabaseStorageClient(Config(), " password with spaces ", handler);
            await client.UploadDatabaseAndMetadataAsync(DatabaseKind.Manufacturing, path, new("manufacturing_log", "ok", []), TestContext.Current.CancellationToken);
            Assert.Equal("/auth/v1/token", handler.Requests[0]);
            Assert.Equal("/rest/v1/profiles", handler.Requests[1]);
            Assert.StartsWith("/storage/v1/object/valve-databases/manufacturing_log/", handler.Requests[2]);
            Assert.Equal("/rest/v1/rpc/activate_database", handler.Requests[3]);
            Assert.Equal("/rest/v1/rpc/retired_database_paths", handler.Requests[4]);
            Assert.Equal("/storage/v1/object/valve-databases", handler.Requests[5]);
        }
        finally { File.Delete(path); }
    }
    [Fact]
    public async Task ViewerCannotUseUploader()
    {
        using var client = new SupabaseStorageClient(Config(), " password with spaces ", new FakeHandler { Viewer = true });
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => client.TestConnectionAsync(TestContext.Current.CancellationToken));
        Assert.Contains("uploader or administrator", error.Message);
    }
    [Fact]
    public async Task FailedActivationIsReportedAsFailure()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(path, [1, 2, 3], TestContext.Current.CancellationToken);
            var handler = new FakeHandler { FailedActivation = true };
            using var client = new SupabaseStorageClient(Config(), " password with spaces ", handler);
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => client.UploadDatabaseAndMetadataAsync(DatabaseKind.Manufacturing, path, new("manufacturing_log", "ok", []), TestContext.Current.CancellationToken));
            Assert.Contains("activation rejected", error.Message);
            Assert.DoesNotContain("/rest/v1/rpc/retired_database_paths", handler.Requests);
        }
        finally { File.Delete(path); }
    }
    [Fact]
    public async Task CleanupFailureIsReportedAndCanBeRetried()
    {
        var path = Path.GetTempFileName();
        try
        {
            await File.WriteAllBytesAsync(path, [1, 2, 3], TestContext.Current.CancellationToken);
            var handler = new FakeHandler { FailedCleanup = true };
            using var client = new SupabaseStorageClient(Config(), " password with spaces ", handler);
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => client.UploadDatabaseAndMetadataAsync(DatabaseKind.Manufacturing, path, new("manufacturing_log", "ok", []), TestContext.Current.CancellationToken));
            Assert.Contains("cleanup rejected", error.Message);
            handler.FailedCleanup = false;
            handler.Duplicate = true;
            await client.UploadDatabaseAndMetadataAsync(DatabaseKind.Manufacturing, path, new("manufacturing_log", "ok", []), TestContext.Current.CancellationToken);
        }
        finally { File.Delete(path); }
    }
    [Fact]
    public void SecretKeysAndNonSupabaseUrlsAreRejected()
    {
        var config = Config(); config.PublishableKey = "sb_secret_not-allowed";
        Assert.Throws<InvalidOperationException>(() => new SupabaseStorageClient(config, "password"));
        config = Config(); config.SupabaseUrl = "https://example.com";
        Assert.Throws<InvalidOperationException>(() => new SupabaseStorageClient(config, "password"));
    }
}
