create extension if not exists pgcrypto;

create table if not exists public.workers (
  worker_id text primary key,
  worker_name text not null,
  role text not null default 'operator' check (role in ('admin', 'operator', 'viewer')),
  display_order integer not null default 999,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.workers is '共通: 作業者マスタ';
comment on column public.workers.note is '旧方式のPINメモ欄。共通PIN運用では business_private.users 側を使用します';

create table if not exists public.inventory_item_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null default 999,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_item_categories_name_unique unique (name),
  constraint inventory_item_categories_name_not_excluded check (btrim(name) not in ('にんにく', '黒にんにく', '米穀', '玄米', '白米'))
);

insert into public.inventory_item_categories (name, display_order)
values
  ('ダンボール', 10),
  ('カップ', 20),
  ('シール', 30),
  ('冷食', 40)
on conflict (name) do nothing;

comment on table public.inventory_item_categories is '共通: 在庫カテゴリマスタ';
comment on column public.inventory_item_categories.name is 'ダンボール、カップ、シール、冷食など';

create table if not exists public.frozen_ingredient_fridges (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frozen_ingredient_fridges_name_unique unique (name)
);

comment on table public.frozen_ingredient_fridges is '資材在庫アプリ: 保管場所マスタ';
comment on column public.frozen_ingredient_fridges.name is '保管場所名';

create table if not exists public.frozen_ingredient_materials (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.inventory_item_categories(id),
  supplier_name text not null,
  material_name text not null,
  unit_name text not null default 'kg',
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frozen_ingredient_materials_supplier_material_unique unique (supplier_name, material_name)
);

alter table public.frozen_ingredient_materials
add column if not exists category_id uuid;

update public.frozen_ingredient_materials
set category_id = (select id from public.inventory_item_categories where name = '冷食' limit 1)
where category_id is null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_category_fk'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_category_fk
    foreign key (category_id) references public.inventory_item_categories(id);
  end if;
end $$;

alter table public.frozen_ingredient_materials
alter column category_id set not null;

alter table public.frozen_ingredient_materials
drop constraint if exists frozen_ingredient_materials_supplier_material_unique;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_category_supplier_material_unique'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_category_supplier_material_unique
    unique (category_id, supplier_name, material_name);
  end if;
end $$;

alter table public.frozen_ingredient_materials
add column if not exists unit_name text;

update public.frozen_ingredient_materials
set unit_name = 'kg'
where unit_name is null or btrim(unit_name) = '';

alter table public.frozen_ingredient_materials
alter column unit_name set default 'kg';

alter table public.frozen_ingredient_materials
alter column unit_name set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_unit_name_check'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_unit_name_check
    check (char_length(btrim(unit_name)) between 1 and 20);
  end if;
end $$;

alter table public.frozen_ingredient_materials
add column if not exists note text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_note_length_check'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_note_length_check
    check (note is null or char_length(note) <= 200);
  end if;
end $$;

comment on table public.frozen_ingredient_materials is '資材在庫アプリ: 品目マスタ';
comment on column public.frozen_ingredient_materials.category_id is '在庫カテゴリ';
comment on column public.frozen_ingredient_materials.supplier_name is '仕入先名';
comment on column public.frozen_ingredient_materials.material_name is '品目名';
comment on column public.frozen_ingredient_materials.unit_name is '数量単位';
comment on column public.frozen_ingredient_materials.note is '品目備考';

create table if not exists public.frozen_ingredient_stock_lots (
  id uuid primary key default gen_random_uuid(),
  fridge_id uuid not null references public.frozen_ingredient_fridges(id),
  material_id uuid not null references public.frozen_ingredient_materials(id),
  expiration_date date not null,
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  received_at timestamptz not null default now(),
  created_by_worker_id text references public.workers(worker_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint frozen_ingredient_stock_lots_unique unique (fridge_id, material_id, expiration_date)
);

alter table public.frozen_ingredient_stock_lots
add column if not exists created_by_worker_id text references public.workers(worker_id);

comment on table public.frozen_ingredient_stock_lots is '資材在庫アプリ: 現在庫ロット';
comment on column public.frozen_ingredient_stock_lots.fridge_id is '保管場所';
comment on column public.frozen_ingredient_stock_lots.material_id is '品目';
comment on column public.frozen_ingredient_stock_lots.expiration_date is '期限/管理日';
comment on column public.frozen_ingredient_stock_lots.quantity is '現在数量';

create table if not exists public.frozen_ingredient_stock_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null check (movement_type in ('in', 'out')),
  fridge_id uuid not null references public.frozen_ingredient_fridges(id),
  material_id uuid not null references public.frozen_ingredient_materials(id),
  lot_id uuid references public.frozen_ingredient_stock_lots(id),
  expiration_date date not null,
  quantity numeric(12, 3) not null check (quantity > 0),
  operator_worker_id text not null references public.workers(worker_id),
  note text,
  created_at timestamptz not null default now()
);

