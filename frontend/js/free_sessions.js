// ============================================================
// free_sessions.js — Séances libres (hors plan d'entraînement)
// Propose chaque semaine 3 ou 4 séances d'entretien (EF, fractionné,
// sortie longue) quand aucun plan Campus/importé n'est actif. Ce n'est
// PAS un plan structuré : le schéma est toujours le même (EF / Fractionné
// / Sortie longue, ou EF / Fractionné / EF / Sortie longue), seule la
// séance de fractionné change de nature d'une semaine à l'autre.
// Dépend de campus.js (campusState, ALLURE_PLUS_ZONES, renderSessionList,
// showTrainingEmpty, isTrailSession...) et app.js (el, showToast,
// showConfirmModal, formatDate...).
// ============================================================

const FREE_SESSIONS_KEY = 'suivi_free_sessions';

function getFreeSessionsPrefs() {
  try { return JSON.parse(localStorage.getItem(FREE_SESSIONS_KEY) || 'null'); } catch (e) { return null; }
}
function saveFreeSessionsPrefs(prefs) {
  localStorage.setItem(FREE_SESSIONS_KEY, JSON.stringify(prefs));
}

// ─── Semaines / rotation ────────────────────────────────────────────────
// Lundi 00:00 local de la semaine contenant `ts`.
function mondayOfWeek(ts) {
  const d = new Date(ts);
  const day = d.getDay(); // 0=dimanche
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff).getTime();
}
function freeSessionsWeekNumber(prefs, now = Date.now()) {
  const weeks = Math.round((mondayOfWeek(now) - prefs.anchorMonday) / (7 * 86400000));
  return weeks + 1; // 1-based
}
// Une semaine "légère" toutes les 4 semaines (sortie longue + fractionné
// réduits) pour laisser l'organisme souffler entre deux blocs d'entretien.
function isLightFreeWeek(weekNum) { return weekNum % 4 === 0; }

// ─── Construction des séances (format compatible Campus/campus.js) ─────
// Un "step" = {kind, duration (sec), slug} ; slug suit SLUG_TO_ZONE
// (campus.js) pour resoudre la bonne zone ALLURE_PLUS_ZONES via le meme
// pipeline que les vraies seances Campus (annotatePaceZones) - aucune
// duplication de la logique d'allure.
function stepsToSession(steps) {
  return {
    paceZones: steps.map(s => ({ kind: s.kind, duration: s.duration, pace: s.slug ? { slug: s.slug, value: null } : null })),
    exercisesBlocks: [{ repeat: 1, exercises: steps.map(s => ({ pace: s.slug ? { slug: s.slug } : null })) }],
  };
}

function buildIntervalSteps(workSec, workSlug, workKind, restSec, reps) {
  const steps = [];
  for (let i = 0; i < reps; i++) {
    steps.push({ kind: workKind, duration: workSec, slug: workSlug });
    if (i < reps - 1) steps.push({ kind: 'RECOVER', duration: restSec, slug: 'slow' });
  }
  return steps;
}

const NOT_A_PLAN_ADVICE = "Ce n'est pas un plan structuré : ce sont des séances d'entretien pour continuer à progresser entre deux plans. Gardez de la qualité dans l'exécution plutôt que de chercher la performance à tout prix — l'objectif est de maintenir la caisse, pas de vous épuiser.";

// EF : duree tournante 40-50 min pour eviter de toujours proposer la meme.
const EF_DURATIONS_MIN = [40, 45, 50, 45];
function buildEfSession(idx, terrain, rotationOffset) {
  const durMin = EF_DURATIONS_MIN[rotationOffset % EF_DURATIONS_MIN.length];
  const { paceZones, exercisesBlocks } = stepsToSession([{ kind: 'Z2', duration: durMin * 60, slug: 'ef' }]);
  return {
    displayName: `EF ${durMin} min`,
    name: `EF ${durMin} min`,
    trainingCategory: terrain === 'trail' ? 'trail_basic_endurance' : 'road_basic_endurance',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: `Sortie en endurance fondamentale de ${durMin} minutes, à allure confortable (vous devez pouvoir parler sans être essoufflé). Séance de base pour construire du volume sans fatigue excessive.`,
    stats: { expectedDuration: durMin * 60, expectedElevationGain: terrain === 'trail' ? 150 : 0 },
  };
}

