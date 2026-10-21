import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve('..');
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:950},serviceWorkers:'block'});
const permissions={rice_shipping:'admin',black_garlic_shipping:'operator'};
const user={workerId:'sales',workerName:'テスト担当',enabled:true,pinSet:true,systemAdmin:false,permissions};
const apps=[{app_id:'rice_shipping',app_name:'米穀出荷管理',migrated:true},{app_id:'black_garlic_shipping',app_name:'注文管理',migrated:true},{app_id:'order_approval',app_name:'注文承認',migrated:true}];
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
    if(name==='business_session')body={ok:true,workerId:'admin',workerName:'テスト管理者',systemAdmin:true,permissions:{black_garlic_shipping:'admin'}};
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
  assert.deepEqual(errors,[]);
  if(process.env.QA_ARTIFACTS)await page.screenshot({path:path.join(process.env.QA_ARTIFACTS,'orders-common-permissions.png'),fullPage:true});
  await page.goto('https://orders.test/menu.html');
  const entry=page.locator('a[data-app="black_garlic_shipping"]');
  await entry.waitFor({state:'visible'});
  assert.equal(await entry.locator('h2').innerText(),'注文管理');
  assert.equal(await entry.getAttribute('href'),'./orders/?openExternalBrowser=1');
  assert.equal(await page.locator('.card[data-app="order_approval"]').count(),0);
  console.log('PASS common user management: approval defaults OFF, explicit grant/revoke, unrelated app permissions unchanged');
}finally{await context.close();await browser.close();}
