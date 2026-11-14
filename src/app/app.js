import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, today, monthStart, weekStart, paceStr, DISC, showDelayedLoading } from './common.js';
import { renderRunning } from './running.js';
import { renderPlyo } from './plyo.js';
import { renderTraining } from './training.js';
import { showLogin, showProfileSetup, hasMemberIdentity } from './auth.js';

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

/* ---------------- Login / registro / recuperación ---------------- */
function showNewPassword() {
  view.innerHTML = `<h1>Nueva contraseña</h1><p class="muted">Elige una contraseña de al menos 6 caracteres.</p><form id="newpass" class="card"><label for="np">Contraseña nueva</label><input id="np" type="password" minlength="6" autocomplete="new-password" required><button class="btn" type="submit">Guardar contraseña</button><p class="msg" id="npm"></p></form>`;
  $('#newpass').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: $('#np').value });
    $('#npm').textContent = error ? 'No se pudo actualizar: ' + error.message : 'Contraseña actualizada. Ya puedes ingresar.';
    if (!error) setTimeout(() => showLogin(view), 1200);
  };
}

/* ---------------- Shell con pestañas ---------------- */
async function boot(user) {
  const stopLoading=showDelayedLoading(view);
  try {
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
  if (!hasMemberIdentity(profile)) {
    $('#tabs').hidden = true;
    stopLoading();
    showProfileSetup(view, user, profile || {}, () => boot(user));
    return;
  }
  $('#tabs').hidden = false;
  renderTabs();
  stopLoading();
  route();
  } catch (error) {
    stopLoading();
    view.innerHTML=`<p class="msg">No se pudo cargar la app: ${esc(error.message)}</p>`;
  }
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.filter(([key]) => !['running', 'cycling', 'swimming', 'plyo', 'training'].includes(key) || ctx.modules[key])
    .map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}"><span class="tab-icon">${icon}</span><span>${t}</span></a>`).join('');
}

