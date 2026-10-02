using System.Diagnostics;

namespace ValveDatabaseUploader;

public sealed class MainForm : Form
{
    private static readonly Color Charcoal = Color.FromArgb(37, 36, 41), PanelColor = Color.FromArgb(47, 46, 51), FieldColor = Color.FromArgb(30, 30, 33), Teal = Color.FromArgb(7, 157, 170), Muted = Color.FromArgb(166, 173, 176), Border = Color.FromArgb(70, 69, 75);
    private readonly AppConfig _config = AppConfig.Load();
    private readonly SyncService _sync;
    private readonly TextBox _hardwarePath = new(), _manufacturingPath = new(), _owner = new(), _repository = new(), _branch = new(), _password = new();
    private readonly NumericUpDown _interval = new(), _stable = new();
    private readonly CheckBox _automatic = new(), _startup = new(), _showPassword = new();
    private readonly Label _hardwareStatus = new(), _manufacturingStatus = new(), _globalStatus = new(), _startupStatus = new();
    private readonly Button _syncAllButton;
    private readonly System.Windows.Forms.Timer _timer = new();
    private readonly NotifyIcon _tray;
    private bool _exitRequested, _busy, _loading;
    private string _storedPassword = "";

    public MainForm()
    {
        _sync = new SyncService(_config);
        _sync.StatusChanged += message => Ui(() => SetGlobalStatus(message, false));
        AppLog.Written += line => Debug.WriteLine(line);
        Text = "CVS Controls · Valve Database Uploader"; MinimumSize = new Size(1040, 760); ClientSize = new Size(1180, 820); StartPosition = FormStartPosition.CenterScreen; BackColor = Charcoal; ForeColor = Color.White; Font = new Font("Segoe UI", 9);
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!) ?? SystemIcons.Application;

        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 255)); root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.Controls.Add(BuildSidebar(), 0, 0); root.Controls.Add(BuildContent(), 1, 0); Controls.Add(root);
        _syncAllButton = FindControl<Button>(this, "syncAll")!;

        _tray = new NotifyIcon { Icon = Icon, Text = "CVS Controls Valve Database Uploader", Visible = true };
        var trayMenu = new ContextMenuStrip(); trayMenu.Items.Add("Open", null, (_, _) => RestoreWindow()); trayMenu.Items.Add("Sync now", null, async (_, _) => await RunSyncAllAsync(true)); trayMenu.Items.Add(new ToolStripSeparator()); trayMenu.Items.Add("Exit", null, (_, _) => { _exitRequested = true; Close(); });
        _tray.ContextMenuStrip = trayMenu; _tray.DoubleClick += (_, _) => RestoreWindow();
        _timer.Tick += async (_, _) => { if (_config.AutomaticSync) await RunSyncAllAsync(false); };
        FormClosing += OnClosing; Resize += (_, _) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
        Shown += async (_, _) => { LoadConfigIntoControls(); RestartTimer(); if (Environment.GetCommandLineArgs().Contains("--minimized")) HideToTray(); if (_config.AutomaticSync) await RunSyncAllAsync(false); };
    }

    private Control BuildSidebar()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(54, 53, 58), Padding = new Padding(22) };
        var logoPanel = new Panel { Dock = DockStyle.Top, Height = 150, BackColor = Color.White, Padding = new Padding(14) };
        var logo = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, Image = LoadLogo() };
        logoPanel.Controls.Add(logo);
        var product = new Label { Dock = DockStyle.Top, Height = 56, Text = "VALVE DATABASE\nUPLOADER", Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Color.White, TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(2, 14, 0, 0) };
        var description = new Label { Dock = DockStyle.Top, Height = 120, Text = "Safely validates and synchronizes the hardware and manufacturing SQLite databases with the Valve Database Viewer.", ForeColor = Muted, Font = new Font("Segoe UI", 9), Padding = new Padding(2, 12, 4, 0) };
        var privacy = new Label { Dock = DockStyle.Bottom, Height = 72, Text = "PASSWORD STORAGE\nWindows Credential Manager", ForeColor = Color.FromArgb(113, 215, 222), Font = new Font("Segoe UI", 8, FontStyle.Bold), Padding = new Padding(2, 12, 0, 0) };
        panel.Controls.Add(privacy); panel.Controls.Add(description); panel.Controls.Add(product); panel.Controls.Add(logoPanel); return panel;
    }

    private Control BuildContent()
    {
        var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(34, 28, 34, 34) };
        var content = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, RowCount = 7 };
        var title = new Label { Text = "Database synchronization", AutoSize = true, Font = new Font("Segoe UI Semibold", 22, FontStyle.Bold), Margin = new Padding(0, 0, 0, 5) };
        var subtitle = new Label { Text = "Select the live database files, validate them, and keep the website current.", AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 0, 0, 22) };
        content.Controls.Add(title); content.Controls.Add(subtitle);
        var databases = new TableLayoutPanel { Dock = DockStyle.Top, Height = 226, ColumnCount = 2, RowCount = 1, Margin = new Padding(0, 0, 0, 16) };
        databases.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); databases.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        var hardware = DatabaseCard("Hardware database", "Valve configuration, actuator, and bracket source", _hardwarePath, _hardwareStatus, DatabaseKind.Hardware); hardware.Margin = new Padding(0, 0, 8, 0);
        var manufacturing = DatabaseCard("Manufacturing log", "Manufacturing history and job source", _manufacturingPath, _manufacturingStatus, DatabaseKind.Manufacturing); manufacturing.Margin = new Padding(8, 0, 0, 0);
        databases.Controls.Add(hardware, 0, 0); databases.Controls.Add(manufacturing, 1, 0); content.Controls.Add(databases);
        content.Controls.Add(SupabaseCard()); content.Controls.Add(AutomationCard());

        var footer = new Panel { Height = 74, Dock = DockStyle.Top, Margin = new Padding(0, 10, 0, 0) };
        _globalStatus.AutoSize = false; _globalStatus.Location = new Point(0, 10); _globalStatus.Size = new Size(480, 48); _globalStatus.Text = "Ready"; _globalStatus.ForeColor = Muted; _globalStatus.TextAlign = ContentAlignment.MiddleLeft;
        var sync = StyledButton("Sync both now", true); sync.Name = "syncAll"; sync.Size = new Size(160, 44); sync.Anchor = AnchorStyles.Top | AnchorStyles.Right; sync.Location = new Point(570, 10); sync.Click += async (_, _) => await RunSyncAllAsync(true);
        footer.Resize += (_, _) => sync.Left = footer.ClientSize.Width - sync.Width;
        footer.Controls.Add(_globalStatus); footer.Controls.Add(sync); content.Controls.Add(footer);
        scroll.Controls.Add(content); scroll.Resize += (_, _) => content.Width = Math.Max(700, scroll.ClientSize.Width - 6); return scroll;
    }

    private Control DatabaseCard(string title, string subtitle, TextBox pathBox, Label status, DatabaseKind kind)
    {
        StyleTextBox(pathBox); pathBox.Dock = DockStyle.Fill;
        var card = Card(226); var inner = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 5 };
        inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 108));
        inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 26)); inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 38)); inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 42)); inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 46)); inner.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var heading = new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI", 12, FontStyle.Bold), Margin = new Padding(0, 0, 0, 2) };
        var copy = new Label { Text = subtitle, AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 0, 0, 12) };
        inner.Controls.Add(heading, 0, 0); inner.SetColumnSpan(heading, 2); inner.Controls.Add(copy, 0, 1); inner.SetColumnSpan(copy, 2);
        inner.Controls.Add(pathBox, 0, 2); inner.SetColumnSpan(pathBox, 2);
        var browse = StyledButton("Choose file", false); browse.Dock = DockStyle.Fill; browse.Margin = new Padding(0, 7, 8, 0); browse.Click += (_, _) => SelectDatabase(pathBox); inner.Controls.Add(browse, 0, 3);
        var validate = StyledButton("Validate", false); validate.Dock = DockStyle.Fill; validate.Margin = new Padding(0, 7, 0, 0); validate.Click += async (_, _) => await ValidateAsync(kind); inner.Controls.Add(validate, 1, 3);
        status.Text = "Not checked"; status.ForeColor = Muted; status.AutoSize = true; status.Margin = new Padding(0, 13, 0, 0); inner.Controls.Add(status, 0, 4); inner.SetColumnSpan(status, 2);
        card.Controls.Add(inner); return card;
    }

    private Control SupabaseCard()
    {
        var card = Card(250); var inner = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 4 };
        inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 36)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 32)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 31)); inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 66)); inner.RowStyles.Add(new RowStyle(SizeType.Absolute, 65)); inner.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        var heading = new Label { Text = "Supabase connection", AutoSize = true, Font = new Font("Segoe UI Semibold", 12, FontStyle.Bold) }; inner.Controls.Add(heading, 0, 0); inner.SetColumnSpan(heading, 4);
        AddField(inner, "Project URL", _owner, 0, 1); AddField(inner, "Publishable key", _repository, 1, 1); AddField(inner, "Uploader email", _branch, 2, 1);
        var test = StyledButton("Test connection", false); test.Dock = DockStyle.Fill; test.Margin = new Padding(10, 22, 0, 4); test.Click += async (_, _) => await TestConnectionAsync(); inner.Controls.Add(test, 3, 1);

        var passwordWrapper = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Margin = new Padding(0, 4, 10, 0) };
        passwordWrapper.RowStyles.Add(new RowStyle(SizeType.Absolute, 20)); passwordWrapper.RowStyles.Add(new RowStyle(SizeType.Absolute, 36));
        passwordWrapper.Controls.Add(new Label { Text = "UPLOADER PASSWORD", AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8, FontStyle.Bold) });
        StyleTextBox(_password); _password.Dock = DockStyle.Fill; _password.UseSystemPasswordChar = true; passwordWrapper.Controls.Add(_password);
        inner.Controls.Add(passwordWrapper, 0, 2); inner.SetColumnSpan(passwordWrapper, 3);
        var savePassword = StyledButton("Save password", true); savePassword.Dock = DockStyle.Fill; savePassword.Margin = new Padding(0, 24, 0, 5); savePassword.Click += (_, _) => SavePassword(); inner.Controls.Add(savePassword, 3, 2);

        var hint = new Label { Text = "Stored locally in Windows Credential Manager — never uploaded or saved in config.json.", AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 9, 0, 0) }; inner.Controls.Add(hint, 0, 3); inner.SetColumnSpan(hint, 3);
        _showPassword.Text = "Show password"; StyleCheck(_showPassword); _showPassword.Margin = new Padding(10, 7, 0, 0); _showPassword.CheckedChanged += (_, _) => _password.UseSystemPasswordChar = !_showPassword.Checked; inner.Controls.Add(_showPassword, 3, 3);
        card.Controls.Add(inner); return card;
    }

    private Control AutomationCard()
    {
        var card = Card(184); var inner = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, RowCount = 4 };
        inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 42)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 24)); inner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 10));
        var heading = new Label { Text = "Automatic synchronization", AutoSize = true, Font = new Font("Segoe UI", 12, FontStyle.Bold) }; inner.Controls.Add(heading, 0, 0); inner.SetColumnSpan(heading, 4);
        _automatic.Text = "Enable automatic sync"; StyleCheck(_automatic); _automatic.CheckedChanged += (_, _) => { if (!_loading) SaveControls(); }; inner.Controls.Add(_automatic, 0, 1);
        AddNumericField(inner, "Check every (minutes)", _interval, 1); _interval.Minimum = 1; _interval.Maximum = 1440;
        AddNumericField(inner, "Stable for (seconds)", _stable, 2); _stable.Minimum = 10; _stable.Maximum = 3600;
        _startup.Text = "Open uploader when I sign in to Windows"; StyleCheck(_startup); _startup.CheckedChanged += (_, _) => { if (!_loading) SaveControls(); }; inner.Controls.Add(_startup, 0, 2); inner.SetColumnSpan(_startup, 2);
        var log = StyledButton("Open log", false); log.AutoSize = true; log.Margin = new Padding(0, 10, 0, 0); log.Click += (_, _) => { Directory.CreateDirectory(AppConfig.DataDirectory); if (!File.Exists(AppConfig.LogPath)) File.WriteAllText(AppConfig.LogPath, ""); Process.Start(new ProcessStartInfo(AppConfig.LogPath) { UseShellExecute = true }); }; inner.Controls.Add(log, 3, 2);
        _startupStatus.AutoSize = true; _startupStatus.ForeColor = Muted; _startupStatus.Margin = new Padding(0, 8, 0, 0); inner.Controls.Add(_startupStatus, 0, 3); inner.SetColumnSpan(_startupStatus, 4);
        card.Controls.Add(inner); return card;
    }

    private Panel Card(int height) => new() { Dock = DockStyle.Fill, Height = height, BackColor = PanelColor, Padding = new Padding(22), Margin = new Padding(0, 0, 0, 16) };
    private static void StyleTextBox(TextBox box) { box.BackColor = FieldColor; box.ForeColor = Color.White; box.BorderStyle = BorderStyle.FixedSingle; box.Font = new Font("Segoe UI", 9.5f); box.Margin = new Padding(0, 4, 0, 0); }
    private static void StyleCheck(CheckBox box) { box.ForeColor = Color.White; box.AutoSize = true; box.Margin = new Padding(0, 16, 0, 0); }
    private static Button StyledButton(string text, bool primary) => new() { Text = text, FlatStyle = FlatStyle.Flat, BackColor = primary ? Teal : Color.FromArgb(58, 57, 62), ForeColor = Color.White, Font = new Font("Segoe UI Semibold", 9, FontStyle.Bold), FlatAppearance = { BorderColor = primary ? Teal : Border, BorderSize = 1 }, Cursor = Cursors.Hand, Padding = new Padding(8, 3, 8, 3), UseVisualStyleBackColor = false };
    private static void AddField(TableLayoutPanel panel, string label, TextBox box, int column, int row) { var wrapper = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, Margin = new Padding(0, 10, 8, 0) }; wrapper.Controls.Add(new Label { Text = label.ToUpperInvariant(), AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8, FontStyle.Bold) }); StyleTextBox(box); box.Dock = DockStyle.Fill; wrapper.Controls.Add(box); panel.Controls.Add(wrapper, column, row); }
    private static void AddNumericField(TableLayoutPanel panel, string label, NumericUpDown input, int column) { var wrapper = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 2, Margin = new Padding(8, 8, 0, 0) }; wrapper.Controls.Add(new Label { Text = label.ToUpperInvariant(), AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8, FontStyle.Bold) }); input.BackColor = FieldColor; input.ForeColor = Color.White; input.BorderStyle = BorderStyle.FixedSingle; input.Dock = DockStyle.Top; input.ValueChanged += (_, _) => { }; wrapper.Controls.Add(input); panel.Controls.Add(wrapper, column, 1); }

    private void LoadConfigIntoControls()
    {
        _loading = true;
        if (!_config.StartupPreferenceSet) { _config.StartWithWindows = true; _config.StartupPreferenceSet = true; }
        _hardwarePath.Text = _config.HardwareDatabasePath; _manufacturingPath.Text = _config.ManufacturingDatabasePath; _owner.Text = _config.SupabaseUrl; _repository.Text = _config.PublishableKey; _branch.Text = _config.UploaderEmail;
        _storedPassword = CredentialStore.Read() ?? ""; _password.Text = _storedPassword;
        _interval.Value = Math.Clamp(_config.CheckIntervalMinutes, 1, 1440); _stable.Value = Math.Clamp(_config.StableSeconds, 10, 3600); _automatic.Checked = _config.AutomaticSync;
        var startupWasRegistered = StartupManager.IsRegisteredForCurrentApp();
        _startup.Checked = _config.StartWithWindows || startupWasRegistered;
        if (_startup.Checked)
        {
            try { StartupManager.SetEnabled(true); _config.StartWithWindows = true; _config.Save(); }
            catch (Exception exception) { SetGlobalStatus($"Could not update Windows startup: {exception.Message}", true); }
        }
        _loading = false;
        UpdateStartupStatus();
        UpdateLastStatuses();
    }

    private void SaveControls()
    {
        _config.HardwareDatabasePath = _hardwarePath.Text.Trim(); _config.ManufacturingDatabasePath = _manufacturingPath.Text.Trim(); _config.SupabaseUrl = _owner.Text.Trim(); _config.PublishableKey = _repository.Text.Trim(); _config.UploaderEmail = _branch.Text.Trim();
        _config.CheckIntervalMinutes = (int)_interval.Value; _config.StableSeconds = (int)_stable.Value; _config.AutomaticSync = _automatic.Checked;
        try { StartupManager.SetEnabled(_startup.Checked); _config.StartWithWindows = _startup.Checked; _config.StartupPreferenceSet = true; } catch (Exception exception) { MessageBox.Show(this, exception.Message, "Startup setting", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        _config.Save(); RestartTimer();
        UpdateStartupStatus();
    }

    private async Task RunSyncAllAsync(bool force)
    {
        if (_busy) return; SaveControls(); SetBusy(true); SetGlobalStatus("Preparing synchronization…", false);
        try
        {
            var results = await _sync.SyncAllAsync(force);
            UpdateLastStatuses();
            foreach (var result in results) { StatusLabel(result.Kind).Text = result.Message; StatusLabel(result.Kind).ForeColor = result.Message.Contains("failed", StringComparison.OrdinalIgnoreCase) ? Color.FromArgb(255, 155, 144) : Muted; }
            var errors = results.Where(result => !result.Uploaded && result.Message.Contains("failed", StringComparison.OrdinalIgnoreCase)).ToArray();
            if (errors.Length == 0) SetGlobalStatus("Synchronization check complete.", false);
            else
            {
                var details = string.Join(Environment.NewLine + Environment.NewLine, errors.Select(result => result.Message));
                SetGlobalStatus(errors[0].Message, true);
                if (force) MessageBox.Show(this, $"The upload did not complete.\n\n{details}\n\nThe same details were written to the uploader log.", "Synchronization failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception exception)
        {
            SetGlobalStatus(exception.Message, true);
            AppLog.Write($"Synchronization failed: {exception.Message}");
            if (force) MessageBox.Show(this, exception.Message, "Synchronization failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally { SetBusy(false); }
    }

    private async Task ValidateAsync(DatabaseKind kind)
    {
        if (_busy) return; SaveControls(); SetBusy(true);
        try { var result = await _sync.ValidateOnlyAsync(kind); StatusLabel(kind).Text = result.Message; StatusLabel(kind).ForeColor = Color.FromArgb(113, 215, 222); }
        catch (Exception exception) { StatusLabel(kind).Text = exception.Message; StatusLabel(kind).ForeColor = Color.FromArgb(255, 155, 144); }
        finally { SetBusy(false); }
    }

    private async Task TestConnectionAsync()
    {
        SaveControls();
        if (!string.IsNullOrWhiteSpace(_password.Text) && _password.Text != _storedPassword) SavePassword();
        SetBusy(true);
        try { var repository = await _sync.TestSupabaseAsync(); SetGlobalStatus($"Connected to {repository}.", false); }
        catch (Exception exception) { SetGlobalStatus(exception.Message, true); }
        finally { SetBusy(false); }
    }

    private void SavePassword()
    {
        var value = _password.Text;
        if (string.IsNullOrWhiteSpace(value)) { SetGlobalStatus("Enter a Supabase password before saving.", true); return; }
        try { CredentialStore.Save(value); _storedPassword = value; SetGlobalStatus("Supabase password saved securely on this computer.", false); }
        catch (Exception exception) { SetGlobalStatus(exception.Message, true); }
    }

    private void SelectDatabase(TextBox target)
    {
        using var dialog = new OpenFileDialog { Filter = "SQLite databases (*.db;*.sqlite;*.sqlite3)|*.db;*.sqlite;*.sqlite3|All files (*.*)|*.*", CheckFileExists = true, Title = "Select SQLite database" };
        if (File.Exists(target.Text)) dialog.InitialDirectory = Path.GetDirectoryName(target.Text);
        if (dialog.ShowDialog(this) == DialogResult.OK) { target.Text = dialog.FileName; SaveControls(); }
    }

    private void UpdateLastStatuses()
    {
        if (_config.LastHardwareUpload is not null) { _hardwareStatus.Text = $"Last uploaded {_config.LastHardwareUpload:MMM d, yyyy · h:mm tt}"; _hardwareStatus.ForeColor = Color.FromArgb(113, 215, 222); }
        if (_config.LastManufacturingUpload is not null) { _manufacturingStatus.Text = $"Last uploaded {_config.LastManufacturingUpload:MMM d, yyyy · h:mm tt}"; _manufacturingStatus.ForeColor = Color.FromArgb(113, 215, 222); }
    }

    private void UpdateStartupStatus()
    {
        var registered = StartupManager.IsRegisteredForCurrentApp();
        _startupStatus.Text = registered ? "✓ Registered with Windows Startup · opens minimized in the notification area" : "Not registered with Windows Startup";
        _startupStatus.ForeColor = registered ? Color.FromArgb(113, 215, 222) : Muted;
    }

    private void SetBusy(bool value) { _busy = value; _syncAllButton.Enabled = !value; UseWaitCursor = value; }
    private void SetGlobalStatus(string text, bool error) { _globalStatus.Text = text; _globalStatus.ForeColor = error ? Color.FromArgb(255, 155, 144) : Muted; }
    private Label StatusLabel(DatabaseKind kind) => kind == DatabaseKind.Hardware ? _hardwareStatus : _manufacturingStatus;
    private void RestartTimer() { _timer.Stop(); _timer.Interval = Math.Max(1, _config.CheckIntervalMinutes) * 60 * 1000; if (_config.AutomaticSync) _timer.Start(); }
    private void HideToTray() { Hide(); _tray.ShowBalloonTip(1500, "Valve Database Uploader", "Synchronization continues in the background.", ToolTipIcon.Info); }
    private void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private void OnClosing(object? sender, FormClosingEventArgs eventArgs) { SaveControls(); if (!_exitRequested && _config.AutomaticSync && eventArgs.CloseReason == CloseReason.UserClosing) { eventArgs.Cancel = true; HideToTray(); } else { _timer.Stop(); _tray.Visible = false; } }
    private void Ui(Action action) { if (IsDisposed) return; if (InvokeRequired) BeginInvoke(action); else action(); }
    private static T? FindControl<T>(Control root, string name) where T : Control { foreach (Control child in root.Controls) { if (child is T match && match.Name == name) return match; var nested = FindControl<T>(child, name); if (nested is not null) return nested; } return null; }
    private static Image? LoadLogo() { using var stream = typeof(MainForm).Assembly.GetManifestResourceStream("ValveDatabaseUploader.Assets.cvs-controls-logo.png"); if (stream is null) return null; using var image = Image.FromStream(stream); return new Bitmap(image); }
}
