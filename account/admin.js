'use strict';
const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let current=null,data=null;
function status(message,success=false){$('status').textContent=message;$('status').classList.toggle('success',success);}
async function busy(form,fn){const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{status('');await fn();}catch(e){status(e.message);}finally{buttons.forEach(b=>b.disabled=false);}}
async function showLogin(){current=null;$('managementPanel').hidden=true;$('loginPanel').hidden=false;const users=await auth.users('management');$('loginUser').innerHTML=users.map(u=>`<option value="${esc(u.workerId)}">${esc(u.workerName)}</option>`).join('');}
async function refresh(){current=await auth.session();if(!current?.systemAdmin){await showLogin();return;}data=await auth.rpc('business_admin_data');$('loginPanel').hidden=true;$('managementPanel').hidden=false;$('signedIn').textContent=current.workerName+'（全体管理者）';render();}
function userForm(user,isNew=false){
 const roles=[['','利用不可'],['admin','管理者'],['operator','作業者'],['viewer','閲覧者']];
 return `<form data-user="${esc(user.workerId)}" data-new="${isNew}"><div class="grid"><label>ユーザーID<input name="workerId" value="${esc(user.workerId)}" ${isNew?'required':'readonly'}></label><label>氏名<input name="workerName" value="${esc(user.workerName)}" required></label></div><label><input name="enabled" type="checkbox" ${user.enabled?'checked':''}> 共通管理で有効</label><div class="grid">${data.apps.map(app=>`<label>${esc(app.app_name)} <span class="tag">${app.migrated?'切替済':'未移行'}</span><select data-app="${esc(app.app_id)}">${roles.map(([value,label])=>`<option value="${value}" ${value===(user.permissions?.[app.app_id]||'')?'selected':''}>${label}</option>`).join('')}</select></label>`).join('')}</div><label>${user.pinSet?'共通PINを変更（空欄なら変更なし）':'新しい共通PIN（6～12桁）'}<input name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6,12}" maxlength="12" ${user.pinSet?'':'required'}></label><label>確認用PIN<input name="pinConfirm" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12"></label><div class="row"><button>保存</button>${!isNew?`<button type="button" class="secondary" data-system="${user.systemAdmin?'false':'true'}">${user.systemAdmin?'全体管理者を解除':'全体管理者にする'}</button>`:''}</div></form>`;
}
function render(){
 const filter=$('filter').value.trim();
 $('users').innerHTML=data.users.filter(u=>!filter||u.workerId.includes(filter)||u.workerName.includes(filter)).map(u=>`<details class="card"><summary>${esc(u.workerName)} <span class="tag">${u.systemAdmin?'全体管理者 / ':''}${u.enabled?'有効':'無効'} / ${u.pinSet?'共通PIN設定済み':'共通PIN未設定'}</span></summary>${userForm(u)}</details>`).join('');
 $('newUser').innerHTML=userForm({workerId:'',workerName:'',enabled:true,permissions:{},pinSet:false},true);
}
$('filter').addEventListener('input',render);
$('loginForm').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{await auth.login($('loginUser').value,$('loginPin').value,'management');$('loginPin').value='';await refresh();});});
$('setupForm').addEventListener('submit',e=>{e.preventDefault();busy(e.currentTarget,async()=>{if($('setupPin').value!==$('setupPinConfirm').value)throw new Error('確認用PINが一致しません。');auth.setToken($('setupToken').value.trim());try{await auth.rpc('business_setup_pin',{p_pin:$('setupPin').value});}finally{auth.setToken('');}$('setupForm').reset();await showLogin();status('初期設定が完了しました。新しい共通PINでログインしてください。',true);});});
$('refresh').addEventListener('click',()=>busy($('managementPanel'),refresh));
$('logout').addEventListener('click',()=>busy($('managementPanel'),async()=>{await auth.logout();await showLogin();status('ログアウトしました。',true);}));
$('managementPanel').addEventListener('submit',e=>{if(!e.target.matches('form[data-user]'))return;e.preventDefault();const form=e.target;busy(form,async()=>{
 const values=new FormData(form);if(values.get('pin')!==values.get('pinConfirm'))throw new Error('確認用PINが一致しません。');
 const permissions=Object.fromEntries([...form.querySelectorAll('[data-app]')].map(s=>[s.dataset.app,s.value]));
 await auth.rpc('business_admin_save',{p_worker_id:String(values.get('workerId')).trim(),p_worker_name:String(values.get('workerName')).trim(),p_enabled:values.get('enabled')==='on',p_permissions:permissions,p_new_pin:values.get('pin')||null});
 await refresh();status('保存しました。',true);
 });});
$('managementPanel').addEventListener('click',e=>{const button=e.target.closest('[data-system]');if(!button)return;const form=button.closest('form');busy(form,async()=>{
 if(!confirm(button.textContent+'：'+form.elements.workerName.value+'。実行しますか？'))return;
 await auth.rpc('business_admin_set_system_admin',{p_worker_id:form.dataset.user,p_enabled:button.dataset.system==='true'});await refresh();status('全体管理者の設定を更新しました。',true);
 });});
refresh().catch(e=>status(e.message));
