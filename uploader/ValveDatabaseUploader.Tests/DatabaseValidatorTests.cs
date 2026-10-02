using Microsoft.Data.Sqlite;
using Xunit;

namespace ValveDatabaseUploader.Tests;

public sealed class DatabaseValidatorTests
{
    [Fact]
    public async Task ManufacturingDatabaseWithExactSchemaIsAccepted()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var path = Path.Combine(Path.GetTempPath(), $"manufacturing-{Guid.NewGuid():N}.db");
        try
        {
            await using var connection = new SqliteConnection($"Data Source={path}");
            await connection.OpenAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "CREATE TABLE manufacturing_log (id INTEGER, timestamp TEXT, job_number TEXT, quantity INTEGER, configuration_name TEXT, fusion_document_name TEXT, valve_id TEXT, valve_brand TEXT, valve_size TEXT, valve_class TEXT, valve_port TEXT, valve_model TEXT, actuator_name TEXT, [Packing Flange] TEXT, SCHA TEXT, [U-Bolt] TEXT, [diameter reduction] TEXT, [stem thread] TEXT, Body_Height REAL, Hub_Height REAL, Hub_ID REAL, Hub_OD REAL, actuator_bhc REAL, actuator_bracket_center_hole REAL, actuator_hole_dia REAL, bracket_code TEXT, bracket_height REAL, dia_reduction REAL, flat_depth REAL, flat_width REAL, key_cross REAL, key_width REAL, packing_flange_angle REAL, packing_flange_length REAL, packing_flange_width REAL, slot_depth REAL, slot_width REAL, square_height REAL, square_size REAL, stem_diameter REAL, stem_height REAL, valve_bhc REAL, valve_bracket_center_hole REAL, valve_hole_dia REAL, valve_hole_qty INTEGER, Adapter_OD REAL, actuator_hole_qty INTEGER, bracket_length REAL, bracket_width REAL, [Bolt Pattern] TEXT);";
            await command.ExecuteNonQueryAsync(cancellationToken); await connection.CloseAsync();
            var report = await DatabaseValidator.ValidateAsync(path, DatabaseKind.Manufacturing, cancellationToken);
            Assert.True(report.Valid); Assert.Equal(0, report.RowCounts["manufacturing_log"]);
        }
        finally { DatabaseValidator.TryDelete(path); }
    }

    [Fact]
    public async Task MissingRequiredTableIsRejected()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var path = Path.Combine(Path.GetTempPath(), $"empty-{Guid.NewGuid():N}.db");
        try
        {
            await using (var connection = new SqliteConnection($"Data Source={path}")) { await connection.OpenAsync(cancellationToken); }
            var error = await Assert.ThrowsAsync<InvalidDataException>(() => DatabaseValidator.ValidateAsync(path, DatabaseKind.Hardware, cancellationToken));
            Assert.Contains("Missing required table", error.Message);
        }
        finally { DatabaseValidator.TryDelete(path); }
    }

    [Fact]
    public async Task ValidatedSnapshotCanBeReadAndDeletedImmediately()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var sourcePath = Path.Combine(Path.GetTempPath(), $"manufacturing-source-{Guid.NewGuid():N}.db");
        string? snapshotPath = null;
        try
        {
            await using (var connection = new SqliteConnection($"Data Source={sourcePath}"))
            {
                await connection.OpenAsync(cancellationToken);
                await using var command = connection.CreateCommand();
                command.CommandText = "CREATE TABLE manufacturing_log (id INTEGER, timestamp TEXT, job_number TEXT, quantity INTEGER, configuration_name TEXT, fusion_document_name TEXT, valve_id TEXT, valve_brand TEXT, valve_size TEXT, valve_class TEXT, valve_port TEXT, valve_model TEXT, actuator_name TEXT, [Packing Flange] TEXT, SCHA TEXT, [U-Bolt] TEXT, [diameter reduction] TEXT, [stem thread] TEXT, Body_Height REAL, Hub_Height REAL, Hub_ID REAL, Hub_OD REAL, actuator_bhc REAL, actuator_bracket_center_hole REAL, actuator_hole_dia REAL, bracket_code TEXT, bracket_height REAL, dia_reduction REAL, flat_depth REAL, flat_width REAL, key_cross REAL, key_width REAL, packing_flange_angle REAL, packing_flange_length REAL, packing_flange_width REAL, slot_depth REAL, slot_width REAL, square_height REAL, square_size REAL, stem_diameter REAL, stem_height REAL, valve_bhc REAL, valve_bracket_center_hole REAL, valve_hole_dia REAL, valve_hole_qty INTEGER, Adapter_OD REAL, actuator_hole_qty INTEGER, bracket_length REAL, bracket_width REAL, [Bolt Pattern] TEXT);";
                await command.ExecuteNonQueryAsync(cancellationToken);
            }

            (snapshotPath, var report) = await DatabaseValidator.SnapshotAndValidateAsync(sourcePath, DatabaseKind.Manufacturing, cancellationToken);
            Assert.True(report.Valid);
            Assert.NotEmpty(await File.ReadAllBytesAsync(snapshotPath, cancellationToken));
            File.Delete(snapshotPath);
            Assert.False(File.Exists(snapshotPath));
            snapshotPath = null;
        }
        finally
        {
            DatabaseValidator.TryDelete(sourcePath);
            if (snapshotPath is not null) DatabaseValidator.TryDelete(snapshotPath);
        }
    }
}