function route() {
  if (!ctx) return;
  const tab = (location.hash.slice(1) || 'inicio');
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + tab));
  const moduleKey = { running: 'running', cycling: 'cycling', swimming: 'swimming', plyo: 'plyo', training: 'training' }[tab];
  if (moduleKey && !ctx.modules[moduleKey]) {
    view.innerHTML = `<h1>${TABS.find(([key]) => key === tab)?.[1]}</h1><div class="card warn">Este módulo está desactivado para tu cuenta. Consulta con el administrador del club.</div>`;
    return;
  }
  const fn = { inicio: renderHome, running: () => renderRunning(view, ctx, 'running'), cycling: () => renderRunning(view, ctx, 'cycling'), swimming: () => renderRunning(view, ctx, 'swimming'), plyo: renderPlyo, training: renderTraining, perfil: renderProfile }[tab] || renderHome;
  const stopLoading=showDelayedLoading(view);
  Promise.resolve().then(()=>fn(view, ctx)).then(stopLoading).catch((e) => { stopLoading();view.innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
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
  const { data: mems = [] } = await supabase.from('memberships').select('*').eq('user_id', ctx.user.id).order('period', { ascending: false }).order('created_at', { ascending: false });
  const cur = mems.find((m) => m.period === monthStart() && m.status !== 'rejected') || mems.find((m) => m.period === monthStart());
  const approved = mems.find((m) => m.status === 'approved');
  const membershipStart = approved ? new Date(approved.approved_at || approved.created_at || `${approved.period}T00:00:00`) : null;
  const daysLeft = membershipStart && !Number.isNaN(membershipStart.getTime()) ? Math.max(0, Math.ceil((membershipStart.getTime() + 30 * 86400000 - Date.now()) / 86400000)) : null;
  const progress = daysLeft === null ? 0 : Math.min(100, daysLeft / 30 * 100);
  const expiresOn = membershipStart ? new Date(membershipStart.getTime() + 30 * 86400000).toLocaleDateString('es-BO') : '';
  const status = cur ? `<p>Estado de este mes: <span class="pill ${cur.status}">${STATUS[cur.status]}</span></p>` : '<p class="muted">Aún no pagaste este mes.</p>';
  const canPay = !cur || cur.status === 'rejected';
  v.innerHTML = `<button class="link" id="membership-back">← Volver al perfil</button><h1>Membresía</h1><p class="muted">200 Bs / mes</p><div class="card membership-page-card" id="mem">${status}${daysLeft !== null ? `<div class="membership-full-status"><b>${daysLeft ? `Quedan ${daysLeft} días` : 'Membresía vencida'}</b><span>Vence el ${expiresOn}</span><div class="membership-progress ${daysLeft <= 3 ? 'urgent' : ''}" role="progressbar" aria-label="Días restantes de membresía" aria-valuemin="0" aria-valuemax="30" aria-valuenow="${daysLeft}"><i style="width:${progress}%"></i></div></div>` : '<p class="muted">Cuando se apruebe tu pago tendrás 30 días de membresía.</p>'}${cur?.status === 'pending' ? '<p class="muted">Recibimos tu solicitud. El administrador confirmará el pago pronto.</p>' : ''}</div>
    <section class="payment-methods"><h2>Formas de pago</h2><div class="wallet payment-wallet" aria-label="Selecciona una forma de pago">
      <div class="wallet-back"></div>
      <button class="wallet-method method-qr" type="button" data-payment="qr" aria-label="Pagar con QR" ${canPay?'':'disabled'}><span class="method-top"><b>QR</b><span class="method-chip qr-mark">▦</span></span><span class="method-bottom"><span class="method-label">ESCANEA Y PAGA</span><strong>Subir comprobante</strong></span></button>
      <button class="wallet-method method-credit" type="button" data-payment="card" aria-label="Pago con tarjeta, aún no disponible" ${canPay?'':'disabled'}><span class="method-top"><b>Tarjeta</b><span class="method-chip">▤</span></span><span class="method-bottom"><span class="method-label">CRÉDITO / DÉBITO</span><strong>Aún no disponible</strong></span><span class="mini-mastercard"><i></i><i></i></span></button>
      <button class="wallet-method method-cash" type="button" data-payment="cash" aria-label="Solicitar pago en efectivo" ${canPay?'':'disabled'}><span class="method-top"><b>Efectivo</b><span class="method-chip bill-mark">Bs</span></span><span class="method-bottom"><span class="method-label">PAGO EN PERSONA</span><strong>200 Bs · Confirmar</strong></span></button>
      <div class="wallet-pocket"><svg viewBox="0 0 280 160" aria-hidden="true"><path d="M0 20C0 10 5 10 10 10c10 0 15 15 30 15h200c15 0 20-15 30-15 5 0 10 0 10 10v100c0 35-20 40-40 40H40C20 160 0 155 0 120Z" fill="#242424"/><path d="M8 22c0-6 4-6 7-6 8 0 12 13 25 13h200c13 0 17-13 25-13 3 0 7 0 7 6v98c0 30-17 32-32 32H40c-15 0-32-2-32-32Z" stroke="#a3a3a3" stroke-width="1.5" stroke-dasharray="6 4"/></svg><div class="wallet-pocket-content"><strong>200 Bs</strong><span>Membresía mensual</span><small>Elige tu forma de pago</small></div></div>
    </div></section>
    ${mems.length ? `<h2>Mis pagos</h2><div class="activity-list">${mems.map((m) => `<div class="card activity-card"><b>${m.period.slice(0, 7)} · ${m.payment_method === 'cash' ? 'Efectivo' : 'QR'}</b><span class="pill ${m.status}">${STATUS[m.status]}</span></div>`).join('')}</div>` : ''}`;
  $('#membership-back',v).onclick=()=>renderProfile(v);
  if (!canPay) return;
  const openModal=(html)=>{const modal=document.createElement('div');modal.className='modal payment-modal';modal.innerHTML=`<section class="sheet payment-sheet" role="dialog" aria-modal="true">${html}</section>`;modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-payment-close]'))modal.remove();});document.body.append(modal);return modal;};
  const showCardUnavailable=()=>{
    const modal=openModal(`<div class="sheet-h"><h2>Pago con tarjeta</h2><button class="link" type="button" data-payment-close>Cerrar</button></div><p class="card-unavailable">Vista previa solamente: el pago con tarjeta aún no está disponible. No introduzcas datos reales.</p><div class="card-payment-layout"><div class="flip-card" aria-label="Vista previa de tarjeta"><div class="flip-card-inner"><div class="flip-card-front"><span class="credit-brand">BATMON CROWD</span><span class="credit-chip"></span><span class="credit-contactless">)))</span><b class="credit-number" data-card-number>•••• &nbsp; •••• &nbsp; •••• &nbsp; ••••</b><span class="credit-date" data-card-expiry>MM/YY</span><span class="credit-holder" data-card-holder>NOMBRE DEL TITULAR</span><span class="credit-logo"><i></i><i></i></span></div><div class="flip-card-back"><span class="credit-strip"></span><span class="credit-signature"><small>CVV</small><b data-card-cvv>•••</b></span><small>Reverso de la tarjeta</small></div></div></div><form class="card-preview-form" autocomplete="off"><label for="preview-holder">Nombre del titular</label><input id="preview-holder" type="text" maxlength="26" placeholder="NOMBRE Y APELLIDO" autocomplete="off"><label for="preview-number">Número de tarjeta</label><input id="preview-number" type="text" inputmode="numeric" maxlength="19" placeholder="0000 0000 0000 0000" autocomplete="off"><div class="card-preview-fields"><div><label for="preview-expiry">Vencimiento</label><input id="preview-expiry" type="text" inputmode="numeric" maxlength="5" placeholder="MM/AA" autocomplete="off"></div><div><label for="preview-cvv">CVV</label><input id="preview-cvv" type="password" inputmode="numeric" maxlength="4" placeholder="•••" autocomplete="off"></div></div></form></div>`);
    modal.querySelector('.payment-sheet').classList.add('card-payment-sheet');
    const form=modal.querySelector('.card-preview-form'),flip=modal.querySelector('.flip-card');
    form.onsubmit=e=>e.preventDefault();
    const setText=(selector,value,fallback)=>{modal.querySelector(selector).textContent=value||fallback;};
    form.querySelector('#preview-holder').oninput=e=>setText('[data-card-holder]',e.target.value.toUpperCase(),'NOMBRE DEL TITULAR');
    form.querySelector('#preview-number').oninput=e=>{const digits=e.target.value.replace(/\D/g,'').slice(0,16);e.target.value=digits.replace(/(\d{4})(?=\d)/g,'$1 ').trim();setText('[data-card-number]',digits?digits.replace(/(\d{4})(?=\d)/g,'$1 ').trim():'','••••  ••••  ••••  ••••');};
    form.querySelector('#preview-expiry').oninput=e=>{const digits=e.target.value.replace(/\D/g,'').slice(0,4);e.target.value=digits.replace(/^(\d{2})(\d)/,'$1/$2');setText('[data-card-expiry]',e.target.value,'MM/YY');};
    form.querySelector('#preview-cvv').onfocus=()=>flip.classList.add('is-flipped');
    form.querySelector('#preview-cvv').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);setText('[data-card-cvv]',e.target.value,'•••');flip.classList.add('is-flipped');};
    form.querySelectorAll('input:not(#preview-cvv)').forEach(input=>input.onfocus=()=>flip.classList.remove('is-flipped'));
  };
  const submitReceipt=async(modal)=>{const form=modal.querySelector('#qr-payment-form');const file=form.querySelector('input[type=file]').files[0];const msg=form.querySelector('.msg');const submit=form.querySelector('button[type=submit]');if(!file)return;if(file.size>5*1024*1024){msg.textContent='La foto pesa más de 5 MB.';return;}submit.disabled=true;msg.textContent='Subiendo comprobante…';const path=`${ctx.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]/g,'_')}`;const up=await supabase.storage.from('receipts').upload(path,file);if(up.error){submit.disabled=false;msg.textContent='Error subiendo: '+up.error.message;return;}const ins=await supabase.from('memberships').insert({period:monthStart(),payment_method:'qr',proof_path:path});if(ins.error){submit.disabled=false;msg.textContent='Error: '+ins.error.message;return;}modal.remove();await renderMembership(v);};
  v.querySelector('[data-payment="qr"]').onclick=()=>{const modal=openModal(`<div class="sheet-h"><h2>Pago con QR</h2><button class="link" type="button" data-payment-close>Cerrar</button></div><p class="muted">Escanea el código y paga <b>200 Bs</b>.</p><ol class="pay-steps"><li>Realiza el pago con tu aplicación bancaria.</li><li>Sube una foto del comprobante.</li><li>El administrador revisará tu pago.</li></ol><img class="qr" src="/qr-pago.webp" alt="QR para pagar la membresía"><form id="qr-payment-form"><label for="receipt-file">Comprobante (foto)</label><input id="receipt-file" type="file" accept="image/*" required><button class="btn" type="submit">Enviar comprobante</button><p class="msg"></p></form>`);modal.querySelector('#qr-payment-form').onsubmit=e=>{e.preventDefault();void submitReceipt(modal);};};
  v.querySelector('[data-payment="card"]').onclick=showCardUnavailable;
  v.querySelector('[data-payment="cash"]').onclick=()=>{const modal=openModal(`<div class="sheet-h"><h2>Pago en efectivo</h2><button class="link" type="button" data-payment-close>Cerrar</button></div><div class="cash-bill"><span>BATMON CROWD</span><strong>200 <small>Bs</small></strong><i>MEMBRESÍA MENSUAL</i></div><p>Se enviará una solicitud para confirmar el pago de <b>200 Bs</b> en efectivo. El administrador la marcará como aprobada después de recibirlo.</p><p class="msg" id="cash-message"></p><div class="quick-actions"><button class="btn ghost" type="button" data-payment-close>Cancelar</button><button class="btn" id="cash-confirm" type="button">Enviar a confirmar</button></div>`);modal.querySelector('#cash-confirm').onclick=async e=>{const button=e.currentTarget;button.disabled=true;modal.querySelector('#cash-message').textContent='Enviando solicitud…';const {error}=await supabase.from('memberships').insert({period:monthStart(),payment_method:'cash'});if(error){button.disabled=false;modal.querySelector('#cash-message').textContent='No se pudo enviar: '+error.message;return;}modal.remove();await renderMembership(v);};};
}

