import assert from 'node:assert/strict';
import test from 'node:test';
import {database,seed} from './database.mjs';
import {matchesOrderChoice} from '../model.js';

test('order choice search intersects words across fields and normalizes width and case',()=>{
  assert.equal(matchesOrderChoice('Ｐ００１ 大袋',['乾燥にんにく','p001','大袋']),true);
  assert.equal(matchesOrderChoice('Ｐ００１ 小袋',['乾燥にんにく','p001','大袋']),false);
  assert.equal(matchesOrderChoice('　',['乾燥にんにく']),true);
});

test('order entry adds new masters only, with isolated destinations and retry safety',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const add=(kind,data,id=crypto.randomUUID(),actor='sales',worker=actor)=>rpc(actor,'orders_create_entry_master',{p_kind:kind,p_id:id,p_data:data,p_worker_id:worker});
    const clientId=crypto.randomUUID(),productId=crypto.randomUUID(),destId=crypto.randomUUID();
    const clientData={code:'NEW',name:'追加取引先',store_name:'本店',postal_code:'０３００００１',address:'青森県',default_carrier_id:s.carrier.id,active:false,deliveries:[]};
    for(const actor of ['viewer','outsider'])await assert.rejects(add('clients',clientData,clientId,actor),/権限/);
    await assert.rejects(add('clients',clientData,clientId,'sales','admin'),/権限/);
    await assert.rejects(add('carriers',{code:'ABC',name:'追加不可'}),/不正/);
    await assert.rejects(add('clients',clientData,s.client.id),/使用/);
    await assert.rejects(add('clients',{...clientData,code:s.client.code}),/同じコード/);
    await assert.rejects(rpc('sales','orders_save_master',{p_kind:'clients',p_id:s.client.id,p_revision:1,p_data:{...s.client,name:'更新不可'}}),/権限/);

    const first=await add('clients',clientData,clientId);
    const client=first.clients.find(c=>c.id===clientId);
    assert.equal(client.active,true);
    assert.equal(client.default_carrier_id,s.carrier.id);
    assert.deepEqual(client.deliveries.map(d=>[d.name,d.postal_code]),[['追加取引先 本店','030-0001']]);
    assert.equal((await add('clients',clientData,clientId)).version,first.version);
    await assert.rejects(add('clients',{...clientData,name:'更新不可'},clientId),/使用/);
    await assert.rejects(add('clients',clientData,clientId,'other'),/使用/);

    const productData={name:'追加商品',department:'dry',code:s.product.code,specification:'5kg',pack_size:'24',band_box_count:'3',unit:'変更不可'};
    const productBoot=await add('products',productData,productId);
    const product=productBoot.products.find(p=>p.id===productId);
    assert.deepEqual([product.department,product.pack_size,product.band_box_count,product.unit],['dry',24,3,'個']);
    assert.match(productBoot.warnings[0],/JANコード.*重複/);
    const noJan=await add('products',{name:'JANなし',department:'dry'});
    assert.equal(noJan.products.find(p=>p.name==='JANなし').code,'');

    const destData={client_id:clientId,name:'第二納品先',address:'弘前市',postal_code:'036-0001',phone:'1234'};
    await assert.rejects(add('deliveries',{...destData,client_id:crypto.randomUUID()}),/有効な取引先/);
    await assert.rejects(add('deliveries',{...destData,postal_code:'123'}),/7桁/);
    const withDestination=await add('deliveries',destData,destId);
    const updated=withDestination.clients.find(c=>c.id===clientId);
    assert.deepEqual(updated.deliveries.map(d=>d.id),[clientId,destId]);
    assert.equal(updated.revision,client.revision+1);
    assert.deepEqual(withDestination.clients.find(c=>c.id===s.client.id).deliveries,first.clients.find(c=>c.id===s.client.id).deliveries);
    await assert.rejects(add('deliveries',destData),/登録済み/);
    assert.equal((await add('deliveries',destData,destId)).version,withDestination.version);
    await assert.rejects(rpc('admin','orders_save_master',{p_kind:'clients',p_id:clientId,p_revision:client.revision,p_data:client}),/更新されています/);
    const order=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_submit:false,
      p_header:{...s.header,client_id:clientId,delivery_id:destId},p_items:[{...s.items[0],product_id:productId}]});
    assert.equal(order.header.delivery_name,destData.name);
    assert.equal(order.items[0].product_name,productData.name);
    for(const role of ['anon','authenticated']){
      assert.equal((await db.query("select has_function_privilege($1,'orders_private.save_master(text,text,uuid,integer,jsonb)','EXECUTE') ok",[role])).rows[0].ok,false);
    }
  }finally{await db.close();}
});
