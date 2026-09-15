create extension if not exists pgcrypto;

create or replace function public.frozen_ingredient_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

alter table public.frozen_ingredient_materials
add column if not exists category_id uuid;

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

create index if not exists fi_materials_category_idx
on public.frozen_ingredient_materials (category_id, supplier_name, material_name);

drop trigger if exists fi_categories_touch_updated_at on public.inventory_item_categories;
create trigger fi_categories_touch_updated_at
before update on public.inventory_item_categories
for each row execute function public.frozen_ingredient_touch_updated_at();

alter table public.inventory_item_categories enable row level security;

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

grant usage on schema public to anon;
grant select, insert, update on public.inventory_item_categories to anon;

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

comment on table public.inventory_item_categories is '共通: 在庫カテゴリマスタ';
comment on column public.inventory_item_categories.name is 'ダンボール、カップ、シール、冷食など';
comment on column public.frozen_ingredient_materials.category_id is '在庫カテゴリ';
comment on column public.frozen_ingredient_materials.unit_name is '数量単位';
