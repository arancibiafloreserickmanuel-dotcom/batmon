// Interfaz de los cuestionarios y planes: Running y Pliometría (datos compartidos entre ambos).
import { esc } from '../supabase.js';
import {
  DAYS, RUN_GOALS, PLYO_GOALS, SCIENCE, loadAthlete, saveAthlete, loadRunPlan, saveRunPlan, buildRunPlan, buildPlyoPlan, reassignPlan, planWeekIndex,
  plyoWeekIndex, hrMax, hrRange, hasHealthFlag, jointFlag, sharedDataComplete, whenLabel, sessionLine, runLevel, plyoLevel, dayName,
} from './coach.js';

const LEVEL_ES = { novice: 'Principiante', base: 'Intermedio', intermediate: 'Avanzado', advanced: 'Avanzado' };
const PLYO_LEVEL_ES = { novice: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado' };
const HEALTH_Q = [
  '¿Un médico te dijo que tienes un problema del corazón o la presión alta?',
  '¿Sientes dolor en el pecho al hacer actividad física o en reposo?',
  '¿Has perdido el equilibrio por mareos o el conocimiento en los últimos 12 meses?',
  '¿Tienes un problema de huesos o articulaciones (rodilla, tobillo, cadera, espalda) que empeora con el ejercicio?',
  '¿Tomas medicamentos para la presión o el corazón?',
  '¿Estás embarazada o diste a luz en los últimos 6 meses?',
  '¿Hay otra razón por la que un médico te haya dicho que no hagas ejercicio?',
];

/* ---------- utilidades ---------- */
const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, path, v) {
  const ks = path.split('.'); let a = o;
  ks.slice(0, -1).forEach((k, i) => { if (a[k] == null || typeof a[k] !== 'object') a[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[k]; });
  a[ks.at(-1)] = v;
}
const sheet = (html) => {
  const m = document.createElement('div'); m.className = 'modal coach-modal';
  m.innerHTML = `<div class="sheet coach-sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m) m.remove(); });
  document.body.appendChild(m); return m;
};
const chip = (key, v, label, on, extra = '') => `<button type="button" class="pd-chip${on ? ' on' : ''}" data-ch="${key}" data-v="${esc(String(v))}" ${extra}>${esc(label)}</button>`;
const num = (label, key, d, o = {}) => `<label class="cf">${esc(label)}<input type="number" inputmode="decimal" data-k="${key}" data-num="1" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} step="${o.step || 'any'}" value="${getP(d, key) ?? ''}" placeholder="${esc(o.ph || '')}"></label>`;
const when = (day, d, pre) => `<div class="cf-when"><b>${day}</b><input type="time" data-k="${pre}.schedule.${day}.time" value="${esc(getP(d, `${pre}.schedule.${day}.time`) || '')}" aria-label="Hora ${day}"><input type="text" maxlength="40" data-k="${pre}.schedule.${day}.after" value="${esc(getP(d, `${pre}.schedule.${day}.after`) || '')}" placeholder="o: después de… (trabajo, clases)" aria-label="Después de, ${day}"></div>`;
const daysChips = (key, d, multi = true) => `<div class="pd-chips">${DAYS.map((x) => chip(key, x, x.slice(0, 3), (getP(d, key) || []).includes(x), multi ? 'data-multi="1"' : '')).join('')}</div>`;

// Asistente genérico por pasos.
function wizard({ title, data, steps, finishLabel, onFinish }) {
  const ui = {}; let i = 0; let busy = false;
  const m = sheet('');
  const root = m.querySelector('.sheet');
  const draw = () => {
    const st = steps[i];
    root.innerHTML = `<div class="sheet-h"><b>${esc(title)}</b><button class="link" data-close type="button">Cerrar</button></div>
      <div class="cw-bar" aria-label="Paso ${i + 1} de ${steps.length}"><i style="width:${((i + 1) / steps.length) * 100}%"></i></div>
      <p class="cw-step muted">Paso ${i + 1} de ${steps.length} · ${esc(st.title)}</p>
      <div class="cw-body">${st.intro ? `<p class="cw-intro">${st.intro}</p>` : ''}${st.html(data, ui)}</div>
      <p class="msg" id="cw-msg" role="alert"></p>
      <div class="cw-nav">${i > 0 ? '<button type="button" class="btn ghost" data-back>Atrás</button>' : '<span></span>'}<button type="button" class="btn" data-next>${i === steps.length - 1 ? esc(finishLabel) : 'Siguiente'}</button></div>`;
    root.querySelector('[data-close]').onclick = () => m.remove();
    root.querySelectorAll('input[data-k]').forEach((el) => (el.oninput = () => { const v = el.dataset.num ? (el.value === '' ? '' : Number(el.value)) : el.value; setP(data, el.dataset.k, v); }));
    root.querySelectorAll('[data-ch]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.ch; let v = b.dataset.v; if (b.dataset.bool) v = v === '1'; else if (b.dataset.n) v = Number(v);
      if (b.dataset.tog) setP(data, k, !getP(data, k));
      else if (b.dataset.multi) { const a = [...(getP(data, k) || [])]; const ix = a.indexOf(v); if (ix >= 0) a.splice(ix, 1); else a.push(v); setP(data, k, a); }
      else setP(data, k, v);
      st.change?.(data, k); draw();
    }));
    root.querySelectorAll('[data-ui]').forEach((b) => (b.onclick = () => { ui[b.dataset.ui] = !ui[b.dataset.ui]; draw(); }));
    root.querySelector('[data-back]')?.addEventListener('click', () => { i -= 1; draw(); root.scrollTop = 0; });
    root.querySelector('[data-next]').onclick = async () => {
      const msg = st.valid?.(data); if (msg) { root.querySelector('#cw-msg').textContent = msg; return; }
      if (i < steps.length - 1) { i += 1; draw(); root.scrollTop = 0; return; }
      if (busy) return; busy = true; root.querySelector('[data-next]').disabled = true;
      const err = await onFinish(data, () => m.remove()); busy = false;
      if (err) { root.querySelector('#cw-msg').textContent = err; root.querySelector('[data-next]').disabled = false; }
    };
    st.after?.(root, data, draw);
  };
  draw(); return m;
}

/* ---------- pasos compartidos ---------- */
const stepDatos = {
  title: 'Tus datos',
  intro: 'Estos datos se guardan una sola vez y los usan Running y Pliometría.',
  html: (d, ui) => (sharedDataComplete(d) && !ui.editDatos
    ? `<div class="cw-saved"><p>✔ Datos ya registrados</p><ul><li>Edad: <b>${d.age} años</b></li><li>Sexo: <b>${({ m: 'Hombre', f: 'Mujer', x: 'Prefiero no decir' })[d.sex]}</b></li><li>Peso: <b>${d.weight_kg} kg</b></li><li>Estatura: <b>${d.height_cm} cm</b></li></ul><button type="button" class="btn ghost" data-ui="editDatos">Editar datos</button></div>`
    : `<div class="cw-grid">${num('Edad (años)', 'age', d, { min: 12, max: 90 })}${num('Peso (kg)', 'weight_kg', d, { min: 30, max: 250, step: 0.1 })}${num('Estatura (cm)', 'height_cm', d, { min: 120, max: 230 })}</div>
      <p class="cw-l">Sexo</p><div class="pd-chips">${[['m', 'Hombre'], ['f', 'Mujer'], ['x', 'Prefiero no decir']].map(([v, l]) => chip('sex', v, l, d.sex === v)).join('')}</div>`),
  valid: (d) => (!d.age || d.age < 12 || d.age > 90 ? 'Escribe tu edad (12–90).' : !d.weight_kg || d.weight_kg < 30 ? 'Escribe tu peso en kg.' : !d.height_cm || d.height_cm < 120 ? 'Escribe tu estatura en cm.' : !d.sex ? 'Elige una opción de sexo.' : ''),
};
const stepSalud = {
  title: 'Salud',
  intro: 'Preguntas de seguridad antes de hacer ejercicio (basadas en el PAR-Q). Responde con sinceridad.',
  html: (d, ui) => {
    const q = d.health?.q || [];
    if (d.health?.done && !ui.editSalud) {
      return `<div class="cw-saved"><p>${hasHealthFlag(d) ? '⚠ Respondiste “Sí” en alguna pregunta' : '✔ Sin alertas de salud'}</p>${d.health.injuries ? `<p class="muted">Lesiones: ${esc(d.health.injuries)}</p>` : ''}<button type="button" class="btn ghost" data-ui="editSalud">Editar respuestas</button></div>`;
    }
    return `${HEALTH_Q.map((t, n) => `<div class="cw-q"><p>${esc(t)}</p><div class="pd-chips">${chip(`health.q.${n}`, 1, 'Sí', q[n] === true, 'data-bool="1"')}${chip(`health.q.${n}`, 0, 'No', q[n] === false, 'data-bool="1"')}</div></div>`).join('')}
      <label class="cf">Lesiones o molestias actuales (opcional)<input type="text" maxlength="120" data-k="health.injuries" value="${esc(d.health?.injuries || '')}" placeholder="Ej: rodilla derecha"></label>`;
  },
  valid: (d) => { const q = d.health?.q || []; if (d.health?.done && q.length === HEALTH_Q.length) return ''; if (HEALTH_Q.some((_, n) => typeof q[n] !== 'boolean')) return 'Responde todas las preguntas.'; d.health.done = true; return ''; },
};
const summaryBox = (title, rows, extra = '') => `<div class="cw-sum"><h4>${esc(title)}</h4>${rows.map(([a, b]) => `<p><span>${esc(a)}</span><b>${b}</b></p>`).join('')}${extra}</div>`;
const sciBlock = (key) => `<details class="cw-sci"><summary>Base científica de este plan</summary><ul>${SCIENCE[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
const healthWarn = (d) => (hasHealthFlag(d) ? '<p class="cw-warn">⚠ Marcaste alguna alerta de salud. Antes de empezar consulta a tu médico. El plan se armó más conservador.</p>' : '');
const disclaimer = '<p class="cw-note">Este plan es orientativo y no reemplaza a un profesional de la salud. Si sientes dolor, mareo o falta de aire, detente.</p>';

/* ---------- RUNNING ---------- */
function runSteps(existing) {
  return [
    stepDatos, stepSalud,
    {
      title: 'Experiencia', intro: 'Así ajusto el punto de partida.',
      html: (d) => `<p class="cw-l">¿Cuánto corres hoy?</p><div class="cw-opts">${[['none', 'Nunca he corrido o hace más de un año'], ['some', 'Troto de vez en cuando (menos de 10 km por semana)'], ['regular', 'Corro con regularidad (10–25 km por semana)'], ['high', 'Corro mucho (más de 25 km por semana)']].map(([v, l]) => chip('running.experience', v, l, d.running?.experience === v)).join('')}</div>
        ${['regular', 'high'].includes(d.running?.experience) ? `<div class="cw-grid">${num('Km por semana', 'running.weekly_km', d, { min: 5, max: 150 })}${num('Tirada más larga (km)', 'running.longest_km', d, { min: 1, max: 60 })}</div>` : ''}
        ${['some', 'regular', 'high'].includes(d.running?.experience) ? `<div class="cw-grid">${num('Tu mejor 5 km reciente (min, opcional)', 'running.recent_5k_min', d, { min: 12, max: 90, ph: 'Ej: 30' })}</div>` : ''}`,
      valid: (d) => (!d.running?.experience ? 'Elige tu nivel actual.' : ''),
    },
    {
      title: 'Objetivo', intro: 'Elige para qué te preparas.',
      html: (d) => `<div class="cw-opts">${Object.entries(RUN_GOALS).map(([v, g]) => chip('rp.goal', v, g.label, d.rp?.goal === v)).join('')}</div>
        ${d.rp?.goal && d.rp.goal !== 'start' ? `<div class="cw-grid"><label class="cf">Fecha de la carrera (opcional)<input type="date" data-k="rp.raceDate" value="${esc(d.rp?.raceDate || '')}"></label><label class="cf">Nombre de la carrera (opcional)<input type="text" maxlength="60" data-k="rp.raceName" value="${esc(d.rp?.raceName || '')}" placeholder="Ej: Media de Sucre"></label></div><p class="cw-note">Si pones la fecha, el plan se ajusta a las semanas que faltan.</p>` : ''}`,
      valid: (d) => (!d.rp?.goal ? 'Elige un objetivo.' : ''),
    },
    {
      title: 'Tu semana', intro: 'Elige los días que vas a correr y, si quieres, a qué hora o después de qué actividad.',
      html: (d) => { const sel = d.rp?.days || []; return `<p class="cw-l">Días de entrenamiento (2 a 6)</p>${daysChips('rp.days', d)}
        ${sel.length ? `<p class="cw-l">Día de la tirada larga / carrera</p><div class="pd-chips">${sel.map((x) => chip('rp.longDay', x, x.slice(0, 3), (d.rp?.longDay || sel[sel.length - 1]) === x)).join('')}</div>
        <p class="cw-l">Horario (opcional)</p>${[...sel].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((x) => when(x, d, 'rp')).join('')}` : ''}`; },
      change: (d, k) => { if (k === 'rp.days' && d.rp.longDay && !d.rp.days.includes(d.rp.longDay)) d.rp.longDay = ''; },
      valid: (d) => ((d.rp?.days || []).length < 2 ? 'Elige al menos 2 días.' : (d.rp.days.length > 6 ? 'Elige máximo 6 días (necesitas descanso).' : '')),
    },
    {
      title: 'Tu plan', intro: '',
      html: (d) => {
        const plan = buildRunPlan(d, { goal: d.rp.goal, days: d.rp.days, longDay: d.rp.longDay, raceDate: d.rp.raceDate, raceName: d.rp.raceName, schedule: d.rp.schedule || {} });
        d._plan = plan; const w1 = plan.weeks[0];
        return `${healthWarn(d)}${plan.warning ? `<p class="cw-warn">${esc(plan.warning)}</p>` : ''}
          ${summaryBox(plan.goalLabel, [['Nivel de partida', LEVEL_ES[plan.level]], ['Duración', `${plan.weeks.length} semanas`], ['Comienza', new Date(`${plan.startDate}T12:00:00`).toLocaleDateString('es-BO', { day: 'numeric', month: 'long' })], ['Días por semana', plan.days.length], ['FC máxima estimada', `${hrMax(d.age)} lpm`], ['Ritmo fácil (FC)', hrRange(d.age, 0.64, 0.76)]])}
          <h4 class="cw-h">Semana 1 · ${esc(w1.phase)}</h4>${w1.sessions.map((s) => `<div class="cw-sess"><b>${s.day}</b><span>${esc(s.title)}</span><small>${esc(sessionLine(s))}</small></div>`).join('')}
          ${sciBlock('running')}${disclaimer}`;
      },
    },
  ];
}

export async function openRunWizard(ctx, onDone) {
  const athlete = await loadAthlete(ctx.user.id);
  const data = JSON.parse(JSON.stringify(athlete)); data.rp ||= {}; data.health ||= { q: [], injuries: '' }; data.running ||= {};
  wizard({
    title: 'Preparar mi carrera', data, steps: runSteps(), finishLabel: 'Guardar plan',
    onFinish: async (d, close) => {
      const plan = d._plan; delete d._plan; d.rp.schedule = d.rp.schedule || {};
      const e1 = await saveAthlete(ctx.user.id, d); if (e1) return 'No se pudieron guardar tus datos: ' + e1.message;
      const e2 = await saveRunPlan(ctx.user.id, plan); if (e2) return 'No se pudo guardar el plan: ' + e2.message;
      close(); onDone?.();
    },
  });
}

/* ---------- editor de la semana de running (días y horario) ---------- */
function openRunWeekEditor(ctx, plan, onDone) {
  const d = { rp: { days: [...plan.days], longDay: plan.longDay, schedule: JSON.parse(JSON.stringify(plan.schedule || {})) } };
  const n = plan.days.length;
  const m = sheet('');
  const root = m.querySelector('.sheet');
  const draw = () => {
    const sel = d.rp.days;
    root.innerHTML = `<div class="sheet-h"><b>Mi semana de running</b><button class="link" data-close type="button">Cerrar</button></div>
      <p class="cw-intro">Cambia los días (mantén ${n} días por semana) y el horario. Puedes poner la hora exacta o decir “después de…”.</p>
      <p class="cw-l">Días</p>${daysChips('rp.days', d)}
      ${sel.length === n ? `<p class="cw-l">Tirada larga / carrera</p><div class="pd-chips">${sel.map((x) => chip('rp.longDay', x, x.slice(0, 3), d.rp.longDay === x)).join('')}</div>
      <p class="cw-l">Horario</p>${[...sel].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((x) => when(x, d, 'rp')).join('')}` : `<p class="cw-warn">Elige exactamente ${n} días (ahora ${sel.length}).</p>`}
      <p class="msg" id="cw-msg"></p><div class="cw-nav"><span></span><button class="btn" data-save type="button">Guardar</button></div>`;
    root.querySelector('[data-close]').onclick = () => m.remove();
    root.querySelectorAll('input[data-k]').forEach((el) => (el.oninput = () => setP(d, el.dataset.k, el.value)));
    root.querySelectorAll('[data-ch]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.ch, v = b.dataset.v;
      if (b.dataset.multi) { const a = [...getP(d, k)]; const ix = a.indexOf(v); if (ix >= 0) a.splice(ix, 1); else a.push(v); setP(d, k, a); if (!d.rp.days.includes(d.rp.longDay)) d.rp.longDay = d.rp.days[0] || ''; } else setP(d, k, v);
      draw();
    }));
    root.querySelector('[data-save]').onclick = async () => {
      if (d.rp.days.length !== n) { root.querySelector('#cw-msg').textContent = `Elige ${n} días.`; return; }
      reassignPlan(plan, d.rp.days, d.rp.longDay); plan.schedule = d.rp.schedule;
      const err = await saveRunPlan(ctx.user.id, plan); if (err) { root.querySelector('#cw-msg').textContent = err.message; return; }
      m.remove(); onDone?.();
    };
  };
  draw();
}

// Tarjeta del plan en Running > Progreso.
export async function mountRunCoach(host, ctx) {
  if (!host) return;
  let plan = null, failed = '';
  try { plan = await loadRunPlan(ctx.user.id); } catch (e) { failed = e.message; }
  if (!host.isConnected) return;
  const again = () => mountRunCoach(host, ctx);
  if (failed || !plan?.weeks?.length) {
    host.innerHTML = `<article class="card coach-card"><div class="coach-card__head"><span class="coach-kicker">NUEVA CARRERA</span><h3>Prepárate para una carrera</h3></div><p class="muted">Responde unas preguntas y armamos un plan de entrenamiento con respaldo científico, con tus días y horarios. Aparecerá en tu Inicio.</p><button type="button" class="btn" id="rc-new">Empezar</button>${failed ? '<p class="muted">(Aún no está activa la base de datos de planes.)</p>' : ''}</article>`;
    host.querySelector('#rc-new').onclick = () => openRunWizard(ctx, again); return;
  }
  const w = planWeekIndex(plan), idx = Math.min(Math.max(w, 0), plan.weeks.length - 1), wk = plan.weeks[idx];
  const ended = w >= plan.weeks.length, notStarted = w < 0;
  host.innerHTML = `<article class="card coach-card"><div class="coach-card__head"><span class="coach-kicker">MI PLAN · ${esc(plan.goalLabel.toUpperCase())}</span><h3>${ended ? 'Plan completado' : notStarted ? `Empieza el ${new Date(`${plan.startDate}T12:00:00`).toLocaleDateString('es-BO', { day: 'numeric', month: 'long' })}` : `Semana ${wk.n} de ${plan.weeks.length} · ${esc(wk.phase)}`}</h3></div>
    <div class="coach-prog"><i style="width:${Math.min(100, ((w + 1) / plan.weeks.length) * 100)}%"></i></div>
    ${plan.warning ? `<p class="cw-warn">${esc(plan.warning)}</p>` : ''}
    <div class="coach-week">${wk.sessions.map((s) => `<div class="cw-sess${s.day === dayName() && !ended && !notStarted ? ' today' : ''}"><b>${s.day}</b><span>${esc(s.title)}</span><small>${esc([sessionLine(s), whenLabel(plan.schedule?.[s.day])].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>
    <div class="coach-actions"><button type="button" class="btn" id="rc-edit">Editar mi semana</button><button type="button" class="btn ghost" id="rc-new">Nueva carrera</button></div>
    <div class="coach-actions"><button type="button" class="btn ghost sm" id="rc-repeat">Repetir semana</button><button type="button" class="btn ghost sm" id="rc-skip">Adelantar semana</button></div>
    <details class="cw-sci"><summary>Ver todas las semanas</summary>${plan.weeks.map((x) => `<p class="coach-wrow${x.n === wk.n ? ' on' : ''}"><b>S${x.n}</b><span>${esc(x.phase)}</span><em>${x.km ? `${x.km} km` : `${x.min} min`}</em></p>`).join('')}</details>
    ${sciBlock('running')}</article>`;
  const save = async () => { const err = await saveRunPlan(ctx.user.id, plan); if (!err) again(); };
  host.querySelector('#rc-edit').onclick = () => openRunWeekEditor(ctx, plan, again);
  host.querySelector('#rc-new').onclick = () => openRunWizard(ctx, again);
  host.querySelector('#rc-repeat').onclick = () => { plan.shift = (plan.shift || 0) + 1; save(); };
  host.querySelector('#rc-skip').onclick = () => { plan.shift = (plan.shift || 0) - 1; save(); };
}

/* ---------- PLIOMETRÍA ---------- */
const EQUIP = [['box', 'Cajón o banco'], ['ball', 'Balón medicinal'], ['weights', 'Mancuernas / pesa rusa'], ['bar', 'Barra'], ['cones', 'Conos / vallas']];
const PLYO_EXP = [['never', 'Nunca he hecho saltos ni pliometría'], ['some', 'Lo he probado (menos de 6 meses)'], ['regular', 'Lo hago con regularidad (más de 6 meses)']];
const CHECKS = [['squat10', 'Puedo hacer 10 sentadillas sin peso con buena técnica'], ['pushup5', 'Puedo hacer 5 flexiones de brazos'], ['balance30', 'Puedo mantenerme 30 s en un pie sin perder el equilibrio']];

function plyoSteps(catalog) {
  return [
    stepDatos, stepSalud,
    {
      title: 'Experiencia', intro: 'La pliometría exige buena base de fuerza. Así elijo el nivel.',
      html: (d) => `<p class="cw-l">¿Has hecho pliometría?</p><div class="cw-opts">${PLYO_EXP.map(([v, l]) => chip('py.experience', v, l, d.py?.experience === v)).join('')}</div>
        <p class="cw-l">Marca lo que puedas hacer</p><div class="cw-opts">${CHECKS.map(([k, l]) => chip(`py.checks.${k}`, 1, l, !!d.py?.checks?.[k], 'data-bool="1" data-tog="1"')).join('')}</div>`,
      valid: (d) => (!d.py?.experience ? 'Elige tu experiencia.' : ''),
    },
    {
      title: 'Objetivo', intro: '',
      html: (d) => `<div class="cw-opts">${Object.entries(PLYO_GOALS).map(([v, g]) => chip('py.goal', v, g.label, d.py?.goal === v)).join('')}</div>`,
      valid: (d) => (!d.py?.goal ? 'Elige un objetivo.' : ''),
    },
    {
      title: 'Equipo', intro: 'Marca lo que tienes a mano. Sin nada también funciona (peso corporal).',
      html: (d) => `<div class="pd-chips">${EQUIP.map(([v, l]) => chip('py.equipment', v, l, (d.py?.equipment || []).includes(v), 'data-multi="1"')).join('')}</div>`,
    },
    {
      title: 'Tu semana', intro: 'Pliometría 1 a 3 veces por semana, con al menos 48 h entre sesiones. Puedes poner hora o “después de…”.',
      html: (d) => { const sel = d.py?.days || []; return `<p class="cw-l">Días</p>${daysChips('py.days', d)}${sel.length ? `<p class="cw-l">Horario (opcional)</p>${[...sel].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((x) => when(x, d, 'py')).join('')}` : ''}`; },
      valid: (d) => {
        const sel = [...(d.py?.days || [])].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
        if (!sel.length || sel.length > 3) return 'Elige de 1 a 3 días.';
        for (let i = 1; i < sel.length; i++) if (DAYS.indexOf(sel[i]) - DAYS.indexOf(sel[i - 1]) < 2) return 'Deja al menos un día libre entre sesiones.';
        return '';
      },
    },
    {
      title: 'Tu plan', intro: '',
      html: (d) => {
        const plan = buildPlyoPlan(d, { goal: d.py.goal, experience: d.py.experience, checks: d.py.checks || {}, days: d.py.days, equipment: d.py.equipment || [], schedule: d.py.schedule || {} }, catalog);
        d._plan = plan; const nm = (id) => { const e = catalog.find((c) => c.id === id); return esc(e?.name_es || e?.name || id); };
        if (!plan.sessions.length) return '<p class="cw-warn">No encontré ejercicios compatibles con tu equipo y nivel. Marca más equipo o amplía tu nivel.</p>';
        return `${healthWarn(d)}${plan.lowImpact ? '<p class="cw-warn">Por tus molestias articulares el plan evita saltos de alto impacto.</p>' : ''}
          ${summaryBox(plan.goalLabel, [['Nivel', PLYO_LEVEL_ES[plan.level]], ['Duración', '8 semanas'], ['Sesiones por semana', plan.days.length], ['Contactos por sesión', `${plan.weeks[0].contacts} → ${Math.max(...plan.weeks.map((x) => x.contacts))}`]])}
          ${plan.sessions.map((s) => `<h4 class="cw-h">${esc(s.name)}</h4><ul class="cw-ex">${s.ids.map((id) => `<li>${nm(id)}</li>`).join('')}</ul>`).join('')}
          <h4 class="cw-h">Progresión de contactos por sesión</h4><div class="cw-weeks">${plan.weeks.map((x) => `<span class="${x.phase === 'Descarga' || x.phase === 'Afinación' ? 'low' : ''}"><b>S${x.n}</b>${x.contacts}</span>`).join('')}</div>
          ${sciBlock('plyo')}${disclaimer}`;
      },
      valid: (d) => (!d._plan?.sessions?.length ? 'Ajusta tu equipo o nivel para generar el plan.' : ''),
    },
  ];
}

export async function openPlyoWizard(ctx, hooks) {
  const athlete = await loadAthlete(ctx.user.id);
  const data = JSON.parse(JSON.stringify(athlete)); data.py ||= {}; data.health ||= { q: [], injuries: '' };
  wizard({
    title: 'Preparar mi plan de pliometría', data, steps: plyoSteps(hooks.catalog()), finishLabel: 'Guardar y activar plan',
    onFinish: async (d, close) => {
      const plan = d._plan; delete d._plan;
      const ok = await hooks.applyPlan(plan); if (!ok) return 'No se pudo crear el plan. Intenta otra vez.';
      d.py.schedule = d.py.schedule || {}; d.plyoPlan = plan;
      const err = await saveAthlete(ctx.user.id, d); if (err) return 'No se pudo guardar tu plan: ' + err.message;
      close(); hooks.refresh?.();
    },
  });
}

export async function mountPlyoCoach(host, ctx, hooks) {
  if (!host) return;
  let a = {}, failed = '';
  try { a = await loadAthlete(ctx.user.id); } catch (e) { failed = e.message; }
  if (!host.isConnected) return;
  const plan = a.plyoPlan;
  if (!plan?.weeks) {
    host.innerHTML = `<article class="card coach-card"><div class="coach-card__head"><span class="coach-kicker">NUEVO PLAN</span><h3>Prepara tu plan de pliometría</h3></div><p class="muted">Unas preguntas sobre tu nivel, objetivo y equipo, y armamos rutinas con progresión semanal basada en evidencia. Si ya llenaste tus datos en Running, no los repites.</p><button type="button" class="btn" id="pc-new">Empezar</button>${failed ? '<p class="muted">(Aún no está activa la base de datos de planes.)</p>' : ''}</article>`;
    host.querySelector('#pc-new').onclick = () => openPlyoWizard(ctx, hooks); return;
  }
  const w = plyoWeekIndex(plan), wk = plan.weeks[w];
  host.innerHTML = `<article class="card coach-card"><div class="coach-card__head"><span class="coach-kicker">MI PLAN · ${esc(plan.goalLabel.toUpperCase())}</span><h3>Semana ${wk.n} de ${plan.weeks.length} · ${esc(wk.phase)}</h3></div>
    <div class="coach-prog"><i style="width:${((w + 1) / plan.weeks.length) * 100}%"></i></div>
    <div class="cw-weeks">${plan.weeks.map((x, i) => `<span class="${i === w ? 'now' : ''}"><b>S${x.n}</b>${x.contacts}</span>`).join('')}</div>
    <p class="muted">Contactos por sesión esta semana: <b>${wk.contacts}</b> · Días: ${plan.days.map((x) => x.slice(0, 3)).join(', ')}. Las series se ajustan solas cada semana.</p>
    <div class="coach-actions"><button type="button" class="btn ghost" id="pc-new">Rehacer plan</button></div>${sciBlock('plyo')}</article>`;
  host.querySelector('#pc-new').onclick = () => openPlyoWizard(ctx, hooks);
}

export { loadAthlete, saveAthlete, loadRunPlan, runLevel, plyoLevel, jointFlag };
