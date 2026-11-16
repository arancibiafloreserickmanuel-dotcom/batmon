import './app.css';
import { supabase, $, esc, getProfile } from '../supabase.js';
import { fmt, iso, today, monthStart, weekStart, DISC, RUN_TYPE, showDelayedLoading, notify, confirmDialog } from './common.js';
import { renderRunning } from './running.js';
import { renderPlyo } from './plyo.js';
import { renderTraining } from './training.js';
import { renderCommunity } from './community.js';
import { showLogin, showProfileSetup, hasMemberIdentity, enablePasswordToggles } from './auth.js';

const STATUS = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const view = $('#view');
const TABS = [
  ['inicio', 'Inicio', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/></svg>'],
  ['club', 'Club', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'],
  ['training', 'Entrenamiento', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4m3-7v10m12-10v10m3-7v4M6 12h12"/><path d="M9 8v8m6-8v8"/></svg>'],
  ['perfil', 'Perfil', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>'],
];
const TRAINING_MODULES = [
  { route: 'running', key: 'running', title: 'Running', detail: 'Registra tus carreras, revisa métricas y consulta tu historial.', icon: '<circle cx="16.5" cy="4.5" r="2"/><path d="m13 8 3 2 2 4-4 2-2 5m4-11-4 3-4 1-3 4m8-8-3-3-4 1"/>' },
  { route: 'cycling', key: 'cycling', title: 'Ciclismo', detail: 'Guarda tus recorridos, distancia y evolución sobre la bici.', icon: '<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 4-8 4 8H6m4-8h4m-1-3h3"/>' },
  { route: 'swimming', key: 'swimming', title: 'Natación', detail: 'Registra sesiones y distancia, y revisa tus marcas.', icon: '<path d="M3 16c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 3-2M3 20c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 3-2M12 4l-3 6h4l-2 4"/>' },
  { route: 'plyo', key: 'plyo', title: 'Pliometría', detail: 'Explora ejercicios, registra sesiones y sigue tu progreso.', icon: '<path d="M7 19h10M9 19l1.2-5.1 2.4-2.4 2.1 2.1L17 19M11 7.5a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4ZM12 9l-1.2 3.4-3.3 1.8M12 9l3.2 1.2 1.5 2.3M4 19h3M17 19h3"/>' },
  { route: 'gym', key: 'training', title: 'Gimnasio', detail: 'Organiza tus rutinas, ejercicios y sesiones de fuerza.', icon: '<path d="M3 10v4m3-7v10m12-10v10m3-7v4M6 12h12"/><path d="M9 8v8m6-8v8"/>' },
];
let ctx = null;

function applyTheme(preference) {
  const allowed = ctx?.themePolicy || 'choice';
  const saved = preference || localStorage.getItem(`batmon_theme_${ctx?.user?.id}`) || 'light';
  const theme = allowed === 'choice' ? saved : allowed;
  document.body.dataset.theme = theme;
}

function decorateBackButton(button,label=button.textContent.replace(/^\s*←\s*/,''),compact=false) {
  if(!button)return;
  button.classList.add('animated-back');
  button.classList.toggle('animated-back-compact',compact);
  button.innerHTML=`<span class="animated-back-sweep" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H21z"/></svg></span><span class="animated-back-label">${esc(label)}</span>`;
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
  ctx = { user, profile, isAdmin: profile?.role === 'admin', canRegister: profile?.role === 'admin' || membership?.status === 'approved', modules, themePolicy: appearance?.theme_policy || 'choice' };
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
  $('#tabs').innerHTML = TABS.filter(([key]) => key !== 'training' || TRAINING_MODULES.some(({ key: moduleKey }) => ctx.modules[moduleKey]))
    .map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}" aria-current="false"><span class="tab-icon">${icon}</span><span class="tab-label">${t}</span></a>`).join('');
}

function renderTrainingHub() {
  const available = TRAINING_MODULES.filter(({ key }) => ctx.modules[key]);
  view.innerHTML = `<section class="training-hub">
    <header class="training-hub__intro"><p class="training-hub__eyebrow">BATMON CROWD · TU ACTIVIDAD</p><h1>Entrenamiento</h1><p class="muted">Elige una disciplina para registrar sesiones y consultar tus estadísticas e historial.</p></header>
    ${available.length ? `<div class="training-hub__grid">${available.map(({ route, title, detail, icon }) => `<a class="card training-module-card" href="#${route}"><span class="training-module-card__icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><span class="training-module-card__copy"><strong>${title}</strong><small>${detail}</small></span><span class="training-module-card__arrow" aria-hidden="true">→</span></a>`).join('')}</div>` : '<div class="card muted">No tienes disciplinas activas. Consulta con el administrador del club.</div>'}
  </section>`;
}

function route() {
  if (!ctx) return;
  const tab = (location.hash.slice(1) || 'inicio');
  const isTrainingRoute = tab === 'training' || TRAINING_MODULES.some((item) => item.route === tab);
  document.querySelectorAll('#tabs a').forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === '#' + tab || (href === '#training' && isTrainingRoute);
    a.classList.toggle('on', active);
    a.setAttribute('aria-current', active ? 'page' : 'false');
  });
  if (tab === 'training') {
    const stopLoading = showDelayedLoading(view);
    Promise.resolve().then(renderTrainingHub).then(stopLoading);
    return;
  }
  const moduleKey = { running: 'running', cycling: 'cycling', swimming: 'swimming', plyo: 'plyo', gym: 'training' }[tab];
  if (moduleKey && !ctx.modules[moduleKey]) {
    const title = TRAINING_MODULES.find(({ route }) => route === tab)?.title || 'Entrenamiento';
    view.innerHTML = `<h1>${title}</h1><div class="card warn">Este módulo está desactivado para tu cuenta. Consulta con el administrador del club.</div><a class="btn ghost" href="#training">Ver disciplinas disponibles</a>`;
    return;
  }
  const fn = { inicio: renderHome, club: renderCommunity, running: () => renderRunning(view, ctx, 'running'), cycling: () => renderRunning(view, ctx, 'cycling'), swimming: () => renderRunning(view, ctx, 'swimming'), plyo: renderPlyo, gym: renderTraining, perfil: renderProfile }[tab] || renderHome;
  const stopLoading=showDelayedLoading(view);
  Promise.resolve().then(()=>fn(view, ctx)).then(() => {
    if (moduleKey) {
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'training-back-button';
      back.textContent = '← Todas las disciplinas';
      decorateBackButton(back, 'Todas las disciplinas', true);
      back.addEventListener('click', () => { location.hash = '#training'; });
      view.prepend(back);
    }
    stopLoading();
  }).catch((e) => { stopLoading();view.innerHTML = `<p class="msg">Error: ${esc(e.message)}</p>`; });
}

/* ---------------- Calendario Neumórfico Mobile-First (cal10) ---------------- */
let homeDayTimer = 0;

function buildUnifiedCalendar() {
  return `<section class="cal10 is-collapsed" id="cal10-widget">
    <div class="cal10__head">
      <div class="cal10__month-wrap">
        <div class="cal10__month" id="cal10-month">Noviembre</div>
        <div class="cal10__year" id="cal10-year">2026</div>
      </div>
      <div class="cal10__actions">
        <div class="cal10__nav">
          <button type="button" class="cal10__nav-btn" id="cal10-prev" aria-label="Mes anterior">‹</button>
          <button type="button" class="cal10__nav-btn" id="cal10-next" aria-label="Mes siguiente">›</button>
        </div>
        <button type="button" class="cal10__bell-btn" id="cal10-bell" aria-label="Notificaciones">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="cal10__dow">
      <div class="cal10__dw">L</div><div class="cal10__dw">M</div><div class="cal10__dw">M</div>
      <div class="cal10__dw">J</div><div class="cal10__dw">V</div><div class="cal10__dw">S</div><div class="cal10__dw">D</div>
    </div>

    <div class="cal10__grid" id="cal10Grid"></div>
    <div class="cal10__drawer" id="cal10-drawer">
      <div class="cal10__footer" id="cal10-footer">
        <div class="cal10__footer-label" id="cal10-footer-label">Agenda</div>
        <div class="cal10__events-list" id="cal10-events-list"></div>
      </div>

      <div class="cal10__toggles" id="cal10-toggles">
        <button type="button" class="cal10__toggle active" data-filter="day">Hoy</button>
        <button type="button" class="cal10__toggle" data-filter="week">Semana</button>
        <button type="button" class="cal10__toggle" data-filter="month">Mes</button>
      </div>
    </div>

    <div class="cal10__pull-zone" id="cal10-pull-zone">
      <button type="button" class="cal10__pull-tab" id="cal10-pull-btn" aria-label="Desplegable del calendario">
        <span class="cal10__pull-bar"></span>
      </button>
    </div>
  </section>`;
}

function setupUnifiedCalendar(view, clubEvents = [], agenda = {}) {
  const root = view.querySelector('#cal10-widget');
  if (!root) return;

  const monthEl = root.querySelector('#cal10-month');
  const yearEl = root.querySelector('#cal10-year');
  const prevBtn = root.querySelector('#cal10-prev');
  const nextBtn = root.querySelector('#cal10-next');
  const gridEl = root.querySelector('#cal10Grid');
  const pullBtn = root.querySelector('#cal10-pull-btn');
  const bellBtn = root.querySelector('#cal10-bell');
  const pullZone = root.querySelector('#cal10-pull-zone');
  const drawerEl = root.querySelector('#cal10-drawer');
  const footerLabel = root.querySelector('#cal10-footer-label');
  const eventsList = root.querySelector('#cal10-events-list');
  const toggles = root.querySelectorAll('.cal10__toggle');

  let isCollapsed = true;
  let eventFilter = 'day'; // 'day' | 'week' | 'month'
  let viewDate = new Date();
  let selectedIso = today();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const dayLabelsFull = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const formatEventTime = (event) => new Date(event.event_date).toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});
  const eventDateIso = (event) => iso(new Date(event.event_date));
  const plan = agenda.plan || {};
  const exercisesById = agenda.exercisesById || new Map();
  const activities = (agenda.activities || []).filter((item) => agenda.modules?.[item.discipline]);
  const workouts = (agenda.workouts || []).filter((item) => item.kind === 'training' ? agenda.modules?.training : item.kind === 'plyometrics' ? agenda.modules?.plyo : true);
  const challenges = agenda.challenges || [];
  const agendaErrors = agenda.errors || {};
  const routeByDiscipline = { running: '#running', cycling: '#cycling', swimming: '#swimming', plyometrics: '#plyo', training: '#gym' };

  function getEventsForDate(dateObj) {
    const dIso = iso(dateObj);
    return clubEvents.filter((ev) => eventDateIso(ev) === dIso);
  }

  function getPlanForDate(dateObj) {
    const rows = plan[dayLabelsFull[dateObj.getDay()]] || [];
    if (!rows.length || !agenda.modules?.training) return [];
    const names = rows.map((row) => exercisesById.get(String(row.exercise_id))?.name_es || exercisesById.get(String(row.exercise_id))?.name).filter(Boolean);
    const sessions = workouts.filter((workout) => workout.performed_on === iso(dateObj) && workout.kind === 'training');
    return [{
      kind: 'routine', title: 'Gimnasio · Rutina programada', date: iso(dateObj), route: '#gym',
      detail: names.length ? `${names.length} ejercicios · ${names.join(', ')}` : `${rows.length} ejercicios en tu plan`,
      done: sessions.length > 0, duration: sessions.reduce((sum, item) => sum + Number(item.duration_min || 0), 0),
    }];
  }

  function getCompletedForDate(dateObj) {
    const date = iso(dateObj);
    const plannedTraining = getPlanForDate(dateObj).length > 0;
    const completedActivities = activities.filter((item) => item.performed_on === date).map((item) => ({
      kind: 'completed', title: DISC[item.discipline] || 'Actividad', date, route: routeByDiscipline[item.discipline] || '#training',
      detail: [Number(item.distance_km) > 0 ? `${fmt(item.distance_km)} km` : '', Number(item.duration_min) > 0 ? `${fmt(item.duration_min, 0)} min` : '', item.run_type ? RUN_TYPE[item.run_type] : ''].filter(Boolean).join(' · ') || 'Sesión registrada',
    }));
    const completedWorkouts = workouts.filter((item) => item.performed_on === date && ['training', 'plyometrics'].includes(item.kind) && !(plannedTraining && item.kind === 'training')).map((item) => ({
      kind: 'completed', title: item.kind === 'plyometrics' ? 'Pliometría' : 'Gimnasio', date,
      route: item.kind === 'plyometrics' ? '#plyo' : '#gym',
      detail: [item.workout_sets?.length ? `${item.workout_sets.length} series` : '', Number(item.duration_min) > 0 ? `${fmt(item.duration_min, 0)} min` : ''].filter(Boolean).join(' · ') || 'Sesión completada',
    }));
    return [...completedActivities, ...completedWorkouts];
  }

  function getChallengesForDate(dateObj) {
    const date = iso(dateObj);
    return challenges.flatMap((challenge) => {
      if (challenge.starts_on !== date && challenge.ends_on !== date) return [];
      const begins = challenge.starts_on === date;
      return [{ kind: 'challenge', title: `${begins ? 'Comienza' : 'Finaliza'} reto · ${challenge.title}`, date, route: '#club', detail: challenge.discipline ? `Reto del Club · ${DISC[challenge.discipline] || challenge.discipline}` : 'Reto del Club' }];
    });
  }

  function renderGrid() {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    monthEl.textContent = monthNames[m];
    yearEl.textContent = String(y);

    const firstDay = new Date(y, m, 1);
    const firstDayIndex = (firstDay.getDay() + 6) % 7; // Lunes = 0

    const curDate = new Date(y, m, 1 - firstDayIndex);
    curDate.setHours(12, 0, 0, 0);

    const weeks = [];
    let curWeek = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(curDate);
      curWeek.push(d);
      if (curWeek.length === 7) {
        weeks.push(curWeek);
        curWeek = [];
      }
      curDate.setDate(curDate.getDate() + 1);
    }

    const renderedWeeks = weeks.filter((w, idx) => {
      if (idx < 4) return true;
      return w.some((d) => d.getMonth() === m);
    });

    let activeWeekIdx = renderedWeeks.findIndex((w) => w.some((d) => iso(d) === selectedIso));
    if (activeWeekIdx === -1) activeWeekIdx = 0;

    let cellsHtml = '';
    renderedWeeks.forEach((w, wIdx) => {
      w.forEach((d) => {
        const cellIso = iso(d);
        const isCurrentMonth = d.getMonth() === m;
        const isToday = cellIso === today();
        const isSelected = cellIso === selectedIso;

        // El evento se compara en la zona horaria local para marcar el día elegido por el admin.
        const event = getEventsForDate(d).sort((a,b)=>new Date(a.event_date)-new Date(b.event_date))[0];
        const daysToEvent = event ? Math.ceil((new Date(`${eventDateIso(event)}T12:00:00`).getTime()-new Date(`${today()}T12:00:00`).getTime())/86400000) : Infinity;
        const eventColor = daysToEvent <= 2 ? 'red' : daysToEvent <= 7 ? 'yellow' : 'green';
        const planned = getPlanForDate(d).length > 0;
        const completed = getCompletedForDate(d).length > 0;
        const challengeDay = getChallengesForDate(d).length > 0;
        const markers = [event ? `event cal10__dot--${eventColor}` : '', planned ? 'routine cal10__dot--routine' : '', completed ? 'completed cal10__dot--completed' : '', challengeDay ? 'challenge cal10__dot--challenge' : ''].filter(Boolean).slice(0, 3);

        const isVisibleInCollapsed = wIdx === activeWeekIdx;
        const hiddenClass = (isCollapsed && !isVisibleInCollapsed) ? ' cal10__cell--hidden' : '';

        cellsHtml += `<div class="cal10__cell${!isCurrentMonth ? ' other' : ''}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${hiddenClass}" data-iso="${cellIso}" data-week="${wIdx}">
          ${d.getDate()}
          ${markers.length ? `<span class="cal10__dots" aria-hidden="true">${markers.map((marker) => `<i class="cal10__dot ${marker}"></i>`).join('')}</span>` : ''}
        </div>`;
      });
    });

    gridEl.innerHTML = cellsHtml;

    gridEl.querySelectorAll('.cal10__cell').forEach((cell) => {
      cell.onclick = (e) => {
        e.stopPropagation();
        const clickedIso = cell.dataset.iso;
        if (!clickedIso) return;
        selectedIso = clickedIso;
        if (isCollapsed) {
          isCollapsed = false;
          root.classList.remove('is-collapsed');
          drawerEl.style.display = 'block';
          pullBtn.setAttribute('aria-expanded', 'true');
          bellBtn?.setAttribute('aria-expanded', 'true');
        }
        const [cy, cm] = clickedIso.split('-').map(Number);
        if (cy !== viewDate.getFullYear() || cm - 1 !== viewDate.getMonth()) {
          viewDate = new Date(cy, cm - 1, 1);
        }
        renderGrid();
        renderEvents();
      };
    });

    renderEvents();
  }

  function renderEvents() {
    const selDate = new Date(selectedIso + 'T12:00:00');
    const selDayName = dayLabelsFull[selDate.getDay()];
    const selMonthName = monthNames[selDate.getMonth()];
    const isToday = selectedIso === today();
    let title = '';
    let dates = [];

    if (eventFilter === 'day') {
      title = `${isToday ? 'Hoy' : selDayName} · ${selDate.getDate()} de ${selMonthName}`;
      dates = [selDate];
    } else if (eventFilter === 'week') {
      const wStart = new Date(selDate);
      wStart.setDate(wStart.getDate() - ((wStart.getDay() + 6) % 7));
      const wEnd = new Date(wStart);
      wEnd.setDate(wEnd.getDate() + 6);
      title = `Agenda · Semana del ${wStart.getDate()} al ${wEnd.getDate()} de ${monthNames[wEnd.getMonth()]}`;
      dates = Array.from({ length: 7 }, (_, index) => { const day = new Date(wStart); day.setDate(day.getDate() + index); return day; });
    } else {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      title = `Agenda · ${monthNames[m]} ${y}`;
      const totalDays = new Date(y, m + 1, 0).getDate();
      dates = Array.from({ length: totalDays }, (_, index) => new Date(y, m, index + 1, 12, 0, 0));
    }

    footerLabel.textContent = title;
    const dayGroups = dates.map((date) => {
      const dayIso = iso(date);
      const dateLabel = `${dayLabelsFull[date.getDay()]} ${date.getDate()} de ${monthNames[date.getMonth()]}`;
      const routineEntries = getPlanForDate(date).map((item) => ({ ...item, dateLabel, tag: item.done ? 'Completado' : 'Rutina' }));
      const completionEntries = getCompletedForDate(date).map((item) => ({ ...item, dateLabel, tag: 'Completado' }));
      const eventEntries = getEventsForDate(date).map((event) => ({ ...event, kind: 'event', dateLabel: `${dateLabel} · ${formatEventTime(event)}`, tag: 'Evento' }));
      const challengeEntries = getChallengesForDate(date).map((item) => ({ ...item, dateLabel, tag: 'Reto' }));
      return { dayIso, routineEntries, eventEntries: [...eventEntries, ...challengeEntries], completionEntries };
    });
    const sections = [
      ['Entrenamientos y rutinas', dayGroups.flatMap((group) => group.routineEntries), [agendaErrors.plan, agendaErrors.exercises].filter(Boolean)],
      ['Eventos y retos del Club', dayGroups.flatMap((group) => group.eventEntries), [agendaErrors.events, agendaErrors.challenges].filter(Boolean)],
      ['Actividad completada', dayGroups.flatMap((group) => group.completionEntries), [agendaErrors.activities].filter(Boolean)],
    ].filter(([, entries, warnings]) => entries.length || warnings.length);
    if (!sections.length) {
      eventsList.innerHTML = `<div class="cal10__ev-empty">No hay actividades ni eventos programados para esta fecha.</div>`;
      return;
    }
    eventsList.innerHTML = sections.map(([heading, entries, warnings]) => `<section class="cal10__agenda-section"><h3>${esc(heading)}</h3>${warnings.map((warning) => `<p class="cal10__agenda-warning">${esc(warning)}</p>`).join('')}${entries.map((item) => {
      if (item.kind === 'event') return `<button type="button" class="cal10__ev" data-event-id="${esc(item.id)}">${item.image_url ? `<img class="cal10__ev-img" src="${esc(item.image_url)}" alt="" loading="lazy">` : '<span class="cal10__agenda-symbol" aria-hidden="true">BC</span>'}<span class="cal10__ev-body"><span class="cal10__ev-name">${esc(item.title)}</span><span class="cal10__ev-time">${esc(item.dateLabel)}${item.location ? ` · ${esc(item.location)}` : ''}</span></span><span class="cal10__ev-pill">${esc(item.tag)}</span></button>`;
      return `<a class="cal10__ev cal10__agenda-link cal10__agenda-${esc(item.kind)}" href="${esc(item.route || '#training')}"><span class="cal10__agenda-symbol" aria-hidden="true">${item.kind === 'routine' ? 'R' : item.kind === 'challenge' ? 'C' : '✓'}</span><span class="cal10__ev-body"><span class="cal10__ev-name">${esc(item.title)}</span><span class="cal10__ev-time">${esc(item.dateLabel)} · ${esc(item.detail)}${item.kind === 'routine' && item.duration ? ` · ${fmt(item.duration, 0)} min` : ''}</span></span><span class="cal10__ev-pill">${esc(item.tag)}</span></a>`;
    }).join('')}</section>`).join('');
    eventsList.querySelectorAll('[data-event-id]').forEach((button)=>button.onclick=()=>openClubEvent(button.dataset.eventId));
  }

  // Toggles de filtro (Día, Semana, Mes para eventos)
  toggles.forEach((t) => {
    t.onclick = () => {
      toggles.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      eventFilter = t.dataset.filter || 'day';
      renderEvents();
    };
  });

  // Pull Button / Drag para desplegar y encoger
  const toggleCollapse = () => {
    isCollapsed = !isCollapsed;
    root.classList.toggle('is-collapsed', isCollapsed);
    drawerEl.style.display = isCollapsed ? 'none' : 'block';
    pullBtn.setAttribute('aria-expanded', String(!isCollapsed));
    bellBtn?.setAttribute('aria-expanded', String(!isCollapsed));
    renderGrid();
  };

  pullBtn.onclick = toggleCollapse;
  if (bellBtn) bellBtn.onclick = () => {
    if (isCollapsed) toggleCollapse();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  let touchStartY = 0;
  pullZone.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  pullZone.addEventListener('touchend', (e) => {
    const diff = e.changedTouches[0].clientY - touchStartY;
    if (diff > 25 && isCollapsed) {
      toggleCollapse();
    } else if (diff < -25 && !isCollapsed) {
      toggleCollapse();
    }
  }, { passive: true });

  prevBtn.onclick = () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    renderGrid();
  };

  nextBtn.onclick = () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    renderGrid();
  };

  // Estado inicial encogido
  root.classList.add('is-collapsed');
  drawerEl.style.display = 'none';
  renderGrid();
}

