// Español + búsqueda flexible para el catálogo de ejercicios.
// - localize(): completa nombre/instrucciones/músculos/equipo en español sin tocar la base de datos.
// - searchExercises(): busca por nombre (ES o EN), alias, músculo, equipo, nivel y grupo, con sinónimos y tolerancia a errores.
import ES from '../data/exercise_es.json';

export const EQUIP_ES = {
  none: 'Sin equipo', 'body only': 'Peso corporal', 'medicine ball': 'Balón medicinal', other: 'Accesorios (cajón, conos…)',
  dumbbell: 'Mancuerna', kettlebells: 'Pesa rusa', barbell: 'Barra', machine: 'Máquina', cable: 'Polea', bands: 'Bandas elásticas',
  'exercise ball': 'Pelota de ejercicio', 'foam roll': 'Rodillo', 'e-z curl bar': 'Barra Z',
};
export const MUSCLE_ES = {
  abdominals: 'Abdominales', abductors: 'Abductores', adductors: 'Aductores', biceps: 'Bíceps', calves: 'Pantorrillas', chest: 'Pecho',
  forearms: 'Antebrazos', glutes: 'Glúteos', hamstrings: 'Isquiotibiales', lats: 'Dorsales', 'lower back': 'Zona lumbar',
  'middle back': 'Espalda media', neck: 'Cuello', quadriceps: 'Cuádriceps', shoulders: 'Hombros', traps: 'Trapecios', triceps: 'Tríceps',
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
export const equipEs = (v) => EQUIP_ES[(v || 'none')] || EQUIP_ES[String(v || 'none').toLowerCase()] || cap(String(v || ''));
export const muscleEs = (v) => MUSCLE_ES[String(v || '').toLowerCase()] || cap(String(v || ''));
const LEVEL_ES = { beginner: 'principiante facil', intermediate: 'intermedio', expert: 'avanzado dificil' };

export function localize(e) {
  const t = ES[e.id];
  if (t) { e.name_es = e.name_es || t.n; e.how = t.h || []; e.alias = t.a || []; }
  else { e.how = e.source === 'custom' ? (e.instructions || []) : []; e.alias = e.alias || []; }
  return e;
}

/* ---------- búsqueda ---------- */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\-/.,()]+/g, ' ').replace(/\s+/g, ' ').trim();

// Grupos de palabras equivalentes (español ⇄ inglés ⇄ coloquial). Todo sin tildes.
const GROUPS = [
  ['salto', 'saltos', 'saltar', 'jump', 'jumps', 'hop', 'hops', 'bound', 'leap', 'brinco', 'brincar'],
  ['cajon', 'caja', 'box', 'plataforma'], ['banco', 'bench'], ['balon', 'pelota', 'ball'], ['medicinal', 'medicine', 'medicinales'],
  ['lanzamiento', 'lanzamientos', 'lanzar', 'throw', 'toss'], ['golpe', 'slam', 'estrellar'], ['flexion', 'flexiones', 'pushup', 'push', 'lagartija', 'lagartijas', 'plancha'],
  ['sentadilla', 'sentadillas', 'squat', 'squats'], ['zancada', 'zancadas', 'lunge', 'split', 'estocada'],
  ['carrera', 'correr', 'run', 'running', 'sprint', 'sprints', 'velocidad', 'speed', 'trote'], ['valla', 'vallas', 'hurdle', 'hurdles'],
  ['cono', 'conos', 'cone', 'cones'], ['lateral', 'laterales', 'side', 'costado'], ['cuerda', 'soga', 'comba', 'rope', 'ropes'],
  ['rana', 'frog', 'sapo'], ['pesa', 'rusa', 'kettlebell', 'kettlebells'], ['mancuerna', 'mancuernas', 'dumbbell', 'dumbbells'],
  ['barra', 'barbell'], ['trineo', 'sled', 'prowler'], ['neumatico', 'llanta', 'tire'], ['escalera', 'escaleras', 'stairs', 'stair', 'step', 'gradas', 'grada'],
  ['rodilla', 'rodillas', 'knee', 'knees'], ['talon', 'talones', 'gluteo', 'butt', 'kick', 'patada'], ['tijera', 'scissors'], ['estrella', 'star'],
  ['profundidad', 'depth', 'drop', 'caida'], ['abdominal', 'abdominales', 'crunch', 'situp', 'abs', 'core', 'abdominals'],
  ['escalador', 'escaladores', 'alpinista', 'mountain', 'climber', 'climbers'], ['brazo', 'brazos', 'arm', 'arms'], ['pierna', 'piernas', 'leg', 'legs'],
  ['hombro', 'hombros', 'shoulder', 'shoulders'], ['pecho', 'chest', 'pectoral'], ['espalda', 'back', 'dorsal', 'dorsales', 'lats'],
  ['potencia', 'power', 'fuerza explosiva'], ['cargada', 'clean'], ['arrancada', 'arranque', 'snatch'], ['envion', 'jerk'],
  ['rapido', 'rapidos', 'rapida', 'fast', 'quick', 'veloz'], ['alterno', 'alternos', 'alterna', 'alternate', 'alternating', 'alternado'],
  ['pared', 'wall'], ['empuje', 'empujar', 'empujes', 'thrust', 'press'], ['pase', 'pass'], ['giro', 'twist', 'rotacion', 'rotation'],
  ['gateo', 'crawl', 'oso', 'bear'], ['mazo', 'sledgehammer', 'martillo', 'hammer'], ['saco', 'bag', 'heavy', 'pesado'],
  ['largo', 'long', 'broad', 'distancia'], ['cuadriceps', 'quadriceps', 'quads', 'muslo', 'muslos'], ['gluteos', 'glutes', 'nalga', 'nalgas'],
  ['isquiotibiales', 'hamstrings', 'femoral', 'femorales'], ['pantorrillas', 'calves', 'gemelos', 'gemelo', 'pantorrilla'],
  ['banda', 'bandas', 'bands', 'band', 'liga', 'elastica'], ['maquina', 'machine'], ['corporal', 'body', 'libre', 'bodyweight'],
  ['principiante', 'beginner', 'facil'], ['avanzado', 'expert', 'dificil', 'advanced'], ['intermedio', 'intermediate', 'medio'],
  ['vertical', 'altura', 'altos'], ['horizontal', 'frontal', 'front', 'adelante'], ['una', 'single', 'one', 'unilateral', 'sola'],
  ['dos', 'two', 'double', 'doble', 'ambas'], ['agilidad', 'agility', 'carioca', 'cambio', 'direccion'], ['calentamiento', 'warm', 'warmup'],
];
const INDEX = new Map();
GROUPS.forEach((g, i) => g.forEach((w) => { (INDEX.get(w) || INDEX.set(w, []).get(w)).push(i); }));

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
const singular = (w) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

