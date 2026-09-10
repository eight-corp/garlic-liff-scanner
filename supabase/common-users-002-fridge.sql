-- Run AFTER deploying the compatible UI, setting common PINs, and reviewing roles.
-- Transactional cutover: existing open tabs must reload and sign in again.
begin;
do $$
begin
 if (select migrated from business_private.apps where app_id='garlic_fridge') then
 raise exception '冷蔵庫管理は既に切替済みです。このSQLは再実行しないでください。'; end if;
 if not exists(select 1 from business_private.users u join public.workers w using(worker_id)
 where u.system_admin and u.enabled and u.pin_hash is not null)
 then raise exception '全体管理者の初期設定を先に完了してください。'; end if;
 if exists(select 1 from business_private.permissions p join business_private.users u using(worker_id)
 join public.workers w using(worker_id) where p.app_id='garlic_fridge' and u.enabled and u.pin_hash is null)
 then raise exception '利用予定ユーザー全員の共通PIN設定、または不要な利用権限の解除を先に完了してください。'; end if;
end $$;
create table if not exists business_private.fridge_migration_backup(kind text,object_name text,definition text,primary key(kind,object_name));
revoke all on business_private.fridge_migration_backup from public,anon,authenticated;

-- Preserve each installed business function exactly; add a permission-checking wrapper.
do $$
declare r record; v_name text; v_role text; v_args text; v_call text; v_identity text; v_result text;
begin
 for v_name,v_role in select * from (values
 ('upsert_pallet','operator'),('delete_pallet_rpc','operator'),('record_inbound','operator'),
 ('record_outbound','operator'),('start_move','operator'),('complete_move','operator'),
 ('save_app_setting','admin'),('save_standards','admin'),('save_coolers','admin'),('save_location_grid','admin')) x(n,r) loop
  if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=v_name)<>1 then
   raise exception '関数 % が存在しないか複数あります。現行DBの定義確認が必要です。',v_name;
  end if;
  select * into r from pg_proc where pronamespace='public'::regnamespace and proname=v_name;
  v_args:=pg_get_function_arguments(r.oid); v_identity:=pg_get_function_identity_arguments(r.oid); v_result:=pg_get_function_result(r.oid);
  if v_result<>'jsonb' then raise exception '関数 % の戻り値が想定と異なります。',v_name; end if;
  select string_agg('$'||n,',' order by n) into v_call from generate_series(1,r.pronargs) n;
  insert into business_private.fridge_migration_backup values('function',v_name,pg_get_functiondef(r.oid));
  execute format('alter function public.%I(%s) set schema business_private',v_name,v_identity);
  execute format('revoke all on function business_private.%I(%s) from public,anon,authenticated',v_name,v_identity);
  execute format('create function public.%I(%s) returns jsonb language plpgsql security definer set search_path=pg_catalog,business_private as $body$ begin perform business_private.require_app(''garlic_fridge'',%L,%s); return business_private.%I(%s); end $body$',
   v_name,v_args,v_role,case when v_name='upsert_pallet' then 'coalesce(p_payload->>''workerId'',p_payload->>''worker_id'')' else 'p_worker_id' end,v_name,v_call);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',v_name,v_identity);
  execute format('grant execute on function public.%I(%s) to anon,authenticated',v_name,v_identity);
 end loop;
 -- No app-local worker editing after cutover; common management owns new users and roles.
 for r in select oid,oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname='save_workers' loop
 insert into business_private.fridge_migration_backup values('function','save_workers',pg_get_functiondef(r.oid));
 execute format('revoke all on function %s from public,anon,authenticated',r.signature);
 end loop;
end $$;

-- Enforce writes even if another legacy RPC exists: a SECURITY DEFINER function cannot bypass this trigger.
create or replace function business_private.fridge_write_guard()
returns trigger language plpgsql security definer set search_path=pg_catalog,business_private
as $$
declare v_role text:=coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','');
begin
 -- Trusted SQL Editor / background DB jobs and service-role maintenance retain their existing route.
 if v_role in ('anon','authenticated') and not public.business_can('garlic_fridge',TG_ARGV[0]) then
 raise exception 'この操作の権限がありません。' using errcode='42501'; end if;
 return case when TG_OP='DELETE' then OLD else NEW end;
end $$;
revoke all on function business_private.fridge_write_guard() from public,anon,authenticated;
do $$
declare v_table text; r record; v_role text;
begin
 for v_table,v_role in select * from (values
 ('standards','admin'),('coolers','admin'),('locations','admin'),('pallets','operator'),
 ('pallet_details','operator'),('placements','operator'),('moving_pallets','operator'),
 ('operation_histories','operator'),('app_settings','admin')) x(t,r) loop
  for r in select policyname,cmd,roles,qual,with_check,permissive from pg_policies where schemaname='public' and tablename=v_table loop
   insert into business_private.fridge_migration_backup values('policy',v_table||'.'||r.policyname,to_jsonb(r)::text);
   execute format('drop policy %I on public.%I',r.policyname,v_table);
  end loop;
  execute format('alter table public.%I enable row level security',v_table);
  execute format('create policy business_read on public.%I for select to anon,authenticated using(public.business_can(''garlic_fridge'',''viewer''))',v_table);
  execute format('revoke insert,update,delete,truncate,references,trigger on public.%I from anon,authenticated',v_table);
  execute format('grant select on public.%I to anon,authenticated',v_table);
  execute format('create trigger business_write_guard before insert or update or delete on public.%I for each row execute function business_private.fridge_write_guard(%L)',v_table,v_role);
 end loop;
 -- The view must respect RLS on its underlying pallet_details table.
 alter view public.pallet_detail_view set (security_invoker=true);
end $$;
update business_private.apps set migrated=true where app_id='garlic_fridge';
insert into business_private.audit(action,detail) values('migrate_app','{"appId":"garlic_fridge"}');
commit;