// Sortie longue : 50-90 min, ramenee au minimum (50 min) en semaine legere.
const SL_DURATIONS_MIN = [60, 75, 90, 70];
function buildSlSession(idx, terrain, rotationOffset, light) {
  const durMin = light ? 50 : SL_DURATIONS_MIN[rotationOffset % SL_DURATIONS_MIN.length];
  const { paceZones, exercisesBlocks } = stepsToSession([{ kind: 'Z2', duration: durMin * 60, slug: 'ef' }]);
  return {
    displayName: `Sortie longue ${durMin} min${light ? ' (allégée)' : ''}`,
    name: `Sortie longue ${durMin} min`,
    trainingCategory: terrain === 'trail' ? 'trail_long_run' : 'road_long_run',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: light
      ? `Sortie longue allégée (semaine de récupération) : ${durMin} minutes à allure EF, pour souffler avant de repartir sur un rythme plus soutenu la semaine prochaine.`
      : `Sortie longue de ${durMin} minutes à allure EF, pour développer l'endurance de fond. Peut être fractionnée en plusieurs sorties dans la semaine si votre emploi du temps ne permet pas un bloc unique.`,
    stats: { expectedDuration: durMin * 60, expectedElevationGain: terrain === 'trail' ? 300 : 0 },
  };
}

// Fractionné : 4 variantes qui tournent d'une semaine sur l'autre, pour ne
// jamais répéter la même semaine après semaine (30"-30", 1'-1', variation
// d'allures, fractionné long) - reps réduites en semaine légère.
const FRACTIONNE_VARIANTS = [
  {
    key: 'rapide', label: '30"-30"',
    build: light => buildIntervalSteps(30, 'vma', 'Z5', 30, light ? 8 : 12),
    desc: light => `Fractionné rapide${light ? ' allégé' : ''} : ${light ? 8 : 12} répétitions de 30 secondes vite (proche VMA) / 30 secondes de récupération active. Séance courte et intense pour réveiller les jambes.`,
  },
  {
    key: 'moyen', label: "1'-1'",
    build: light => buildIntervalSteps(60, 'seuil30', 'Z4', 60, light ? 6 : 8),
    desc: light => `Fractionné moyen : ${light ? 6 : 8} répétitions d'1 minute soutenue (allure seuil) / 1 minute de récupération. Travail de qualité sur la capacité à tenir un effort soutenu.`,
  },
  {
    key: 'variation', label: "Variation d'allures",
    build: (light) => {
      const reps = light ? 3 : 4;
      const steps = [];
      for (let i = 0; i < reps; i++) {
        steps.push({ kind: 'Z3', duration: 180, slug: 'aerobie' });
        steps.push({ kind: 'Z4', duration: 120, slug: '10km' });
        if (i < reps - 1) steps.push({ kind: 'RECOVER', duration: 90, slug: 'slow' });
      }
      return steps;
    },
    desc: light => `Variation d'allures : alterne 3 minutes en tempo et 2 minutes à allure 10km, répété ${light ? 3 : 4} fois. Travaille la capacité à changer de rythme, utile en course.`,
  },
  {
    key: 'long', label: 'Fractionné long',
    build: light => buildIntervalSteps(360, 'seuil60', 'Z4', 120, light ? 3 : 4),
    desc: light => `Fractionné long : ${light ? 3 : 4} répétitions de 6 minutes au seuil (effort soutenu mais tenable) / 2 minutes de récupération. Développe la capacité à maintenir un rythme élevé longtemps.`,
  },
];

function buildFractionneSession(idx, terrain, rotationOffset, light) {
  const variant = FRACTIONNE_VARIANTS[rotationOffset % FRACTIONNE_VARIANTS.length];
  const steps = [
    { kind: 'WARMUP', duration: 600, slug: 'ef' },
    ...variant.build(light),
    { kind: 'COOLDOWN', duration: 480, slug: 'ef' },
  ];
  const totalSec = steps.reduce((s, x) => s + x.duration, 0);
  const { paceZones, exercisesBlocks } = stepsToSession(steps);
  return {
    displayName: `Fractionné ${variant.label}`,
    name: `Fractionné ${variant.label}`,
    trainingCategory: terrain === 'trail' ? 'trail_intensity' : 'road_intensity',
    trainingIndex: idx,
    paceZones, exercisesBlocks,
    description: variant.desc(light),
    coachAdvice: NOT_A_PLAN_ADVICE,
    stats: { expectedDuration: totalSec, expectedElevationGain: terrain === 'trail' ? 100 : 0 },
  };
}

