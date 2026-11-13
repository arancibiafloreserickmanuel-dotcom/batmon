import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, today, monthStart, weekStart, paceStr, DISC } from './common.js';
import { renderRunning } from './running.js';
import { renderPlyo } from './plyo.js';
import { renderTraining } from './training.js';

const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const view = $('#view');
const TABS = [
  ['inicio', 'Inicio', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>'],
  ['running', 'Running', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="16.5" cy="4.5" r="2"/><path d="m13 8 3 2 2 4-4 2-2 5m4-11-4 3-4 1-3 4m8-8-3-3-4 1"/></svg>'],
  ['cycling', 'Ciclismo', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 4-8 4 8H6m4-8h4m-1-3h3"/></svg>'],
  ['swimming', 'Natación', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 3-2M3 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 3-2M12 4l-3 6h4l-2 4"/></svg>'],
  ['plyo', 'Pliometría', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/><circle cx="7" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="10" cy="19" r="1"/></svg>'],
  ['training', 'Entrenamiento', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7v10M4 9v6m14-8v10m2-8v6M6 12h12"/></svg>'],
  ['perfil', 'Perfil', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'],
];
let ctx = null;

function applyTheme(preference) {
  const allowed = ctx?.themePolicy || 'choice';
  const saved = preference || localStorage.getItem(`batmon_theme_${ctx?.user?.id}`) || 'light';
  const theme = allowed === 'choice' ? saved : allowed;
  document.body.dataset.theme = theme;
}

/* ---------------- Login / registro ---------------- */
function showLogin(signup = false) {
  ctx = null; $('#logout').hidden = true; $('#admin-link').hidden = true; $('#tabs').hidden = true;
  view.innerHTML = `
    <h1>Bienvenido<br>al Crowd</h1><p class="muted">${signup ? 'Crea tu cuenta de socio.' : 'Ingresa con tu correo.'}</p>
    <form id="lf" class="card" style="margin-top:20px">
      ${signup ? '<label for="nm">Nombre</label><input id="nm" type="text" autocomplete="name" required>' : ''}
      <label for="em">Correo</label><input id="em" type="email" autocomplete="email" required>
      <label for="pw">Contraseña</label><input id="pw" type="password" minlength="6" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
      <button class="btn" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button><p class="msg" id="lm"></p>
      ${!signup ? '<button class="link" type="button" id="forgot">Olvidé mi contraseña</button>' : ''}
      <button class="link" type="button" id="tg" style="margin-top:14px">${signup ? 'Ya tengo cuenta' : 'Crear cuenta'}</button>
    </form>`;
  $('#tg').onclick = () => showLogin(!signup);
  const forgot = $('#forgot');
  if (forgot) forgot.onclick = async () => {
    const email = $('#em').value.trim();
    if (!email) { $('#lm').textContent = 'Escribe tu correo para enviarte el enlace de recuperación.'; $('#em').focus(); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/app.html` });
    $('#lm').textContent = error ? 'No se pudo enviar el enlace: ' + error.message : 'Te enviamos un enlace para restablecer tu contraseña.';
  };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#em').value.trim(), password = $('#pw').value;
    const { error } = signup
      ? await supabase.auth.signUp({ email, password, options: { data: { full_name: $('#nm').value.trim() } } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) $('#lm').textContent = signup ? 'No se pudo crear: ' + error.message : 'Correo o contraseña incorrectos.';
  };
}

function showNewPassword() {
  view.innerHTML = `<h1>Nueva contraseña</h1><p class="muted">Elige una contraseña de al menos 6 caracteres.</p><form id="newpass" class="card"><label for="np">Contraseña nueva</label><input id="np" type="password" minlength="6" autocomplete="new-password" required><button class="btn" type="submit">Guardar contraseña</button><p class="msg" id="npm"></p></form>`;
  $('#newpass').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: $('#np').value });
    $('#npm').textContent = error ? 'No se pudo actualizar: ' + error.message : 'Contraseña actualizada. Ya puedes ingresar.';
    if (!error) setTimeout(() => showLogin(), 1200);
  };
}

/* ---------------- Shell con pestañas ---------------- */
async function boot(user) {
  const [{ data: profile }, { data: membership }, { data: moduleRows }, { data: globalRows }, { data: appearance }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('memberships').select('status').eq('user_id', user.id).eq('period', monthStart()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('profile_modules').select('module_key, enabled').eq('user_id', user.id),
    supabase.from('app_modules').select('module_key,enabled'),
    supabase.from('site_settings').select('theme_policy').eq('id',true).maybeSingle(),
  ]);
  const globals = Object.fromEntries(['running','cycling','swimming','plyo','training'].map(key => [key, true]));
  (globalRows || []).forEach(row => { globals[row.module_key] = row.enabled; });
  const members = Object.fromEntries((moduleRows || []).map(row => [row.module_key, row.enabled]));
  const modules = Object.fromEntries(Object.keys(globals).map(key => [key, globals[key] && members[key] !== false]));
  ctx = { user, profile, isAdmin: profile?.role === 'admin', canRegister: membership?.status === 'approved', modules, themePolicy: appearance?.theme_policy || 'choice' };
  applyTheme();
  $('#logout').hidden = false; $('#admin-link').hidden = !ctx.isAdmin; $('#tabs').hidden = false;
  renderTabs();
  route();
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.filter(([key]) => !['running', 'cycling', 'swimming', 'plyo', 'training'].includes(key) || ctx.modules[key])
    .map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}"><span class="tab-icon">${icon}</span><span>${t}</span></a>`).join('');
}

function route() {
  if (!ctx) return;
  const tab = (location.hash.slice(1) || 'inicio');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + tab));
  view.innerHTML = '<p class="muted center">Cargando…</p>';
  const moduleKey = { running: 'running', cycling: 'cycling', swimming: 'swimming', plyo: 'plyo', training: 'training' }[tab];
  if (moduleKey && !ctx.modules[moduleKey]) {
    view.innerHTML = `<h1>${TABS.find(([key]) => key === tab)?.[1]}</h1><div class="card warn">Este módulo está desactivado para tu cuenta. Consulta con el administrador del club.</div>`;
    return;
  }
  const fn = { inicio: renderHome, running: () => renderRunning(view, ctx, 'running'), cycling: () => renderRunning(view, ctx, 'cycling'), swimming: () => renderRunning(view, ctx, 'swimming'), plyo: renderPlyo, training: renderTraining, perfil: renderProfile }[tab] || renderHome;
  Promise.resolve(fn(view, ctx)).catch((e) => { view.innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
}

/* ---------------- Inicio ---------------- */
async function renderHome(v) {
  const [{ data: acts = [] }, { data: ws = [] }, { data: mems = [] }] = await Promise.all([
    supabase.from('activities').select('*').order('performed_on', { ascending: false }).limit(200),
    supabase.from('workouts').select('id, kind, performed_on, duration_min, workout_sets(id)').order('performed_on', { ascending: false }).limit(100),
    supabase.from('memberships').select('*').eq('period', monthStart()).order('created_at', { ascending: false }),
  ]);
  const ws0 = weekStart();
  const km = (d) => acts.filter((a) => a.discipline === d && a.performed_on >= ws0).reduce((s, a) => s + Number(a.distance_km), 0);
  const last = acts[0];
  const cur = mems[0];
  const plyoWeek = ws.filter((w) => w.kind === 'plyometrics' && w.performed_on >= ws0).length;
  const trainingWeek = ws.filter((w) => w.kind === 'training' && w.performed_on >= ws0).length;

  const seenKey = `batmon_membership_status_${ctx.user.id}`;
  const previousStatus = localStorage.getItem(seenKey);
  if (cur?.status) localStorage.setItem(seenKey, cur.status);
  const statusNotice = previousStatus && cur?.status && previousStatus !== cur.status && ['approved', 'rejected'].includes(cur.status)
    ? `<div class="card ${cur.status === 'approved' ? 'okbox' : 'warn'}">${cur.status === 'approved' ? '¡Tu pago fue aprobado! Ya puedes registrar entrenamientos.' : 'Tu pago fue rechazado. Revisa el comprobante y vuelve a enviarlo desde Membresía.'}</div>` : '';
  v.innerHTML = `<h1>Hola, ${esc(ctx.profile?.full_name || '')}</h1><p class="muted">Tu semana en el Crowd</p>${statusNotice}
    ${!cur || cur.status === 'rejected' ? `<div class="card warn">Aún no tienes la membresía de este mes aprobada. <a href="#perfil">Ver membresía en tu perfil</a></div>` : cur.status === 'pending' ? '<div class="card warn">Tu pago está pendiente de aprobación.</div>' : ''}
    <div class="grid">
      ${ctx.modules.running ? `<div class="card stat"><b>${fmt(km('running'))} km</b><span>Running · semana</span></div><div class="card stat"><b>${fmt(km('cycling'))} km</b><span>Ciclismo · semana</span></div><div class="card stat"><b>${fmt(km('swimming'))} km</b><span>Natación · semana</span></div>` : ''}
      ${ctx.modules.plyo ? `<div class="card stat"><b>${plyoWeek}</b><span>Pliometría · sesiones</span></div>` : ''}
      ${ctx.modules.training ? `<div class="card stat"><b>${trainingWeek}</b><span>Entrenamiento · sesiones</span></div>` : ''}
    </div>
    ${ctx.modules.running ? `<div class="card"><span class="muted">Última actividad</span><br>${last ? `<b>${DISC[last.discipline]}</b> · ${fmt(last.distance_km)} km · ${fmt(last.duration_min)} min${last.discipline === 'running' ? ' · ' + paceStr(last.distance_km, last.duration_min) : ''} · ${last.performed_on}` : 'Aún no registras nada.'}</div>` : ''}
    ${ctx.modules.plyo && ws.some((w) => w.kind === 'plyometrics') ? `<div class="card"><span class="muted">Última sesión de pliometría</span><br>${(() => { const recent = ws.find((w) => w.kind === 'plyometrics'); return recent ? `<b>${recent.performed_on}</b> · ${recent.workout_sets.length} series${recent.duration_min ? ' · ' + fmt(recent.duration_min, 0) + ' min' : ''}` : ''; })()}</div>` : ''}
    <div class="quick-actions">${ctx.modules.running ? '<a class="btn" href="#running">Registrar running</a>' : ''}${ctx.modules.plyo ? '<a class="btn ghost" href="#plyo">Registrar pliometría</a>' : ''}${ctx.modules.training ? '<a class="btn ghost" href="#training">Entrenamiento</a>' : ''}</div>`;
}

/* ---------------- Membresía (pago por QR manual) ---------------- */
async function renderMembership(v) {
  const { data: mems = [] } = await supabase.from('memberships').select('*').order('period', { ascending: false }).order('created_at', { ascending: false });
  const cur = mems.find((m) => m.period === monthStart() && m.status !== 'rejected') || mems.find((m) => m.period === monthStart());
  const status = cur ? `<p>Estado de este mes: <span class="pill ${cur.status}">${STATUS[cur.status]}</span></p>` : '<p class="muted">Aún no pagaste este mes.</p>';
  v.innerHTML = `<h1>Membresía</h1><p class="muted">200 Bs / mes</p><div class="card" id="mem"></div>
    ${mems.length ? `<h2>Mis pagos</h2><div class="activity-list">${mems.map((m) => `<div class="card activity-card"><b>${m.period.slice(0, 7)}</b><span class="pill ${m.status}">${STATUS[m.status]}</span></div>`).join('')}</div>` : ''}`;
  const box = $('#mem');
  if (cur && cur.status !== 'rejected') { box.innerHTML = status + (cur.status === 'pending' ? '<p class="muted">Recibimos tu comprobante. El administrador lo aprobará pronto.</p>' : ''); return; }
  box.innerHTML = `${status}
    <ol class="pay-steps"><li>Paga 200 Bs escaneando este QR.</li><li>Sube una foto del comprobante.</li><li>Espera la aprobación del administrador.</li></ol>
    <img class="qr" src="/qr-pago.webp" alt="QR de pago">
    <form id="pf"><label for="fl">Comprobante (foto)</label><input id="fl" type="file" accept="image/*" required>
    <button class="btn" type="submit">Enviar comprobante</button><p class="msg" id="pm"></p></form>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const file = $('#fl').files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024) { $('#pm').textContent = 'La foto pesa más de 5 MB.'; return; }
    const path = `${ctx.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`;
    const up = await supabase.storage.from('receipts').upload(path, file);
    if (up.error) { $('#pm').textContent = 'Error subiendo: ' + up.error.message; return; }
    const ins = await supabase.from('memberships').insert({ period: monthStart(), proof_path: path });
    if (ins.error) $('#pm').textContent = 'Error: ' + ins.error.message; else renderMembership(v);
  };
}

async function renderProfile(v) {
  const [{ data: activities = [] }, { data: workouts = [] }, { data: payments = [] }, { data: friendships = [] }, { data: avatarData }] = await Promise.all([
    supabase.from('activities').select('discipline,distance_km,duration_min,performed_on').order('performed_on', { ascending: false }).limit(300),
    supabase.from('workouts').select('kind,performed_on,duration_min,workout_sets(id)').order('performed_on', { ascending: false }).limit(200),
    supabase.from('memberships').select('period,status,amount_bs,proof_path').order('period', { ascending: false }).limit(12),
    supabase.from('friendships').select('id,status,requester,addressee').or(`requester.eq.${ctx.user.id},addressee.eq.${ctx.user.id}`),
    ctx.profile?.avatar_path ? supabase.storage.from('profile-media').createSignedUrl(ctx.profile.avatar_path,3600) : Promise.resolve({data:null}),
  ]);
  const todayDate = new Date();
  const key = `profile_period_${ctx.user.id}`;
  const period = localStorage.getItem(key) || 'week';
  const mediaKey = `profile_view_${ctx.user.id}`;
  const mediaView = localStorage.getItem(mediaKey) || 'posts';
  const moduleKey = `profile_module_${ctx.user.id}`;
  const selectedModule = localStorage.getItem(moduleKey) || 'all';
  const range = period === 'day' ? 1 : period === 'month' ? 30 : 7;
  const from = new Date(todayDate); from.setDate(from.getDate() - range + 1);
  const dateKey = d => new Date(d).toISOString().slice(0,10);
  const days = Array.from({length: period === 'week' ? 7 : period === 'day' ? 1 : 30}, (_, i) => { const d = new Date(from); d.setDate(d.getDate()+i); return dateKey(d); });
  const values = days.map(d => activities.filter(a => a.performed_on === d).length + workouts.filter(w => w.performed_on === d).length);
  const max = Math.max(1, ...values);
  const km = activities.reduce((s,a)=>s+Number(a.distance_km||0),0);
  const initials = (ctx.profile?.full_name || 'BC').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const counts = selectedModule==='all'?{workouts:activities.length+workouts.length,km}:{workouts:workouts.filter(w=>selectedModule==='plyo'?w.kind==='plyometrics':selectedModule==='training'?w.kind==='training':false).length+activities.filter(a=>a.discipline===selectedModule).length,km:activities.filter(a=>a.discipline===selectedModule).reduce((s,a)=>s+Number(a.distance_km),0)};
  const friends = friendships.filter(f=>f.status==='accepted').length;
  const moduleData = [['running','Running','running.png'],['plyo','Pliometría','plyo.png'],['training','Gym','training.png'],['swimming','Natación','swimming.png']];
  const moduleActivities = activities.filter(a=>selectedModule==='all'||a.discipline===selectedModule);
  const moduleWorkouts = workouts.filter(w=>selectedModule==='all'||(selectedModule==='plyo'&&w.kind==='plyometrics')||(selectedModule==='training'&&w.kind==='training'));
  v.innerHTML = `<section class="profile-page"><header class="profile-hero"><label for="avatar-file" class="profile-avatar">${avatarData?.signedUrl?`<img src="${avatarData.signedUrl}" alt="Foto de perfil">`:initials}<input hidden id="avatar-file" type="file" accept="image/*"></label><div class="profile-identity"><h1>${esc(ctx.profile?.full_name || 'Socio Batmon')}</h1><span>${esc(ctx.user.email || '')}</span></div><div><button id="settings-open" class="btn sm ghost" aria-label="Configuración">⚙</button><button id="edit-profile" class="btn sm ghost">Editar perfil</button></div></header>
    <div class="profile-counts"><div><b>${counts.workouts}</b><span>Entrenos</span></div><div><b>${fmt(counts.km,0)}</b><span>Km</span></div><div><b>${friends}</b><span>Amigos</span></div></div>
    <nav class="profile-highlights" aria-label="Accesos a entrenamientos">${moduleData.map(([id,title,img])=>`<button data-module="${id}" class="${selectedModule===id?'selected':''}"><span><img src="/profile-modules/${img}" alt=""></span><small>${title}</small></button>`).join('')}</nav>
    <section class="card"><div class="profile-section-head"><h2>Membresía</h2><span class="pill ${payments[0]?.status || 'pending'}">${payments[0] ? STATUS[payments[0].status] : 'Sin pago'}</span></div><p class="muted">${payments[0]?.period?.slice(0,7) || 'Este mes'} · 200 Bs</p>${payments.length?`<div class="profile-payments">${payments.slice(0,4).map(p=>`<span>${p.period.slice(0,7)} <b class="pill ${p.status}">${STATUS[p.status]}</b></span>`).join('')}</div>`:''}<button class="btn" id="membership-open">Pagar o ver comprobantes</button></section>
    <nav class="profile-media-tabs" aria-label="Publicaciones del perfil"><button data-media="posts" class="${mediaView==='posts'?'on':''}">▦ <span>Publicaciones</span></button><button data-media="videos" class="${mediaView==='videos'?'on':''}">▷ <span>Videos</span></button><button data-media="progress" class="${mediaView==='progress'?'on':''}">▥ <span>Progreso</span></button></nav>
    ${mediaView==='progress'?`<section class="card profile-chart"><div class="profile-section-head"><div><span class="muted">${selectedModule==='all'?'Todos tus módulos':DISC[selectedModule]|| (selectedModule==='plyo'?'Pliometría':'Entrenamiento')}</span><h2>Actividad</h2></div><div class="period-switch">${[['day','Día'],['week','Semana'],['month','Mes']].map(([k,t])=>`<button data-period="${k}" class="${period===k?'on':''}">${t}</button>`).join('')}</div></div><div class="profile-bars">${values.map((n,i)=>`<div><i style="height:${Math.max(4,n/max*100)}%"></i><small>${period==='month'?(i+1):days[i].slice(8)}</small></div>`).join('')}</div><p class="muted">Sesiones registradas por día</p><button id="measurement-open" class="btn ghost">Añadir medidas corporales</button></section>`:mediaView==='videos'?'<div class="profile-empty">Aún no hay videos de entrenamiento.</div>':`<div class="profile-post-grid">${[...moduleActivities.map(a=>({date:a.performed_on,title:DISC[a.discipline],detail:`${fmt(a.distance_km)} km`})),...moduleWorkouts.map(w=>({date:w.performed_on,title:w.kind==='training'?'Entrenamiento':'Pliometría',detail:`${w.workout_sets.length} series`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,18).map(a=>`<article><b>${esc(a.title)}</b><span>${a.detail}</span><small>${a.date}</small></article>`).join('')||'<div class="profile-empty">Tus entrenamientos aparecerán aquí.</div>'}</div>`}</section>`;
  $('#avatar-file',v).onchange=async e=>{const f=e.target.files[0];if(!f)return;const path=`${ctx.user.id}/avatar-${Date.now()}.${f.name.split('.').pop()}`;const up=await supabase.storage.from('profile-media').upload(path,f,{upsert:true});if(up.error){notify(up.error.message);return;}const {error}=await supabase.from('profiles').update({avatar_path:path}).eq('id',ctx.user.id);if(error)notify(error.message);else{ctx.profile.avatar_path=path;renderProfile(v);}};
  $('#settings-open',v).onclick=()=>renderProfileSettings(v);
  v.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{localStorage.setItem(moduleKey,b.dataset.module);renderProfile(v);});
  v.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>{localStorage.setItem(mediaKey,b.dataset.media);renderProfile(v);});
  v.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{localStorage.setItem(key,b.dataset.period);renderProfile(v);});
  $('#membership-open',v).onclick=()=>renderMembership(v);
  $('#edit-profile',v).onclick=()=>{v.innerHTML=`<h1>Editar perfil</h1><form id="profile-form" class="card"><label for="profile-name">Nombre</label><input id="profile-name" value="${esc(ctx.profile?.full_name||'')}" required><button class="btn">Guardar</button><p class="msg" id="profile-msg"></p></form>`;$('#profile-form',v).onsubmit=async e=>{e.preventDefault();const name=$('#profile-name',v).value.trim();const {error}=await supabase.from('profiles').update({full_name:name}).eq('id',ctx.user.id);if(error)$('#profile-msg',v).textContent=error.message;else{ctx.profile.full_name=name;renderProfile(v);}};};
}

function renderProfileSettings(v) {
  const saved=localStorage.getItem(`batmon_theme_${ctx.user.id}`)||'light';
  const forced=ctx.themePolicy!=='choice';
  v.innerHTML=`<div class="profile-settings"><button class="link" id="settings-back">← Volver al perfil</button><h1>Configuración</h1><section class="card"><h2>Apariencia</h2><p class="muted">${forced?`El administrador estableció el modo ${ctx.themePolicy==='dark'?'oscuro':'claro'} para todo el club.`:'Elige el tema que prefieres usar.'}</p><label for="user-theme">Tema</label><select id="user-theme" ${forced?'disabled':''}><option value="light" ${saved==='light'?'selected':''}>Claro</option><option value="dark" ${saved==='dark'?'selected':''}>Oscuro</option></select></section></div>`;
  $('#settings-back',v).onclick=()=>renderProfile(v);
  $('#user-theme',v).onchange=e=>{localStorage.setItem(`batmon_theme_${ctx.user.id}`,e.target.value);applyTheme(e.target.value);};
}

/* ---------------- Arranque: sesión persistente ---------------- */
$('#tabs').innerHTML = TABS.map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}"><span class="tab-icon">${icon}</span><span>${t}</span></a>`).join('');
$('#logout').onclick = () => supabase.auth.signOut();
window.addEventListener('hashchange', route);
let booted = null;
supabase.auth.onAuthStateChange((_ev, session) => {
  if (!session) { booted = null; showLogin(); return; }
  if (booted !== session.user.id) { booted = session.user.id; boot(session.user); }  // evita recargar en cada refresh de token
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showNewPassword();
});
void today;
