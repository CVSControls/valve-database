# CVS Controls Valve Database Uploader — Supabase edition

## Download

Download the ZIP from [Releases](https://github.com/CVSControls/valve-database/releases), or open [Build Windows Uploader](https://github.com/CVSControls/valve-database/actions/workflows/build-uploader.yml), choose the newest successful run, and download `ValveDatabaseUploader-win-x64` under Artifacts.

Extract it into a permanent folder and run `ValveDatabaseUploader.exe`. Do not run from inside the ZIP.

The self-contained app requires no installed .NET runtime, Git, or Python. It is unsigned: Windows SmartScreen/Smart App Control may block it according to your computer's policy. This migration does not bypass Windows security; follow your company's IT policy.

## Setup

1. Use **Choose file** to select each live database, then **Validate** each one. Paths are not hardcoded.
2. Keep the prefilled Supabase URL and publishable key.
3. Enter the approved uploader account's email/password.
4. Click **Save password**, then **Test connection**.
5. Click **Sync both now** for the initial upload.
6. Enable **Automatic sync** and **Open uploader when I sign in to Windows**.

Create/approve the account using [the setup guide](../docs/SETUP.md). A viewer account cannot upload. Do not enter a GitHub token or Supabase secret/service-role key.

The password is stored under `CVSControls.ValveDatabaseUploader.SupabasePassword` in Windows Credential Manager, never in config.json. Other settings/logs are under `%LOCALAPPDATA%\\CVS Controls\\Valve Database Supabase Uploader\\`.

The new config does not reuse the GitHub uploader's token or last-upload hashes. Disable old automatic sync after cutover. Startup registration points to the currently configured uploader; keep its executable in a permanent location.

## Behavior

Safe SQLite online-backup snapshots are checked for integrity/schema before uploading. Automatic checks wait for stable files and skip unchanged content. Immutable hash-named snapshots are uploaded to private Supabase Storage; the successful hash is saved only after metadata activation succeeds.

No database commits or Pages deployment requests are made. Website refresh checks run every three minutes; reload the current view when notified.

Startup runs at **Windows user sign-in**, minimized to the notification area. This is not a system service running before anyone logs in.
