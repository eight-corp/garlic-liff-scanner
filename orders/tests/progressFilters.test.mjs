import assert from 'node:assert/strict';
import test from 'node:test';
import {database,seed} from './database.mjs';
import {progressFiltersDeploymentSql} from './deployment.mjs';

test('progress column candidates and combined filters span pages and preserve viewer access rules',async()=>{
  const {db,rpc}=await database();
  try{
    await db.exec(progressFiltersDeploymentSql());
    const s=await seed(rpc);
    await rpc('sales','orders_save',{p_order_id:s.orderId,p_revision:0,p_header:s.header,p_items:s.items});
    await db.query(`insert into orders_orders(id,department,client_id,client_name,delivery_name,ordered_on,requested_ship_date,status,created_by,updated_at)
      select gen_random_uuid(),'black',$1,'別取引先','青森',date '2026-10-25',date '2026-10-26','pending','office',timestamptz '2026-10-25 20:03:00+00'
      from generate_series(1,55)`,[s.client.id]);
    const list=filters=>rpc('viewer','orders_list',{p_filters:filters});
    assert.equal((await list({})).rows.length,50);
    assert.equal((await list({offset:50})).rows.at(-1).id,s.orderId);
    assert.deepEqual((await list({facet:'client_name'})).values.sort(),[s.client.name,'別取引先'].sort());
    assert.equal((await list({facet:'order_no',facet_text:'ｊ－０００００１'})).values[0],'J-000001');
    assert.deepEqual((await list({facet:'requested_ship_date',facet_text:'１０／２５'})).values,['2026/10/25']);
    assert.deepEqual((await list({facet:'unexpected'})).values,[]);
    const old=await list({columns:{progress:{include:['draft']},client_name:{text:'テスト'}}});
    assert.equal(old.total,1);assert.equal(old.rows[0].id,s.orderId);
    assert.equal((await list({columns:{progress:{exclude:['draft']},updated_at:{text:'2026/10/26 05:03'}}})).total,55);
    assert.equal((await list({columns:{shipment_progress:{include:['0 / 1']}}})).total,1);
    assert.equal((await list({columns:{progress:{include:[]}}})).total,0);
    assert.equal((await list({q:'J-000001'})).total,1);
    await assert.rejects(rpc('outsider','orders_list',{p_filters:{facet:'client_name'}}),/権限/);
  }finally{await db.close();}
});
