/* ═══════════════════════════════════════════════
   PAGE STATISTIQUES
   Une ligne par année (dépliable), filtres par type
   d'activité (comme la page Activités), et une modale
   de comparaison pour 2-3 années cochées.
   Données depuis _allActivities / _fullyLoadedYears
   (même cache que la page Activités).
═══════════════════════════════════════════════ */

const STATS_SPORT_LABELS_FR = {
  running: 'Course', trail_running: 'Trail', cycling: 'Vélo',
  swimming: 'Natation', walking: 'Marche', hiking: 'Randonnée',
  strength_training: 'Musculation', indoor_cardio: 'Cardio indoor',
  treadmill_running: 'Tapis', mountain_biking: 'VTT',
  open_water_swimming: 'Natation eau libre', yoga: 'Yoga',
  other: 'Autre'
};
const STATS_SPORT_COLORS = ['#2563EB','#7C3AED','#16A34A','#D97706','#DC2626','#0891B2','#DB2777'];

const STATS_DISTANCE_BANDS = {
  '5km':      { label: '5 km',     threshold: 4500,  max: 5500 },
  '10km':     { label: '10 km',    threshold: 9000,  max: 11000 },
  'semi':     { label: 'Semi',     threshold: 19000, max: 22000 },
  'marathon': { label: 'Marathon', threshold: 40000, max: 43500 },
};

const STATS_MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
const STATS_MONTHS_FULL_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const STATS_WEEKDAYS_FR = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

const EARTH_CIRCUMFERENCE_KM = 40075;
const EVEREST_HEIGHT_M = 8849;
const STATS_YEARS_PAGE_SIZE = 10;

let _statsSportFilter = ['all'];
let _statsExpandedYear = null;
let _statsCompareYears = new Set();
let _statsModalDistance = '10km';
let _statsShowOlderYears = false;

let statsRowKmChart = null;
let statsRowDplusChart = null;
let statsRowVo2Chart = null;
let statsRowSportChart = null;
let statsRowWeekdayChart = null;
let statsModalComparisonChart = null;
let statsModalProgressionChart = null;

// ─── Filtre par type d'activité (même logique que renderAllActivities) ──
// filter : 'all', une seule cle, ou un tableau de cles cumulees (pastilles
// multi-selection, cf wireSportFilterPills dans app.js)
function statsSportMatch(activityType, filter) {
  const filters = Array.isArray(filter) ? filter : [filter];
  if (filters.includes('all')) return true;
  const t = (activityType || '').toLowerCase();
  return filters.some(f => {
    if (f === 'running') return t === 'running' || t === 'treadmill_running' || (t.includes('run') && !t.includes('trail'));
    if (f === 'trail')   return t.includes('trail');
    if (f === 'cycling') return t === 'cycling' || t.includes('cycl') || t.includes('bike');
    if (f === 'cardio')  return t.includes('cardio') || t.includes('fitness') || t.includes('indoor') || t.includes('strength') || t.includes('hiit') || t.includes('muscul');
    if (f === 'walking') return t.includes('walk') || t === 'walking';
    return true;
  });
}

function isRunOrTrail(a) {
  const t = (a.activityType || '').toLowerCase();
  return t.includes('running') || t.includes('trail');
}

// ─── Chargement à la demande d'une année ────────────────────────────────
// Cache navigateur (localStorage) pour les annees passees et closes -
// evite de re-interroger Garmin a chaque rechargement de page pour des
// donnees qui ne changeront plus jamais. L'annee en cours n'est jamais
// mise en cache ici (elle continue de se recharger normalement).
const YEAR_CACHE_PREFIX = 'allure_year_cache_v1_';

function loadYearFromCache(year) {
  try {
    const raw = localStorage.getItem(YEAR_CACHE_PREFIX + year);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveYearToCache(year, activities) {
  try {
    localStorage.setItem(YEAR_CACHE_PREFIX + year, JSON.stringify(activities));
  } catch (e) {} // quota depassee ou stockage indisponible : on ignore simplement
}

function mergeYearActivities(year, activities) {
  _allActivities = _allActivities.filter(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    return isNaN(d) || d.getFullYear() !== year;
  }).concat(activities);
  _fullyLoadedYears.add(year);
}

// Charge en memoire (sans requete reseau) toute annee passee deja presente
// dans le cache localStorage - utilise au rendu de la liste pour afficher
// directement les chiffres au lieu de "Cliquez pour charger", tant que le
// cache n'a pas ete vide.
function preloadCachedYears(years) {
  const currentYear = new Date().getFullYear();
  years.forEach(y => {
    if (_fullyLoadedYears.has(y) || y >= currentYear) return;
    const cached = loadYearFromCache(y);
    if (cached) mergeYearActivities(y, cached);
  });
}

async function ensureYearLoaded(year) {
  if (_fullyLoadedYears.has(year)) return;
  const isPastYear = year < new Date().getFullYear();

  if (isPastYear) {
    const cached = loadYearFromCache(year);
    if (cached) {
      mergeYearActivities(year, cached);
      return;
    }
  }

  const resp = await fetch(`${API}/api/activities/year/${year}`);
  if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
  const data = await resp.json();
  const activities = data.activities || [];
  mergeYearActivities(year, activities);
  if (isPastYear) saveYearToCache(year, activities);
}

function getActivitiesForYearLocal(year, filter) {
  return _allActivities.filter(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    return !isNaN(d) && d.getFullYear() === year && statsSportMatch(a.activityType, filter);
  });
}

