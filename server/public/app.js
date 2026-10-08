'use strict';
/* AuraStream single-page app — talks to the live backend REST + WebSocket API. */

/* ---------------- API helper ---------------- */
const API = { token: localStorage.getItem('as_token') || '' };
function setToken(t){ API.token = t || ''; if(t) localStorage.setItem('as_token',t); else localStorage.removeItem('as_token'); }

async function api(path, opts){
  opts = opts || {};
  const headers = {};
  if (API.token) headers.Authorization = 'Bearer ' + API.token;
  let body = opts.body;
  if (body instanceof FormData) { /* browser sets content-type */ }
  else if (body !== undefined) { headers['Content-Type']='application/json'; body = JSON.stringify(body); }
  const res = await fetch(path, { method: opts.method||'GET', headers, body, credentials:'same-origin' });
  const ct = res.headers.get('content-type')||'';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || ('Request failed ('+res.status+')'));
  return data;
}

/* ---------------- UI utilities ---------------- */
const $ = (s,r)=> (r||document).querySelector(s);
const $$ = (s,r)=> Array.from((r||document).querySelectorAll(s));
function esc(s){ return String(s==null?'':s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg, kind){
  const el = document.createElement('div');
  const col = kind==='error' ? 'bg-rose-600' : kind==='warn' ? 'bg-amber-600' : 'bg-[#2a2a44] border border-aura-line';
  el.className = 'pointer-events-auto px-4 py-2.5 rounded-xl text-sm text-white shadow-xl fade-in '+col;
  el.innerHTML = esc(msg);
  $('#toast').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='.4s'; setTimeout(()=>el.remove(),400); }, 3200);
}
function openModal(html){ $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal(){ $('#modal').classList.add('hidden'); $('#modal-box').innerHTML=''; teardownLive(); }
$('#modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });

/* ---------------- App state ---------------- */
let ME = null;
const ADMIN_ROLES = ['Super Admin','Content Admin','Moderation Admin','Finance Admin','Support Admin'];
const isAdmin = ()=> ME && ADMIN_ROLES.includes(ME.role);

/* ---------------- Auth screen ---------------- */
function showAuthTab(which){
  const login = which==='login';
  $('#tab-login').classList.toggle('tab-active', login);
  $('#tab-login').classList.toggle('text-slate-400', !login);
  $('#tab-register').classList.toggle('tab-active', !login);
  $('#tab-register').classList.toggle('text-slate-400', login);
  $('#form-login').classList.toggle('hidden', !login);
  $('#form-register').classList.toggle('hidden', login);
  $('#auth-msg').textContent='';
}
$('#tab-login').onclick = ()=>showAuthTab('login');
$('#tab-register').onclick = ()=>showAuthTab('register');

function authMsg(t, ok){ const el=$('#auth-msg'); el.textContent=t; el.className='text-sm mt-3 text-center min-h-[1.25rem] '+(ok?'text-emerald-400':'text-rose-400'); }

$('#form-login').addEventListener('submit', async e=>{
  e.preventDefault();
  const f = e.target; const btn = f.querySelector('button');
  btn.disabled=true; authMsg('Signing in\u2026', true);
  try {
    const r = await api('/api/auth/login', { method:'POST', body:{ email:f.email.value.trim(), password:f.password.value } });
    setToken(r.token); ME = r.user; enterApp();
  } catch(err){ authMsg(err.message); } finally { btn.disabled=false; }
});

$('#form-register').addEventListener('submit', async e=>{
  e.preventDefault();
  const f = e.target; const btn = f.querySelector('button');
  btn.disabled=true; authMsg('Creating your account\u2026', true);
  try {
    const r = await api('/api/auth/register', { method:'POST', body:{
      name:f.name.value.trim(), email:f.email.value.trim(), password:f.password.value,
      country:f.country.value.trim(), currency:f.currency.value.trim() } });
    setToken(r.token); ME = r.user; enterApp();
    toast('Welcome to AuraStream, '+ME.name.split(' ')[0]+'!');
  } catch(err){ authMsg(err.message); } finally { btn.disabled=false; }
});

/* ---------------- Enter / leave app ---------------- */
function enterApp(){
  $('#auth-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#nav-avatar').src = ME.avatar || 'https://api.dicebear.com/7.x/initials/svg?seed='+encodeURIComponent(ME.name);
  $('#pm-name').textContent = ME.name;
  $('#pm-plan').textContent = (ME.subscription && ME.subscription.name) || 'Free Tier';
  buildNav();
  go('home');
}
async function logout(){
  try { await api('/api/auth/logout',{method:'POST'}); } catch(_){}
  setToken(''); ME=null;
  $('#app').classList.add('hidden');
  $('#auth-screen').classList.remove('hidden');
  showAuthTab('login');
}
$('#logout-btn').onclick = logout;
$('#profile-btn').onclick = ()=> $('#profile-menu').classList.toggle('hidden');
document.addEventListener('click', e=>{ if(!e.target.closest('#profile-btn') && !e.target.closest('#profile-menu')) $('#profile-menu').classList.add('hidden'); });
$('#profile-menu').addEventListener('click', e=>{ const b=e.target.closest('[data-go]'); if(b){ $('#profile-menu').classList.add('hidden'); go(b.dataset.go); } });

/* ---------------- Navigation ---------------- */
const NAV = [
  { id:'home',   label:'Home',           icon:'fa-house' },
  { id:'live',   label:'Live TV',        icon:'fa-tower-broadcast' },
  { id:'studio', label:'Creator Studio', icon:'fa-video' },
  { id:'plans',  label:'Plans',          icon:'fa-crown' }
];
function buildNav(){
  const items = NAV.slice();
  if (isAdmin()) items.push({ id:'admin', label:'Admin', icon:'fa-shield-halved' });
  $('#nav').innerHTML = items.map(n=>
    `<button data-go="${n.id}" class="nav-item whitespace-nowrap px-3 py-2 rounded-lg font-semibold text-sm text-slate-400 btn"><i class="fa-solid ${n.icon} mr-1.5"></i>${n.label}</button>`
  ).join('');
  $$('#nav .nav-item').forEach(b=> b.onclick = ()=> go(b.dataset.go));
}
function setActiveNav(id){
  $$('#nav .nav-item').forEach(b=>{
    const on = b.dataset.go===id;
    b.classList.toggle('tab-active', on);
    b.classList.toggle('text-slate-400', !on);
  });
}
let CURRENT='home';
async function go(section){
  CURRENT = section; setActiveNav(section);
  const v = $('#view'); v.innerHTML = loadingHtml();
  try {
    if (section==='home')   await renderHome(v);
    else if (section==='live')   await renderLive(v);
    else if (section==='studio') await renderStudio(v);
    else if (section==='plans')  await renderPlans(v);
    else if (section==='profile')await renderProfile(v);
    else if (section==='admin')  await renderAdmin(v);
  } catch(err){ v.innerHTML = `<div class="panel rounded-xl p-6 text-rose-400">${esc(err.message)}</div>`; }
}
function loadingHtml(){ return '<div class="flex justify-center py-20"><i class="fa-solid fa-circle-notch fa-spin text-3xl text-aura-primary"></i></div>'; }

/* ---------------- Content card ---------------- */
function contentCard(c){
  const badge = c.isPremium ? '<span class="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500 text-black">PREMIUM</span>' : '';
  return `<button class="content-card group text-left card-hover panel rounded-xl overflow-hidden" data-id="${c.id}">
    <div class="relative aspect-video bg-black">
      <img src="${esc(c.poster)}" class="w-full h-full object-cover group-hover:opacity-80" loading="lazy" alt="">
      ${badge}
      <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
        <span class="w-12 h-12 rounded-full grad flex items-center justify-center text-white text-lg"><i class="fa-solid fa-play"></i></span>
      </div>
    </div>
    <div class="p-3">
      <p class="font-semibold text-sm truncate">${esc(c.title)}</p>
      <p class="text-xs text-slate-400 truncate">${esc(c.genre||c.type)} · ${c.year||''}</p>
      <p class="text-[11px] text-slate-500 mt-1"><i class="fa-regular fa-eye"></i> ${(c.views||0).toLocaleString()}</p>
    </div>
  </button>`;
}
function wireCards(root, list){
  $$('.content-card', root).forEach(b=> b.onclick=()=>{ const c=list.find(x=>x.id===b.dataset.id); if(c) openPlayer(c); });
}

/* ---------------- Home ---------------- */
async function renderHome(v){
  const [{contents}, {channels}] = await Promise.all([ api('/api/content'), api('/api/channels') ]);
  const live = channels.filter(c=>c.isLive);
  const featured = contents.find(c=>c.isFeatured) || contents[0];
  let html = '';
  if (featured){
    html += `<section class="relative rounded-2xl overflow-hidden mb-8 panel">
      <img src="${esc(featured.poster)}" class="absolute inset-0 w-full h-full object-cover opacity-40" alt="">
      <div class="relative p-6 sm:p-10 max-w-2xl">
        <span class="text-xs font-bold grad-text">FEATURED</span>
        <h2 class="text-3xl sm:text-4xl font-extrabold mt-1">${esc(featured.title)}</h2>
        <p class="text-slate-300 mt-2 line-clamp-3">${esc(featured.description||'')}</p>
        <button id="hero-play" class="mt-5 grad text-white font-bold px-6 py-3 rounded-lg btn"><i class="fa-solid fa-play mr-2"></i>Play now</button>
      </div>
    </section>`;
  }
  if (live.length){
    html += `<section class="mb-8"><h3 class="text-xl font-bold mb-3 flex items-center gap-2"><span class="live-dot"></span>Live right now</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${live.map(liveCard).join('')}</div></section>`;
  }
  html += `<section><h3 class="text-xl font-bold mb-3">Browse the library</h3>`;
  html += contents.length
    ? `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">${contents.map(contentCard).join('')}</div>`
    : `<div class="panel rounded-xl p-8 text-center text-slate-400">No published content yet. Upload the first video in <button class="text-aura-primary font-semibold" onclick="go('studio')">Creator Studio</button>.</div>`;
  html += `</section>`;
  v.innerHTML = `<div class="fade-in">${html}</div>`;
  wireCards(v, contents);
  $$('.live-card',v).forEach(b=> b.onclick=()=>{ const c=live.find(x=>x.id===b.dataset.id); openLiveViewer(c); });
  if (featured) $('#hero-play').onclick=()=>openPlayer(featured);
}

function liveCard(c){
  return `<button class="live-card text-left card-hover panel rounded-xl overflow-hidden" data-id="${c.id}">
    <div class="relative aspect-video bg-gradient-to-br from-[#1b1b30] to-[#0f0f1c] flex items-center justify-center text-5xl">
      <span>${esc(c.logo||'\uD83D\uDCFA')}</span>
      <span class="absolute top-2 left-2 flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded bg-rose-600 text-white"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>LIVE</span>
      <span class="absolute bottom-2 right-2 text-[11px] px-2 py-0.5 rounded bg-black/60"><i class="fa-solid fa-eye"></i> ${esc(c.viewers||'0 watching')}</span>
    </div>
    <div class="p-3"><p class="font-semibold text-sm truncate">${esc(c.name)}</p>
      <p class="text-xs text-slate-400 truncate">${esc(c.current||c.category)}</p></div>
  </button>`;
}

/* ---------------- Live TV ---------------- */
async function renderLive(v){
  const { channels } = await api('/api/channels');
  const live = channels.filter(c=>c.isLive);
  const off = channels.filter(c=>!c.isLive);
  v.innerHTML = `<div class="fade-in">
    <h2 class="text-2xl font-extrabold mb-1">Live TV</h2>
    <p class="text-slate-400 mb-5">Tune into channels broadcasting right now, or start your own in Creator Studio.</p>
    ${live.length ? `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">${live.map(liveCard).join('')}</div>`
      : `<div class="panel rounded-xl p-8 text-center text-slate-400 mb-8">No channels are live right now. <button class="text-aura-primary font-semibold" onclick="go('studio')">Go live yourself →</button></div>`}
    <h3 class="text-lg font-bold mb-3 text-slate-300">All channels</h3>
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      ${off.map(c=>`<div class="panel rounded-xl overflow-hidden opacity-80">
        <div class="aspect-video flex items-center justify-center text-4xl bg-[#0f0f1c]">${esc(c.logo||'\uD83D\uDCFA')}</div>
        <div class="p-3"><p class="font-semibold text-sm truncate">${esc(c.name)}</p>
          <p class="text-xs text-slate-500">Offline · ${esc(c.category)}</p></div>
      </div>`).join('')}
    </div></div>`;
  $$('.live-card',v).forEach(b=> b.onclick=()=>{ const c=live.find(x=>x.id===b.dataset.id); openLiveViewer(c); });
}

/* ---------------- On-demand player ---------------- */
function openPlayer(c){
  openModal(`<div class="relative">
    <button onclick="closeModal()" class="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 text-white btn"><i class="fa-solid fa-xmark"></i></button>
    <div class="aspect-video bg-black">
      <video id="player" class="w-full h-full" controls autoplay playsinline src="${esc(c.videoUrl||'')}"></video>
    </div>
    <div class="p-5">
      <h3 class="text-xl font-bold">${esc(c.title)}</h3>
      <p class="text-xs text-slate-400 mt-0.5">${esc(c.genre||c.type)} · ${c.year||''} · ${esc(c.rating||'')}</p>
      <p class="text-slate-300 mt-3 text-sm">${esc(c.description||'No description.')}</p>
      ${c.cast&&c.cast.length?`<p class="text-xs text-slate-500 mt-3">Cast: ${esc(c.cast.join(', '))}</p>`:''}
    </div></div>`);
  const p = $('#player');
  if (p) p.onerror = ()=> toast('This video source could not be played.', 'error');
}

/* ---------------- Live viewer (Media Source Extensions) ---------------- */
let LIVE = null; // { ws, ms, sb, queue, video, url }
function teardownLive(){
  if (!LIVE) return;
  try { if (LIVE.ws) LIVE.ws.close(); } catch(_){}
  try { if (LIVE.recorder && LIVE.recorder.state!=='inactive') LIVE.recorder.stop(); } catch(_){}
  try { if (LIVE.stream) LIVE.stream.getTracks().forEach(t=>t.stop()); } catch(_){}
  try { if (LIVE.url) URL.revokeObjectURL(LIVE.url); } catch(_){}
  LIVE = null;
}

function openLiveViewer(ch){
  openModal(`<div class="relative">
    <button onclick="closeModal()" class="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 text-white btn"><i class="fa-solid fa-xmark"></i></button>
    <div class="aspect-video bg-black relative">
      <video id="live-video" class="w-full h-full" autoplay playsinline muted controls></video>
      <div id="live-overlay" class="absolute inset-0 flex flex-col items-center justify-center text-center gap-2 bg-black/60">
        <i class="fa-solid fa-circle-notch fa-spin text-2xl text-aura-primary"></i>
        <p class="text-sm text-slate-300">Connecting to live stream\u2026</p>
      </div>
      <span class="absolute top-3 left-3 flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded bg-rose-600 text-white"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>LIVE</span>
      <span id="live-count" class="absolute bottom-3 right-3 text-[11px] px-2 py-0.5 rounded bg-black/60"></span>
    </div>
    <div class="p-5"><h3 class="text-xl font-bold">${esc(ch.name)}</h3>
      <p class="text-xs text-slate-400">${esc(ch.current||ch.category)}</p>
      <p class="text-xs text-slate-500 mt-2">Tip: unmute with the player controls. A few seconds of delay is normal for live.</p></div>
  </div>`);
  startViewer(ch.id);
}

function wsUrl(path){ const p = location.protocol==='https:'?'wss':'ws'; return `${p}://${location.host}${path}`; }

function startViewer(channelId){
  const video = $('#live-video');
  const overlay = $('#live-overlay');
  const ws = new WebSocket(wsUrl('/ws/live?role=view&channel='+encodeURIComponent(channelId)));
  ws.binaryType = 'arraybuffer';
  LIVE = { ws, video, ms:null, sb:null, queue:[], url:null };

  function pump(){
    const L = LIVE; if (!L || !L.sb || L.sb.updating || !L.queue.length) return;
    try { L.sb.appendBuffer(L.queue.shift()); } catch(e){ /* buffer full / invalid */ }
  }
  ws.onmessage = (ev)=>{
    if (typeof ev.data === 'string'){
      let m; try { m = JSON.parse(ev.data); } catch(_){ return; }
      if (m.t==='offline'){ overlay.innerHTML='<p class="text-slate-300 text-sm">This channel is not broadcasting right now.</p>'; }
      else if (m.t==='ended'){ overlay.classList.remove('hidden'); overlay.innerHTML='<p class="text-slate-300 text-sm">The broadcast has ended.</p>'; }
      else if (m.t==='viewers'){ const el=$('#live-count'); if(el) el.innerHTML='<i class="fa-solid fa-eye"></i> '+m.count; }
      else if (m.t==='start'){ initMediaSource(m.mime); }
      return;
    }
    // binary chunk
    if (!LIVE.ms){ return; }
    LIVE.queue.push(new Uint8Array(ev.data));
    pump();
  };
  ws.onerror = ()=>{ if(overlay) overlay.innerHTML='<p class="text-rose-400 text-sm">Connection error.</p>'; };
  ws.onclose = ()=>{};

  function initMediaSource(mime){
    if (LIVE.ms) return;
    if (!('MediaSource' in window) || !MediaSource.isTypeSupported(mime)){
      overlay.innerHTML='<p class="text-rose-400 text-sm">Your browser cannot play this live format.</p>'; return;
    }
    const ms = new MediaSource();
    LIVE.ms = ms;
    LIVE.url = URL.createObjectURL(ms);
    video.src = LIVE.url;
    ms.addEventListener('sourceopen', ()=>{
      try {
        const sb = ms.addSourceBuffer(mime);
        sb.mode = 'sequence';
        LIVE.sb = sb;
        sb.addEventListener('updateend', ()=>{ overlay.classList.add('hidden'); pump(); keepLatest(); });
        pump();
      } catch(e){ overlay.innerHTML='<p class="text-rose-400 text-sm">Playback init failed.</p>'; }
    });
  }
  function keepLatest(){
    // Keep live latency low by trimming old buffered data.
    try {
      const sb = LIVE.sb; if (!sb || sb.updating) return;
      const buf = sb.buffered; if (!buf.length) return;
      const end = buf.end(buf.length-1);
      if (video.currentTime < end - 6) video.currentTime = end - 0.5;
    } catch(_){}
  }
}

/* ---------------- Creator Studio ---------------- */
async function renderStudio(v){
  if (!ME.isCreator){
    v.innerHTML = `<div class="fade-in max-w-xl mx-auto panel rounded-2xl p-8 text-center">
      <div class="text-5xl mb-3">\uD83C\uDFA5</div>
      <h2 class="text-2xl font-extrabold">Become a creator</h2>
      <p class="text-slate-400 mt-2">Unlock uploading videos and going live from your own channels. It's free and instant.</p>
      <button id="apply-creator" class="mt-5 grad text-white font-bold px-6 py-3 rounded-lg btn">Enable Creator Studio</button>
    </div>`;
    $('#apply-creator').onclick = async ()=>{
      try { const r = await api('/api/auth/apply-creator',{method:'POST'}); ME = r.user; toast('Creator Studio enabled!'); go('studio'); }
      catch(err){ toast(err.message,'error'); }
    };
    return;
  }
  const [{channels}, {contents}] = await Promise.all([ api('/api/channels/mine'), api('/api/content/mine/list') ]);
  v.innerHTML = `<div class="fade-in space-y-8">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div><h2 class="text-2xl font-extrabold">Creator Studio</h2>
      <p class="text-slate-400">Create channels, go live from your camera, and upload videos.</p></div>
    </div>

    <section>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold">My channels</h3>
        <button id="new-channel" class="text-sm font-semibold text-aura-primary btn"><i class="fa-solid fa-plus mr-1"></i>New channel</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${channels.length ? channels.map(channelAdminCard).join('') : `<div class="panel rounded-xl p-6 text-slate-400">You have no channels yet. Create one to start broadcasting.</div>`}
      </div>
    </section>

    <section>
      <h3 class="text-lg font-bold mb-3">Upload a video</h3>
      <form id="upload-form" class="panel rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="md:col-span-2"><label class="text-xs text-slate-400">Video file (mp4, webm, mov …)</label>
          <input name="video" type="file" accept="video/*" required class="w-full mt-1 text-sm file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:grad file:text-white bg-[#0f0f1c] border border-aura-line rounded-lg p-2"></div>
        <div><label class="text-xs text-slate-400">Title</label><input name="title" required class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary"></div>
        <div><label class="text-xs text-slate-400">Genre</label><input name="genre" placeholder="Drama" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary"></div>
        <div><label class="text-xs text-slate-400">Type</label>
          <select name="type" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"><option value="movie">Movie</option><option value="series">Series</option><option value="documentary">Documentary</option><option value="sports">Sports</option></select></div>
        <div><label class="text-xs text-slate-400">Poster image URL (optional)</label><input name="poster" placeholder="https://…" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary"></div>
        <div class="md:col-span-2"><label class="text-xs text-slate-400">Description</label><textarea name="description" rows="2" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary"></textarea></div>
        <div class="md:col-span-2">
          <div id="upload-progress" class="hidden h-2 bg-[#0f0f1c] rounded-full overflow-hidden mb-3"><div id="upload-bar" class="h-full grad" style="width:0%"></div></div>
          <button class="grad text-white font-bold px-6 py-3 rounded-lg btn"><i class="fa-solid fa-cloud-arrow-up mr-2"></i>Upload for review</button>
          <span class="text-xs text-slate-500 ml-3">Uploads are published after a quick moderation check.</span>
        </div>
      </form>
    </section>

    <section>
      <h3 class="text-lg font-bold mb-3">My uploads</h3>
      <div class="space-y-2">
        ${contents.length ? contents.map(uploadRow).join('') : `<div class="panel rounded-xl p-6 text-slate-400">Nothing uploaded yet.</div>`}
      </div>
    </section>
  </div>`;

  $('#new-channel').onclick = openChannelForm;
  $$('.go-live-btn',v).forEach(b=> b.onclick=()=> openGoLive(channels.find(c=>c.id===b.dataset.id)) );
  $$('.del-channel',v).forEach(b=> b.onclick=async ()=>{ if(!confirm('Delete this channel?'))return; try{ await api('/api/channels/'+b.dataset.id,{method:'DELETE'}); toast('Channel deleted'); go('studio'); }catch(e){ toast(e.message,'error'); } });
  wireUpload();
}

function channelAdminCard(c){
  return `<div class="panel rounded-xl p-4">
    <div class="flex items-start gap-3">
      <div class="text-3xl">${esc(c.logo||'\uD83D\uDCFA')}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2"><p class="font-bold truncate">${esc(c.name)}</p>
          ${c.isLive?'<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-600 text-white">LIVE</span>':''}</div>
        <p class="text-xs text-slate-400">${esc(c.category)} · ${esc(c.viewers||'0 watching')}</p>
      </div>
    </div>
    <div class="flex gap-2 mt-3">
      <button class="go-live-btn flex-1 grad text-white font-semibold py-2 rounded-lg text-sm btn" data-id="${c.id}"><i class="fa-solid fa-tower-broadcast mr-1"></i>${c.isLive?'Manage live':'Go live'}</button>
      <button class="del-channel w-10 bg-[#2a1620] text-rose-400 rounded-lg btn" data-id="${c.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
    <details class="mt-3"><summary class="text-xs text-slate-500 cursor-pointer">Advanced: OBS / RTMP ingest</summary>
      <div class="mt-2 text-[11px] text-slate-400 space-y-1 break-all">
        <p>Server: <code class="text-aura-cyan">${esc(c.rtmpUrl||'rtmp://localhost:1935/live')}</code></p>
        <p>Stream key: <code class="text-aura-cyan">${esc(c.streamKey||'')}</code></p>
        <p class="text-slate-500">Use these only if you prefer OBS. The in-browser “Go live” button needs no setup.</p>
      </div></details>
  </div>`;
}
function uploadRow(c){
  const col = c.status==='Approved'?'text-emerald-400':c.status==='Pending'?'text-amber-400':'text-rose-400';
  return `<div class="panel rounded-xl p-3 flex items-center gap-3">
    <img src="${esc(c.poster)}" class="w-20 h-12 object-cover rounded" alt="">
    <div class="flex-1 min-w-0"><p class="font-semibold text-sm truncate">${esc(c.title)}</p>
      <p class="text-xs text-slate-500">${esc(c.genre||c.type)} · <span class="${col} font-semibold">${esc(c.status)}</span></p></div>
    ${c.status==='Approved'?`<button class="text-aura-primary text-sm btn" onclick='PLAY(${JSON.stringify(c.id)})'>Preview</button>`:''}
  </div>`;
}
window.PLAY = async (id)=>{ try{ const {content}=await api('/api/content/'+id); openPlayer(content);}catch(e){toast(e.message,'error');} };
window.go = go; window.closeModal = closeModal;

/* ---------------- Create channel ---------------- */
function openChannelForm(){
  openModal(`<div class="p-6">
    <div class="flex items-center justify-between mb-4"><h3 class="text-xl font-bold">New channel</h3>
      <button onclick="closeModal()" class="w-9 h-9 rounded-full bg-black/40 btn"><i class="fa-solid fa-xmark"></i></button></div>
    <form id="channel-form" class="space-y-3">
      <div><label class="text-xs text-slate-400">Channel name</label><input name="name" required class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="text-xs text-slate-400">Emoji / logo</label><input name="logo" value="\uD83D\uDCFA" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
        <div><label class="text-xs text-slate-400">Category</label>
          <select name="category" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"><option>Entertainment</option><option>Sports</option><option>Movies</option><option>Music</option><option>Gaming</option><option>News</option><option>Education</option></select></div>
      </div>
      <div><label class="text-xs text-slate-400">Description</label><textarea name="description" rows="2" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></textarea></div>
      <button class="w-full grad text-white font-bold py-3 rounded-lg btn">Create channel</button>
    </form></div>`);
  $('#channel-form').addEventListener('submit', async e=>{
    e.preventDefault(); const f=e.target; const btn=f.querySelector('button'); btn.disabled=true;
    try { await api('/api/channels',{method:'POST', body:{ name:f.name.value.trim(), logo:f.logo.value, category:f.category.value, description:f.description.value }});
      closeModal(); toast('Channel created!'); go('studio'); }
    catch(err){ toast(err.message,'error'); btn.disabled=false; }
  });
}

/* ---------------- Upload (with progress) ---------------- */
function wireUpload(){
  const form = $('#upload-form'); if(!form) return;
  form.addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(form);
    if (!fd.get('video') || !fd.get('video').size){ toast('Choose a video file first','warn'); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST','/api/content/upload');
    if (API.token) xhr.setRequestHeader('Authorization','Bearer '+API.token);
    const bar=$('#upload-bar'), wrap=$('#upload-progress'); wrap.classList.remove('hidden');
    const btn=form.querySelector('button'); btn.disabled=true;
    xhr.upload.onprogress = (ev)=>{ if(ev.lengthComputable){ bar.style.width=Math.round(ev.loaded/ev.total*100)+'%'; } };
    xhr.onload = ()=>{
      btn.disabled=false;
      let data={}; try{ data=JSON.parse(xhr.responseText);}catch(_){}
      if (xhr.status>=200 && xhr.status<300){ toast('Upload complete — pending moderation.'); go('studio'); }
      else { toast(data.error||('Upload failed ('+xhr.status+')'),'error'); wrap.classList.add('hidden'); }
    };
    xhr.onerror = ()=>{ btn.disabled=false; toast('Network error during upload','error'); };
    xhr.send(fd);
  });
}

/* ---------------- Go Live (camera broadcaster) ---------------- */
function pickMime(){
  const cands = ['video/webm;codecs="vp8,opus"','video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'];
  for (const m of cands){ if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return '';
}
async function openGoLive(ch){
  openModal(`<div class="relative">
    <button onclick="closeModal()" class="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 text-white btn"><i class="fa-solid fa-xmark"></i></button>
    <div class="aspect-video bg-black relative">
      <video id="gl-preview" class="w-full h-full" autoplay playsinline muted></video>
      <span id="gl-badge" class="hidden absolute top-3 left-3 items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded bg-rose-600 text-white"><span class="w-1.5 h-1.5 rounded-full bg-white"></span>LIVE</span>
      <span id="gl-count" class="absolute bottom-3 right-3 text-[11px] px-2 py-0.5 rounded bg-black/60"></span>
    </div>
    <div class="p-5">
      <h3 class="text-xl font-bold">Go live — ${esc(ch.name)}</h3>
      <input id="gl-title" placeholder="What are you streaming? (optional)" class="w-full mt-3 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5 outline-none focus:border-aura-primary">
      <div class="flex gap-2 mt-4">
        <button id="gl-start" class="flex-1 grad text-white font-bold py-3 rounded-lg btn"><i class="fa-solid fa-tower-broadcast mr-2"></i>Start broadcast</button>
        <button id="gl-stop" class="hidden flex-1 bg-rose-600 text-white font-bold py-3 rounded-lg btn"><i class="fa-solid fa-stop mr-2"></i>End broadcast</button>
      </div>
      <p id="gl-status" class="text-xs text-slate-400 mt-3">Grant camera & microphone access, then start. Viewers will see you on the Live TV page.</p>
    </div></div>`);

  const mime = pickMime();
  if (!mime){ $('#gl-status').innerHTML='<span class="text-rose-400">This browser cannot record live video. Try Chrome, Edge or the AuraStream app.</span>'; return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video:{ width:{ideal:1280}, height:{ideal:720} }, audio:true }); }
  catch(e){ $('#gl-status').innerHTML='<span class="text-rose-400">Camera/microphone permission denied.</span>'; return; }
  const preview = $('#gl-preview'); preview.srcObject = stream;
  LIVE = { stream, ws:null, recorder:null };

  $('#gl-start').onclick = ()=>{
    const title = $('#gl-title').value.trim();
    const ws = new WebSocket(wsUrl('/ws/live?role=broadcast&channel='+encodeURIComponent(ch.id)+'&token='+encodeURIComponent(API.token)));
    ws.binaryType='arraybuffer'; LIVE.ws = ws;
    ws.onmessage = (ev)=>{
      if (typeof ev.data!=='string') return;
      let m; try{ m=JSON.parse(ev.data);}catch(_){return;}
      if (m.t==='error'){ toast(m.message,'error'); try{ws.close();}catch(_){} }
      else if (m.t==='viewers'){ const el=$('#gl-count'); if(el) el.innerHTML='<i class="fa-solid fa-eye"></i> '+m.count; }
      else if (m.t==='ready'){
        ws.send(JSON.stringify({ t:'start', mime, title }));
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
        LIVE.recorder = rec;
        rec.ondataavailable = async (e)=>{ if (e.data && e.data.size && ws.readyState===1){ ws.send(await e.data.arrayBuffer()); } };
        rec.start(1000); // 1s chunks
        $('#gl-start').classList.add('hidden'); $('#gl-stop').classList.remove('hidden');
        $('#gl-badge').classList.remove('hidden'); $('#gl-badge').classList.add('flex');
        $('#gl-status').innerHTML='<span class="text-emerald-400">You are live! Share your Live TV page with viewers.</span>';
      }
    };
    ws.onerror = ()=> toast('Live connection error','error');
  };
  $('#gl-stop').onclick = ()=>{ teardownLive(); closeModal(); toast('Broadcast ended'); go('studio'); };
}

