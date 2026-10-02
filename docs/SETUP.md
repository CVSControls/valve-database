# Finish the Supabase migration

The old JosephSpratt-3D application is unchanged. The new repository contains only application source/assets, not the old SQLite files or password hashes.

## Supabase SQL and accounts

Run [supabase/setup.sql](../supabase/setup.sql) in the new project's SQL Editor (already completed during this migration).

Create the first admin in Authentication → Users, then approve it:

```sql
update public.profiles set role='admin',is_active=true
where lower(email)=lower('YOUR-ADMIN-EMAIL')
returning email,role,is_active;
```

Disable public signups. New profiles start disabled even if signup is accidentally enabled. Recreate existing users as fresh email/password accounts; the public repository login hashes are not imported.

## GitHub Pages

Sign in as the CVSControls repository owner. Open Settings → Pages → Source → **GitHub Actions**. If Pages is already enabled by this migration, no setting change is needed.

Run Actions → Deploy GitHub Pages if deployment did not start automatically. Only `client/dist` is deployed; Windows builds use a separate workflow.

Site: https://cvscontrols.github.io/valve-database/

## Server-side account management

Login, database uploads, display settings, and matching work using the SQL setup. Creating accounts/changing roles/resetting passwords **from the website** also requires this Edge Function:

1. In Supabase → Edge Functions, create **manage-users**.
2. Paste the complete [index.ts](../supabase/functions/manage-users/index.ts) source.
3. Deploy with the platform's legacy JWT verification disabled. The function itself validates every bearer token through Supabase Auth, then checks an active administrator profile. Do not remove those checks.

Alternatively, use an authenticated Supabase CLI:

```bash
supabase functions deploy manage-users --project-ref wypktkhfeiaebllftxll --no-verify-jwt
```

The function uses Supabase's server-only `SUPABASE_SERVICE_ROLE_KEY` environment variable. Never put that key in GitHub, chat, the Windows app, or the website. Until the function is deployed, manage users through the Supabase dashboard/SQL Editor.

Active admins cannot be demoted/disabled from website controls; deliberate admin changes require the Supabase dashboard.

## Databases and uploader

Log into the new website as admin → Databases → upload both current SQLite files. Alternatively use the migrated Windows uploader for the initial upload.

For desktop sync, create a dedicated account in Authentication → Users and approve it:

```sql
update public.profiles set role='uploader',is_active=true
where lower(email)=lower('YOUR-UPLOADER-EMAIL')
returning email,role,is_active;
```

Uploader accounts can upload/activate snapshots, but cannot manage users, settings, or audit logs. Use a viewer/admin account to sign into the website.

The uploader uses email/password and the publishable project key, not a GitHub token. The password is saved in Windows Credential Manager; the app can start at Windows user sign-in and sync automatically. See [uploader setup](../uploader/README.md).

Browsers check Supabase every three minutes. A reload-view notice appears when data/settings change, without clearing unfinished dropdown selections or edits. A normal page reload also fetches the latest active versions.

The first admin visit seeds an empty settings row with sanitized previous display customizations/tolerances. Subsequent changes are saved only in Supabase.

## Cutover and security

- Test sign-in, a known valve/actuator match, a manufacturing job, and both initial uploads.
- Test user management after deploying the Edge Function.
- Disable automatic GitHub sync in the old uploader when switching to the new one.
- Approved viewers download complete SQLite snapshots into browser memory and can save/copy data they are allowed to view. Private storage does not prevent authorized users copying data.
- The app closes databases on logout and no longer stores them in IndexedDB.
- Snapshots are immutable/hash-named, limited to 50 MiB. After successful activation, website uploads and the updated Windows uploader delete replaced snapshots through the Storage API. Active files and pending uploads are protected. Failed cleanup is retried on the next upload. Run the updated `supabase/setup.sql` in the SQL Editor on existing installations to enable cleanup; this does not reset accounts or settings. Deleted snapshots cannot be recovered from this bucket: retain your local database backups.
- Clients validate SQLite integrity/schema and checksums. Postgres enforces role, object existence, path, size, and metadata activation; it does not itself parse SQLite or verify the client-supplied validation report.
- Old database copies and hashes remain in the old public GitHub history. Removing that history is a separate destructive operation and has not been done.