function startOfWeekMonday(d) {
  const day = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setHours(0,0,0,0);
  monday.setDate(d.getDate() - day);
  return monday;
}

// ─── Agrégation pure d'une année d'activités (déjà filtrées) ────────────
function computeYearStats(activities, year) {
  const totals = { km: 0, kmRun: 0, activities: activities.length, hours: 0, calories: 0, elevation: 0, vo2maxAvg: null };
  const sportBreakdown = {};
  const monthly = Array.from({length:12}, (_,i) => ({ month:i, km:0, elevation:0, count:0, vo2max:null, _lastVo2Date:null }));
  const byWeekday = Array.from({length:7}, (_,i) => ({ day:i, count:0, km:0 }));
  const activeDaySet = new Set();
  const weekKm = {};
  let vo2Sum = 0, vo2Count = 0;

  activities.forEach(a => {
    const km = (a.distanceKm || 0);
    const d = new Date(a.date || a.startTimeLocal || '');
    if (isNaN(d)) return;

    totals.km += km;
    if (isRunOrTrail(a)) totals.kmRun += km;
    totals.hours += (a.durationSec || 0) / 3600;
    totals.calories += a.calories || 0;
    totals.elevation += a.elevationGain || 0;
    if (a.vO2MaxValue > 0) { vo2Sum += a.vO2MaxValue; vo2Count++; }

    const type = a.activityType || 'other';
    if (!sportBreakdown[type]) sportBreakdown[type] = { count:0, km:0, hours:0, elevation:0 };
    sportBreakdown[type].count++;
    sportBreakdown[type].km += km;
    sportBreakdown[type].hours += (a.durationSec || 0) / 3600;
    sportBreakdown[type].elevation += a.elevationGain || 0;

    const m = d.getMonth();
    monthly[m].km += km;
    monthly[m].elevation += a.elevationGain || 0;
    monthly[m].count++;
    if (a.vO2MaxValue > 0 && (!monthly[m]._lastVo2Date || d > monthly[m]._lastVo2Date)) {
      monthly[m].vo2max = a.vO2MaxValue;
      monthly[m]._lastVo2Date = d;
    }

    const wd = (d.getDay() + 6) % 7;
    byWeekday[wd].count++;
    byWeekday[wd].km += km;

    const dateStr = d.toISOString().slice(0,10);
    activeDaySet.add(dateStr);
    const weekKey = startOfWeekMonday(d).toISOString().slice(0,10);
    weekKm[weekKey] = (weekKm[weekKey] || 0) + km;
  });
  monthly.forEach(m => delete m._lastVo2Date);
  totals.vo2maxAvg = vo2Count > 0 ? Math.round((vo2Sum / vo2Count) * 10) / 10 : null;

  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const yearEnd = isCurrentYear ? now : new Date(year, 11, 31);
  const dayCount = Math.floor((yearEnd - new Date(year,0,1)) / 86400000) + 1;
  let longestStreak = 0, currentStreak = 0;
  for (let i = 0; i < dayCount; i++) {
    const d = new Date(year, 0, 1 + i);
    const key = d.toISOString().slice(0,10);
    if (activeDaySet.has(key)) { currentStreak++; longestStreak = Math.max(longestStreak, currentStreak); }
    else currentStreak = 0;
  }
  const activePct = dayCount > 0 ? Math.round((activeDaySet.size / dayCount) * 100) : 0;
  const avgWeeklyKm = dayCount > 0 ? (totals.km / (dayCount / 7)) : 0;

  let bestMonth = null;
  monthly.forEach(m => { if (!bestMonth || m.km > bestMonth.km) bestMonth = m; });

  return {
    year, totals, sportBreakdown, monthly, byWeekday,
    consistency: { activeDays: activeDaySet.size, dayCount, activePct, longestStreak, avgWeeklyKm },
    peaks: { bestMonth },
  };
}

// ─── Point d'entrée (routeur) ────────────────────────────────────────────
let _statsPageInitialized = false;

async function renderStatsPage() {
  if (!_statsPageInitialized) {
    _statsPageInitialized = true;
    wireSportFilterPills(document.getElementById('stats-filters'), async (filters) => {
      _statsSportFilter = filters;
      await renderStatsYearsList();
      renderStatsAlltimeTotal();
    });
    const compareBtn = el('stats-compare-btn');
    if (compareBtn) compareBtn.addEventListener('click', () => openStatsCompareModal());
  }
  try { await ensureYearLoaded(new Date().getFullYear()); } catch (e) {}
  await renderStatsYearsList();
  renderStatsAlltimeTotal();
}

