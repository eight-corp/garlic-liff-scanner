do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'frozen_ingredient_materials'
       and column_name = 'date_type'
  ) then
    alter table public.frozen_ingredient_materials
    add column date_type text not null default '';

    execute $update$
      update public.frozen_ingredient_materials as material
         set date_type = '消費期限'
        from public.inventory_item_categories as category
       where material.category_id = category.id
         and category.name = '冷食'
    $update$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_materials_date_type_check'
  ) then
    alter table public.frozen_ingredient_materials
    add constraint frozen_ingredient_materials_date_type_check
    check (date_type in ('', '賞味期限', '消費期限'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'frozen_ingredient_stock_lots'
       and column_name = 'date_type'
  ) then
    alter table public.frozen_ingredient_stock_lots
    add column date_type text not null default '';

    execute $update$
      update public.frozen_ingredient_stock_lots as lot
         set date_type = material.date_type
        from public.frozen_ingredient_materials as material
       where lot.material_id = material.id
    $update$;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_stock_lots_date_type_check'
  ) then
    alter table public.frozen_ingredient_stock_lots
    add constraint frozen_ingredient_stock_lots_date_type_check
    check (date_type in ('', '賞味期限', '消費期限'));
  end if;
end $$;

alter table public.frozen_ingredient_stock_lots
drop constraint if exists frozen_ingredient_stock_lots_unique;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'frozen_ingredient_stock_lots_date_unique'
  ) then
    alter table public.frozen_ingredient_stock_lots
    add constraint frozen_ingredient_stock_lots_date_unique
    unique (fridge_id, material_id, date_type, expiration_date);
  end if;
end $$;

drop function if exists public.frozen_ingredient_record_inbound(text, uuid, uuid, date, numeric, text);

create or replace function public.frozen_ingredient_record_inbound(
  p_worker_id text,
  p_fridge_id uuid,
  p_material_id uuid,
  p_expiration_date date,
  p_quantity numeric,
  p_note text default null,
  p_date_type text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker public.workers%rowtype;
  v_lot_id uuid;
  v_date_type text := coalesce(p_date_type, '');
begin
  select * into v_worker from public.frozen_ingredient_require_active_worker(p_worker_id);

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be greater than zero';
  end if;
  if p_expiration_date is null then
    raise exception 'expiration date is required';
  end if;
  if v_date_type not in ('', '賞味期限', '消費期限') then
    raise exception 'invalid date type';
  end if;

  perform 1 from public.frozen_ingredient_fridges where id = p_fridge_id and is_active = true;
  if not found then raise exception 'active fridge not found'; end if;

  perform 1 from public.frozen_ingredient_materials where id = p_material_id and is_active = true;
  if not found then raise exception 'active material not found'; end if;

  insert into public.frozen_ingredient_stock_lots (
    fridge_id, material_id, date_type, expiration_date, quantity, received_at, created_by_worker_id
  ) values (
    p_fridge_id, p_material_id, v_date_type, p_expiration_date, p_quantity, now(), v_worker.worker_id
  )
  on conflict (fridge_id, material_id, date_type, expiration_date)
  do update set
    quantity = public.frozen_ingredient_stock_lots.quantity + excluded.quantity,
    updated_at = now()
  returning id into v_lot_id;

  insert into public.frozen_ingredient_stock_movements (
    movement_type, fridge_id, material_id, lot_id, expiration_date, quantity, operator_worker_id, note
  ) values (
    'in', p_fridge_id, p_material_id, v_lot_id, p_expiration_date, p_quantity, v_worker.worker_id, nullif(trim(p_note), '')
  );

  return v_lot_id;
end;
$$;

comment on column public.frozen_ingredient_materials.date_type is '空欄、賞味期限、消費期限';
comment on column public.frozen_ingredient_stock_lots.date_type is '入庫時の期限種別';

revoke all on function public.frozen_ingredient_record_inbound(text, uuid, uuid, date, numeric, text, text) from public, anon, authenticated;
grant execute on function public.frozen_ingredient_record_inbound(text, uuid, uuid, date, numeric, text, text) to anon;

notify pgrst, 'reload schema';
