// Motor de planes de entrenamiento (sin interfaz): Running y Pliometría.
// Los métodos se basan en principios con respaldo científico (ver SCIENCE más abajo).
import { supabase } from '../supabase.js';

export const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const isoDay = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const mondayOf = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const dayName = (d = new Date()) => DAYS[(d.getDay() + 6) % 7];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r5 = (v) => Math.round(v / 5) * 5;
const r1 = (v) => Math.round(v * 10) / 10;

export const SCIENCE = {
  running: [
    'Progresión gradual y semanas de descarga: los aumentos de volumen muy rápidos (más de ~30 % en dos semanas) se asocian con más lesiones por sobrecarga en corredores novatos (Nielsen et al., 2014, JOSPT). Aquí el volumen sube como máximo ~10 % por semana y cada 4.ª semana baja.',
    'Distribución 80/20: la mayor parte del entrenamiento a intensidad fácil (puedes hablar) y una parte pequeña intensa (Seiler, 2010; Esteve-Lanao 2007 y 2014; Stöggl y Sperlich, 2014).',
    'Principiantes: intervalos de trotar/caminar que aumentan poco a poco, como en los programas de "sofá a 5 km".',
    'Afinación (taper): reducir el volumen en las 1–2 semanas previas a la carrera manteniendo algo de intensidad.',
    'Frecuencia cardiaca máxima estimada con Tanaka et al. (2001): 208 − 0,7 × edad. Es una estimación (error ±11 lpm); guíate sobre todo por la prueba del habla y el esfuerzo percibido.',
  ],
  plyo: [
    'El entrenamiento pliométrico mejora salto, velocidad y economía de carrera con 1–3 sesiones por semana y programas de 6–12 semanas (revisiones y metaanálisis de Ramírez-Campillo y colaboradores, 2020–2023).',
    'Volumen por sesión según nivel (contactos con el suelo), en línea con las guías de la NSCA: principiante ~60–100, intermedio ~80–120, avanzado ~100–140.',
    'Al menos 48 h entre sesiones y descansos largos entre series (calidad antes que cantidad); semana de descarga cada 4.ª semana y afinación final.',
    'Si hay dolor articular previo, el plan usa ejercicios de bajo impacto; consulta a un profesional de salud antes de empezar.',
  ],
};

