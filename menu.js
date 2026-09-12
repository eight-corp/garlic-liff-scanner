'use strict';
const auth=window.BusinessAuth;
auth.init(window.BusinessConfig.url,window.BusinessConfig.key);
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const appIds=['garlic_fridge','black_garlic','garlic_drying','frozen_ingredients','rice_shipping'];
const roleNames={admin:'管理者',operator:'作業者',viewer:'閲覧者'};
const lastUserKey='business.lastUser.v1';
let loginUsers=new Map();

function setStatus(message,target='status'){$(target).textContent=message;}
function lastUser(){try{return localStorage.getItem(lastUserKey)||'';}catch{return '';}}
function rememberUser(workerId){try{localStorage.setItem(lastUserKey,workerId);}catch{}}
async function loadLoginUsers(){
 const scopes=['management',...appIds];
 const lists=await Promise.all(scopes.map(appId=>auth.users(appId).then(users=>({appId,users}))));
 loginUsers=new Map();
 for(const {appId,users} of lists)for(const user of users)if(!loginUsers.has(user.workerId))loginUsers.set(user.workerId,{...user,appId});
 $('loginUser').innerHTML=[...loginUsers.values()].map(user=>`<option value="${esc(user.workerId)}">${esc(user.workerName)}</option>`).join('');
 if(!loginUsers.size)throw new Error('ログイン可能なユーザーが設定されていません。');
 const remembered=lastUser();if(loginUsers.has(remembered))$('loginUser').value=remembered;
}
async function showLogin(){
 $('menuPanel').hidden=true;$('loginPanel').hidden=false;
 await loadLoginUsers();
}
async function showMenu(session){
 $('loginPanel').hidden=true;$('menuPanel').hidden=false;
 $('signedIn').textContent=`${session.workerName}（ログイン中）`;
 let visible=0;
 document.querySelectorAll('.card[data-app]').forEach(card=>{
  const role=session.permissions?.[card.dataset.app]||'';
  const allowed=!!role&&(!card.dataset.minRole||auth.allows(session,card.dataset.app,card.dataset.minRole));
  card.hidden=!allowed;
  let badge=card.querySelector('.role');
  if(allowed){visible++;if(!badge){badge=document.createElement('span');badge.className='role';card.querySelector('.description').after(badge);}badge.textContent=roleNames[role]||role;}
 });
 $('managementLink').hidden=!session.systemAdmin;
 $('noApps').hidden=visible>0;
}
async function refresh(){
 const session=await auth.session();
 if(session){await showMenu(session);return;}
 await showLogin();
}

$('loginForm').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;setStatus('');
 try{const user=loginUsers.get($('loginUser').value);if(!user)throw new Error('ユーザーを選択してください。');const session=await auth.login(user.workerId,$('loginPin').value,user.appId);rememberUser(user.workerId);$('loginPin').value='';await showMenu(session);}
 catch(error){setStatus(error.message);}
 finally{button.disabled=false;}
});
$('logout').addEventListener('click',async()=>{const button=$('logout');button.disabled=true;try{await auth.logout();await showLogin();setStatus('ログアウトしました。');}catch(error){setStatus(error.message,'menuStatus');}finally{button.disabled=false;}});
refresh().catch(error=>setStatus(error.message));
