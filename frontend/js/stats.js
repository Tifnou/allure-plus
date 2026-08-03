/* ═══════════════════════════════════════════════
   PAGE STATISTIQUES
   Agrégations annuelles, comparaison, régularité,
   progression et cumuls — calculées côté client à
   partir de _allActivities (même source que la page
   Activités, même cache _fullyLoadedYears).
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
const STATS_WEEKDAYS_FR = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

const EARTH_CIRCUMFERENCE_KM = 40075;
const EVEREST_HEIGHT_M = 8849;

let _statsMainYear = new Date().getFullYear();
let _statsCompareYears = new Set();
let _statsDistance = '10km';
let _statsInitialized = false;

let statsComparisonChart = null;
let statsMonthlyKmChart = null;
let statsMonthlyDplusChart = null;
let statsMonthlyVo2Chart = null;
let statsSportChart = null;
let statsWeekdayChart = null;
let statsProgressionChart = null;

// ─── Chargement à la demande d'une année (même logique que le filtre
// Activités : fetch /api/activities/year/:year, merge dans _allActivities,
// marque l'année comme complète dans _fullyLoadedYears) ─────────────────
async function ensureYearLoaded(year) {
  if (_fullyLoadedYears.has(year)) return;
  const resp = await fetch(`${API}/api/activities/year/${year}`);
  if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
  const data = await resp.json();
  _allActivities = _allActivities.filter(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    return isNaN(d) || d.getFullYear() !== year;
  }).concat(data.activities || []);
  _fullyLoadedYears.add(year);
}

function getActivitiesForYearLocal(year) {
  return _allActivities.filter(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    return !isNaN(d) && d.getFullYear() === year;
  });
}

function isRunOrTrail(a) {
  const t = (a.activityType || '').toLowerCase();
  return t.includes('running') || t.includes('trail');
}

function startOfWeekMonday(d) {
  const day = (d.getDay() + 6) % 7; // 0 = Lundi
  const monday = new Date(d);
  monday.setHours(0,0,0,0);
  monday.setDate(d.getDate() - day);
  return monday;
}

// ─── Agrégation pure d'une année d'activités ───────────────────────────
function computeYearStats(activities, year) {
  const totals = { km: 0, kmRun: 0, activities: activities.length, hours: 0, calories: 0, elevation: 0 };
  const sportBreakdown = {};
  const monthly = Array.from({length:12}, (_,i) => ({ month:i, km:0, elevation:0, count:0, vo2max:null, _lastVo2Date:null }));
  const byWeekday = Array.from({length:7}, (_,i) => ({ day:i, count:0, km:0 }));
  const activeDaySet = new Set();
  const weekKm = {};

  activities.forEach(a => {
    const km = (a.distanceKm || 0);
    const d = new Date(a.date || a.startTimeLocal || '');
    if (isNaN(d)) return;

    totals.km += km;
    if (isRunOrTrail(a)) totals.kmRun += km;
    totals.hours += (a.durationSec || 0) / 3600;
    totals.calories += a.calories || 0;
    totals.elevation += a.elevationGain || 0;

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

  // Régularité : plus longue série de jours consécutifs actifs dans l'année
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

  // Pics : semaine et mois avec le plus de km
  let bestWeek = null;
  Object.entries(weekKm).forEach(([wk, km]) => {
    if (!bestWeek || km > bestWeek.km) bestWeek = { weekStart: wk, km };
  });
  let bestMonth = null;
  monthly.forEach(m => { if (!bestMonth || m.km > bestMonth.km) bestMonth = m; });

  return {
    year, totals, sportBreakdown, monthly, byWeekday,
    consistency: { activeDays: activeDaySet.size, dayCount, activePct, longestStreak, avgWeeklyKm },
    peaks: { bestWeek, bestMonth },
  };
}

// ─── Point d'entrée (routeur) ──────────────────────────────────────────
async function renderStatsPage() {
  populateStatsYearSelector();
  const yearSel = el('stats-year');
  if (yearSel && yearSel.value) _statsMainYear = parseInt(yearSel.value);

  try {
    await ensureYearLoaded(_statsMainYear);
  } catch (e) {
    if (typeof showToast === 'function') showToast('Erreur de chargement : ' + e.message, 'error');
  }
  await refreshStatsView();

  if (!_statsInitialized) {
    _statsInitialized = true;
    if (yearSel) yearSel.addEventListener('change', async () => {
      _statsMainYear = parseInt(yearSel.value);
      if (typeof showToast === 'function') showToast('⏳ Chargement de ' + _statsMainYear + '…', 'loading', 0);
      try { await ensureYearLoaded(_statsMainYear); } catch (e) {}
      const lt = document.getElementById('app-toast-loading');
      if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
      populateStatsYearSelector();
      await refreshStatsView();
    });
  }
}

async function refreshStatsView() {
  const activities = getActivitiesForYearLocal(_statsMainYear);
  const stats = computeYearStats(activities, _statsMainYear);

  renderStatsKpis(stats);
  renderStatsCompareChips();
  await renderStatsComparison();
  renderStatsMonthlyCharts(stats);
  renderStatsSportDonut(stats);
  renderStatsConsistency(stats);
  renderStatsDistancePills();
  await renderStatsProgression();
  renderStatsFunFacts();
}

// ─── Sélecteur d'année principal ───────────────────────────────────────
function populateStatsYearSelector() {
  const yearSel = el('stats-year');
  if (!yearSel) return;
  const prevVal = yearSel.value || String(_statsMainYear);
  yearSel.innerHTML = '';

  let earliest = new Date().getFullYear();
  _allActivities.forEach(a => {
    const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
    if (!isNaN(d) && d.getFullYear() < earliest) earliest = d.getFullYear();
  });
  earliest = Math.min(earliest, 2010);

  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= earliest; y--) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSel.appendChild(opt);
  }
  if (yearSel.querySelector(`option[value="${prevVal}"]`)) yearSel.value = prevVal;
  else yearSel.value = String(currentYear);
}

// ─── KPIs de l'année principale ─────────────────────────────────────────
function renderStatsKpis(stats) {
  const el2 = el('stats-kpis');
  if (!el2) return;
  const t = stats.totals;
  el2.innerHTML = `
    <div class="stat-card">
      <span class="stat-card-icon">&#x1F3C3;</span>
      <div class="stat-value">${t.km.toFixed(1)}</div>
      <div class="stat-label">Kilomètres</div>
      <div class="stat-sub">dont ${t.kmRun.toFixed(1)} km en course</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-icon">&#x26A1;</span>
      <div class="stat-value">${t.activities}</div>
      <div class="stat-label">Activités</div>
      <div class="stat-sub">${t.hours.toFixed(1)}h d'entraînement</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-icon">&#x26F0;&#xFE0F;</span>
      <div class="stat-value">${Math.round(t.elevation).toLocaleString('fr-FR')}</div>
      <div class="stat-label">D+ (m)</div>
    </div>
    <div class="stat-card">
      <span class="stat-card-icon">&#x1F525;</span>
      <div class="stat-value">${Math.round(t.calories).toLocaleString('fr-FR')}</div>
      <div class="stat-label">Calories</div>
    </div>
  `;
}

// ─── Chips de comparaison ───────────────────────────────────────────────
function renderStatsCompareChips() {
  const wrap = el('stats-compare-chips');
  if (!wrap) return;
  const currentYear = new Date().getFullYear();
  let earliest = currentYear;
  _allActivities.forEach(a => {
    const d = new Date(a.date || a.startTimeLocal || '');
    if (!isNaN(d) && d.getFullYear() < earliest) earliest = d.getFullYear();
  });
  earliest = Math.min(earliest, 2010);

  const years = [];
  for (let y = currentYear; y >= earliest; y--) if (y !== _statsMainYear) years.push(y);

  wrap.innerHTML = years.map(y => `
    <button type="button" class="stats-chip ${_statsCompareYears.has(y) ? 'stats-chip--active' : ''}" data-year="${y}">
      ${y}
    </button>
  `).join('');

  wrap.querySelectorAll('.stats-chip').forEach(btn => {
    btn.addEventListener('click', async () => {
      const y = parseInt(btn.dataset.year);
      if (_statsCompareYears.has(y)) {
        _statsCompareYears.delete(y);
      } else {
        if (_statsCompareYears.size >= 2) { if (typeof showToast === 'function') showToast('Maximum 2 années de comparaison', 'info'); return; }
        _statsCompareYears.add(y);
        try { await ensureYearLoaded(y); } catch (e) {}
        await renderStatsProgression();
        renderStatsFunFacts();
      }
      renderStatsCompareChips();
      await renderStatsComparison();
    });
  });
}

// ─── Comparaison entre années ────────────────────────────────────────────
async function renderStatsComparison() {
  const section = el('stats-comparison-section');
  if (!section) return;
  if (_statsCompareYears.size === 0) { section.style.display = 'none'; return; }
  section.style.display = '';

  const years = [_statsMainYear, ..._statsCompareYears].sort((a,b) => a - b);
  const statsPerYear = years.map(y => computeYearStats(getActivitiesForYearLocal(y), y));

  const table = el('stats-comparison-table');
  if (table) {
    table.innerHTML = `
      <div class="stats-compare-table">
        <div class="stats-compare-row stats-compare-row--head">
          <div></div>${years.map(y => `<div>${y}</div>`).join('')}
        </div>
        <div class="stats-compare-row"><div>Km</div>${statsPerYear.map(s => `<div>${s.totals.km.toFixed(1)}</div>`).join('')}</div>
        <div class="stats-compare-row"><div>D+ (m)</div>${statsPerYear.map(s => `<div>${Math.round(s.totals.elevation).toLocaleString('fr-FR')}</div>`).join('')}</div>
        <div class="stats-compare-row"><div>Activités</div>${statsPerYear.map(s => `<div>${s.totals.activities}</div>`).join('')}</div>
        <div class="stats-compare-row"><div>Heures</div>${statsPerYear.map(s => `<div>${s.totals.hours.toFixed(1)}</div>`).join('')}</div>
      </div>
    `;
  }

  const canvas = el('stats-comparison-chart');
  if (canvas) {
    if (statsComparisonChart) statsComparisonChart.destroy();
    statsComparisonChart = new Chart(canvas.getContext('2d'), {
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
      options: chartOptions(),
    });
  }
}

// ─── Graphiques mensuels (km, D+, VO2max) ───────────────────────────────
function renderStatsMonthlyCharts(stats) {
  const labels = STATS_MONTHS_FR;

  const kmCanvas = el('stats-monthly-km-chart');
  if (kmCanvas) {
    if (statsMonthlyKmChart) statsMonthlyKmChart.destroy();
    statsMonthlyKmChart = new Chart(kmCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label:'Km', data: stats.monthly.map(m => Math.round(m.km*10)/10),
        backgroundColor:'rgba(37,99,235,0.65)', borderRadius:4 }] },
      options: chartOptions(),
    });
  }

  const dplusCanvas = el('stats-monthly-dplus-chart');
  if (dplusCanvas) {
    if (statsMonthlyDplusChart) statsMonthlyDplusChart.destroy();
    statsMonthlyDplusChart = new Chart(dplusCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label:'D+', data: stats.monthly.map(m => Math.round(m.elevation)),
        backgroundColor:'rgba(217,119,6,0.65)', borderRadius:4 }] },
      options: chartOptions(),
    });
  }

  const vo2Canvas = el('stats-monthly-vo2max-chart');
  if (vo2Canvas) {
    if (statsMonthlyVo2Chart) statsMonthlyVo2Chart.destroy();
    statsMonthlyVo2Chart = new Chart(vo2Canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label:'VO₂max', data: stats.monthly.map(m => m.vo2max),
        borderColor:'#7C3AED', backgroundColor:'rgba(124,58,237,0.07)', borderWidth:2,
        pointBackgroundColor:'#7C3AED', pointRadius:4, tension:0.4, fill:true, spanGaps:true }] },
      options: chartOptions(),
    });
  }
}

// ─── Donut répartition par sport ────────────────────────────────────────
function renderStatsSportDonut(stats) {
  const canvas = el('stats-sport-chart');
  const legend = el('stats-sport-legend');
  if (!canvas) return;

  const entries = Object.entries(stats.sportBreakdown).filter(([,v]) => v.count > 0).sort((a,b) => b[1].km - a[1].km);
  if (entries.length === 0) { if (legend) legend.innerHTML = ''; if (statsSportChart) { statsSportChart.destroy(); statsSportChart = null; } return; }

  const labels = entries.map(([k]) => STATS_SPORT_LABELS_FR[k] || k.replace(/_/g,' '));
  const values = entries.map(([,v]) => v.count);

  if (statsSportChart) statsSportChart.destroy();
  statsSportChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: STATS_SPORT_COLORS, borderWidth:0, hoverOffset:4 }] },
    options: { responsive:true, maintainAspectRatio:false, cutout:'70%',
      plugins: { legend:{display:false}, tooltip:{backgroundColor:'#111', titleColor:'#fff', bodyColor:'#ADADAD', padding:8, cornerRadius:8, displayColors:true } } },
  });

  if (legend) {
    legend.innerHTML = entries.map(([, v], i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${STATS_SPORT_COLORS[i % STATS_SPORT_COLORS.length]}"></div>
        <span>${labels[i]} — ${v.count} · ${v.km.toFixed(0)} km · ${v.hours.toFixed(0)}h${v.elevation > 0 ? ' · ' + Math.round(v.elevation) + 'm D+' : ''}</span>
      </div>
    `).join('');
  }
}

// ─── Régularité ──────────────────────────────────────────────────────────
function renderStatsConsistency(stats) {
  const kpis = el('stats-consistency-kpis');
  if (kpis) {
    const c = stats.consistency;
    kpis.innerHTML = `
      <div class="profile-ind-card">
        <div class="profile-ind-value">${c.longestStreak}</div>
        <div class="profile-ind-label">Plus longue série</div>
        <div class="profile-ind-sub">jours consécutifs actifs</div>
      </div>
      <div class="profile-ind-card">
        <div class="profile-ind-value">${c.activePct}%</div>
        <div class="profile-ind-label">Jours actifs</div>
        <div class="profile-ind-sub">${c.activeDays} / ${c.dayCount} jours</div>
      </div>
      <div class="profile-ind-card">
        <div class="profile-ind-value">${c.avgWeeklyKm.toFixed(1)}</div>
        <div class="profile-ind-label">Km / semaine</div>
        <div class="profile-ind-sub">moyenne sur l'année</div>
      </div>
      <div class="profile-ind-card">
        <div class="profile-ind-value">${stats.peaks.bestMonth ? STATS_MONTHS_FR[stats.peaks.bestMonth.month] : '—'}</div>
        <div class="profile-ind-label">Meilleur mois</div>
        <div class="profile-ind-sub">${stats.peaks.bestMonth ? stats.peaks.bestMonth.km.toFixed(1) + ' km' : ''}</div>
      </div>
    `;
  }

  const canvas = el('stats-weekday-chart');
  if (canvas) {
    if (statsWeekdayChart) statsWeekdayChart.destroy();
    statsWeekdayChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: STATS_WEEKDAYS_FR, datasets: [{ label:'Km', data: stats.byWeekday.map(d => Math.round(d.km*10)/10),
        backgroundColor:'rgba(22,163,74,0.65)', borderRadius:4 }] },
      options: chartOptions(),
    });
  }
}

// ─── Sélecteur de distance (progression) ────────────────────────────────
function renderStatsDistancePills() {
  const wrap = el('stats-distance-pills');
  if (!wrap) return;
  wrap.innerHTML = Object.entries(STATS_DISTANCE_BANDS).map(([key, band]) => `
    <button type="button" class="stats-pill ${_statsDistance === key ? 'stats-pill--active' : ''}" data-distance="${key}">${band.label}</button>
  `).join('');
  wrap.querySelectorAll('.stats-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      _statsDistance = btn.dataset.distance;
      renderStatsDistancePills();
      await renderStatsProgression();
    });
  });
}

// ─── Progression : meilleure allure par mois sur les années chargées ────
async function renderStatsProgression() {
  const band = STATS_DISTANCE_BANDS[_statsDistance];
  const canvas = el('stats-progression-chart');
  const note = el('stats-progression-note');
  if (!canvas) return;

  const loadedYears = Array.from(_fullyLoadedYears).sort();
  const byMonth = {};
  _allActivities.forEach(a => {
    if (!isRunOrTrail(a)) return;
    const dist = (a.distanceKm || 0) * 1000;
    if (dist < band.threshold || dist > band.max) return;
    const d = new Date(a.date || a.startTimeLocal || '');
    if (isNaN(d)) return;
    const key = d.toISOString().slice(0,7);
    const pace = a.durationSec / (dist / 1000);
    if (!byMonth[key] || pace < byMonth[key]) byMonth[key] = pace;
  });

  const labels = Object.keys(byMonth).sort();
  const values = labels.map(k => byMonth[k] / 60);

  if (statsProgressionChart) statsProgressionChart.destroy();
  statsProgressionChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ label: `Allure ${band.label} (min/km)`, data: values,
      borderColor:'#2563EB', backgroundColor:'rgba(37,99,235,0.07)', borderWidth:2,
      pointBackgroundColor:'#2563EB', pointRadius:4, tension:0.4, fill:true, spanGaps:true }] },
    options: { ...chartOptions(), scales: { ...chartOptions().scales,
      y: { ...chartOptions().scales.y, reverse: true } } },
  });

  if (note) {
    const earliestLoaded = loadedYears.length > 0 ? Math.min(...loadedYears) : new Date().getFullYear();
    note.innerHTML = labels.length === 0
      ? `Aucune sortie ${band.label} trouvée sur les années chargées (${loadedYears.join(', ') || 'aucune'}).`
      : `Basé sur les années chargées : ${loadedYears.join(', ')}. `
        + `<button type="button" class="btn-text-link" id="stats-load-more-year">Charger ${earliestLoaded - 1}</button>`;
    const btn = document.getElementById('stats-load-more-year');
    if (btn) btn.addEventListener('click', async () => {
      const y = earliestLoaded - 1;
      if (typeof showToast === 'function') showToast('⏳ Chargement de ' + y + '…', 'loading', 0);
      try { await ensureYearLoaded(y); } catch (e) {}
      const lt = document.getElementById('app-toast-loading');
      if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
      await renderStatsProgression();
      renderStatsFunFacts();
    });
  }
}

// ─── Cumuls "fun" sur les années chargées ────────────────────────────────
function renderStatsFunFacts() {
  const grid = el('stats-funfacts');
  const note = el('stats-funfacts-note');
  if (!grid) return;

  const loadedYears = Array.from(_fullyLoadedYears).sort();
  let totalKm = 0, totalElevation = 0;
  loadedYears.forEach(y => {
    const s = computeYearStats(getActivitiesForYearLocal(y), y);
    totalKm += s.totals.km;
    totalElevation += s.totals.elevation;
  });

  const earthPct = (totalKm / EARTH_CIRCUMFERENCE_KM) * 100;
  const everestCount = totalElevation / EVEREST_HEIGHT_M;

  grid.innerHTML = `
    <div class="stats-funfact-card">
      <div class="stats-funfact-value">${Math.round(totalKm).toLocaleString('fr-FR')} km</div>
      <div class="stats-funfact-label">Distance cumulée</div>
      <div class="stats-funfact-sub">${earthPct.toFixed(1)}% du tour de la Terre (${EARTH_CIRCUMFERENCE_KM.toLocaleString('fr-FR')} km)</div>
    </div>
    <div class="stats-funfact-card">
      <div class="stats-funfact-value">${Math.round(totalElevation).toLocaleString('fr-FR')} m</div>
      <div class="stats-funfact-label">D+ cumulé</div>
      <div class="stats-funfact-sub">${everestCount.toFixed(1)}x l'Everest (${EVEREST_HEIGHT_M.toLocaleString('fr-FR')} m)</div>
    </div>
  `;
  if (note) note.textContent = `Calculé sur les années chargées : ${loadedYears.join(', ') || 'aucune'}.`;
}
