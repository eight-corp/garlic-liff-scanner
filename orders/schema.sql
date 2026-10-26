begin;

create schema if not exists orders_private;
revoke all on schema orders_private from public, anon, authenticated;
insert into business_private.apps(app_id,app_name,migrated,display_order)
values ('black_garlic_shipping','注文管理',true,3),('order_approval','注文承認',true,8)
on conflict(app_id) do update set app_name=excluded.app_name,migrated=excluded.migrated;

create table if not exists public.orders_clients (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  contact_name text not null default '', phone text not null default '', address text not null default '',
  active boolean not null default true, revision integer not null default 1,
  updated_at timestamptz not null default now(), check(length(code) between 1 and 40), check(length(name) between 1 and 160)
);
create table if not exists public.orders_products (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  specification text not null default '', department text not null check(department in ('dry','black','processed')),
  unit text not null, active boolean not null default true, revision integer not null default 1,
  updated_at timestamptz not null default now(), check(length(code) between 1 and 40),
  check(length(name) between 1 and 160), check(length(unit) between 1 and 12)
);
create table if not exists public.orders_carriers (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  active boolean not null default true, revision integer not null default 1,
  updated_at timestamptz not null default now(), check(length(code) between 1 and 40), check(length(name) between 1 and 160)
);
alter table public.orders_products
  add column if not exists pack_size integer check(pack_size between 1 and 999999),
  add column if not exists case_pack_size integer check(case_pack_size between 1 and 999999),
  add column if not exists band_box_count integer check(band_box_count between 1 and 999999),
  add column if not exists notes text not null default '' check(length(notes)<=2000);
-- JAN duplicates are warnings, not uniqueness errors.
alter table public.orders_products
  drop constraint if exists orders_products_code_key,
  drop constraint if exists orders_products_code_check;
alter table public.orders_products add constraint orders_products_code_check check(length(code)<=40);
drop index if exists public.orders_products_nonempty_code_unique;
create index if not exists orders_products_code_lookup on public.orders_products(code) where code<>'';
alter table public.orders_clients
  add column if not exists store_name text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists default_carrier_id uuid references public.orders_carriers(id);
