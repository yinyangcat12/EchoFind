import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizeRoomItems } from './room-items.mjs';

const COOKIE = '__Host-echofind_session';
const LIFETIME = 8 * 3600;
const IMPORT_MAP = '\n{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}\n';
const CSP = `default-src 'self'; script-src 'self' 'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'none'; worker-src 'self' blob:`;
const FILES = new Set(['/control.html','/control.js','/common.js','/styles.css','/control.css','/assets/logo.svg','/assets/room-preview.png','/assets/models/room.glb']);
const ROUTES = new Set(['/api/session','/api/login','/api/room-items']);
class PublicError extends Error { constructor(status,message){super(message);this.status=status;} }
const hash = value => createHash('sha256').update(String(value)).digest();
function equal(a,b){return timingSafeEqual(hash(a),hash(b));}
function configured(env){return typeof env.APP_ACCESS_PASSWORD==='string' && env.APP_ACCESS_PASSWORD.length>=16 && typeof env.SESSION_SECRET==='string' && env.SESSION_SECRET.length>=32;}
function signingKey(env){return hash(`echofind-session-v1\0${env.SESSION_SECRET}\0${env.APP_ACCESS_PASSWORD}`);}
function sign(value,env){return createHmac('sha256',signingKey(env)).update(value).digest('hex');}
function session(request,env,now){
 if(!configured(env))return null;
 const raw=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-echofind_session=(v1\.[a-f0-9]{48}\.\d{10}\.[a-f0-9]{64})(?:;|$)/)?.[1];
 if(!raw)return null;
 const parts=raw.split('.'),expires=Number(parts[2]),seconds=Math.floor(now()/1000);
 if(expires<=seconds || expires>seconds+LIFETIME+60 || !equal(parts[3],sign(parts.slice(0,3).join('.'),env)))return null;
 return parts[1];
}
function json(value,status=200,headers={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});}
function secure(response){
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');
 headers.set('Referrer-Policy','same-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',CSP);headers.set('X-Robots-Tag','noindex, nofollow');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function originCheck(request){
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new PublicError(403,'不允许跨站请求。');
 const origin=request.headers.get('origin');
 if(origin && origin!==new URL(request.url).origin)throw new PublicError(403,'不允许跨站请求。');
}
async function readJson(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new PublicError(415,'请使用 JSON 格式。');
 if(Number(request.headers.get('content-length')||0)>8192)throw new PublicError(413,'请求过大。');
 if(!request.body)throw new PublicError(400,'请求为空。');
 const reader=request.body.getReader();let size=0;const chunks=[];
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new PublicError(413,'请求过大。');}chunks.push(value);}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!data || typeof data!=='object' || Array.isArray(data))throw Error();
  return data;
 }catch(e){if(e instanceof PublicError)throw e;throw new PublicError(400,'请求格式无效。');}
}