// Total toutes années confondues (pas juste la somme des lignes visibles -
// contrairement au tableau année par année, qui pagine les plus anciennes
// derrière "Afficher les années plus anciennes", ce total charge TOUTES les
// années avant de calculer, sinon il aurait le meme defaut que la page
// Activités "Toutes les années" - retour utilisateur 14/08). Rendu en deux
// temps comme renderStatsYearsList : affichage immediat si tout est deja
// charge, sinon petit chargement pendant qu'on rapatrie les annees
// manquantes en arriere-plan.
async function renderStatsAlltimeTotal() {
  const box = el('stats-alltime-total');
  if (!box) return;
  const allYears = getStatsYearRange();
  const missing = allYears.filter(y => !_fullyLoadedYears.has(y));

  if (missing.length) {
    box.style.display = '';
    box.innerHTML = `<span class="stats-alltime-total-title">Total toutes années</span><span class="stats-alltime-total-loading">Chargement…</span>`;
    await Promise.all(missing.map(y => ensureYearLoaded(y).catch(() => {})));
  }

  const activities = _allActivities.filter(a => statsSportMatch(a.activityType, _statsSportFilter));
  const s = computeYearStats(activities, new Date().getFullYear()).totals;
  box.innerHTML = `
    <span class="stats-alltime-total-title">Total toutes années</span>
    <div class="stats-alltime-total-item stats-alltime-total-item--acts"><span class="stats-alltime-total-num">${s.activities.toLocaleString('fr-FR')}</span><span class="stats-alltime-total-lbl">Activités</span></div>
    <div class="stats-alltime-total-item stats-alltime-total-item--km"><span class="stats-alltime-total-num">${Math.round(s.km).toLocaleString('fr-FR')}</span><span class="stats-alltime-total-lbl">Km</span></div>
    <div class="stats-alltime-total-item stats-alltime-total-item--elev"><span class="stats-alltime-total-num">${Math.round(s.elevation).toLocaleString('fr-FR')}</span><span class="stats-alltime-total-lbl">D+ (m)</span></div>
    <div class="stats-alltime-total-item stats-alltime-total-item--dur"><span class="stats-alltime-total-num">${Math.round(s.hours).toLocaleString('fr-FR')}h</span><span class="stats-alltime-total-lbl">Durée</span></div>
    <div class="stats-alltime-total-item stats-alltime-total-item--cal"><span class="stats-alltime-total-num">${Math.round(s.calories).toLocaleString('fr-FR')}</span><span class="stats-alltime-total-lbl">Calories</span></div>
  `;
  box.style.display = '';

  startFunFactsCarousel(computeFunFacts(s));
}

const FUN_FACT_REFS = {
  moonKm: 384400,
  earthCircumferenceKm: 40075,
  everestM: 8849,
  marathonKm: 42.195,
  bigMacKcal: 563,
};

function computeFunFacts(s) {
  const facts = [];
  const fmt = (n, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });

  if (s.km > 0) {
    facts.push(`Vous avez parcouru l'équivalent de <strong>${fmt(s.km / FUN_FACT_REFS.marathonKm, 0)} marathons</strong> !`);

    const earthRatio = s.km / FUN_FACT_REFS.earthCircumferenceKm;
    facts.push(earthRatio >= 1
      ? `Vous avez fait <strong>${fmt(earthRatio)} fois le tour de la Terre</strong> !`
      : `Vous avez parcouru <strong>${Math.round(earthRatio * 100)}% du tour de la Terre</strong> !`);

    const moonRatio = s.km / FUN_FACT_REFS.moonKm;
    facts.push(moonRatio >= 1
      ? `Vous avez couvert <strong>${fmt(moonRatio)} fois la distance Terre-Lune</strong> !`
      : `Vous avez parcouru <strong>${Math.round(moonRatio * 100)}% de la distance Terre-Lune</strong> !`);
  }
  if (s.elevation > 0) {
    facts.push(`Vous avez grimpé l'équivalent de <strong>${fmt(s.elevation / FUN_FACT_REFS.everestM)} fois l'Everest</strong> !`);
  }
  if (s.hours > 0) {
    facts.push(`Vous avez bougé pendant <strong>${fmt(s.hours / 24)} jours non-stop</strong> cumulés !`);
  }
  if (s.calories > 0) {
    facts.push(`Vous avez brûlé l'équivalent de <strong>${fmt(s.calories / FUN_FACT_REFS.bigMacKcal, 0)} Big Mac</strong> !`);
  }
  return facts;
}

let _funFactsTimer = null;
let _funFactsIdx = 0;
function startFunFactsCarousel(facts) {
  const box = el('stats-fun-facts');
  const textEl = el('stats-fun-facts-text');
  clearInterval(_funFactsTimer);
  if (!box || !textEl || !facts.length) {
    if (box) box.style.display = 'none';
    return;
  }
  _funFactsIdx = 0;
  textEl.className = 'stats-fun-facts-text';
  textEl.innerHTML = facts[0];
  box.style.display = '';
  if (facts.length < 2) return;
  _funFactsTimer = setInterval(() => {
    textEl.className = 'stats-fun-facts-text stats-fun-facts-text--out';
    setTimeout(() => {
      _funFactsIdx = (_funFactsIdx + 1) % facts.length;
      textEl.className = 'stats-fun-facts-text stats-fun-facts-text--jump';
      textEl.innerHTML = facts[_funFactsIdx];
      void textEl.offsetWidth;
      textEl.className = 'stats-fun-facts-text';
    }, 400);
  }, 4000);
}