/* ---------------- Plans + Paystack ---------------- */
async function renderPlans(v){
  const [{plans}, cfg] = await Promise.all([ api('/api/payments/plans'), api('/api/payments/config') ]);
  const cur = ME.subscription && ME.subscription.planId;
  v.innerHTML = `<div class="fade-in">
    <h2 class="text-2xl font-extrabold">Choose your plan</h2>
    <p class="text-slate-400 mb-6">Secure payments by Paystack. ${cfg.enabled?'':'<span class="text-amber-400">(Live payments not configured yet — the Free Tier still activates instantly.)</span>'}</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${plans.map(p=>{
        const active = p.id===cur;
        return `<div class="panel rounded-2xl p-5 flex flex-col ${active?'ring-2 ring-aura-primary':''}">
          <div class="flex items-center justify-between"><h3 class="text-lg font-bold">${esc(p.name)}</h3>${active?'<span class="text-[10px] font-bold px-2 py-0.5 rounded grad text-white">CURRENT</span>':''}</div>
          <p class="mt-2"><span class="text-3xl font-extrabold">${p.price?('₦'+p.price.toLocaleString()):'Free'}</span><span class="text-slate-400 text-sm"> / ${esc(p.duration)}</span></p>
          <ul class="mt-4 space-y-1.5 text-sm text-slate-300 flex-1">${(p.benefits||'').split(',').map(b=>`<li><i class="fa-solid fa-check text-emerald-400 mr-2"></i>${esc(b.trim())}</li>`).join('')}</ul>
          <button class="plan-btn mt-5 ${active?'bg-[#20203a] text-slate-400':'grad text-white'} font-bold py-2.5 rounded-lg btn" data-id="${p.id}" data-price="${p.price}" ${active?'disabled':''}>${active?'Active':(p.price?'Subscribe':'Switch to Free')}</button>
        </div>`;
      }).join('')}
    </div>
    <div class="mt-6"><label class="text-xs text-slate-400">Have a promo code?</label>
      <input id="promo" placeholder="e.g. WELCOME20" class="mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2 outline-none focus:border-aura-primary"></div>
  </div>`;
  $$('.plan-btn',v).forEach(b=> b.onclick=()=> subscribe(b.dataset.id, Number(b.dataset.price), cfg.publicKey));
}

