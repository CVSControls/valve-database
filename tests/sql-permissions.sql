\set ON_ERROR_STOP on
begin;
create function public.test_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message;end if;end $$;
insert into auth.users(id,email) values
('00000000-0000-0000-0000-000000000001','admin@example.test'),
('00000000-0000-0000-0000-000000000002','viewer@example.test'),
('00000000-0000-0000-0000-000000000003','uploader@example.test'),
('00000000-0000-0000-0000-000000000004','disabled@example.test');
select public.test_assert((select bool_and(not is_active) from public.profiles),'New accounts must start disabled');
update public.profiles set is_active=true,role=case email when 'admin@example.test' then 'admin' when 'uploader@example.test' then 'uploader' else 'user' end where email<>'disabled@example.test';
set local role anon;
do $$ begin
 begin perform * from public.app_settings;raise exception 'Anonymous settings access allowed';exception when insufficient_privilege then null;end;
 begin perform public.save_settings('{}',0);raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
select public.test_assert((select count(*)=0 from public.app_settings),'Disabled account sees settings');
select public.test_assert((select count(*)=0 from public.database_sources),'Disabled account sees sources');
select public.test_assert((select count(*)=1 from public.profiles),'Own disabled profile must be readable');
do $$ begin
 begin update public.profiles set role='admin';raise exception 'Role escalation allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
select public.test_assert((select count(*)=0 from public.app_settings),'Uploader sees settings');
insert into storage.objects(bucket_id,name,metadata) values ('valve-databases','hardware_configurator/'||repeat('a',64)||'.db','{"size":512}');
select public.activate_database('hardware_configurator','hardware_configurator/'||repeat('a',64)||'.db',repeat('a',64),'hardware.db',512,'{"valid":true}');
select public.test_assert((select count(*)=1 from public.database_sources),'Source activation failed');
select public.test_assert((select count(*)=0 from public.audit_events),'Uploader sees audit');
do $$ begin
 begin perform public.save_settings('{}',0);raise exception 'Uploader can edit settings';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name) values ('valve-databases','bad/path.db');raise exception 'Bad path accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
select public.test_assert((select count(*)=1 from public.app_settings),'Viewer cannot read settings');
select public.test_assert((select count(*)=1 from public.database_sources),'Viewer cannot read source');
select public.test_assert((select count(*)=1 from storage.objects),'Viewer cannot download private source');
select public.test_assert((select count(*)=1 from public.profiles),'Viewer sees other profiles');
do $$ begin
 begin perform public.activate_database('hardware_configurator','hardware_configurator/'||repeat('a',64)||'.db',repeat('a',64),'hardware.db',512,'{}');raise exception 'Viewer can activate';exception when insufficient_privilege then null;end;
 begin insert into storage.objects(bucket_id,name,metadata) values ('valve-databases','manufacturing_log/'||repeat('b',64)||'.db','{"size":512}');raise exception 'Viewer can upload';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
select public.test_assert((select count(*)=4 from public.profiles),'Admin cannot list profiles');
select public.test_assert(public.save_settings('{"configuratorSettings":{"mountingTolerance":0.025}}',0)=1,'Settings revision not incremented');
do $$ begin
 begin perform public.save_settings('{}',0);raise exception 'Stale revision accepted';exception when serialization_failure then null;end;
 begin perform public.activate_database('hardware_configurator','hardware_configurator/'||repeat('a',64)||'.db',repeat('a',64),'hardware.db',513,'{}');raise exception 'Bad file size accepted';
 exception when raise_exception then if sqlerrm<>'Upload missing or file size does not match' then raise;end if;end;
end $$;
update storage.objects set name='overwritten.db';
delete from storage.objects;
select public.test_assert((select count(*)=1 from storage.objects),'Immutable snapshot changed');
select public.test_assert((select count(*)=2 from public.audit_events),'Server audit events missing');
reset role;
update auth.users set email='renamed@example.test' where id='00000000-0000-0000-0000-000000000001';
select public.test_assert((select role='admin' and is_active and email='renamed@example.test' from public.profiles where id='00000000-0000-0000-0000-000000000001'),'Email sync lost privileges');
rollback;
\echo 'PASS: anonymous, disabled, viewer, uploader, admin, immutable storage, optimistic revisions, audit, profile sync'
