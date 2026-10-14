// ============================================================
// routine_catalog.js — Catalogue de séances "hors plan" + compilateur
// (Cahier des charges "Routines intelligentes hors plan" V1.0, lot P0)
//
// Chaque séance est écrite en un petit langage compact (DSL), compilé en
// étapes avec durée exacte, jamais saisie à la main :
//
//   15m EF + 3x(6m TEMPO) r2m EF + 10m EF
//
//   Durées  : 15m · 30s · 90s · 1m30
//   Codes   : EF (EFL = bas, EFH = haut) · TEMPO · AS42 · SS (Sweet Spot) ·
//             AS21 · S60 · AS10 · S30 · VMA · WALK · STRIDE (relâché)
//             RPE<n>:<libelle> = effort au ressenti (côtes, trail), sans allure
//   Montée  : 4m/6m/8m TEMPO r2m EF  (paliers ; r entre paliers)
//   Répét.  : Nx( ... ) r2m EF       (N fois ; r entre répétitions)
//             Nx( ... ) R4m EF       (R = récupération entre blocs/séries)
//
// "r" et "R" ne sont JAMAIS posés après la dernière répétition (cf. §9 et
// §14 du cahier des charges) ; une récupération voulue en fin de groupe
// s'écrit dans le corps : 4x(4m TEMPO + 2m EF).
//
// Aucune allure chiffrée ici : seulement des codes ; les bornes viennent du
// tableau dynamique de l'utilisateur (ALLURE_PLUS_ZONES, campus.js) au
// moment de composer / exporter la séance. Même fichier chargeable côté
// Node pour les tests (tests/routine_catalog.test.js).
// ============================================================

// code DSL → zone Allure+ (clé ALLURE_PLUS_ZONES), slug Campus (SLUG_TO_ZONE),
// kind historique (free_sessions.js / annotatePaceZones)
const ROUTINE_CODES = {
  EF:     { zone: 'EF',         slug: 'ef',            kind: 'Z2' },
  EFL:    { zone: 'EF',         slug: 'ef',            kind: 'Z2', sub: 'low' },
  EFH:    { zone: 'EF',         slug: 'ef',            kind: 'Z2', sub: 'high' },
  TEMPO:  { zone: 'TEMPO',      slug: 'tempo',         kind: 'Z3' },
  STRIDE: { zone: 'TEMPO',      slug: 'tempo',         kind: 'Z3', sub: 'relaxed' },
  AS42:   { zone: 'AS42',       slug: 'marathon',      kind: 'Z3' },
  SS:     { zone: 'SWEET_SPOT', slug: 'sweet-spot',    kind: 'Z4' },
  AS21:   { zone: 'AS21',       slug: 'half-marathon', kind: 'Z4' },
  S60:    { zone: 'S60',        slug: 'seuil60',       kind: 'Z4' },
  AS10:   { zone: 'AS10',       slug: '10km',          kind: 'Z4' },
  S30:    { zone: 'S30',        slug: 'seuil30',       kind: 'Z4' },
  VMA:    { zone: 'VMA',        slug: 'vma',           kind: 'Z5' },
  WALK:   { zone: 'RECOVER',    slug: 'slow',          kind: 'RECOVER', walk: true },
};
// codes qui ne comptent pas comme "qualité" (séance = EF pure si que ça)
const ROUTINE_EASY_CODES = ['EF', 'EFL', 'EFH', 'WALK'];

// ─── Compilateur DSL ─────────────────────────────────────────────────────
function routineTokenize(src) {
  const rules = [
    ['REP',   /^(\d+)x\(/],
    ['CLOSE', /^\)/],
    ['PLUS',  /^\+/],
    ['SEP',   /^([rR])(?=\d)/],
    ['DUR',   /^(\d+m\d*|\d+s)/],
    ['SLASH', /^\//],
    ['CODE',  /^[A-Z][A-Z0-9]*(?::[a-z0-9_]+)?/],
  ];
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    const rest = src.slice(i);
    let hit = null;
    for (const [t, re] of rules) {
      const m = re.exec(rest);
      if (m) { hit = { t, m }; break; }
    }
    if (!hit) throw new Error(`DSL: caractère inattendu "${src[i]}" en position ${i} de "${src}"`);
    const tok = { t: hit.t, v: hit.m[0] };
    if (hit.t === 'REP') tok.n = parseInt(hit.m[1], 10);
    if (hit.t === 'SEP') tok.kind = hit.m[1];
    out.push(tok);
    i += hit.m[0].length;
  }
  return out;
}

