// ============================================================
// plans.js — Plans Disponibles : wizard + résultats + détail
// ============================================================

const plansState = {
  allPlans: [],      // Tous les plans chargés depuis l'API
  answers: {},       // Réponses du wizard { sport, distCat, duree, seances, niveau }
  currentStep: 0,
  filtered: [],      // Plans filtrés après le wizard
  selectedPlan: null,// Plan sélectionné pour le détail
};

// Étapes du wizard
const WIZARD_STEPS = ['sport', 'dist', 'dplus', 'duree', 'seances', 'niveau'];

// ─── Préchargement silencieux (appelé au démarrage de l'app) ─────
async function prefetchPlans() {
  if (plansState.allPlans.length > 0) return; // déjà en cache
  try {
    const res = await fetch('/api/plans');
    if (res.ok) plansState.allPlans = await res.json();
  } catch (_) { /* silencieux */ }
}

// ─── Point d'entrée ──────────────────────────────────────────
async function initPlansPage() {
  const el = id => document.getElementById(id);
  const wrap = el('plans-wizard');
  if (!wrap) return;

  // Si pas encore en cache (rare : préchargement pas encore terminé), charger maintenant
  if (plansState.allPlans.length === 0) {
    try {
      const res = await fetch('/api/plans');
      plansState.allPlans = await res.json();
    } catch(e) {
      console.error('Erreur chargement plans', e);
      return;
    }
  }

  // Réinitialiser
  plansState.answers = {};
  plansState.currentStep = 0;
  plansState.filtered = [];
  plansState.selectedPlan = null;

  showView('wizard');
  renderWizardStep();
}

function showPlansLoading(show) { /* no-op — spinner supprimé */ }

