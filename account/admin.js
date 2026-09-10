'use strict';
const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let current=null,data=null,pinTargetFormId='',statusTimer=0;
const roleOptions=[['','利用不可'],['admin','管理者'],['operator','作業者'],['viewer','閲覧者']];
const shortNames={garlic_fridge:'冷蔵庫',black_garlic:'黒にんにく',garlic_drying:'乾燥設備',frozen_ingredients:'冷食原料',rice_shipping:'米穀出荷'};

function status(message,success=false){clearTimeout(statusTimer);$('status').textContent=message;$('status').classList.toggle('success',success);if(message&&success)statusTimer=setTimeout(()=>status(''),5000);}
async function busy(form,fn){const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);let succeeded=false;try{status('');await fn();succeeded=true;}catch(error){status(error.message);}finally{buttons.forEach(button=>button.disabled=false);}return succeeded;}
async function showLogin(){current=null;$('managementPanel').hidden=true;$('loginPanel').hidden=false;const users=await auth.users('management');$('loginUser').innerHTML=users.map(user=>`<option value="${esc(user.workerId)}">${esc(user.workerName)}</option>`).join('');}
async function refresh(){current=await auth.session();if(!current?.systemAdmin){await showLogin();return;}data=await auth.rpc('business_admin_data');$('loginPanel').hidden=true;$('managementPanel').hidden=false;$('signedIn').textContent=current.workerName+'（全体管理者）';render();}