function alternatives(token) {
  const alts = new Set([token, singular(token)]);
  [...alts].forEach((t) => {
    (INDEX.get(t) || []).forEach((gi) => GROUPS[gi].forEach((w) => alts.add(w)));
    if (t.length >= 4) INDEX.forEach((gs, w) => { if (w.startsWith(t)) gs.forEach((gi) => GROUPS[gi].forEach((x) => alts.add(x))); });   // "sentad" → sentadilla…
  });
  return [...alts].filter((a) => a.length >= 2);
}

function haystack(e) {
  if (e._hay) return e._hay;
  const g = e._group || '';
  const text = [e.id, e.name, e.name_es, ...(e.alias || []), ...(e.primary_muscles || []).flatMap((m) => [m, muscleEs(m)]), ...(e.secondary_muscles || []).flatMap((m) => [m, muscleEs(m)]),
    e.equipment || 'none', equipEs(e.equipment), LEVEL_ES[e.level] || e.level || '', g].join(' ');
  const hay = norm(text); e._hay = { text: hay, words: [...new Set(hay.split(' '))] };
  return e._hay;
}

// Devuelve los ejercicios que coinciden, mejores primero. Sin consulta devuelve la lista tal cual.
export function searchExercises(list, query, extra = () => '') {
  const q = norm(query); if (!q) return list;
  const tokens = q.split(' ').filter(Boolean);
  const alts = tokens.map(alternatives);
  const scored = [];
  for (const e of list) {
    const h = haystack(e), own = norm(`${e.name_es || ''} ${e.name || ''} ${(e.alias || []).join(' ')}`), ex = norm(extra(e));
    const words = ex ? [...h.words, ...ex.split(' ')] : h.words, text = ex ? `${h.text} ${ex}` : h.text;
    let score = 0, ok = true;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]; let best = 0;
      if (own.includes(t)) best = 6;
      else if (words.some((w) => w.startsWith(t))) best = 5;
      else if (text.includes(t)) best = 3;
      else if (alts[i].some((a) => words.some((w) => w === a || (a.length >= 4 && w.startsWith(a))))) best = 2;
      else if (t.length >= 5) { const max = t.length >= 8 ? 2 : 1; if (words.some((w) => w.length >= 4 && lev(t, w.slice(0, t.length + 1), max) <= max)) best = 1; }
      if (!best) { ok = false; break; }
      score += best;
    }
    if (ok) { if (own.startsWith(q)) score += 8; else if (own.includes(q)) score += 4; scored.push([score, e]); }
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}
