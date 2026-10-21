import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from './database.mjs';
import {deploymentSql} from './deployment.mjs';

test('master packaging, customer stores, product selections and carrier defaults are persisted safely',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const save=(kind,row,data,actor='admin')=>rpc(actor,'orders_save_master',{p_kind:kind,p_id:row.id,p_revision:row.revision,p_data:{...row,...data}});
    let boot=await save('products',s.product,{code:'0490123456789',pack_size:'12',case_pack_size:'4'});
    let product=boot.products.find(p=>p.id===s.product.id);
    assert.equal(product.code,'0490123456789');assert.equal(product.pack_size,12);assert.equal(product.case_pack_size,4);assert.equal(product.unit,'袋');
    for(const bad of ['0','-1','1.5','text','1000000'])await assert.rejects(save('products',product,{pack_size:bad}),/入数/);
    await assert.rejects(save('products',product,{case_pack_size:'2.5'}),/大箱入数/);
    boot=await save('clients',s.client,{store_name:'本店',postal_code:'０１２３４５６',default_carrier_id:s.carrier.id,product_ids:[product.id,s.black.id,product.id]});
    let client=boot.clients.find(c=>c.id===s.client.id);
    assert.equal(client.store_name,'本店');assert.equal(client.postal_code,'012-3456');assert.equal(client.default_carrier_id,s.carrier.id);
    assert.deepEqual([...client.product_ids].sort(),[product.id,s.black.id].sort());
    const before=JSON.stringify((await db.query('select to_jsonb(c) c from orders_clients c')).rows);
    await assert.rejects(save('clients',client,{postal_code:'123'}),/郵便番号/);
    await assert.rejects(save('clients',client,{product_ids:[crypto.randomUUID()]}),/取扱商品/);
    await assert.rejects(save('clients',client,{default_carrier_id:crypto.randomUUID()}),/配送業者/);
    await assert.rejects(save('clients',client,{product_ids:'bad'}),/取扱商品/);
    await assert.rejects(save('clients',client,{store_name:'改変'},'sales'),/権限/);
    assert.equal(JSON.stringify((await db.query('select to_jsonb(c) c from orders_clients c')).rows),before);
    const legacyPayload={code:client.code,name:client.name,contact_name:client.contact_name,phone:client.phone,address:client.address,active:true};
    boot=await rpc('admin','orders_save_master',{p_kind:'clients',p_id:client.id,p_revision:client.revision,p_data:legacyPayload});
    client=boot.clients.find(c=>c.id===client.id);
    assert.equal(client.store_name,'本店');assert.equal(client.postal_code,'012-3456');assert.equal(client.default_carrier_id,s.carrier.id);assert.equal(client.product_ids.length,2);
    await assert.rejects(save('clients',s.client,{product_ids:[]}),/更新/);
    boot=await save('products',s.black,{active:false});
    boot=await save('clients',client,{product_ids:[product.id,s.black.id]});
    client=boot.clients.find(c=>c.id===client.id);
    boot=await save('clients',client,{product_ids:[product.id]});client=boot.clients.find(c=>c.id===client.id);
    await assert.rejects(save('clients',client,{product_ids:[product.id,s.black.id]}),/取扱商品/);
    const order=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:s.header,p_items:s.items,p_submit:true});
    assert.equal(order.header.client_name,'テスト取引先 本店');assert.equal(order.items[0].unit,'袋');
    const oldUnit=product.unit;
    const {unit,...newProductPayload}=product;
    boot=await rpc('admin','orders_save_master',{p_kind:'products',p_id:product.id,p_revision:product.revision,p_data:{...newProductPayload,pack_size:'24',case_pack_size:''}});
    product=boot.products.find(p=>p.id===product.id);
    assert.equal(product.unit,oldUnit);assert.equal(product.pack_size,24);assert.equal(product.case_pack_size,null);
    const old=await rpc('sales','orders_detail',{p_order_id:s.orderId});
    assert.equal(old.items[0].quantity,order.items[0].quantity);assert.equal(old.items[0].unit,'袋');
    boot=await save('clients',client,{product_ids:[]});assert.deepEqual(boot.clients.find(c=>c.id===client.id).product_ids,[]);
    assert.equal((await db.query("select has_table_privilege('anon','orders_client_products','select') allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});

test('upgrading legacy master rows adds empty fields without changing any existing columns or orders',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const order=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:s.header,p_items:s.items,p_submit:true});
    await db.exec(`drop table orders_client_products;
      alter table orders_products drop column pack_size,drop column case_pack_size;
      alter table orders_clients drop column store_name,drop column postal_code,drop column default_carrier_id;`);
    await db.exec(deploymentSql());
    const boot=await rpc('admin','orders_bootstrap');
    assert.equal(boot.products.find(p=>p.id===s.product.id).unit,'袋');
    assert.equal(boot.products.find(p=>p.id===s.product.id).pack_size,null);
    assert.equal(boot.clients[0].store_name,'');assert.equal(boot.clients[0].postal_code,'');assert.equal(boot.clients[0].default_carrier_id,null);assert.deepEqual(boot.clients[0].product_ids,[]);
    assert.deepEqual(await rpc('sales','orders_detail',{p_order_id:s.orderId}),order);
    await db.exec(deploymentSql());
  }finally{await db.close();}
});