async function renderProfile(v) {
  const [{ data: activities = [] }, { data: workouts = [] }, { data: friendships = [] }, { data: avatarData }] = await Promise.all([
    supabase.from('activities').select('discipline,distance_km,duration_min,performed_on').order('performed_on', { ascending: false }).limit(300),
    supabase.from('workouts').select('kind,performed_on,duration_min,workout_sets(id)').order('performed_on', { ascending: false }).limit(200),
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
  v.innerHTML = `<section class="profile-page"><header class="profile-hero"><label for="avatar-file" class="profile-avatar">${avatarData?.signedUrl?`<img src="${avatarData.signedUrl}" alt="Foto de perfil">`:initials}<input hidden id="avatar-file" type="file" accept="image/*"></label><div class="profile-identity"><h1>${esc(ctx.profile?.full_name || 'Socio Batmon')}</h1><span>${esc(ctx.profile?.contact_email || '')}</span></div><div class="profile-menu-wrap"><button id="settings-open" class="settings-hamburger" aria-label="Abrir configuración"><span class="line1"></span><span class="line2"></span><span class="line3"></span></button></div></header>
    <div class="profile-counts"><div><b>${counts.workouts}</b><span>Entrenos</span></div><div><b>${fmt(counts.km,0)}</b><span>Km</span></div><div><b>${friends}</b><span>Amigos</span></div></div>
    <div class="profile-actions"><button id="edit-profile" class="btn ghost">Editar perfil</button><button id="membership-open" class="btn ghost">Membresía</button></div>
    <nav class="profile-highlights" aria-label="Accesos a entrenamientos">${moduleData.map(([id,title,img])=>`<button data-module="${id}" class="module-highlight module-${id} ${selectedModule===id?'selected':''}"><span><img src="/profile-modules/${img}" alt=""></span><small>${title}</small></button>`).join('')}</nav>
    <nav class="profile-media-tabs" aria-label="Fotos, videos y progreso"><button data-media="posts" class="${mediaView==='posts'?'on':''}">▦ <span>Fotos</span></button><button data-media="videos" class="${mediaView==='videos'?'on':''}">▷ <span>Videos</span></button><button data-media="progress" class="${mediaView==='progress'?'on':''}">▥ <span>Progreso</span></button></nav>
    ${mediaView==='progress'?`<section class="card profile-chart"><div class="profile-section-head"><div><span class="muted">${selectedModule==='all'?'Todos tus módulos':DISC[selectedModule]|| (selectedModule==='plyo'?'Pliometría':'Entrenamiento')}</span><h2>Actividad</h2></div><div class="period-switch">${[['day','Día'],['week','Semana'],['month','Mes']].map(([k,t])=>`<button data-period="${k}" class="${period===k?'on':''}">${t}</button>`).join('')}</div></div><div class="profile-bars">${values.map((n,i)=>`<div><i style="height:${Math.max(4,n/max*100)}%"></i><small>${period==='month'?(i+1):days[i].slice(8)}</small></div>`).join('')}</div><p class="muted">Sesiones registradas por día</p><button id="measurement-open" class="btn ghost">Añadir medidas corporales</button></section>`:mediaView==='videos'?'<div class="profile-empty">Aún no hay videos de entrenamiento.</div>':`<div class="profile-post-grid">${[...moduleActivities.map(a=>({date:a.performed_on,title:DISC[a.discipline],detail:`${fmt(a.distance_km)} km`})),...moduleWorkouts.map(w=>({date:w.performed_on,title:w.kind==='training'?'Entrenamiento':'Pliometría',detail:`${w.workout_sets.length} series`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,18).map(a=>`<article><b>${esc(a.title)}</b><span>${a.detail}</span><small>${a.date}</small></article>`).join('')||'<div class="profile-empty">Tus entrenamientos aparecerán aquí.</div>'}</div>`}</section>`;
  $('#avatar-file',v).onchange=async e=>{const f=e.target.files[0];if(!f)return;const path=`${ctx.user.id}/avatar-${Date.now()}.${f.name.split('.').pop()}`;const up=await supabase.storage.from('profile-media').upload(path,f,{upsert:true});if(up.error){notify(up.error.message);return;}const {error}=await supabase.from('profiles').update({avatar_path:path}).eq('id',ctx.user.id);if(error)notify(error.message);else{ctx.profile.avatar_path=path;renderProfile(v);}};
  $('#settings-open',v).onclick=e=>{const button=e.currentTarget;button.classList.add('is-opening');button.disabled=true;setTimeout(()=>renderProfileSettings(v),320);};
  v.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{localStorage.setItem(moduleKey,b.dataset.module);renderProfile(v);});
  v.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>{localStorage.setItem(mediaKey,b.dataset.media);renderProfile(v);});
  v.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{localStorage.setItem(key,b.dataset.period);renderProfile(v);});
  $('#membership-open',v).onclick=()=>renderMembership(v);
  $('#edit-profile',v).onclick=()=>{v.innerHTML=`<h1>Editar perfil</h1><form id="profile-form" class="card"><label for="profile-name">Nombre</label><input id="profile-name" value="${esc(ctx.profile?.full_name||'')}" required><button class="btn">Guardar</button><p class="msg" id="profile-msg"></p></form>`;$('#profile-form',v).onsubmit=async e=>{e.preventDefault();const name=$('#profile-name',v).value.trim();const {error}=await supabase.from('profiles').update({full_name:name}).eq('id',ctx.user.id);if(error)$('#profile-msg',v).textContent=error.message;else{ctx.profile.full_name=name;renderProfile(v);}};};
}

function renderProfileSettings(v) {
  const saved=localStorage.getItem(`batmon_theme_${ctx.user.id}`)||'light';
  const forced=ctx.themePolicy!=='choice';
  const isDark=(forced?ctx.themePolicy:saved)==='dark';
  v.innerHTML=`<div class="profile-settings"><button class="link" id="settings-back">← Volver al perfil</button><h1>Configuración</h1><section class="theme-preference"><h2 class="theme-setting-title">Tema</h2><label class="theme-switch" aria-label="Cambiar entre tema claro de día y tema oscuro de noche"><input id="user-theme" class="theme-switch__checkbox" type="checkbox" ${isDark?'checked':''} ${forced?'disabled':''}><span class="theme-switch__container" aria-hidden="true"><span class="theme-switch__clouds"></span><span class="theme-switch__stars-container"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 55" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 58.3837 23.1635 59.1599 24.0069C59.9361 24.8503 60.8798 25.2903 62 25.3545ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 26.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 85.172 28.2513 85.5248 27.5913ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z" fill="currentColor"/></svg></span><span class="theme-switch__circle-container"><span class="theme-switch__sun-moon-container"><span class="theme-switch__moon"><i class="theme-switch__spot"></i><i class="theme-switch__spot"></i><i class="theme-switch__spot"></i></span></span></span></span></label></section>${ctx.isAdmin?'<a class="btn ghost settings-admin" href="/admin.html">Administración</a>':''}<button id="settings-logout" class="btn ghost settings-logout">Cerrar sesión</button></div>`;
  $('#settings-back',v).onclick=()=>renderProfile(v);
  $('#user-theme',v).onchange=e=>{const theme=e.target.checked?'dark':'light';localStorage.setItem(`batmon_theme_${ctx.user.id}`,theme);applyTheme(theme);};
  const pf=ctx.profile||{};const at=x=>esc(x||'');
  const accountForm=document.createElement('div');
  accountForm.innerHTML=`<form id="account-data-form" class="card account-login-settings"><h2>Mis datos</h2><label for="ad-name">Nombre completo</label><input id="ad-name" value="${at(pf.full_name)}" maxlength="100" required><label for="ad-user">Usuario</label><input id="ad-user" value="${at(pf.username)}" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_.-]{3,24}" autocomplete="username" required><label for="ad-carnet">Carnet</label><input id="ad-carnet" value="${at(pf.carnet_number)}" maxlength="32" required><label for="ad-phone">Teléfono (8 dígitos, para recuperar contraseña)</label><input id="ad-phone" value="${at(pf.recovery_phone)}" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" required><label for="ad-mail">Correo de contacto (opcional)</label><input id="ad-mail" type="email" value="${at(pf.contact_email)}"><button class="btn ghost" type="submit">Guardar datos</button><p class="msg" id="ad-msg" aria-live="polite"></p></form><form id="account-pass-form" class="card account-login-settings"><h2>Cambiar contraseña</h2><label for="ap-new">Nueva contraseña</label><input id="ap-new" type="password" minlength="8" autocomplete="new-password" placeholder="Al menos 8 caracteres" required><button class="btn ghost" type="submit">Cambiar contraseña</button><p class="msg" id="ap-msg" aria-live="polite"></p></form>`;
  $('#settings-back',v).insertAdjacentElement('afterend', accountForm);
  $('#account-data-form',v).onsubmit=async e=>{
    e.preventDefault();const msg=$('#ad-msg',v);const button=$('#account-data-form button',v);button.disabled=true;msg.className='msg';msg.textContent='Guardando…';
    const row={p_full_name:$('#ad-name',v).value,p_username:$('#ad-user',v).value,p_carnet_number:$('#ad-carnet',v).value,p_recovery_phone:$('#ad-phone',v).value,p_contact_email:$('#ad-mail',v).value};
    const {error}=await supabase.rpc('update_my_account',row);
    button.disabled=false;
    if(error){msg.textContent=error.message;return;}
    const {data:fresh}=await supabase.from('profiles').select('*').eq('id',ctx.user.id).single();if(fresh)ctx.profile=fresh;
    msg.className='msg ok';msg.textContent='Datos guardados.';
  };
  $('#account-pass-form',v).onsubmit=async e=>{
    e.preventDefault();const msg=$('#ap-msg',v);const button=$('#account-pass-form button',v);button.disabled=true;msg.className='msg';
    const {error}=await supabase.auth.updateUser({password:$('#ap-new',v).value});
    button.disabled=false;
    if(error){msg.textContent=error.message;return;}
    $('#ap-new',v).value='';msg.className='msg ok';msg.textContent='Contraseña actualizada.';
  };
  $('#settings-logout',v).onclick=async()=>{if(window.confirm('¿Seguro que quieres cerrar sesión?')) await supabase.auth.signOut();};
}

/* ---------------- Arranque: sesión persistente ---------------- */
$('#tabs').innerHTML = TABS.map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}"><span class="tab-icon">${icon}</span><span>${t}</span></a>`).join('');
window.addEventListener('hashchange', route);
let booted = null;
supabase.auth.onAuthStateChange((_ev, session) => {
  if (!session) { booted = null; ctx = null; showLogin(view); return; }
  if (booted !== session.user.id) { booted = session.user.id; boot(session.user); }  // evita recargar en cada refresh de token
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showNewPassword();
});
void today;
