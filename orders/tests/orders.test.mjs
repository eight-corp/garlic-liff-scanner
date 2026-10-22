import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import {database,seed} from './database.mjs'
import {deploymentSql} from './deployment.mjs'

test('orders follow approval, progress and partial shipment rules without changing shared permissions',async t=>{
  const {db,rpc}=await database()
  try {
    const s=await seed(rpc)
    let detail
    const save=(actor='sales',changes={})=>rpc(actor,'orders_save',{p_order_id:s.orderId,p_revision:detail?.header.revision??0,p_header:s.header,p_items:s.items,p_submit:false,...changes})
    const decision=(actor,action,reason='')=>rpc(actor,'orders_decide',{p_order_id:s.orderId,p_revision:detail.header.revision,p_action:action,p_reason:reason})
    const snapshot=async()=>JSON.stringify((await db.query("select (select jsonb_agg(to_jsonb(o)) from orders_orders o) orders,(select jsonb_agg(to_jsonb(i)) from orders_items i) items,(select jsonb_agg(to_jsonb(s)) from orders_shipments s) shipments,(select jsonb_agg(to_jsonb(si)) from orders_shipment_items si) shipment_items,(select jsonb_agg(to_jsonb(e)) from orders_events e) events")).rows)
    await t.test('explicit common approval permission is required, including for app admins',async()=>{
      assert.equal((await rpc('office','orders_bootstrap')).canApprove,true)
      assert.equal((await rpc('admin','orders_bootstrap')).canApprove,false)
      assert.equal((await rpc('sales','orders_bootstrap')).canApprove,false)
      await assert.rejects(rpc('outsider','orders_bootstrap'),/権限/)
      await assert.rejects(rpc('sales','orders_bootstrap',{p_worker_id:'office'}),/権限/)
      await assert.rejects(save('viewer'),/権限/)
    })
    await t.test('department validation, owner checks and concurrent edit protection are atomic',async()=>{
      detail=await save()
      const before=await snapshot()
      await assert.rejects(save('sales',{p_items:[{...s.items[0],product_id:s.black.id}]}),/カテゴリ/)
      await assert.rejects(save('other'),/登録担当者/)
      await assert.rejects(save('sales',{p_revision:0}),/更新/)
      await assert.rejects(save('sales',{p_items:[{...s.items[0],quantity:0}]}),/数量/)
      assert.equal(await snapshot(),before)
      const list=await rpc('viewer','orders_list',{p_filters:{q:'乾燥にんにく'}})
      assert.equal(list.total,1)
      assert.equal((await rpc('viewer','orders_list',{p_filters:{q:'J-000001'}})).total,1)
    })
    await t.test('submission, return and resubmission do not expose drafts to progress updates',async()=>{
      await assert.rejects(rpc('sales','orders_progress',{p_order_id:s.orderId,p_revision:detail.header.revision,p_item_id:s.itemId,p_status:'working',p_note:''}),/確定済み/)
      detail=await save('sales',{p_submit:true})
      await assert.rejects(decision('sales','approve'),/承認/)
      await assert.rejects(decision('admin','approve'),/承認/)
      await assert.rejects(decision('office','return'),/理由/)
      detail=await decision('office','return','数量を確認')
      assert.equal(detail.header.status,'returned')
      detail=await save('sales',{p_submit:true})
      detail=await decision('office','approve')
      assert.equal(detail.header.status,'confirmed')
      await assert.rejects(save(),/書き換え/)
      detail=await rpc('sales','orders_progress',{p_order_id:s.orderId,p_revision:detail.header.revision,p_item_id:s.itemId,p_status:'ready',p_note:'完了'})
    })
    const shipmentId=crypto.randomUUID()
    const shipment={shipped_on:'2026-10-22',carrier_id:s.carrier.id,tracking_no:'A-001',notes:'分納',items:[{item_id:s.itemId,quantity:4}]}
    const ship=(id=shipmentId,data=shipment,revision=detail.header.revision)=>rpc('sales','orders_ship',{p_order_id:s.orderId,p_revision:revision,p_shipment_id:id,p_data:data})
    await t.test('partial shipments track remaining quantity, retries never double count, over-shipping rolls back',async()=>{
      const rev=detail.header.revision
      detail=await ship()
      assert.equal(Number(detail.items[0].shipped_quantity),4)
      assert.equal(detail.header.progress,'partial')
      detail=await ship(shipmentId,shipment,rev)
      assert.equal(detail.shipments.length,1)
      const before=await snapshot()
      await assert.rejects(ship(crypto.randomUUID(),{...shipment,items:[{item_id:s.itemId,quantity:7}]}),/数量/)
      assert.equal(await snapshot(),before)
      await assert.rejects(ship(crypto.randomUUID(),shipment,rev),/更新/)
      await assert.rejects(ship(crypto.randomUUID(),{...shipment,items:[...shipment.items,...shipment.items]}),/duplicate|重複|数量/)
      assert.equal(await snapshot(),before)
      detail=await ship(crypto.randomUUID(),{...shipment,items:[{item_id:s.itemId,quantity:6}]})
      assert.equal(detail.header.progress,'shipped')
      assert.equal(Number(detail.items[0].shipped_quantity),10)
      await assert.rejects(decision('office','cancel','中止'),/出荷記録/)
    })
    await t.test('shipment corrections are audited and approval-only, original records remain',async()=>{
      const args={p_order_id:s.orderId,p_revision:detail.header.revision,p_shipment_id:shipmentId,p_reason:'訂正'}
      await assert.rejects(rpc('sales','orders_void_shipment',args),/承認/)
      detail=await rpc('office','orders_void_shipment',args)
      assert.equal(Number(detail.items[0].shipped_quantity),6)
      assert.equal(detail.header.progress,'partial')
      assert.equal(detail.shipments.length,2)
      assert.ok(detail.shipments.find(x=>x.id===shipmentId).voided_at)
    })
    await t.test('master changes cannot rewrite past names, units or departments',async()=>{
      await rpc('admin','orders_save_master',{p_kind:'products',p_id:s.product.id,p_revision:s.product.revision,p_data:{...s.product,name:'新名称'}})
      detail=await rpc('sales','orders_detail',{p_order_id:s.orderId})
      assert.equal(detail.items[0].product_name,'乾燥にんにく')
      await assert.rejects(rpc('admin','orders_save_master',{p_kind:'products',p_id:s.product.id,p_revision:s.product.revision+1,p_data:{...s.product,department:'black'}}),/使用済み/)
      await assert.rejects(rpc('sales','orders_save_master',{p_kind:'clients',p_id:null,p_revision:0,p_data:{code:'NO',name:'NO'}}),/権限/)
      assert.equal((await db.query("select has_table_privilege('anon','orders_orders','select') allowed")).rows[0].allowed,false)
      assert.equal((await db.query("select has_function_privilege('anon','orders_private.event(uuid,text,text,jsonb)','execute') allowed")).rows[0].allowed,false)
    })
    await t.test('date and department searches paginate server-side, reinstall preserves data and grants',async()=>{
      assert.equal((await rpc('viewer','orders_list',{p_filters:{department:'black'}})).total,0)
      assert.equal((await rpc('viewer','orders_list',{p_filters:{start:'2026-10-22'}})).total,0)
      assert.equal((await rpc('viewer','orders_list',{p_filters:{offset:50}})).rows.length,0)
      const before=await snapshot(),permissions=(await db.query('select * from business_private.permissions order by worker_id,app_id')).rows
      await db.exec(fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8'))
      assert.equal(await snapshot(),before)
      assert.deepEqual((await db.query('select * from business_private.permissions order by worker_id,app_id')).rows,permissions)
      await db.exec(deploymentSql())
      assert.equal(await snapshot(),before)
      assert.deepEqual((await db.query('select * from business_private.permissions order by worker_id,app_id')).rows,permissions)
    })
    await t.test('revoked approval and operator permissions apply to already open sessions',async()=>{
      await db.exec("delete from business_private.permissions where worker_id='office' and app_id='order_approval'")
      assert.equal((await rpc('office','orders_version')).canApprove,false)
      await assert.rejects(decision('office','cancel','中止'),/承認/)
      await db.exec("delete from business_private.permissions where worker_id='sales'")
      await assert.rejects(ship(),/権限/)
      await assert.rejects(rpc('sales','orders_detail',{p_order_id:s.orderId}),/権限/)
    })
  } finally {await db.close()}
})