function showView(view) {
  // view: 'wizard' | 'results' | 'detail'
  ['plans-wizard', 'plans-results', 'plans-detail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById('plans-' + view);
  if (target) target.style.display = '';
}

// ─── WIZARD ──────────────────────────────────────────────────

// Libellés D+ lisibles pour le wizard
const DPLUS_DISPLAY = {
  '0_1000':    { label: '< 1 000 m D+',        desc: 'Terrain peu accidenté' },
  '1000_2000': { label: '1 000 – 2 000 m D+', desc: 'D+ modéré, belles montées' },
  '2000_3000': { label: '2 000 – 3 000 m D+', desc: 'D+ élevé, course exigeante' },
  '3000_9999': { label: '> 3 000 m D+',        desc: 'Montagne, très exigeant' },
};

// Formate une plage "1200_2200" en libellé lisible pour les plages non prévues
// dans DPLUS_DISPLAY ci-dessus (ex: plages spécifiques à certains plans).
function formatDplusRange(val) {
  const parts = String(val).split('_').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return { label: val, desc: '' };
  const [lo, hi] = parts;
  const fmt = n => n.toLocaleString('fr-FR');
  if (hi >= 9999) return { label: `> ${fmt(lo)} m D+`, desc: 'Montagne, très exigeant' };
  if (lo <= 0)     return { label: `< ${fmt(hi)} m D+`, desc: 'Terrain peu accidenté' };
  return { label: `${fmt(lo)} – ${fmt(hi)} m D+`, desc: 'D+ spécifique à cette course' };
}

function getAvailableOptions(step) {
  // N'applique les filtres que pour les étapes ANTÉRIEURES à l'étape demandée
  const a = plansState.answers;
  const stepOrder = ['sport', 'dist', 'dplus', 'duree', 'seances', 'niveau'];
  const idx = stepOrder.indexOf(step);
  let pl = plansState.allPlans;

  if (idx > 0 && a.sport)       pl = pl.filter(p => p.sport      === a.sport);
  if (idx > 1 && a.distCat)     pl = pl.filter(p => p.distCat    === a.distCat);
  if (idx > 2 && a.dplusLabel)  pl = pl.filter(p => p.dplusLabel === a.dplusLabel);
  if (idx > 3 && a.duree)       pl = pl.filter(p => p.duree      === a.duree);
  if (idx > 4 && a.seances)     pl = pl.filter(p => p.seances    === a.seances);

  switch(step) {
    case 'sport':   return [...new Set(plansState.allPlans.map(p => p.sport))].sort();
    case 'dist':    return [...new Set(pl.map(p => p.distCat))];
    case 'dplus': {
      // Uniquement pour Trail ET si des plans ont des données D+
      if (a.sport !== 'T') return [];
      const labels = [...new Set(pl.filter(p => p.dplusLabel).map(p => p.dplusLabel))].sort();
      return labels;
    }
    case 'duree':   return [...new Set(pl.map(p => p.duree))].sort((a,b)=>a-b);
    case 'seances': return [...new Set(pl.map(p => p.seances))].sort((a,b)=>a-b);
    case 'niveau':  return [...new Set(pl.map(p => p.niveau))];
    default:        return [];
  }
}

function renderWizardStep() {
  const el = id => document.getElementById(id);
  const step = WIZARD_STEPS[plansState.currentStep];
  const totalSteps = WIZARD_STEPS.length;
  const a = plansState.answers;

  // Indicateur d'étape — inline, simple
  el('plans-step-indicator').innerHTML = `
    <div class="wizard-header">
      <div class="wizard-step-dots">
        ${WIZARD_STEPS.map((s, i) => `
          <span class="wizard-dot ${i < plansState.currentStep ? 'done' : ''} ${i === plansState.currentStep ? 'active' : ''}"></span>
        `).join('')}
      </div>
      <span class="wizard-step-label">Étape ${plansState.currentStep + 1} / ${totalSteps}</span>
    </div>
  `;

  const opts = getAvailableOptions(step);

  // Définition des étapes
  const stepDefs = {
    sport: {
      question: 'Quel type de course préparez-vous ?',
      subtitle: 'Le plan sera adapté à la spécificité de votre discipline.',
      options: [
        { value: 'T', label: '🏔 Trail', desc: 'Course nature, montagne, sentiers' },
        { value: 'R', label: '🏃 Route', desc: 'Course sur route, piste, asphalte' },
      ].filter(o => opts.includes(o.value)),
      key: 'sport',
    },
    dist: {
      question: a.sport === 'T' ? 'Quelle catégorie de trail préparez-vous ?' : 'Quelle distance de course ?',
      subtitle: a.sport === 'T'
        ? 'Choisissez la catégorie correspondant à votre épreuve cible.'
        : 'Sélectionnez la distance de votre objectif.',
      options: a.sport === 'T'
        ? [
            { value: 'court', label: '🏃 Trail Court', desc: 'Moins de 21 km' },
            { value: 'moyen', label: '🏔 Trail Moyen', desc: 'De 21 à 42 km' },
            { value: 'long',  label: '⛰ Trail Long',  desc: 'De 42 à 80 km' },
            { value: 'ultra', label: '🦅 Ultra',       desc: 'Plus de 80 km' },
          ].filter(o => opts.includes(o.value))
        : [
            { value: '5k',      label: '5 km',          desc: '~20-30 min' },
            { value: '10k',     label: '10 km',          desc: '~40-60 min' },
            { value: '20k',     label: '20 km',          desc: '~1h20-2h' },
            { value: 'semi',    label: 'Semi-marathon',  desc: '21,1 km' },
            { value: 'marathon',label: 'Marathon',       desc: '42,2 km' },
          ].filter(o => opts.includes(o.value)),
      key: 'distCat',
    },
    dplus: {
      question: 'Quel est le D+ de votre course ?',
      subtitle: 'Le dénivelé positif permet d\'adapter l\'entraînement spécifique trail.',
      options: opts.map(val => {
        const d = DPLUS_DISPLAY[val] || formatDplusRange(val);
        return { value: val, label: d.label, desc: d.desc };
      }),
      key: 'dplusLabel',
    },
    duree: {
      question: 'Sur combien de semaines souhaitez-vous vous préparer ?',
      subtitle: 'Un plan plus long permet une progression plus progressive.',
      options: opts.map(d => ({ value: d, label: `${d} semaines`, desc: d <= 12 ? 'Plan court' : d <= 16 ? 'Plan intermédiaire' : 'Plan long' })),
      key: 'duree',
    },
    seances: {
      question: 'Combien de séances par semaine pouvez-vous consacrer à l\'entraînement ?',
      subtitle: 'Choisissez en fonction de votre emploi du temps réel.',
      options: opts.map(s => ({ value: s, label: `${s} séances / semaine`, desc: s <= 3 ? 'Rythme léger' : s <= 4 ? 'Rythme modéré' : 'Rythme soutenu' })),
      key: 'seances',
    },
    niveau: {
      question: 'Avez-vous fait une pause ces dernières semaines ?',
      subtitle: 'Votre situation actuelle permet d\'adapter le début du plan.',
      options: [
        { value: 'ACTIF',   label: 'Non, je cours régulièrement',   desc: 'Sans interruption notable' },
        { value: 'PAUSE',   label: 'Oui, entre 2 et 3 semaines',    desc: 'Petite coupure récente' },
        { value: 'REPRISE', label: 'Oui, plus d\'un mois',          desc: 'Reprise progressive nécessaire' },
      ].filter(o => opts.includes(o.value)),
      key: 'niveau',
    },
  };

  const def = stepDefs[step];
  const currentVal = a[def.key];

  if (def.options.length === 0) {
    el('plans-step-content').innerHTML = `
      <div class="plans-no-option">
        <span style="font-size:2.5rem">😕</span>
        <p>Aucun plan disponible pour cette épreuve.</p>
        <button class="btn-plans-restart" onclick="plansRestart()">Recommencer</button>
      </div>`;
    el('plans-nav-next').style.display = 'none';
    el('plans-nav-back').style.display = plansState.currentStep > 0 ? '' : 'none';
    return;
  }

  el('plans-step-content').innerHTML = `
    <div class="plans-card">
      <div class="wizard-question">
        <h2 class="wizard-q-title">${def.question}</h2>
        <p class="wizard-q-sub">${def.subtitle}</p>
      </div>
      <div class="wizard-options">
        ${def.options.map(opt => `
          <button class="wizard-option ${currentVal === opt.value ? 'selected' : ''}"
                  onclick="wizardSelect('${def.key}', ${typeof opt.value === 'number' ? opt.value : `'${opt.value}'`})"
                  id="wopt-${opt.value}">
            <span class="wizard-option-label">${opt.label}</span>
            <span class="wizard-option-desc">${opt.desc}</span>
            <span class="wizard-option-radio"></span>
          </button>
        `).join('')}
      </div>
    </div>
  `;

  // Boutons navigation
  el('plans-nav-back').style.display = plansState.currentStep > 0 ? '' : 'none';
  el('plans-nav-next').textContent = plansState.currentStep === totalSteps - 1 ? 'Voir les plans →' : 'Suivant →';
  el('plans-nav-next').disabled = !currentVal;
}

function wizardSelect(key, value) {
  plansState.answers[key] = value;
  // Mettre à jour visuellement
  document.querySelectorAll('.wizard-option').forEach(btn => btn.classList.remove('selected'));
  const btn = document.getElementById(`wopt-${value}`);
  if (btn) btn.classList.add('selected');
  document.getElementById('plans-nav-next').disabled = false;
}

function wizardNext() {
  const step = WIZARD_STEPS[plansState.currentStep];
  const stepKeys = { sport:'sport', dist:'distCat', dplus:'dplusLabel', duree:'duree', seances:'seances', niveau:'niveau' };
  if (!plansState.answers[stepKeys[step] || step]) return;

  if (plansState.currentStep < WIZARD_STEPS.length - 1) {
    plansState.currentStep++;
    // Auto-skip dplus pour la Route OU si aucun plan n'a de données D+
    if (WIZARD_STEPS[plansState.currentStep] === 'dplus' && getAvailableOptions('dplus').length === 0) {
      plansState.currentStep++;
    }
    renderWizardStep();
  } else {
    showFilteredResults();
  }
}

function wizardBack() {
  if (plansState.currentStep > 0) {
    const stepKeys = { sport:'sport', dist:'distCat', dplus:'dplusLabel', duree:'duree', seances:'seances', niveau:'niveau' };
    const curStepName = WIZARD_STEPS[plansState.currentStep];
    delete plansState.answers[stepKeys[curStepName] || curStepName];
    plansState.currentStep--;
    // Auto-skip dplus en arrière si Route ou pas d'options
    if (WIZARD_STEPS[plansState.currentStep] === 'dplus' && getAvailableOptions('dplus').length === 0) {
      delete plansState.answers['dplusLabel'];
      plansState.currentStep--;
    }
    renderWizardStep();
  }
}

function plansRestart() {
  plansState.answers = {};
  plansState.currentStep = 0;
  showView('wizard');
  renderWizardStep();
  document.getElementById('plans-nav-next').style.display = '';
}

// ─── RÉSULTATS ────────────────────────────────────────────────

function showFilteredResults() {
  const a = plansState.answers;
  let results = plansState.allPlans.filter(p =>
    (!a.sport       || p.sport       === a.sport) &&
    (!a.distCat     || p.distCat     === a.distCat) &&
    (!a.dplusLabel  || p.dplusLabel  === a.dplusLabel) &&
    (!a.duree       || p.duree       === a.duree) &&
    (!a.seances     || p.seances     === a.seances) &&
    (!a.niveau      || p.niveau      === a.niveau)
  );

  // Si aucun résultat exact → plan le plus proche (score de proximité)
  if (results.length === 0) {
    results = findClosestPlans(a);
  }

  plansState.filtered = results;
  renderResults(results, results.length < plansState.allPlans.length && results[0]?._approximate);
}

function scoreMatch(plan, a) {
  let score = 0;
  if (a.sport      && plan.sport      === a.sport)      score += 10;
  if (a.distCat    && plan.distCat    === a.distCat)    score += 8;
  if (a.dplusLabel && plan.dplusLabel === a.dplusLabel) score += 7;
  if (a.niveau     && plan.niveau     === a.niveau)     score += 5;
  if (a.duree      && plan.duree      === a.duree)      score += 4;
  if (a.seances    && plan.seances    === a.seances)    score += 3;
  return score;
}

function findClosestPlans(a) {
  const scored = plansState.allPlans
    .map(p => ({ ...p, _score: scoreMatch(p, a), _approximate: true }))
    .sort((a, b) => b._score - a._score);
  const maxScore = scored[0]?._score || 0;
  return scored.filter(p => p._score === maxScore);
}

const NIVEAU_BADGE = {
  'ACTIF':   { label: 'Régulier',  color: '#10b981' },
  'PAUSE':   { label: 'Pause',     color: '#f59e0b' },
  'REPRISE': { label: 'Reprise',   color: '#6366f1' },
};

const THEME_LABELS = {
  // Communs
  'S60_Cote':        'S60 Côte',
  'S60':             'S60',
  'affutage':        'Affûtage',
  'post-competition':'Post-compétition',
  'recuperation':    'Récupération',
  'base':            'Base',
  'specifique':      'Spécifique',
  // Trail spécifiques (depuis Campus)
  'short-recovery':  'Short Recovery',
  'S60_Cote':        'S60 Côte',
  'Affutage':        'Affûtage',
  'Post-competition':'Post-compétition',
  'Intensity':       'Intensité',
  'EF':              'Endurance Fondamentale',
  'EF_LD':           'EF Lignes Droites',
  'SL':              'Sortie Longue',
  'PPG':             'Renforcement',
  'Competition':     'Course',
};

function renderResults(plans, approximate) {
  showView('results');
  const el = id => document.getElementById(id);

  const hdr = el('plans-results-header');
  hdr.innerHTML = approximate
    ? `<div class="plans-approx-notice">⚠️ Aucun plan exact trouvé — voici les plans les plus proches de vos critères.</div>`
    : `<div class="plans-exact-notice">✅ ${plans.length} plan${plans.length > 1 ? 's' : ''} correspond${plans.length === 1 ? '' : 'ent'} à vos critères.</div>`;

  const list = el('plans-results-list');
  list.innerHTML = plans.map(plan => {
    const badge = NIVEAU_BADGE[plan.niveau] || { label: plan.niveau, color: '#888' };
    const ef = plan.sessions?.EF || 0;
    const sl = plan.sessions?.SL || 0;
    const intensity = plan.sessions?.Intensity || 0;
    const totalSess = Object.values(plan.sessions || {}).reduce((a,b)=>a+b,0);
    const h = Math.floor(plan.totalDurMin / 60);
    const m = plan.totalDurMin % 60;
    const durLabel = h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m} min`;

    return `
      <div class="plan-result-card" onclick="showPlanDetail('${plan._id || plan.planId}')">
        <div class="plan-card-header">
          <div class="plan-card-titles">
            <div class="plan-card-name">${plan.sportLabel} · ${plan.distLabel}</div>
            <div class="plan-card-sub">${plan.totalWeeks} semaines · ${plan.seances} séances/sem.</div>
          </div>
          <span class="plan-niveau-badge" style="background:${badge.color}20;color:${badge.color};border:1px solid ${badge.color}40">
            ${badge.label}
          </span>
        </div>
        <div class="plan-card-stats">
          <div class="plan-stat"><span class="plan-stat-val">${ef}</span><span class="plan-stat-lbl">EF</span></div>
          <div class="plan-stat"><span class="plan-stat-val">${sl}</span><span class="plan-stat-lbl">Sorties longues</span></div>
          <div class="plan-stat"><span class="plan-stat-val">${intensity}</span><span class="plan-stat-lbl">Intensité</span></div>
          <div class="plan-stat"><span class="plan-stat-val">${totalSess}</span><span class="plan-stat-lbl">Total séances</span></div>
          <div class="plan-stat"><span class="plan-stat-val">~${plan.estKm} km</span><span class="plan-stat-lbl">Vol. estimé</span></div>
          ${plan.estDplusM ? `<div class="plan-stat"><span class="plan-stat-val">~${plan.estDplusM} m D+</span><span class="plan-stat-lbl">D+ total estimé</span></div>` : (plan.dplusMin ? `<div class="plan-stat"><span class="plan-stat-val">${plan.dplusMin}–${plan.dplusMax} m</span><span class="plan-stat-lbl">D+ épreuve</span></div>` : '')}
        </div>
        <div class="plan-card-cycles">
          ${(plan.cycles || []).map(c => `
            <span class="plan-cycle-chip">${THEME_LABELS[c.theme] || c.theme} (${c.duration} sem.)</span>
          `).join('')}
        </div>
        <div class="plan-card-footer">
          <span class="plan-card-cta">Voir le détail →</span>
          <button class="btn-plan-load-card" onclick="event.stopPropagation(); loadPlanFromCatalog('${plan._id || plan.planId}')">
            📅 Charger ce plan
          </button>
        </div>
      </div>
    `;
  }).join('') || '<div class="plans-empty">Aucun plan disponible pour cette épreuve.</div>';
}

// ─── DÉTAIL ───────────────────────────────────────────────────

function showPlanDetail(planId) {
  const plan = plansState.filtered.find(p => p._id === planId || p.planId === planId || p.id === planId) ||
               plansState.allPlans.find(p => p._id === planId || p.planId === planId || p.id === planId);
  if (!plan) return;
  plansState.selectedPlan = plan;
  renderPlanDetail(plan);
  showView('detail');
}

function renderPlanDetail(plan) {
  const el = id => document.getElementById(id);
  const badge = NIVEAU_BADGE[plan.niveau] || { label: plan.niveau, color: '#888' };

  const ef = plan.sessions?.EF || 0;
  const sl = plan.sessions?.SL || 0;
  const intensity = plan.sessions?.Intensity || 0;
  const ppg = plan.sessions?.PPG || 0;
  const total = Object.values(plan.sessions || {}).reduce((a,b)=>a+b,0);
  const h = Math.floor(plan.totalDurMin / 60);
  const m = plan.totalDurMin % 60;
  const durLabel = `${h}h${m > 0 ? m + 'min' : ''}`;

  el('plans-detail-content').innerHTML = `
    <!-- En-tête -->
    <div class="plan-detail-header">
      <div>
        <h2 class="plan-detail-title">${plan.sportLabel} · ${plan.distLabel}</h2>
        <div class="plan-detail-sub">
          ${plan.totalWeeks} semaines · ${plan.seances} séances/semaine ·
          <span style="color:${badge.color};font-weight:600">${badge.label}</span>
        </div>
        <div class="plan-detail-nivel-desc">${plan.niveauDesc || ''}</div>
      </div>
    </div>

    <!-- Stats globales -->
    <div class="plan-detail-section">
      <h3 class="plan-detail-section-title">📊 Statistiques du plan</h3>
      <div class="plan-detail-stats-grid">
        <div class="detail-stat-card"><div class="detail-stat-val">${ef}</div><div class="detail-stat-lbl">Séances EF</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">${sl}</div><div class="detail-stat-lbl">Sorties Longues</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">${intensity}</div><div class="detail-stat-lbl">Séances Intensité</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">${ppg}</div><div class="detail-stat-lbl">PPG</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">${total}</div><div class="detail-stat-lbl">Total séances</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">~${plan.estKm} km</div><div class="detail-stat-lbl">Volume estimé</div></div>
        <div class="detail-stat-card"><div class="detail-stat-val">${durLabel}</div><div class="detail-stat-lbl">Durée totale</div></div>
        ${plan.estDplusM ? `<div class="detail-stat-card"><div class="detail-stat-val">~${plan.estDplusM} m</div><div class="detail-stat-lbl">D+ total plan</div></div>` : ''}
        ${plan.dplusMin ? `<div class="detail-stat-card"><div class="detail-stat-val">${plan.dplusMin}–${plan.dplusMax} m</div><div class="detail-stat-lbl">D+ épreuve cible</div></div>` : ''}
      </div>
    </div>

    <!-- Blocs d'entraînement -->
    <div class="plan-detail-section">
      <h3 class="plan-detail-section-title">🔄 Blocs d'entraînement</h3>
      <div class="plan-cycles-list">
        ${(plan.cycles || []).map((c, i) => `
          <div class="plan-cycle-block">
            <div class="plan-cycle-header">
              <span class="plan-cycle-num">Bloc ${i + 1}</span>
              <span class="plan-cycle-name">${THEME_LABELS[c.theme] || c.theme}</span>
              <span class="plan-cycle-dur">${c.duration} semaine${c.duration > 1 ? 's' : ''}</span>
            </div>
            <div class="plan-cycle-desc">${c.description || ''}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Semaine par semaine -->
    <div class="plan-detail-section">
      <h3 class="plan-detail-section-title">📅 Semaine par semaine</h3>
      <div class="plan-weeks-table">
        <div class="plan-weeks-row plan-weeks-head">
          <span>Semaine</span><span>Thème</span><span>Séances</span><span>Durée est.</span>
        </div>
        ${(plan.weeksSummary || []).map((w, wIdx, arr) => {
          const wh = Math.floor(w.durMin / 60);
          const wm = w.durMin % 60;
          const wDur = wh > 0 ? `${wh}h${wm > 0 ? wm + 'min' : ''}` : `${wm} min`;
          // Semaine de course = dernière semaine avant les semaines post-compétition
          const theme = (w.theme || '').toLowerCase();
          const nextTheme = (arr[wIdx + 1]?.theme || '').toLowerCase();
          const isRaceWeek = !theme.includes('post') &&
                             (nextTheme.includes('post') || wIdx === arr.length - 1);
          const themeLabel = isRaceWeek
            ? `${THEME_LABELS[w.theme] || w.theme} <span style="color:#e63946;font-weight:700">🏁 Course</span>`
            : (THEME_LABELS[w.theme] || w.theme || '—');
          return `
            <div class="plan-weeks-row" style="${isRaceWeek ? 'background:rgba(230,57,70,0.06);border-left:3px solid #e63946;' : ''}">
              <span class="plan-week-num">S${w.weekNum}</span>
              <span class="plan-week-theme">${themeLabel}</span>
              <span class="plan-week-sess">${w.sessions}</span>
              <span class="plan-week-dur">${wDur}</span>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;

  // Bouton charger
  el('plans-load-btn').onclick = () => loadPlanFromCatalog(plan._id || plan.planId);
}

// ─── CHARGEMENT DU PLAN ───────────────────────────────────────

async function loadPlanFromCatalog(planId) {
  try {
    showToast('Chargement du plan...', 'info');
    const res = await fetch(`/api/plans/load/${planId}`);
    if (!res.ok) throw new Error('Plan introuvable');
    const data = await res.json();

    if (!data.goal || !Array.isArray(data.weeks)) {
      showToast('Structure du plan invalide.', 'error');
      return;
    }

    const nbWeeks = data.weeks.length;
    const W7 = 7 * 24 * 3600 * 1000;

    // Déterminer l'index de la semaine de course (même logique que l'import)
    const sortedForRace = [...data.weeks].sort((a, b) => (a.weekDate||0) - (b.weekDate||0));
    let raceWeekIdx = nbWeeks - 1;
    const rawDate = data.goal.competitionDate;
    if (rawDate) {
      const origRaceTs = new Date(rawDate).getTime();
      const found = sortedForRace.findIndex(w =>
        origRaceTs >= (w.weekDate||0) && origRaceTs < ((w.weekDate||0) + W7)
      );
      if (found >= 0) raceWeekIdx = found;
    }
    const postCompWeeks = nbWeeks - 1 - raceWeekIdx;

    // Modal de saisie nom + date (réutilise showRaceModal de campus.js)
    const result = await showRaceModal({ prefillName: '', prefillDate: '', nbWeeks, raceWeekIdx, postCompWeeks });
    if (!result) return;

    // Appliquer les valeurs et recalculer les dates
    data.goal.name            = result.name || 'Ma course';
    data.goal.goalTitle       = data.goal.name;
    data.goal.competitionDate = result.date;

    const raceMs = new Date(result.date + 'T12:00:00').getTime();
    const rawPlanStartMs = raceMs - raceWeekIdx * W7;
    const snapToMonday = (ms) => {
      const dow = new Date(ms).getDay();
      const delta = dow === 0 ? -6 : 1 - dow;
      return ms + delta * 24 * 3600 * 1000;
    };
    const newPlanStartMs = snapToMonday(rawPlanStartMs);

    data.weeks = [...data.weeks]
      .sort((a, b) => (a.weekDate || a.weekNumber || 0) - (b.weekDate || b.weekNumber || 0))
      .map((week, idx) => ({ ...week, weekDate: newPlanStartMs + idx * W7 }));

    data.goal.startDate     = new Date(newPlanStartMs).toISOString().slice(0, 10);
    data.goal.raceWeekIndex = raceWeekIdx;
    data.goal.postCompWeeks = postCompWeeks;

    // ── Nettoyage TOTAL des données de l'ancien plan ───────────────────────
    // Purge toutes les clés suivi_objectif_* quelle que soit leur valeur
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('suivi_objectif_')) localStorage.removeItem(k);
    });
    const _pg = JSON.parse(localStorage.getItem('suivi_personal_goals') || '{}');
    delete _pg.targetTime;
    delete _pg.raceName;
    localStorage.setItem('suivi_personal_goals', JSON.stringify(_pg));
    // ────────────────────────────────────────────────────────

    // Stocker et charger dans l'onglet Entraînement
    localStorage.setItem('prefer_imported_plan', 'true');
    localStorage.setItem('suivi_imported_plan', JSON.stringify(data));
    fetch('/api/campus/import-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {});

    showToast('Plan chargé ! Ouverture de l\'onglet Entraînement...', 'success');
    setTimeout(() => {
      // Naviguer vers l'onglet Entraînement
      const navTraining = document.querySelector('[data-page="training"]');
      if (navTraining) navTraining.click();
      // Recharger le plan
      if (typeof loadTrainingPlan === 'function') {
        campusState.usingImportedPlan = true;
        showTrainingLoading();
        loadTrainingPlan();
      }
    }, 800);

  } catch(err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}