create table if not exists public.orders_client_products (
  client_id uuid not null references public.orders_clients(id),
  product_id uuid not null references public.orders_products(id),
  primary key(client_id,product_id)
);
create table if not exists public.orders_client_deliveries (
  id uuid primary key, client_id uuid not null references public.orders_clients(id),
  name text not null check(length(name) between 1 and 160),
  postal_code text not null default '', address text not null default '' check(length(address)<=500),
  phone text not null default '' check(length(phone)<=60), active boolean not null default true,
  position integer not null, updated_at timestamptz not null default now()
);
create table if not exists public.orders_orders (
  id uuid primary key, order_no bigint generated always as identity unique,
  department text not null check(department in ('dry','black','processed')),
  client_id uuid not null references public.orders_clients(id), client_name text not null,
  delivery_name text not null, delivery_address text not null default '', delivery_phone text not null default '',
  ordered_on date not null, requested_ship_date date not null, client_reference text not null default '',
  notes text not null default '', status text not null check(status in ('draft','pending','returned','confirmed','cancelled')),
  created_by text not null references public.workers(worker_id), submitted_at timestamptz,
  approved_by text references public.workers(worker_id), approved_at timestamptz, return_reason text not null default '',
  revision integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(length(delivery_name) between 1 and 160), check(length(notes)<=4000)
);
create table if not exists public.orders_items (
  id uuid primary key, order_id uuid not null references public.orders_orders(id),
  product_id uuid not null references public.orders_products(id), product_code text not null, product_name text not null,
  specification text not null, unit text not null, quantity numeric(14,3) not null check(quantity>0),
  position integer not null, work_status text not null default 'unstarted' check(work_status in ('unstarted','working','ready')),
  work_note text not null default '', updated_by text references public.workers(worker_id), updated_at timestamptz not null default now()
);
alter table public.orders_orders add column if not exists delivery_id uuid references public.orders_client_deliveries(id);
create table if not exists public.orders_shipments (
  id uuid primary key, order_id uuid not null references public.orders_orders(id), shipped_on date not null,
  carrier_id uuid references public.orders_carriers(id), carrier_name text not null default '', tracking_no text not null default '',
  notes text not null default '', created_by text not null references public.workers(worker_id), created_at timestamptz not null default now(),
  request_payload jsonb not null, voided_at timestamptz, voided_by text references public.workers(worker_id), void_reason text not null default ''
);
create table if not exists public.orders_shipment_items (
  shipment_id uuid not null references public.orders_shipments(id), item_id uuid not null references public.orders_items(id),
  quantity numeric(14,3) not null check(quantity>0), primary key(shipment_id,item_id)
);
create table if not exists public.orders_events (
  event_no bigint generated always as identity primary key, order_id uuid references public.orders_orders(id),
  actor_id text not null references public.workers(worker_id), kind text not null, detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists orders_orders_status_department on public.orders_orders(status,department,requested_ship_date);
create index if not exists orders_orders_created_by on public.orders_orders(created_by,order_no);
create index if not exists orders_items_order on public.orders_items(order_id,position);
create index if not exists orders_shipments_order on public.orders_shipments(order_id);
create index if not exists orders_shipment_item on public.orders_shipment_items(item_id);
create index if not exists orders_events_order on public.orders_events(order_id,event_no);
create index if not exists orders_client_deliveries_client on public.orders_client_deliveries(client_id,position);

do $security$
declare t text;
begin
  foreach t in array array['orders_clients','orders_products','orders_carriers','orders_client_products','orders_client_deliveries','orders_orders','orders_items','orders_shipments','orders_shipment_items','orders_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
  end loop;
end; $security$;

create or replace function orders_private.require_user(p_worker_id text,p_role text default 'viewer')
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin perform business_private.require_app('black_garlic_shipping',p_role,p_worker_id); end; $$;
create or replace function orders_private.can_approve()
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.business_can('black_garlic_shipping','operator') and public.business_can('order_approval','operator');
$$;
create or replace function orders_private.lock_order(p_worker_id text,p_id uuid,p_revision integer)
returns public.orders_orders language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.orders_orders;
begin
  perform orders_private.require_user(p_worker_id,'operator');
  select * into r from public.orders_orders where id=p_id for update;
  if not found then raise exception '注文が見つかりません。'; end if;
  if p_revision is distinct from r.revision then raise exception '他の担当者が更新しました。注文を開き直してから操作してください。' using errcode='40001'; end if;
  return r;
end; $$;
create or replace function orders_private.event(p_id uuid,p_actor text,p_kind text,p_detail jsonb default '{}')
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_id is not null then update public.orders_orders set revision=revision+1,updated_at=clock_timestamp() where id=p_id; end if;
  insert into public.orders_events(order_id,actor_id,kind,detail) values(p_id,p_actor,p_kind,p_detail);
end; $$;

create or replace view orders_private.item_summary as
select i.*,coalesce((select sum(si.quantity) from public.orders_shipment_items si
  join public.orders_shipments s on s.id=si.shipment_id where si.item_id=i.id and s.voided_at is null),0) shipped_quantity
from public.orders_items i;
create or replace view orders_private.order_summary as
select o.id,o.order_no,o.department,o.client_id,o.client_name,o.delivery_name,o.delivery_address,o.delivery_phone,
  o.ordered_on,o.requested_ship_date,o.client_reference,o.notes,o.status,o.created_by,o.submitted_at,
  o.approved_by,o.approved_at,o.return_reason,o.revision,o.created_at,o.updated_at,
  coalesce(w.worker_name,o.created_by) creator_name,
  (select count(*) from public.orders_items i where i.order_id=o.id) item_count,
  (select count(*) from orders_private.item_summary i where i.order_id=o.id and i.shipped_quantity>=i.quantity) shipped_item_count,
  case when o.status<>'confirmed' then o.status
    when not exists(select 1 from orders_private.item_summary i where i.order_id=o.id and i.shipped_quantity<i.quantity) then 'shipped'
    when exists(select 1 from orders_private.item_summary i where i.order_id=o.id and i.shipped_quantity>0) then 'partial'
    when not exists(select 1 from public.orders_items i where i.order_id=o.id and i.work_status<>'ready') then 'ready'
    when exists(select 1 from public.orders_items i where i.order_id=o.id and i.work_status<>'unstarted') then 'working'
    else 'confirmed' end progress,o.delivery_id
from public.orders_orders o left join public.workers w on w.worker_id=o.created_by;

-- Derive the first destination without rewriting legacy master rows or order snapshots.
create or replace function orders_private.client_destination(p_client_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',c.id,'client_id',c.id,'name',left(concat_ws(' ',c.name,nullif(c.store_name,'')),160),
    'postal_code',c.postal_code,'address',c.address,'phone',c.phone,'active',true,'position',0,'is_client',true)
  from public.orders_clients c where c.id=p_client_id;
$$;

create or replace function public.orders_bootstrap(p_worker_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform orders_private.require_user(p_worker_id);
  return jsonb_build_object('canOperate',public.business_can('black_garlic_shipping','operator'),
    'canApprove',orders_private.can_approve(),'canMaster',public.business_can('black_garlic_shipping','admin'),
    'clients',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object(
      'product_ids',coalesce((select jsonb_agg(cp.product_id order by cp.product_id) from public.orders_client_products cp where cp.client_id=c.id),'[]'),
      'deliveries',jsonb_build_array(orders_private.client_destination(c.id))||coalesce((select jsonb_agg(to_jsonb(d) order by d.position,d.id) from public.orders_client_deliveries d where d.client_id=c.id and d.id<>c.id),'[]')) order by c.code) from public.orders_clients c),'[]'),
    'products',coalesce((select jsonb_agg(to_jsonb(p) order by department,code) from public.orders_products p),'[]'),
    'carriers',coalesce((select jsonb_agg(to_jsonb(c) order by code) from public.orders_carriers c),'[]'),
    'version',(select count(*)::text||':'||coalesce(max(event_no),0)::text from public.orders_events));