async function subscribe(planId, price, publicKey){
  const promo = ($('#promo')&&$('#promo').value.trim())||'';
  try {
    const init = await api('/api/payments/initialize',{method:'POST', body:{ planId, promo }});
    if (init.free){ await refreshMe(); toast('Plan updated!'); go('plans'); return; }
    if (!window.PaystackPop){ toast('Payment library not loaded','error'); return; }
    const handler = window.PaystackPop.setup({
      key: init.publicKey || publicKey,
      email: init.email,
      amount: init.amount,
      currency: 'NGN',
      ref: init.reference,
      callback: function(resp){ verifyPayment(resp.reference); },
      onClose: function(){ toast('Payment window closed','warn'); }
    });
    handler.openIframe();
  } catch(err){ toast(err.message,'error'); }
}
async function verifyPayment(reference){
  try { const r = await api('/api/payments/verify',{method:'POST', body:{ reference }}); await refreshMe(); toast('Payment confirmed — '+r.plan+' active!'); go('plans'); }
  catch(err){ toast('Verification failed: '+err.message,'error'); }
}
async function refreshMe(){ try { const r = await api('/api/auth/me'); ME = r.user; $('#pm-plan').textContent=(ME.subscription&&ME.subscription.name)||'Free Tier'; } catch(_){} }

