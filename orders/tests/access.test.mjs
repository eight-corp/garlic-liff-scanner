import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './database.mjs';

test('order access remains separate from approval and enforces all four role levels',async()=>{
  const {db,rpc}=await database();
  try{
    await db.exec("insert into business_private.permissions values('sales','order_approval','operator')");
    for(const role of ['admin','operator','viewer',null]){
      await db.exec("delete from business_private.permissions where worker_id='sales' and app_id='black_garlic_shipping'");
      if(role)await db.query("insert into business_private.permissions values('sales','black_garlic_shipping',$1)",[role]);
      if(!role){
        await assert.rejects(rpc('sales','orders_bootstrap'),/権限/);
        await assert.rejects(rpc('sales','orders_list'),/権限/);
        continue;
      }
      const boot=await rpc('sales','orders_bootstrap');
      assert.equal(boot.canOperate,role!=='viewer');
      assert.equal(boot.canMaster,role==='admin');
      assert.equal(boot.canApprove,role!=='viewer','Approval alone never upgrades viewer access');
      assert.equal((await rpc('sales','orders_list')).total,0);
      const master={p_kind:'carriers',p_id:null,p_revision:0,p_data:{code:'TEST-'+role,name:'テスト配送'}};
      if(role==='admin')await rpc('sales','orders_save_master',master);
      else await assert.rejects(rpc('sales','orders_save_master',master),/権限/);
      if(role==='viewer')await assert.rejects(rpc('sales','orders_decide',{p_order_id:crypto.randomUUID(),p_revision:1,p_action:'approve'}),/権限/);
    }
  }finally{await db.close();}
});
