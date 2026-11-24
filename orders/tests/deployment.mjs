import fs from 'node:fs';

const readSchema=()=>fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function schemaSection(schema,start,end){
  const from=schema.indexOf(start),to=schema.indexOf(end,from+start.length);
  if(from<0||to<0)throw new Error('Migration boundaries not found: '+start);
  return schema.slice(from,to).trim();
}

export function deploymentSql(){
  const schema=readSchema().trim().replace(/^begin;\s*/i,'').replace(/commit;$/i,'');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
create temp table orders_deployment_guard(schema_name text,table_name text,column_sql text,row_count bigint,fingerprint text) on commit drop;
alter table orders_deployment_guard enable row level security;
do $guard$
declare r record; n bigint; h text; filter_sql text; columns_sql text;
begin
  for r in select ns.nspname,c.relname from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where c.relkind='r' and (ns.nspname='public' or (ns.nspname='business_private' and c.relname in ('users','permissions','apps')))
    order by ns.nspname,c.relname loop
    execute format('lock table %I.%I in share mode',r.nspname,r.relname);
    select string_agg(format('%I',a.attname),',' order by a.attnum) into columns_sql from pg_attribute a
      where a.attrelid=format('%I.%I',r.nspname,r.relname)::regclass and a.attnum>0 and not a.attisdropped;
    filter_sql:=case when r.nspname='business_private' and r.relname='apps' then ' where t.app_id not in (''black_garlic_shipping'',''order_approval'')' else '' end;
    execute format('select count(*),md5(coalesce(string_agg(h, '''' order by h),'''')) from (select md5(to_jsonb(t)::text) h from %I.%I t%s) rows',r.nspname,r.relname,filter_sql) into n,h;
    insert into orders_deployment_guard values(r.nspname,r.relname,columns_sql,n,h);
  end loop;
end; $guard$;
${schema}
do $verify$
declare r record; n bigint; h text; filter_sql text;
begin
  for r in select * from orders_deployment_guard loop
    filter_sql:=case when r.schema_name='business_private' and r.table_name='apps' then ' where t.app_id not in (''black_garlic_shipping'',''order_approval'')' else '' end;
    execute format('select count(*),md5(coalesce(string_agg(h, '''' order by h),'''')) from (select md5(to_jsonb(t)::text) h from (select %s from %I.%I) t%s) rows',r.column_sql,r.schema_name,r.table_name,filter_sql) into n,h;
    if n<>r.row_count or h<>r.fingerprint then raise exception 'Existing data changed: %.%',r.schema_name,r.table_name; end if;
  end loop;
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname in ('orders_clients','orders_products','orders_carriers','orders_client_products','orders_client_deliveries','orders_orders','orders_items','orders_shipments','orders_shipment_items','orders_events','orders_attachments') and c.relrowsecurity)<>11 then raise exception 'RLS check failed'; end if;
  if exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname like 'orders\\_%' escape '\\' and c.relkind='r' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) then raise exception 'Direct table access detected'; end if;
  if has_function_privilege('anon','orders_private.save_master(text,text,uuid,integer,jsonb)','EXECUTE')
    or has_function_privilege('authenticated','orders_private.save_master(text,text,uuid,integer,jsonb)','EXECUTE') then raise exception 'Private master writer is exposed'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='orders_private'
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) then raise exception 'Private order function is exposed'; end if;
end; $verify$;
select 'Orders installed; existing business data and user permissions unchanged' result,
  (select count(*) from orders_deployment_guard) existing_tables_verified,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'orders\\_%' escape '\\' and c.relkind='r') order_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'orders\\_%' escape '\\') order_rpcs,
  (select count(*) from business_private.permissions where app_id='order_approval') approval_assignments;
commit;`;
}

export function officeDeploymentSql(){
  const schema=readSchema();
  const select=(start,end)=>schemaSection(schema,start,end);
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
${select('alter table public.orders_orders\n  add column if not exists planned_carrier_id','create table if not exists public.orders_shipments')}
alter table public.orders_attachments enable row level security;
revoke all on table public.orders_attachments from public,anon,authenticated;
${select('create or replace view orders_private.order_summary','create or replace function orders_private.client_destination')}
${select('create or replace function public.orders_detail','create or replace function public.orders_progress')}
revoke all on function orders_private.save_attachments(text,uuid,jsonb),orders_private.decide(text,uuid,integer,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.orders_attachment(text,uuid,uuid),public.orders_approve(text,uuid,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.orders_attachment(text,uuid,uuid),public.orders_approve(text,uuid,integer,uuid,text) to anon,authenticated;
do $check$
begin
  if not (select relrowsecurity from pg_class where oid='public.orders_attachments'::regclass)
    or has_table_privilege('anon','public.orders_attachments','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.orders_attachments','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Attachment permissions check failed'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='orders_private'
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')))
    then raise exception 'Private order function is exposed'; end if;
end; $check$;
notify pgrst,'reload schema';
select 'Office order migration applied' result,
  (select count(*) from public.orders_orders) existing_orders,
  (select count(*) from public.orders_attachments) attachments,
  (select count(*) from business_private.permissions where app_id='order_approval') approval_assignments;
commit;`;
}

export function progressFiltersDeploymentSql(){
  return `begin;
set local lock_timeout='5s';
${schemaSection(readSchema(),'create or replace function orders_private.progress_column_value','create or replace function public.orders_detail')}
revoke all on function orders_private.progress_column_value(orders_private.order_summary,text) from public,anon,authenticated;
do $check$
begin
  if has_function_privilege('anon','orders_private.progress_column_value(orders_private.order_summary,text)','EXECUTE')
    or has_function_privilege('authenticated','orders_private.progress_column_value(orders_private.order_summary,text)','EXECUTE')
    then raise exception 'Private progress function is exposed'; end if;
end; $check$;
notify pgrst,'reload schema';
select 'Progress column filters applied' result;
commit;`;
}

export function lineCategoriesDeploymentSql(){
  const schema=readSchema();
  const select=(start,end)=>schemaSection(schema,start,end);
  return `begin;
set local lock_timeout='5s';
${select('alter table public.orders_orders alter column department','create table if not exists public.orders_items')}
${select('create or replace view orders_private.item_summary','create or replace function orders_private.client_destination')}
${select('create or replace function public.orders_list','create or replace function public.orders_detail')}
${select('create or replace function public.orders_save(','create or replace function orders_private.decide')}
notify pgrst,'reload schema';
select 'Order item categories applied' result;
commit;`;
}

if(process.argv[2]){
  const generate={office:officeDeploymentSql,progress:progressFiltersDeploymentSql,categories:lineCategoriesDeploymentSql}[process.argv[3]]||deploymentSql;
  fs.writeFileSync(process.argv[2],generate());
}