function appHeaders(){return data.apps.map(app=>`<th>${esc(shortNames[app.app_id]||app.app_name)}<span class="app-state">${app.migrated?'切替済':'未移行'}</span></th>`).join('');}
function userRow(user,key,isNew=false){
 const formId=`user-form-${key}`;
 const idCell=isNew?`<input class="cell-input" form="${formId}" name="workerId" aria-label="ユーザーID" required>`:`<span title="${esc(user.workerId)}">${esc(user.workerId)}</span><input form="${formId}" name="workerId" type="hidden" value="${esc(user.workerId)}">`;
 return `<tr><td class="id-cell">${idCell}</td><td class="name-cell"><input class="cell-input" form="${formId}" name="workerName" value="${esc(user.workerName)}" aria-label="氏名" required></td><td><input class="compact-check" form="${formId}" name="enabled" type="checkbox" aria-label="共通管理で有効" ${user.enabled?'checked':''}></td>${data.apps.map(app=>`<td class="role-cell"><select class="cell-input" form="${formId}" data-app="${esc(app.app_id)}" aria-label="${esc(app.app_name)}の権限">${roleOptions.map(([value,label])=>`<option value="${value}" ${value===(user.permissions?.[app.app_id]||'')?'selected':''}>${label}</option>`).join('')}</select></td>`).join('')}<td class="pin-cell"><button type="button" class="secondary" data-pin-form="${formId}">${user.pinSet?'変更':'設定'}</button><span class="pin-state">${user.pinSet?'設定済':'未設定'}</span></td><td class="system-cell">${isNew?'―':`<button type="button" class="secondary" data-system="${user.systemAdmin?'false':'true'}" data-form-id="${formId}">${user.systemAdmin?'解除':'設定'}</button>${user.systemAdmin?'<span class="admin-mark"> 管理者</span>':''}`}</td><td class="action-cell"><form id="${formId}" data-user="${esc(user.workerId)}" data-new="${isNew}" data-pin-set="${user.pinSet}"><input name="pin" type="hidden"><input name="pinConfirm" type="hidden"><button class="save-button">${isNew?'追加':'保存'}</button></form></td></tr>`;
}
function userTable(users,prefix,isNew=false){
 if(!users.length)return '<p class="empty">該当するユーザーはいません。</p>';
 return `<div class="table-wrap"><table><thead><tr><th>ID</th><th>氏名</th><th>有効</th>${appHeaders()}<th>共通PIN</th><th>全体管理</th><th>保存</th></tr></thead><tbody>${users.map((user,index)=>userRow(user,`${prefix}-${index}`,isNew)).join('')}</tbody></table></div>`;
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
function openPinDialog(button){
 pinTargetFormId=button.dataset.pinForm;
 const form=document.getElementById(pinTargetFormId);
 $('pinTargetName').textContent=form.elements.workerName.value;
 $('dialogPin').value='';$('dialogPinConfirm').value='';$('pinDialogError').textContent='';
 $('pinDialog').showModal();$('dialogPin').focus();
}
function markDirty(form){
 const row=form?.closest('tr'),button=form?.querySelector('.save-button');
 if(!row||!button)return;
 row.classList.remove('saved-row');row.classList.add('dirty-row');
 button.textContent=form.dataset.new==='true'?'追加':'変更を保存';
}
function markSaved(workerId){
 const form=[...document.querySelectorAll('form[data-user]')].find(item=>item.dataset.user===workerId);
 const row=form?.closest('tr'),button=form?.querySelector('.save-button');
 if(!row||!button)return;
 row.classList.add('saved-row');button.textContent='保存済み ✓';
 setTimeout(()=>{if(!row.isConnected)return;row.classList.remove('saved-row');button.textContent='保存';},5000);
}

$('filter').addEventListener('input',render);
$('loginForm').addEventListener('submit',event=>{event.preventDefault();busy(event.currentTarget,async()=>{await auth.login($('loginUser').value,$('loginPin').value,'management');$('loginPin').value='';await refresh();});});
$('setupForm').addEventListener('submit',event=>{event.preventDefault();busy(event.currentTarget,async()=>{if($('setupPin').value!==$('setupPinConfirm').value)throw new Error('確認用PINが一致しません。');auth.setToken($('setupToken').value.trim());try{await auth.rpc('business_setup_pin',{p_pin:$('setupPin').value});}finally{auth.setToken('');}$('setupForm').reset();await showLogin();status('初期設定が完了しました。新しい共通PINでログインしてください。',true);});});
$('refresh').addEventListener('click',()=>busy($('managementPanel'),refresh));
$('logout').addEventListener('click',()=>busy($('managementPanel'),async()=>{await auth.logout();await showLogin();status('ログアウトしました。',true);}));
$('pinCancel').addEventListener('click',()=>$('pinDialog').close());
$('pinApply').addEventListener('click',()=>{const pin=$('dialogPin').value,confirmation=$('dialogPinConfirm').value;if(!/^[0-9]{6,12}$/.test(pin)){$('pinDialogError').textContent='共通PINは6～12桁の数字です。';return;}if(pin!==confirmation){$('pinDialogError').textContent='確認用PINが一致しません。';return;}const form=document.getElementById(pinTargetFormId);form.elements.pin.value=pin;form.elements.pinConfirm.value=confirmation;document.querySelector(`[data-pin-form="${pinTargetFormId}"]`).textContent='変更あり';markDirty(form);$('pinDialog').close();status('PINを入力しました。右端の「変更を保存」を押してください。',true);});
$('managementPanel').addEventListener('input',event=>{const form=event.target.form;if(form?.matches('form[data-user]'))markDirty(form);});
$('managementPanel').addEventListener('change',event=>{const form=event.target.form;if(form?.matches('form[data-user]'))markDirty(form);});
$('managementPanel').addEventListener('submit',async event=>{if(!event.target.matches('form[data-user]'))return;event.preventDefault();const form=event.target,isNew=form.dataset.new==='true';const values=new FormData(form),workerId=String(values.get('workerId')).trim();const saveButton=form.querySelector('.save-button');saveButton.textContent=isNew?'追加中…':'保存中…';const succeeded=await busy(form,async()=>{
 if(values.get('pin')!==values.get('pinConfirm'))throw new Error('確認用PINが一致しません。');
 if(values.get('enabled')==='on'&&form.dataset.pinSet!=='true'&&!values.get('pin'))throw new Error('有効ユーザーには共通PINを設定してください。');
 const permissions=Object.fromEntries([...form.elements].filter(element=>element.dataset?.app).map(select=>[select.dataset.app,select.value]));
 await auth.rpc('business_admin_save',{p_worker_id:workerId,p_worker_name:String(values.get('workerName')).trim(),p_enabled:values.get('enabled')==='on',p_permissions:permissions,p_new_pin:values.get('pin')||null});
 await refresh();markSaved(workerId);status(isNew?'ユーザーを追加しました。':'保存しました。',true);
 });if(!succeeded&&saveButton.isConnected)saveButton.textContent=isNew?'追加':'変更を保存';});
$('managementPanel').addEventListener('click',event=>{const pinButton=event.target.closest('[data-pin-form]');if(pinButton){openPinDialog(pinButton);return;}const button=event.target.closest('[data-system]');if(!button)return;const form=document.getElementById(button.dataset.formId);busy(form,async()=>{if(!confirm((button.dataset.system==='true'?'全体管理者に設定':'全体管理者を解除')+'：'+form.elements.workerName.value+'。実行しますか？'))return;await auth.rpc('business_admin_set_system_admin',{p_worker_id:form.dataset.user,p_enabled:button.dataset.system==='true'});await refresh();status('全体管理者の設定を更新しました。',true);});});
refresh().catch(error=>status(error.message));