function getStatsYearRange() {
  let earliest = new Date().getFullYear();
  _allActivities.forEach(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    if (!isNaN(d) && d.getFullYear() < earliest) earliest = d.getFullYear();
  });
  earliest = Math.min(earliest, 2010);
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear; y >= earliest; y--) years.push(y);
  return years;
}

// ─── Liste des lignes par année ──────────────────────────────────────────
// Charge TOUTES les annees affichees (pas seulement celles deja en cache
// local) puis affiche — desormais rapide meme apres un nettoyage du
// navigateur grace au cache SERVEUR des annees passees (server.js,
// data/activities_cache.json) : plus besoin de cliquer "Cliquez pour
// charger" annee par annee (vecu reel, cf CLAUDE.md). Rendu en deux temps :
// un premier affichage immediat avec ce qui est deja en memoire (jamais de
// page vide le temps du chargement), puis un second une fois les annees
// manquantes chargees en arriere-plan.
async function renderStatsYearsList() {
  const allYears = getStatsYearRange();
  const hasOlder = allYears.length > STATS_YEARS_PAGE_SIZE;
  const years = _statsShowOlderYears ? allYears : allYears.slice(0, STATS_YEARS_PAGE_SIZE);
  preloadCachedYears(years);

  await renderStatsYearsRows(years, hasOlder, allYears);

  const missing = years.filter(y => !_fullyLoadedYears.has(y));
  if (missing.length) {
    await Promise.all(missing.map(y => ensureYearLoaded(y).catch(() => {})));
    await renderStatsYearsRows(years, hasOlder, allYears);
  }
}

async function renderStatsYearsRows(years, hasOlder, allYears) {
  const container = el('stats-years-list');
  if (!container) return;

  const headerHtml = `
    <div class="stats-years-header">
      <div></div><div></div>
      <div>Activités</div><div>Km</div><div>D+ (m)</div><div>VO&#x2082;max moy.</div><div>Calories</div>
      <div></div>
    </div>
  `;

  const rowsHtml = years.map(y => {
    const loaded = _fullyLoadedYears.has(y);
    const checked = _statsCompareYears.has(y) ? 'checked' : '';
    const expanded = _statsExpandedYear === y;
    let cells;
    if (loaded) {
      const s = computeYearStats(getActivitiesForYearLocal(y, _statsSportFilter), y);
      cells = `
        <div class="stats-year-cell">${s.totals.activities}</div>
        <div class="stats-year-cell">${s.totals.km.toFixed(1)}</div>
        <div class="stats-year-cell">${Math.round(s.totals.elevation).toLocaleString('fr-FR')}</div>
        <div class="stats-year-cell">${s.totals.vo2maxAvg ?? '—'}</div>
        <div class="stats-year-cell">${Math.round(s.totals.calories).toLocaleString('fr-FR')}</div>
      `;
    } else {
      cells = `<div class="stats-year-cell stats-year-cell--loading" style="grid-column:span 5">Chargement…</div>`;
    }
    return `
      <div class="stats-year-row ${expanded ? 'stats-year-row--expanded' : ''}" data-year="${y}">
        <div class="stats-year-row-header" data-year="${y}">
          <label class="stats-year-checkbox" onclick="event.stopPropagation()">
            <input type="checkbox" data-year="${y}" ${checked}>
          </label>
          <div class="stats-year-cell stats-year-cell--year">${y}</div>
          ${cells}
          <div class="stats-year-chevron">&#x25BC;</div>
        </div>
        <div class="stats-year-row-detail" data-year="${y}" style="display:${expanded ? '' : 'none'}"></div>
      </div>
    `;
  }).join('');

  const footerHtml = hasOlder
    ? `<div class="stats-years-footer"><button type="button" class="btn-text-link" id="stats-toggle-older-years">${_statsShowOlderYears ? 'Réduire' : `Afficher les années plus anciennes (${allYears.length - STATS_YEARS_PAGE_SIZE})`}</button></div>`
    : '';

  container.innerHTML = headerHtml + rowsHtml + footerHtml;

  container.querySelectorAll('.stats-year-row-header').forEach(header => {
    header.addEventListener('click', () => toggleStatsYearRow(parseInt(header.dataset.year)));
  });
  container.querySelectorAll('.stats-year-checkbox input').forEach(cb => {
    cb.addEventListener('change', () => toggleStatsCompareYear(parseInt(cb.dataset.year), cb));
  });
  const toggleOlderBtn = document.getElementById('stats-toggle-older-years');
  if (toggleOlderBtn) toggleOlderBtn.addEventListener('click', async () => {
    _statsShowOlderYears = !_statsShowOlderYears;
    await renderStatsYearsList();
  });

  if (_statsExpandedYear !== null && years.includes(_statsExpandedYear)) {
    await renderStatsRowDetail(_statsExpandedYear);
  }
}

