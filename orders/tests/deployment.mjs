import fs from 'node:fs';

export function deploymentSql(){
  const schema=fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8').trim().replace(/^begin;\s*/i,'').replace(/commit;$/i,'');
  return `begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
create temp table orders_deployment_guard(schema_name text,table_name text,column_sql text,row_count bigint,fingerprint text) on commit drop;
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
  if (select count(*) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname in ('orders_clients','orders_products','orders_carriers','orders_client_products','orders_orders','orders_items','orders_shipments','orders_shipment_items','orders_events') and c.relrowsecurity)<>9 then raise exception 'RLS check failed'; end if;
  if exists(select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and c.relname like 'orders\\_%' escape '\\' and c.relkind='r' and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) then raise exception 'Direct table access detected'; end if;
end; $verify$;
select 'Orders installed; existing business data and user permissions unchanged' result,
  (select count(*) from orders_deployment_guard) existing_tables_verified,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'orders\\_%' escape '\\' and c.relkind='r') order_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'orders\\_%' escape '\\') order_rpcs,
  (select count(*) from business_private.permissions where app_id='order_approval') approval_assignments;
commit;`;
}

if(process.argv[2])fs.writeFileSync(process.argv[2],deploymentSql());
