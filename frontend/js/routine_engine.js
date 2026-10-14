// ============================================================
// routine_engine.js — Moteur de routines "hors plan" (lot P1)
// Cahier des charges : routines perpétuelles S1→S4, profil, volume EF,
// sélection sûre dans le catalogue (routine_catalog.js).
//
// Fonctions PURES (aucun accès au DOM ni au stockage) pour rester testables
// sous Node (tests/routine_engine.test.js). La persistance des semaines
// générées et l'affichage sont dans free_sessions.js.
//
// Principe : une semaine n'est générée qu'UNE FOIS, au moment où on en a
// besoin, puis figée (free_sessions.js) — le moteur tient compte de
// l'historique et de la forme du moment, donc régénérer une semaine passée
// donnerait un autre résultat. Tous les seuils sont dans ROUTINE_RULES :
// premiers réglages à recalibrer sur des retours réels (cf. cahier des
// charges §15, "à calibrer sur données réelles").
// ============================================================

const RoutineEngine = (function () {
const _RC = (typeof module !== 'undefined' && module.exports)
  ? require('./routine_catalog.js')
  : { ROUTINE_CATALOG, getRoutineCompiled, routineToSessionStructure, routineParseDsl, compileRoutineDsl, routineTreeToDsl };

const ROUTINE_RULES = {
  // niveau déduit des 6 dernières semaines de course
  levelWindowDays: 42,
  level1Max: { weeklyMin: 60, runsPerWeek: 1.5 },        // en dessous : niveau 1
  level3Min: { weeklyMin: 150, runsPerWeek: 3, longestMin: 75 }, // au dessus : niveau 3
  // paliers de charge d'une séance (score = minutes × poids d'intensité)
  tierLightMax: 22, tierModerateMax: 38,
  // charge hors course (minutes d'autres sports sur 7 jours)
  otherMinCapModerate: 300, otherMinCapLight: 480,
  // course très récente : pas de qualité si une séance dure date de moins de ...
  hardGapHours: 40,
  recencyWeeks: 16,          // une fiche déjà proposée il y a moins de N semaines est évitée
  defaultMaxMin: 90,
  // pré-préparation avant un plan (cahier des charges §11) : horizons en
  // semaines AVANT le début du plan, jamais figés (cf. routinePlanHorizon)
  plan: { longWeeks: 12, interWeeks: 6, closeWeeks: 3, finalWeeks: 2, shortPlanWeeks: 8, gapRatio: 1.25 },
  // durée type d'un plan Allure+ par distance (semaines) : sert à dire "c'est
  // le bon moment pour charger un plan" quand une course est envisagée
  typicalPlanWeeks: { '5k': 8, '10k': 10, semi: 12, marathon: 16, trail: 16 },
  efBounds: [30, 60], slBounds: [60, 150],
};

const ROUTINE_WEIGHTS = { TEMPO: 1, AS42: 1.4, SS: 1.6, AS21: 1.8, S60: 2, AS10: 2.4, S30: 2.8, VMA: 3.2 };
function routineRpeWeight(rpe) { return rpe <= 3 ? 0.6 : rpe === 4 ? 0.9 : rpe === 5 ? 1.2 : rpe === 6 ? 2 : 2.8; }

// Familles à haute intensité : réservées aux niveaux 2+ (3 pour le palier dur)
const ROUTINE_HIGH_FAMILIES = ['04', '05', '09'];

// ─── Phases S1→S4 ────────────────────────────────────────────────────────
function routinePhaseOf(weekNum) {
  const idx = ((weekNum - 1) % 4 + 4) % 4;
  return { idx, phase: 'S' + (idx + 1), blockIdx: Math.floor((weekNum - 1) / 4) };
}

// ─── Charge d'une fiche ──────────────────────────────────────────────────
// { score, tier 0|1|2, mainCode } — calculé une fois par fiche.
const _routineLoadCache = {};
function routineModelLoad(model) {
  if (_routineLoadCache[model.id]) return _routineLoadCache[model.id];
  const c = _RC.getRoutineCompiled(model);
  let score = 0;
  const counts = {};
  c.steps.forEach(s => {
    if (s.role === 'warmup' || s.role === 'cooldown' || s.role === 'recovery' || s.role === 'setRecovery') return;
    const min = s.sec / 60;
    if (s.code === 'RPE') { score += min * routineRpeWeight(s.rpe); counts['RPE' + s.rpe] = (counts['RPE' + s.rpe] || 0) + s.sec; }
    else if (ROUTINE_WEIGHTS[s.code]) { score += min * ROUTINE_WEIGHTS[s.code]; counts[s.code] = (counts[s.code] || 0) + s.sec; }
  });
  const mainCode = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  let tier = score < ROUTINE_RULES.tierLightMax ? 0 : score < ROUTINE_RULES.tierModerateMax ? 1 : 2;
  if (['VMA', 'S30', 'AS10'].includes(mainCode)) tier = Math.max(tier, 1);
  const out = { score: Math.round(score), tier, mainCode, totalMin: c.totalSec / 60, qualityMin: c.qualitySec / 60 };
  _routineLoadCache[model.id] = out;
  return out;
}

// ─── Niveau & volume à partir des activités Garmin ───────────────────────
const _RUN_TYPE = /run/i;      // running, trail_running, treadmill_running...
function _toMs(d) { return typeof d === 'number' ? d : new Date(String(d).replace(' ', 'T')).getTime(); }
function _median(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function _round5(x) { return Math.round(x / 5) * 5; }
function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// acts : [{ date, durationSec, activityType }] (format /api/dashboard allActivities)
function routineAssessProfile(acts, now = Date.now(), maxMin = ROUTINE_RULES.defaultMaxMin) {
  const R = ROUTINE_RULES;
  const from = now - R.levelWindowDays * 86400000;
  const list = (acts || []).map(a => ({ t: _toMs(a.date), min: (a.durationSec || 0) / 60, run: _RUN_TYPE.test(a.activityType || '') }))
    .filter(a => isFinite(a.t) && a.t >= from && a.t <= now);
  const runs = list.filter(a => a.run && a.min >= 10);
  const weeks = R.levelWindowDays / 7;
  const weeklyMin = runs.reduce((s, a) => s + a.min, 0) / weeks;
  const runsPerWeek = runs.length / weeks;
  const longestMin = runs.reduce((m, a) => Math.max(m, a.min), 0);
  let level = 2;
  if (weeklyMin < R.level1Max.weeklyMin || runsPerWeek < R.level1Max.runsPerWeek) level = 1;
  else if (weeklyMin >= R.level3Min.weeklyMin && runsPerWeek >= R.level3Min.runsPerWeek && longestMin >= R.level3Min.longestMin) level = 3;
  const medianRun = _median(runs.map(a => a.min));
  const efTarget = _clamp(_round5(medianRun || 45), R.efBounds[0], R.efBounds[1]);
  const slTarget = _clamp(_round5(Math.max(longestMin * 0.95, efTarget * 1.5) || 75), R.slBounds[0], Math.max(R.slBounds[0], maxMin));
  const d7 = now - 7 * 86400000;
  const otherMin7 = list.filter(a => !a.run && a.t >= d7 && a.min >= 20).reduce((s, a) => s + a.min, 0);
  const lastHard = runs.filter(a => a.min >= 50).reduce((m, a) => Math.max(m, a.t), 0);
  return {
    level, weeklyMin: Math.round(weeklyMin), runsPerWeek: Math.round(runsPerWeek * 10) / 10,
    longestMin: Math.round(longestMin), efTarget, slTarget, otherMin7: Math.round(otherMin7),
    hoursSinceLongRun: lastHard ? (now - lastHard) / 3600000 : null,
    hasData: runs.length >= 3,
  };
}

// ─── Aléatoire reproductible ─────────────────────────────────────────────
function _rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ─── Éligibilité ─────────────────────────────────────────────────────────
// ctx : { terrain, maxMin, level, tierCap }
function routineEligible(model, ctx, opts = {}) {
  if (!model.terrain.includes(ctx.terrain) && !(ctx.terrain === 'trail' && ctx.trailRoadFamilies && model.trailReopenable)) return false;
  const load = routineModelLoad(model);
  if (load.totalMin > (opts.maxMin || ctx.maxMin)) return false;
  if (opts.maxTier != null && load.tier > opts.maxTier) return false;
  if (ctx.level <= 1) {
    if (ROUTINE_HIGH_FAMILIES.includes(model.family)) return false;
    if (load.tier >= 2) return false;
    if (model.family === '10' && load.qualityMin > 0 && load.tier >= 1) return false;
  }
  if (ctx.level <= 2 && ROUTINE_HIGH_FAMILIES.includes(model.family) && load.tier >= 2) return false;
  if (model.id === 'A01-09' && ctx.level >= 3) return false;   // marche-course : pour débuter
  return true;
}

// ─── Pré-préparation avant un plan ou une course ─────────────────────────
// Familles de séances utiles à chaque cible (orientation douce, jamais exclusive)
const ROUTINE_TARGET_FAMILIES = {
  '5k': ['04', '05', '09', '03'], '10k': ['09', '04', '03', '05'], semi: ['08', '03', '07'],
  marathon: ['07', '08', '10'], trail: ['11', '12', '02', '06'],
};

// Horizon de pré-préparation selon le temps restant avant le début du plan.
// Seuils paramétrables (ROUTINE_RULES.plan) : un plan court raccourcit les
// horizons ; une première semaine de plan bien plus chargée que la routine
// actuelle les allonge (il faut le temps d'y arriver).
// plan : { totalWeeks, week1Min }, profile : { weeklyMin }
function routinePlanHorizon(weeksToStart, plan, profile) {
  const P = ROUTINE_RULES.plan;
  let long = P.longWeeks, inter = P.interWeeks, close = P.closeWeeks;
  const final = P.finalWeeks;
  if (plan && plan.totalWeeks && plan.totalWeeks <= P.shortPlanWeeks) { long = Math.max(8, long - 2); inter = Math.max(4, inter - 1); }
  const gap = plan && plan.week1Min && profile && profile.weeklyMin ? plan.week1Min / Math.max(60, profile.weeklyMin) : 1;
  if (gap > P.gapRatio) { close += 1; inter += 2; long += 2; }
  const name = weeksToStart <= final ? 'final' : weeksToStart <= close ? 'close' : weeksToStart <= inter ? 'intermediate' : 'long';
  return { name, weeksToStart, gap: Math.round(gap * 100) / 100, bounds: { long, inter, close, final } };
}

// Course envisagée mais aucun plan choisi : on oriente doucement, sans promettre
// une préparation ciblée, et on dit quand charger un plan.
function routineRaceAdvice(weeksToRace, distKey) {
  const typical = ROUTINE_RULES.typicalPlanWeeks[distKey] || 12;
  return { typical, recommendNow: weeksToRace <= typical + 2, weeksUntilPlan: Math.max(0, weeksToRace - typical) };
}

// ─── Choix pondéré dans une liste de candidats ───────────────────────────
function _pick(cands, history, rand, wantFamilyNot = [], prefer = []) {
  if (!cands.length) return null;
  const recent = new Map();   // id → semaines écoulées depuis la dernière proposition
  const famRecent = new Map();
  history.forEach(h => {
    (h.sessions || []).forEach(s => {
      if (!recent.has(s.modelId) || recent.get(s.modelId) > h.age) recent.set(s.modelId, h.age);
      if (s.slot === 'Q1' || s.slot === 'SL') {
        const k = s.slot + s.family;
        if (!famRecent.has(k) || famRecent.get(k) > h.age) famRecent.set(k, h.age);
      }
    });
  });
  const scored = cands.map(m => {
    let sc = rand() * 1.5;
    const age = recent.get(m.id);
    if (age != null) sc -= (ROUTINE_RULES.recencyWeeks - age + 1) * 1.2;
    if (wantFamilyNot.includes(m.family)) sc -= 3;
    if (prefer.includes(m.family)) sc += 2.5;
    return { m, sc };
  }).sort((a, b) => b.sc - a.sc);
  return scored[0].m;
}

// ─── Génération d'une semaine ────────────────────────────────────────────
// prefs : { terrain, frequency, maxMin, anchorMonday }
// ctx   : profil (routineAssessProfile) + history [{ age, sessions:[{modelId, slot, family}] }]
function routineGenerateWeek(prefs, weekNum, ctx) {
  const R = ROUTINE_RULES;
  let { idx: phaseIdx, phase } = routinePhaseOf(weekNum);
  const terrain = prefs.terrain === 'trail' ? 'trail' : 'road';
  const freq = _clamp(prefs.frequency || 3, 2, 6);
  const maxMin = prefs.maxMin || R.defaultMaxMin;
  const level = ctx.level || 2;
  const history = ctx.history || [];
  const rand = _rng((prefs.anchorMonday || 0) / 1000 + weekNum * 7919);
  const notes = [], warnings = [];

  // Plan Allure+ à venir : la routine s'efface à sa date de début. Les derniers
  // temps sont une transition (jamais un pic de forme) : dernière semaine
  // allégée, avant-dernière sans palier dur.
  const plan = ctx.plan && ctx.plan.weeksToStart >= 1 ? ctx.plan : null;
  const horizon = plan ? routinePlanHorizon(plan.weeksToStart, plan, ctx) : null;
  const transition = !!(horizon && horizon.name === 'final' && plan.weeksToStart === 1);
  if (transition) { phaseIdx = 3; phase = 'S4'; }
  const race = !plan && ctx.race && ctx.race.weeksToRace >= 1 ? ctx.race : null;
  const targetKey = plan ? plan.targetKey : race ? race.targetKey : null;
  const prefer = (plan && ['intermediate', 'close'].includes(horizon.name)) || (race && race.weeksToRace <= 20)
    ? (ROUTINE_TARGET_FAMILIES[targetKey] || []) : [];

  // palier cible selon la phase, plafonné par le niveau et la charge hors course
  let target = phaseIdx === 0 ? 0 : phaseIdx === 1 ? 1 : phaseIdx === 2 ? 2 : 0;
  let cap = level >= 3 ? 2 : level === 2 ? 2 : 1;
  const other = ctx.otherMin7 || 0;
  if (other >= R.otherMinCapLight) { cap = 0; warnings.push('Beaucoup d\'autres activités cette semaine : la séance de qualité est allégée.'); }
  else if (other >= R.otherMinCapModerate) { cap = Math.min(cap, 1); notes.push('Autres activités importantes récemment : charge de la séance de qualité limitée.'); }
  if (ctx.hoursSinceLongRun != null && ctx.hoursSinceLongRun < R.hardGapHours) { cap = Math.min(cap, 1); }
  if (horizon && (horizon.name === 'close' || horizon.name === 'final')) {
    cap = Math.min(cap, 1);
    if (!transition) notes.push(horizon.name === 'final'
      ? 'Plus que 2 semaines avant ton plan : pas de séance très exigeante, on arrive frais.'
      : 'Ton plan approche : pas de nouveauté ni de semaine très chargée, on stabilise.');
  }
  if (transition) notes.push('Dernière semaine avant ton plan : charge allégée pour l\u2019aborder en forme.');
  if (ctx.caution) { cap = Math.min(cap, 1); notes.push('Gêne ou fatigue signalée : séances limitées au palier modéré, variantes plus exigeantes bloquées.'); }
  target = Math.min(target, cap);
  if (ctx.prevExcess > 0.2 && phaseIdx !== 3 && target > 0) { target -= 1; notes.push('La semaine dernière était plus chargée que prévu : palier ramené d\u2019un cran.'); }
  const isRecup = phase === 'S4';

  let efTarget = ctx.efTarget || 45, slTargetBase = ctx.slTarget || 75;
  if (horizon && ['intermediate', 'close'].includes(horizon.name) && plan.longestMin && plan.longestMin * 0.85 > slTargetBase) {
    slTargetBase = _round5(Math.min(plan.longestMin * 0.85, slTargetBase + 10));      // se rapproche des sorties longues du plan
  }
  if (horizon && ['close', 'final'].includes(horizon.name) && horizon.gap > ROUTINE_RULES.plan.gapRatio) efTarget = Math.min(efTarget + 5, ROUTINE_RULES.efBounds[1]);
  if (plan) {
    if (plan.sessionsPerWeek && plan.sessionsPerWeek > freq) notes.push('Ton plan comporte ' + plan.sessionsPerWeek + ' séances par semaine (tu en as ' + freq + ' ici) : pense à augmenter peu à peu.');
    if (plan.isTrail && terrain !== 'trail') notes.push('Ton plan est un plan Trail : passe ta routine en Trail pour t\u2019y préparer.');
    if (horizon.gap > ROUTINE_RULES.plan.gapRatio && ['intermediate', 'close'].includes(horizon.name)) notes.push('La première semaine de ton plan est plus chargée que ta routine actuelle : on monte progressivement le volume.');
  }
  if (race) {
    const adv = routineRaceAdvice(race.weeksToRace, race.targetKey);
    notes.push(adv.recommendNow
      ? 'Ta course est dans ' + race.weeksToRace + ' semaines : c\u2019est le bon moment de charger un plan Allure+ (Plans d\u2019entraînement). Cette routine ne prépare pas une course de façon ciblée.'
      : 'Ta routine entretient ta base ; un plan Allure+ sera à charger dans environ ' + adv.weeksUntilPlan + ' semaines pour ta course.');
  }

  const pool = _RC.ROUTINE_CATALOG;
  const ec = { terrain, maxMin, level, trailRoadFamilies: !!ctx.trailRoadFamilies };
  const sessions = [];
  const lastQ1Fam = history.filter(h => h.age <= 2).flatMap(h => (h.sessions || []).filter(s => s.slot === 'Q1').map(s => s.family));

  // — qualité principale (Q1) : choisie en premier (palier cible), jamais la même famille d'affilée
  let q1 = null;
  if (freq >= 3 || !isRecup) {
    const q1Pool = pool.filter(m => m.role === 'quality' && routineEligible(m, ec, { maxTier: target }));
    let cands = q1Pool.filter(m => routineModelLoad(m).tier === target);
    if (isRecup) {
      cands = q1Pool.filter(m => routineModelLoad(m).tier === 0 && routineModelLoad(m).totalMin <= 45);
      if (!cands.length) cands = q1Pool.filter(m => routineModelLoad(m).tier === 0);
    }
    if (!cands.length) cands = q1Pool.filter(m => routineModelLoad(m).tier >= Math.max(0, target - 1));
    if (!cands.length) cands = q1Pool;
    if (horizon && ['close', 'final'].includes(horizon.name)) {
      const seen = new Set(history.filter(h => h.age <= 12).flatMap(h => (h.sessions || []).map(x => x.family)));
      const familiar = cands.filter(m => seen.has(m.family));
      if (familiar.length) cands = familiar;                  // pas de famille jamais pratiquée juste avant le plan
    }
    q1 = freq === 2 ? null : _pick(cands, history, rand, lastQ1Fam, prefer);
  }

  // — sortie longue : EF seule, ou "active" (blocs à allure : compte comme qualité).
  // Active seulement en S2/S3 et niveau 2+ ; légère si Q1 est déjà très exigeante
  // (jamais deux grosses qualités dans la semaine), nulle en S4.
  const slPool = pool.filter(m => (terrain === 'trail' ? (m.family === '12' || (ctx.trailRoadFamilies && m.family === '10')) : m.family === '10') && routineEligible(m, ec, { maxMin: Math.max(maxMin, 60) }));
  const slTarget = slTargetBase;
  const slDur = isRecup ? Math.max(60, _round5(slTarget * 0.75)) : slTarget;
  const slNear = list => list.filter(m => Math.abs(routineModelLoad(m).totalMin - slDur) <= 20);
  const slEf = slPool.filter(m => routineModelLoad(m).qualityMin === 0);
  const slActive = slPool.filter(m => routineModelLoad(m).qualityMin > 0);
  // à 3 sorties avec une qualité déjà prévue, une SL active ferait 2 séances de
  // qualité sur 3 : réservé au niveau 3 (cahier des charges §6 : EF = socle)
  const wantActive = !isRecup && level >= 2 && (phaseIdx === 1 || phaseIdx === 2) && cap >= 1
    && (!q1 || freq >= 4 || level >= 3);
  const slMaxTier = (q1 && routineModelLoad(q1).tier >= 2) || phaseIdx === 1 ? 0 : 1;
  let slCands = [], slActiveChosen = false;
  if (wantActive) {
    const act = slActive.filter(m => routineModelLoad(m).tier <= slMaxTier);
    slCands = slNear(act);
    if (!slCands.length) slCands = act.filter(m => routineModelLoad(m).totalMin <= slDur + 20);
    slActiveChosen = slCands.length > 0;
  }
  if (!slActiveChosen) {
    const limit = isRecup ? Math.max(60, _round5(slTarget * 0.8)) : slDur + 10;
    slCands = slNear(slEf).filter(m => routineModelLoad(m).totalMin <= limit);
    if (!slCands.length) slCands = slEf.filter(m => routineModelLoad(m).totalMin <= limit);
    if (!slCands.length) slCands = slEf.slice().sort((a, b) => routineModelLoad(a).totalMin - routineModelLoad(b).totalMin).slice(0, 2);
  }
  let sl = _pick(slCands, history, rand);
  if (!sl) {
    // temps disponible trop court pour une vraie sortie longue : la plus longue EF qui tient
    const efLong = pool.filter(m => m.family === '01' && routineModelLoad(m).totalMin <= maxMin)
      .sort((a, b) => routineModelLoad(b).totalMin - routineModelLoad(a).totalMin);
    sl = efLong[0] || null;
    if (sl) notes.push('Temps disponible court : la « sortie longue » est ta plus longue EF possible.');
  }

  // — qualité secondaire (Q2s) : seulement si la SL n'est pas active, légère, autre famille
  let q2 = null;
  if (freq >= 4 && !isRecup && !slActiveChosen) {
    const c2 = pool.filter(m => m.role === 'quality' && ['02', '06', '11'].includes(m.family) && m.family !== (q1 && q1.family)
      && routineEligible(m, ec, { maxTier: 0 }) && m.id !== (q1 && q1.id));
    q2 = _pick(c2, history, rand);
  }

  // — EF : durée proche du volume habituel, variantes pour ne pas toujours proposer pareil
  const efNeed = freq - (sl ? 1 : 0) - (q1 ? 1 : 0) - (q2 ? 1 : 0);
  const efBase = pool.filter(m => m.family === '01' && routineEligible(m, ec, { maxMin }));
  const efs = [];
  for (let i = 0; i < efNeed; i++) {
    const want = efTarget - (i > 0 ? 5 : 0);
    const used = new Set(efs.map(m => m.id));
    let cands = efBase.filter(m => !used.has(m.id) && Math.abs(routineModelLoad(m).totalMin - want) <= 10 && routineModelLoad(m).totalMin >= 30);
    if (level >= 2 && i > 0) cands = cands.concat(efBase.filter(m => !used.has(m.id) && m.id === 'A01-08'));
    if (!cands.length) cands = efBase.filter(m => !used.has(m.id));
    efs.push(_pick(cands, history, rand));
  }

  // — ordre : EF / Q1 / EF / Q2 / EF / SL (la SL ferme la semaine, repère fixe)
  const seq = [];
  const efQ = [...efs];
  if (q1) { if (efQ.length) seq.push(['EF', efQ.shift()]); seq.push(['Q1', q1]); }
  if (q2) { if (efQ.length) seq.push(['EF', efQ.shift()]); seq.push(['Q2', q2]); }
  efQ.forEach(m => seq.push(['EF', m]));
  if (sl) seq.push(['SL', sl]);

  seq.forEach(([slot, m], i) => {
    const load = routineModelLoad(m);
    sessions.push({
      slot, modelId: m.id, name: m.name, dsl: m.dsl, family: m.family, role: m.role, wuCd: m.wuCd,
      terrain, variant: 'yellow', trainingIndex: i,
      totalSec: Math.round(load.totalMin * 60), qualitySec: Math.round(load.qualityMin * 60), tier: load.tier, baseDsl: m.dsl, load: routineLoadValue(load),
    });
  });

  const qualityCount = sessions.filter(s => s.qualitySec > 0 && s.tier >= 0 && s.role !== 'ef').length;
  const hardCount = sessions.filter(s => s.tier >= 2).length;
  if (hardCount > 1) warnings.push('Deux séances très exigeantes dans la même semaine.');
  return { weekNum, phase, phaseIdx, target, cap, level, caution: !!ctx.caution,
    plan: plan ? { name: plan.name || null, weeksToStart: plan.weeksToStart, horizon: horizon.name, transition } : null,
    race: race ? { name: race.name || null, weeksToRace: race.weeksToRace, recommendNow: routineRaceAdvice(race.weeksToRace, race.targetKey).recommendNow } : null, qualityCount, hardCount, sessions, notes, warnings, generatedAt: Date.now() };
}

// ─── Variantes vert / jaune / orange / rouge (cahier des charges §8) ─────
// Jaune = la fiche telle que générée. On part TOUJOURS de `baseDsl` (jamais
// d'une variante déjà modifiée) : vert = moins de travail, orange = un
// paramètre de plus (répétition ou durée de bloc), rouge = deux crans, sous
// plafonds par allure. La nature de la séance ne change jamais (même code
// d'allure, mêmes récupérations) ; les allures restent celles du profil.
const ROUTINE_VARIANT_ORDER = ['green', 'yellow', 'orange', 'red'];
const ROUTINE_VARIANT_LABEL = { green: 'Vert', yellow: 'Jaune', orange: 'Orange', red: 'Rouge' };
// minutes de travail cumulées maximum par code d'allure dans une séance
// (premiers réglages, à recalibrer — cahier des charges §15)
const ROUTINE_WORK_CAP_MIN = { TEMPO: 70, AS42: 60, SS: 45, AS21: 50, S60: 45, AS10: 35, S30: 28, VMA: 22, RPE4: 60, RPE5: 50, RPE6: 35, RPE7: 18, RPE8: 12 };
const _EASY_CODES = ['EF', 'EFL', 'EFH', 'WALK', 'STRIDE'];

function routineLoadValue(l) { return Math.round(l.score + 0.25 * l.totalMin); }

function _isWorkNode(n) { return n.code === 'RPE' || !_EASY_CODES.includes(n.code); }
function _workSec(n) {
  if (n.t === 'step') return _isWorkNode(n) ? n.sec : 0;
  if (n.t === 'ladder') return _isWorkNode(n) ? n.durs.reduce((a, b) => a + b, 0) : 0;
  return n.n * n.body.reduce((a, b) => a + _workSec(b), 0);
}
function _totalSecNode(n) {
  if (n.t === 'step') return n.sec;
  if (n.t === 'ladder') return n.durs.reduce((a, b) => a + b, 0) + (n.sep ? n.sep.sec * (n.durs.length - 1) : 0);
  return n.n * n.body.reduce((a, b) => a + _totalSecNode(b), 0) + (n.sep ? n.sep.sec * (n.n - 1) : 0);
}
function _scaleSec(sec, f, unit) {
  let r = Math.round(sec * f / unit) * unit;
  if (r === sec) r = sec + (f > 1 ? unit : -unit);
  return Math.max(unit, r);
}
// nombre de répétitions : +1/-1 ; au-delà de 6 répétitions (courts), +2/-2 ; rouge = deux crans
function _repAdj(n, mode) {
  const big = n >= 6;
  if (mode === 'green') return Math.max(2, n - (big ? 2 : 1));
  if (mode === 'orange') return n + (big ? 2 : 1);
  return n + (big ? 4 : 2);
}
const _FACTOR = { green: 0.8, orange: 1.2, red: 1.4 };

function _varyNode(n, mode) {
  const f = _FACTOR[mode];
  if (n.t === 'step') {
    if (!_isWorkNode(n)) return n;
    return { ...n, sec: _scaleSec(n.sec, f, n.sec >= 180 ? 60 : 30) };
  }
  if (n.t === 'ladder') {
    if (!_isWorkNode(n)) return n;
    const unit = Math.max(...n.durs) >= 180 ? 60 : 30;
    return { ...n, durs: n.durs.map(d => _scaleSec(d, f, unit)) };
  }
  // répétition
  if (n.body.some(b => b.t === 'rep') && n.n <= 2) return { ...n, body: n.body.map(b => (b.t === 'rep' ? _varyNode(b, mode) : b)) };
  if (n.n >= 3) return { ...n, n: _repAdj(n.n, mode) };
  return { ...n, body: n.body.map(b => (b.t === 'step' || b.t === 'ladder' ? _varyNode(b, mode) : b)) };
}

// Intensité : vert = bas de la fourchette d'allure de la zone, orange / rouge = haut.
// Même zone (même domaine physiologique), jamais un autre code d'allure ; les efforts
// au ressenti (RPE) et l'EF n'ont pas de fourchette à moduler.
function _applyIntensity(nodes, mode) {
  const sub = mode === 'green' ? 'low' : 'high';
  nodes.forEach(n => {
    if (n.t === 'rep') { _applyIntensity(n.body, mode); return; }
    if ((n.t === 'step' || n.t === 'ladder') && n.code !== 'RPE' && !_EASY_CODES.includes(n.code)) n.sub = sub;
  });
}

// dsl de base → dsl varié, ou null si aucune variation sensée n'existe
function routineVaryDsl(dsl, mode) {
  const tree = JSON.parse(JSON.stringify(_RC.routineParseDsl(dsl)));
  const works = tree.map(_workSec);
  const hasWork = works.some(w => w > 0);
  let idx, next;
  if (hasWork) {
    idx = works.indexOf(Math.max(...works));
    next = _varyNode(tree[idx], mode);
  } else {
    // séance d'endurance seule : volume ±10 min (±5 min si plusieurs blocs), jamais de rouge
    if (mode === 'red') return null;
    const tots = tree.map(_totalSecNode);
    idx = tots.indexOf(Math.max(...tots));
    const n = tree[idx];
    const d = (tree.length === 1 ? 600 : 300) * (mode === 'green' ? -1 : 1);
    if (n.t === 'step') { if (n.sec + d < 1500) return null; next = { ...n, sec: n.sec + d }; }
    else if (n.t === 'rep' && n.n >= 3) next = { ...n, n: _repAdj(n.n, mode) };
    else return null;
  }
  if (JSON.stringify(next) === JSON.stringify(tree[idx])) return null;
  tree[idx] = next;
  if (hasWork) _applyIntensity(tree, mode);
  return _RC.routineTreeToDsl(tree);
}

const _loadDslCache = {};
function routineLoadOfDsl(dsl, wuCd) {
  const key = dsl + '|' + wuCd;
  if (_loadDslCache[key]) return _loadDslCache[key];
  const c = _RC.compileRoutineDsl(dsl, { wuCd });
  let score = 0;
  const counts = {};
  c.steps.forEach(s => {
    if (['warmup', 'cooldown', 'recovery', 'setRecovery'].includes(s.role)) return;
    const min = s.sec / 60;
    const k = s.code === 'RPE' ? 'RPE' + s.rpe : s.code;
    const mult = s.sub === 'low' ? 0.94 : s.sub === 'high' ? 1.06 : 1;     // bas / haut de plage
    if (s.code === 'RPE') score += min * routineRpeWeight(s.rpe);
    else if (ROUTINE_WEIGHTS[s.code]) score += min * ROUTINE_WEIGHTS[s.code] * mult;
    else return;
    counts[k] = (counts[k] || 0) + s.sec;
  });
  const mainCode = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
  let tier = score < ROUTINE_RULES.tierLightMax ? 0 : score < ROUTINE_RULES.tierModerateMax ? 1 : 2;
  if (['VMA', 'S30', 'AS10'].includes(mainCode)) tier = Math.max(tier, 1);
  return (_loadDslCache[key] = { score: Math.round(score), tier, mainCode, counts, totalMin: c.totalSec / 60, qualityMin: c.qualitySec / 60 });
}

// snap : fiche figée d'une semaine ; wk : contexte de la semaine
//   { phase, cap, level, caution, maxMin, warnings, otherTiers:[paliers des AUTRES séances], locked }
// → 4 options { variant, label, dsl, totalMin, deltaTotalMin, deltaWorkMin, load, deltaLoadPct, tier, available, reason, selected }
function routineBuildVariants(snap, wk) {
  const baseDsl = snap.baseDsl || snap.dsl;
  const wuCd = snap.wuCd !== false;
  const base = routineLoadOfDsl(baseDsl, wuCd);
  const baseLoad = routineLoadValue(base);
  const current = snap.variant || 'yellow';
  const list = ROUTINE_VARIANT_ORDER.map(variant => {
    const rec = { variant, label: ROUTINE_VARIANT_LABEL[variant], available: true, reason: null, selected: current === variant };
    let dsl = baseDsl;
    if (variant !== 'yellow') {
      dsl = routineVaryDsl(baseDsl, variant === 'red' ? 'red' : variant);
      if (!dsl) { rec.available = false; rec.reason = 'Pas de variation possible pour cette séance.'; dsl = baseDsl; }
    }
    const l = routineLoadOfDsl(dsl, wuCd);
    const load = routineLoadValue(l);
    Object.assign(rec, {
      dsl, totalMin: Math.round(l.totalMin), tier: l.tier, load,
      deltaTotalMin: Math.round(l.totalMin - base.totalMin), deltaWorkMin: Math.round(l.qualityMin - base.qualityMin),
      deltaLoadPct: baseLoad ? Math.round((load - baseLoad) / baseLoad * 100) : 0,
      intensity: /_L\b/.test(dsl) && variant !== 'yellow' ? 'bas de plage' : /_H\b/.test(dsl) && variant !== 'yellow' ? 'haut de plage' : null,
    });
    if (rec.available && variant === 'green' && snap.role !== 'ef' && base.qualityMin > 8 && l.qualityMin < 6) { rec.available = false; rec.reason = 'Déjà au minimum utile.'; }
    if (rec.available && (variant === 'orange' || variant === 'red')) {
      const capKeys = Object.keys(l.counts).filter(k => l.counts[k] / 60 > (ROUTINE_WORK_CAP_MIN[k] || 1e9));
      if (wk.caution) rec.reason = 'Gêne ou fatigue signalée : variantes plus exigeantes bloquées.';
      else if (wk.phase === 'S4') rec.reason = 'Semaine de récupération : pas de séance plus exigeante.';
      else if (wk.cap < 1 && snap.role !== 'ef') rec.reason = 'Charge récente élevée : variante plus exigeante bloquée.';
      else if (l.totalMin > (wk.maxMin || 1e9)) rec.reason = `Dépasse ton temps disponible (${wk.maxMin} min).`;
      else if (capKeys.length) rec.reason = 'Plafond de travail à cette allure atteint.';
      else if (l.tier >= 2 && (wk.otherTiers || []).some(t => t >= 2)) rec.reason = 'Une seule séance très exigeante par semaine.';
      else if (variant === 'red') {
        if ((wk.level || 2) < 3) rec.reason = 'Réservée aux profils confirmés.';
        else if (!['S2', 'S3'].includes(wk.phase)) rec.reason = 'Disponible en semaines S2 et S3 seulement.';
        else if (wk.cap < 2 || (wk.warnings || []).length) rec.reason = 'Forme ou charge récente : conditions non réunies.';
        else if (snap.role === 'ef') rec.reason = 'Pas de variante rouge pour l’endurance.';
      }
      if (rec.reason) rec.available = false;
    }
    if (wk.locked && !rec.selected) { rec.available = false; rec.reason = rec.reason || 'Séance déjà faite ou semaine passée.'; }
    return rec;
  });
  // rouge identique à orange (petites séances) : une seule des deux a un sens
  const orange = list.find(v => v.variant === 'orange'), red = list.find(v => v.variant === 'red');
  if (red.available && orange.dsl === red.dsl) { red.available = false; red.reason = 'Identique à la variante orange pour cette séance.'; }
  return list;
}

// charge de la semaine (variantes comprises) vs prévue (tout en jaune)
function routineWeekExcess(sessions) {
  let actual = 0, nominal = 0;
  (sessions || []).forEach(s => {
    const w = s.wuCd !== false;
    actual += routineLoadValue(routineLoadOfDsl(s.dsl, w));
    nominal += routineLoadValue(routineLoadOfDsl(s.baseDsl || s.dsl, w));
  });
  return { actual, nominal, excessPct: nominal ? (actual - nominal) / nominal : 0 };
}

// ─── Description lisible d'une structure ─────────────────────────────────
function _fmtSec(s) {
  if (s % 60 === 0) return (s / 60) + ' min';
  if (s < 60) return s + ' s';
  return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
}
const _CODE_LABEL = { EF: 'EF', EFL: 'EF classique', EFH: 'EF soutenue', TEMPO: 'Tempo', AS42: 'AS42', SS: 'Sweet Spot', AS21: 'AS21', S60: 'S60', AS10: 'AS10', S30: 'S30', VMA: 'VMA', WALK: 'marche', STRIDE: 'relance relâchée' };
function _subSuffix(n) { return n.sub && n.code !== 'EFL' && n.code !== 'EFH' ? (n.sub === 'low' ? ' (bas de plage)' : ' (haut de plage)') : ''; }
function _fmtStep(n) {
  if (n.code === 'RPE') return _fmtSec(n.sec) + ' effort RPE ' + n.rpe + (n.label ? ' (' + n.label.replace(/_/g, ' ') + ')' : '');
  return _fmtSec(n.sec) + ' ' + _CODE_LABEL[n.code] + _subSuffix(n);
}
function routineDescribe(dsl) {
  const tree = _RC.routineParseDsl(dsl);
  const sep = s => (s ? ', récup ' + _fmtSec(s.sec) + ' ' + _CODE_LABEL[s.code] : '');
  const one = n => {
    if (n.t === 'step') return _fmtStep(n);
    if (n.t === 'ladder') return n.durs.map(_fmtSec).join(' / ') + ' ' + (n.code === 'RPE' ? 'RPE ' + n.rpe : _CODE_LABEL[n.code] + _subSuffix(n)) + sep(n.sep);
    return n.n + ' × (' + n.body.map(one).join(' + ') + ')' + sep(n.sep);
  };
  return tree.map(one).join(' → ');
}

return {
  ROUTINE_RULES, routinePhaseOf, routineModelLoad, routineAssessProfile,
  routineEligible, routineGenerateWeek, routineDescribe,
  routinePlanHorizon, routineRaceAdvice, ROUTINE_TARGET_FAMILIES,
  routineVaryDsl, routineLoadOfDsl, routineBuildVariants, routineWeekExcess, routineLoadValue,
  ROUTINE_VARIANT_ORDER, ROUTINE_VARIANT_LABEL, ROUTINE_WORK_CAP_MIN,
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = RoutineEngine;
