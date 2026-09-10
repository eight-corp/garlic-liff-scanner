'use strict';
const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let current=null,data=null;
const roleOptions=[['','利用不可'],['admin','管理者'],['operator','作業者'],['viewer','閲覧者']];
const shortNames={garlic_fridge:'冷蔵庫',black_garlic:'黒にんにく',garlic_drying:'乾燥設備',frozen_ingredients:'冷食原料',rice_shipping:'米穀出荷'};

function status(message,success=false){$('status').textContent=message;$('status').classList.toggle('success',success);}
async function busy(form,fn){const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);try{status('');await fn();}catch(error){status(error.message);}finally{buttons.forEach(button=>button.disabled=false);}}
async function showLogin(){current=null;$('managementPanel').hidden=true;$('loginPanel').hidden=false;const users=await auth.users('management');$('loginUser').innerHTML=users.map(user=>`<option value="${esc(user.workerId)}">${esc(user.workerName)}</option>`).join('');}
async function refresh(){current=await auth.session();if(!current?.systemAdmin){await showLogin();return;}data=await auth.rpc('business_admin_data');$('loginPanel').hidden=true;$('managementPanel').hidden=false;$('signedIn').textContent=current.workerName+'（全体管理者）';render();}

function appHeaders(){return data.apps.map(app=>`<th>${esc(shortNames[app.app_id]||app.app_name)}<span class="app-state">${app.migrated?'切替済':'未移行'}</span></th>`).join('');}
function userRow(user,key,isNew=false){
 const formId=`user-form-${key}`;
 const input=(name,value,extra='')=>`<input form="${formId}" name="${name}" value="${esc(value)}" ${extra}>`;
 return `<tr><td class="user">${input('workerName',user.workerName,'class="cell-input" aria-label="氏名" required')}${input('workerId',user.workerId,`class="cell-input worker-id" aria-label="ユーザーID" ${isNew?'required':'readonly'}`)}</td><td><input class="compact-check" form="${formId}" name="enabled" type="checkbox" aria-label="共通管理で有効" ${user.enabled?'checked':''}></td>${data.apps.map(app=>`<td class="role-cell"><select class="cell-input" form="${formId}" data-app="${esc(app.app_id)}" aria-label="${esc(app.app_name)}の権限">${roleOptions.map(([value,label])=>`<option value="${value}" ${value===(user.permissions?.[app.app_id]||'')?'selected':''}>${label}</option>`).join('')}</select></td>`).join('')}<td class="pin-cell"><input class="cell-input" form="${formId}" name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6,12}" maxlength="12" placeholder="${user.pinSet?'変更時のみ':'新しいPIN'}"><input class="cell-input" form="${formId}" name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" placeholder="確認用PIN"></td><td class="action-cell"><form id="${formId}" data-user="${esc(user.workerId)}" data-new="${isNew}" data-pin-set="${user.pinSet}"><button>${isNew?'追加':'保存'}</button>${!isNew?`<button type="button" class="secondary" data-system="${user.systemAdmin?'false':'true'}">${user.systemAdmin?'管理者解除':'全体管理者にする'}</button>${user.systemAdmin?'<span class="admin-mark">全体管理者</span>':''}`:''}</form></td></tr>`;
}
function userTable(users,prefix,isNew=false){
 if(!users.length)return '<p class="empty">該当するユーザーはいません。</p>';
 return `<div class="table-wrap"><table><thead><tr><th>氏名・ID</th><th>有効</th>${appHeaders()}<th>共通PIN</th><th>操作</th></tr></thead><tbody>${users.map((user,index)=>userRow(user,`${prefix}-${index}`,isNew)).join('')}</tbody></table></div>`;
}
function render(){
 const filter=$('filter').value.trim();
 const visible=data.users.filter(user=>!filter||user.workerId.includes(filter)||user.workerName.includes(filter));
 const active=visible.filter(user=>user.enabled),inactive=visible.filter(user=>!user.enabled);
 $('activeUsers').innerHTML=userTable(active,'active');
 $('inactiveUsers').innerHTML=userTable(inactive,'inactive');
 $('activeCount').textContent=`${active.length}名`;
 $('inactiveCount').textContent=`${inactive.length}名`;
 $('inactiveSection').hidden=!inactive.length;
 if(filter&&inactive.length)$('inactiveSection').open=true;
 $('newUser').innerHTML=userTable([{workerId:'',workerName:'',enabled:true,permissions:{},pinSet:false}],'new',true);
}

$('filter').addEventListener('input',render);
$('loginForm').addEventListener('submit',event=>{event.preventDefault();busy(event.currentTarget,async()=>{await auth.login($('loginUser').value,$('loginPin').value,'management');$('loginPin').value='';await refresh();});});
$('setupForm').addEventListener('submit',event=>{event.preventDefault();busy(event.currentTarget,async()=>{if($('setupPin').value!==$('setupPinConfirm').value)throw new Error('確認用PINが一致しません。');auth.setToken($('setupToken').value.trim());try{await auth.rpc('business_setup_pin',{p_pin:$('setupPin').value});}finally{auth.setToken('');}$('setupForm').reset();await showLogin();status('初期設定が完了しました。新しい共通PINでログインしてください。',true);});});
$('refresh').addEventListener('click',()=>busy($('managementPanel'),refresh));
$('logout').addEventListener('click',()=>busy($('managementPanel'),async()=>{await auth.logout();await showLogin();status('ログアウトしました。',true);}));
$('managementPanel').addEventListener('submit',event=>{if(!event.target.matches('form[data-user]'))return;event.preventDefault();const form=event.target;busy(form,async()=>{
 const values=new FormData(form);if(values.get('pin')!==values.get('pinConfirm'))throw new Error('確認用PINが一致しません。');
 if(values.get('enabled')==='on'&&form.dataset.pinSet!=='true'&&!values.get('pin'))throw new Error('有効ユーザーには共通PINを設定してください。');
 const permissions=Object.fromEntries([...form.elements].filter(element=>element.dataset?.app).map(select=>[select.dataset.app,select.value]));
 await auth.rpc('business_admin_save',{p_worker_id:String(values.get('workerId')).trim(),p_worker_name:String(values.get('workerName')).trim(),p_enabled:values.get('enabled')==='on',p_permissions:permissions,p_new_pin:values.get('pin')||null});
 await refresh();status(form.dataset.new==='true'?'ユーザーを追加しました。':'保存しました。',true);
 });});
$('managementPanel').addEventListener('click',event=>{const button=event.target.closest('[data-system]');if(!button)return;const form=button.closest('form');busy(form,async()=>{if(!confirm(button.textContent+'：'+form.elements.workerName.value+'。実行しますか？'))return;await auth.rpc('business_admin_set_system_admin',{p_worker_id:form.dataset.user,p_enabled:button.dataset.system==='true'});await refresh();status('全体管理者の設定を更新しました。',true);});});
refresh().catch(error=>status(error.message));