function routineParseDuration(v) {
  let m = /^(\d+)s$/.exec(v);
  if (m) return parseInt(m[1], 10);
  m = /^(\d+)m(\d*)$/.exec(v);
  if (m) return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  throw new Error(`DSL: durée invalide "${v}"`);
}

function routineParseCode(v) {
  const rpe = /^RPE(\d+)(?::([a-z0-9_]+))?$/.exec(v);
  if (rpe) return { code: 'RPE', rpe: parseInt(rpe[1], 10), label: rpe[2] || null };
  if (!ROUTINE_CODES[v]) throw new Error(`DSL: code d'allure inconnu "${v}"`);
  return { code: v };
}

function routineParseDsl(src) {
  const tokens = routineTokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const expect = (t) => {
    const tok = tokens[p++];
    if (!tok || tok.t !== t) throw new Error(`DSL: "${t}" attendu dans "${src}"`);
    return tok;
  };
  const mkStep = (durTok, codeTok, role) => ({ t: 'step', sec: routineParseDuration(durTok.v), ...routineParseCode(codeTok.v), role });
  function parseSep() {
    if (peek() && peek().t === 'SEP') {
      const kind = tokens[p++].kind;
      const d = expect('DUR'), c = expect('CODE');
      return mkStep(d, c, kind === 'r' ? 'recovery' : 'setRecovery');
    }
    return null;
  }
  function parseItem() {
    const t = peek();
    if (!t) throw new Error(`DSL: fin inattendue dans "${src}"`);
    if (t.t === 'REP') {
      p++;
      const body = parseProgram();
      expect('CLOSE');
      return { t: 'rep', n: t.n, body, sep: parseSep() };
    }
    const durs = [expect('DUR')];
    while (peek() && peek().t === 'SLASH') { p++; durs.push(expect('DUR')); }
    const code = expect('CODE');
    const sep = parseSep();
    if (durs.length === 1 && !sep) return mkStep(durs[0], code, 'work');
    return { t: 'ladder', durs: durs.map(d => routineParseDuration(d.v)), ...routineParseCode(code.v), sep };
  }
  function parseProgram() {
    const items = [parseItem()];
    while (peek() && peek().t === 'PLUS') { p++; items.push(parseItem()); }
    return items;
  }
  const tree = parseProgram();
  if (p < tokens.length) throw new Error(`DSL: reste de texte non lu dans "${src}"`);
  return tree;
}

// Aplatit l'arbre en étapes ordonnées (récup r/R seulement ENTRE répétitions).
function routineFlatten(nodes, out = []) {
  nodes.forEach(n => {
    if (n.t === 'step') { out.push({ ...n }); return; }
    if (n.t === 'ladder') {
      n.durs.forEach((sec, i) => {
        out.push({ t: 'step', sec, code: n.code, rpe: n.rpe, label: n.label, role: 'work' });
        if (i < n.durs.length - 1 && n.sep) out.push({ ...n.sep });
      });
      return;
    }
    for (let i = 0; i < n.n; i++) {
      routineFlatten(n.body, out);
      if (i < n.n - 1 && n.sep) out.push({ ...n.sep });
    }
  });
  return out;
}

// Compile une séance : étapes (avec rôle), durée exacte, temps qualitatif.
// opts.wuCd (défaut vrai) : une EF seule en tête / en queue d'une séance de
// qualité est un échauffement / retour au calme (comme l'export Garmin) ;
// faux pour les sorties longues et le trail où l'EF fait partie du corps.
function compileRoutineDsl(src, opts = {}) {
  const wuCd = opts.wuCd !== false;
  const tree = routineParseDsl(src);
  const steps = routineFlatten(tree);
  const isEasy = s => s.code !== 'RPE' && ROUTINE_EASY_CODES.includes(s.code);
  const hasQuality = steps.some(s => !isEasy(s));
  if (!hasQuality) {
    steps.forEach(s => { s.role = 'base'; });
  } else {
    steps.forEach(s => { if (s.role === 'work' && isEasy(s)) s.role = 'easy'; });
    if (wuCd) {
      const first = tree[0], last = tree[tree.length - 1];
      if (first.t === 'step' && isEasy(first)) steps[0].role = 'warmup';
      if (tree.length > 1 && last.t === 'step' && isEasy(last)) steps[steps.length - 1].role = 'cooldown';
    }
  }
  steps.forEach(s => {
    if (!(s.sec > 0)) throw new Error(`DSL: durée nulle dans "${src}"`);
  });
  if (steps[steps.length - 1].role === 'recovery' || steps[steps.length - 1].role === 'setRecovery') {
    throw new Error(`DSL: récupération en fin de séance dans "${src}"`);
  }
  const totalSec = steps.reduce((a, s) => a + s.sec, 0);
  const qualitySec = steps.filter(s => !isEasy(s)).reduce((a, s) => a + s.sec, 0);
  return { steps, totalSec, qualitySec, hasQuality };
}