/* ---------------- Profile ---------------- */
async function renderProfile(v){
  let invoices = [];
  try { invoices = (await api('/api/payments/invoices')).invoices; } catch(_){}
  v.innerHTML = `<div class="fade-in max-w-3xl mx-auto space-y-6">
    <div class="flex items-center gap-4">
      <img src="${esc(ME.avatar)}" class="w-20 h-20 rounded-full object-cover border border-aura-line" alt="">
      <div><h2 class="text-2xl font-extrabold">${esc(ME.name)}</h2>
        <p class="text-slate-400 text-sm">${esc(ME.email)} · ${esc(ME.role)}</p>
        <p class="text-xs mt-1"><span class="px-2 py-0.5 rounded grad text-white font-semibold">${esc(ME.subscription.name)}</span></p></div>
    </div>
    <form id="profile-form" class="panel rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      <h3 class="md:col-span-2 font-bold">Edit profile</h3>
      <div><label class="text-xs text-slate-400">Name</label><input name="name" value="${esc(ME.name)}" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <div><label class="text-xs text-slate-400">Phone</label><input name="phone" value="${esc(ME.phone||'')}" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <div><label class="text-xs text-slate-400">Country</label><input name="country" value="${esc(ME.country||'')}" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <div><label class="text-xs text-slate-400">Avatar URL</label><input name="avatar" value="${esc(ME.avatar||'')}" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs text-slate-400">Bio</label><textarea name="bio" rows="2" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5">${esc(ME.bio||'')}</textarea></div>
      <button class="grad text-white font-bold px-5 py-2.5 rounded-lg btn">Save changes</button>
    </form>
    <form id="pw-form" class="panel rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      <h3 class="md:col-span-2 font-bold">Change password</h3>
      <div><label class="text-xs text-slate-400">Current password</label><input name="current" type="password" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <div><label class="text-xs text-slate-400">New password</label><input name="next" type="password" minlength="8" class="w-full mt-1 bg-[#0f0f1c] border border-aura-line rounded-lg px-3 py-2.5"></div>
      <button class="bg-[#20203a] text-white font-bold px-5 py-2.5 rounded-lg btn">Update password</button>
    </form>
    <div class="panel rounded-xl p-5"><h3 class="font-bold mb-3">Billing history</h3>
      ${invoices.length ? `<div class="space-y-2">${invoices.map(i=>`<div class="flex justify-between text-sm border-b border-aura-line pb-2"><span>${esc(i.plan)} <span class="text-slate-500">· ${esc(i.date)}</span></span><span class="font-semibold">₦${(i.amount||0).toLocaleString()}</span></div>`).join('')}</div>` : '<p class="text-slate-500 text-sm">No invoices yet.</p>'}
    </div>
  </div>`;
  $('#profile-form').addEventListener('submit', async e=>{
    e.preventDefault(); const f=e.target;
    try { const r=await api('/api/auth/me',{method:'PATCH', body:{ name:f.name.value, phone:f.phone.value, country:f.country.value, avatar:f.avatar.value, bio:f.bio.value }});
      ME=r.user; $('#nav-avatar').src=ME.avatar; $('#pm-name').textContent=ME.name; toast('Profile saved'); }
    catch(err){ toast(err.message,'error'); }
  });
  $('#pw-form').addEventListener('submit', async e=>{
    e.preventDefault(); const f=e.target;
    try { await api('/api/auth/change-password',{method:'POST', body:{ current:f.current.value, next:f.next.value }}); f.reset(); toast('Password updated'); }
    catch(err){ toast(err.message,'error'); }
  });
}

