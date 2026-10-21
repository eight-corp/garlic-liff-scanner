import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {database,seed} from './database.mjs';

const root=path.resolve('..');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [1440,820,390,320]){
    const {db,rpc}=await database();
    const s=await seed(rpc),errors=[],contexts=[];
    async function pageFor(actor){
      const role=actor==='admin'?'admin':actor==='viewer'?'viewer':'operator';
      const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Tokyo',serviceWorkers:'block'});contexts.push(context);
      await context.addInitScript(()=>localStorage.setItem('business.session.v1','mock-session'));
      await context.route('**/*',route=>route.abort());
      await context.route('https://orders.test/**',route=>{
        const pathname=new URL(route.request().url()).pathname;
        if(pathname==='/shared/business-config.js')return route.fulfill({contentType:'application/javascript',body:"window.BusinessConfig={url:'https://db.test',key:'public-test-key'}"});
        const file=path.join(root,pathname.endsWith('/')?pathname+'index.html':pathname);
        const contentType={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'text/plain';
        return fs.existsSync(file)?route.fulfill({path:file,contentType}):route.fulfill({status:404,body:''});
      });
      await context.route('https://db.test/rest/v1/rpc/**',async route=>{
        const name=new URL(route.request().url()).pathname.split('/').at(-1);
        let body;
        try {
          if(name==='business_session')body={ok:true,workerId:actor,workerName:actor,systemAdmin:actor==='admin',permissions:{black_garlic_shipping:role,...(actor==='office'?{order_approval:'operator'}:{})}};
          else body=await rpc(actor,name,route.request().postDataJSON());
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
        }catch(error){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:error.message})});}
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.clock.setFixedTime('2026-10-21T12:00:00+09:00');
      await page.goto('https://orders.test/orders/');
      await page.getByRole('button',{name:'注文を追加',exact:true}).waitFor({state:actor==='viewer'?'hidden':'visible'});
      await page.getByRole('heading',{name:'注文入力',exact:true}).waitFor();
      return page;
    }
    try {
      const sales=await pageFor('sales');
      await sales.getByRole('button',{name:'注文を追加',exact:true}).click();
      const order=sales.locator('#order-dialog');
      await order.locator('[name="department"]').selectOption('dry');
      await order.getByLabel('取引先',{exact:true}).selectOption(s.client.id);
      await order.getByLabel('商品',{exact:true}).selectOption(s.product.id);
      assert.equal(await order.getByLabel('商品',{exact:true}).locator('option').filter({hasText:'黒にんにく'}).count(),0);
      await order.getByLabel('注文数量',{exact:true}).fill('10');
      await order.getByLabel('備考',{exact:true}).fill('<img src=x onerror=alert(1)>');
      await order.getByRole('button',{name:'承認を依頼',exact:true}).click();
      await order.getByRole('status').filter({hasText:'承認を依頼しました。'}).waitFor();
      assert.equal(await order.getByRole('button',{name:'注文を確定',exact:true}).count(),0);
      assert.equal(await order.locator('img').count(),0,'Customer text is never interpreted as markup');
      await order.getByRole('button',{name:'注文を閉じる',exact:true}).click();
      const office=await pageFor('office');
      await office.getByRole('button',{name:'注文確定',exact:true}).click();
      await office.getByRole('button',{name:'J-000001を開く',exact:true}).click();
      const officeOrder=office.locator('#order-dialog');
      await officeOrder.getByRole('button',{name:'注文を確定',exact:true}).click();
      await office.locator('#action-dialog').getByRole('button',{name:'注文を確定',exact:true}).click();
      await officeOrder.getByRole('status').filter({hasText:'注文の状態を更新しました。'}).waitFor();
      await sales.waitForFunction(()=>document.querySelector('.list-table tbody .badge')?.textContent==='未着手',{},{timeout:12000});
      await sales.getByRole('button',{name:'進捗入力',exact:true}).click();
      await sales.getByRole('button',{name:'J-000001を開く',exact:true}).click();
      await order.getByLabel('乾燥にんにくの進捗',{exact:true}).selectOption('ready');
      await order.getByLabel('乾燥にんにくの作業メモ',{exact:true}).fill('梱包完了');
      await order.getByRole('button',{name:'乾燥にんにくの進捗を保存',exact:true}).click();
      await order.getByRole('status').filter({hasText:'進捗を保存しました。'}).waitFor();
      await office.waitForFunction(()=>document.querySelector('#order-dialog select[name="status"]')?.value==='ready',{},{timeout:12000});
      await officeOrder.getByLabel('乾燥にんにくの作業メモ',{exact:true}).fill('未保存の現場メモ');
      await order.getByRole('button',{name:'出荷を登録',exact:true}).click();
      let ship=sales.locator('#action-dialog');
      await ship.getByLabel('乾燥にんにくの出荷数量',{exact:true}).fill('4');
      await ship.getByLabel('配送業者',{exact:true}).selectOption(s.carrier.id);
      await ship.getByLabel('伝票番号',{exact:true}).fill('TEST-001');
      await ship.getByRole('button',{name:'出荷を登録',exact:true}).click();
      await order.getByRole('status').filter({hasText:'出荷を登録しました。'}).waitFor();
      assert.equal(await order.locator('.badge.partial').count(),1);
      assert.equal(await order.locator('.detail-table tbody td').nth(3).innerText(),'6 袋');
      await office.getByText('他の担当者が更新しました',{exact:true}).waitFor({timeout:12000});
      assert.equal(await officeOrder.getByLabel('乾燥にんにくの作業メモ',{exact:true}).inputValue(),'未保存の現場メモ');
      if(process.env.QA_ARTIFACTS)await sales.screenshot({path:path.join(process.env.QA_ARTIFACTS,`orders-partial-${width}.png`)});
      await order.getByRole('button',{name:'出荷を登録',exact:true}).click();
      assert.equal(await ship.getByLabel('乾燥にんにくの出荷数量',{exact:true}).inputValue(),'6');
      await ship.getByRole('button',{name:'出荷を登録',exact:true}).click();
      await order.getByRole('status').filter({hasText:'出荷を登録しました。'}).waitFor();
      assert.equal(await order.locator('.detail-table tbody td').nth(3).innerText(),'0 袋');
      await order.getByRole('button',{name:'注文を閉じる',exact:true}).click();
      await sales.getByRole('button',{name:'注文検索',exact:true}).click();
      await sales.locator('#filter-form').getByLabel('検索',{exact:true}).fill('テスト取引先');
      await sales.locator('#filter-form').getByRole('button',{name:'検索',exact:true}).click();
      await sales.getByRole('button',{name:'J-000001を開く',exact:true}).waitFor();
      assert.equal(await sales.locator('.list-table .badge.shipped').count(),1);
      const viewer=await pageFor('viewer');
      await viewer.getByRole('button',{name:'注文検索',exact:true}).click();
      await viewer.getByRole('button',{name:'J-000001を開く',exact:true}).click();
      assert.equal(await viewer.locator('#order-dialog').getByRole('button',{name:'出荷を登録',exact:true}).count(),0);
      const admin=await pageFor('admin');
      await admin.getByRole('button',{name:'マスタ',exact:true}).click();
      await admin.getByRole('button',{name:'追加',exact:true}).click();
      const master=admin.locator('#action-dialog');
      await master.getByLabel('コード',{exact:true}).fill('P003');await master.getByLabel('名称',{exact:true}).fill('にんにくペースト');
      await master.getByLabel('部署',{exact:true}).selectOption('processed');await master.getByLabel('単位',{exact:true}).fill('袋');
      await master.getByRole('button',{name:'保存',exact:true}).click();
      await admin.locator('.master-table').getByText('にんにくペースト',{exact:true}).waitFor();
      assert.equal((await rpc('admin','orders_bootstrap')).canApprove,false,'Master admin does not inherit approval');
      if(process.env.QA_ARTIFACTS)await admin.screenshot({path:path.join(process.env.QA_ARTIFACTS,`orders-master-${width}.png`)});
      for(const page of [sales,admin])assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Only tables, not the whole page, scroll horizontally');
      assert.deepEqual(errors,[]);
      console.log(`PASS ${width}px: create, common permissions, approval, live peer updates, progress, partial shipments, search, viewer safety and product master`);
    }catch(error){console.error('Page errors:',errors);for(const c of contexts)for(const page of c.pages())console.error((await page.locator('body').innerText()).slice(-6000));throw error;}finally {for(const c of contexts)await c.close();await db.close();}
  }
}finally {await browser.close();}
