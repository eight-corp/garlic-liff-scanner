import assert from 'node:assert/strict';
import test from 'node:test';
import {database,seed} from './database.mjs';
import {lineCategoriesDeploymentSql,shippedTotalDeploymentSql} from './deployment.mjs';

test('mixed product categories are not stored on the order and work in lists, updates and split shipments',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const legacy=await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:s.header,p_items:s.items});
    await db.query("update orders_orders set department='dry' where id=$1",[s.orderId]);
    await db.exec('alter table orders_orders alter column department set not null');
    await db.exec(lineCategoriesDeploymentSql());
    await db.exec(shippedTotalDeploymentSql());
    const existing=await rpc('viewer','orders_detail',{p_order_id:s.orderId});
    assert.equal(existing.items[0].department,'dry');
    assert.equal(existing.header.revision,legacy.header.revision);
    assert.equal((await db.query('select department from orders_orders where id=$1',[s.orderId])).rows[0].department,'dry');
    const {department,...header}=s.header,id=crypto.randomUUID();
    const items=[{...s.items[0],id:crypto.randomUUID(),department:'dry'},{id:crypto.randomUUID(),product_id:s.black.id,department:'black',quantity:6}];
    const save=(p_items,p_revision=0,p_submit=false)=>rpc('sales','orders_save',{p_order_id:id,p_revision,p_header:header,p_items,p_submit});
    await assert.rejects(save([items[0],{...items[1],department:'dry'}]),/カテゴリ/);
    await assert.rejects(save([items[0],{...items[1],department:undefined}]),/カテゴリ/);
    assert.equal((await rpc('viewer','orders_list')).total,1);
    let mixed=await save(items);
    assert.deepEqual(mixed.items.map(i=>i.department),['dry','black']);
    assert.deepEqual(mixed.header.departments,['dry','black']);
    assert.equal((await db.query('select department from orders_orders where id=$1',[id])).rows[0].department,null);
    const list=p_filters=>rpc('viewer','orders_list',{p_filters});
    assert.equal((await list({department:'dry'})).total,2);
    assert.deepEqual((await list({department:'black'})).rows.map(o=>o.id),[id]);
    assert.deepEqual((await list({columns:{department:{include:['black']}}})).rows.map(o=>o.id),[id]);
    assert.deepEqual((await list({columns:{department:{exclude:['dry']}}})).rows.map(o=>o.id),[id]);
    assert.equal((await list({columns:{department:{include:['processed']}}})).total,0);
    assert.deepEqual((await list({facet:'department'})).values,['black','dry']);
    assert.deepEqual((await list({facet:'shipped_quantity_total'})).values,['0']);
    mixed=await save([{...items[0],quantity:1500},{...items[1],quantity:7}],mixed.header.revision,true);
    const params=()=>({p_order_id:id,p_revision:mixed.header.revision});
    mixed=await rpc('office','orders_approve',params());
    mixed=await rpc('sales','orders_progress',{...params(),p_item_id:items[1].id,p_status:'ready'});
    mixed=await rpc('sales','orders_ship',{...params(),p_shipment_id:crypto.randomUUID(),
      p_data:{shipped_on:'2026-10-25',items:[{item_id:items[1].id,quantity:7}]}});
    assert.equal(mixed.header.progress,'partial');
    assert.deepEqual(mixed.items.map(i=>[i.department,Number(i.shipped_quantity)]),[['dry',0],['black',7]]);
    assert.equal(mixed.header.shipped_quantity_total,'7 箱');
    assert.deepEqual((await list({department:'black'})).rows.map(o=>o.id),[id]);
    mixed=await rpc('sales','orders_progress',{...params(),p_item_id:items[0].id,p_status:'ready'});
    const firstPartial=crypto.randomUUID();
    for(const [shipmentId,quantity] of [[firstPartial,1234.125],[crypto.randomUUID(),0.125]]){
      mixed=await rpc('sales','orders_ship',{...params(),p_shipment_id:shipmentId,
        p_data:{shipped_on:'2026-10-25',items:[{item_id:items[0].id,quantity}]}});
    }
    const total='7 箱 / 1,234.25 袋';
    assert.equal((await list({sort:'shipping_priority',department:'black'})).rows[0].shipped_quantity_total,total);
    assert.deepEqual((await list({facet:'shipped_quantity_total',facet_text:'１，２３４'})).values,[total]);
    assert.deepEqual((await list({columns:{shipped_quantity_total:{include:[total]}}})).rows.map(o=>o.id),[id]);
    mixed=await rpc('office','orders_void_shipment',{...params(),p_shipment_id:firstPartial,p_reason:'数量訂正'});
    assert.equal(mixed.header.shipped_quantity_total,'7 箱 / 0.125 袋');
  }finally{await db.close();}
});