/* ---------------- Admin ---------------- */
async function renderAdmin(v){
  const [stats, pend, users] = await Promise.all([ api('/api/admin/stats'), api('/api/content/admin/pending'), api('/api/admin/users') ]);
  const stat = (l,n,i)=>`<div class="panel rounded-xl p-4"><p class="text-xs text-slate-400"><i class="fa-solid ${i} mr-1"></i>${l}</p><p class="text-2xl font-extrabold mt-1">${n}</p></div>`;
  v.innerHTML = `<div class="fade-in space-y-8">
    <h2 class="text-2xl font-extrabold">Admin console</h2>
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      ${stat('Users',stats.users,'fa-users')}${stat('Creators',stats.creators,'fa-video')}${stat('Content',stats.contents,'fa-film')}
      ${stat('Pending',stats.pending,'fa-clock')}${stat('Channels',stats.channels,'fa-tower-broadcast')}${stat('Revenue','₦'+(stats.revenue||0).toLocaleString(),'fa-coins')}
    </div>
    <section><h3 class="text-lg font-bold mb-3">Moderation queue (${pend.contents.length})</h3>
      <div class="space-y-2">${pend.contents.length ? pend.contents.map(c=>`<div class="panel rounded-xl p-3 flex items-center gap-3">
        <img src="${esc(c.poster)}" class="w-24 h-14 object-cover rounded" alt="">
        <div class="flex-1 min-w-0"><p class="font-semibold truncate">${esc(c.title)}</p><p class="text-xs text-slate-500">${esc(c.genre||c.type)}</p></div>
        <button class="mod-approve bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-lg btn" data-id="${c.id}">Approve</button>
        <button class="mod-reject bg-rose-600 text-white text-sm px-3 py-1.5 rounded-lg btn" data-id="${c.id}">Reject</button>
      </div>`).join('') : '<p class="text-slate-500 text-sm">Nothing pending review.</p>'}</div>
    </section>
    <section><h3 class="text-lg font-bold mb-3">Users (${users.users.length})</h3>
      <div class="panel rounded-xl overflow-hidden overflow-x-auto"><table class="w-full text-sm">
        <thead class="text-left text-slate-400 border-b border-aura-line"><tr><th class="p-3">Name</th><th class="p-3">Email</th><th class="p-3">Role</th><th class="p-3">Status</th></tr></thead>
        <tbody>${users.users.map(u=>`<tr class="border-b border-aura-line/50"><td class="p-3">${esc(u.name)}</td><td class="p-3 text-slate-400">${esc(u.email)}</td><td class="p-3">${esc(u.role)}</td><td class="p-3">${esc(u.status)}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
  </div>`;
  $$('.mod-approve',v).forEach(b=> b.onclick=async ()=>{ try{ await api('/api/content/admin/'+b.dataset.id+'/approve',{method:'POST'}); toast('Approved'); go('admin'); }catch(e){ toast(e.message,'error'); } });
  $$('.mod-reject',v).forEach(b=> b.onclick=async ()=>{ if(!confirm('Reject & delete this upload?'))return; try{ await api('/api/content/admin/'+b.dataset.id+'/reject',{method:'POST'}); toast('Rejected'); go('admin'); }catch(e){ toast(e.message,'error'); } });
}

/* ---------------- Boot ---------------- */
(async function boot(){
  if (API.token){
    try { const r = await api('/api/auth/me'); ME = r.user; enterApp(); return; }
    catch(_){ setToken(''); }
  }
  showAuthTab('login');
})();