async function toggleStatsYearRow(year) {
  if (_statsExpandedYear === year) {
    _statsExpandedYear = null;
    await renderStatsYearsList();
    return;
  }
  const row = document.querySelector(`.stats-year-row[data-year="${year}"]`);
  const detail = document.querySelector(`.stats-year-row-detail[data-year="${year}"]`);
  if (!_fullyLoadedYears.has(year)) {
    if (detail) detail.innerHTML = `<div class="table-loading">Chargement de ${year}…</div>`;
    if (detail) detail.style.display = '';
    try { await ensureYearLoaded(year); } catch (e) {
      if (typeof showToast === 'function') showToast('Erreur de chargement : ' + e.message, 'error');
      return;
    }
  }
  _statsExpandedYear = year;
  await renderStatsYearsList();
}

async function toggleStatsCompareYear(year, checkbox) {
  let didFetch = false;
  if (checkbox.checked) {
    if (_statsCompareYears.size >= 3) {
      checkbox.checked = false;
      if (typeof showToast === 'function') showToast('Maximum 3 années à comparer', 'info');
      return;
    }
    if (!_fullyLoadedYears.has(year)) {
      didFetch = true;
      try {
        if (typeof showToast === 'function') showToast('⏳ Chargement de ' + year + '…', 'loading', 0);
        await ensureYearLoaded(year);
        const lt = document.getElementById('app-toast-loading');
        if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
      } catch (e) { checkbox.checked = false; return; }
    }
    _statsCompareYears.add(year);
  } else {
    _statsCompareYears.delete(year);
  }
  renderStatsCompareBar();
  if (didFetch) await renderStatsYearsList();
}

function renderStatsCompareBar() {
  const bar = el('stats-compare-bar');
  const chips = el('stats-compare-bar-chips');
  const btn = el('stats-compare-btn');
  if (!bar) return;
  if (_statsCompareYears.size === 0) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const years = Array.from(_statsCompareYears).sort((a,b) => a - b);
  if (chips) {
    chips.innerHTML = years.map(y => `
      <span class="stats-remove-chip">${y}<button type="button" data-year="${y}" aria-label="Retirer ${y}">&times;</button></span>
    `).join('');
    chips.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      const y = parseInt(b.dataset.year);
      _statsCompareYears.delete(y);
      renderStatsCompareBar();
      await renderStatsYearsList();
      if (isStatsModalOpen()) renderStatsCompareModalContent();
    }));
  }
  if (btn) btn.disabled = years.length < 2;
}

// ─── Détail (tuiles) d'une ligne dépliée ────────────────────────────────
async function renderStatsRowDetail(year) {
  const detail = document.querySelector(`.stats-year-row-detail[data-year="${year}"]`);
  if (!detail) return;
  const stats = computeYearStats(getActivitiesForYearLocal(year, _statsSportFilter), year);
  const showSportTile = _statsSportFilter.includes('all');

  detail.innerHTML = `
    <div class="stats-tile-grid">
      <div class="stats-tile">
        <div class="stats-tile-title">&#x1F4C8; Km par mois</div>
        <div class="chart-container"><canvas id="stats-row-km-chart"></canvas></div>
      </div>
      <div class="stats-tile">
        <div class="stats-tile-title">&#x26F0;&#xFE0F; D+ par mois</div>
        <div class="chart-container"><canvas id="stats-row-dplus-chart"></canvas></div>
      </div>
      <div class="stats-tile">
        <div class="stats-tile-title">&#x1FAC1; VO&#x2082;max par mois</div>
        <div class="chart-container"><canvas id="stats-row-vo2-chart"></canvas></div>
      </div>
      ${showSportTile ? `
      <div class="stats-tile">
        <div class="stats-tile-title">&#x1F3AF; Répartition par sport</div>
        <div class="chart-container"><canvas id="stats-row-sport-chart"></canvas></div>
      </div>` : ''}
      <div class="stats-tile stats-tile--consistency">
        <div class="stats-tile-title">&#x1F5D3;&#xFE0F; Régularité</div>
        <div class="stats-tile-mini-stat"><span>Plus longue série</span><b>${stats.consistency.longestStreak} j</b></div>
        <div class="stats-tile-mini-stat"><span>Jours actifs</span><b>${stats.consistency.activePct}%</b></div>
        <div class="stats-tile-mini-stat"><span>Km / semaine</span><b>${stats.consistency.avgWeeklyKm.toFixed(1)}</b></div>
        <div class="stats-tile-mini-stat"><span>Meilleur mois</span><b>${stats.peaks.bestMonth ? STATS_MONTHS_FULL_FR[stats.peaks.bestMonth.month] : '—'}</b></div>
      </div>
      <div class="stats-tile">
        <div class="stats-tile-title">&#x1F4C5; Par jour de semaine</div>
        <div class="chart-container"><canvas id="stats-row-weekday-chart"></canvas></div>
      </div>
    </div>
  `;

  const labels = STATS_MONTHS_FR;
  if (statsRowKmChart) { statsRowKmChart.destroy(); statsRowKmChart = null; }
  const kmCanvas = el('stats-row-km-chart');
  if (kmCanvas) statsRowKmChart = new Chart(kmCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: stats.monthly.map(m => Math.round(m.km*10)/10), backgroundColor:'rgba(37,99,235,0.65)', borderRadius:3 }] },
    options: statsTileChartOptions(),
  });

  if (statsRowDplusChart) { statsRowDplusChart.destroy(); statsRowDplusChart = null; }
  const dplusCanvas = el('stats-row-dplus-chart');
  if (dplusCanvas) statsRowDplusChart = new Chart(dplusCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [{ data: stats.monthly.map(m => Math.round(m.elevation)), backgroundColor:'rgba(217,119,6,0.65)', borderRadius:3 }] },
    options: statsTileChartOptions(),
  });

  if (statsRowVo2Chart) { statsRowVo2Chart.destroy(); statsRowVo2Chart = null; }
  const vo2Canvas = el('stats-row-vo2-chart');
  if (vo2Canvas) statsRowVo2Chart = new Chart(vo2Canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data: stats.monthly.map(m => m.vo2max), borderColor:'#7C3AED', backgroundColor:'rgba(124,58,237,0.07)',
      borderWidth:2, pointRadius:2, tension:0.4, fill:true, spanGaps:true }] },
    options: statsTileChartOptions(),
  });

  if (statsRowWeekdayChart) { statsRowWeekdayChart.destroy(); statsRowWeekdayChart = null; }
  const wdCanvas = el('stats-row-weekday-chart');
  if (wdCanvas) statsRowWeekdayChart = new Chart(wdCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: ['L','M','M','J','V','S','D'], datasets: [{ data: stats.byWeekday.map(d => Math.round(d.km*10)/10), backgroundColor:'rgba(22,163,74,0.65)', borderRadius:3 }] },
    options: statsTileChartOptions(),
  });

  if (statsRowSportChart) { statsRowSportChart.destroy(); statsRowSportChart = null; }
  if (showSportTile) {
    const sportCanvas = el('stats-row-sport-chart');
    const entries = Object.entries(stats.sportBreakdown).filter(([,v]) => v.count > 0).sort((a,b) => b[1].km - a[1].km);
    if (sportCanvas && entries.length > 0) {
      const sportLabels = entries.map(([k]) => STATS_SPORT_LABELS_FR[k] || k.replace(/_/g,' '));
      const colors = entries.map((_, i) => STATS_SPORT_COLORS[i % STATS_SPORT_COLORS.length]);
      statsRowSportChart = new Chart(sportCanvas.getContext('2d'), {
        type: 'bar',
        data: { labels: sportLabels, datasets: [{ data: entries.map(([,v]) => v.count), backgroundColor: colors, borderRadius: 3 }] },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor:'#111', titleColor:'#fff', bodyColor:'#ADADAD', padding:8, cornerRadius:8, displayColors:false,
              callbacks: {
                label: (ctx) => {
                  const v = entries[ctx.dataIndex][1];
                  return `${v.count} activités · ${v.km.toFixed(0)} km · ${v.hours.toFixed(0)}h`;
                },
              },
            },
          },
          scales: {
            x: { grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false }, ticks: { color:'#ADADAD', font:{ size:9 } }, border: { display:false } },
            y: { grid: { display: false }, ticks: { color:'#ADADAD', font:{ size:10 } }, border: { display:false } },
          },
        },
      });
    }
  }
}

