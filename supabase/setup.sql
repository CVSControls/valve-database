-- Valve Database Viewer: run in the NEW Supabase project's SQL Editor.
-- No passwords or API keys belong in this script.
-- New accounts start DISABLED until an administrator approves them.
-- Existing application data is not imported by this script.
begin;

create schema if not exists valve_private;
revoke all on schema valve_private from public, anon, authenticated;
grant usage on schema valve_private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('user','admin','uploader')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function valve_private.sync_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,email)
  values (new.id,coalesce(new.email,''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function valve_private.sync_profile() from public, anon, authenticated;
drop trigger if exists valve_profile_sync on auth.users;
create trigger valve_profile_sync after insert or update of email on auth.users
for each row execute function valve_private.sync_profile();
insert into public.profiles (id,email)
select id,coalesce(email,'') from auth.users on conflict (id) do nothing;

-- Never trust client-editable user metadata for authorization.
create or replace function valve_private.app_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active;
$$;
revoke all on function valve_private.app_role() from public, anon, authenticated;
grant execute on function valve_private.app_role() to authenticated;

create table if not exists public.app_settings (
  id integer primary key check (id = 1),
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.database_sources (
  source_type text primary key check (source_type in ('hardware_configurator','manufacturing_log')),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  original_file_name text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  validation_report jsonb not null default '{}'::jsonb,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references auth.users(id) on delete set null
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  username text,
  action text not null,
  entity_type text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.database_sources enable row level security;
alter table public.audit_events enable row level security;

-- Browser accounts cannot directly change roles, settings, or source metadata.
revoke all on public.profiles, public.app_settings, public.database_sources,
  public.audit_events from anon, authenticated;
grant select on public.profiles, public.app_settings, public.database_sources,
  public.audit_events to authenticated;
-- Reserved for trusted server-side account management, never the website.
grant all on public.profiles, public.app_settings, public.database_sources,
  public.audit_events to service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

drop policy if exists valve_profiles_read on public.profiles;
create policy valve_profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or valve_private.app_role() = 'admin');
drop policy if exists valve_settings_read on public.app_settings;
create policy valve_settings_read on public.app_settings for select to authenticated
using (valve_private.app_role() in ('user','admin'));
drop policy if exists valve_sources_read on public.database_sources;
create policy valve_sources_read on public.database_sources for select to authenticated
using (valve_private.app_role() in ('user','admin','uploader'));
drop policy if exists valve_audit_read on public.audit_events;
create policy valve_audit_read on public.audit_events for select to authenticated
using (valve_private.app_role() = 'admin');

-- Only replaced snapshots are eligible for deletion; uploads in progress are not.
create table if not exists valve_private.retired_databases (
  storage_path text primary key,
  source_type text not null
);
revoke all on valve_private.retired_databases from public, anon, authenticated;

create or replace function valve_private.can_delete_database(p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare kind text := split_part(p_path,'/',1);
begin
  if coalesce(valve_private.app_role(),'') not in ('admin','uploader')
     or kind not in ('hardware_configurator','manufacturing_log') then return false; end if;
  -- Serialize activation and deletion, including reactivation of an old hash.
  perform pg_advisory_xact_lock(hashtextextended('valve-database:' || kind,0));
  return exists (select 1 from valve_private.retired_databases where storage_path = p_path)
    and not exists (select 1 from public.database_sources where storage_path = p_path);
end;
$$;
revoke all on function valve_private.can_delete_database(text) from public, anon;
grant execute on function valve_private.can_delete_database(text) to authenticated;

create or replace function public.retired_database_paths(p_type text)
returns table(storage_path text) language sql security definer set search_path = '' as $$
  select r.storage_path from valve_private.retired_databases r
  join storage.objects o on o.bucket_id = 'valve-databases' and o.name = r.storage_path
  where r.source_type = p_type and valve_private.app_role() in ('admin','uploader')
    and not exists (select 1 from public.database_sources d where d.storage_path = r.storage_path);
$$;
revoke all on function public.retired_database_paths(text) from public, anon;
grant execute on function public.retired_database_paths(text) to authenticated;

-- Private, hash-named SQLite files.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('valve-databases','valve-databases',false,52428800,array['application/octet-stream'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists valve_files_read on storage.objects;
create policy valve_files_read on storage.objects for select to authenticated
using (bucket_id = 'valve-databases'
  and valve_private.app_role() in ('user','admin','uploader'));
drop policy if exists valve_files_insert on storage.objects;
create policy valve_files_insert on storage.objects for insert to authenticated
with check (bucket_id = 'valve-databases'
  and valve_private.app_role() in ('admin','uploader')
  and name ~ '^(hardware_configurator|manufacturing_log)/[a-f0-9]{64}[.]db$');
-- No UPDATE policy. DELETE only permits retired, non-active snapshots.
drop policy if exists valve_files_delete on storage.objects;
create policy valve_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'valve-databases' and valve_private.can_delete_database(name));

create or replace function public.save_settings(p_value jsonb,p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare next_revision bigint;
begin
  if valve_private.app_role() is distinct from 'admin' then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object'
     or pg_column_size(p_value) > 1048576 then
    raise exception 'Invalid settings';
  end if;
  if exists (select 1 from jsonb_object_keys(p_value) as k(key)
    where key not in ('displaySections','displayFields','referenceDisplays','configuratorSettings')) then
    raise exception 'Unsupported settings key';
  end if;
  update public.app_settings set value = p_value, revision = revision + 1,
    updated_at = now() where id = 1 and revision = p_revision
    returning revision into next_revision;
  if next_revision is null then
    raise exception 'Settings changed. Reload before saving.' using errcode = '40001';
  end if;
  insert into public.audit_events (actor_id,username,action,entity_type)
  select auth.uid(),email,'settings.update','app_settings'
  from public.profiles where id = auth.uid();
  return next_revision;
end;
$$;

create or replace function public.activate_database(
  p_type text,p_path text,p_sha text,p_name text,p_size bigint,p_report jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare object_size bigint; previous_path text;
begin
  if coalesce(valve_private.app_role(),'') not in ('admin','uploader') then
    raise exception 'Uploader access required' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('hardware_configurator','manufacturing_log')
    or p_sha is null or p_sha !~ '^[a-f0-9]{64}$'
    or p_path is distinct from p_type || '/' || p_sha || '.db'
    or p_size is null or p_size <= 0 or p_size > 52428800
    or p_name is null or length(p_name) not between 1 and 255
    or p_report is null or jsonb_typeof(p_report) <> 'object'
    or pg_column_size(p_report) > 262144 then
    raise exception 'Invalid database metadata';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('valve-database:' || p_type,0));
  select storage_path into previous_path from public.database_sources where source_type = p_type;
  select (metadata ->> 'size')::bigint into object_size
    from storage.objects where bucket_id = 'valve-databases' and name = p_path;
  if object_size is distinct from p_size then
    raise exception 'Upload missing or file size does not match';
  end if;
  if previous_path is not null and previous_path <> p_path then
    insert into valve_private.retired_databases values (previous_path,p_type)
      on conflict (storage_path) do nothing;
  end if;
  delete from valve_private.retired_databases where storage_path = p_path;
  -- SQLite integrity/schema and SHA must also be checked by the uploader/viewer.
  -- The report is client-supplied, not server-verified SQLite validation.
  insert into public.database_sources (
    source_type,storage_path,sha256,original_file_name,size_bytes,
    validation_report,uploaded_at,uploaded_by
  ) values (p_type,p_path,p_sha,p_name,p_size,p_report,now(),auth.uid())
  on conflict (source_type) do update set storage_path = excluded.storage_path,
    sha256 = excluded.sha256, original_file_name = excluded.original_file_name,
    size_bytes = excluded.size_bytes, validation_report = excluded.validation_report,
    uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by;
  insert into public.audit_events (actor_id,username,action,entity_type,details)
  select auth.uid(),email,'database.activate',p_type,
    jsonb_build_object('sha256',p_sha,'size_bytes',p_size)
  from public.profiles where id = auth.uid();
end;
$$;
revoke all on function public.save_settings(jsonb,bigint)
  from public, anon, authenticated;
revoke all on function public.activate_database(text,text,text,text,bigint,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_settings(jsonb,bigint) to authenticated;
grant execute on function public.activate_database(text,text,text,text,bigint,jsonb)
  to authenticated;

commit;

-- NEXT: create your account using Authentication > Users > Add user.
-- Then run this separately, replacing the email with YOUR actual login email:
-- update public.profiles set role = 'admin', is_active = true
-- where lower(email) = lower('YOUR-EMAIL-HERE');
-- Ordinary viewer accounts: role = 'user', is_active = true.
-- Dedicated desktop sync account: role = 'uploader', is_active = true.
