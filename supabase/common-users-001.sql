-- Phase 1: additive shared identities and application permissions.
-- Does not change legacy workers/PINs or enable enforcement on existing applications.
begin;
create schema if not exists business_private;
revoke all on schema business_private from public, anon, authenticated;
create extension if not exists pgcrypto with schema extensions;

create table if not exists business_private.users (
  worker_id text primary key references public.workers(worker_id),
  enabled boolean not null default true,
  system_admin boolean not null default false,
  pin_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists business_private.apps (
  app_id text primary key,
  app_name text not null,
  migrated boolean not null default false,
  display_order integer not null
);
insert into business_private.apps values
 ('garlic_fridge','にんにく冷蔵庫管理',false,1),
 ('black_garlic','黒にんにく室管理',false,2),
 ('garlic_drying','乾燥設備在庫管理',false,3),
 ('frozen_ingredients','冷食原材料管理',false,4),
 ('rice_shipping','米穀出荷管理',false,5)
on conflict (app_id) do nothing;
create table if not exists business_private.permissions (
  worker_id text not null references business_private.users(worker_id),
  app_id text not null references business_private.apps(app_id),
  role text not null check(role in ('admin','operator','viewer')),
  primary key(worker_id,app_id)
);
create table if not exists business_private.sessions (
  token_hash text primary key,
  worker_id text not null references business_private.users(worker_id),
  expires_at timestamptz not null,
  bootstrap boolean not null default false
);
create index if not exists business_sessions_worker on business_private.sessions(worker_id);
create table if not exists business_private.audit (
  id bigint generated always as identity primary key,
  actor_id text,
  action text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
insert into business_private.users(worker_id,enabled)
 select worker_id,active from public.workers on conflict do nothing;
-- Preserve existing refrigerator roles as initial explicit assignments.
insert into business_private.permissions(worker_id,app_id,role)
 select worker_id,'garlic_fridge',role from public.workers
 on conflict do nothing;
revoke all on all tables in schema business_private from public,anon,authenticated;

create or replace function business_private.actor(p_bootstrap boolean default false)
returns text language plpgsql security definer
set search_path = pg_catalog, business_private, extensions
as $$
declare v_token text; v_actor text;
begin
 v_token := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-business-session','');
 if length(v_token) <> 64 then return null; end if;
 select s.worker_id into v_actor from business_private.sessions s
 join business_private.users u using(worker_id)
 join public.workers w using(worker_id)
 where s.token_hash=encode(extensions.digest(v_token,'sha256'),'hex')
 and s.expires_at>now() and s.bootstrap=p_bootstrap and u.enabled;
 return v_actor;
end $$;

create or replace function business_private.require_admin()
returns text language plpgsql security definer
set search_path=pg_catalog,business_private
as $$
declare v_actor text := business_private.actor();
begin
 if v_actor is null or not exists(select 1 from business_private.users where worker_id=v_actor and system_admin)
 then raise exception '全体管理者としてログインしてください。' using errcode='42501'; end if;
 return v_actor;
end $$;

create or replace function public.business_session()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private
as $$
declare v_actor text:=business_private.actor(); v_result jsonb;
begin
 if v_actor is null then return jsonb_build_object('ok',false,'error','ログインしてください。'); end if;
 select jsonb_build_object('ok',true,'workerId',w.worker_id,'workerName',w.worker_name,
 'systemAdmin',u.system_admin,'permissions',coalesce((select jsonb_object_agg(p.app_id,p.role)
 from business_private.permissions p where p.worker_id=v_actor),'{}'::jsonb))
 into v_result from business_private.users u join public.workers w using(worker_id) where u.worker_id=v_actor;
 return v_result;
end $$;

create or replace function public.business_login_users(p_app_id text)
returns jsonb language sql security definer
set search_path=pg_catalog,business_private
as $$
 select coalesce(jsonb_agg(jsonb_build_object('workerId',w.worker_id,'workerName',w.worker_name)
 order by w.display_order,w.worker_id),'[]'::jsonb)
 from public.workers w join business_private.users u using(worker_id)
 where u.enabled and u.pin_hash is not null
 and (p_app_id='management' and u.system_admin or exists
 (select 1 from business_private.permissions p where p.worker_id=u.worker_id and p.app_id=p_app_id));
$$;

create or replace function public.business_login(p_worker_id text,p_pin text,p_app_id text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare v_user business_private.users%rowtype; v_token text;
begin
 select * into v_user from business_private.users where worker_id=p_worker_id for update;
 if not found or not v_user.enabled or v_user.pin_hash is null

 or coalesce(v_user.locked_until>now(),false)
 or length(coalesce(p_pin,''))>72 then
 return jsonb_build_object('ok',false,'error','ユーザーまたはPINを確認してください。連続失敗時は15分後に再試行してください。'); end if;
 if extensions.crypt(p_pin,v_user.pin_hash) is distinct from v_user.pin_hash then
 update business_private.users set failed_attempts=case when coalesce(locked_until<=now(),false) then 1 else failed_attempts+1 end,
 locked_until=case when not coalesce(locked_until<=now(),false) and failed_attempts+1>=5 then now()+interval '15 minutes' else null end
 where worker_id=p_worker_id;
 return jsonb_build_object('ok',false,'error','ユーザーまたはPINを確認してください。連続失敗時は15分後に再試行してください。'); end if;
 if not (p_app_id='management' and v_user.system_admin) and not exists
 (select 1 from business_private.permissions where worker_id=p_worker_id and app_id=p_app_id)
 then return jsonb_build_object('ok',false,'error','このアプリの利用権限がありません。'); end if;
 update business_private.users set failed_attempts=0,locked_until=null where worker_id=p_worker_id;
 delete from business_private.sessions where expires_at<now();
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into business_private.sessions values(encode(extensions.digest(v_token,'sha256'),'hex'),p_worker_id,now()+interval '12 hours',false);
 return jsonb_build_object('ok',true,'token',v_token);
end $$;

create or replace function public.business_logout()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare v_token text:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-business-session','');
begin
 delete from business_private.sessions where token_hash=encode(extensions.digest(v_token,'sha256'),'hex');
 return jsonb_build_object('ok',true);
end $$;

-- Run only from SQL Editor as postgres, after choosing the initial administrator.
-- Returned one-time token is NOT a URL and must NOT be committed or shared in chat.
create or replace function business_private.bootstrap_admin(p_worker_id text)
returns text language plpgsql security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare v_token text;
begin
 if exists(select 1 from business_private.users where system_admin and pin_hash is not null)
 then raise exception '初期管理者は設定済みです。'; end if;
 if not exists(select 1 from public.workers where worker_id=p_worker_id and active)
 then raise exception '有効な既存ユーザーIDを指定してください。'; end if;
 update business_private.users set system_admin=true,enabled=true where worker_id=p_worker_id;
 delete from business_private.sessions where bootstrap;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 insert into business_private.sessions values(encode(extensions.digest(v_token,'sha256'),'hex'),p_worker_id,now()+interval '15 minutes',true);
 return v_token;
end $$;

create or replace function public.business_setup_pin(p_pin text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare v_actor text:=business_private.actor(true);
begin
 if v_actor is null then raise exception '初期設定コードが無効または期限切れです。'; end if;
 if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then raise exception '共通PINは6～12桁の数字で設定してください。'; end if;
 update business_private.users set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),updated_at=now() where worker_id=v_actor;
 delete from business_private.sessions where worker_id=v_actor;
 insert into business_private.audit(actor_id,action,target_id) values(v_actor,'initial_setup',v_actor);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.business_admin_data()
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private
as $$
begin
 perform business_private.require_admin();
 return jsonb_build_object('ok',true,'apps',(select jsonb_agg(to_jsonb(a) order by display_order) from business_private.apps a),
 'users',(select jsonb_agg(jsonb_build_object('workerId',w.worker_id,'workerName',w.worker_name,
 'enabled',u.enabled,'systemAdmin',u.system_admin,'pinSet',u.pin_hash is not null,
 'permissions',coalesce((select jsonb_object_agg(p.app_id,p.role) from business_private.permissions p where p.worker_id=w.worker_id),'{}'::jsonb))
 order by w.display_order,w.worker_id) from public.workers w join business_private.users u using(worker_id)));
end $$;

create or replace function public.business_admin_save(p_worker_id text,p_worker_name text,p_enabled boolean,p_permissions jsonb,p_new_pin text default null)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare v_actor text:=business_private.require_admin(); v_app text; v_role text;
begin
 perform pg_advisory_xact_lock(20260910,1);
 if p_worker_id is null or btrim(p_worker_id)='' or p_worker_name is null or btrim(p_worker_name)='' or p_enabled is null
 then raise exception 'ユーザーID・氏名・有効状態を指定してください。'; end if;
 if p_permissions is null or jsonb_typeof(p_permissions)<>'object' then raise exception '権限形式が不正です。'; end if;
 if p_worker_id=v_actor and not p_enabled then raise exception '操作中の全体管理者は無効にできません。'; end if;
 if not p_enabled and exists(select 1 from business_private.users where worker_id=p_worker_id and system_admin)
 and not exists(select 1 from business_private.users u join public.workers w using(worker_id)
 where u.worker_id<>p_worker_id and u.system_admin and u.enabled and u.pin_hash is not null)
 then raise exception '最後の全体管理者は無効にできません。'; end if;
 if nullif(p_new_pin,'') is not null and p_new_pin !~ '^[0-9]{6,12}$' then raise exception '共通PINは6～12桁の数字です。'; end if;
 for v_app,v_role in select key,value from jsonb_each_text(p_permissions) loop
  if not exists(select 1 from business_private.apps where app_id=v_app) or v_role not in ('admin','operator','viewer','') then
  raise exception 'アプリまたは権限が不正です。'; end if;
 end loop;
 -- Legacy active/role/PIN remain unchanged. Common enabled state applies to migrated apps only.
 insert into public.workers(worker_id,worker_name,role,active,note) values(p_worker_id,btrim(p_worker_name),'viewer',true,'')
 on conflict(worker_id) do update set worker_name=excluded.worker_name;
 insert into business_private.users(worker_id,enabled) values(p_worker_id,p_enabled)
 on conflict(worker_id) do update set enabled=excluded.enabled,updated_at=now();
 if nullif(p_new_pin,'') is not null then
 update business_private.users set pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),failed_attempts=0,locked_until=null where worker_id=p_worker_id;
 end if;
 delete from business_private.permissions where worker_id=p_worker_id;
 insert into business_private.permissions(worker_id,app_id,role)
 select p_worker_id,key,value from jsonb_each_text(p_permissions) where value in ('admin','operator','viewer');
 if not p_enabled or nullif(p_new_pin,'') is not null then delete from business_private.sessions where worker_id=p_worker_id; end if;
 insert into business_private.audit(actor_id,action,target_id,detail) values(v_actor,'save_user',p_worker_id,
 jsonb_build_object('enabled',p_enabled,'permissions',p_permissions,'pinChanged',nullif(p_new_pin,'') is not null));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.business_admin_set_system_admin(p_worker_id text,p_enabled boolean)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,business_private
as $$
declare v_actor text:=business_private.require_admin();
begin
 perform pg_advisory_xact_lock(20260910,1);
 if p_enabled is null or not exists(select 1 from business_private.users u join public.workers w using(worker_id)
 where u.worker_id=p_worker_id and u.enabled and u.pin_hash is not null)
 then raise exception '有効で共通PIN設定済みのユーザーを指定してください。'; end if;
 if not p_enabled and not exists(select 1 from business_private.users u join public.workers w using(worker_id)
 where u.worker_id<>p_worker_id and u.enabled and u.system_admin and u.pin_hash is not null)
 then raise exception '最後の全体管理者は解除できません。'; end if;
 update business_private.users set system_admin=p_enabled where worker_id=p_worker_id;
 insert into business_private.audit(actor_id,action,target_id,detail)
 values(v_actor,'set_system_admin',p_worker_id,jsonb_build_object('enabled',p_enabled));
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.business_app_mode(p_app_id text)
returns boolean language sql stable security definer
set search_path=pg_catalog,business_private
as $$ select coalesce((select migrated from business_private.apps where app_id=p_app_id),false); $$;

create or replace function public.business_can(p_app_id text,p_min_role text default 'viewer')
returns boolean language sql stable security definer
set search_path=pg_catalog,business_private
as $$
 select exists(select 1 from business_private.permissions where worker_id=business_private.actor()
 and app_id=p_app_id and case role when 'admin' then 3 when 'operator' then 2 else 1 end
 >=case p_min_role when 'admin' then 3 when 'operator' then 2 when 'viewer' then 1 else 99 end);
$$;
create or replace function business_private.require_app(p_app_id text,p_min_role text,p_worker_id text)
returns void language plpgsql security definer
set search_path=pg_catalog,business_private
as $$
begin
 if business_private.actor() is distinct from p_worker_id or not public.business_can(p_app_id,p_min_role)
 then raise exception 'この操作の権限がありません。再ログインするか管理者に確認してください。' using errcode='42501'; end if;
end $$;
revoke all on all functions in schema business_private from public,anon,authenticated;
do $$ declare r record; begin
 for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'business\_%' escape '\' loop
 execute format('revoke all on function %s from public, anon, authenticated',r.signature);
 execute format('grant execute on function %s to anon, authenticated',r.signature);
 end loop;
end $$;
commit;