function statsTileChartOptions() {
  const base = chartOptions();
  return { ...base,
    plugins: { ...base.plugins, legend: { display:false } },
    scales: { x: { ...base.scales.x, ticks: { ...base.scales.x.ticks, font: { size: 9 } } },
              y: { ...base.scales.y, ticks: { ...base.scales.y.ticks, font: { size: 9 } } } },
  };
}

// ─── Modale de comparaison ───────────────────────────────────────────────
function isStatsModalOpen() { return !!document.getElementById('stats-compare-modal'); }

function openStatsCompareModal() {
  if (_statsCompareYears.size < 2) return;
  if (isStatsModalOpen()) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'stats-modal-backdrop';
  backdrop.id = 'stats-compare-modal';
  backdrop.innerHTML = `
    <div class="stats-modal" onclick="event.stopPropagation()">
      <div class="stats-modal-header">
        <h2>Comparaison entre années</h2>
        <button class="stats-modal-close" id="stats-modal-close-btn">&times;</button>
      </div>
      <div class="stats-modal-chips" id="stats-modal-chips"></div>
      <div id="stats-modal-content"></div>
    </div>
  `;
  document.body.appendChild(backdrop);
  attachBackdropClose(backdrop, closeStatsCompareModal);
  document.getElementById('stats-modal-close-btn').addEventListener('click', closeStatsCompareModal);
  renderStatsCompareModalContent();
}

function closeStatsCompareModal() {
  if (statsModalComparisonChart) { statsModalComparisonChart.destroy(); statsModalComparisonChart = null; }
  if (statsModalProgressionChart) { statsModalProgressionChart.destroy(); statsModalProgressionChart = null; }
  const modal = document.getElementById('stats-compare-modal');
  if (modal) modal.remove();
}

// Ligne de tableau comparatif avec fleches (vert = meilleure valeur, rouge =
// moins bonne) - ne s'affiche que s'il y a un ecart reel entre les annees.
function buildCompareRow(label, values) {
  const nums = values.map(v => v.raw);
  const valid = nums.filter(v => typeof v === 'number' && !isNaN(v));
  const max = valid.length ? Math.max(...valid) : null;
  const min = valid.length ? Math.min(...valid) : null;
  const showArrows = valid.length >= 2 && max !== min;
  const cells = values.map(v => {
    let arrow = '';
    if (showArrows && typeof v.raw === 'number') {
      if (v.raw === max) arrow = '<span class="stats-arrow stats-arrow--up">&#x25B2;</span>';
      else if (v.raw === min) arrow = '<span class="stats-arrow stats-arrow--down">&#x25BC;</span>';
    }
    return `<div>${arrow}${v.display}</div>`;
  });
  return `<div class="stats-compare-row"><div>${label}</div>${cells.join('')}</div>`;
}

