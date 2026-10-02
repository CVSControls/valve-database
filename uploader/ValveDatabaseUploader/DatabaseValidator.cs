using Microsoft.Data.Sqlite;

namespace ValveDatabaseUploader;

public enum DatabaseKind { Hardware, Manufacturing }

public sealed record ValidationReport(string SourceType, string IntegrityCheck, Dictionary<string, long> RowCounts)
{
    public bool Valid => IntegrityCheck == "ok";
}

public static class DatabaseValidator
{
    private static readonly IReadOnlyDictionary<string, string[]> HardwareSchema = new Dictionary<string, string[]>
    {
        ["valves"] = ["valve_id", "valve_brand", "valve_size", "valve_class", "valve_model_number", "valve_port", "stem_type", "description"],
        ["valve_keyed_stems"] = ["valve_id", "stem_diameter", "stem_height", "key_qty", "key_width", "key_cross", "valve_bhc", "valve_hole_dia", "valve_hole_qty", "valve_start_angle"],
        ["valve_flat_stems"] = ["valve_id", "stem_height", "flat_width", "flat_depth", "valve_bhc", "valve_hole_dia", "valve_hole_qty", "valve_start_angle", "packing_flange", "packing_flange_width", "packing_flange_length", "packing_flange_angle", "dia_reduction", "dia_reduction_value", "stem_thread", "stem_thread_dia", "stem_thread_depth", "u_bolt", "u_bolt_valve_width", "u_bolt_valve_length", "valve_pattern_type", "valve_grid_x_distance", "valve_grid_y_distance"],
        ["actuator_sets"] = ["actuator_id", "actuator_name", "theme_name", "bolt_size", "square_size", "square_height", "sq_rad", "d_stem", "actuator_hole_dia", "actuator_bhc", "actuator_hole_qty", "actuator_start_angle", "bracket_height"],
        ["bracket_patterns"] = ["bracket_id", "bracket_code", "part_number", "actuator_1_bhc", "actuator_1_hole_dia", "actuator_1_hole_qty", "actuator_1_start_angle", "actuator_2_bhc", "actuator_2_hole_dia", "actuator_2_hole_qty", "actuator_2_start_angle", "actuator_3_bhc", "actuator_3_hole_dia", "actuator_3_hole_qty", "actuator_3_start_angle", "valve_bhc", "valve_hole_dia", "valve_hole_qty", "valve_start_angle", "valve_2_bhc", "valve_2_hole_dia", "valve_2_hole_qty", "valve_2_start_angle", "valve_3_bhc", "valve_3_hole_dia", "valve_3_hole_qty", "valve_3_start_angle", "bracket_width", "bracket_length", "bracket_height", "actuator_bracket_center_hole", "valve_bracket_center_hole", "packing_flange", "packing_flange_width", "packing_flange_length", "packing_flange_angle", "d_actuator_bracket_center_hole_offset", "d_actuator_bhc_offset", "hole_grid_length", "hole_grid_width"],
        ["universal_adapters"] = ["id", "universal_adapter_name", "part_number", "square_size", "square_height", "sq_rad", "one_p_adapter_length", "actuator_name", "adapter_od_fixed"],
        ["iso_data"] = ["id", "iso_f", "bhc", "hole_dia", "hole_qty", "hole_angle", "metric_bolt", "imperial_bolt", "square_size"]
    };

    private static readonly string[] ManufacturingColumns = ["id", "timestamp", "job_number", "quantity", "configuration_name", "fusion_document_name", "valve_id", "valve_brand", "valve_size", "valve_class", "valve_port", "valve_model", "actuator_name", "Packing Flange", "SCHA", "U-Bolt", "diameter reduction", "stem thread", "Body_Height", "Hub_Height", "Hub_ID", "Hub_OD", "actuator_bhc", "actuator_bracket_center_hole", "actuator_hole_dia", "bracket_code", "bracket_height", "dia_reduction", "flat_depth", "flat_width", "key_cross", "key_width", "packing_flange_angle", "packing_flange_length", "packing_flange_width", "slot_depth", "slot_width", "square_height", "square_size", "stem_diameter", "stem_height", "valve_bhc", "valve_bracket_center_hole", "valve_hole_dia", "valve_hole_qty", "Adapter_OD", "actuator_hole_qty", "bracket_length", "bracket_width", "Bolt Pattern"];

    public static async Task<(string SnapshotPath, ValidationReport Report)> SnapshotAndValidateAsync(string sourcePath, DatabaseKind kind, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath)) throw new FileNotFoundException("The selected database could not be found.", sourcePath);
        var tempDirectory = Path.Combine(Path.GetTempPath(), "CVSControls", "ValveDatabaseUploader");
        Directory.CreateDirectory(tempDirectory);
        var snapshot = Path.Combine(tempDirectory, $"{kind}-{Guid.NewGuid():N}.db");
        try
        {
            await using (var source = OpenConnection(sourcePath, SqliteOpenMode.ReadOnly))
            await using (var destination = OpenConnection(snapshot, SqliteOpenMode.ReadWriteCreate))
            {
                await source.OpenAsync(cancellationToken);
                await destination.OpenAsync(cancellationToken);
                source.BackupDatabase(destination);
            }
            var report = await ValidateAsync(snapshot, kind, cancellationToken);
            return (snapshot, report);
        }
        catch { TryDelete(snapshot); throw; }
    }

    public static async Task<ValidationReport> ValidateAsync(string path, DatabaseKind kind, CancellationToken cancellationToken = default)
    {
        await using var connection = OpenConnection(path, SqliteOpenMode.ReadOnly);
        await connection.OpenAsync(cancellationToken);
        var integrity = Convert.ToString(await ScalarAsync(connection, "PRAGMA integrity_check", cancellationToken)) ?? "failed";
        if (integrity != "ok") throw new InvalidDataException($"SQLite integrity check failed: {integrity}");
        var schema = kind == DatabaseKind.Hardware ? HardwareSchema : new Dictionary<string, string[]> { ["manufacturing_log"] = ManufacturingColumns };
        var rows = new Dictionary<string, long>();
        foreach (var (table, requiredColumns) in schema)
        {
            var columns = new HashSet<string>(StringComparer.Ordinal);
            await using var columnCommand = connection.CreateCommand();
            columnCommand.CommandText = $"PRAGMA table_info(\"{table.Replace("\"", "\"\"")}\")";
            await using var reader = await columnCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) columns.Add(reader.GetString(1));
            if (columns.Count == 0) throw new InvalidDataException($"Missing required table: {table}");
            var missing = requiredColumns.Where(column => !columns.Contains(column)).ToArray();
            if (missing.Length > 0) throw new InvalidDataException($"{table} is missing required columns: {string.Join(", ", missing)}");
            rows[table] = Convert.ToInt64(await ScalarAsync(connection, $"SELECT COUNT(*) FROM \"{table.Replace("\"", "\"\"")}\"", cancellationToken));
        }
        return new(kind == DatabaseKind.Hardware ? "hardware_configurator" : "manufacturing_log", integrity, rows);
    }

    private static async Task<object?> ScalarAsync(SqliteConnection connection, string sql, CancellationToken token)
    {
        await using var command = connection.CreateCommand(); command.CommandText = sql; return await command.ExecuteScalarAsync(token);
    }
    private static SqliteConnection OpenConnection(string path, SqliteOpenMode mode) => new(new SqliteConnectionStringBuilder { DataSource = path, Mode = mode, Pooling = false }.ToString());
    public static void TryDelete(string path) { try { if (File.Exists(path)) File.Delete(path); } catch { } }
}