/* ---------------- Inicio ---------------- */
async function openClubEvent(eventId) {
  const {data:event,error}=await supabase.from('events').select('*').eq('id',eventId).single();
  if(error||!event){notify('No se pudo abrir el evento.');return;}
  const [{data:rsvp},{data:confirmedRows},{data:directoryRows},{data:image}]=await Promise.all([
    supabase.from('event_rsvps').select('id,status').eq('event_id',eventId).eq('user_id',ctx.user.id).maybeSingle(),
    supabase.from('event_rsvps').select('user_id').eq('event_id',eventId).eq('status','confirmed'),
    supabase.rpc('profile_directory'),
    !event.image_path?Promise.resolve({data:null}):event.image_path.startsWith('http')?Promise.resolve({data:{signedUrl:event.image_path}}):supabase.storage.from('event-media').createSignedUrl(event.image_path,3600),
  ]);
  const confirmed=confirmedRows||[];
  const directory=directoryRows||[];
  const people=await Promise.all(confirmed.map(async row=>{
    const person=row.user_id===ctx.user.id?ctx.profile:(directory||[]).find(profile=>profile.id===row.user_id);
    const name=person?.full_name||'Socio Batmon';
    if(!person?.avatar_path)return {name,avatar:''};
    const {data:avatar}=await supabase.storage.from('profile-media').createSignedUrl(person.avatar_path,1800);
    return {name,avatar:avatar?.signedUrl||''};
  }));
  const eventDate=new Date(event.event_date);
  const dateLabel=eventDate.toLocaleDateString('es-BO',{weekday:'short',day:'numeric',month:'short'}).replace(/\./g,'').toUpperCase();
  const timeLabel=eventDate.toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});
  const initials=name=>name.split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase();
  const modal=document.createElement('div');modal.className='modal event-detail-modal';modal.innerHTML=`<section class="sheet event-detail-sheet" aria-labelledby="event-detail-title"><button type="button" class="event-detail-close" data-close aria-label="Cerrar evento">Cerrar</button><div class="event-detail-cover">${image?.signedUrl?`<img class="event-detail-cover-image" src="${esc(image.signedUrl)}" alt="">`:''}<div class="event-detail-cover-copy"><span>${dateLabel}</span><h2 id="event-detail-title">${esc(event.title)}</h2></div></div><div class="event-detail-content"><p class="event-detail-desc">${esc(event.description||'')}</p><div class="event-detail-meta"><div class="event-detail-info-card"><small>HORA</small><b>${timeLabel}</b></div><div class="event-detail-info-card"><small>LUGAR</small><b>${esc(event.location||'Por confirmar')}</b></div></div><div class="event-detail-actions"><button class="btn ${rsvp?.status==='confirmed'?'is-confirmed':''}" data-confirm>${rsvp?.status==='confirmed'?'Voy ✓':'Voy'}</button><button class="btn ghost" data-cancel>No voy</button></div><section class="event-attendees" aria-label="Personas confirmadas"><p><b>${people.length} confirmados</b></p><div class="event-attendee-list">${people.length?people.map(person=>`<div class="event-attendee">${person.avatar?`<img src="${esc(person.avatar)}" alt="">`:`<span class="event-attendee-initials">${esc(initials(person.name))}</span>`}<small>${esc(person.name)}</small></div>`).join(''):'<span class="muted">Aún no hay confirmaciones.</span>'}</div></section></div></section>`;
  document.body.append(modal);decorateBackButton(modal.querySelector('[data-close]'),'Cerrar',true);modal.querySelector('[data-close]').onclick=()=>modal.remove();
  modal.querySelector('[data-confirm]')?.addEventListener('click',async(eventClick)=>{const button=eventClick.currentTarget;button.disabled=true;const {error:e}=await supabase.from('event_rsvps').upsert({event_id:eventId,user_id:ctx.user.id,status:'confirmed',updated_at:new Date().toISOString()},{onConflict:'event_id,user_id'});if(e){button.disabled=false;notify('No se pudo confirmar: '+e.message);}else{notify('Asistencia confirmada.','success');modal.remove();void renderHome(view);}});
  modal.querySelector('[data-cancel]')?.addEventListener('click',async(eventClick)=>{const title=rsvp?.status==='confirmed'?'¿Confirmas que no asistirás a este evento? Se quitará tu confirmación.':'¿Quieres indicar que no asistirás a este evento?';if(!(await confirmDialog(title,'No voy')))return;const button=eventClick.currentTarget;button.disabled=true;const {error:e}=await supabase.from('event_rsvps').upsert({event_id:eventId,user_id:ctx.user.id,status:'cancelled',updated_at:new Date().toISOString()},{onConflict:'event_id,user_id'});if(e){button.disabled=false;notify('No se pudo actualizar tu respuesta: '+e.message);}else{notify('Tu respuesta quedó registrada.','success');modal.remove();void renderHome(view);}});
}