// Étapes au format historique de free_sessions.js ({kind, duration, slug})
// pour réutiliser stepsToSession / annotatePaceZones / export Garmin tels
// quels. Récup entre répétitions et marche → RECOVER (grise côté Garmin).
function routineToLegacySteps(compiled) {
  return compiled.steps.map(s => {
    if (s.role === 'warmup')   return { kind: 'WARMUP', duration: s.sec, slug: 'ef' };
    if (s.role === 'cooldown') return { kind: 'COOLDOWN', duration: s.sec, slug: 'ef' };
    if (s.role === 'recovery' || s.role === 'setRecovery' || (s.code !== 'RPE' && ROUTINE_CODES[s.code].walk)) {
      return { kind: 'RECOVER', duration: s.sec, slug: 'slow' };
    }
    if (s.code === 'RPE') {
      const kind = s.rpe <= 3 ? 'Z2' : s.rpe <= 5 ? 'Z3' : s.rpe <= 7 ? 'Z4' : 'Z5';
      return { kind, duration: s.sec, slug: null, rpe: s.rpe, label: s.label };
    }
    const c = ROUTINE_CODES[s.code];
    return { kind: c.kind, duration: s.sec, slug: c.slug };
  });
}

// ─── Catalogue ───────────────────────────────────────────────────────────
// [id, nom, dsl, total attendu en minutes (cahier des charges ; null = séance
// reprise de l'existant, pas de total de référence)]
const ROUTINE_FAMILIES = [
  { id: '01', name: 'EF & récupération', terrain: ['road', 'trail'], access: 'faible', role: 'ef', wuCd: false, rows: [
    ['A01-01', 'EF continue 30', '30m EF', 30],
    ['A01-02', 'EF continue 40', '40m EF', 40],
    ['A01-03', 'EF continue 50', '50m EF', 50],
    ['A01-04', 'EF continue 60', '60m EF', 60],
    ['A01-05', 'EF progressive douce', '20m EFL + 20m EFH + 10m EFL', 50],
    ['A01-06', 'EF alternée', '4x(8m EFL + 2m EFH)', 40],
    ['A01-07', 'EF en terrain souple', '45m EF', 45],
    ['A01-08', 'EF récupération courte', '25m EFL', 25],
    ['A01-09', 'EF marche-course', '6x(4m EF + 1m WALK)', 30],
    ['A01-10', 'EF avec relances légères', '35m EF + 4x(15s STRIDE + 45s EF)', 39],
  ] },
  { id: '02', name: 'Tempo & endurance active', terrain: ['road', 'trail'], access: 'faible à modérée', role: 'quality', rows: [
    ['A02-01', 'Tempo fractionné 3×6', '15m EF + 3x(6m TEMPO) r2m EF + 10m EF', 47],
    ['A02-02', 'Tempo progressif', '15m EF + 10m EFH + 12m TEMPO + 10m EF', 47],
    ['A02-03', 'Tempo alterné 4×4', '15m EF + 4x(4m TEMPO + 2m EF) + 10m EF', 49],
    ['A02-04', 'Tempo pyramide 4/6/8', '15m EF + 4m/6m/8m TEMPO r2m EF + 10m EF', 47],
    ['A02-05', 'Tempo 2×12', '15m EF + 2x(12m TEMPO) r3m EF + 10m EF', 52],
    ['A02-06', 'Tempo dégressif', '15m EF + 8m/6m/4m TEMPO r2m EF + 10m EF', 47],
    ['A02-07', 'EF / Tempo escalier', '15m EF + 3x(5m EFH + 4m TEMPO) + 10m EF', 52],
    ['A02-08', 'Tempo en blocs 3×8', '15m EF + 3x(8m TEMPO) r2m EF + 10m EF', 53],
    ['A02-09', 'Tempo finish doux', '25m EF + 15m TEMPO + 10m EF', 50],
    ['A02-10', 'Tempo ludique', '15m EF + 2x(3m TEMPO + 3m EF + 5m TEMPO) R3m EF + 10m EF', 50],
  ] },
  { id: '03', name: 'Sweet Spot & S60', terrain: ['road'], access: 'modérée à haute', role: 'quality', rows: [
    ['A03-01', 'S60 3×6', '15m EF + 3x(6m S60) r2m EF + 10m EF', 47],
    ['A03-02', 'S60 3×8', '15m EF + 3x(8m S60) r2m EF + 10m EF', 53],
    ['A03-03', 'S60 2×10', '15m EF + 2x(10m S60) r3m EF + 10m EF', 48],
    ['A03-04', 'S60 pyramide', '15m EF + 6m/8m/10m S60 r3m EF + 10m EF', 55],
    ['A03-05', 'S60 2×12', '15m EF + 2x(12m S60) r3m EF + 10m EF', 52],
    ['A03-06', 'Sweet Spot continu', '15m EF + 18m SS + 10m EF', 43],
    ['A03-07', 'Sweet Spot 3×8', '15m EF + 3x(8m SS) r2m EF + 10m EF', 53],
    ['A03-08', 'S60 escalier 5/7/9', '15m EF + 5m/7m/9m S60 r3m EF + 10m EF', 52],
    ['A03-09', 'S60 dégressif 10/8/6', '15m EF + 10m/8m/6m S60 r3m EF + 10m EF', 55],
    ['A03-10', 'Sweet Spot puis S60', '15m EF + 10m SS + 3m EF + 8m S60 + 10m EF', 46],
    // reprises de l'existant (free_sessions.js)
    ['L03-01', 'Seuil court 4×5', '15m EF + 4x(5m S60) r1m30 EF + 10m EF', null, 'AS_LONG_01'],
    ['L03-02', 'Pyramide S60 2/4/6/4/2', '15m EF + 2m/4m/6m/4m/2m S60 r1m30 EF + 10m EF', null, 'PYR_02'],
    ['L03-03', 'Pyramide aérobie SS / S60 / AS10', '15m EF + 5m SS + 2m EF + 10m S60 + 2m EF + 5m AS10 + 10m EF', null, 'PYR_03'],
  ] },
  { id: '04', name: 'S30 & seuil soutenu', terrain: ['road'], access: 'haute', role: 'quality', rows: [
    ['A04-01', 'S30 5×3', '15m EF + 5x(3m S30) r2m EF + 10m EF', 48],
    ['A04-02', 'S30 4×4', '15m EF + 4x(4m S30) r2m EF + 10m EF', 47],
    ['A04-03', 'S30 5×4', '15m EF + 5x(4m S30) r2m EF + 10m EF', 53],
    ['A04-04', 'S30 3×5', '15m EF + 3x(5m S30) r3m EF + 10m EF', 46],
    ['A04-05', 'S30 6×2', '15m EF + 6x(2m S30) r1m30 EF + 10m EF', 44.5],
    ['A04-06', 'S30 pyramide 2/3/4/3/2', '15m EF + 2m/3m/4m/3m/2m S30 r2m EF + 10m EF', 47],
    ['A04-07', 'S30 dégressif 5/4/3', '15m EF + 5m/4m/3m S30 r3m EF + 10m EF', 43],
    ['A04-08', 'S30 en deux séries', '15m EF + 2x(3x(2m S30) r1m EF) R4m EF + 10m EF', 45],
    ['A04-09', 'S60 + S30', '15m EF + 8m S60 + 3m EF + 3x(3m S30) r2m EF + 10m EF', 49],
    ['A04-10', 'S30 en 4×3 / 2 séries', '15m EF + 2x(2x(3m S30) r2m EF) R4m EF + 10m EF', 45],
  ] },
  { id: '05', name: 'VMA & puissance aérobie', terrain: ['road'], access: 'haute', role: 'quality', rows: [
    ['A05-01', 'VMA 10×30/30', '15m EF + 10x(30s VMA + 30s EF) + 10m EF', 35],
    ['A05-02', 'VMA 12×30/30', '15m EF + 12x(30s VMA + 30s EF) + 10m EF', 37],
    ['A05-03', 'VMA 8×45/45', '15m EF + 8x(45s VMA + 45s EF) + 10m EF', 37],
    ['A05-04', 'VMA 8×1/1', '15m EF + 8x(1m VMA + 1m EF) + 10m EF', 41],
    ['A05-05', 'VMA 6×90/90', '15m EF + 6x(90s VMA + 90s EF) + 10m EF', 43],
    ['A05-06', 'VMA 5×2', '15m EF + 5x(2m VMA) r2m EF + 10m EF', 43],
    ['A05-07', 'VMA 4×3', '15m EF + 4x(3m VMA) r3m EF + 10m EF', 46],
    ['A05-08', 'VMA double 6×30/30', '15m EF + 2x(6x(30s VMA + 30s EF)) R4m EF + 10m EF', 41],
    ['A05-09', 'VMA pyramide courte', '15m EF + 30s/1m/90s/1m/30s VMA r90s EF + 10m EF', 36],
    ['A05-10', 'VMA 2 séries 4×1', '15m EF + 2x(4x(1m VMA) r1m EF) R4m EF + 10m EF', 43],
    // reprises de l'existant
    ['L05-01', 'VMA 10×45/30', '15m EF + 10x(45s VMA) r30s EF + 10m EF', null, 'VMA_SHORT_03'],
    ['L05-02', 'VMA dégressif court 40/30/20', '15m EF + 3x(40s VMA + 40s EF + 30s VMA + 30s EF + 20s VMA) R3m EF + 10m EF', null, 'VMA_SHORT_06'],
    ['L05-03', 'VMA 5×3', '15m EF + 5x(3m VMA) r1m30 EF + 10m EF', null, 'VMA_MID_02'],
    ['L05-04', 'VMA 4×4', '15m EF + 4x(4m VMA) r2m EF + 10m EF', null, 'VMA_MID_03'],
    ['L05-05', 'S30 3×5 (soutien VMA)', '15m EF + 3x(5m S30) r2m EF + 10m EF', null, 'VMA_MID_04'],
    ['L05-06', 'Séries 3-2-1 (S30 / VMA)', '15m EF + 3x(3m S30 + 1m30 EF + 2m VMA + 1m EF + 1m VMA) R3m EF + 10m EF', null, 'VMA_MID_05'],
    ['L05-07', 'Accélérations 8×45', '15m EF + 8x(45s VMA) r1m15 EF + 10m EF', null, 'FART_04'],
    // quasi-doublons du cahier des charges, gardés tels quels (à fusionner en variantes)
    ['L05-08', 'VMA double bloc 2×8×30/30', '15m EF + 2x(8x(30s VMA + 30s EF)) R3m EF + 10m EF', null, 'VMA_SHORT_02', 'A05-08'],
    ['L05-09', 'VMA double bloc 2×6×1/1', '15m EF + 2x(6x(1m VMA + 1m EF)) R3m EF + 10m EF', null, 'VMA_SHORT_04', 'A05-04'],
    ['L05-10', 'VMA 6×2/1', '15m EF + 6x(2m VMA) r1m EF + 10m EF', null, 'VMA_MID_01', 'A05-06'],
    ['L05-11', 'Pyramide VMA 1/2/3/2/1', '15m EF + 1m VMA + 30s EF + 2m VMA + 1m EF + 3m VMA + 1m30 EF + 2m VMA + 1m EF + 1m VMA + 10m EF', null, 'PYR_01', 'A05-09'],
  ] },
  { id: '06', name: 'Fartlek & allures changeantes', terrain: ['road', 'trail'], access: 'modérée', role: 'quality', rows: [
    ['A06-01', 'Fartlek 1/2/3/2/1', '15m EF + 1m/2m/3m/2m/1m TEMPO r2m EF + 10m EF', 42],
    ['A06-02', 'Fartlek 2×pyramide', '15m EF + 2x(1m/2m/3m TEMPO r1m EF) R3m EF + 10m EF', 44],
    ['A06-03', 'Fartlek 6×2/2', '15m EF + 6x(2m TEMPO + 2m EF) + 10m EF', 49],
    ['A06-04', 'Fartlek 3 intensités', '15m EF + 3x(3m TEMPO + 2m EF + 2m SS + 2m EF) + 10m EF', 52],
    ['A06-05', 'Fartlek escalier', '15m EF + 3m TEMPO + 2m EF + 4m TEMPO + 2m EF + 5m TEMPO + 10m EF', 41],
    ['A06-06', 'Fartlek inversé', '15m EF + 5m TEMPO + 2m EF + 4m TEMPO + 2m EF + 3m TEMPO + 10m EF', 41],
    ['A06-07', 'Fartlek 10×1/1', '15m EF + 10x(1m TEMPO + 1m EF) + 10m EF', 45],
    ['A06-08', 'Fartlek 4×(3/2)', '15m EF + 4x(3m SS + 2m EF) + 10m EF', 45],
    ['A06-09', 'Fartlek mix doux', '15m EF + 3x(4m EFH + 3m TEMPO + 2m EF) + 10m EF', 52],
    ['A06-10', 'Fartlek libre guidé', '15m EF + 25m RPE4:variations_terrain + 10m EF', 50],
  ] },
  { id: '07', name: 'AS42 & course longue', terrain: ['road'], access: 'modérée', role: 'quality', rows: [
    ['A07-01', 'AS42 2×12', '15m EF + 2x(12m AS42) r3m EF + 10m EF', 52],
    ['A07-02', 'AS42 3×10', '15m EF + 3x(10m AS42) r3m EF + 10m EF', 61],
    ['A07-03', 'AS42 20 continu', '20m EF + 20m AS42 + 10m EF', 50],
    ['A07-04', 'AS42 2×15', '20m EF + 2x(15m AS42) r4m EF + 10m EF', 64],
    ['A07-05', 'AS42 3×8', '15m EF + 3x(8m AS42) r2m EF + 10m EF', 53],
    ['A07-06', 'AS42 pyramidale', '15m EF + 8m/12m/8m AS42 r3m EF + 10m EF', 59],
    ['A07-07', 'AS42 active finish', '30m EF + 15m AS42 + 10m EF', 55],
    ['A07-08', 'AS42 densité douce', '20m EF + 4x(8m AS42) r2m EF + 10m EF', 68],
    ['A07-09', 'AS42 / Tempo', '15m EF + 10m TEMPO + 3m EF + 15m AS42 + 10m EF', 53],
    ['A07-10', 'AS42 relance contrôlée', '20m EF + 2x(10m AS42 + 5m EF) + 10m EF', 60],
  ] },
  { id: '08', name: 'AS21 & spécifique semi', terrain: ['road'], access: 'modérée à haute', role: 'quality', rows: [
    ['A08-01', 'AS21 3×6', '15m EF + 3x(6m AS21) r2m EF + 10m EF', 47],
    ['A08-02', 'AS21 3×8', '15m EF + 3x(8m AS21) r2m EF + 10m EF', 53],
    ['A08-03', 'AS21 2×12', '15m EF + 2x(12m AS21) r3m EF + 10m EF', 52],
    ['A08-04', 'AS21 2×15', '15m EF + 2x(15m AS21) r3m EF + 10m EF', 58],
    ['A08-05', 'AS21 pyramide 6/8/10', '15m EF + 6m/8m/10m AS21 r3m EF + 10m EF', 55],
    ['A08-06', 'AS21 / Tempo', '15m EF + 2x(6m TEMPO + 6m AS21) r3m EF + 10m EF', 52],
    ['A08-07', 'AS21 finish', '25m EF + 15m AS21 + 10m EF', 50],
    ['A08-08', 'AS21 double escalier', '15m EF + 2x(5m AS21 + 3m EF + 8m AS21) R4m EF + 10m EF', 61],
    ['A08-09', 'AS21 / Sweet Spot', '15m EF + 10m AS21 + 3m EF + 8m SS + 10m EF', 46],
    ['A08-10', 'AS21 continu 20', '15m EF + 20m AS21 + 10m EF', 45],
    // reprise de l'existant
    ['L08-01', 'Allure modérée 3×10', '15m EF + 3x(10m AS21) r2m30 EF + 10m EF', null, 'AS_LONG_03'],
  ] },
  { id: '09', name: 'AS10 & spécifique 10 km', terrain: ['road'], access: 'haute', role: 'quality', rows: [
    ['A09-01', 'AS10 5×3', '15m EF + 5x(3m AS10) r2m EF + 10m EF', 48],
    ['A09-02', 'AS10 4×4', '15m EF + 4x(4m AS10) r2m EF + 10m EF', 47],
    ['A09-03', 'AS10 3×5', '15m EF + 3x(5m AS10) r3m EF + 10m EF', 46],
    ['A09-04', 'AS10 5×4', '15m EF + 5x(4m AS10) r2m EF + 10m EF', 53],
    ['A09-05', 'AS10 2×8', '15m EF + 2x(8m AS10) r4m EF + 10m EF', 45],
    ['A09-06', 'AS10 pyramide', '15m EF + 3m/4m/5m/4m/3m AS10 r2m EF + 10m EF', 52],
    ['A09-07', 'AS10 dégressif', '15m EF + 6m/5m/4m AS10 r3m EF + 10m EF', 46],
    ['A09-08', 'AS10 / AS21 alterné', '15m EF + 3x(3m AS10 + 3m AS21 + 2m EF) + 10m EF', 49],
    ['A09-09', 'AS10 deux séries', '15m EF + 2x(3x(2m AS10) r1m EF) R4m EF + 10m EF', 45],
    ['A09-10', 'AS10 / S60 progressif', '15m EF + 8m S60 + 3m EF + 2x(4m AS10) r2m EF + 10m EF', 46],
    // reprises de l'existant
    ['L09-01', 'Mixte seuil / allure vive', '15m EF + 10m S60 + 3m EF + 2x(6m AS10) r2m EF + 10m EF', null, 'AS_LONG_05'],
    ['L09-02', 'Pyramide nature 1/2/3/4/3/2/1', '15m EF + 1m AS10 + 1m EF + 2m AS10 + 2m EF + 3m AS10 + 3m EF + 4m AS10 + 4m EF + 3m AS10 + 3m EF + 2m AS10 + 2m EF + 1m AS10 + 10m EF', null, 'FART_03'],
    ['L09-03', 'Over-under seuil / AS42', '15m EF + 10x(2m S60 + 1m AS42) + 10m EF', null, 'FART_01'],
    ['L09-04', 'Australienne 15×30/30', '15m EF + 15x(30s VMA + 30s TEMPO) + 10m EF', null, 'FART_02'],
  ] },
  { id: '10', name: 'Sorties longues actives', terrain: ['road'], access: 'modérée à haute', role: 'long', wuCd: false, rows: [
    ['A10-01', 'SL EF 70', '70m EF', 70],
    ['A10-02', 'SL EF 90', '90m EF', 90],
    ['A10-03', 'SL Tempo 2×10', '45m EF + 2x(10m TEMPO) r3m EF + 17m EF', 85],
    ['A10-04', 'SL Tempo 2×12', '45m EF + 2x(12m TEMPO) r3m EF + 18m EF', 90],
    ['A10-05', 'SL AS42 2×15', '45m EF + 2x(15m AS42) r3m EF + 12m EF', 90],
    ['A10-06', 'SL AS21 2×12', '40m EF + 2x(12m AS21) r3m EF + 23m EF', 90],
    ['A10-07', 'SL AS10 2×5', '45m EF + 2x(5m AS10) r3m EF + 32m EF', 90],
    ['A10-08', 'SL finish Tempo', '55m EF + 15m TEMPO + 10m EF', 80],
    ['A10-09', 'SL mix EA / AS21', '40m EF + 10m TEMPO + 3m EF + 10m AS21 + 17m EF', 80],
    ['A10-10', 'SL EF haute par paliers', '35m EF + 15m EFH + 5m EF + 15m EFH + 10m EF', 80],
    // reprises de l'existant (SL_EASY_01/02/04 = doublons de A01-03 / A01-04 / A10-02, non reprises)
    ['L10-01', 'SL EF 75', '75m EF', null, 'SL_EASY_03'],
    ['L10-02', 'SL progressive 40 EF + 20 AS42', '40m EF + 20m AS42 + 10m EF', null, 'SL_EASY_05'],
    ['L10-03', 'SL active AS21 3×8', '30m EF + 3x(8m AS21) r2m EF + 12m EF', null, 'SL_ACT_01'],
    ['L10-04', 'SL active S60 3×6', '35m EF + 3x(6m S60) r2m EF + 16m EF', null, 'SL_ACT_02'],
    ['L10-05', 'SL active AS42 30 continu', '25m EF + 30m AS42 + 20m EF', null, 'SL_ACT_03'],
    ['L10-06', 'SL active AS21 2×15', '30m EF + 2x(15m AS21) r3m EF + 27m EF', null, 'SL_ACT_04'],
    ['L10-07', 'SL combo SS 15 / S60 10', '30m EF + 15m SS + 3m EF + 10m S60 + 2m EF + 30m EF', null, 'SL_ACT_05'],
    ['L10-08', 'SL active AS42 2×25', '20m EF + 2x(25m AS42) r5m EF + 15m EF', null, 'SL_ACT_06'],
    ['L10-09', 'SL pyramide AS42 / SS / S60', '25m EF + 15m AS42 + 10m SS + 5m S60 + 29m EF', null, 'SL_ACT_07'],
  ] },
  { id: '11', name: 'Côtes route & trail', terrain: ['road', 'trail'], access: 'modérée à haute', role: 'quality', rows: [
    ['A11-01', 'Côtes 8×30″', '15m EF + 8x(30s RPE7:cote + 90s EF) + 10m EF', 41],
    ['A11-02', 'Côtes 10×45″', '15m EF + 10x(45s RPE7:cote + 75s EF) + 10m EF', 45],
    ['A11-03', 'Côtes 6×1′', '15m EF + 6x(1m RPE7:cote + 2m EF) + 10m EF', 43],
    ['A11-04', 'Côtes 5×2′', '15m EF + 5x(2m RPE6:cote + 3m EF) + 10m EF', 50],
    ['A11-05', 'Côtes 4×3′', '15m EF + 4x(3m RPE6:cote + 3m EF) + 10m EF', 49],
    ['A11-06', 'Côtes marche active', '15m EF + 5x(4m RPE5:marche_montante + 3m EF) + 10m EF', 60],
    ['A11-07', 'Côtes progressives', '15m EF + 4x(2m RPE5:cote + 1m RPE6:cote + 3m EF) + 10m EF', 49],
    ['A11-08', 'Côtes en escalier', '15m EF + 1m/2m/3m/2m/1m RPE6:cote r3m EF + 10m EF', 46],
    ['A11-09', 'Côtes double série', '15m EF + 2x(3x(1m RPE7:cote + 2m EF)) R4m EF + 10m EF', 47],
    ['A11-10', 'Côtes technicité', '15m EF + 30m RPE4:sentier_technique + 10m EF', 55],
  ] },
  { id: '12', name: 'Trail / SL terrain et blocs mixtes', terrain: ['trail'], access: 'modérée', role: 'long', wuCd: false, rows: [
    ['A12-01', 'Trail facile 75', '75m EF', 75],
    ['A12-02', 'Trail facile 90', '90m EF', 90],
    ['A12-03', 'Trail montées marche', '20m EF + 4x(5m RPE5:montee_marche + 4m EF) + 14m EF', 70],
    ['A12-04', 'Trail montées course', '20m EF + 4x(4m RPE6:cote + 5m EF) + 14m EF', 70],
    ['A12-05', 'Trail alternance terrain', '20m EF + 3x(8m RPE4:vallonne + 5m EF) + 11m EF', 70],
    ['A12-06', 'Trail 2 longs blocs', '20m EF + 2x(15m RPE5:montee_reguliere) R8m EF + 12m EF', 70],
    ['A12-07', 'Trail technique facile', '25m EF + 25m RPE3:technique_descente + 20m EF', 70],
    ['A12-08', 'Trail progression D+', '80m EF', 80],
    ['A12-09', 'Trail SL active', '35m EF + 2x(10m RPE5:montee + 6m EF) + 13m EF', 80],
    ['A12-10', 'Trail simulation mixte', '20m EF + 3x(6m RPE5:marche_montee + 6m RPE4:roulant + 4m EF) + 12m EF', 80],
  ] },
];