/* ---------- Acceso a datos ---------- */
export async function loadAthlete(userId) {
  const { data } = await supabase.from('athlete_profiles').select('data').eq('user_id', userId).maybeSingle();
  return data?.data || {};
}
export async function saveAthlete(userId, data) {
  const { error } = await supabase.from('athlete_profiles').upsert({ user_id: userId, data, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error;
}
export async function loadRunPlan(userId) {
  const { data } = await supabase.from('run_plans').select('plan').eq('user_id', userId).maybeSingle();
  return data?.plan || null;
}
export async function saveRunPlan(userId, plan) {
  const { error } = await supabase.from('run_plans').upsert({ user_id: userId, plan, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  return error;
}

export const hrMax = (age) => (age ? Math.round(208 - 0.7 * Number(age)) : null);
export const hrRange = (age, lo, hi) => { const m = hrMax(age); return m ? `${Math.round(m * lo)}–${Math.round(m * hi)} lpm` : ''; };
export const bmi = (kg, cm) => (kg && cm ? Number(kg) / ((Number(cm) / 100) ** 2) : null);
export const hasHealthFlag = (a) => (a?.health?.q || []).some(Boolean);
export const jointFlag = (a) => !!(a?.health?.q || [])[3] || /rodilla|tobillo|cadera|espalda|lesi/i.test(a?.health?.injuries || '');
export const sharedDataComplete = (a) => !!(a?.age && a?.weight_kg && a?.height_cm && a?.sex);

/* ---------- Plan de Running ---------- */
export const RUN_GOALS = {
  start: { label: 'Empezar a correr (30 min seguidos)', km: 0 },
  '5k': { label: 'Carrera de 5 km', km: 5 },
  '10k': { label: 'Carrera de 10 km', km: 10 },
  '21k': { label: 'Media maratón (21 km)', km: 21.1 },
  '42k': { label: 'Maratón (42 km)', km: 42.2 },
};
const RW = [[1, 2, 8], [2, 2, 6], [3, 2, 5], [5, 2, 4], [8, 2, 3], [10, 2, 3], [15, 2, 2], [20, 0, 1]]; // [min trotando, min caminando, repeticiones]
const MIN_WEEKS = { start: 8, '5k': 8, '10k': 8, '21k': 10, '42k': 14 };
const DEF_WEEKS = { start: 10, '5k': 10, '10k': 12, '21k': 14, '42k': 18 };

export function runLevel(a, goal) {
  const exp = a?.running?.experience || 'none';
  if (hasHealthFlag(a) || exp === 'none' || exp === 'some' || (bmi(a?.weight_kg, a?.height_cm) || 0) >= 32) return 'novice';
  if (goal === '42k' && exp !== 'high') return 'base';
  return exp === 'high' ? 'intermediate' : 'base';
}

function assignDays(sessions, days, longDay) {
  const idx = (d) => DAYS.indexOf(d);
  const sorted = [...days].sort((a, b) => idx(a) - idx(b));
  const ld = sorted.includes(longDay) ? longDay : sorted[sorted.length - 1];
  const dist = (a, b) => { const x = Math.abs(idx(a) - idx(b)); return Math.min(x, 7 - x); };
  const others = sorted.filter((d) => d !== ld);
  const long = sessions.find((s) => s.type === 'long' || s.type === 'race');
  const quality = sessions.find((s) => s.type === 'tempo' || s.type === 'intervals');
  const rest = sessions.filter((s) => s !== long && s !== quality);
  const out = []; const free = long ? [...others] : [...sorted];
  if (long) out.push({ ...long, day: ld });
  if (quality && free.length) { free.sort((a, b) => dist(b, ld) - dist(a, ld)); const qd = free.shift(); out.push({ ...quality, day: qd }); }
  rest.forEach((s) => { const d = free.shift(); if (d) out.push({ ...s, day: d }); });
  return out.sort((a, b) => idx(a.day) - idx(b.day));
}

export function buildRunPlan(a, o) {
  const goal = o.goal, level = runLevel(a, goal), cautious = hasHealthFlag(a) || (a.age && a.age >= 60);
  const days = [...o.days].sort((x, y) => DAYS.indexOf(x) - DAYS.indexOf(y));
  const D = clamp(days.length, 2, 6);
  const start = mondayOf(new Date()); if (new Date().getDay() > 3 || new Date().getDay() === 0) start.setDate(start.getDate() + 7);
  let weeks = DEF_WEEKS[goal] - (level !== 'novice' && goal !== 'start' ? 2 : 0), warn = '';
  if (level === 'novice' && goal === '42k') weeks = 24;
  if (o.raceDate && goal !== 'start') {
    const avail = Math.floor((new Date(`${o.raceDate}T12:00:00`) - start) / 604800000) + 1;
    if (avail >= 4) { weeks = Math.min(avail, 30); if (weeks < MIN_WEEKS[goal]) warn = `Tienes solo ${weeks} semanas: es poco tiempo para ${RUN_GOALS[goal].label.toLowerCase()}. El plan está comprimido; sé prudente y no busques marca.`; }
    else warn = 'La carrera es muy pronto para preparar un plan completo; haz rodajes suaves y no fuerces.';
  }
  const W = Math.max(4, weeks), out = []; let usedDays = days;
  const taper = goal === '21k' || goal === '42k' ? 2 : 1;
  const novice = level === 'novice';

  if (novice) {
    const cap = { start: 30, '5k': 45, '10k': 70, '21k': 100, '42k': 140 }[goal];
    const pickEven = (arr, k) => (arr.length <= k ? arr : Array.from({ length: k }, (_, i) => arr[Math.round(i * (arr.length - 1) / Math.max(1, k - 1))]));
    const nd = pickEven(days, Math.min(3, D)); usedDays = nd;
    for (let n = 1; n <= W; n++) {
      const sess = []; const N = Math.min(3, D); const rest = n % 4 === 0;
      let phase = 'Adaptación', title, detail, min;
      if (n <= RW.length && !(rest && n > 4)) {
        const [run, walk, reps] = RW[n - 1]; min = run * reps + walk * Math.max(0, reps - 1) + 10;
        for (let i = 0; i < N; i++) {
          if (run >= 20) { title = `Trote continuo ${run + (n - RW.length) * 5} min`; detail = 'Ritmo muy cómodo: debes poder hablar. Calienta caminando 5 min y termina caminando 5 min.'; sess.push({ type: i === N - 1 ? 'long' : 'easy', title, detail, min: run + 10, rpe: '3–4/10' }); }
          else sess.push({ type: 'run_walk', title: `${reps} × (${run} min trotando + ${walk} min caminando)`, detail: 'Calienta caminando 5 min y termina caminando 5 min. Trota muy suave: debes poder hablar.', min, rpe: '3–4/10' });
        }
      } else {
        const L = rest ? r5((30 + 5 * (n - 8)) * 0.8) : clamp(30 + 5 * (n - 8), 30, cap);
        phase = rest ? 'Descarga' : 'Construcción';
        const isTaper = n >= W - taper && n < W && goal !== 'start'; const race = n === W && goal !== 'start';
        const f = race ? 0.5 : isTaper ? 0.7 : 1; const Lm = clamp(r5(L * f), 20, cap);
        for (let i = 0; i < N; i++) {
          const isLong = i === N - 1;
          sess.push(race && isLong ? { type: 'race', title: `Día de carrera: ${RUN_GOALS[goal].label}`, detail: 'Sal más lento de lo que crees; acelera solo en la segunda mitad. Hidrátate. ¡Disfrútala!', min: Math.round(RUN_GOALS[goal].km * 7), rpe: '6–8/10' }
            : { type: isLong ? 'long' : 'easy', title: isLong ? `Trote largo ${Lm} min` : `Trote suave ${clamp(r5(Lm * 0.6), 20, 40)} min`, detail: 'Ritmo cómodo (puedes hablar). Calienta caminando y termina caminando 5 min.', min: isLong ? Lm : clamp(r5(Lm * 0.6), 20, 40), rpe: '3–4/10' });
          if (race) { phase = 'Semana de carrera'; }
        }
        if (isTaper) phase = 'Afinación';
      }
      out.push({ n, phase, min: sess.reduce((s, x) => s + x.min, 0), sessions: assignDays(sess, nd, nd.includes(o.longDay) ? o.longDay : nd[nd.length - 1]) });
    }
  } else {
    const L = level === 'intermediate' ? 1 : 0;
    const peak = { '5k': [28, 36], '10k': [36, 46], '21k': [46, 58], '42k': [58, 72] }[goal][L] * (cautious ? 0.8 : 1);
    const longCap = { '5k': 10, '10k': 15, '21k': 21, '42k': 32 }[goal];
    const km = RUN_GOALS[goal].km;
    const V0 = clamp(Number(a?.running?.weekly_km) || 15, 10, peak * 0.8);
    let prev = V0; const vols = [];
    for (let n = 1; n <= W; n++) {
      if (n > W - taper - 1) { const t = W - n; vols.push(t === 0 ? 0.45 : t === 1 ? 0.7 : 0.8); continue; } // factores sobre el pico
      if (n % 4 === 0) { vols.push(Math.round(prev * 0.78 * 10) / 10); continue; }
      prev = Math.min(peak, prev * 1.1); vols.push(Math.round(prev * 10) / 10);
    }
    const peakVol = Math.max(...vols.filter((v) => v > 1.2));
    for (let n = 1; n <= W; n++) {
      const tp = n > W - taper - 1, race = n === W; const rest = !tp && n % 4 === 0;
      const V = tp ? Math.round(peakVol * vols[n - 1]) : vols[n - 1];
      const sess = []; let phase = race ? 'Semana de carrera' : tp ? 'Afinación' : rest ? 'Descarga' : n <= W * 0.35 ? 'Base' : n <= W * 0.75 ? 'Construcción' : 'Pico';
      if (race) {
        sess.push({ type: 'race', title: `Día de carrera: ${RUN_GOALS[goal].label}`, detail: 'Sal más lento de lo que crees y acelera solo en la segunda mitad. Hidrátate. ¡Disfrútala!', km, rpe: '7–9/10' });
        for (let i = 1; i < D; i++) sess.push({ type: 'easy', title: 'Trote suave de activación', detail: 'Ritmo muy cómodo, con 4 aceleraciones de 20 s al final.', km: 4, rpe: '3–4/10' });
      } else {
        const longKm = clamp(r1(V * 0.33), 4, longCap);
        sess.push({ type: 'long', title: `Tirada larga ${longKm} km`, detail: goal === '21k' || goal === '42k' && n > W * 0.5 ? 'Ritmo fácil; en las últimas semanas incluye los últimos 3–5 km a ritmo de carrera.' : 'Ritmo fácil: puedes mantener una conversación.', km: longKm, rpe: '3–4/10' });
        let remain = V - longKm; const wantQ = D >= 3 && n >= 3 && !rest && !tp;
        if (wantQ) {
          const tempo = n % 2 === 1 || goal === '21k' || goal === '42k';
          const qKm = clamp(r1(V * 0.22), 5, 12); remain -= qKm;
          if (tempo) { const t = clamp(10 + n * 2, 15, 35); sess.push({ type: 'tempo', title: `Tempo ${t} min`, detail: `10 min suaves + ${t} min a ritmo "cómodamente duro" (RPE 7/10) + 10 min suaves.`, km: qKm, rpe: '7/10' }); }
          else { const reps = clamp(4 + Math.floor(n / 3), 4, 8); sess.push({ type: 'intervals', title: `${reps} × 3 min fuertes`, detail: `10 min suaves + ${reps} × (3 min fuerte RPE 8/10 + 2 min trote suave) + 10 min suaves.`, km: qKm, rpe: '8/10' }); }
        }
        const nEasy = D - sess.length; const e = clamp(r1(remain / Math.max(1, nEasy)), 3, 12);
        for (let i = 0; i < nEasy; i++) sess.push({ type: 'easy', title: `Rodaje fácil ${e} km`, detail: n >= 2 && i === 0 ? 'Ritmo fácil + 4 aceleraciones de 20 s al final (técnica y economía).' : 'Ritmo fácil: puedes hablar con frases completas.', km: e, rpe: '3–4/10' });
      }
      out.push({ n, phase, km: r1(sess.reduce((s, x) => s + (x.km || 0), 0)), sessions: assignDays(sess, days, o.longDay) });
    }
  }
  return {
    goal, goalLabel: RUN_GOALS[goal].label, level, cautious, raceDate: o.raceDate || null, raceName: o.raceName || '', createdAt: new Date().toISOString(),
    startDate: isoDay(start), days: usedDays, longDay: usedDays.includes(o.longDay) ? o.longDay : usedDays[usedDays.length - 1], schedule: o.schedule || {}, shift: 0, weeks: out, warning: warn,
  };
}

export function reassignPlan(plan, days, longDay) {
  const sorted = [...days].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
  plan.weeks.forEach((w) => { w.sessions = assignDays(w.sessions.map((x) => ({ ...x })), sorted, longDay); });
  plan.days = sorted; plan.longDay = sorted.includes(longDay) ? longDay : sorted[sorted.length - 1];
  return plan;
}

export function planWeekIndex(plan, d = new Date()) {
  if (!plan?.weeks?.length) return 0;
  let w = Math.floor((mondayOf(d) - new Date(`${plan.startDate}T12:00:00`)) / 604800000) - (plan.shift || 0);
  // Plan creado esta misma semana (jue–dom) pero con inicio el lunes siguiente: la semana actual cuenta como semana 1.
  if (w < 0 && plan.createdAt && mondayOf(new Date(plan.createdAt)).getTime() === mondayOf(d).getTime() && mondayOf(d).getTime() === mondayOf(new Date()).getTime()) w = 0;
  return w;
}
export function runSessionOn(plan, d = new Date()) {
  if (!plan?.weeks?.length) return null;
  const w = planWeekIndex(plan, d); if (w < 0 || w >= plan.weeks.length) return null;
  const s = plan.weeks[w].sessions.find((x) => x.day === dayName(d)); if (!s) return null;
  return { ...s, week: plan.weeks[w], weekNo: plan.weeks[w].n, total: plan.weeks.length, when: plan.schedule?.[s.day] || {} };
}
export const whenLabel = (w) => (w?.time ? `${w.time}` : w?.after ? `Después: ${w.after}` : '');
export const sessionLine = (s) => (s.km ? `${s.km} km` : s.min ? `${s.min} min` : '');

/* ---------- Plan de Pliometría ---------- */
export const PLYO_GOALS = {
  vertical: { label: 'Saltar más alto (vóley, básquet…)', A: ['Salto vertical', 'Cajón y banco', 'Rebotes y reactividad', 'Core'], B: ['Salto vertical', 'Saltos horizontales', 'Lanzamientos', 'Core'] },
  speed: { label: 'Más velocidad y agilidad (fútbol, atletismo…)', A: ['Velocidad y agilidad', 'Saltos horizontales', 'Rebotes y reactividad', 'Core'], B: ['Salto vertical', 'Velocidad y agilidad', 'Lanzamientos', 'Core'] },
  running: { label: 'Correr más económico (apoyo a Running)', A: ['Rebotes y reactividad', 'Saltos horizontales', 'Salto vertical', 'Core'], B: ['Rebotes y reactividad', 'Velocidad y agilidad', 'Cajón y banco', 'Core'] },
  power: { label: 'Potencia y fuerza explosiva general', A: ['Salto vertical', 'Cajón y banco', 'Lanzamientos', 'Core'], B: ['Saltos horizontales', 'Tren superior', 'Rebotes y reactividad', 'Core'] },
  health: { label: 'Salud, huesos y condición general', A: ['Rebotes y reactividad', 'Salto vertical', 'Core'], B: ['Velocidad y agilidad', 'Lanzamientos', 'Core'] },
};
const JUMP_G = new Set(['Salto vertical', 'Saltos horizontales', 'Cajón y banco', 'Rebotes y reactividad', 'Velocidad y agilidad']);
const LOW_G = new Set(['Lanzamientos', 'Tren superior', 'Core', 'Velocidad y agilidad']);
const LV = { beginner: 0, intermediate: 1, expert: 2 };
const FRAC = [0, 0.25, 0.5, 0.15, 0.65, 0.85, 1, 0.5];
const BAND = { novice: [60, 100], intermediate: [80, 120], advanced: [100, 140] };

export function plyoLevel(a, p) {
  if (hasHealthFlag(a) || (a?.age && a.age >= 55) || p.experience === 'never') return 'novice';
  const score = ['squat10', 'pushup5', 'balance30'].filter((k) => p.checks?.[k]).length;
  if (score < 2) return 'novice';
  return p.experience === 'regular' && score === 3 ? 'advanced' : 'intermediate';
}
const equipOk = (e, eq) => {
  const v = e.equipment || 'none';
  if (['none', 'body only'].includes(v)) return true;
  if (v === 'medicine ball') return eq.includes('ball');
  if (v === 'other') return eq.includes('box') || eq.includes('cones');
  if (v === 'kettlebells' || v === 'dumbbell') return eq.includes('weights');
  if (v === 'barbell') return eq.includes('bar');
  return false;
};

export function buildPlyoPlan(a, p, catalog) {
  const level = plyoLevel(a, p), low = jointFlag(a), eq = p.equipment || [];
  const allowedLv = level === 'novice' ? [0] : level === 'intermediate' ? [0, 1] : [0, 1, 2];
  const goal = PLYO_GOALS[p.goal] || PLYO_GOALS.power;
  const pool = catalog.filter((e) => allowedLv.includes(LV[e.level] ?? 0) && equipOk(e, eq) && (!low || LOW_G.has(e._group)));
  const used = new Set();
  const pick = (group, offset) => {
    const dir = level === 'novice' ? 1 : -1;
    const c = pool.filter((e) => e._group === group && !used.has(e.id)).sort((x, y) => dir * ((LV[x.level] ?? 0) - (LV[y.level] ?? 0)) || String(x.id).localeCompare(String(y.id)));
    const e = c[(offset || 0) % Math.max(1, c.length)]; if (e) used.add(e.id); return e;
  };
  const n = clamp(p.days?.length || 2, 1, 3);
  const defs = [['Día A', goal.A, 0], ['Día B', goal.B, 0], ['Día C', goal.A, 1]].slice(0, n);
  const sessions = defs.map(([label, groups, off]) => {
    const exs = groups.map((g) => pick(g, off)).filter(Boolean);
    return { name: `${label} · ${(exs[0] ? exs[0]._group : 'Pliometría')}`, ids: exs.map((e) => e.id), groups: [...new Set(exs.map((e) => e._group))] };
  }).filter((s) => s.ids.length);
  const [lo, hi] = BAND[level];
  const weeks = FRAC.map((f, i) => ({ n: i + 1, contacts: r5(lo + (hi - lo) * f), phase: i === 3 ? 'Descarga' : i === 7 ? 'Afinación' : i < 3 ? 'Base' : 'Desarrollo' }));
  const start = mondayOf(new Date()); if (new Date().getDay() > 3 || new Date().getDay() === 0) start.setDate(start.getDate() + 7);
  return { goal: p.goal, goalLabel: goal.label, level, lowImpact: low, equipment: eq, days: [...p.days].sort((x, y) => DAYS.indexOf(x) - DAYS.indexOf(y)), schedule: p.schedule || {}, startDate: isoDay(start), sessions, weeks, appliedWeek: -1 };
}

export function plyoWeekIndex(plan, d = new Date()) {
  const w = Math.floor((mondayOf(d) - new Date(`${plan.startDate}T12:00:00`)) / 604800000);
  return clamp(w, 0, (plan.weeks?.length || 1) - 1);
}

// Series y repeticiones de una sesión para una semana dada (formato de plyo_routines.items).
export function plyoItems(plan, session, weekIdx, catalog) {
  const C = plan.weeks[weekIdx].contacts, novice = plan.level === 'novice';
  const exs = session.ids.map((id) => catalog.find((e) => e.id === id)).filter(Boolean);
  const jumps = exs.filter((e) => JUMP_G.has(e._group));
  const per = C / Math.max(1, jumps.length);
  return exs.map((e) => {
    const jump = JUMP_G.has(e._group);
    const reps = jump ? (novice ? 5 : e._group === 'Velocidad y agilidad' ? 8 : 6) : e._group === 'Core' ? 10 : e._group === 'Lanzamientos' ? 6 : 8;
    const sets = jump ? clamp(Math.round(per / reps), 2, 5) : (novice ? 2 : 3);
    return { exercise_id: e.id, target_sets: sets, rest_sec: jump ? (novice ? 90 : 75) : 45, sets: Array.from({ length: sets }, () => ({ weight_kg: '', reps })), targets: {} };
  });
}