async function renderHome(v) {
  const [activityResult, workoutResult, membershipResult, planResult, eventResult, notificationResult, exerciseResult, challengeResult] = await Promise.all([
    supabase.from('activities').select('*').order('performed_on', { ascending: false }).limit(300),
    supabase.from('workouts').select('id, kind, performed_on, duration_min, workout_sets(id, exercise_id, reps, weight_kg)').order('performed_on', { ascending: false }).limit(150),
    supabase.from('memberships').select('*').eq('period', monthStart()).order('created_at', { ascending: false }),
    supabase.from('training_plans').select('plan').eq('user_id', ctx.user.id).maybeSingle(),
    supabase.from('events').select('id,title,description,event_date,location,image_path').order('event_date'),
    supabase.from('event_notifications').select('id', { count: 'exact', head: true }).eq('user_id', ctx.user.id).eq('is_read', false),
    supabase.from('exercises').select('id,name,name_es,category').in('category', ['training', 'plyometrics']).eq('is_active', true),
    supabase.from('club_challenges').select('id,title,discipline,starts_on,ends_on').order('starts_on'),
  ]);
  const acts = activityResult.data || [];
  const ws = workoutResult.data || [];
  const mems = membershipResult.data || [];
  const plan = planResult.data?.plan || {};
  const clubEvents = eventResult.data || [];
  const challenges = challengeResult.data || [];
  const exercisesById = new Map((exerciseResult.data || []).map((exercise) => [String(exercise.id), exercise]));
  const unreadNotifications = notificationResult.count || 0;
  const calendarEvents = await Promise.all(clubEvents.map(async (event) => {
    if (!event.image_path) return { ...event, image_url: '' };
    if (event.image_path.startsWith('http')) return { ...event, image_url: event.image_path };
    const { data: image } = await supabase.storage.from('event-media').createSignedUrl(event.image_path, 3600);
    return { ...event, image_url: image?.signedUrl || '' };
  }));

  const ws0 = weekStart();
  const todayIso = today();
  const weekActs = acts.filter((item) => ctx.modules[item.discipline] && item.performed_on >= ws0 && item.performed_on <= todayIso);
  const weekWorkouts = ws.filter((item) => (item.kind === 'training' ? ctx.modules.training : item.kind === 'plyometrics' ? ctx.modules.plyo : true) && item.performed_on >= ws0 && item.performed_on <= todayIso);
  const todayDate = new Date(`${todayIso}T12:00:00`);
  const dayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const todaysPlan = ctx.modules.training ? (plan[dayLabels[todayDate.getDay()]] || []) : [];
  const todaysWorkouts = weekWorkouts.filter((item) => item.performed_on === todayIso);
  const todayCompleted = weekActs.filter((item) => item.performed_on === todayIso).length + todaysWorkouts.length;
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${ws0}T12:00:00`); date.setDate(date.getDate() + index); return date; });
  const plannedDays = weekDays.filter((date) => ctx.modules.training && (plan[dayLabels[date.getDay()]] || []).length > 0);
  const completedTrainingDates = new Set(weekWorkouts.filter((item) => item.kind === 'training').map((item) => item.performed_on));
  const completedPlannedDays = plannedDays.filter((date) => completedTrainingDates.has(iso(date))).length;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const userName = (ctx.profile?.full_name || ctx.user?.user_metadata?.full_name || ctx.user?.email || 'Atleta').trim().split(/[ @]/)[0];
  const plannedExerciseNames = todaysPlan.map((item) => exercisesById.get(String(item.exercise_id))?.name_es || exercisesById.get(String(item.exercise_id))?.name).filter(Boolean);
  const hasWeeklyPlan = Object.values(plan).some((rows) => Array.isArray(rows) && rows.length > 0);
  const planSummary = !ctx.modules.training ? 'Gimnasio no está activo para tu cuenta' : planResult.error ? 'No se pudo cargar la planificación semanal' : plannedDays.length
    ? `${completedPlannedDays} de ${plannedDays.length} días de rutina completados esta semana`
    : hasWeeklyPlan ? 'No hay rutinas configuradas para esta semana' : 'Aún no tienes rutinas semanales configuradas';
  const planError = planResult.error ? 'No se pudo cargar tu planificación semanal.' : '';
  const activityError = activityResult.error || workoutResult.error ? 'No se pudo cargar toda la actividad deportiva.' : '';
  const eventError = eventResult.error ? 'No se pudieron cargar los eventos del Club.' : '';
  const challengeError = challengeResult.error ? 'Los retos del Club no están disponibles en el calendario.' : '';
  const exerciseError = exerciseResult.error && hasWeeklyPlan ? 'No se pudieron cargar los nombres de ejercicios de tu rutina.' : '';

  const getWeeklyActivities = (discipline) => weekActs.filter((item) => item.discipline === discipline);
  const weeklyCard = (key, title, items, isDistance = false) => {
    if (!ctx.modules[key]) return '';
    if (!items.length) return `<article class="card home-week-card"><div class="home-week-card__head"><h3>${esc(title)}</h3><span class="home-week-empty">Sin registros</span></div><p class="muted">Esta semana</p></article>`;
    const duration = items.reduce((sum, item) => sum + Number(item.duration_min || 0), 0);
    const volume = isDistance ? items.reduce((sum, item) => sum + Number(item.distance_km || 0), 0) : 0;
    return `<article class="card home-week-card"><div class="home-week-card__head"><h3>${esc(title)}</h3><strong>${items.length} ${items.length === 1 ? 'sesión' : 'sesiones'}</strong></div><b class="home-week-card__metric">${isDistance && volume > 0 ? `${fmt(volume)} km` : `${items.length} ${items.length === 1 ? 'sesión' : 'sesiones'}`}</b><p class="muted">${duration > 0 ? `${fmt(duration, 0)} min de actividad · ` : ''}Semana actual</p></article>`;
  };
  const weeklyCards = [
    ...['running', 'cycling', 'swimming'].map((discipline) => weeklyCard(discipline, DISC[discipline], getWeeklyActivities(discipline), true)),
    weeklyCard('plyo', 'Pliometría', weekWorkouts.filter((item) => item.kind === 'plyometrics')),
    weeklyCard('training', 'Gimnasio', weekWorkouts.filter((item) => item.kind === 'training')),
  ].filter(Boolean);

  const recentItems = [
    ...weekActs.map((item) => ({ title: DISC[item.discipline] || 'Actividad', date: item.performed_on, route: `#${item.discipline}`, detail: [Number(item.distance_km) > 0 ? `${fmt(item.distance_km)} km` : '', Number(item.duration_min) > 0 ? `${fmt(item.duration_min, 0)} min` : '', item.discipline === 'running' && item.distance_km && item.duration_min ? `${fmt(Number(item.duration_min) / Number(item.distance_km), 1)} min/km` : '', item.run_type ? RUN_TYPE[item.run_type] : ''].filter(Boolean).join(' · ') || 'Actividad registrada' })),
    ...weekWorkouts.map((item) => ({ title: item.kind === 'plyometrics' ? 'Pliometría' : 'Gimnasio', date: item.performed_on, route: item.kind === 'plyometrics' ? '#plyo' : '#gym', detail: [item.workout_sets?.length ? `${item.workout_sets.length} series` : '', Number(item.duration_min) > 0 ? `${fmt(item.duration_min, 0)} min` : ''].filter(Boolean).join(' · ') || 'Sesión registrada' })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const currentMembership = mems[0];
  const seenKey = `batmon_membership_status_${ctx.user.id}`;
  const previousStatus = localStorage.getItem(seenKey);
  if (currentMembership?.status) localStorage.setItem(seenKey, currentMembership.status);
  const statusNotice = previousStatus && currentMembership?.status && previousStatus !== currentMembership.status && ['approved', 'rejected'].includes(currentMembership.status)
    ? `<div class="card ${currentMembership.status === 'approved' ? 'okbox' : 'warn'}">${currentMembership.status === 'approved' ? '¡Tu pago fue aprobado! Ya puedes registrar entrenamientos.' : 'Tu pago fue rechazado. Revisa el comprobante y vuelve a enviarlo desde Membresía.'}</div>` : '';
  const membershipNotice = membershipResult.error ? '<div class="card warn">No se pudo consultar el estado de tu membresía.</div>' : ctx.isAdmin ? '' : !currentMembership || currentMembership.status === 'rejected'
    ? '<div class="card warn">Aún no tienes la membresía de este mes aprobada. <a href="#perfil">Ver membresía en tu perfil</a></div>'
    : currentMembership.status === 'pending' ? '<div class="card warn">Tu pago está pendiente de aprobación.</div>' : '';
  const recentUnavailable = (activityResult.error || workoutResult.error) && !recentItems.length;
  const recentMarkup = `<details class="card home-recent"><summary><span>Actividad reciente</span><small>${recentUnavailable ? 'No disponible' : recentItems.length ? `${recentItems.length} esta semana` : 'Sin actividad esta semana'}</small></summary>${recentItems.length ? `<div class="home-recent-list">${recentItems.map((item) => `<a class="home-recent-item" href="${esc(item.route)}"><span><b>${esc(item.title)}</b><small>${esc(item.detail)}</small></span><time datetime="${esc(item.date)}">${new Date(`${item.date}T12:00:00`).toLocaleDateString('es-BO', { day: 'numeric', month: 'short' })}</time></a>`).join('')}</div>` : `<p class="muted">${recentUnavailable ? 'No se pudo cargar la actividad reciente.' : 'Tus actividades completadas aparecerán aquí.'}</p>`}</details>`;

  const todayStatus = todayCompleted ? `${todayCompleted} ${todayCompleted === 1 ? 'actividad completada' : 'actividades completadas'}` : 'sin actividades completadas';
  v.innerHTML = `<section class="home-greeting" aria-label="Resumen del día"><div class="home-greeting__title"><p>${greeting},</p><h1>${esc(userName)}</h1><span class="home-greeting__today">Hoy · ${esc(todayStatus)}${todaysPlan.length ? ` · ${todaysPlan.length} ejercicios planificados` : ''}</span></div><div class="home-compliance"><div><span>Plan semanal</span><b>${plannedDays.length ? `${completedPlannedDays} / ${plannedDays.length}` : '—'}</b></div><div class="home-compliance__track" role="progressbar" aria-label="Cumplimiento de rutinas semanales" aria-valuemin="0" aria-valuemax="${plannedDays.length || 1}" aria-valuenow="${completedPlannedDays}"><i style="width:${plannedDays.length ? completedPlannedDays / plannedDays.length * 100 : 0}%"></i></div><small>${esc(planSummary)}</small></div></section>
    ${buildUnifiedCalendar()}${statusNotice}${membershipNotice}
    <section class="card rest-card">
      <div class="cal-rest-halo"><div class="cal-halo-ring"><div class="cal-halo-core"></div></div></div>
      <h2 class="cal-rest-title">Descansa, ${esc(userName)}</h2>
      <p class="cal-rest-desc">La recuperación ayuda al éxito, ¡así que disfruta de tu descanso!</p>
      <a href="${ctx.modules.running ? '#running' : '#training'}" class="btn cal-btn-primary"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right:6px;"><path d="M8 5v14l11-7z"/></svg>Registrar entrenamiento</a>
    </section>
    ${weeklyCards.length ? `<section class="home-weekly"><div class="home-section-heading"><div><span class="muted">Resumen</span><h2>Esta semana</h2></div><small>${weekActs.length + weekWorkouts.length} ${weekActs.length + weekWorkouts.length === 1 ? 'actividad' : 'actividades'}</small></div>${activityError ? '<p class="muted">Métricas semanales no disponibles.</p>' : `<div class="home-week-grid">${weeklyCards.join('')}</div>`}</section>` : ''}
    <section class="home-recent-section"><h2>Lo que ya hiciste</h2>${recentMarkup}</section>`;

  setupUnifiedCalendar(v, calendarEvents, { plan, exercisesById, activities: acts, workouts: ws, challenges, modules: ctx.modules, errors: { plan: planError, exercises: exerciseError, activities: activityError, events: eventError, challenges: challengeError } });
  const eventBell=v.querySelector('#cal10-bell');
  if(eventBell){eventBell.setAttribute('aria-label',`Abrir calendario completo${unreadNotifications?`; ${unreadNotifications} notificaciones sin leer`:''}`);eventBell.insertAdjacentHTML('beforeend',`<span class="cal10__bell-badge">${unreadNotifications||0}</span>`);}
  clearTimeout(homeDayTimer);
  const nextMidnight = new Date();
  nextMidnight.setHours(24, 0, 5, 0);
  homeDayTimer = setTimeout(() => {
    if (ctx && (location.hash.slice(1) || 'inicio') === 'inicio') renderHome(v);
  }, nextMidnight - Date.now());
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
  decorateBackButton($('#membership-back',v));
  $('#membership-back',v).onclick=()=>renderProfile(v);
  if (!canPay) return;
  const openModal=(html)=>{const modal=document.createElement('div');modal.className='modal payment-modal';modal.innerHTML=`<section class="sheet payment-sheet" role="dialog" aria-modal="true">${html}</section>`;decorateBackButton(modal.querySelector('[data-payment-close]'),'Cerrar',true);modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-payment-close]'))modal.remove();});document.body.append(modal);return modal;};
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
  const moduleActivities = activities.filter(a=>selectedModule==='all'||a.discipline===selectedModule);
  const moduleWorkouts = workouts.filter(w=>selectedModule==='all'||(selectedModule==='plyo'&&w.kind==='plyometrics')||(selectedModule==='training'&&w.kind==='training'));
  const range = period === 'day' ? 1 : period === 'month' ? 30 : 7;
  const from = new Date(todayDate); from.setDate(from.getDate() - range + 1);
  const dateKey = d => new Date(d).toISOString().slice(0,10);
  const days = Array.from({length: period === 'week' ? 7 : period === 'day' ? 1 : 30}, (_, i) => { const d = new Date(from); d.setDate(d.getDate()+i); return dateKey(d); });
  const values = days.map(d => moduleActivities.filter(a => a.performed_on === d).length + moduleWorkouts.filter(w => w.performed_on === d).length);
  const max = Math.max(1, ...values);
  const km = activities.reduce((s,a)=>s+Number(a.distance_km||0),0);
  const initials = (ctx.profile?.full_name || 'BC').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const counts = selectedModule==='all'?{workouts:activities.length+workouts.length,km}:{workouts:workouts.filter(w=>selectedModule==='plyo'?w.kind==='plyometrics':selectedModule==='training'?w.kind==='training':false).length+activities.filter(a=>a.discipline===selectedModule).length,km:activities.filter(a=>a.discipline===selectedModule).reduce((s,a)=>s+Number(a.distance_km),0)};
  const friends = friendships.filter(f=>f.status==='accepted').length;
  const moduleData = [['running','Running','running.png'],['cycling','Ciclismo','cycling.png'],['plyo','Pliometría','plyo.png'],['training','Gym','training.png'],['swimming','Natación','swimming.png']];
  const pendingRequests = friendships.filter(f=>f.status==='pending'&&f.addressee===ctx.user.id).length;
  v.innerHTML = `<section class="profile-page"><header class="profile-hero"><label for="avatar-file" class="profile-avatar">${avatarData?.signedUrl?`<img src="${avatarData.signedUrl}" alt="Foto de perfil">`:initials}<input hidden id="avatar-file" type="file" accept="image/*"></label><div class="profile-identity"><h1>${esc(ctx.profile?.full_name || 'Socio Batmon')}</h1><span>${esc(ctx.profile?.contact_email || '')}</span></div><div class="profile-tools"><button id="notifications-open" class="notifications-open" aria-label="Abrir notificaciones" title="Notificaciones"><svg viewBox="0 0 448 512" class="bell" aria-hidden="true"><path d="M224 0c-17.7 0-32 14.3-32 32V49.9C119.5 61.4 64 124.2 64 200v33.4c0 45.4-15.5 89.5-43.8 124.9L5.3 377c-5.8 7.2-6.9 17.1-2.9 25.4S14.8 416 24 416H424c9.2 0 17.6-5.3 21.6-13.6s2.9-18.2-2.9-25.4l-14.9-18.6C399.5 322.9 384 278.8 384 233.4V200c0-75.8-55.5-138.6-128-150.1V32c0-17.7-14.3-32-32-32zm0 96h8c57.4 0 104 46.6 104 104v33.4c0 47.9 13.9 94.6 39.7 134.6H72.3C98.1 328 112 281.3 112 233.4V200c0-57.4 46.6-104 104-104h8zm64 352H224 160c0 17 6.7 33.3 18.7 45.3s28.3 18.7 45.3 18.7s33.3-6.7 45.3-18.7s18.7-28.3 18.7-45.3z"/></svg>${pendingRequests?`<span class="notification-badge">${pendingRequests}</span>`:''}</button><button id="settings-open" class="settings-hamburger" aria-label="Abrir configuración"><span class="line1"></span><span class="line2"></span><span class="line3"></span></button></div></header>
    <div class="profile-counts"><div><b>${counts.workouts}</b><span>Entrenos</span></div><div><b>${fmt(counts.km,0)}</b><span>Km</span></div><div><b>${friends}</b><span>Amigos</span></div></div>
    <div class="profile-actions"><button id="edit-profile" class="btn ghost">Editar perfil</button><button id="membership-open" class="btn ghost">Membresía</button></div>
    <nav class="profile-highlights" aria-label="Accesos a entrenamientos">${moduleData.map(([id,title,img])=>`<button data-module="${id}" class="module-highlight module-${id} ${selectedModule===id?'selected':''}"><span><img src="/profile-modules/${img}" alt=""></span><small>${title}</small></button>`).join('')}</nav>
    <nav class="profile-media-tabs" aria-label="Fotos, videos y progreso"><button data-media="posts" class="${mediaView==='posts'?'on':''}">▦ <span>Fotos</span></button><button data-media="videos" class="${mediaView==='videos'?'on':''}">▷ <span>Videos</span></button><button data-media="progress" class="${mediaView==='progress'?'on':''}">▥ <span>Progreso</span></button></nav>
    ${mediaView==='progress'?`<section class="card profile-chart"><div class="profile-section-head"><div><span class="muted">${selectedModule==='all'?'Todos tus módulos':DISC[selectedModule]|| (selectedModule==='plyo'?'Pliometría':'Entrenamiento')}</span><h2>Actividad</h2></div><div class="period-switch">${[['day','Día'],['week','Semana'],['month','Mes']].map(([k,t])=>`<button data-period="${k}" class="${period===k?'on':''}">${t}</button>`).join('')}</div></div><div class="profile-bars">${values.map((n,i)=>`<div><i style="height:${Math.max(4,n/max*100)}%"></i><small>${period==='month'?(i+1):days[i].slice(8)}</small></div>`).join('')}</div><p class="muted">Sesiones registradas por día</p><button id="measurement-open" class="btn ghost">Añadir medidas corporales</button></section>`:mediaView==='videos'?'<div class="profile-empty">Aún no hay videos de entrenamiento.</div>':`<div class="profile-post-grid">${[...moduleActivities.map(a=>({date:a.performed_on,title:DISC[a.discipline],detail:`${fmt(a.distance_km)} km`})),...moduleWorkouts.map(w=>({date:w.performed_on,title:w.kind==='training'?'Entrenamiento':'Pliometría',detail:`${w.workout_sets.length} series`}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,18).map(a=>`<article><b>${esc(a.title)}</b><span>${a.detail}</span><small>${a.date}</small></article>`).join('')||'<div class="profile-empty">Tus entrenamientos aparecerán aquí.</div>'}</div>`}</section>`;
  $('#avatar-file',v).onchange=async e=>{const f=e.target.files[0];if(!f)return;const path=`${ctx.user.id}/avatar-${Date.now()}.${f.name.split('.').pop()}`;const up=await supabase.storage.from('profile-media').upload(path,f,{upsert:true});if(up.error){notify(up.error.message);return;}const {error}=await supabase.from('profiles').update({avatar_path:path}).eq('id',ctx.user.id);if(error)notify(error.message);else{ctx.profile.avatar_path=path;renderProfile(v);}};
  $('#settings-open',v).onclick=e=>{const button=e.currentTarget;button.classList.add('is-opening');button.disabled=true;setTimeout(()=>renderProfileSettings(v),320);};
  $('#notifications-open',v).onclick=()=>renderNotifications(v);
  v.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{localStorage.setItem(moduleKey,b.dataset.module);renderProfile(v);});
  v.querySelectorAll('[data-media]').forEach(b=>b.onclick=()=>{localStorage.setItem(mediaKey,b.dataset.media);renderProfile(v);});
  v.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{localStorage.setItem(key,b.dataset.period);renderProfile(v);});
  $('#membership-open',v).onclick=()=>renderMembership(v);
  $('#edit-profile',v).onclick=()=>{v.innerHTML=`<h1>Editar perfil</h1><form id="profile-form" class="card"><label for="profile-name">Nombre</label><input id="profile-name" value="${esc(ctx.profile?.full_name||'')}" required><button class="btn">Guardar</button><p class="msg" id="profile-msg"></p></form>`;$('#profile-form',v).onsubmit=async e=>{e.preventDefault();const name=$('#profile-name',v).value.trim();const {error}=await supabase.from('profiles').update({full_name:name}).eq('id',ctx.user.id);if(error)$('#profile-msg',v).textContent=error.message;else{ctx.profile.full_name=name;renderProfile(v);}};};
}

async function renderNotifications(v) {
  v.innerHTML='<section class="community-notifications"><button class="link" id="notifications-back">← Volver al perfil</button><h1>Notificaciones</h1><p class="muted">Novedades y actividad de tu comunidad.</p><div id="notifications-list" class="notifications-list"><p class="muted">Cargando notificaciones…</p></div></section>';
  decorateBackButton($('#notifications-back',v));
  $('#notifications-back',v).onclick=()=>renderProfile(v);
  const list=$('#notifications-list',v);
  const [{data:friendships=[],error:friendError},{data:directory=[],error:directoryError}]=await Promise.all([
    supabase.from('friendships').select('id,requester,addressee,status,created_at').or(`requester.eq.${ctx.user.id},addressee.eq.${ctx.user.id}`).order('created_at',{ascending:false}),
    supabase.rpc('profile_directory'),
  ]);
  if(friendError||directoryError){list.innerHTML='<div class="card profile-empty">No se pudieron cargar las notificaciones. Inténtalo de nuevo.</div>';return;}
  const people=new Map(directory.map(p=>[p.id,p.full_name||'Socio Batmon']));
  const requests=friendships.filter(f=>f.status==='pending'&&f.addressee===ctx.user.id);
  const friendIds=friendships.filter(f=>f.status==='accepted').map(f=>f.requester===ctx.user.id?f.addressee:f.requester);
  let posts=[];
  if(friendIds.length){const result=await supabase.from('profile_posts').select('id,user_id,module_key,media_type,caption,created_at').in('user_id',friendIds).order('created_at',{ascending:false}).limit(30);posts=result.data||[];}
  const requestCards=requests.map(f=>`<article class="card notification-card"><span class="notification-kind">Solicitud de amistad</span><b>${esc(people.get(f.requester)||'Un socio')}</b><p>Quiere conectar contigo en la comunidad.</p><button class="btn sm" type="button" data-accept-request="${f.id}">Aceptar solicitud</button></article>`);
  const postCards=posts.map(p=>`<article class="card notification-card"><span class="notification-kind">${p.media_type==='video'?'Nuevo video':'Nueva foto'} · ${esc(p.module_key)}</span><b>${esc(people.get(p.user_id)||'Un socio')}</b><p>${esc(p.caption||'Compartió una publicación con la comunidad.')}</p><small>${new Date(p.created_at).toLocaleDateString('es-BO',{day:'numeric',month:'long'})}</small></article>`);
  list.innerHTML=requestCards.concat(postCards).join('')||'<div class="card profile-empty">Aún no hay novedades de tu comunidad.</div>';
  list.querySelectorAll('[data-accept-request]').forEach(button=>button.onclick=async()=>{button.disabled=true;const {error}=await supabase.from('friendships').update({status:'accepted'}).eq('id',button.dataset.acceptRequest).eq('addressee',ctx.user.id);if(error){button.disabled=false;notify('No se pudo aceptar la solicitud: '+error.message);return;}notify('Solicitud aceptada.');await renderNotifications(v);});
}

function renderMyData(v) {
  const pf=ctx.profile||{};const at=x=>esc(x||'');
  v.innerHTML=`<div class="profile-settings"><button class="link" id="my-data-back">← Volver a Configuración</button><h1>Mis datos</h1><form id="account-data-form" class="card account-login-settings"><h2>Datos personales</h2><label for="ad-name">Nombre completo</label><input id="ad-name" value="${at(pf.full_name)}" maxlength="100" required><label for="ad-user">Usuario</label><input id="ad-user" value="${at(pf.username)}" minlength="3" maxlength="24" pattern="[a-zA-Z0-9_.-]{3,24}" autocomplete="username" required><label for="ad-carnet">Carnet</label><input id="ad-carnet" value="${at(pf.carnet_number)}" maxlength="32" required><label for="ad-phone">Teléfono (8 dígitos, para recuperar contraseña)</label><input id="ad-phone" value="${at(pf.recovery_phone)}" inputmode="numeric" maxlength="8" pattern="[0-9]{8}" required><label for="ad-mail">Correo de contacto (opcional)</label><input id="ad-mail" type="email" value="${at(pf.contact_email)}"><button class="btn ghost" type="submit">Guardar datos</button><p class="msg" id="ad-msg" aria-live="polite"></p></form><form id="account-pass-form" class="card account-login-settings"><h2>Cambiar contraseña</h2><label for="ap-new">Nueva contraseña</label><input id="ap-new" type="password" minlength="8" autocomplete="new-password" placeholder="Al menos 8 caracteres" required><button class="btn ghost" type="submit">Cambiar contraseña</button><p class="msg" id="ap-msg" aria-live="polite"></p></form></div>`;
  decorateBackButton($('#my-data-back',v));
  $('#my-data-back',v).onclick=()=>renderProfileSettings(v);
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
}

function renderProfileSettings(v) {
  const saved=localStorage.getItem(`batmon_theme_${ctx.user.id}`)||'light';
  const forced=ctx.themePolicy!=='choice';
  const isDark=(forced?ctx.themePolicy:saved)==='dark';
  v.innerHTML=`<div class="profile-settings"><button class="link" id="settings-back">← Volver al perfil</button><h1>Configuración</h1><section class="theme-preference"><h2 class="theme-setting-title">Tema</h2><label class="theme-switch" aria-label="Cambiar entre tema claro de día y tema oscuro de noche"><input id="user-theme" class="theme-switch__checkbox" type="checkbox" ${isDark?'checked':''} ${forced?'disabled':''}><span class="theme-switch__container" aria-hidden="true"><span class="theme-switch__clouds"></span><span class="theme-switch__stars-container"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 55" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M135.831 3.00688C135.055 3.85027 134.111 4.29946 133 4.35447C134.111 4.40947 135.055 4.85867 135.831 5.71123C136.607 6.55462 136.996 7.56303 136.996 8.72727C136.996 7.95722 137.172 7.25134 137.525 6.59129C137.886 5.93124 138.372 5.39954 138.98 5.00535C139.598 4.60199 140.268 4.39114 141 4.35447C139.88 4.2903 138.936 3.85027 138.16 3.00688C137.384 2.16348 136.996 1.16425 136.996 0C136.996 1.16425 136.607 2.16348 135.831 3.00688ZM31 23.3545C32.1114 23.2995 33.0551 22.8503 33.8313 22.0069C34.6075 21.1635 34.9956 20.1642 34.9956 19C34.9956 20.1642 35.3837 21.1635 36.1599 22.0069C36.9361 22.8503 37.8798 23.2903 39 23.3545C38.2679 23.3911 37.5976 23.602 36.9802 24.0053C36.3716 24.3995 35.8864 24.9312 35.5248 25.5913C35.172 26.2513 34.9956 26.9572 34.9956 27.7273C34.9956 26.563 34.6075 25.5546 33.8313 24.7112C33.0551 23.8587 32.1114 23.4095 31 23.3545ZM0 36.3545C1.11136 36.2995 2.05513 35.8503 2.83131 35.0069C3.6075 34.1635 3.99559 33.1642 3.99559 32C3.99559 33.1642 4.38368 34.1635 5.15987 35.0069C5.93605 35.8503 6.87982 36.2903 8 36.3545C7.26792 36.3911 6.59757 36.602 5.98015 37.0053C5.37155 37.3995 4.88644 37.9312 4.52481 38.5913C4.172 39.2513 3.99559 39.9572 3.99559 40.7273C3.99559 39.563 3.6075 38.5546 2.83131 37.7112C2.05513 36.8587 1.11136 36.4095 0 36.3545ZM56.8313 24.0069C56.0551 24.8503 55.1114 25.2995 54 25.3545C55.1114 25.4095 56.0551 25.8587 56.8313 26.7112C57.6075 27.5546 57.9956 28.563 57.9956 29.7273C57.9956 28.9572 58.172 28.2513 58.5248 27.5913C58.8864 26.9312 59.3716 26.3995 59.9802 26.0053C60.5976 25.602 61.2679 25.3911 62 25.3545C60.8798 25.2903 59.9361 24.8503 59.1599 24.0069C58.3837 23.1635 57.9956 22.1642 57.9956 21C57.9956 22.1642 58.3837 23.1635 59.1599 24.0069C59.9361 24.8503 60.8798 25.2903 62 25.3545ZM81 25.3545C82.1114 25.2995 83.0551 24.8503 83.8313 24.0069C84.6075 23.1635 84.9956 22.1642 84.9956 21C84.9956 22.1642 85.3837 23.1635 86.1599 24.0069C86.9361 24.8503 87.8798 25.2903 89 25.3545C88.2679 25.3911 87.5976 25.602 86.9802 26.0053C86.3716 26.3995 85.8864 26.9312 85.5248 27.5913C85.172 28.2513 84.9956 28.9572 84.9956 29.7273C84.9956 28.563 85.172 28.2513 85.5248 27.5913ZM136 36.3545C137.111 36.2995 138.055 35.8503 138.831 35.0069C139.607 34.1635 139.996 33.1642 139.996 32C139.996 33.1642 140.384 34.1635 141.16 35.0069C141.936 35.8503 142.88 36.2903 144 36.3545C143.268 36.3911 142.598 36.602 141.98 37.0053C141.372 37.3995 140.886 37.9312 140.525 38.5913C140.172 39.2513 139.996 39.9572 139.996 40.7273C139.996 39.563 139.607 38.5546 138.831 37.7112C138.055 36.8587 137.111 36.4095 136 36.3545ZM101.831 49.0069C101.055 49.8503 100.111 50.2995 99 50.3545C100.111 50.4095 101.055 50.8587 101.831 51.7112C102.607 52.5546 102.996 53.563 102.996 54.7273C102.996 53.9572 103.172 53.2513 103.525 52.5913C103.886 51.9312 104.372 51.3995 104.98 51.0053C105.598 50.602 106.268 50.3911 107 50.3545C105.88 50.2903 104.936 49.8503 104.16 49.0069C103.384 48.1635 102.996 47.1642 102.996 46C102.996 47.1642 102.607 48.1635 101.831 49.0069Z" fill="currentColor"/></svg></span><span class="theme-switch__circle-container"><span class="theme-switch__sun-moon-container"><span class="theme-switch__moon"><i class="theme-switch__spot"></i><i class="theme-switch__spot"></i><i class="theme-switch__spot"></i></span></span></span></span></label></section>${ctx.isAdmin?'<a class="btn ghost settings-admin" href="/admin.html">Administración</a>':''}<button id="settings-logout" class="btn ghost settings-logout">Cerrar sesión</button></div>`;
  decorateBackButton($('#settings-back',v));
  $('#settings-back',v).onclick=()=>renderProfile(v);
  $('#user-theme',v).onchange=e=>{const theme=e.target.checked?'dark':'light';localStorage.setItem(`batmon_theme_${ctx.user.id}`,theme);applyTheme(theme);};
  const dataButton=document.createElement('button');dataButton.type='button';dataButton.id='settings-my-data';dataButton.className='btn ghost settings-my-data';dataButton.textContent='Mis datos';
  $('h1',v).insertAdjacentElement('afterend',dataButton);
  dataButton.onclick=()=>renderMyData(v);
  $('#settings-logout',v).onclick=async()=>{if(window.confirm('¿Seguro que quieres cerrar sesión?')) await supabase.auth.signOut();};
}

/* ---------------- Arranque: sesión persistente ---------------- */
$('#tabs').innerHTML = TABS.map(([h, t, icon]) => `<a href="#${h}" aria-label="${t}" aria-current="false"><span class="tab-icon">${icon}</span><span class="tab-label">${t}</span></a>`).join('');
window.addEventListener('hashchange', route);
enablePasswordToggles(view);
let booted = null;
supabase.auth.onAuthStateChange((_ev, session) => {
  if (!session) { booted = null; ctx = null; showLogin(view); return; }
  if (booted !== session.user.id) { booted = session.user.id; boot(session.user); }  // evita recargar en cada refresh de token
});
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) showNewPassword();
});
void today;