// Familles route seulement : décision à trancher (rouvrir au trail sur terrain
// plat/roulant ?) — marquées pour pouvoir le faire sans toucher aux fiches.
const ROUTINE_TRAIL_REOPENABLE_FAMILIES = ['03', '04', '05', '07', '08', '09', '10'];

// Séances notes libres (sans structure chiffrée) : l'application affiche la
// consigne, le D+ / terrain est individualisé à la génération.
const ROUTINE_FREE_TERRAIN_IDS = ['A01-07', 'A12-01', 'A12-02', 'A12-08'];

// Catalogue à plat : une fiche = un objet.
const ROUTINE_CATALOG = ROUTINE_FAMILIES.flatMap(fam => fam.rows.map(([id, name, dsl, statedMin, legacyKey, nearDuplicateOf]) => ({
  id, name, dsl, statedMin,
  family: fam.id, familyName: fam.name,
  terrain: fam.terrain,
  access: fam.access,
  role: fam.role,
  wuCd: fam.wuCd !== false,
  source: id.startsWith('L') ? 'existant' : 'cahier',
  legacyKey: legacyKey || null,
  nearDuplicateOf: nearDuplicateOf || null,
  trailReopenable: ROUTINE_TRAIL_REOPENABLE_FAMILIES.includes(fam.id),
  freeTerrain: ROUTINE_FREE_TERRAIN_IDS.includes(id),
})));

const _routineCompiledCache = {};
function getRoutineCompiled(model) {
  if (!_routineCompiledCache[model.id]) _routineCompiledCache[model.id] = compileRoutineDsl(model.dsl, { wuCd: model.wuCd });
  return _routineCompiledCache[model.id];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ROUTINE_CODES, ROUTINE_FAMILIES, ROUTINE_CATALOG,
    compileRoutineDsl, routineParseDsl, routineToLegacySteps, getRoutineCompiled,
  };
}