// ─── Génération de la semaine courante ──────────────────────────────────
function generateFreeSessionsWeek(prefs, now = Date.now()) {
  const weekNum = freeSessionsWeekNumber(prefs, now);
  const light = isLightFreeWeek(weekNum);
  const terrain = prefs.terrain;
  const sessions = [];
  let idx = 0;
  sessions.push(buildEfSession(idx++, terrain, weekNum - 1));
  sessions.push(buildFractionneSession(idx++, terrain, weekNum - 1, light));
  if (prefs.frequency >= 4) sessions.push(buildEfSession(idx++, terrain, weekNum));
  sessions.push(buildSlSession(idx++, terrain, weekNum - 1, light));
  return { weekNum, light, sessions };
}

// ─── Rendu ───────────────────────────────────────────────────────────────
function renderFreeSessionsWeek() {
  const prefs = getFreeSessionsPrefs();
  if (!prefs) return;
  const { weekNum, light, sessions } = generateFreeSessionsWeek(prefs);
  const monday = mondayOfWeek(Date.now());
  const weekId = 'free_' + monday;

  campusState.weeks = [{ _id: weekId, weekDate: monday, sessions, context: {} }];
  campusState.selectedWeekIdx = 0;
  campusState.openSessionIdx = -1;
  campusState.usingImportedPlan = true; // active "Marquer comme fait" (getLocalSessionStatus)
  campusState.campusConnected = false;
  campusState.goal = null; // pas d'objectif associé - évite un bloc "Allure objectif" perimé

  const terrainLabel = prefs.terrain === 'trail' ? 'Trail' : 'Route';

  el('campus-connect-card').style.display = 'none';
  el('campus-loading').style.display = 'none';
  el('campus-plan-wrap').style.display = '';
  el('campus-plan-subtitle').textContent = `Séances libres — ${terrainLabel} · ${prefs.frequency}x/semaine`;

  const header = `
    <div class="training-plan-header card">
      <div class="plan-header-top">
        <div>
          <div class="plan-title">Séances libres — entretien</div>
          <div class="plan-subtitle-desc">${NOT_A_PLAN_ADVICE}${light ? ' <strong>Semaine allégée cette semaine</strong> (récupération).' : ''}</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <span class="plan-type-badge">${terrainLabel}</span>
          <span class="plan-type-badge">${prefs.frequency}x/sem</span>
          ${light ? '<span class="plan-type-badge" style="background:#fef3c7;color:#b45309">Semaine légère</span>' : ''}
        </div>
      </div>
    </div>`;

  const actions = `
    <div class="plan-actions-bar">
      <button class="btn-plan-action" onclick="editFreeSessionsPrefs()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Modifier (terrain / fréquence)
      </button>
      <button class="btn-plan-action btn-cancel-plan" onclick="disableFreeSessions()" style="margin-left:auto;opacity:.85;background:rgba(229,57,53,.15);color:#e53935;border:1px solid rgba(229,57,53,.3);">
        ✕ Désactiver les séances libres
      </button>
    </div>`;

  el('campus-plan-wrap').innerHTML = header + actions + `<div id="training-session-list"></div>`;
  renderSessionList(0);
}

// ─── Configuration (démarrage / modification / arrêt) ──────────────────
function startFreeSessions() {
  const terrainBtn = document.querySelector('#free-sessions-terrain-toggle .routes-toggle-btn.active');
  const freqBtn = document.querySelector('#free-sessions-freq-toggle .routes-toggle-btn.active');
  const prefs = {
    terrain: terrainBtn?.dataset.terrain || 'route',
    frequency: parseInt(freqBtn?.dataset.freq, 10) || 3,
    anchorMonday: mondayOfWeek(Date.now()),
  };
  saveFreeSessionsPrefs(prefs);
  renderFreeSessionsWeek();
  showToast('Séances libres générées pour cette semaine', 'success');
}

async function disableFreeSessions() {
  const ok = await showConfirmModal({
    title: 'Désactiver les séances libres ?',
    message: 'Vous pourrez les réactiver à tout moment (terrain et fréquence vous seront redemandés).',
    confirmLabel: 'Désactiver',
    icon: '✕',
  });
  if (!ok) return;
  localStorage.removeItem(FREE_SESSIONS_KEY);
  campusState.usingImportedPlan = false;
  showTrainingEmpty();
}

function editFreeSessionsPrefs() {
  const prefs = getFreeSessionsPrefs();
  el('campus-connect-card').style.display = '';
  el('campus-plan-wrap').style.display = 'none';
  el('campus-login-block').style.display = 'none';
  el('campus-import-only').style.display = '';
  if (prefs) {
    document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.terrain === prefs.terrain));
    document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.freq === String(prefs.frequency)));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#free-sessions-terrain-toggle .routes-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#free-sessions-freq-toggle .routes-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
});
