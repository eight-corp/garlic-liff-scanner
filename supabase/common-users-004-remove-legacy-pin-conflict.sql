-- All PIN-based applications now use the common login, so a common PIN may
-- match a value that remains in the legacy workers.note field.
begin;

create or replace function public.business_setup_pin(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare
  v_actor text:=business_private.actor(true);
begin
  if v_actor is null then raise exception '初期設定コードが無効または期限切れです。'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{6,12}$' then raise exception '共通PINは6～12桁の数字で設定してください。'; end if;
  update business_private.users
  set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf',10)),updated_at=now()
  where worker_id=v_actor;
  delete from business_private.sessions where worker_id=v_actor;
  insert into business_private.audit(actor_id,action,target_id) values(v_actor,'initial_setup',v_actor);
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.business_admin_save(
  p_worker_id text,
  p_worker_name text,
  p_enabled boolean,
  p_permissions jsonb,
  p_new_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,business_private,extensions
as $$
declare
  v_actor text:=business_private.require_admin();
  v_app text;
  v_role text;
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
      raise exception 'アプリまたは権限が不正です。';
    end if;
  end loop;
  insert into public.workers(worker_id,worker_name,role,active,note) values(p_worker_id,btrim(p_worker_name),'viewer',true,'')
  on conflict(worker_id) do update set worker_name=excluded.worker_name;
  insert into business_private.users(worker_id,enabled) values(p_worker_id,p_enabled)
  on conflict(worker_id) do update set enabled=excluded.enabled,updated_at=now();
  if nullif(p_new_pin,'') is not null then
    update business_private.users
    set pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10)),failed_attempts=0,locked_until=null
    where worker_id=p_worker_id;
  end if;
  delete from business_private.permissions where worker_id=p_worker_id;
  insert into business_private.permissions(worker_id,app_id,role)
  select p_worker_id,key,value from jsonb_each_text(p_permissions) where value in ('admin','operator','viewer');
  if not p_enabled or nullif(p_new_pin,'') is not null then delete from business_private.sessions where worker_id=p_worker_id; end if;
  insert into business_private.audit(actor_id,action,target_id,detail) values(v_actor,'save_user',p_worker_id,
  jsonb_build_object('enabled',p_enabled,'permissions',p_permissions,'pinChanged',nullif(p_new_pin,'') is not null));
  return jsonb_build_object('ok',true);
end;
$$;

commit;
