const key='xutu-auth:remembered-v1';
const origin='https://plan.fpgabbs.cn';

export function triggerLogin({account,password}){
 if(location.origin!=='https://plan.fpgabbs.cn')return 'wrong_origin';
 const form=document.querySelector('form#cloudLoginForm');
 if(!form||!form.getClientRects().length||form.closest('[hidden],[inert]'))return 'no_visible_login';
 if(form.querySelector('input[autocomplete="one-time-code"], [id*="captcha" i], [name*="captcha" i]'))return 'manual_verification';
 const fields=[...form.querySelectorAll('input:not([type="hidden"])')].filter(el=>!el.disabled&&!el.readOnly);
 const passwordFields=fields.filter(el=>el.type==='password'),accounts=fields.filter(el=>['text','email'].includes(el.type));
 if(accounts.length!==1||passwordFields.length!==1||form.method?.toLowerCase()==='get'&&form.hasAttribute('method')||form.target&&form.target!=='_self')return 'unsupported_form';
 if(form.hasAttribute('action')&&new URL(form.action,location.href).origin!==location.origin)return 'wrong_origin';
 const [name]=accounts,[secret]=passwordFields;
 if(name.value||secret.value)return 'manual_in_progress';
 name.value=account;secret.value=password;
 name.dispatchEvent(new Event('input',{bubbles:true}));secret.dispatchEvent(new Event('input',{bubbles:true}));
 if(!form.checkValidity()){name.value='';secret.value='';return 'invalid_fields';}
 // Only the site's normal submit wiring, never a guessed authentication endpoint.
 const preventQuery=event=>{if(event.target===form)event.preventDefault();};
 window.addEventListener('submit',preventQuery);
 try{form.requestSubmit();}finally{window.removeEventListener('submit',preventQuery);secret.value='';}
 return 'attempted';
}

export function rememberedLogin(store,{inspectSession,submit,now=()=>Date.now()}){
 const attempts=new Map(),running=new Set();let generation=0;
 return {
  async status(){const c=await store.get(key);return {enabled:!!c,account:c?.account||''};},
  async save(account,password){
   if(typeof account!=='string'||!/^[a-zA-Z0-9._@-]{1,100}$/.test(account.trim())||typeof password!=='string'||!password||password.length>300||/[\x00]/.test(password))throw Error('请填写有效的序图登录账号和密码。');
   await store.set(key,{account:account.trim(),password});
   generation++;attempts.clear();
   return {enabled:true,account:account.trim()};
  },
  async clear(){await store.remove(key);generation++;attempts.clear();return {enabled:false,account:''};},
  async onPage(tab){
   if(!tab?.id||!tab.url||running.has(tab.id))return 'skipped';
   const url=new URL(tab.url);if(url.origin!==origin||url.username||url.password)return 'wrong_origin';
   const start=generation;
   running.add(tab.id);
   try{
    const c=await store.get(key);if(!c)return 'disabled';
    const s=await inspectSession(tab);
    if(s!=='logged_out'||start!==generation)return s;
    const last=attempts.get(c.account);
    if(last!==undefined&&now()-last<120000)return 'already_attempted';
    // Reserve before awaiting submission across all tabs for this one account.
    attempts.set(c.account,now());
    const result=await submit(tab,c);
    if(['no_visible_login','manual_in_progress','unsupported_form'].includes(result))attempts.delete(c.account);
    return result;
   }finally{running.delete(tab.id);}
  }
 };
}
