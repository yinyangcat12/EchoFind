const paths = {
 dashboard:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', cube:'m12 2 9 5v10l-9 5-9-5V7l9-5Z M3 7l9 5 9-5M12 12v10',
 arrow:'M4 12h16M13 5l7 7-7 7', 'arrow-left':'M20 12H4M11 5l-7 7 7 7', 'arrow-up':'M12 20V4M5 11l7-7 7 7',
 shield:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM8 12l3 3 5-6', settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 chevrons:'m8 9 4-4 4 4M8 15l4 4 4-4', refresh:'M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5', link:'m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
 lock:'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4M12 14v3', leaf:'M20 3C10 3 3 7 3 13a7 7 0 0 0 12 5c4-4 5-9 5-15ZM5 19 15 9', menu:'M4 6h16M4 12h16M4 18h16',
 temperature:'M10 14V5a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0ZM12 10v7', humidity:'M12 2C8 7 4 11 4 15a8 8 0 0 0 16 0c0-4-4-8-8-13ZM8 16a4 4 0 0 0 4 3', energy:'m13 2-9 12h7l-1 8 10-13h-7l1-7Z',
 occupancy:'M9 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2', check:'M5 12l4 4L19 6', trend:'m4 8 6 6 4-4 6 6M20 11v5h-5',
 camera:'M3 6h5l2-3h4l2 3h5v15H3zM12 9a4 4 0 1 0 0 8 4 4 0 0 0 0-8', expand:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5', plus:'M12 4v16M4 12h16', minus:'M4 12h16',
 rotate:'M20 4v5h-5M20 9a8 8 0 1 0 0 7', grid:'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18', mouse:'M8 2h8a3 3 0 0 1 3 3v12a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5V5a3 3 0 0 1 3-3ZM12 2v7',
 sun:'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2M18 18l2 2M4 20l2-2M18 6l2-2', box:'M4 7h16v14H4zM3 3h18v4H3zM9 11h6',
 layers:'m12 2 10 5-10 5L2 7l10-5ZM2 12l10 5 10-5M2 17l10 5 10-5', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', info:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 11v6M12 7v1',
};
export function icon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`; }
export function initIcons(parent = document) { parent.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
let toastTimer;
export function toast(message) { const el=document.querySelector('#toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4500); }
export async function api(url, options = {}) {
 const res=await fetch(url,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...options.headers}});const result=await res.json();
 if(!res.ok){const error=new Error(result.error || '请求失败');error.status=res.status;throw error;}return result;
}
export async function requireSession() {
 const session=await api('/api/session');if(session.authenticated)return;
 return new Promise(resolve=>{const overlay=document.createElement('div');overlay.className='login-overlay';
 overlay.innerHTML=`<form class="login-card"><img src="/assets/logo.svg" alt="RoomOS"><div class="eyebrow">PRIVATE WORKSPACE</div><h2>进入你的空间</h2><p>这个工作空间已启用访问保护。<br>请输入空间管理员提供的访问密码。</p><label for="access-password" class="subtle">访问密码</label><input id="access-password" type="password" autocomplete="current-password" required maxlength="1000"><div class="login-error" role="alert"></div><button class="button button-dark" type="submit">解锁工作空间 →</button></form>`;
 document.body.append(overlay);overlay.querySelector('input').focus();overlay.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const button=overlay.querySelector('button');button.disabled=true;try{await api('/api/login',{method:'POST',body:JSON.stringify({password:overlay.querySelector('input').value})});overlay.remove();resolve();}catch(error){overlay.querySelector('.login-error').textContent=error.message;}finally{button.disabled=false;}});});
}
export function initCommon() {
 initIcons();document.querySelectorAll('.mobile-menu').forEach(button=>button.addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open')));
 document.querySelector('.main')?.addEventListener('click',event=>{if(!event.target.closest('.mobile-menu'))document.querySelector('.sidebar').classList.remove('open');});
 const today=document.querySelector('#today-label');if(today)today.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',weekday:'long'}).format(new Date());
}
