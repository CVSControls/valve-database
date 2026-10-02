# CVS Controls · Valve Database Viewer

CVS-styled valve search, stock hardware matching, manufacturing history, and administration. The website is hosted on GitHub Pages; logins, settings, and private SQLite snapshots are hosted in Supabase.

Database files and old login hashes are **not** stored in this repository or the Pages build. Supabase access requires an active approved account. The publishable key is intentionally public; never put a secret/service-role key in the site or uploader.

## Deployment

Follow [the setup guide](docs/SETUP.md). Pages must use **GitHub Actions**, not a branch/README source.

Website: https://cvscontrols.github.io/valve-database/

Download the Windows sync app from [Releases](https://github.com/CVSControls/valve-database/releases), or from the latest successful [Build Windows Uploader](https://github.com/CVSControls/valve-database/actions/workflows/build-uploader.yml) artifact. [Uploader instructions](uploader/README.md).

## Development

Node.js 22 or newer:

```bash
npm ci
npm run dev
npm test
npm run build
node scripts/check-pages-build.mjs
```

Project URL/publishable key: `client/src/cloud.ts`. Development: http://localhost:5173.

Windows uploader requires .NET 10 to build, but its self-contained download needs no installed runtime:

```bash
dotnet test uploader/ValveDatabaseUploader.Tests/ValveDatabaseUploader.Tests.csproj -c Release
dotnet build uploader/ValveDatabaseUploader/ValveDatabaseUploader.csproj -c Release
```

CI checks the application and role policies using disposable PostgreSQL and generated SQLite fixtures. Never run the SQL files under `tests/` in a real Supabase project.
