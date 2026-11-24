import assert from 'node:assert/strict';
import test from 'node:test';
import {database,seed} from './database.mjs';
import {progressFiltersDeploymentSql,progressSortingDeploymentSql} from './deployment.mjs';

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

test('progress is sorted by ship date and total order quantity before pagination',async()=>{
  const {db,rpc}=await database();
  try{
    await db.exec(progressSortingDeploymentSql());
    const s=await seed(rpc);
    const save=async(date,quantities)=>{
      const id=crypto.randomUUID();
      await rpc('sales','orders_save',{p_order_id:id,p_revision:0,
        p_header:{...s.header,requested_ship_date:date},
        p_items:quantities.map((quantity,i)=>({id:crypto.randomUUID(),quantity,department:i?'black':'dry',product_id:i?s.black.id:s.product.id}))});
      return id;
    };
    const bigger=await save('2026-10-25',[6.5,6]);
    const smaller=await save('2026-10-25',[12]);
    const later=await save('2026-10-26',[100]);
    const earlier=await save('2026-10-24',[1]);
    const tie=await save('2026-10-25',[12.5]);
    await db.query(`insert into orders_orders(id,client_id,client_name,delivery_name,ordered_on,requested_ship_date,status,created_by)
      select gen_random_uuid(),$1,'別取引先','青森',date '2026-10-25',date '2026-10-23','pending','office'
      from generate_series(1,49)`,[s.client.id]);
    const list=filters=>rpc('viewer','orders_list',{p_filters:filters});
    const first=await list({sort:'shipping_priority'});
    assert.equal(first.total,54);
    assert.equal(first.rows.length,50);
    assert.equal(first.rows.at(-1).id,earlier);
    const second=await list({sort:'shipping_priority',offset:50});
    assert.deepEqual(second.rows.map(row=>row.id),[tie,bigger,smaller,later]);
    assert.equal(second.rows.some(row=>'sort_ship_date' in row||'sort_quantity' in row),false);
    const filtered=await list({sort:'shipping_priority',columns:{requested_ship_date:{include:['2026/10/25']}}});
    assert.deepEqual(filtered.rows.map(row=>row.id),[tie,bigger,smaller]);
    const search=await list({columns:{progress:{include:['draft']}}});
    assert.deepEqual(search.rows.map(row=>row.id),[tie,earlier,later,smaller,bigger]);
    assert.equal(search.rows.some(row=>'line_id' in row),false);
    const detail=filters=>list({sort:'shipping_priority',detail_rows:true,...filters});
    assert.equal((await detail({})).total,55);
    const secondDetail=await detail({offset:50});
    assert.deepEqual(secondDetail.rows.map(row=>row.id),[tie,bigger,bigger,smaller,later]);
    assert.deepEqual(secondDetail.rows.filter(row=>row.id===bigger).map(row=>[row.product_name,row.order_quantity]),
      [['乾燥にんにく','6.5 袋'],['黒にんにく','6 箱']]);
    assert.equal(new Set(secondDetail.rows.map(row=>row.line_id)).size,5);
    assert.deepEqual((await list({facet:'order_quantity',facet_text:'６．５'})).values,['6.5 袋']);
    assert.deepEqual((await list({facet:'product_name',facet_text:'黒'})).values,['黒にんにく']);
    assert.deepEqual((await detail({columns:{product_name:{include:['黒にんにく']}}})).rows.map(row=>[row.id,row.order_quantity]),[[bigger,'6 箱']]);
    assert.equal((await detail({columns:{product_name:{include:['乾燥にんにく']},order_quantity:{include:['6 箱']}}})).total,0);
    assert.equal((await db.query("select has_function_privilege('anon','orders_private.progress_line_value(public.orders_items,text)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});