alter table public.frozen_ingredient_stock_movements
add column if not exists operator_worker_id text references public.workers(worker_id);

comment on table public.frozen_ingredient_stock_movements is '資材在庫アプリ: 入出庫履歴';
comment on column public.frozen_ingredient_stock_movements.movement_type is 'in=入庫, out=出庫';

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'frozen_ingredient_stock_movements'
       and column_name = 'operator_id'
  ) then
    alter table public.frozen_ingredient_stock_movements alter column operator_id drop not null;
  end if;
end $$;

create index if not exists fi_stock_lots_fridge_expiry_idx
on public.frozen_ingredient_stock_lots (fridge_id, expiration_date);

create index if not exists fi_stock_lots_material_expiry_idx
on public.frozen_ingredient_stock_lots (material_id, expiration_date);

create index if not exists fi_materials_category_idx
on public.frozen_ingredient_materials (category_id, supplier_name, material_name);

create index if not exists fi_stock_movements_created_idx
on public.frozen_ingredient_stock_movements (created_at desc);

create or replace function public.frozen_ingredient_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists fi_workers_touch_updated_at on public.workers;
create trigger fi_workers_touch_updated_at
before update on public.workers
for each row execute function public.frozen_ingredient_touch_updated_at();

drop trigger if exists fi_categories_touch_updated_at on public.inventory_item_categories;
create trigger fi_categories_touch_updated_at
before update on public.inventory_item_categories
for each row execute function public.frozen_ingredient_touch_updated_at();

drop trigger if exists fi_fridges_touch_updated_at on public.frozen_ingredient_fridges;
create trigger fi_fridges_touch_updated_at
before update on public.frozen_ingredient_fridges
for each row execute function public.frozen_ingredient_touch_updated_at();

drop trigger if exists fi_materials_touch_updated_at on public.frozen_ingredient_materials;
create trigger fi_materials_touch_updated_at
before update on public.frozen_ingredient_materials
for each row execute function public.frozen_ingredient_touch_updated_at();

drop trigger if exists fi_stock_lots_touch_updated_at on public.frozen_ingredient_stock_lots;
create trigger fi_stock_lots_touch_updated_at
before update on public.frozen_ingredient_stock_lots
for each row execute function public.frozen_ingredient_touch_updated_at();

alter table public.workers enable row level security;
alter table public.inventory_item_categories enable row level security;
alter table public.frozen_ingredient_fridges enable row level security;
alter table public.frozen_ingredient_materials enable row level security;
alter table public.frozen_ingredient_stock_lots enable row level security;
alter table public.frozen_ingredient_stock_movements enable row level security;

drop policy if exists "fi_workers_select_anon" on public.workers;
create policy "fi_workers_select_anon"
on public.workers for select
to anon
using (true);

drop policy if exists "fi_categories_select_anon" on public.inventory_item_categories;
create policy "fi_categories_select_anon"
on public.inventory_item_categories for select
to anon
using (true);

drop policy if exists "fi_categories_insert_anon" on public.inventory_item_categories;
create policy "fi_categories_insert_anon"
on public.inventory_item_categories for insert
to anon
with check (true);

drop policy if exists "fi_categories_update_anon" on public.inventory_item_categories;
create policy "fi_categories_update_anon"
on public.inventory_item_categories for update
to anon
using (true)
with check (true);

drop policy if exists "fi_fridges_select_anon" on public.frozen_ingredient_fridges;
create policy "fi_fridges_select_anon"
on public.frozen_ingredient_fridges for select
to anon
using (true);

drop policy if exists "fi_fridges_insert_anon" on public.frozen_ingredient_fridges;
create policy "fi_fridges_insert_anon"
on public.frozen_ingredient_fridges for insert
to anon
with check (true);

drop policy if exists "fi_fridges_update_anon" on public.frozen_ingredient_fridges;
create policy "fi_fridges_update_anon"
on public.frozen_ingredient_fridges for update
to anon
using (true)
with check (true);

drop policy if exists "fi_materials_select_anon" on public.frozen_ingredient_materials;
create policy "fi_materials_select_anon"
on public.frozen_ingredient_materials for select
to anon
using (true);

drop policy if exists "fi_materials_insert_anon" on public.frozen_ingredient_materials;
create policy "fi_materials_insert_anon"
on public.frozen_ingredient_materials for insert
to anon
with check (true);

drop policy if exists "fi_materials_update_anon" on public.frozen_ingredient_materials;
create policy "fi_materials_update_anon"
on public.frozen_ingredient_materials for update
to anon
using (true)
with check (true);

drop policy if exists "fi_stock_lots_select_anon" on public.frozen_ingredient_stock_lots;
create policy "fi_stock_lots_select_anon"
on public.frozen_ingredient_stock_lots for select
to anon
using (true);

drop policy if exists "fi_stock_movements_select_anon" on public.frozen_ingredient_stock_movements;
create policy "fi_stock_movements_select_anon"
on public.frozen_ingredient_stock_movements for select
to anon
using (true);