function buildCompareTable(years, statsPerYear) {
  return `
    <div class="stats-compare-row stats-compare-row--head"><div></div>${years.map(y => `<div>${y}</div>`).join('')}</div>
    ${buildCompareRow('Km', statsPerYear.map(s => ({ raw: s.totals.km, display: s.totals.km.toFixed(1) })))}
    ${buildCompareRow('D+ (m)', statsPerYear.map(s => ({ raw: s.totals.elevation, display: Math.round(s.totals.elevation).toLocaleString('fr-FR') })))}
    ${buildCompareRow('Activités', statsPerYear.map(s => ({ raw: s.totals.activities, display: String(s.totals.activities) })))}
    ${buildCompareRow('Heures', statsPerYear.map(s => ({ raw: s.totals.hours, display: s.totals.hours.toFixed(1) })))}
    ${buildCompareRow('VO&#x2082;max moy.', statsPerYear.map(s => ({ raw: s.totals.vo2maxAvg, display: s.totals.vo2maxAvg ?? '—' })))}
  `;
}

// Restreint les activites d'une annee a la meme fenetre "1er janvier -
// cutoffDate" qu'une autre annee, pour comparer equitablement une annee
// en cours (incomplete) a une annee complete.
function computeSamePeriodStats(year, filter, cutoffDate) {
  const cutoffInYear = new Date(year, cutoffDate.getMonth(), cutoffDate.getDate(), 23, 59, 59, 999);
  const activities = getActivitiesForYearLocal(year, filter).filter(a => {
    const d = new Date(a.date || a.startTimeLocal || '');
    return !isNaN(d) && d <= cutoffInYear;
  });
  return computeYearStats(activities, year);
}

function renderStatsCompareModalContent() {
  if (_statsCompareYears.size < 2) { closeStatsCompareModal(); return; }
  const years = Array.from(_statsCompareYears).sort((a,b) => a - b);

  const chips = document.getElementById('stats-modal-chips');
  if (chips) {
    chips.innerHTML = years.map(y => `
      <span class="stats-remove-chip">${y}<button type="button" data-year="${y}" aria-label="Retirer ${y}">&times;</button></span>
    `).join('');
    chips.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      const y = parseInt(b.dataset.year);
      _statsCompareYears.delete(y);
      renderStatsCompareBar();
      await renderStatsYearsList();
      renderStatsCompareModalContent();
    }));
  }

  const content = document.getElementById('stats-modal-content');
  if (!content) return;
  if (years.length < 2) { closeStatsCompareModal(); return; }

  const statsPerYear = years.map(y => computeYearStats(getActivitiesForYearLocal(y, _statsSportFilter), y));

  const today = new Date();
  const currentYear = today.getFullYear();
  const hasIncompleteYear = years.includes(currentYear) && years.some(y => y !== currentYear);
  const cutoffLabel = today.toLocaleDateString('fr-FR', { day:'numeric', month:'long' });

  content.innerHTML = `
    <div class="stats-modal-section">
      <div class="stats-modal-section-title">Vue d'ensemble</div>
      <div class="stats-compare-table" id="stats-modal-table"></div>
      <div class="chart-container" style="height:220px;margin-top:12px"><canvas id="stats-modal-comparison-chart"></canvas></div>
    </div>
    ${hasIncompleteYear ? `
    <div class="stats-modal-section">
      <div class="stats-modal-section-title">Sur la même période (1er janvier – ${cutoffLabel})</div>
      <div class="stats-compare-table" id="stats-modal-same-period-table"></div>
      <div class="stats-note">${currentYear} n'est pas terminée : comparaison équitable sur la même fenêtre de dates.</div>
    </div>` : ''}
    <div class="stats-modal-section">
      <div class="stats-modal-section-title">Progression de l'allure</div>
      <div class="stats-distance-pills" id="stats-modal-distance-pills"></div>
      <div class="chart-container" style="height:220px;margin-top:12px"><canvas id="stats-modal-progression-chart"></canvas></div>
      <div class="stats-note" id="stats-modal-progression-note"></div>
    </div>
    <div class="stats-modal-section">
      <div class="stats-modal-section-title">Cumul sur ces années</div>
      <div class="stats-funfacts-grid" id="stats-modal-funfacts"></div>
    </div>
  `;

  const table = document.getElementById('stats-modal-table');
  if (table) table.innerHTML = buildCompareTable(years, statsPerYear);

  if (hasIncompleteYear) {
    const samePeriodStats = years.map(y => computeSamePeriodStats(y, _statsSportFilter, today));
    const spTable = document.getElementById('stats-modal-same-period-table');
    if (spTable) spTable.innerHTML = buildCompareTable(years, samePeriodStats);
  }

  if (statsModalComparisonChart) { statsModalComparisonChart.destroy(); statsModalComparisonChart = null; }
  const compCanvas = document.getElementById('stats-modal-comparison-chart');
  if (compCanvas) {
    statsModalComparisonChart = new Chart(compCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Km', 'D+ (÷10, m)', 'Activités'],
        datasets: years.map((y, i) => ({
          label: String(y),
          data: [statsPerYear[i].totals.km, statsPerYear[i].totals.elevation / 10, statsPerYear[i].totals.activities],
          backgroundColor: STATS_SPORT_COLORS[i % STATS_SPORT_COLORS.length],
          borderRadius: 4,
        })),
      },
      options: { ...chartOptions(), plugins: { ...chartOptions().plugins, legend: { display: true, position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } } },
    });
  }

  renderStatsModalDistancePills(years);
  renderStatsModalProgression(years);
  renderStatsModalFunFacts(years, statsPerYear);
}