export function createWorker({fetcher=(...args)=>fetch(...args),now=()=>Date.now()}={}){
 const limits=new Map();let configuration='',token={value:'',until:0},tokenRequest=null,snapshot=null,recordRequest=null;
 function limit(key,maximum,duration){
  const t=now();if(limits.size>=10000){for(const [k,v]of limits)if(v.until<=t)limits.delete(k);if(limits.size>=10000&&!limits.has(key))throw new PublicError(429,'请求过多，请稍后再试。');}
  let entry=limits.get(key);if(!entry||entry.until<=t)entry={count:0,until:t+duration};entry.count++;limits.set(key,entry);
  if(entry.count>maximum)throw new PublicError(429,'操作过于频繁，请稍后再试。');
 }
 async function upstream(url,options={}){
  let result;
  try{const r=await fetcher(url,{...options,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error();result=await r.json();}
  catch{throw new PublicError(502,'飞书服务暂时不可用，请稍后再试。');}
  if(!result || result.code!==0)throw new PublicError(502,'飞书请求失败，请检查应用权限和后台配置。');
  return result;
 }
 async function tenantToken(env){
  if(token.value && token.until>now())return token.value;
  if(!tokenRequest)tokenRequest=(async()=>{
   const result=await upstream('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({app_id:env.FEISHU_APP_ID,app_secret:env.FEISHU_APP_SECRET})});
   if(typeof result.tenant_access_token!=='string' || !result.tenant_access_token)throw new PublicError(502,'飞书认证失败。');
   const ttl=Math.min(7200,Number(result.expire)||7200);
   token={value:result.tenant_access_token,until:now()+Math.max(1,ttl-120)*1000};return token.value;
  })().finally(()=>{tokenRequest=null;});
  return tokenRequest;
 }
 async function records(env){
  if(snapshot && snapshot.until>now())return snapshot;
  if(!recordRequest)recordRequest=(async()=>{
   const authorization=`Bearer ${await tenantToken(env)}`;const items=[];let page='';
   // Bound external requests for the free Worker plan; never silently truncate.
   for(let n=0;n<20;n++){
    const url=new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${encodeURIComponent(env.FEISHU_APP_TOKEN)}/tables/${encodeURIComponent(env.FEISHU_TABLE_ID)}/records`);
    url.searchParams.set('page_size','100');if(page)url.searchParams.set('page_token',page);
    const result=await upstream(url,{headers:{Authorization:authorization}});
    if(!Array.isArray(result.data?.items))throw new PublicError(502,'飞书返回的数据格式无效。');
    items.push(...result.data.items);
    if(!result.data.has_more){snapshot={items,updatedAt:new Date(now()).toISOString(),until:now()+1000};return snapshot;}
    page=result.data.page_token;
    if(typeof page!=='string'||!page)throw new PublicError(502,'飞书分页数据不完整。');
   }
   throw new PublicError(502,'演示表超过 2000 条记录，请缩小表格范围。');
  })().finally(()=>{recordRequest=null;});
  return recordRequest;
 }
 async function route(request,env){
  const url=new URL(request.url),pathname=url.pathname;
  if(pathname!==decodeURIComponent(pathname) || pathname.includes('\\') || pathname.split('/').some(p=>p.startsWith('.')))return new Response('Not found',{status:404});
  if(pathname==='/control' && ['GET','HEAD'].includes(request.method))return Response.redirect(new URL('/control.html'+url.search,url),308);
  if(!pathname.startsWith('/api/')){
   const asset=FILES.has(pathname) || /^\/vendor\/three\/(?:build|examples\/jsm)\/[A-Za-z0-9_./-]+\.js$/.test(pathname);
   if(!asset)return new Response('Not found',{status:404});
   if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
   return env.ASSETS.fetch(request);
  }
  if(!ROUTES.has(pathname))throw new PublicError(404,'接口不存在。');
  const ip=request.headers.get('CF-Connecting-IP')||'local';
  if(request.method!=='GET')originCheck(request);
  const publicDemo = env.PUBLIC_DEMO === 'true';
  if(pathname==='/api/session' && request.method==='GET')return json({authenticated:publicDemo || Boolean(session(request,env,now)),passwordRequired:!publicDemo});
  if(pathname==='/api/login' && request.method==='POST'){
   if(publicDemo)throw new PublicError(404,'公开演示无需登录。');
   // Per-isolate defense; optional platform limiter strengthens distributed protection.
   if(env.LOGIN_RATE_LIMITER){const result=await env.LOGIN_RATE_LIMITER.limit({key:ip});if(!result.success)throw new PublicError(429,'登录尝试过多，请稍后再试。');}
   limit('login:'+ip,8,600000);
   if(!configured(env))throw new PublicError(503,'请管理员先在 Cloudflare 设置访问密码（至少16位）和 SESSION_SECRET（至少32位）。');
   const input=await readJson(request);
   if(typeof input.password!=='string'||!equal(input.password,env.APP_ACCESS_PASSWORD))throw new PublicError(401,'访问密码不正确。');
   const unsigned=`v1.${randomBytes(24).toString('hex')}.${Math.floor(now()/1000)+LIFETIME}`;
   return json({ok:true},200,{'Set-Cookie':`${COOKIE}=${unsigned}.${sign(unsigned,env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${LIFETIME}`});
  }
  if(pathname==='/api/session' && request.method==='DELETE')return json({ok:true},200,{'Set-Cookie':`${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`});
  const identity=publicDemo ? 'public-ip:'+ip : session(request,env,now);
  if(!identity)throw new PublicError(401,'请先输入访问密码。');
  limit('data:'+identity,100,60000);
  if(pathname==='/api/room-items' && request.method==='GET'){
   const seed=url.searchParams.get('placementSeed');
   if(!seed || !/^[a-f0-9-]{16,64}$/i.test(seed))throw new PublicError(400,'位置布局参数无效。');
   const values=['FEISHU_APP_ID','FEISHU_APP_SECRET','FEISHU_APP_TOKEN','FEISHU_TABLE_ID'].map(k=>env[k]);
   if(!values.every(v=>typeof v==='string'&&v.trim()))return json({source:'unconfigured',sourceLabel:'尚未配置飞书多维表格',updatedAt:null,simulated:true,pollIntervalMs:5000,items:[]});
   const current=hash(JSON.stringify(values)).toString('hex');
   if(current!==configuration){configuration=current;token={value:'',until:0};tokenRequest=null;snapshot=null;recordRequest=null;}
   const data=await records(env);
   return json({source:'feishu',sourceLabel:'飞书多维表格',updatedAt:data.updatedAt,positionUpdatedAt:new Date(now()).toISOString(),simulated:true,randomizeOnRefresh:false,randomizeOnPageReload:true,pollIntervalMs:5000,items:normalizeRoomItems(data.items,seed,env.FEISHU_DEFAULT_STATION||'LeftUpper')});
  }
  throw new PublicError(405,'不支持此请求方法。');
 }
 return {async fetch(request,env){try{return secure(await route(request,env));}catch(error){return secure(json({error:error instanceof PublicError?error.message:'服务暂时不可用，请稍后重试。'},error instanceof PublicError?error.status:500));}}};
}
export default createWorker();