create or replace function public.frozen_ingredient_require_active_worker(p_worker_id text)
returns public.workers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
begin
  select *
    into v_worker
    from public.workers
   where worker_id = btrim(coalesce(p_worker_id, ''))
     and active = true;

  if not found then
    raise exception 'active worker not found';
  end if;

  return v_worker;
end;
$$;

create or replace function public.frozen_ingredient_record_inbound(
  p_worker_id text,
  p_fridge_id uuid,
  p_material_id uuid,
  p_expiration_date date,
  p_quantity numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_lot_id uuid;
begin
  select * into v_worker from public.frozen_ingredient_require_active_worker(p_worker_id);

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  if p_expiration_date is null then
    raise exception 'expiration date is required';
  end if;

  perform 1
  from public.frozen_ingredient_fridges
  where id = p_fridge_id
    and is_active = true;

  if not found then
    raise exception 'active fridge not found';
  end if;

  perform 1
  from public.frozen_ingredient_materials
  where id = p_material_id
    and is_active = true;

  if not found then
    raise exception 'active material not found';
  end if;

  insert into public.frozen_ingredient_stock_lots (
    fridge_id,
    material_id,
    expiration_date,
    quantity,
    received_at,
    created_by_worker_id
  )
  values (
    p_fridge_id,
    p_material_id,
    p_expiration_date,
    p_quantity,
    now(),
    v_worker.worker_id
  )
  on conflict (fridge_id, material_id, expiration_date)
  do update set
    quantity = public.frozen_ingredient_stock_lots.quantity + excluded.quantity,
    updated_at = now()
  returning id into v_lot_id;

  insert into public.frozen_ingredient_stock_movements (
    movement_type,
    fridge_id,
    material_id,
    lot_id,
    expiration_date,
    quantity,
    operator_worker_id,
    note
  )
  values (
    'in',
    p_fridge_id,
    p_material_id,
    v_lot_id,
    p_expiration_date,
    p_quantity,
    v_worker.worker_id,
    nullif(trim(p_note), '')
  );

  return v_lot_id;
end;
$$;

create or replace function public.frozen_ingredient_record_outbound(
  p_worker_id text,
  p_lot_id uuid,
  p_quantity numeric,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_lot public.frozen_ingredient_stock_lots%rowtype;
  v_remaining numeric;
begin
  select * into v_worker from public.frozen_ingredient_require_active_worker(p_worker_id);

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;

  select *
  into v_lot
  from public.frozen_ingredient_stock_lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'stock lot not found';
  end if;

  if v_lot.quantity < p_quantity then
    raise exception 'not enough stock';
  end if;

  update public.frozen_ingredient_stock_lots
  set quantity = quantity - p_quantity,
      updated_at = now()
  where id = p_lot_id
  returning quantity into v_remaining;

  insert into public.frozen_ingredient_stock_movements (
    movement_type,
    fridge_id,
    material_id,
    lot_id,
    expiration_date,
    quantity,
    operator_worker_id,
    note
  )
  values (
    'out',
    v_lot.fridge_id,
    v_lot.material_id,
    v_lot.id,
    v_lot.expiration_date,
    p_quantity,
    v_worker.worker_id,
    nullif(trim(p_note), '')
  );

  return v_remaining;
end;
$$;

revoke all on function public.frozen_ingredient_require_active_worker(text) from public, anon, authenticated;
revoke all on function public.frozen_ingredient_record_inbound(text, uuid, uuid, date, numeric, text) from public, anon, authenticated;
revoke all on function public.frozen_ingredient_record_outbound(text, uuid, numeric, text) from public, anon, authenticated;

grant usage on schema public to anon;
grant select on public.workers to anon;
grant select, insert, update on public.inventory_item_categories to anon;
grant select, insert, update on public.frozen_ingredient_fridges to anon;
grant select, insert, update on public.frozen_ingredient_materials to anon;
grant select on public.frozen_ingredient_stock_lots to anon;
grant select on public.frozen_ingredient_stock_movements to anon;
grant execute on function public.frozen_ingredient_record_inbound(text, uuid, uuid, date, numeric, text) to anon;
grant execute on function public.frozen_ingredient_record_outbound(text, uuid, numeric, text) to anon;

do $$
begin
  if to_regclass('business_private.apps') is not null then
    execute $sql$update business_private.apps
                set app_name = '資材在庫管理'
              where app_id = 'frozen_ingredients'$sql$;
  end if;

  if to_regprocedure('business_private.frozen_write_guard()') is not null then
    execute $sql$drop trigger if exists business_frozen_categories_write_guard
              on public.inventory_item_categories$sql$;
    execute $sql$create trigger business_frozen_categories_write_guard
              before insert or update or delete on public.inventory_item_categories
              for each row execute function business_private.frozen_write_guard('admin')$sql$;
  end if;
end $$;

notify pgrst, 'reload schema';
