import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

export async function database() {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create schema business_private;
      create table workers(worker_id text primary key,worker_name text,active boolean default true);
      create table business_private.apps(app_id text primary key,app_name text,migrated boolean,display_order integer);
      create table business_private.permissions(worker_id text,app_id text,role text,primary key(worker_id,app_id));
      insert into workers(worker_id,worker_name) values ('sales','営業担当'),('other','別の営業'),('office','事務担当'),('admin','管理者'),('viewer','閲覧者'),('outsider','未許可');
      insert into business_private.permissions select worker_id,'black_garlic_shipping',case worker_id when 'admin' then 'admin' when 'viewer' then 'viewer' else 'operator' end from workers where worker_id<>'outsider';
      insert into business_private.permissions values('office','order_approval','operator');
      create function business_private.actor() returns text language sql as $$ select current_setting('fixture.actor',true); $$;
      create function public.business_can(p_app text,p_role text default 'viewer') returns boolean language sql as $$
        select exists(select 1 from business_private.permissions p join workers w using(worker_id) where w.active and p.worker_id=business_private.actor() and p.app_id=p_app
          and case p.role when 'admin' then 3 when 'operator' then 2 else 1 end>=case p_role when 'admin' then 3 when 'operator' then 2 else 1 end); $$;
      create function business_private.require_app(p_app text,p_role text,p_worker text) returns void language plpgsql as $$ begin
        if business_private.actor() is distinct from p_worker or not public.business_can(p_app,p_role) then raise exception '権限がありません' using errcode='42501'; end if; end; $$;
    `)
    await db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
    const rpc = (actor,name,args={}) => db.transaction(async tx => {
      await tx.query("select set_config('fixture.actor',$1,true)",[actor])
      const entries=Object.entries({p_worker_id:actor,...args})
      const result=await tx.query(`select public.${name}(${entries.map(([key],index)=>`${key}=>$${index+1}`).join(',')}) result`,entries.map(([,value])=>value!==null&&typeof value==='object'?JSON.stringify(value):value))
      return result.rows[0].result
    })
    return {db,rpc}
  } catch(error) {await db.close();throw error}
}

export async function seed(rpc) {
  const master=async(kind,data)=>rpc('admin','orders_save_master',{p_kind:kind,p_id:null,p_revision:0,p_data:data})
  const delivery={id:crypto.randomUUID(),name:'テスト納品先',postal_code:'',address:'青森県',phone:'000-0000',active:true}
  let data=await master('clients',{code:'C001',name:'テスト取引先',address:'青森県',phone:'000-0000',contact_name:'担当',deliveries:[delivery]})
  const client=data.clients[0]
  data=await master('products',{code:'P001',name:'乾燥にんにく',department:'dry',specification:'1kg',unit:'袋'})
  const product=data.products[0]
  data=await master('products',{code:'P002',name:'黒にんにく',department:'black',specification:'200g',unit:'箱'})
  const black=data.products.find(p=>p.department==='black')
  data=await master('carriers',{code:'D001',name:'テスト配送'})
  const header={department:'dry',client_id:client.id,delivery_id:delivery.id,delivery_name:delivery.name,delivery_address:delivery.address,delivery_phone:delivery.phone,ordered_on:'2026-10-21',requested_ship_date:'2026-10-25',notes:'<script>no</script>'}
  const orderId=crypto.randomUUID(),itemId=crypto.randomUUID()
  const items=[{id:itemId,product_id:product.id,quantity:10}]
  return {client,delivery,product,black,carrier:data.carriers[0],header,orderId,itemId,items}
}