end; $$;
create or replace function public.orders_version(p_worker_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform orders_private.require_user(p_worker_id);
  return jsonb_build_object('version',(select count(*)::text||':'||coalesce(max(event_no),0)::text from public.orders_events),
    'canOperate',public.business_can('black_garlic_shipping','operator'),'canApprove',orders_private.can_approve(),
    'canMaster',public.business_can('black_garlic_shipping','admin'));
end; $$;
create or replace function public.orders_list(p_worker_id text,p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_result jsonb; v_offset integer:=greatest(0,coalesce((p_filters->>'offset')::integer,0));
begin
  perform orders_private.require_user(p_worker_id);
  with filtered as (
    select o.* from orders_private.order_summary o where
      (coalesce(p_filters->>'department','')='' or o.department=p_filters->>'department')
      and (coalesce(p_filters->>'status','')='' or o.progress=p_filters->>'status')
      and (coalesce(p_filters->>'mine','false')<>'true' or o.created_by=p_worker_id)
      and (coalesce(p_filters->>'open','false')<>'true' or o.progress not in ('shipped','cancelled'))
      and (coalesce(p_filters->>'confirmed','false')<>'true' or o.status='confirmed')
      and (nullif(p_filters->>'start','') is null or o.ordered_on >= (p_filters->>'start')::date)
      and (nullif(p_filters->>'end','') is null or o.ordered_on <= (p_filters->>'end')::date)
      and (coalesce(p_filters->>'q','')='' or position(lower(left(p_filters->>'q',120)) in
        lower(concat_ws(' ',o.order_no::text,'J-'||lpad(o.order_no::text,greatest(6,length(o.order_no::text)),'0'),o.client_name,o.delivery_name,o.client_reference,o.creator_name)))>0
        or exists(select 1 from public.orders_items i where i.order_id=o.id and position(lower(left(p_filters->>'q',120)) in lower(i.product_code||' '||i.product_name))>0))
  ), page as (select * from filtered order by order_no desc limit 50 offset v_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(p) order by order_no desc) from page p),'[]')) into v_result;
  return v_result;
end; $$;
create or replace function public.orders_detail(p_worker_id text,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_header jsonb;
begin
  perform orders_private.require_user(p_worker_id);
  select to_jsonb(o) into v_header from orders_private.order_summary o where id=p_order_id;
  if v_header is null then raise exception '注文が見つかりません。'; end if;
  return jsonb_build_object('header',v_header,
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by position) from orders_private.item_summary i where order_id=p_order_id),'[]'),
    'shipments',coalesce((select jsonb_agg(to_jsonb(s)-'request_payload'||jsonb_build_object('worker_name',w.worker_name,
      'items',(select jsonb_agg(to_jsonb(si)||jsonb_build_object('product_name',i.product_name,'unit',i.unit)) from public.orders_shipment_items si join public.orders_items i on i.id=si.item_id where si.shipment_id=s.id)) order by s.created_at desc)
      from public.orders_shipments s left join public.workers w on w.worker_id=s.created_by where s.order_id=p_order_id),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('worker_name',w.worker_name) order by event_no desc) from public.orders_events e left join public.workers w on w.worker_id=e.actor_id where e.order_id=p_order_id),'[]'));
end; $$;