function renderStatsModalDistancePills(years) {
  const wrap = document.getElementById('stats-modal-distance-pills');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(STATS_DISTANCE_BANDS).map(([key, band]) => `
    <button type="button" class="stats-pill ${_statsModalDistance === key ? 'stats-pill--active' : ''}" data-distance="${key}">${band.label}</button>
  `).join('');
  wrap.querySelectorAll('.stats-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _statsModalDistance = btn.dataset.distance;
      renderStatsModalDistancePills(years);
      renderStatsModalProgression(years);
    });
  });
}

// Allure = temps/km, exprimée en secondes/km. Le graphique affiche le
// format "M:SS/km" (via formatPace, comme partout ailleurs dans l'appli) —
// PAS une valeur décimale de minutes (ex: "5.8"), qui ne veut rien dire.
function renderStatsModalProgression(years) {
  const band = STATS_DISTANCE_BANDS[_statsModalDistance];
  const canvas = document.getElementById('stats-modal-progression-chart');
  const note = document.getElementById('stats-modal-progression-note');
  if (!canvas) return;

  const byMonth = {};
  years.forEach(y => {
    getActivitiesForYearLocal(y, _statsSportFilter).forEach(a => {
      if (!isRunOrTrail(a)) return;
      const dist = (a.distanceKm || 0) * 1000;
      if (dist < band.threshold || dist > band.max) return;
      const d = new Date(a.date || a.startTimeLocal || '');
      if (isNaN(d)) return;
      const key = d.toISOString().slice(0,7);
      const pace = a.durationSec / (dist / 1000); // secondes/km
      if (!byMonth[key] || pace < byMonth[key]) byMonth[key] = pace;
    });
  });

  const labels = Object.keys(byMonth).sort();
  const values = labels.map(k => byMonth[k]);

  if (statsModalProgressionChart) { statsModalProgressionChart.destroy(); statsModalProgressionChart = null; }
  const base = chartOptions();
  statsModalProgressionChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ label: `Allure ${band.label}`, data: values,
      borderColor:'#2563EB', backgroundColor:'rgba(37,99,235,0.07)', borderWidth:2,
      pointBackgroundColor:'#2563EB', pointRadius:4, tension:0.4, fill:true, spanGaps:true }] },
    options: {
      ...base,
      scales: {
        x: base.scales.x,
        y: { ...base.scales.y, reverse: true, ticks: { ...base.scales.y.ticks, callback: (v) => formatPace(v) } },
      },
      plugins: { ...base.plugins, tooltip: { ...base.plugins.tooltip, callbacks: { label: (ctx) => formatPace(ctx.parsed.y) } } },
    },
  });

  if (note) {
    note.textContent = labels.length === 0
      ? `Aucune sortie ${band.label} trouvée sur ${years.join(', ')}.`
      : `Basé sur les années comparées : ${years.join(', ')}.`;
  }
}

function renderStatsModalFunFacts(years, statsPerYear) {
  const grid = document.getElementById('stats-modal-funfacts');
  if (!grid) return;
  const totalKm = statsPerYear.reduce((s, y) => s + y.totals.km, 0);
  const totalElevation = statsPerYear.reduce((s, y) => s + y.totals.elevation, 0);
  const earthPct = (totalKm / EARTH_CIRCUMFERENCE_KM) * 100;
  const everestCount = totalElevation / EVEREST_HEIGHT_M;

  grid.innerHTML = `
    <div class="stats-funfact-card">
      <div class="stats-funfact-value">${Math.round(totalKm).toLocaleString('fr-FR')} km</div>
      <div class="stats-funfact-label">Distance cumulée (${years.join(', ')})</div>
      <div class="stats-funfact-sub">${earthPct.toFixed(1)}% du tour de la Terre (${EARTH_CIRCUMFERENCE_KM.toLocaleString('fr-FR')} km)</div>
    </div>
    <div class="stats-funfact-card">
      <div class="stats-funfact-value">${Math.round(totalElevation).toLocaleString('fr-FR')} m</div>
      <div class="stats-funfact-label">D+ cumulé (${years.join(', ')})</div>
      <div class="stats-funfact-sub">${everestCount.toFixed(1)}x l'Everest (${EVEREST_HEIGHT_M.toLocaleString('fr-FR')} m)</div>
    </div>
  `;
}
