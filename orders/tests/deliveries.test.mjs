import test from 'node:test';
import assert from 'node:assert/strict';
import {database,seed} from './database.mjs';
import {deploymentSql} from './deployment.mjs';

test('client destinations are isolated, validated and saved as immutable order snapshots',async t=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    let client=s.client,detail;
    const second={id:crypto.randomUUID(),name:'東倉庫',postal_code:'０１２３４５６',address:'青森市東町',phone:'017-111-2222',active:true};
    const saveClient=data=>rpc('admin','orders_save_master',{p_kind:'clients',p_id:client.id,p_revision:client.revision,p_data:{...client,...data}});
    const saveOrder=(header=s.header)=>rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:detail?.header.revision??0,p_header:header,p_items:s.items});
    await t.test('multiple destinations persist with postal normalization and no direct or operator writes',async()=>{
      const boot=await saveClient({deliveries:[s.delivery,second]});client=boot.clients.find(c=>c.id===client.id);
      assert.equal(client.deliveries.length,2);assert.equal(client.deliveries[1].postal_code,'012-3456');
      await assert.rejects(rpc('sales','orders_save_master',{p_kind:'clients',p_id:client.id,p_revision:client.revision,p_data:client}),/権限/);
      const security=await db.query("select relrowsecurity rls,has_table_privilege('anon',oid,'select,insert,update,delete') allowed from pg_class where oid='orders_client_deliveries'::regclass");
      assert.equal(security.rows[0].rls,true);assert.equal(security.rows[0].allowed,false);
    });
    await t.test('invalid destinations roll back the entire client edit and cannot take over another client',async()=>{
      const before=JSON.stringify((await db.query('select to_jsonb(d) d from orders_client_deliveries d order by id')).rows);
      for(const deliveries of [null,'bad',[{}],[{...second,name:''}],[second,second],[{...second,postal_code:'123'}],[{...second,address:'x'.repeat(501)}],[{...second,phone:'x'.repeat(61)}]])
        await assert.rejects(saveClient({name:'変更しない',deliveries}),/納品先/);
      assert.equal(JSON.stringify((await db.query('select to_jsonb(d) d from orders_client_deliveries d order by id')).rows),before);
      assert.equal((await rpc('viewer','orders_bootstrap')).clients.find(c=>c.id===client.id).name,client.name);
      await assert.rejects(rpc('admin','orders_save_master',{p_kind:'clients',p_id:null,p_revision:0,p_data:{code:'C002',name:'別取引先',deliveries:[second]}}),/別の取引先/);
      assert.equal((await rpc('admin','orders_bootstrap')).clients.length,1);
    });
    await t.test('the server resolves the selected destination and rejects missing or foreign selections',async()=>{
      detail=await saveOrder({...s.header,delivery_id:second.id,delivery_name:'改ざん',delivery_address:'改ざん',delivery_phone:'改ざん',client_reference:'廃止項目'});
      assert.equal(detail.header.delivery_name,'東倉庫');assert.equal(detail.header.delivery_address,'012-3456 青森市東町');assert.equal(detail.header.delivery_phone,second.phone);
      assert.equal(detail.header.client_reference,'');
      const before=JSON.stringify(detail);
      await assert.rejects(saveOrder({...s.header,delivery_id:''}),/納品先/);
      await assert.rejects(saveOrder({...s.header,delivery_id:crypto.randomUUID()}),/納品先/);
      const boot=await rpc('admin','orders_save_master',{p_kind:'clients',p_id:null,p_revision:0,p_data:{code:'OTHER',name:'別取引先',deliveries:[]}});
      const other=boot.clients.find(c=>c.code==='OTHER');
      await assert.rejects(saveOrder({...s.header,client_id:other.id,delivery_id:second.id}),/納品先/);
      assert.equal(JSON.stringify(await rpc('sales','orders_detail',{p_order_id:s.orderId})),before);
    });
    await t.test('renaming and removing master destinations does not rewrite saved orders, even on a later edit',async()=>{
      const boot=await saveClient({deliveries:[{...second,name:'新しい倉庫',address:'移転後の住所',phone:'999'}]});client=boot.clients.find(c=>c.id===client.id);
      assert.equal(client.deliveries.find(d=>d.id===s.delivery.id).active,false);
      assert.equal((await rpc('sales','orders_detail',{p_order_id:s.orderId})).header.delivery_name,'東倉庫');
      detail=await saveOrder({...detail.header,notes:'明細のみ修正'});
      assert.equal(detail.header.delivery_name,'東倉庫');assert.equal(detail.header.delivery_address,'012-3456 青森市東町');
      await assert.rejects(saveOrder({...s.header,delivery_id:s.delivery.id}),/納品先/);
      const cleared=await saveClient({deliveries:[]});client=cleared.clients.find(c=>c.id===client.id);
      assert.equal(client.deliveries.filter(d=>d.active).length,0);
      detail=await saveOrder(detail.header);
      assert.equal(detail.header.delivery_name,'東倉庫');
      await assert.rejects(rpc('sales','orders_save',{p_order_id:crypto.randomUUID(),p_revision:0,p_header:{...s.header,delivery_id:second.id},p_items:[{...s.items[0],id:crypto.randomUUID()}]}),/納品先/);
      const {deliveries,...legacyClient}=client;
      const preserved=await rpc('admin','orders_save_master',{p_kind:'clients',p_id:client.id,p_revision:client.revision,p_data:legacyClient});
      assert.equal(preserved.clients.find(c=>c.id===client.id).deliveries.length,2);
      await db.exec(deploymentSql());
    });
  }finally{await db.close();}
});

test('legacy orders remain editable without changing their destination or removed reference number',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    let detail=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:s.header,p_items:s.items});
    await db.query("update orders_orders set delivery_id=null,delivery_name='旧納品先',delivery_address='旧住所',delivery_phone='旧電話',client_reference='旧番号' where id=$1",[s.orderId]);
    await db.exec('drop view orders_private.order_summary;alter table orders_orders drop column delivery_id;drop table orders_client_deliveries;');
    await db.exec(deploymentSql());
    detail=await rpc('sales','orders_detail',{p_order_id:s.orderId});
    const {client_reference,...header}=detail.header;
    detail=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:detail.header.revision,p_header:{...header,notes:'変更'},p_items:s.items});
    assert.equal(detail.header.delivery_id,null);assert.equal(detail.header.delivery_name,'旧納品先');assert.equal(detail.header.delivery_address,'旧住所');assert.equal(detail.header.delivery_phone,'旧電話');assert.equal(detail.header.client_reference,'旧番号');
    await assert.rejects(rpc('sales','orders_save',{p_order_id:crypto.randomUUID(),p_revision:0,p_header:header,p_items:[{...s.items[0],id:crypto.randomUUID()}]}),/納品先/);
    await assert.rejects(rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:detail.header.revision,p_header:{...header,delivery_address:'任意の住所'},p_items:s.items}),/納品先/);
    assert.deepEqual((await rpc('admin','orders_bootstrap')).clients[0].deliveries,[]);
    await db.exec(deploymentSql());
  }finally{await db.close();}
});
