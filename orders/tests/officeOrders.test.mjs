import assert from 'node:assert/strict';
import test from 'node:test';
import {database,seed} from './database.mjs';
import {officeDeploymentSql} from './deployment.mjs';

test('approval can assign or create a carrier without allowing routine users to change the master',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const save=async(p_order_id,p_items)=>rpc('sales','orders_save',{p_order_id,p_revision:0,p_header:s.header,p_items,p_submit:true});
    let detail=await save(s.orderId,s.items);
    const approval={p_order_id:s.orderId,p_revision:detail.header.revision};
    await assert.rejects(rpc('sales','orders_approve',{...approval,p_new_carrier_name:'未許可配送'}),/承認の権限/);
    await assert.rejects(rpc('admin','orders_approve',{...approval,p_new_carrier_name:'未承認配送'}),/承認の権限/);
    await assert.rejects(rpc('office','orders_approve',{...approval,p_revision:0,p_new_carrier_name:'古い画面からの配送'}),/他の担当者/);
    await assert.rejects(rpc('office','orders_approve',{...approval,p_new_carrier_name:'テスト配送'}),/登録済み/);
    await assert.rejects(rpc('office','orders_approve',{...approval,p_carrier_id:crypto.randomUUID()}),/利用できません/);
    await assert.rejects(rpc('office','orders_approve',{...approval,p_new_carrier_name:' '}),/配送業者名/);
    assert.equal((await rpc('office','orders_bootstrap')).carriers.length,1);
    detail=await rpc('office','orders_approve',{...approval,p_new_carrier_name:' 新規配送 '});
    assert.equal(detail.header.status,'confirmed');
    assert.equal(detail.header.planned_carrier_name,'新規配送');
    const boot=await rpc('sales','orders_bootstrap');
    const created=boot.carriers.find(c=>c.id===detail.header.planned_carrier_id);
    assert.equal(created.name,'新規配送');
    assert.equal(created.revision,1);
    assert.equal(boot.clients[0].default_carrier_id,null);
    const another=await save(crypto.randomUUID(),[{...s.items[0],id:crypto.randomUUID()}]);
    const assigned=await rpc('office','orders_approve',{p_order_id:another.header.id,p_revision:another.header.revision,p_carrier_id:s.carrier.id});
    assert.equal(assigned.header.planned_carrier_id,s.carrier.id);
    assert.equal((await rpc('office','orders_bootstrap')).carriers.length,2);
  }finally{await db.close();}
});

test('office attachments save atomically, stay scoped to the order and are never in list payloads',async()=>{
  const {db,rpc}=await database();
  try{
    const s=await seed(rpc);
    const id=crypto.randomUUID(),data=Buffer.from('ffd8ffe000ffd9','hex').toString('base64');
    const image={id,name:'FAX-1.jpg',data};
    const {ordered_on,...header}=s.header;
    const add=(attachments)=>rpc('office','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:{...header,attachments},p_items:s.items});
    await assert.rejects(add([{...image,data:Buffer.from('not-a-jpeg').toString('base64')}]),/JPEG/);
    assert.equal((await rpc('viewer','orders_list')).total,0);
    const first=await add([image]);
    assert.equal(first.header.created_by,'office');
    const today=(await db.query("select ((now() at time zone 'Asia/Tokyo')::date)::text as tokyo_date")).rows[0].tokyo_date;
    assert.equal(first.header.ordered_on,today);
    assert.deepEqual(first.attachments,[{id,name:image.name}]);
    const args={p_order_id:s.orderId,p_attachment_id:id};
    await assert.rejects(rpc('outsider','orders_attachment',args),/権限/);
    await assert.rejects(rpc('viewer','orders_attachment',{...args,p_order_id:crypto.randomUUID()}),/見つかりません/);
    assert.equal((await rpc('viewer','orders_attachment',args)).data,data);
    assert.doesNotMatch(JSON.stringify(await rpc('viewer','orders_list')),/FAX-1|image_data/);
    const update=(actor,revision,changes={})=>rpc(actor,'orders_save',{p_order_id:s.orderId,p_revision:revision,p_header:{...header,notes:'修正',...changes},p_items:s.items});
    await assert.rejects(update('sales',first.header.revision,{attachments:[]}),/登録担当者/);
    await assert.rejects(update('office',first.header.revision,{attachments:[{id},{id}]}),/重複/);
    const edited=await update('office',first.header.revision);
    assert.equal(edited.header.ordered_on,today);
    assert.deepEqual(edited.attachments,first.attachments);
    await db.exec(officeDeploymentSql());
    assert.equal((await rpc('viewer','orders_attachment',args)).data,data);
    const cleared=await update('office',edited.header.revision,{attachments:[]});
    assert.deepEqual(cleared.attachments,[]);
    await assert.rejects(rpc('viewer','orders_attachment',args),/見つかりません/);
  }finally{await db.close();}
});
