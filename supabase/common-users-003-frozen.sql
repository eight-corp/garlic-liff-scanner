-- Run after deploying the compatible cold-food UI and reviewing common roles.
begin;

do $$
begin
  if not exists (
    select 1
    from business_private.permissions p
    join business_private.users u on u.worker_id = p.worker_id
    where p.app_id = 'frozen_ingredients'
      and p.role = 'admin'
      and u.enabled = true
      and u.pin_hash is not null
  ) then
    raise exception '冷食原材料管理を利用できる有効な管理者と共通PINを先に設定してください。';
  end if;
end;
$$;

create or replace function public.frozen_ingredient_require_active_worker(p_worker_id text)
returns public.workers
language plpgsql
security definer
set search_path = pg_catalog, public, business_private
as $$
declare
  v_worker public.workers%rowtype;
begin
  select * into v_worker
  from public.workers
  where worker_id = btrim(coalesce(p_worker_id, ''))
    and active = true;

  if not found then
    raise exception '作業者が無効です。もう一度ログインしてください。';
  end if;

  perform business_private.require_app('frozen_ingredients', 'operator', v_worker.worker_id);
  return v_worker;
end;
$$;

create or replace function business_private.frozen_write_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, business_private
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
begin
  if v_role in ('anon', 'authenticated')
     and not public.business_can('frozen_ingredients', TG_ARGV[0]) then
    raise exception 'この操作を行う権限がありません。';
  end if;
  return case when TG_OP = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists business_frozen_fridges_write_guard on public.frozen_ingredient_fridges;
create trigger business_frozen_fridges_write_guard
before insert or update or delete on public.frozen_ingredient_fridges
for each row execute function business_private.frozen_write_guard('admin');

drop trigger if exists business_frozen_materials_write_guard on public.frozen_ingredient_materials;
create trigger business_frozen_materials_write_guard
before insert or update or delete on public.frozen_ingredient_materials
for each row execute function business_private.frozen_write_guard('admin');

update business_private.apps
set migrated = true
where app_id = 'frozen_ingredients';

commit;
