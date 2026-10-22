import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve('..');
const artifacts=process.env.QA_ARTIFACTS||process.argv[2];
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block'});
const permissions={rice_shipping:'admin',black_garlic_shipping:'operator',garlic_fridge:'viewer'};
const user={workerId:'sales',workerName:'テスト担当',enabled:true,pinSet:true,systemAdmin:false,permissions};
const apps=[{app_id:'rice_shipping',app_name:'米穀出荷管理',migrated:true},{app_id:'black_garlic_shipping',app_name:'黒にんにく出荷管理',migrated:true},{app_id:'garlic_fridge',app_name:'にんにく冷蔵庫管理',migrated:true},{app_id:'order_approval',app_name:'注文承認',migrated:true}];
const sessionPermissions={black_garlic_shipping:'admin'};
const saves=[],errors=[];
try{
  await context.addInitScript(()=>localStorage.setItem('business.session.v1','mock-session'));
  await context.route('**/*',route=>route.abort());
  await context.route('https://orders.test/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    if(pathname==='/shared/business-config.js')return route.fulfill({contentType:'application/javascript',body:"window.BusinessConfig={url:'https://db.test',key:'test'}"});
    const file=path.join(root,pathname.endsWith('/')?pathname+'index.html':pathname);
    const type={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'text/plain';
    return fs.existsSync(file)?route.fulfill({path:file,contentType:type}):route.fulfill({status:404});
  });
  await context.route('https://db.test/rest/v1/rpc/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').at(-1);
    let body;
    if(name==='business_session')body={ok:true,workerId:'admin',workerName:'テスト管理者',systemAdmin:true,permissions:sessionPermissions};
    else if(name==='business_admin_data')body={apps,users:[user]};
    else if(name==='business_admin_save'){const data=route.request().postDataJSON();saves.push(data);user.permissions=data.p_permissions;body={ok:true};}
    else throw new Error('Unexpected request: '+name);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('https://orders.test/account/');
  const row=page.locator('#activeUsers tbody tr');
  await row.getByLabel('注文承認の権限',{exact:true}).waitFor();
  assert.equal(await row.getByLabel('注文承認の権限',{exact:true}).isChecked(),false);
  await row.getByLabel('注文承認の権限',{exact:true}).check();
  await row.getByRole('button',{name:'変更を保存',exact:true}).click();
  await row.getByRole('button',{name:'保存済み ✓',exact:true}).waitFor();
  assert.deepEqual(saves[0].p_permissions,{...permissions,order_approval:'operator'});
  assert.equal(await row.getByLabel('注文承認の権限',{exact:true}).isChecked(),true);
  await row.getByLabel('注文承認の権限',{exact:true}).uncheck();
  await row.getByRole('button',{name:'変更を保存',exact:true}).click();
  await row.getByRole('button',{name:'保存済み ✓',exact:true}).waitFor();
  assert.deepEqual(saves[1].p_permissions,{...permissions,order_approval:''});
  assert.equal(await page.locator('#newUser').getByLabel('注文承認の権限',{exact:true}).isChecked(),false);
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:950});
    await page.goto('https://orders.test/account/');
    const access=row.getByLabel('注文管理のアクセス権',{exact:true});
    await access.waitFor();
    assert.deepEqual(await access.locator('option').allTextContents(),['利用不可','管理者','作業者','閲覧者']);
    assert.deepEqual(await page.locator('#activeUsers [data-app-header]').evaluateAll(headers=>headers.map(h=>h.dataset.appHeader)),['rice_shipping','black_garlic_shipping','order_approval','garlic_fridge']);
    assert.match(await page.locator('#activeUsers [data-app-header="black_garlic_shipping"]').innerText(),/アクセス権/);
    await row.getByLabel('注文承認の権限',{exact:true}).check();
    for(const role of ['admin','viewer','','operator']){
      await access.selectOption(role);
      await row.getByRole('button',{name:'変更を保存',exact:true}).click();
      await row.getByRole('button',{name:'保存済み ✓',exact:true}).waitFor();
      assert.equal(await access.inputValue(),role);
      assert.equal(await row.getByLabel('注文承認の権限',{exact:true}).isChecked(),true);
      assert.deepEqual(saves.at(-1).p_permissions,{...permissions,black_garlic_shipping:role,order_approval:'operator'});
    }
    await row.getByLabel('注文承認の権限',{exact:true}).uncheck();
    await row.getByRole('button',{name:'変更を保存',exact:true}).click();
    await row.getByRole('button',{name:'保存済み ✓',exact:true}).waitFor();
    assert.equal(await access.inputValue(),'operator');
    if(artifacts){fs.mkdirSync(artifacts,{recursive:true});await access.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(artifacts,`order-access-${width}.png`)});}
  }
  assert.deepEqual(errors,[]);
  await page.goto('https://orders.test/menu.html');
  const entry=page.locator('a[data-app="black_garlic_shipping"]');
  await entry.waitFor({state:'visible'});
  assert.equal(await entry.locator('h2').innerText(),'注文管理');
  assert.equal(await entry.getAttribute('href'),'./orders/?openExternalBrowser=1');
  assert.equal(await page.locator('.card[data-app="order_approval"]').count(),0);
  for(const role of ['viewer','operator','']){
    sessionPermissions.black_garlic_shipping=role;
    await page.reload();
    await page.locator('#signedIn').getByText('テスト管理者（ログイン中）',{exact:true}).waitFor();
    assert.equal(await entry.isVisible(),role!=='');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS desktop/mobile: four independent order access roles, adjacent approval flag, preserved other permissions and denied menu access');
}finally{await context.close();await browser.close();}
