import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory} from 'fake-indexeddb';
import {LocalStore} from '../extension/local-store.js';
import {choosePlanTab} from '../extension/active-plan-tab.js';
import {rememberedLogin,triggerLogin} from '../extension/remember-login.js';

test('自动优先当前窗口的序图；多窗口歧义时不盲选，也不选外站',()=>{
 const plan=(id,windowId,active)=>({id,windowId,active,url:'https://plan.fpgabbs.cn/?plan=synthetic'});
 const a=plan(1,1,true),b=plan(2,2,true),c=plan(3,2,false);
 assert.equal(choosePlanTab([a,b,c],2,2),b);
 assert.equal(choosePlanTab([a,b]),null);
 assert.equal(choosePlanTab([{...b,url:'https://evil.test/'},c],2,2),c);
});
test('全新无登录记忆页面：空凭据不会提交，启用后首次只提交一遍，密码不回显，清除后停用',async()=>{
 const page=()=>new JSDOM('<form id="cloudLoginForm"><input type="text"><input type="password"><button>登录</button></form>',{url:'https://plan.fpgabbs.cn/',runScripts:'outside-only'});
 const dom=page(),fresh=page(),store=new LocalStore(new IDBFactory());
 let posts=0;
 const submit=async(tab,data)=>{
  const w=(tab.id===1?dom:fresh).window,form=w.document.querySelector('form');form.getClientRects=()=>[{}];
  form.addEventListener('submit',e=>{e.preventDefault();posts++;assert.equal(form.querySelector('input[type=text]').value,'synthetic-user');assert.equal(form.querySelector('[type=password]').value,'qa-secret');},{once:true});
  return w.eval('('+triggerLogin.toString()+')')(data);
 };
 const auth=rememberedLogin(store,{inspectSession:async()=> 'logged_out',submit});
 const tab=id=>({id,url:'https://plan.fpgabbs.cn/'});
 try{
  assert.equal(await auth.onPage(tab(1)),'disabled');assert.equal(posts,0);
  await auth.save('synthetic-user','qa-secret');
  assert.equal(await auth.onPage(tab(2)),'attempted');assert.equal(posts,1);
  assert.equal((await auth.status()).password,undefined);
  assert.equal(fresh.window.document.querySelector('[type=password]').value,'');
  await auth.clear();assert.equal(await auth.onPage(tab(1)),'disabled');assert.equal(posts,1);
 }finally{dom.window.close();fresh.window.close();}
});

test('登录页预填已保存的账号时继续登录，其他账号或已输入的密码保留原值', () => {
 const dom = new JSDOM('<form id="cloudLoginForm"><input type="text"><input type="password"></form>', {url:'https://plan.fpgabbs.cn/',runScripts:'outside-only'});
 try {
  const form = dom.window.document.querySelector('form'), [name, secret] = form.elements;
  form.getClientRects = () => [{}];
  let submitted = 0;
  form.addEventListener('submit', event => { event.preventDefault(); submitted++; });
  const login = dom.window.eval('(' + triggerLogin.toString() + ')');
  name.value = 'another';
  assert.equal(login({account:'saved',password:'test'}), 'manual_in_progress');
  assert.equal(name.value, 'another');
  name.value = 'saved'; secret.value = 'typing';
  assert.equal(login({account:'saved',password:'test'}), 'manual_in_progress');
  assert.equal(secret.value, 'typing');
  secret.value = '';
  assert.equal(login({account:'saved',password:'test'}), 'attempted');
  assert.equal(submitted, 1);
  assert.equal(secret.value, '');
 } finally { dom.window.close(); }
});
