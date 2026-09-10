(function () {
  'use strict';
  const storageKey = 'business.session.v1';
  let baseUrl = '', apiKey = '';
  const getToken = () => {
    try {
      let token=localStorage.getItem(storageKey)||'';
      if(!token){token=sessionStorage.getItem(storageKey)||'';if(token){localStorage.setItem(storageKey,token);sessionStorage.removeItem(storageKey);}}
      return token;
    } catch { try{return sessionStorage.getItem(storageKey)||'';}catch{return '';} }
  };
  const setToken = token => {
    try{if(token)localStorage.setItem(storageKey,token);else localStorage.removeItem(storageKey);}catch{}
    try{sessionStorage.removeItem(storageKey);}catch{}
  };
  const nativeFetch = window.fetch.bind(window);
  async function authorizedFetch(input, init = {}) {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value,key)=>headers.set(key,value));
    const token=getToken();
    const target=new URL(input instanceof Request?input.url:String(input),location.href);
    if (token && baseUrl && target.origin===new URL(baseUrl).origin) headers.set('x-business-session',token);
    return nativeFetch(input,{...init,headers});
  }
  async function rpc(name,args={}) {
    const response=await authorizedFetch(baseUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:apiKey,Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify(args)});
    const data=await response.json();
    if(!response.ok || data?.ok===false) throw new Error(data.error||data.message||'処理に失敗しました。');
    return data;
  }
  window.BusinessAuth={
    init(url,key){baseUrl=url;apiKey=key;},authorizedFetch,rpc,getToken,setToken,
    async mode(app){
      // Only a missing RPC means a not-yet-installed migration. Network errors fail closed.
      const response=await nativeFetch(baseUrl+'/rest/v1/rpc/business_app_mode',{method:'POST',headers:{apikey:apiKey,Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({p_app_id:app})});
      const data=await response.json();
      if(response.status===404&&data.code==='PGRST202')return false;
      if(!response.ok)throw new Error(data.message||'共通認証の状態を確認できません。');
      return data===true;
    },
    users:app=>rpc('business_login_users',{p_app_id:app}),
    async login(workerId,pin,app){const data=await rpc('business_login',{p_worker_id:workerId,p_pin:pin,p_app_id:app});setToken(data.token);return rpc('business_session');},
    async session(){if(!getToken())return null;try{return await rpc('business_session');}catch{setToken('');return null;}},
    async logout(){try{await rpc('business_logout');}finally{setToken('');}},
    allows(session,app,minimum='viewer'){const levels={admin:3,operator:2,viewer:1};return (levels[session?.permissions?.[app]]||0)>=(levels[minimum]||99);}
  };
  window.addEventListener('storage',event=>{if(event.key===storageKey)location.reload();});
})();