create or replace function public.orders_save(p_worker_id text,p_order_id uuid,p_revision integer,p_header jsonb,p_items jsonb,p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.orders_orders; c public.orders_clients; p public.orders_products; d public.orders_client_deliveries;
  x jsonb; n integer:=0; q numeric; v_id uuid; v_new boolean; v_before jsonb;
  v_delivery_id uuid; v_delivery_name text; v_delivery_address text; v_delivery_phone text;
begin
  perform orders_private.require_user(p_worker_id,'operator');
  if p_order_id is null or p_submit is null or p_header is null or jsonb_typeof(p_header)<>'object'
    or p_items is null or jsonb_typeof(p_items)<>'array' then raise exception '注文データが不正です。'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception '明細は1～100行で登録してください。'; end if;
  select * into r from public.orders_orders where id=p_order_id for update;
  v_new:=not found;
  if v_new then
    if p_revision<>0 or p_revision is null then raise exception '注文が見つかりません。'; end if;
  else
    if r.revision is distinct from p_revision then raise exception '他の担当者が更新しました。注文を開き直してください。' using errcode='40001'; end if;
    if r.status not in ('draft','returned') then raise exception '承認待ち・確定済みの注文は書き換えできません。'; end if;
    if r.created_by<>p_worker_id and not public.business_can('black_garlic_shipping','admin') then raise exception '登録担当者以外は変更できません。' using errcode='42501'; end if;
    v_before:=jsonb_build_object('header',to_jsonb(r),'items',coalesce((select jsonb_agg(to_jsonb(i) order by position) from public.orders_items i where order_id=p_order_id),'[]'));
  end if;
  if coalesce(p_header->>'department','') not in ('dry','black','processed') then raise exception 'カテゴリを選択してください。'; end if;
  select * into c from public.orders_clients where id=(p_header->>'client_id')::uuid for share;
  if not found or (not c.active and c.id is distinct from r.client_id) then raise exception '取引先を選択してください。'; end if;
  v_delivery_id:=nullif(p_header->>'delivery_id','')::uuid;
  -- Keep the saved destination snapshot unless a different destination or refreshed details are selected.
  if not v_new and c.id=r.client_id and v_delivery_id is not distinct from r.delivery_id
    and p_header->>'delivery_name'=r.delivery_name and p_header->>'delivery_address'=r.delivery_address
    and p_header->>'delivery_phone'=r.delivery_phone then
    v_delivery_name:=r.delivery_name; v_delivery_address:=r.delivery_address; v_delivery_phone:=r.delivery_phone;
  else
    if v_delivery_id=c.id then
      insert into public.orders_client_deliveries(id,client_id,name,postal_code,address,phone,active,position)
        values(c.id,c.id,left(concat_ws(' ',c.name,nullif(c.store_name,'')),160),c.postal_code,c.address,c.phone,true,0)
        on conflict(id) do nothing;
    end if;
    select * into d from public.orders_client_deliveries where id=v_delivery_id and client_id=c.id and active for share;
    if not found then raise exception '取引先に登録された納品先を選択してください。'; end if;
    if v_delivery_id=c.id then
      v_delivery_name:=left(concat_ws(' ',c.name,nullif(c.store_name,'')),160);
      v_delivery_address:=concat_ws(' ',nullif(c.postal_code,''),nullif(c.address,'')); v_delivery_phone:=c.phone;
    else
      v_delivery_name:=d.name; v_delivery_address:=concat_ws(' ',nullif(d.postal_code,''),nullif(d.address,'')); v_delivery_phone:=d.phone;
    end if;
  end if;
  if nullif(p_header->>'ordered_on','') is null or nullif(p_header->>'requested_ship_date','') is null then raise exception '注文日・出荷希望日を入力してください。'; end if;
  if v_new then
    insert into public.orders_orders(id,department,client_id,client_name,delivery_id,delivery_name,delivery_address,delivery_phone,
      ordered_on,requested_ship_date,client_reference,notes,status,created_by)
    values(p_order_id,p_header->>'department',c.id,concat_ws(' ',c.name,nullif(c.store_name,'')),v_delivery_id,v_delivery_name,v_delivery_address,
      v_delivery_phone,(p_header->>'ordered_on')::date,(p_header->>'requested_ship_date')::date,
      '',coalesce(p_header->>'notes',''),'draft',p_worker_id);
  end if;
  for x in select value from jsonb_array_elements(p_items) loop
    v_id:=(x->>'id')::uuid; q:=(x->>'quantity')::numeric;
    if v_id is null or q is null or q<=0 or q<>round(q,3) or q>99999999999.999 then raise exception '数量は0より大きい数値（小数3桁まで）で入力してください。'; end if;
    if exists(select 1 from public.orders_items where id=v_id and order_id<>p_order_id) then raise exception '明細IDが不正です。'; end if;
    select * into p from public.orders_products where id=(x->>'product_id')::uuid;
    if not found or p.department<>p_header->>'department' or (not p.active and not exists(select 1 from public.orders_items where order_id=p_order_id and id=v_id and product_id=p.id)) then
      raise exception '選択したカテゴリの商品を指定してください。';
    end if;
    n:=n+1;
  end loop;
  delete from public.orders_items where order_id=p_order_id;
  n:=0;
  for x in select value from jsonb_array_elements(p_items) loop
    select * into p from public.orders_products where id=(x->>'product_id')::uuid;
    n:=n+1;
    insert into public.orders_items(id,order_id,product_id,product_code,product_name,specification,unit,quantity,position,updated_by)
      values((x->>'id')::uuid,p_order_id,p.id,p.code,p.name,p.specification,p.unit,(x->>'quantity')::numeric,n,p_worker_id);
  end loop;
  update public.orders_orders set department=p_header->>'department',client_id=c.id,client_name=concat_ws(' ',c.name,nullif(c.store_name,'')),
    delivery_id=v_delivery_id,delivery_name=v_delivery_name,delivery_address=v_delivery_address,delivery_phone=v_delivery_phone,
    ordered_on=(p_header->>'ordered_on')::date,requested_ship_date=(p_header->>'requested_ship_date')::date,
    notes=coalesce(p_header->>'notes',''),
    status=case when p_submit then 'pending' else 'draft' end,submitted_at=case when p_submit then now() else null end,return_reason=''
    where id=p_order_id;
  perform orders_private.event(p_order_id,p_worker_id,case when p_submit then 'submitted' when v_new then 'created' else 'saved' end,jsonb_build_object('before',v_before));
  return public.orders_detail(p_worker_id,p_order_id);
end; $$;

create or replace function public.orders_decide(p_worker_id text,p_order_id uuid,p_revision integer,p_action text,p_reason text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.orders_orders;
begin
  r:=orders_private.lock_order(p_worker_id,p_order_id,p_revision);
  if not orders_private.can_approve() then raise exception '注文承認の権限がありません。' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','return','cancel') then raise exception '操作が不正です。'; end if;
  if p_action in ('approve','return') and r.status<>'pending' then raise exception '承認待ちの注文だけ操作できます。'; end if;
  if p_action in ('return','cancel') and nullif(btrim(p_reason),'') is null then raise exception '理由を入力してください。'; end if;
  if p_action='cancel' then
    if r.status='cancelled' or exists(select 1 from public.orders_shipments where order_id=p_order_id and voided_at is null) then raise exception '出荷記録がある注文は取消できません。先に出荷記録を取消してください。'; end if;
  end if;
  update public.orders_orders set status=case p_action when 'approve' then 'confirmed' when 'return' then 'returned' else 'cancelled' end,
    approved_by=case when p_action='approve' then p_worker_id else approved_by end,
    approved_at=case when p_action='approve' then now() else approved_at end,
    return_reason=case when p_action='return' then btrim(p_reason) else return_reason end where id=p_order_id;
  perform orders_private.event(p_order_id,p_worker_id,case p_action when 'approve' then 'approved' when 'return' then 'returned' else 'cancelled' end,jsonb_build_object('reason',coalesce(p_reason,'')));
  return public.orders_detail(p_worker_id,p_order_id);
end; $$;
create or replace function public.orders_progress(p_worker_id text,p_order_id uuid,p_revision integer,p_item_id uuid,p_status text,p_note text default '')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.orders_orders;
begin
  r:=orders_private.lock_order(p_worker_id,p_order_id,p_revision);
  if r.status<>'confirmed' then raise exception '確定済みの注文だけ進捗を更新できます。'; end if;
  if p_status is null or p_status not in ('unstarted','working','ready') then raise exception '進捗が不正です。'; end if;
  if not exists(select 1 from orders_private.item_summary where id=p_item_id and order_id=p_order_id and shipped_quantity<quantity) then raise exception '未出荷の明細が見つかりません。'; end if;
  update public.orders_items set work_status=p_status,work_note=left(coalesce(p_note,''),2000),updated_by=p_worker_id,updated_at=now() where id=p_item_id;
  perform orders_private.event(p_order_id,p_worker_id,'progress',jsonb_build_object('item_id',p_item_id,'status',p_status,'note',coalesce(p_note,'')));
  return public.orders_detail(p_worker_id,p_order_id);
end; $$;
create or replace function public.orders_ship(p_worker_id text,p_order_id uuid,p_revision integer,p_shipment_id uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.orders_orders; c public.orders_carriers; s public.orders_shipments; x jsonb; i record; n integer:=0; q numeric;
begin
  perform orders_private.require_user(p_worker_id,'operator');
  select * into s from public.orders_shipments where id=p_shipment_id;
  if found then
    if s.order_id=p_order_id and s.created_by=p_worker_id and s.request_payload=p_data then return public.orders_detail(p_worker_id,p_order_id); end if;
    raise exception '出荷IDが重複しています。';
  end if;
  r:=orders_private.lock_order(p_worker_id,p_order_id,p_revision);
  if r.status<>'confirmed' then raise exception '確定済みの注文だけ出荷できます。'; end if;
  if p_shipment_id is null or p_data is null or nullif(p_data->>'shipped_on','') is null then raise exception '出荷日を入力してください。'; end if;
  if (p_data->>'shipped_on')::date<r.ordered_on then raise exception '出荷日は注文日以降を指定してください。'; end if;
  if p_data->'items' is null or jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 100 then raise exception '出荷する明細を指定してください。'; end if;
  if nullif(p_data->>'carrier_id','') is not null then
    select * into c from public.orders_carriers where id=(p_data->>'carrier_id')::uuid and active;
    if not found then raise exception '配送業者が利用できません。'; end if;
  end if;
  insert into public.orders_shipments(id,order_id,shipped_on,carrier_id,carrier_name,tracking_no,notes,created_by,request_payload)
    values(p_shipment_id,p_order_id,(p_data->>'shipped_on')::date,c.id,coalesce(c.name,''),left(coalesce(p_data->>'tracking_no',''),120),left(coalesce(p_data->>'notes',''),2000),p_worker_id,p_data);
  for x in select value from jsonb_array_elements(p_data->'items') loop
    q:=(x->>'quantity')::numeric;
    select * into i from orders_private.item_summary where id=(x->>'item_id')::uuid and order_id=p_order_id;
    if not found or i.work_status<>'ready' then raise exception '出荷準備完了の明細だけ出荷できます。'; end if;
    if q is null or q<=0 or q<>round(q,3) or q>i.quantity-i.shipped_quantity then raise exception '出荷数量が未出荷残数を超えているか、数量が不正です。'; end if;
    insert into public.orders_shipment_items(shipment_id,item_id,quantity) values(p_shipment_id,i.id,q);
    n:=n+1;
  end loop;
  perform orders_private.event(p_order_id,p_worker_id,'shipped',jsonb_build_object('shipment_id',p_shipment_id,'lines',n));
  return public.orders_detail(p_worker_id,p_order_id);
end; $$;
create or replace function public.orders_void_shipment(p_worker_id text,p_order_id uuid,p_revision integer,p_shipment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform orders_private.lock_order(p_worker_id,p_order_id,p_revision);
  if not orders_private.can_approve() then raise exception '注文承認の権限がありません。' using errcode='42501'; end if;
  if nullif(btrim(p_reason),'') is null then raise exception '出荷取消の理由を入力してください。'; end if;
  update public.orders_shipments set voided_at=now(),voided_by=p_worker_id,void_reason=btrim(p_reason) where id=p_shipment_id and order_id=p_order_id and voided_at is null;
  if not found then raise exception '取消できる出荷記録が見つかりません。'; end if;
  perform orders_private.event(p_order_id,p_worker_id,'shipment_voided',jsonb_build_object('shipment_id',p_shipment_id,'reason',p_reason));
  return public.orders_detail(p_worker_id,p_order_id);
end; $$;

create or replace function public.orders_save_master(p_worker_id text,p_kind text,p_id uuid,p_revision integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_id,gen_random_uuid()); v_exists boolean; v_revision integer;
  v_code text:=btrim(p_data->>'code'); v_name text:=btrim(p_data->>'name');
  r public.orders_products; c public.orders_clients; v_unit text; v_pack integer; v_case integer; v_band integer; v_notes text;
  v_carrier uuid; v_products uuid[]; v_postal text; v_text text;
  v_delivery_ids uuid[]:='{}'; v_delivery_id uuid; v_delivery jsonb; v_position integer:=0;
  v_duplicates integer; v_warnings jsonb:='[]';
begin
  perform orders_private.require_user(p_worker_id,'admin');
  if p_kind is null or p_kind not in ('clients','products','carriers') then raise exception 'マスタが不正です。'; end if;
  if p_kind='products' then
    v_code:=coalesce(v_code,'');
    if length(v_code)>40 then raise exception 'JANコードは40文字以内で入力してください。'; end if;
    if v_name is null or length(v_name) not between 1 and 160 then raise exception '商品名を入力してください。'; end if;
  elsif v_code is null or length(v_code) not between 1 and 40 or v_name is null or length(v_name) not between 1 and 160 then
    raise exception 'コード・名称を入力してください。';
  end if;
  execute format('select revision from public.%I where id=$1 for update','orders_'||p_kind) into v_revision using v_id;
  v_exists:=v_revision is not null;
  if (v_exists and v_revision is distinct from p_revision) or (not v_exists and coalesce(p_revision,0)<>0) then raise exception 'マスタが更新されています。開き直してください。' using errcode='40001'; end if;
  if p_kind='products' then
    select * into r from public.orders_products where id=v_id;
    v_unit:=case when p_data?'unit' then nullif(btrim(p_data->>'unit'),'') else coalesce(r.unit,'個') end;
    if coalesce(p_data->>'department','') not in ('dry','black','processed') or v_unit is null then raise exception 'カテゴリを選択してください。'; end if;
    v_text:=nullif(btrim(p_data->>'pack_size'),'');
    if v_text is not null and v_text!~'^[0-9]{1,6}$' then raise exception '入数は1～999999の整数で入力してください。'; end if;
    v_pack:=case when p_data?'pack_size' then v_text::integer else r.pack_size end;
    v_text:=nullif(btrim(p_data->>'case_pack_size'),'');
    if v_text is not null and v_text!~'^[0-9]{1,6}$' then raise exception '大箱入数は1～999999の整数で入力してください。'; end if;
    v_case:=case when p_data?'case_pack_size' then v_text::integer else r.case_pack_size end;
    v_text:=nullif(btrim(p_data->>'band_box_count'),'');
    if v_text is not null and v_text!~'^[0-9]{1,6}$' then raise exception 'バンドは1～999999の整数で入力してください。'; end if;
    v_band:=case when p_data?'band_box_count' then v_text::integer else r.band_box_count end;
    if v_band<=0 then raise exception 'バンドは1以上の整数で入力してください。'; end if;
    v_notes:=coalesce(p_data->>'notes',r.notes,'');
    if length(v_notes)>2000 then raise exception '備考は2000文字以内で入力してください。'; end if;
    if v_pack<=0 or v_case<=0 then raise exception '入数・大箱入数は1以上の整数で入力してください。'; end if;
    if v_exists and (r.department<>p_data->>'department' or r.unit<>v_unit) and exists(select 1 from public.orders_items where product_id=v_id) then raise exception '注文で使用済みの商品のカテゴリ・数量単位は変更できません。別の商品として登録してください。'; end if;
    insert into public.orders_products(id,code,name,specification,department,unit,pack_size,case_pack_size,band_box_count,notes,active)
      values(v_id,v_code,v_name,left(coalesce(p_data->>'specification',''),200),p_data->>'department',v_unit,v_pack,v_case,v_band,v_notes,coalesce((p_data->>'active')::boolean,true))
      on conflict(id) do update set code=excluded.code,name=excluded.name,specification=excluded.specification,department=excluded.department,unit=excluded.unit,
        pack_size=excluded.pack_size,case_pack_size=excluded.case_pack_size,band_box_count=excluded.band_box_count,notes=excluded.notes,active=excluded.active,revision=orders_products.revision+1,updated_at=now();
  elsif p_kind='clients' then
    select * into c from public.orders_clients where id=v_id;
    v_carrier:=case when p_data?'default_carrier_id' then nullif(p_data->>'default_carrier_id','')::uuid else c.default_carrier_id end;
    if v_carrier is not null and not exists(select 1 from public.orders_carriers where id=v_carrier and (active or id=c.default_carrier_id)) then raise exception '基本の配送業者を選択し直してください。'; end if;
    v_postal:=case when p_data?'postal_code' then btrim(coalesce(p_data->>'postal_code','')) else coalesce(c.postal_code,'') end;
    v_postal:=translate(v_postal,'０１２３４５６７８９－','0123456789-');
    if v_postal<>'' and v_postal!~'^[0-9]{3}-?[0-9]{4}$' then raise exception '郵便番号は7桁の数字で入力してください。'; end if;
    if length(v_postal)=7 then v_postal:=left(v_postal,3)||'-'||right(v_postal,4); end if;
    if p_data?'product_ids' then
      if jsonb_typeof(p_data->'product_ids') is distinct from 'array' then raise exception '取扱商品を選択してください。'; end if;
      select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into v_products from jsonb_array_elements_text(p_data->'product_ids');
      if exists(select 1 from unnest(v_products) x(id) left join public.orders_products p on p.id=x.id
        where p.id is null or (not p.active and not exists(select 1 from public.orders_client_products cp where cp.client_id=v_id and cp.product_id=p.id))) then raise exception '取扱商品に利用できない商品があります。'; end if;
    end if;
    insert into public.orders_clients(id,code,name,store_name,contact_name,phone,postal_code,address,default_carrier_id,active)
      values(v_id,v_code,v_name,left(coalesce(p_data->>'store_name',c.store_name,''),160),left(coalesce(p_data->>'contact_name',''),100),left(coalesce(p_data->>'phone',''),60),v_postal,left(coalesce(p_data->>'address',''),500),v_carrier,coalesce((p_data->>'active')::boolean,true))
      on conflict(id) do update set code=excluded.code,name=excluded.name,store_name=excluded.store_name,contact_name=excluded.contact_name,phone=excluded.phone,postal_code=excluded.postal_code,address=excluded.address,default_carrier_id=excluded.default_carrier_id,active=excluded.active,revision=orders_clients.revision+1,updated_at=now();
    if p_data?'product_ids' then
      delete from public.orders_client_products where client_id=v_id and not (product_id=any(v_products));
      insert into public.orders_client_products(client_id,product_id) select v_id,x from unnest(v_products) x on conflict do nothing;
    end if;
    insert into public.orders_client_deliveries(id,client_id,name,postal_code,address,phone,active,position)
      select client.id,client.id,left(concat_ws(' ',client.name,nullif(client.store_name,'')),160),client.postal_code,client.address,client.phone,true,0
      from public.orders_clients client where client.id=v_id
      on conflict(id) do update set name=excluded.name,postal_code=excluded.postal_code,address=excluded.address,
        phone=excluded.phone,active=true,position=0,updated_at=now() where orders_client_deliveries.client_id=v_id;
    if not found then raise exception '取引先の納品先IDが競合しています。'; end if;
    if p_data?'deliveries' then
      if jsonb_typeof(p_data->'deliveries') is distinct from 'array' then raise exception '納品先の形式が不正です。'; end if;
      if jsonb_array_length(p_data->'deliveries')>100 then raise exception '納品先は100件までです。'; end if;
      for v_delivery in select value from jsonb_array_elements(p_data->'deliveries') loop
        if jsonb_typeof(v_delivery)<>'object' then raise exception '納品先の形式が不正です。'; end if;
        v_delivery_id:=nullif(v_delivery->>'id','')::uuid;
        if v_delivery_id=v_id then continue; end if;
        if v_delivery_id is null or v_delivery_id=any(v_delivery_ids) then raise exception '納品先IDが不正です。'; end if;
        if exists(select 1 from public.orders_clients where id=v_delivery_id) then raise exception '取引先の納品先は自動設定されます。'; end if;
        if exists(select 1 from public.orders_client_deliveries where id=v_delivery_id and client_id<>v_id) then raise exception '別の取引先の納品先は登録できません。'; end if;
        if nullif(btrim(v_delivery->>'name'),'') is null or length(btrim(v_delivery->>'name'))>160 then raise exception '納品先名は160文字以内で入力してください。'; end if;
        if length(coalesce(v_delivery->>'address',''))>500 or length(coalesce(v_delivery->>'phone',''))>60 then raise exception '納品先の住所・電話番号が長すぎます。'; end if;
        v_postal:=translate(btrim(coalesce(v_delivery->>'postal_code','')),'０１２３４５６７８９－','0123456789-');
        if v_postal<>'' and v_postal!~'^[0-9]{3}-?[0-9]{4}$' then raise exception '納品先の郵便番号は7桁の数字で入力してください。'; end if;
        if length(v_postal)=7 then v_postal:=left(v_postal,3)||'-'||right(v_postal,4); end if;
        v_position:=v_position+1; v_delivery_ids:=array_append(v_delivery_ids,v_delivery_id);
        insert into public.orders_client_deliveries(id,client_id,name,postal_code,address,phone,active,position)
          values(v_delivery_id,v_id,btrim(v_delivery->>'name'),v_postal,btrim(coalesce(v_delivery->>'address','')),btrim(coalesce(v_delivery->>'phone','')),coalesce((v_delivery->>'active')::boolean,true),v_position)
          on conflict(id) do update set name=excluded.name,postal_code=excluded.postal_code,address=excluded.address,phone=excluded.phone,active=excluded.active,position=excluded.position,updated_at=now()
          where orders_client_deliveries.client_id=excluded.client_id;
        if not found then raise exception '別の取引先の納品先は登録できません。'; end if;
      end loop;
      update public.orders_client_deliveries set active=false,updated_at=now() where client_id=v_id and id<>v_id and active and not(id=any(v_delivery_ids));
    end if;
  else
    insert into public.orders_carriers(id,code,name,active) values(v_id,v_code,v_name,coalesce((p_data->>'active')::boolean,true))
      on conflict(id) do update set code=excluded.code,name=excluded.name,active=excluded.active,revision=orders_carriers.revision+1,updated_at=now();
  end if;
  perform orders_private.event(null,p_worker_id,'master',jsonb_build_object('kind',p_kind,'id',v_id));
  if p_kind='products' and v_code<>'' then
    select count(*) into v_duplicates from public.orders_products where code=v_code and id<>v_id;
    if v_duplicates>0 then
      v_warnings:=jsonb_build_array(format('JANコード「%s」は他の%s商品と重複しています。',v_code,v_duplicates));
    end if;
  end if;
  return public.orders_bootstrap(p_worker_id)||jsonb_build_object('warnings',v_warnings);
exception when unique_violation then raise exception '同じコード（商品はJANコード）が登録されています。';
end; $$;

revoke all on all functions in schema orders_private from public,anon,authenticated;
do $permissions$
declare r record;
begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('orders_bootstrap','orders_version','orders_list','orders_detail','orders_save','orders_decide','orders_progress','orders_ship','orders_void_shipment','orders_save_master') loop
    execute format('revoke all on function %s from public,anon,authenticated',r.signature);
    execute format('grant execute on function %s to anon,authenticated',r.signature);
  end loop;
end; $permissions$;
notify pgrst,'reload schema';
commit;
