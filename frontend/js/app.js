// app.js

// Variables globales module
let _avgRestingHR = 0;  // FC repos moyenne (calculée depuis les données HR)

// ═══════════════════════════════════════════════════════
// Modale de confirmation personnalisee
// ═══════════════════════════════════════════════════════
function showConfirmModal({ title = '', message = '', confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false, icon = '' } = {}) {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'confirm-modal-backdrop';
    bd.innerHTML = `
      <div class="confirm-modal">
        ${icon ? `<div class="confirm-modal-icon">${icon}</div>` : ''}
        <div class="confirm-modal-title">${title}</div>
        <div class="confirm-modal-msg">${message}</div>
        <div class="confirm-modal-actions">
          <button class="confirm-modal-btn confirm-modal-btn--cancel" id="cm-cancel">${cancelLabel}</button>
          <button class="confirm-modal-btn ${danger ? 'confirm-modal-btn--danger' : 'confirm-modal-btn--confirm'}" id="cm-ok">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const close = (val) => { bd.remove(); resolve(val); };
    bd.querySelector('#cm-ok').onclick     = () => close(true);
    bd.querySelector('#cm-cancel').onclick = () => close(false);
    bd.addEventListener('click', e => { if (e.target === bd) close(false); });
  });
}

/* ═══════════════════════════════════════════════
   SUIVI SPORT — App JS
   Navigation, fetch API, graphiques Chart.js
═══════════════════════════════════════════════ */
const API = '';

// ─── Helpers ───────────────────────────────────
function el(id) { return document.getElementById(id); }
function setVal(id, val) { const e = el(id); if (e) e.textContent = val; }

function formatDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatPace(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—';
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2,'0')}/km`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
}

function formatDateShort(dateStr, includeYear = false) {
  if (!dateStr) return '—';
  const opts = { day:'2-digit', month:'short' };
  if (includeYear) opts.year = 'numeric';
  return new Date(dateStr).toLocaleDateString('fr-FR', opts);
}

function formatTime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}m${String(s).padStart(2,'0')}s`;
  return `${m}m${String(s).padStart(2,'0')}s`;
}

// activityType est une string simple ex: "running", "trail_running"
function activityTypeLabel(type) {
  if (!type) return '—';
  const t = type.toLowerCase();
  if (t.includes('trail'))    return 'Trail';
  if (t.includes('treadmill')) return 'Tapis';
  if (t.includes('run'))      return 'Course';
  if (t.includes('cycl') || t.includes('bike')) return 'Vélo';
  if (t.includes('swim'))     return 'Natation';
  if (t.includes('walk'))     return 'Marche';
  if (t.includes('hik'))      return 'Rando';
  if (t.includes('strength')) return 'Muscu';
  if (t.includes('cardio'))   return 'Cardio';
  return type.replace(/_/g,' ');
}

function isRunType(type) {
  if (!type) return false;
  return type.toLowerCase().includes('run') || type.toLowerCase().includes('trail');
}

function activityTypeClass(type) {
  if (!type) return '';
  const t = type.toLowerCase();
  if (t.includes('trail')) return 'run-type-text--trail';
  if (t.includes('run'))   return 'run-type-text--running';
  return '';
}

// ─── Données globales ──────────────────────────
let _allActivities = [];  // stocké pour le filtre et le détail
let _fullyLoadedYears = new Set(); // années dont on a chargé l'ensemble complet depuis Garmin


// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = el(`page-${pageId}`);
  if (page) page.classList.add('active');

  const navItem = el(`nav-${pageId}`);
  if (navItem) navItem.classList.add('active');

  if (pageId === 'activities') {
    const actYear = el('filter-year');
    const curYear = new Date().getFullYear();
    // Reconstruire le sélecteur si nécessaire (première visite)
    if (!actYear || actYear.options.length <= 1) {
      populateYearSelector();
    }
    // Définir l'année courante par défaut seulement si rien n'est sélectionné
    if (actYear && !actYear.value) {
      actYear.value = String(curYear);
    }
    renderAllActivities(_allActivities, 'all');
  }
  if (pageId === 'records')    { if (typeof initRecordsPage === 'function') initRecordsPage(); }
  if (pageId === 'health')     renderHealthPage();
  if (pageId === 'stats')      renderStatsPage();
  if (pageId === 'profile')    renderProfile();
  if (pageId === 'admin')      { loadAdminInfo(); loadAdminLogs(); }
  if (pageId === 'goals')      { if (typeof loadGoalsPage === 'function') loadGoalsPage(); }
  // Fond transparent uniquement sur la page Plans
  document.body.classList.toggle('plans-active', pageId === 'plans');
}

document.querySelectorAll('.nav-item:not(.nav-item--soon):not(.nav-item--disabled)').forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    if (page) navigateTo(page);
  });
});

// ═══════════════════════════════════════════════
// LOGS MODAL
// ═══════════════════════════════════════════════

let _logsInterval = null;

async function loadLogs() {
  const content = document.getElementById('logs-content');
  const source  = document.getElementById('logs-source');
  try {
    const r = await fetch(`${API}/api/logs`);
    const { lines, source: src } = await r.json();
    source.textContent = src === 'file' ? ' server.log' : src === 'console' ? '️ console' : '';
    content.innerHTML = lines.map(l => {
      let color = '#94a3b8';
      if (l.includes('✅') || l.includes('[OK]') || l.includes('réussi'))   color = '#4ade80';
      if (l.includes('❌') || l.includes('[ERREUR]') || l.includes('Error')) color = '#f87171';
      if (l.includes('') || l.includes('[INSTALL]'))                       color = '#facc15';
      if (l.includes('') || l.includes('Cache'))                           color = '#60a5fa';
      if (l.includes('') || l.includes('Fetch'))                           color = '#c084fc';
      if (l.includes('⚠️') || l.includes('warn'))                            color = '#fb923c';
      return `<div style="color:${color};padding:1px 0;">${escapeHtml(l)}</div>`;
    }).join('');
    content.scrollTop = content.scrollHeight;
  } catch(e) {
    content.innerHTML = '<div style="color:#f87171;">Impossible de charger les logs.</div>';
  }
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function openLogsModal() {
  document.getElementById('logs-modal').style.display = 'block';
  loadLogs();
  _logsInterval = setInterval(loadLogs, 3000);
}

function closeLogsModal() {
  document.getElementById('logs-modal').style.display = 'none';
  clearInterval(_logsInterval);
  _logsInterval = null;
}

// ═══════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════

async function checkStatus() {
  const led  = el('server-led');
  const txt  = el('server-status-text');
  const overlay = el('server-down-overlay');

  function setLed(state, label) {
    if (led) { led.className = 'server-led ' + state; }
    if (txt) { txt.textContent = label; }
  }

  try {
    const res = await fetch(`${API}/api/status`);

    // Serveur répond → cacher l'overlay si visible
    if (overlay && overlay.style.display !== 'none') {
      overlay.style.display = 'none';
      window.location.reload(); // rechargement auto après retour serveur
      return;
    }

    // 401 = session expirée → login
    if (res.status === 401) { window.location.href = '/login'; return; }

    const data = await res.json();
    if (!data.connected) { window.location.href = '/login'; return; }

    // Voyant vert
    setLed('led-ok', 'Serveur actif');

    // Prénom Garmin dans l'en-tête sidebar
    const usernameEl = el('sidebar-username');
    if (usernameEl) {
      usernameEl.textContent = data.displayName || data.user?.split('@')[0] || '—';
    }

    // Afficher email + bouton logout dans sidebar
    const userBox   = el('sidebar-user');
    const userEmail = el('sidebar-user-email');
    if (userBox)  { userBox.style.display = 'flex'; }
    if (userEmail && data.user) { userEmail.textContent = data.user; }

    // Afficher menu Admin si compte administrateur
    showAdminNav(data.user);

    // Badge profil incomplet
    const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
    const profileBadge = el('nav-profile-badge');
    if (profileBadge) profileBadge.style.display =
      (!(profile.birthDate || profile.age) || !profile.height || !profile.weight) ? 'inline-flex' : 'none';

    // Numéro de version de l'appli
    const versionEl = el('app-version');
    if (versionEl && data.version) versionEl.textContent = 'v' + data.version;

  } catch {
    // Serveur hors ligne → voyant rouge + overlay
    setLed('led-ko', 'Serveur hors ligne');
    if (overlay) { overlay.style.display = 'flex'; }
    // Retry toutes les 5s
    setTimeout(checkStatus, 5000);
  }
}

async function handleLogout() {
  try {
    await fetch(`${API}/api/logout`, { method: 'POST' });
  } catch(e) {}
  window.location.href = '/login';
}

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════


// ─── Toast notifications ──────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  // Retirer tout toast existant du même type
  const existingId = 'app-toast-' + type;
  const existing = document.getElementById(existingId);
  if (existing) existing.remove();

  const colors = {
    success: '#10b981',
    error:   '#ef4444',
    loading: 'var(--accent, #6366f1)',
    info:    '#3b82f6'
  };
  const icons = { success: '✓', error: '✗', loading: '⏳', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.id = existingId;
  toast.style.cssText = [
    'position:fixed',
    'bottom:28px',
    'right:24px',
    'z-index:9999',
    'padding:14px 20px',
    'border-radius:14px',
    'font-size:14px',
    'font-weight:600',
    'color:#fff',
    'max-width:360px',
    'box-shadow:0 6px 24px rgba(0,0,0,0.28)',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'background:' + (colors[type] || '#3b82f6'),
    'transition:opacity 0.3s ease',
    'opacity:0'
  ].join(';');
  toast.innerHTML = '<span style="font-size:16px">' + (icons[type] || icons.info) + '</span><span>' + message + '</span>';
  document.body.appendChild(toast);
  // Fade in
  requestAnimationFrame(() => { toast.style.opacity = '1'; });

  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  return toast;
}

async function loadDashboard() {
  try {
    const res = await fetch(`${API}/api/dashboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { stats, lastRuns, allActivities, lastUpdated } = await res.json();

    _allActivities = allActivities || lastRuns || [];
    _vo2maxSeries = stats.vo2maxSeries || [];
    // Stocker VO2max le plus récent pour le Profil
    if (_vo2maxSeries.length > 0) {
      _latestVO2Max = _vo2maxSeries[_vo2maxSeries.length - 1].vo2max || stats.latestVO2Max || null;
    } else if (stats.latestVO2Max) {
      _latestVO2Max = stats.latestVO2Max;
    }
    // Valeur precise (non arrondie) utilisee pour la classification couleur/categorie
    // uniquement — Garmin classe sur cette valeur, pas sur l'entier affiche
    _latestVO2MaxPrecise = (typeof stats.vo2MaxPrecise === 'number') ? stats.vo2MaxPrecise : null;

    renderHeroStats(stats);
    renderLastRun(lastRuns);
    renderHeatmap(stats.heatmap || {});
    renderSportsChart(stats.sportBreakdown || {});
    renderVO2MaxChart(stats.vo2maxSeries || []);

    // Date du jour dans tous les headers
    const now = new Date();
    const dayStr = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const dayFormatted = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
    setVal('page-date', dayFormatted);
    // Injecter dans tous les page-header
    document.querySelectorAll('.page-header').forEach(header => {
      if (!header.querySelector('.page-header-date') && !header.querySelector('#page-date')) {
        const dateEl = document.createElement('span');
        dateEl.className = 'page-header-date';
        dateEl.textContent = dayFormatted;
        header.appendChild(dateEl);
      }
    });

    if (lastUpdated) {
      const d = new Date(lastUpdated);
      setVal('last-updated', `Mis à jour à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`);
    }
  } catch(e) {
    console.error('Erreur dashboard:', e);
  }
}

// ─── Hero Stats ────────────────────────────────
function renderHeroStats(stats) {
  setVal('stat-km-year', stats.totalKmYear);
  setVal('stat-km-run', `dont ${stats.totalKmRunYear} km en course`);
  setVal('stat-activities', stats.totalActivitiesYear);
  setVal('stat-time', `${stats.totalTimeHours}h d'entraînement`);

  // VO2max
  if (stats.latestVO2Max) {
    setVal('stat-vo2max', stats.latestVO2Max.toFixed(0));
    // TASK 1 — Color the VO2max stat number
    const vo2StatEl = el('stat-vo2max');
    const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
    const profSex = profile.sex || 'M';
    const profAge = profile.birthDate ? (() => {
      const b = new Date(profile.birthDate);
      const now = new Date();
      let a = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
      return a;
    })() : (profile.age || null);
    const vo2ForClass = (typeof stats.vo2MaxPrecise === 'number') ? stats.vo2MaxPrecise : stats.latestVO2Max;
    if (vo2StatEl && typeof vo2maxGarminColor === 'function') {
      vo2StatEl.style.color = vo2maxGarminColor(vo2ForClass, profSex, profAge);
    }
    if (typeof vo2maxLabel === 'function') setVal('dash-vo2-label', vo2maxLabel(vo2ForClass, profSex, profAge));
    if (typeof renderVo2Bar === 'function') {
      const barEl = el('dash-vo2-bar-wrap');
      if (barEl) barEl.innerHTML = renderVo2Bar(vo2ForClass, profSex, profAge);
    }
    if (typeof calcRunningCategory === 'function') {
      const runCat = calcRunningCategory(profAge, profSex);
      const runCatEl = el('dash-vo2-run-cat');
      if (runCatEl) {
        runCatEl.textContent = runCat || '';
        runCatEl.style.display = runCat ? '' : 'none';
      }
    }
    const series = stats.vo2maxSeries || [];
    if (series.length >= 2) {
      const prev = series[series.length - 2].value;
      const diff = stats.latestVO2Max - prev;
      const tag = el('stat-vo2max-trend');
      if (tag) {
        tag.style.display = 'inline-flex';
        tag.textContent = diff >= 0 ? `▲ +${diff.toFixed(1)}` : `▼ ${diff.toFixed(1)}`;
        tag.className = `stat-tag ${diff >= 0 ? 'stat-tag--up' : 'stat-tag--down'}`;
      }
    }
  } else {
    setVal('stat-vo2max', '—');
  }

  // Jours sans activité
  const days = stats.daysSinceLastActivity;
  setVal('stat-days-off', days === 0 ? '0' : String(days));
  const daysTag = el('stat-days-tag');
  if (daysTag) {
    if (days === 0)     { daysTag.textContent = ' Actif aujourd\'hui'; daysTag.className = 'stat-tag stat-tag--up'; }
    else if (days <= 2) { daysTag.textContent = '✓ Bonne régularité'; daysTag.className = 'stat-tag stat-tag--up'; }
    else if (days <= 5) { daysTag.textContent = '⚡ Il est temps !'; daysTag.className = 'stat-tag stat-tag--warn'; }
    else                { daysTag.textContent = `${days}j de pause`; daysTag.className = 'stat-tag stat-tag--down'; }
  }
}

// ─── Dernière sortie (1 seule) ─────────────────
function renderLastRun(runs) {
  const tbody = el('runs-tbody');
  if (!tbody) return;

  const last = (runs || [])[0];
  if (!last) { tbody.innerHTML = `<tr><td colspan="9" class="table-loading">Aucune activité trouvée</td></tr>`; return; }
  renderRunRow(tbody, last);
}

function renderRunRow(tbody, act) {
  const type = act.activityType || '';
  // TASK 2 — Row is clickable: opens activity detail modal
  tbody.innerHTML = `
    <tr data-activity-id="${act.id || ''}" class="activity-row" style="cursor:pointer" title="Voir le détail de l'activité">
      <td>${formatDateShort(act.date, true)}</td>
      <td><span class="run-type-text ${activityTypeClass(type)}">${activityTypeLabel(type)}</span></td>
      <td style="color:var(--text-primary)">${act.name || '—'}</td>
      <td class="dist-value">${act.distanceKm?.toFixed(2) || '—'} km</td>
      <td style="color:var(--text-secondary)">${formatDuration(act.durationSec)}</td>
      <td class="pace-value">${formatPace(act.avgPaceSecPerKm)}</td>
      <td class="hr-value">${act.avgHR ? Math.round(act.avgHR)+' bpm' : '—'}</td>
      <td style="color:var(--text-secondary)">${act.elevationGain ? Math.round(act.elevationGain)+' m' : '—'}</td>
      <td style="color:var(--text-muted)">${act.calories ? Math.round(act.calories) : '—'}</td>
    </tr>`;
  // Attach click handler to open detail modal
  const row = tbody.querySelector('.activity-row');
  if (row) {
    row.addEventListener('click', () => showActivityDetail(act));
  }
}

// Sport icon classes (pictogrammes personnalisés)
function getSportIconClass(type) {
  if (!type) return '';
  const t = type.toLowerCase();
  if (t.includes('trail'))                         return 'sport-icon--trail';
  if (t.includes('treadmill') || t.includes('run')) return 'sport-icon--running';
  if (t.includes('cycl') || t.includes('bike'))    return 'sport-icon--cycling';
  if (t.includes('walk') || t.includes('hik'))     return 'sport-icon--walking';
  if (t.includes('cardio') || t.includes('indoor') || t.includes('strength') || t.includes('fitness')) return 'sport-icon--cardio';
  return '';
}

function getSportIcon(type) {
  const cls = getSportIconClass(type);
  if (cls) return `<span class="sport-icon ${cls}"></span>`;
  return '';  // fallback emoji pour types inconnus
}

// ─── Toutes les activités ──────────────────────
// ── Synthèse activités (bandeau header) ───────────────────────────
function updateActivitySummary(count, distM, secs, filter) {
  const el = document.getElementById('activities-summary');
  if (!el) return;
  if (count === 0) { el.innerHTML = ''; return; }

  // Km : "--" si filtre sans distance
  const noKmFilter = ['cardio'].includes(filter);
  let kmStr = '—';
  if (!noKmFilter && distM > 0) kmStr = distM.toFixed(0) + ' km';  // distM est déjà en km

  // Durée : Xh YYmin
  const h   = Math.floor(secs / 3600);
  const min = Math.floor((secs % 3600) / 60);
  const durStr = h > 0 ? `${h}h${String(min).padStart(2,'0')}` : `${min} min`;

  el.innerHTML = `
    <div class="act-summary-item"><span class="act-summary-num">${count}</span><span class="act-summary-lbl">activité${count > 1 ? 's' : ''}</span></div>
    <div class="act-summary-sep">·</div>
    <div class="act-summary-item"><span class="act-summary-num">${kmStr}</span><span class="act-summary-lbl">parcourus</span></div>
    <div class="act-summary-sep">·</div>
    <div class="act-summary-item"><span class="act-summary-num">${durStr}</span><span class="act-summary-lbl">d'activité</span></div>
  `;
}

function renderAllActivities(activities, filter = 'all', yearOverride = null) {

  const tbody = el('all-activities-tbody');
  if (!tbody) return;

  // TASK 4 — Year/month filters
  const yearFilter  = yearOverride !== null ? yearOverride : (parseInt(el('filter-year')?.value) || 0);
  const monthFilter = parseInt(el('filter-month')?.value) || 0;
  // Afficher l'année consultée dans le badge header
  const yearBadge = el('activities-year-badge');
  if (yearBadge) {
    yearBadge.textContent = yearFilter ? String(yearFilter) : 'Toutes les années';
    yearBadge.style.display = '';
  }

  const filtered = (activities || []).filter(a => {
    const t = (a.activityType || '').toLowerCase();
    // Sport type filter
    let sportMatch = true;

    if (filter !== 'all') {
      if (filter === 'running') {
        sportMatch = (t === 'running' || t === 'treadmill_running' ||
          (t.includes('run') && !t.includes('trail')));
      } else if (filter === 'trail')   { sportMatch = t.includes('trail'); }
      else if (filter === 'cycling')   { sportMatch = t === 'cycling' || t.includes('cycl') || t.includes('bike'); }
      else if (filter === 'cardio')    { sportMatch = t.includes('cardio') || t.includes('fitness') || t.includes('indoor') || t.includes('strength') || t.includes('hiit') || t.includes('muscul'); }
      else if (filter === 'walking')   { sportMatch = t.includes('walk') || t === 'walking'; }
      else { sportMatch = true; }
    }
    // Year/month filter
    const date = new Date(a.startTimeLocal || a.startTimeGMT || a.beginTimestamp || a.date);
    const yearMatch  = !yearFilter  || date.getFullYear() === yearFilter;
    const monthMatch = !monthFilter || (date.getMonth() + 1) === monthFilter;
    // Recherche par nom d'activité (colonne "Activité")
    const searchTerm = (el('filter-search')?.value || '').trim().toLowerCase();
    const nameMatch = !searchTerm || (a.name || '').toLowerCase().includes(searchTerm);
    return sportMatch && yearMatch && monthMatch && nameMatch;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="table-loading">Aucune activite trouvee pour ce filtre</td></tr>`;
    // Mise à jour synthèse à 0
    updateActivitySummary(0, 0, 0, filter);
    return;
  }

  // ── Synthèse dynamique ─────────────────────────────────────────
  const noDistanceFilter = ['cardio', 'walking'].includes(filter);
  let totalDistM = 0, totalSecs = 0;
  filtered.forEach(a => {
    const t = (a.activityType || '').toLowerCase();
    const hasNoKm = t.includes('cardio') || t.includes('strength') || t.includes('hiit') ||
                    t.includes('muscul') || t.includes('indoor') || t.includes('fitness');
    if (!hasNoKm) totalDistM += (a.distanceKm || 0);  // déjà en km
    totalSecs += (a.durationSec || 0);                 // en secondes
  });
  updateActivitySummary(filtered.length, totalDistM, totalSecs, filter);
  // ──────────────────────────────────────────────────────────────

  tbody.innerHTML = filtered.map(a => {
    const type = a.activityType || '';
    const icon = getSportIcon(type);
    return `
      <tr class="activity-row" data-activity-id="${a.id || ''}">
        <td>${formatDateShort(a.date)}</td>
        <td><span class="activity-type-cell ${activityTypeClass(type)}">${icon}<span class="run-type-text">${activityTypeLabel(type)}</span></span></td>
        <td style="color:var(--text-primary);max-width:180px;overflow:hidden;text-overflow:ellipsis">${a.name || '\u2014'}</td>
        <td class="dist-value">${a.distanceKm ? a.distanceKm.toFixed(2)+' km' : '\u2014'}</td>
        <td style="color:var(--text-secondary)">${formatDuration(a.durationSec)}</td>
        <td class="pace-value">${formatPace(a.avgPaceSecPerKm)}</td>
        <td class="hr-value">${a.avgHR ? Math.round(a.avgHR)+' bpm' : '\u2014'}</td>
        <td style="color:var(--text-secondary)">${a.elevationGain ? Math.round(a.elevationGain)+' m' : '\u2014'}</td>
        <td style="color:var(--text-muted)">${a.calories ? Math.round(a.calories) : '\u2014'}</td>
        <td><button class="btn-detail">Detail &rarr;</button></td>
      </tr>`;
  }).join('');

  // Clic sur une ligne
  tbody.querySelectorAll('.activity-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.activityId;
      const act = _allActivities.find(a => String(a.id) === String(id));
      if (act) showActivityDetail(act);
    });
  });
}

// ─── Detail d une activite ─────────────────────────────────────────
function showActivityDetail(activity) {
  if (!activity) return;

  navigateTo('activity-detail');
  el('nav-activities').classList.add('active');

  const type  = activity.activityType || '';
  const dist  = activity.distanceKm ? activity.distanceKm.toFixed(2) + ' km' : '\u2014';
  const dur   = formatDuration(activity.durationSec);
  const pace  = formatPace(activity.avgPaceSecPerKm);
  const avgHR = activity.avgHR ? Math.round(activity.avgHR) + ' bpm' : '\u2014';
  const maxHR = activity.maxHR ? Math.round(activity.maxHR) + ' bpm' : '\u2014';
  const elev  = activity.elevationGain ? Math.round(activity.elevationGain) + ' m' : '\u2014';
  const cal   = activity.calories ? Math.round(activity.calories) : '\u2014';

  const detailEl = el('activity-detail-content');
  if (!detailEl) return;

  detailEl.innerHTML = `
    <div class="activity-detail-hero card">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="run-type-text ${activityTypeClass(type)}">${activityTypeLabel(type)}</span>
        <span style="color:var(--text-muted);font-family:var(--font-body)">&middot;</span>
        <span style="color:var(--text-muted);font-size:12px;font-family:var(--font-body)">${formatDate(activity.date)}</span>
      </div>
      <div class="activity-detail-title">${activity.name || 'Activite'}</div>
      <div class="activity-stats-grid" style="margin-top:14px">
        <div class="activity-stat"><div class="activity-stat-value">${dist}</div><div class="activity-stat-label">Distance</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${dur}</div><div class="activity-stat-label">Duree</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${pace}</div><div class="activity-stat-label">Allure moy.</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${avgHR}</div><div class="activity-stat-label">FC moyenne</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${maxHR}</div><div class="activity-stat-label">FC max</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${elev}</div><div class="activity-stat-label">Denivele +</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${cal}</div><div class="activity-stat-label">Calories</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${activity.vO2MaxValue || '\u2014'}</div><div class="activity-stat-label">VO2max estimee</div></div>
      </div>
      ${activity.id ? `<a href="https://connect.garmin.com/modern/activity/${activity.id}" target="_blank" class="activity-link">Voir sur Garmin Connect</a>` : ''}
    </div>`;

  // Reinitialise la carte GPS (elements statiques, reutilises a chaque activite)
  const routeLoading = el('route-loading');
  const routeBadge   = el('route-badge');
  const routeCanvas  = el('route-canvas');
  if (routeLoading) { routeLoading.style.display = ''; routeLoading.innerHTML = '<div class="route-loading-spinner"></div><div>Chargement du trace...</div>'; }
  if (routeBadge)   { routeBadge.style.display = 'none'; }
  if (routeCanvas)  { const ctx = routeCanvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, routeCanvas.width, routeCanvas.height); }

  // Reinitialise la bascule carte / profil d'elevation sur la vue "carte"
  _lastRoutePoints = null;
  _lastRouteElevation = null;
  const mapWrap = el('route-canvas-wrapper');
  const elevWrap = el('route-elevation-wrapper');
  const toggleIcon = el('route-view-toggle-icon');
  if (mapWrap)  mapWrap.classList.remove('route-view-hidden');
  if (elevWrap) elevWrap.classList.add('route-view-hidden');
  if (toggleIcon) toggleIcon.innerHTML = ICON_MOUNTAIN;
  if (routeElevationChart) { routeElevationChart.destroy(); routeElevationChart = null; }
  const toggleBtn = el('route-view-toggle');
  if (toggleBtn) { toggleBtn.style.display = ''; toggleBtn.onclick = toggleRouteView; }

  // Bouton retour
  el('btn-back-activities').onclick = () => navigateTo('activities');

  if (activity.id) loadAndDrawRoute(activity.id, dist, dur);
  loadActivityAnalysis(activity);
}

// ─── Bascule carte / profil d'elevation (transition croisee) ─────────
let _lastRoutePoints = null;
let _lastRouteElevation = null;
let routeElevationChart = null;
const ICON_MOUNTAIN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>';
const ICON_MAP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>';
function toggleRouteView() {
  const mapWrap = el('route-canvas-wrapper');
  const elevWrap = el('route-elevation-wrapper');
  const toggleIcon = el('route-view-toggle-icon');
  if (!mapWrap || !elevWrap) return;
  const showingMap = !mapWrap.classList.contains('route-view-hidden');
  if (showingMap) {
    mapWrap.classList.add('route-view-hidden');
    elevWrap.classList.remove('route-view-hidden');
    if (toggleIcon) toggleIcon.innerHTML = ICON_MAP;
    renderElevationProfile(_lastRouteElevation);
  } else {
    elevWrap.classList.add('route-view-hidden');
    mapWrap.classList.remove('route-view-hidden');
    if (toggleIcon) toggleIcon.innerHTML = ICON_MOUNTAIN;
  }
}

// elevation : [{ distKm, alt }] fourni directement par Garmin (activityDetailMetrics),
// distance cumulee et altitude deja calculees cote Garmin - pas de recalcul ici.
function renderElevationProfile(elevation) {
  const canvas = el('route-elevation-chart');
  if (!canvas) return;
  if (routeElevationChart) { routeElevationChart.destroy(); routeElevationChart = null; }
  if (!elevation || elevation.length < 2) {
    return;
  }
  const labels = elevation.map(p => p.distKm.toFixed(2));
  // Lissage (moyenne glissante) : l'altitude brute est bruitee (GPS/barometre),
  // ce qui donne une courbe en escalier meme avec une interpolation arrondie -
  // on lisse le signal en plus d'arrondir la courbe visuellement.
  const rawAlt = elevation.map(p => p.alt);
  const WINDOW = 5;
  const half = Math.floor(WINDOW / 2);
  const data = rawAlt.map((_, i) => {
    const start = Math.max(0, i - half), end = Math.min(rawAlt.length, i + half + 1);
    const slice = rawAlt.slice(start, end);
    return slice.reduce((a,b) => a+b, 0) / slice.length;
  });
  routeElevationChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.18)',
        fill: true,
        pointRadius: 0,
        borderWidth: 2,
        cubicInterpolationMode: 'monotone',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: {
        callbacks: {
          title: (items) => `${items[0].label} km`,
          label: (item) => `${Math.round(item.raw)} m`,
        }
      }},
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,0.5)', maxTicksLimit: 6, font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.06)' } },
      }
    }
  });
}
// ─── Dessin du tracé GPS (canvas animé) ─────────────
async function loadAndDrawRoute(activityId, distLabel, durLabel) {
  const canvas  = el('route-canvas');
  const loading = el('route-loading');
  const badge   = el('route-badge');
  const badgeDist = el('route-badge-dist');
  const badgeTime = el('route-badge-time');
  if (badgeDist) badgeDist.textContent = distLabel;
  if (badgeTime) badgeTime.textContent = durLabel;
  if (!canvas) return;

  try {
    const res = await fetch(`${API}/api/activity/${activityId}/gps`);
    const { points, elevation } = await res.json();

    if (!points || points.length < 3) {
      if (loading) loading.innerHTML = '<div style="font-size:13px;color:rgba(255,255,255,0.4)">Pas de données GPS<br><small>(activité indoor ?)</small></div>';
      const toggleBtn = el('route-view-toggle');
      if (toggleBtn) toggleBtn.style.display = 'none';
      return;
    }

    if (loading) loading.style.display = 'none';
    if (badge) badge.style.display = 'flex';
    const toggleBtn = el('route-view-toggle');
    if (toggleBtn) toggleBtn.style.display = (elevation && elevation.length >= 2) ? '' : 'none';
    _lastRoutePoints = points;
    _lastRouteElevation = elevation || null;
    drawRouteTrace(canvas, points);
  } catch(e) {
    if (loading) loading.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:13px">Tracé non disponible</div>';
  }
}

/** Lisse un tracé GPS (moyenne glissante sur lat/lon) pour atténuer le bruit
 *  naturel du GPS (petits zigzags) sans déformer la forme générale du
 *  parcours - même principe que le lissage du profil d'élévation. */
function smoothRoutePoints(points, windowSize = 5) {
  const half = Math.floor(windowSize / 2);
  return points.map((_, i) => {
    const start = Math.max(0, i - half), end = Math.min(points.length, i + half + 1);
    const slice = points.slice(start, end);
    const lat = slice.reduce((s, p) => s + p.lat, 0) / slice.length;
    const lon = slice.reduce((s, p) => s + p.lon, 0) / slice.length;
    return { lat, lon };
  });
}

function drawRouteTrace(canvas, rawPoints) {
  const wrapper = canvas.parentElement;
  const W = wrapper.clientWidth  || 480;
  const H = wrapper.clientHeight || 360;
  canvas.width  = W;
  canvas.height = H;
  canvas.style.zIndex = '2';
  const ctx = canvas.getContext('2d');

  const points = smoothRoutePoints(rawPoints);

  // -- Initialiser la carte Leaflet (fond OSM) --
  const mapDiv = document.getElementById('route-map');

  if (window._routeLeafletMap) {
    try { window._routeLeafletMap.remove(); } catch(e) {}
    window._routeLeafletMap = null;
  }

  let coords;
  if (mapDiv && typeof L !== 'undefined') {
    const latLngs = points.map(p => [p.lat, p.lon]);
    const bounds  = L.latLngBounds(latLngs);
    const map = L.map(mapDiv, {
      zoomControl: false, attributionControl: true,
      dragging: false, touchZoom: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false
    });
    window._routeLeafletMap = map;
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>'
    }).addTo(map);
    map.fitBounds(bounds, { padding: [44, 44] });
    coords = points.map(p => {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      return { x: pt.x, y: pt.y };
    });
  } else {
    // Fallback sans Leaflet
    const lats = points.map(p => p.lat), lons = points.map(p => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const PAD = 48, rx = maxLon-minLon||0.001, ry = maxLat-minLat||0.001;
    const scale = Math.min((W-PAD*2)/rx,(H-PAD*2)/ry);
    const ox = PAD+((W-PAD*2)-rx*scale)/2, oy = PAD+((H-PAD*2)-ry*scale)/2;
    coords = points.map(p => ({x: ox+(p.lon-minLon)*scale, y: H-oy-(p.lat-minLat)*scale}));
    const bg = ctx.createLinearGradient(0,0,W,H);
    bg.addColorStop(0,'#0a1628'); bg.addColorStop(1,'#091428');
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  }

  function drawPath(pts, lineWidth, alpha, blur, rgb) {
    const c = rgb || '239,68,68';
    ctx.save();
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.strokeStyle = `rgba(${c},${alpha})`;
    ctx.lineWidth = lineWidth; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i+1].x) / 2;
      const my = (pts[i].y + pts[i+1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
    ctx.stroke(); ctx.restore();
  }

  let pathPx = 0;
  for (let i = 1; i < coords.length; i++)
    pathPx += Math.hypot(coords[i].x-coords[i-1].x, coords[i].y-coords[i-1].y);
  const ANIM_MS = Math.min(20000, Math.max(5000, (pathPx/90)*1000));
  let startTs = null;

  function drawFrame(now) {
    if (!startTs) startTs = now;
    const raw = (now - startTs) / ANIM_MS;
    const t   = raw >= 1 ? 1 : 1 - Math.pow(1 - raw, 2.5);
    const progress = Math.floor(t * (coords.length - 1));

    ctx.clearRect(0, 0, W, H);

    if (coords.length >= 2) drawPath(coords, 3, 0.20, 0, '80,80,100');

    const visible = coords.slice(0, progress + 1);
    if (visible.length >= 2) {
      // Rendu simplifié : un seul halo doux + une ligne nette (au lieu de
      // 4 couches superposées type "néon", jugé trop chargé/brouillon)
      drawPath(visible, 7, 0.16, 3);
      drawPath(visible, 3, 1.00, 0);
    }

    // Marqueur plat (anneau blanc + point de couleur), sans halo ni ombre
    function drawFlatMarker(x, y, color, radius) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, radius + 2, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }

    drawFlatMarker(coords[0].x, coords[0].y, '#16a34a', 5);

    const cur = visible.length > 0 ? visible[visible.length-1] : coords[0];
    const isEnd = raw >= 1;
    drawFlatMarker(cur.x, cur.y, '#f97316', isEnd ? 6 : 4.5);

    if (raw < 1) requestAnimationFrame(drawFrame);
  }

  requestAnimationFrame(drawFrame);
}



async function loadActivityAnalysis(activity) {

  const panel = el('activity-analysis-panel');
  const analysisCard = el('activity-analysis-card');
  const lapsEl = el('activity-laps-table');
  const analysisEl = el('activity-analysis-text');
  if (!panel || !activity?.id) return;
  panel.style.display = '';
  if (analysisCard) analysisCard.style.display = '';

  // Contexte pour la classification en zone (VMA du coureur + trail ou route)
  const isTrail = (activity.activityType || '').toLowerCase().includes('trail');
  const _zoneProfile = loadProfileData();
  const vma = calcVMA(_latestVO2Max, _zoneProfile.sex || 'M');

  // ─── Analyse basique (fallback sans laps) ────────────────────
  function buildBasicAnalysis(act) {
    const insights = [];
    if (act.avgPaceSecPerKm > 0) insights.push(`Allure moyenne : <strong>${formatPace(act.avgPaceSecPerKm)}</strong>`);
    if (act.avgHR)      insights.push(`FC moyenne : <strong>${Math.round(act.avgHR)} bpm</strong>`);
    if (act.maxHR)      insights.push(`FC max : <strong>${Math.round(act.maxHR)} bpm</strong>`);
    if (act.distanceKm) insights.push(`Distance : <strong>${act.distanceKm.toFixed(2)} km</strong>`);
    if (act.calories)   insights.push(`Calories : <strong>${Math.round(act.calories)} kcal</strong>`);
    return insights;
  }

  // ─── Détection Circuits vs Intervalles ────────────────────
  // Garmin Circuits = laps déclenchés par distance (tous ~1km)
  // Garmin Intervalles = laps manuels avec distances variées
  function isKmCircuits(laps) {
    if (laps.length < 3) return false;
    // Exclure le dernier lap (souvent très court = fin de parcours)
    const mainLaps = laps.slice(0, -1);
    const dists = mainLaps.map(l => l.distance || 0).filter(d => d > 50);
    if (dists.length < 2) return false;
    const sorted = [...dists].sort((a,b) => a-b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median < 400 || median > 3000) return false;
    // Circuits: AU MOINS 75% des laps dans ±35% de la médiane
    // (tolère les laps partiels : km de montagne, demi-km de fin etc.)
    const inRange = dists.filter(d => Math.abs(d - median) / median < 0.35).length;
    return inRange / dists.length >= 0.75;
  }

  // ─── Classification intelligente des laps (pour Intervalles) ────────────────────
  function classifyLaps(laps) {
    if (!laps || laps.length === 0) return [];

    // Pré-calcul vitesse médiane pour fallback
    const allSpeeds = laps.map(l => l.averageSpeed || 0).filter(s => s > 0);
    const sorted = [...allSpeeds].sort((a,b) => a-b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const n = laps.length;

    return laps.map((lap, idx) => {
      // Garmin retourne intensityType tantot en chaine simple ('ACTIVE', 'RECOVERY'...)
      // tantot en objet ({ typeKey: 'active' }) selon l'endpoint (laps/splits/details) -
      // on gere les deux formes, avec fallback sur le champ legacy 'intensity'
      const intensRaw = (typeof lap.intensityType === 'string' ? lap.intensityType : lap.intensityType?.typeKey) || lap.intensity || '';
      const intens = intensRaw.toLowerCase();
      const trigRaw = (typeof lap.lapTriggerType === 'string' ? lap.lapTriggerType : lap.lapTriggerType?.typeKey) || lap.lapTrigger || '';
      const trig   = trigRaw.toLowerCase();

      // 1. Champs Garmin explicites — le plus fiable, doit passer en PRIORITÉ
      if (intens === 'active')                                      return 'effort';
      if (intens === 'rest' || intens === 'recovery')               return 'rest';
      if (intens === 'cooldown')                                    return 'rest';   // cooldown = récup
      if (intens === 'warmup')                                      return 'warmup';

      // 2. Lap trigger hints
      if (trig.includes('recovery') || trig.includes('rest'))       return 'rest';
      if (trig.includes('warm'))                                    return 'warmup';

      // 3. Position : premier → échauffement seulement
      //    IMPORTANT : ne pas classifier le dernier en 'warmup' (c'est la récupération finale)
      if (n >= 4) {
        if (idx === 0)     return 'warmup';
        if (idx === n - 1) return 'rest';  // dernière étape = retour au calme, pas échauffement
      }

      // 4. Fallback vitesse : au-dessus de 90% de la vitesse MAX = effort
      //    (utiliser max plutôt que médiane pour mieux séparer effort/récup)
      const maxSpd = Math.max(...laps.map(l => l.averageSpeed || 0));
      const spd = lap.averageSpeed || 0;
      return spd >= maxSpd * 0.90 ? 'effort' : 'rest';
    });
  }

  // ─── Regroupement des efforts par duree similaire ────────────────────
  // Une seance peut enchainer plusieurs types de repetition a des allures
  // volontairement differentes (ex: 30s + 2min + 6min) : les traiter comme
  // un seul bloc fausse regularite/derive/split. On les separe par duree
  // (tolerance 20%, plancher 8s) et on classe chaque groupe dans sa zone.
  function describeDuration(sec) {
    if (sec < 60) return `${Math.round(sec)}s`;
    const min = sec / 60;
    return `${Number.isInteger(min) ? min : min.toFixed(1)}min`;
  }
  function groupEffortsByDuration(effortEntries) {
    const groups = [];
    effortEntries.forEach(({ lap, idx }) => {
      const dur = lap.elapsedDuration || lap.movingDuration || lap.duration || 0;
      let group = groups.find(g => Math.abs(dur - g.anchorDuration) <= Math.max(g.anchorDuration * 0.20, 8));
      if (!group) {
        group = { anchorDuration: dur, memberIdx: [], paces: [], hrValues: [] };
        groups.push(group);
      }
      group.memberIdx.push(idx);
      if (lap.averageSpeed > 0) group.paces.push(1000 / lap.averageSpeed);
      if (lap.averageHR) group.hrValues.push(Math.round(lap.averageHR));
    });
    groups.forEach(g => {
      g.repCount = g.memberIdx.length;
      g.avgPaceSecKm = g.paces.length ? g.paces.reduce((a, b) => a + b, 0) / g.paces.length : null;
      if (g.paces.length >= 2) {
        g.regularityMaxEcart = Math.round(Math.max(...g.paces) - Math.min(...g.paces));
        g.regularityLabel = g.regularityMaxEcart <= 5 ? 'excellente régularité'
          : g.regularityMaxEcart <= 12 ? 'bonne régularité'
          : g.regularityMaxEcart <= 25 ? 'quelques variations'
          : 'répétitions irrégulières';
        g.splitDiffSec = Math.round(g.paces[g.paces.length - 1] - g.paces[0]);
      } else {
        g.regularityMaxEcart = null; g.regularityLabel = null; g.splitDiffSec = null;
      }
      g.hrDriftBpm = g.hrValues.length >= 2 ? (g.hrValues[g.hrValues.length - 1] - g.hrValues[0]) : null;
      g.zoneKey = (vma && g.avgPaceSecKm) ? matchZoneFromPaceTrailAware(g.avgPaceSecKm, vma, isTrail) : null;
      g.zoneLabel = (g.zoneKey && typeof ALLURE_PLUS_ZONES !== 'undefined') ? ALLURE_PLUS_ZONES[g.zoneKey]?.label : null;
      g.zoneColor = (g.zoneKey && typeof ALLURE_PLUS_ZONES !== 'undefined') ? ALLURE_PLUS_ZONES[g.zoneKey]?.color : null;
    });
    return groups;
  }

  try {
    const result = await fetchJSON(`/api/activity/${activity.id}/laps`);
    const validLaps = Array.isArray(result?.laps) ? result.laps : [];

    if (validLaps.length > 0) {
      const circuits = isKmCircuits(validLaps);

      if (circuits) {
        // ─── Mode CIRCUITS (footing) : laps kilométriques ───────────────
        lapsEl.innerHTML = `
          <table class="laps-table">
            <thead><tr>
              <th>Km</th><th>Durée</th><th>Allure</th><th>FC</th>
            </tr></thead>
            <tbody>${validLaps.map((lap, i) => {
              const dur  = Math.round(lap.elapsedDuration || lap.movingDuration || lap.duration || 0);
              const pace = (lap.averageSpeed && lap.averageSpeed > 0) ? formatPace(1000/lap.averageSpeed) : '—';
              const hr   = lap.averageHR ? Math.round(lap.averageHR)+' bpm' : '—';
              const isLast = i === validLaps.length - 1;
              const distLabel = isLast && lap.distance < 800
                ? (lap.distance ? (lap.distance/1000).toFixed(2)+' km' : '—')
                : `${i+1} km`;
              return `<tr class="lap-row">
                <td>${distLabel}</td>
                <td>${formatDuration(dur)}</td>
                <td class="pace-value">${pace}</td>
                <td class="hr-value">${hr}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;

        // Analyse circuits : split, dérive FC, régularité
        const insights = [];
        const kmLaps = validLaps.filter(l => l.averageSpeed > 0);
        if (kmLaps.length >= 2) {
          // Exclure les fragments de fin de parcours (ex: dernier "km" de quelques
          // metres a peine) : compte comme un km complet, un tel fragment fausse
          // moyenne/regularite/split (allure erratique sur une distance minime)
          const dists = kmLaps.map(l => l.distance || 0).filter(d => d > 0);
          const medianDist = dists.length ? [...dists].sort((a,b) => a-b)[Math.floor(dists.length / 2)] : 0;
          const repLaps = medianDist > 0 ? kmLaps.filter(l => (l.distance || 0) >= medianDist * 0.5) : kmLaps;

          const rawPaces = repLaps.map(l => 1000 / l.averageSpeed);
          const minP = Math.round(Math.min(...rawPaces)), maxP = Math.round(Math.max(...rawPaces));
          insights.push(`Allures : de <strong>${formatPace(minP)}</strong> à <strong>${formatPace(maxP)}</strong>`);

          // Allure moyenne globale : utiliser la valeur de l'activite (duree totale /
          // distance totale, deja correcte) plutot qu'une moyenne arithmetique des
          // paces par lap, qui donnerait le meme poids a un fragment de quelques
          // metres qu'a un km complet et fausserait le resultat
          if (vma && activity.avgPaceSecPerKm) {
            const zoneKey = matchZoneFromPaceTrailAware(activity.avgPaceSecPerKm, vma, isTrail);
            const zoneLabel = (zoneKey && typeof ALLURE_PLUS_ZONES !== 'undefined') ? ALLURE_PLUS_ZONES[zoneKey]?.label : null;
            if (zoneLabel) insights.push(`Allure moyenne : <strong>${formatPace(Math.round(activity.avgPaceSecPerKm))}</strong> — zone <strong>${zoneLabel}</strong>`);
          }

          // Terrain vallonne : Garmin fournit une allure ajustee au denivele (avgGradeAdjustedSpeed)
          // par intervalle - on l'utilise pour juger la regularite si le terrain le justifie,
          // plutot que l'allure brute qui varie naturellement avec les montees/descentes.
          const totalElevGain = repLaps.reduce((s,l) => s + (l.elevationGain || 0), 0);
          const elevPerKm = totalElevGain / repLaps.length;
          const hasGAP = repLaps.every(l => l.avgGradeAdjustedSpeed > 0);
          const terrainVallonne = hasGAP && (isTrail || elevPerKm > 10);
          const evalPaces = terrainVallonne ? repLaps.map(l => 1000 / l.avgGradeAdjustedSpeed) : rawPaces;

          const diff = Math.round(evalPaces[evalPaces.length-1] - evalPaces[0]);
          if (Math.abs(diff) > 8) {
            if (terrainVallonne) {
              insights.push(`Allure ${diff > 0 ? 'plus lente' : 'plus rapide'} en fin de sortie une fois ajustée au dénivelé (${diff > 0 ? '+' : ''}${diff}"/km) — terrain vallonné (D+ total : <strong>${Math.round(totalElevGain)} m</strong>), pas forcément un signe de fatigue.`);
            } else {
              insights.push(diff < 0
                ? `Negative split : tu as accéléré sur la fin `
                : `Positive split : tu as ralenti au fil des km`);
            }
          } else {
            insights.push(terrainVallonne
              ? `Allure régulière une fois ajustée au dénivelé (D+ total : <strong>${Math.round(totalElevGain)} m</strong>)`
              : `Allure très régulière tout au long de la sortie `);
          }
          const hrLaps = repLaps.filter(l => l.averageHR);
          if (hrLaps.length >= 2) {
            const hrFirst = Math.round(hrLaps[0].averageHR);
            const hrLast  = Math.round(hrLaps[hrLaps.length-1].averageHR);
            const drift = hrLast - hrFirst;
            insights.push(Math.abs(drift) <= 5
              ? `FC stable sur la sortie`
              : `Dérive cardiaque de <strong>${drift > 0 ? '+' : ''}${drift} bpm</strong> du 1er au dernier km`);
          }
        }
        analysisEl.innerHTML = insights.map(i=>`<div class="analysis-item">${i}</div>`).join('')
          || '<p class="no-data">Pas de données</p>';

      } else {
        // ─── Mode INTERVALLES (séance qualité) ──────────────────────────
        const types = classifyLaps(validLaps);
        const effortEntries = validLaps.reduce((acc, lap, idx) => {
          if (types[idx] === 'effort') acc.push({ lap, idx });
          return acc;
        }, []);
        const restLaps   = validLaps.filter((_, i) => types[i] === 'rest');
        const warmupLaps = validLaps.filter((_, i) => types[i] === 'warmup');
        const groups = groupEffortsByDuration(effortEntries);
        const zoneByIdx = {};
        groups.forEach(g => g.memberIdx.forEach(i => { zoneByIdx[i] = { label: g.zoneKey, color: g.zoneColor }; }));

        lapsEl.innerHTML = `
          <table class="laps-table">
            <thead><tr>
              <th>#</th><th>Type</th><th>Durée</th><th>Dist.</th><th>Allure</th><th>FC</th>
            </tr></thead>
            <tbody>${validLaps.map((lap, i) => {
              const type = types[i];
              const isRest   = type === 'rest';
              const isWarmup = type === 'warmup';
              const dur  = Math.round(lap.elapsedDuration || lap.movingDuration || lap.duration || 0);
              const dist = lap.distance ? (lap.distance/1000).toFixed(2)+' km' : '—';
              const pace = (lap.averageSpeed && lap.averageSpeed > 0) ? formatPace(1000/lap.averageSpeed) : '—';
              const hr   = lap.averageHR ? Math.round(lap.averageHR)+' bpm' : '—';
              const z = zoneByIdx[i];
              const label = isRest ? 'Récupération' : isWarmup ? 'Échauffement'
                : (z && z.label) ? `Effort — ${z.label}` : 'Effort';
              const cls   = isRest ? 'lap-rest' : isWarmup ? 'lap-warmup' : 'lap-effort';
              const typeCell = (!isRest && !isWarmup && z && z.color)
                ? `<span style="background:${z.color}20;color:${z.color};border:1px solid ${z.color}40;padding:2px 6px;border-radius:4px;font-size:11px;white-space:nowrap">${label}</span>`
                : label;
              return `<tr class="lap-row ${cls}">
                <td>${i+1}</td><td>${typeCell}</td>
                <td>${formatDuration(dur)}</td><td>${dist}</td>
                <td class="pace-value">${pace}</td><td class="hr-value">${hr}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;

        const insights = [];

        if (effortEntries.length > 0) {
          groups.forEach((g, gi) => {
            const paceStrs = g.paces.map(p => `<strong>${formatPace(Math.round(p))}</strong>`);
            let line = `Groupe ${gi+1} — ${g.repCount}× ~${describeDuration(g.anchorDuration)} : ${paceStrs.join(' → ')}`;
            if (g.zoneLabel) line += ` — zone <strong>${g.zoneLabel}</strong>`;
            if (g.repCount >= 2 && g.regularityLabel) {
              line += ` — ${g.regularityLabel} (écart max ${g.regularityMaxEcart}"/km)`;
            }
            if (g.hrDriftBpm !== null && Math.abs(g.hrDriftBpm) > 5) {
              line += `, FC ${g.hrDriftBpm > 0 ? '+' : ''}${g.hrDriftBpm} bpm`;
            }
            insights.push(line);
          });

          const allEffortHR = effortEntries.map(e => e.lap.averageHR).filter(Boolean);
          if (allEffortHR.length > 0) {
            const avgHRAllEfforts = Math.round(allEffortHR.reduce((a,b) => a+b, 0) / allEffortHR.length);
            insights.push(`FC moyenne (tous les efforts) : <strong>${avgHRAllEfforts} bpm</strong>`);
          }

          insights.push(`Structure : <strong>${effortEntries.length}</strong> effort(s) en <strong>${groups.length}</strong> groupe(s) · <strong>${restLaps.length}</strong> récup. · <strong>${warmupLaps.length}</strong> échauff./retour`);

          const avgSpd = effortEntries.reduce((s,e) => s+(e.lap.averageSpeed||0),0)/effortEntries.length;
          if (avgSpd > 0) {
            const p = 1000/avgSpd;
            const enc = p < 270 ? 'Allure de pointe — séance de qualité !' : p < 300 ? 'Bonne vitesse sur les efforts.' : p < 330 ? 'Séance dans les clous.' : 'Séance gérée à allure confortable.';
            insights.push(`<em>${enc}</em>`);
          }
        } else {
          buildBasicAnalysis(activity).forEach(b => insights.push(b));
        }
        analysisEl.innerHTML = insights.map(i=>`<div class="analysis-item">${i}</div>`).join('')
          || '<p class="no-data">Séance sans structure détectée</p>';
      }

    } else {
      lapsEl.innerHTML = '<p class="no-data" style="font-size:11px">Intervalles non disponibles — redémarrez start.bat pour activer</p>';
      const basics = buildBasicAnalysis(activity);
      analysisEl.innerHTML = basics.map(i=>`<div class="analysis-item">${i}</div>`).join('') || '<p class="no-data">Aucune donnée disponible</p>';
    }

  } catch(e) {
    lapsEl.innerHTML = '<p class="no-data">Chargement impossible</p>';
    const basics = buildBasicAnalysis(activity);
    analysisEl.innerHTML = basics.map(i=>`<div class="analysis-item">${i}</div>`).join('') || '<p class="no-data">Erreur</p>';
    console.error('Analysis error:', e);
  }
}





// ─── Records page : voir frontend/js/records.js (initRecordsPage) ──

// ═══════════════════════════════════════════════
// CHARTS OPTIONS
// ═══════════════════════════════════════════════

function chartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#111', borderColor: 'rgba(0,0,0,0.08)',
        borderWidth: 1, titleColor: '#fff', bodyColor: '#ADADAD',
        padding: 10, cornerRadius: 8, displayColors: false
      }
    },
    scales: {
      x: {
        grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
        ticks: { color: '#ADADAD', font: { size: 11, family: 'Inter' }, maxRotation: 0, maxTicksLimit: 8 },
        border: { display: false }
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false },
        ticks: { color: '#ADADAD', font: { size: 11, family: 'Inter' } },
        border: { display: false }
      }
    }
  };
}

// ─── VO2max chart ──────────────────────────────
let vo2Chart = null;
function renderVO2MaxChart(series) {
  const canvas = el('vo2max-chart');
  const empty  = el('vo2max-empty');
  if (!series || series.length === 0) {
    if (empty) empty.style.display = 'block';
    if (canvas) canvas.style.display = 'none';
    return;
  }

  const byMonth = {};
  series.forEach(p => { const m = p.date?.slice(0,7); if (m) byMonth[m] = p.value; });
  const labels = Object.keys(byMonth).sort();
  const values = labels.map(m => byMonth[m]);

  if (vo2Chart) vo2Chart.destroy();
  vo2Chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{
      label: 'VO₂max', data: values,
      borderColor: '#7C3AED', backgroundColor: 'rgba(124,58,237,0.07)',
      borderWidth: 2, pointBackgroundColor: '#7C3AED',
      pointRadius: 4, pointHoverRadius: 6,
      tension: 0.4, fill: true, spanGaps: true
    }]},
    options: chartOptions()
  });
}


// ─── Page Santé ────────────────────────────────
let healthChartsRendered = false;
function renderHealthPage() {
  if (healthChartsRendered) return;
  healthChartsRendered = true;

  // VO2max sur santé (même données que dashboard)
  const vo2canvas = el('vo2max-chart-health');
  if (vo2canvas && _vo2maxSeries.length > 0) {
    const byMonth = {};
    _vo2maxSeries.forEach(p => { const m = p.date?.slice(0,7); if (m) byMonth[m] = p.value; });
    const labels = Object.keys(byMonth).sort();
    new Chart(vo2canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label:'VO₂max', data: labels.map(m => byMonth[m]),
        borderColor:'#7C3AED', backgroundColor:'rgba(124,58,237,0.07)',
        borderWidth:2, pointRadius:4, tension:0.4, fill:true }]},
      options: chartOptions()
    });
  }

  // FC repos sur santé
  loadHeartRateInto('hr-chart-health');

  // Sommeil sur santé
  loadSleepInto('sleep-chart-health');
}

let _vo2maxSeries = [];

// ─── Heart Rate ────────────────────────────────
async function loadHeartRate() { await loadHeartRateInto('hr-chart'); }

async function loadHeartRateInto(canvasId) {
  try {
    const res = await fetch(`${API}/api/heartrate`);
    const { data } = await res.json();
    const canvas = el(canvasId);
    if (!canvas) return;
    // La structure Garmin est [{date, data:{calendarDate, restingHeartRate,...}}]
    // TASK 3 — Sort ascending by date so newest is on the RIGHT of the chart
    const points = (data || [])
      .filter(d => d.data?.restingHeartRate > 0)
      .slice(-30)
      .sort((a, b) => {
        const da = a.data?.calendarDate || a.date || '';
        const db = b.data?.calendarDate || b.date || '';
        return da < db ? -1 : da > db ? 1 : 0;
      });
    // Stocker FC repos moyenne pour la page Profil (méthode Karvonen)
    if (points.length > 0) {
      _avgRestingHR = points.reduce((sum, d) => sum + d.data.restingHeartRate, 0) / points.length;
    }
    if (points.length === 0) {
      const emp = el('hr-empty');
      if (emp) emp.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
      return;
    }
    const existingHr = Chart.getChart(canvas);
    if (existingHr) existingHr.destroy();
    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: points.map(d => d.data.calendarDate?.slice(5)),
        datasets: [{ label:'FC repos', data: points.map(d => d.data.restingHeartRate),
          borderColor:'#EF4444', backgroundColor:'rgba(239,68,68,0.07)',
          borderWidth:2, pointRadius:3, tension:0.4, fill:true }]
      },
      options: chartOptions()
    });
  } catch(e) { console.error('FC:', e); }
}

// ─── Sleep (générique) ─────────────────────────
async function loadSleep() { await loadSleepInto('sleep-chart-health'); }

async function loadSleepInto(canvasId) {
  try {
    const res = await fetch(`${API}/api/sleep`);
    const { data } = await res.json();
    if (!data || data.length === 0) return;
    const canvas = el(canvasId);
    if (!canvas) return;
    // Format : [{calendarDate, sleepTimeSeconds, deepSleepSeconds, ...}]
    const points = data.filter(d => d.sleepTimeSeconds > 0).slice(-14);
    if (points.length === 0) return;
    const labels = points.map(d => (d.calendarDate || d.date)?.slice(5));
    const values = points.map(d => Math.round(d.sleepTimeSeconds / 3600 * 10) / 10);

    const existingSleep = Chart.getChart(canvas);
    if (existingSleep) existingSleep.destroy();
    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{
        label: 'Sommeil (h)', data: values,
        backgroundColor: 'rgba(124,58,237,0.15)', borderColor: '#7C3AED',
        borderWidth: 1.5, borderRadius: 4
      }]},
      options: { ...chartOptions(), plugins: { ...chartOptions().plugins } }
    });
  } catch(e) { console.error('Sleep:', e); }
}

// ─── Bien-être (Synthèse) : FC, Body Battery, Pas, Sommeil, Statut ─────
const SLEEP_QUALIFIER_FR = { POOR: 'Mauvais', FAIR: 'Passable', GOOD: 'Bon', EXCELLENT: 'Excellent' };

// Couleurs approchées de celles utilisées par Garmin Connect pour chaque
// statut d'entrainement (non documentées officiellement, calées au plus
// pres de la capture d'ecran fournie pour STRAINED).
const TRAINING_STATUS_MAP = {
  0: { label: 'Aucun statut',    color: '#9CA3AF' },
  1: { label: 'Décrochage',      color: '#60A5FA' },
  2: { label: 'Récupération',    color: '#3B82F6' },
  3: { label: 'Maintien',        color: '#22C55E' },
  4: { label: 'Productif',       color: '#16A34A' },
  5: { label: 'Pic de forme',    color: '#06B6D4' },
  6: { label: 'Surcharge',       color: '#F59E0B' },
  7: { label: 'Improductif',     color: '#EF4444' },
  8: { label: 'Sous tension',    color: '#DB2777' },
};

async function loadWellnessRow() {
  const set = (id, val) => { const e = el(id); if (e) e.textContent = val; };
  try {
    const [hrJson, stepsJson, sleepJson, bbJson, tsJson] = await Promise.all([
      fetch(`${API}/api/heartrate?days=7`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${API}/api/steps?days=1`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${API}/api/sleep?days=3`).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${API}/api/body-battery`).then(r => r.json()).catch(() => ({ data: null })),
      fetch(`${API}/api/training-status`).then(r => r.json()).catch(() => ({ data: null })),
    ]);

    const hrPoints = (hrJson.data || []).filter(d => d.data?.restingHeartRate > 0);
    if (hrPoints.length > 0) {
      const avg = Math.round(hrPoints.reduce((s, d) => s + d.data.restingHeartRate, 0) / hrPoints.length);
      set('wellness-hr-value', hrPoints[hrPoints.length - 1].data.restingHeartRate);
      set('wellness-hr-sub', `Moy. 7j : ${avg} bpm`);
    }

    const stepsPoints = (stepsJson.data || []).filter(d => typeof d.steps === 'number');
    if (stepsPoints.length > 0) {
      set('wellness-steps-value', stepsPoints[0].steps.toLocaleString('fr-FR'));
    }

    const sleepPoints = (sleepJson.data || []).filter(d => d.sleepScore);
    if (sleepPoints.length > 0) {
      const last = sleepPoints[sleepPoints.length - 1];
      const h = Math.floor(last.sleepTimeSeconds / 3600);
      const m = Math.round((last.sleepTimeSeconds % 3600) / 60);
      set('wellness-sleep-value', last.sleepScore);
      set('wellness-sleep-sub', `${SLEEP_QUALIFIER_FR[last.sleepScoreQualifier] || ''} · ${h}h${String(m).padStart(2, '0')}`);
    }

    if (bbJson.data) {
      set('wellness-bb-value', bbJson.data.current);
      set('wellness-bb-sub', `+${bbJson.data.charged} chargée · ${bbJson.data.drained} dépensée`);
    } else {
      const card = el('wellness-bb-card');
      if (card) card.style.display = 'none';
    }

    if (tsJson.data) {
      const info = TRAINING_STATUS_MAP[tsJson.data.trainingStatus] || { label: tsJson.data.phrase || '—', color: '#9CA3AF' };
      set('wellness-ts-value', info.label);
      const valEl = el('wellness-ts-value');
      if (valEl) valEl.style.color = info.color;
      const iconEl = el('wellness-ts-icon');
      if (iconEl) {
        iconEl.style.background = info.color;
        iconEl.style.borderRadius = '50%';
        iconEl.style.display = 'inline-flex';
        iconEl.style.alignItems = 'center';
        iconEl.style.justifyContent = 'center';
        iconEl.style.width = '26px';
        iconEl.style.height = '26px';
      }
      set('wellness-ts-sub', tsJson.data.sinceDate ? `Depuis le ${formatDateShort(tsJson.data.sinceDate)}` : '');
    }
  } catch (e) { console.error('Bien-être:', e); }
}

// ─── Sports donut ──────────────────────────────
let sportsChart = null;
function renderSportsChart(breakdown) {
  const canvas = el('sports-chart');
  const legend = el('sports-legend');
  if (!canvas) return;

  const LABELS_FR = {
    running: 'Course', trail_running: 'Trail', cycling: 'Vélo',
    swimming: 'Natation', walking: 'Marche', hiking: 'Randonnée',
    strength_training: 'Musculation', indoor_cardio: 'Cardio indoor',
    treadmill_running: 'Tapis', mountain_biking: 'VTT',
    open_water_swimming: 'Natation eau libre', yoga: 'Yoga',
    other: 'Autre'
  };

  const entries = Object.entries(breakdown)
    .filter(([,v]) => v.count > 0)
    .sort((a,b) => b[1].count - a[1].count);

  if (entries.length === 0) return;

  const COLORS = ['#2563EB','#7C3AED','#16A34A','#D97706','#DC2626','#0891B2','#DB2777'];
  const labels = entries.map(([k]) => LABELS_FR[k] || k.replace(/_/g,' '));
  const values = entries.map(([,v]) => v.count);

  if (sportsChart) sportsChart.destroy();
  sportsChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: COLORS, borderWidth: 0, hoverOffset: 4 }]},
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor:'#111', titleColor:'#fff', bodyColor:'#ADADAD', padding:8, cornerRadius:8, displayColors:true }
      }
    }
  });

  if (legend) {
    legend.innerHTML = entries.map(([, val], i) =>
      `<div class="legend-item">
        <div class="legend-dot" style="background:${COLORS[i]}"></div>
        <span>${labels[i]} ${val.count}</span>
      </div>`
    ).join('');
  }
}

// ─── Heatmap ───────────────────────────────────
function renderHeatmap(heatmap) {
  const wrapper = el('heatmap-wrapper');
  if (!wrapper) return;

  // Normaliser : clés datetime → date seule, valeurs num → {count: n}
  const normalized = {};
  Object.entries(heatmap || {}).forEach(([key, val]) => {
    const dateKey = key.slice(0, 10);
    if (!normalized[dateKey]) normalized[dateKey] = { count: 0 };
    normalized[dateKey].count += (typeof val === 'number' ? val : (val?.count || 1));
  });

  const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Aoû','Sep','Oct','Nov','Déc'];
  const CELL = 12;  // px taille cellule
  const GAP  = 3;   // px entre cellules

  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  // Commencer au dimanche précédant yearAgo
  const startDate = new Date(yearAgo);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  // Construire les semaines + relever les changements de mois
  const weeks = [];
  const monthChanges = [];   // [{ weekIdx, label }]
  let lastMonth = -1;
  const cursor = new Date(startDate);

  while (cursor <= now) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
      const dayData = normalized[dateStr];
      const count   = dayData?.count || 0;
      const level   = count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 3 ? 3 : 4;
      const inRange = cursor >= yearAgo && cursor <= now;
      // Relever changement de mois sur le 1er jour de la semaine
      if (d === 0 && inRange) {
        const m = cursor.getMonth();
        if (m !== lastMonth) { monthChanges.push({ weekIdx: weeks.length, label: MONTHS_FR[m] }); lastMonth = m; }
      }
      week.push({ dateStr, level: inRange ? level : -1, count,
        title: inRange ? `${dateStr} — ${count === 0 ? 'Repos' : count + ' activité' + (count > 1 ? 's' : '')}` : '' });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  // ── Ligne des mois (positionnement absolu par rapport à la grille) ──
  const DAY_COL_W = 18;  // largeur colonne jours
  const WEEK_W    = CELL + GAP;  // largeur d'une colonne semaine

  // Construire les colonnes de la grille
  let cols = '';
  weeks.forEach(week => {
    cols += `<div class="heatmap-col">`;
    week.forEach(day => {
      if (day.level === -1) {
        cols += `<div class="heatmap-cell heatmap-cell--empty"></div>`;
      } else {
        // data-date permet le tooltip au hover
        cols += `<div class="heatmap-cell" data-level="${day.level}" data-date="${day.dateStr}" data-count="${day.count}" title=""></div>`;
      }
    });
    cols += `</div>`;
  });

  // Construire les étiquettes de mois
  let monthLabelsHTML = '';
  monthChanges.forEach(({ weekIdx: wIdx, label }) => {
    const leftPx = DAY_COL_W + 6 + wIdx * WEEK_W;
    monthLabelsHTML += `<span class="heatmap-month-lbl" style="left:${leftPx}px">${label}</span>`;
  });

  // Étiquettes des jours (D L M M J V S) — on affiche L M J S
  const dayNames = ['D','L','M','M','J','V','S'];
  let dayLabelsHTML = dayNames.map((d, i) =>
    `<span class="heatmap-day-lbl${[1,3,5].includes(i) ? '' : ' heatmap-day-lbl--hidden'}">${d}</span>`
  ).join('');

  wrapper.innerHTML = `
    <div class="heatmap-month-row" style="position:relative;height:16px;margin-bottom:2px;">
      ${monthLabelsHTML}
    </div>
    <div class="heatmap-body-row">
      <div class="heatmap-day-col">${dayLabelsHTML}</div>
      <div class="heatmap-grid">${cols}</div>
    </div>
  `;

  // ── Tooltip interactif au survol ─────────────────────────────────────
  initHeatmapTooltip(wrapper);
}

/** Tooltip heatmap : affiche les activités du jour au survol */
function initHeatmapTooltip(wrapper) {
  // Créer le tooltip DOM (singleton)
  let tip = document.getElementById('heatmap-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'heatmap-tooltip';
    tip.className = 'heatmap-tip';
    document.body.appendChild(tip);
  }

  const SPORT_ICON = {
    trail: '🏔️', cardio: '💪', hiit: '🔥', swimming: '🏊',
    default: '🏅',
  };

  function getSportEmoji(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('trail'))    return SPORT_ICON.trail;
    if (t.includes('run'))      return personEmoji('running');
    if (t.includes('cycl') || t.includes('bike')) return personEmoji('cycling');
    if (t.includes('walk'))     return personEmoji('walking');
    if (t.includes('strength') || t.includes('muscul')) return personEmoji('strength');
    if (t.includes('hiit'))     return SPORT_ICON.hiit;
    if (t.includes('cardio') || t.includes('fitness') || t.includes('indoor')) return SPORT_ICON.cardio;
    if (t.includes('swim'))     return SPORT_ICON.swimming;
    return SPORT_ICON.default;
  }

  function fmtDur(secs) {
    if (!secs) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m} min`;
  }

  function fmtDateFr(dateStr) {
    const [y, mo, d] = dateStr.split('-');
    const MOIS = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];
    return `${parseInt(d)} ${MOIS[parseInt(mo)-1]} ${y}`;
  }

  wrapper.addEventListener('mousemove', e => {
    const cell = e.target.closest('.heatmap-cell[data-date]');
    if (!cell) { tip.style.display = 'none'; return; }

    const dateStr = cell.dataset.date;
    const count   = parseInt(cell.dataset.count || '0');

    // Trouver les activités de ce jour
    const dayActs = (_allActivities || []).filter(a => {
      const d = (a.date || a.startTimeLocal || a.startTimeGMT || '').slice(0, 10);
      return d === dateStr;
    });

    // Construire le contenu
    let html = `<div class="heatmap-tip-date">${fmtDateFr(dateStr)}</div>`;
    if (count === 0 || dayActs.length === 0) {
      html += `<div class="heatmap-tip-rest">Repos</div>`;
    } else {
      dayActs.forEach(a => {
        const icon = getSportEmoji(a.activityType);
        const dist = a.distanceKm ? `${a.distanceKm.toFixed(1)} km` : '—';
        const dur  = fmtDur(a.durationSec);
        const name = (a.name || a.activityType || '').split(' ').slice(0,3).join(' ');
        html += `
          <div class="heatmap-tip-row">
            <span class="heatmap-tip-icon">${icon}</span>
            <div class="heatmap-tip-info">
              <span class="heatmap-tip-name">${name}</span>
              <span class="heatmap-tip-meta">${dur}${dist !== '—' ? ' · ' + dist : ''}</span>
            </div>
          </div>`;
      });
    }
    tip.innerHTML = html;
    tip.style.display = 'block';

    // Positionner le tooltip près du curseur
    const margin = 12;
    let x = e.clientX + margin;
    let y = e.clientY + margin;
    // Éviter de dépasser le bord droit
    if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - margin;
    // Éviter de dépasser le bord bas
    if (y + tip.offsetHeight > window.innerHeight - 8) y = e.clientY - tip.offsetHeight - margin;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  });

  wrapper.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
}



// ═══════════════════════════════════════════════
// REFRESH
// ═══════════════════════════════════════════════

async function refreshAll() {
  const btn = el('refresh-btn');
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  try {
    await fetch(`${API}/api/refresh`, { method: 'POST' });
    await Promise.all([loadDashboard(), loadHeartRate(), loadSleep(), loadWellnessRow()]);
    // Recharger les donnees admin si on est sur la page admin
    if (document.getElementById('page-admin')?.classList.contains('active')) {
      await Promise.all([loadAdminInfo(), loadAdminLogs()]);
    }
  } finally {
    if (btn) { btn.classList.remove('spinning'); btn.disabled = false; }
  }
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// MODULE PROFIL
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

const PROFILE_KEY = 'suivi_sport_profile';

function loadProfileData() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; }
  catch { return {}; }
}
function saveProfileData(data) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
}

// \u2500\u2500\u2500 Calculs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// VMA depuis VO2max (formule ACSM, plus pr\u00e9cise que /3.5)
// VO2 running = 0.2*v(m/min) + 3.5 => VMA(m/min) = (VO2max-3.5)/0.2 => km/h = *60/1000
// Correction femme +5% (\u00e9conomie de course)
function calcVMA(vo2max, sex) {
  if (!vo2max || vo2max <= 0) return null;
  const factor = sex === 'F' ? 0.315 : 0.313;
  return Math.round((vo2max - 3.5) * factor * 10) / 10;
}

// Classe une allure (sec/km) dans une zone ALLURE_PLUS (matchZoneFromPace, campus.js)
// en tenant compte du surcout trail : on "deshabille" l'allure de la correction
// avant classification, sinon un effort trail est vu comme plus rapide/exigeant
// qu'il ne l'est reellement (2 passes : approx a 7%, puis affinee avec le vrai
// trailCorr de la zone trouvee, qui peut differer : AS10=8%, VMA=10%)
function matchZoneFromPaceTrailAware(paceSecKm, vma, isTrail) {
  if (!paceSecKm || !vma) return null;
  if (typeof matchZoneFromPace !== 'function') return null;
  if (!isTrail) return matchZoneFromPace(paceSecKm, vma);
  const approxZone = matchZoneFromPace(paceSecKm / 1.07, vma);
  const corr = approxZone && ALLURE_PLUS_ZONES[approxZone]?.trailCorr;
  if (!corr) return approxZone;
  return matchZoneFromPace(paceSecKm / (1 + corr), vma) || approxZone;
}

// FC max : formule Tanaka (2001), plus précise pour adultes sportifs
// FCmax = 208 − 0.7 × âge — mais on préfère la valeur réelle mesurée si dispo
function calcHRMax(age, hrmaxMeasured) {
  if (hrmaxMeasured && hrmaxMeasured > 100) return hrmaxMeasured;  // valeur réelle prioritaire
  if (!age) return null;
  return Math.round(208 - 0.7 * age);
}

// Zones Karvonen : FC réserve = FCmax − FC repos
// FCzone = FCmin + %*(FCmax − FCmin) ... puis + FC repos
function calcHRZones(hrMax, hrRest) {
  const zones = [
    { name:'Z1 — Récupération',       pLow:0.50, pHigh:0.60, color:'#60a5fa', desc:'Effort très léger, récup actif' },
    { name:'Z2 — Endurance fond.',   pLow:0.60, pHigh:0.70, color:'#4ade80', desc:'Allure lente, base aérobie' },
    { name:'Z3 — Tempo / Marathon',  pLow:0.70, pHigh:0.80, color:'#facc15', desc:'Allure marathon, conforté' },
    { name:'Z4 — Seuil lactique',    pLow:0.80, pHigh:0.90, color:'#fb923c', desc:'Semi, 10km, intense' },
    { name:'Z5 — VO₂max / Fracs',  pLow:0.90, pHigh:1.00, color:'#f87171', desc:'Intervalles courts, max' },
  ];
  const useKarvonen = hrRest && hrRest > 0;
  const reserve = useKarvonen ? (hrMax - hrRest) : hrMax;
  const base    = useKarvonen ? hrRest : 0;
  return zones.map(z => ({
    ...z,
    low:  Math.round(base + z.pLow  * reserve),
    high: Math.round(base + z.pHigh * reserve),
  }));
}

// IMC et catégories
function calcBMI(weight, height) {
  if (!weight || !height) return null;
  return Math.round(weight / Math.pow(height / 100, 2) * 10) / 10;
}
function bmiCategory(bmi) {
  if (bmi < 18.5) return { label:'Insuffisance pondérale', cls:'underweight' };
  if (bmi < 25)   return { label:'Corpulence normale',        cls:'normal' };
  if (bmi < 30)   return { label:'Surpoids',                  cls:'overweight' };
  return              { label:'Obésité',                 cls:'obese' };
}

// Poids idéal sportif : fourchette IMC 22–23 (H) / 20–22 (F)
// Basé sur les études sur coureurs endurance (marathon runners BMI ~21–23)
function calcIdealWeight(height, sex) {
  if (!height) return null;
  const h = height / 100;
  const bmiLow  = sex === 'F' ? 20.0 : 22.0;
  const bmiHigh = sex === 'F' ? 22.0 : 23.0;
  return {
    min: Math.round(bmiLow  * h * h * 10) / 10,
    max: Math.round(bmiHigh * h * h * 10) / 10,
    bmiRange: `${bmiLow}–${bmiHigh}`
  };
}

// Barème officiel VO2max par age et sexe (Garmin / Cooper Institute)
// Source : manuels Garmin (ex. Forerunner 265), tableau reproduit avec
// l'autorisation du Cooper Institute. 5 categories, 4 seuils par tranche d'age.
const VO2MAX_AGE_BANDS = [29, 39, 49, 59, 69, 999]; // borne haute de chaque tranche
const VO2MAX_BOUNDS = {
  M: [
    [41.7, 45.4, 51.1, 55.4], // 20-29
    [40.5, 44.0, 48.3, 54.0], // 30-39
    [38.5, 42.4, 46.4, 52.5], // 40-49
    [35.6, 39.2, 43.4, 48.9], // 50-59
    [32.3, 35.5, 39.5, 45.7], // 60-69
    [29.4, 32.3, 36.7, 42.1], // 70-79
  ],
  F: [
    [36.1, 39.5, 43.9, 49.6], // 20-29
    [34.4, 37.8, 42.4, 47.4], // 30-39
    [33.0, 36.3, 39.7, 45.3], // 40-49
    [30.1, 33.0, 36.7, 41.1], // 50-59
    [27.5, 30.0, 33.0, 37.8], // 60-69
    [25.9, 28.1, 30.9, 36.7], // 70-79
  ],
};
const VO2MAX_CAT_NAMES  = ['Faible', 'Passable', 'Bon', 'Excellent', 'Supérieur'];
const VO2MAX_CAT_COLORS = ['#e53935', '#f57c00', '#43a047', '#1976d2', '#6a1b9a'];

function vo2maxBounds(sex, age) {
  const table = (sex === 'F') ? VO2MAX_BOUNDS.F : VO2MAX_BOUNDS.M;
  const idx = VO2MAX_AGE_BANDS.findIndex(max => (age || 40) <= max);
  return table[idx === -1 ? table.length - 1 : idx];
}
function vo2maxCategoryIndex(vo2, sex, age) {
  const b = vo2maxBounds(sex, age);
  if (vo2 >= b[3]) return 4;
  if (vo2 >= b[2]) return 3;
  if (vo2 >= b[1]) return 2;
  if (vo2 >= b[0]) return 1;
  return 0;
}
function vo2maxGarminColor(vo2, sex, age) {
  if (!vo2) return '#888';
  return VO2MAX_CAT_COLORS[vo2maxCategoryIndex(vo2, sex, age)];
}
function vo2maxLabel(vo2, sex, age) {
  if (!vo2) return '';
  return VO2MAX_CAT_NAMES[vo2maxCategoryIndex(vo2, sex, age)];
}

// Barre horizontale 5 couleurs (bareme Garmin) + curseur a la position exacte
function renderVo2Bar(vo2, sex, age) {
  if (!vo2) return '';
  const b = vo2maxBounds(sex, age);
  const span = b[3] - b[0];
  const pad = span * 0.35; // marge visuelle pour les 2 categories ouvertes (Faible / Superieur)
  const barMin = b[0] - pad, barMax = b[3] + pad, total = barMax - barMin;
  const widths = [pad, b[1] - b[0], b[2] - b[1], b[3] - b[2], pad];
  const segHtml = widths.map((w, i) =>
    `<div class="vo2-bar-seg" style="flex:${w.toFixed(2)} 1 0;background:${VO2MAX_CAT_COLORS[i]}"></div>`
  ).join('');
  const clamped = Math.min(Math.max(vo2, barMin), barMax);
  const cursorPct = ((clamped - barMin) / total * 100).toFixed(2);
  const catColor = VO2MAX_CAT_COLORS[vo2maxCategoryIndex(vo2, sex, age)];
  return `<div class="vo2-bar">${segHtml}</div><div class="vo2-bar-cursor" style="left:${cursorPct}%;border-color:${catColor}"></div>`;
}

// Catégorie de course FFA (basée sur âge et sexe)
function calcRunningCategory(age, sex) {
  if (!age || age < 12) return null;
  const g = sex === 'F' ? 'F' : 'H';
  if (age < 18) return `JU${g}`; // Junior
  if (age < 23) return `ES${g}`; // Espoir
  if (age < 40) return `SE${g}`; // Senior
  const n = Math.floor((age - 40) / 5) + 1;
  return `M${n}${g}`; // M1H, M2F, M3H...
}

// ─── Rendu ─────────────────────────────────────

function renderProfile() {
  const p = loadProfileData();
  const sex    = p.sex    || 'M';
  // Compute age from birthDate (new) or fallback to stored age (backward compat)
  const birthDate = p.birthDate || null;
  const age = birthDate ? (() => {
    const b = new Date(birthDate);
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  })() : (p.age || null); // fallback backward compat
  const height = p.height || null;
  const weight = p.weight || null;
  const hrmaxMeasured = p.hrmax || null;

  // Remplir le formulaire
  if (el('input-birthdate')) el('input-birthdate').value = birthDate || '';
  if (el('input-height')) el('input-height').value = height || '';
  if (el('input-weight')) el('input-weight').value = weight || '';
  if (el('input-hrmax'))  el('input-hrmax').value  = hrmaxMeasured || '';
  el('sex-m').classList.toggle('active', sex === 'M');
  el('sex-f').classList.toggle('active', sex === 'F');

  // VO2max depuis données Garmin
  // Affichage : valeur arrondie (comme Garmin) — Classification (couleur/categorie/curseur) :
  // valeur precise quand disponible, car Garmin classe en interne sur la precision, pas l'arrondi
  const vo2 = _latestVO2Max;
  const vo2ForClass = _latestVO2MaxPrecise != null ? _latestVO2MaxPrecise : vo2;
  if (vo2) {
    const vo2color = vo2maxGarminColor(vo2ForClass, sex, age);
    setVal('profile-vo2-value', vo2.toFixed(0)); // Garmin shows integer
    const vo2El = el('profile-vo2-value');
    if (vo2El) vo2El.style.color = vo2color;
    setVal('profile-vo2-label', vo2maxLabel(vo2ForClass, sex, age));
    const barEl = el('profile-vo2-bar-wrap');
    if (barEl) barEl.innerHTML = renderVo2Bar(vo2ForClass, sex, age);
  }

  // Catégorie de course FFA
  const runCat = calcRunningCategory(age, sex);
  if (el('profile-run-category')) {
    el('profile-run-category').textContent = runCat || '';
    el('profile-run-category').style.display = runCat ? '' : 'none';
  }

  // ─ Indicateurs de performance ─
  const vma   = calcVMA(vo2, sex);
  const hrMax = calcHRMax(age, hrmaxMeasured);
  const hrMaxIsReal = hrmaxMeasured && hrmaxMeasured > 100;
  const hrMaxSource = hrMaxIsReal ? 'Valeur mesurée' : 'Tanaka : 208 − 0.7 × âge';
  const indEl = el('profile-indicators');
  if (indEl && (vma || hrMax || vo2)) {
    const vmaAllure = vma ? formatPace(3600 / vma) : null;
    indEl.innerHTML = `
      ${vma ? `
      <div class="profile-ind-card">
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="profile-ind-value">${vma.toFixed(1)}</div>
          <div class="profile-ind-unit">km/h</div>
        </div>
        <div class="profile-ind-label">VMA estimée</div>
        <div class="profile-ind-sub">= allure ${vmaAllure} — formule ACSM${sex==='F'?' +5% ♀':''}</div>
      </div>` : ''}
      ${hrMax ? `
      <div class="profile-ind-card">
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="profile-ind-value">${hrMax}</div>
          <div class="profile-ind-unit">bpm</div>
        </div>
        <div class="profile-ind-label">FC max${hrMaxIsReal ? ' réelle ✓' : ' théorique'}</div>
        <div class="profile-ind-sub">${hrMaxSource}</div>
      </div>` : ''}
      ${_avgRestingHR ? `
      <div class="profile-ind-card">
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="profile-ind-value">${Math.round(_avgRestingHR)}</div>
          <div class="profile-ind-unit">bpm</div>
        </div>
        <div class="profile-ind-label">FC repos (moy. Garmin)</div>
        <div class="profile-ind-sub">30 derniers jours</div>
      </div>` : ''}
      ${vma && hrMax ? `
      <div class="profile-ind-card">
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="profile-ind-value">${Math.round(vma * 0.75 * 10) / 10}</div>
          <div class="profile-ind-unit">km/h</div>
        </div>
        <div class="profile-ind-label">Allure EF (Z2)</div>
        <div class="profile-ind-sub">75% VMA · ${formatPace(3600 / (vma * 0.75))} min/km — endurance fond.</div>
      </div>` : ''}
    `.trim() || '<div class="profile-indicator-empty">Renseignez votre âge pour voir les calculs</div>';
  } else if (indEl) {
    indEl.innerHTML = '<div class="profile-indicator-empty">Renseignez vos données pour voir les calculs</div>';
  }

  // ─ IMC + poids idéal ─
  const bmiEl = el('profile-bmi-section');
  if (bmiEl && weight && height) {
    const bmi  = calcBMI(weight, height);
    const cat  = bmiCategory(bmi);
    const ideal = calcIdealWeight(height, sex);
    
    // Marqueur BMI (plage 15–40)
    const pct = Math.min(Math.max((bmi - 15) / (35 - 15) * 100, 2), 98);

    // Conseil perte de poids si poids > borne haute de la fourchette sportive
    // Affiche dans son propre bloc pleine largeur (#profile-weight-goal),
    // pas empile dans la carte Composition corporelle.
    const weightGoalEl = el('profile-weight-goal');
    if (weightGoalEl) {
      if (ideal && weight > ideal.max) {
        const tolose = Math.round((weight - ideal.max) * 10) / 10;
        const weeks  = Math.round(tolose / 0.35);  // ~0.35 kg/sem pour sportif regulier
        weightGoalEl.innerHTML = `
          <div class="weight-loss-advice">
            <div class="weight-loss-title">⚠️ Objectif poids — conseils personnalisés</div>
            <div class="weight-loss-items">
              <div class="weight-loss-item">🎯 Poids à perdre : <span>${tolose} kg</span></div>
              <div class="weight-loss-item">📅 Durée estimée : <span>~${weeks} semaines</span> (à rythme sportif)</div>
              <div class="weight-loss-item">⚖️ Rythme : <span>0.25–0.5 kg/semaine</span> (déficit ~300–500 kcal/jour)</div>
              <div class="weight-loss-item">${personEmoji('running')} Privilégier : <span>sorties Z2 longues</span> + alimentation qualitative</div>
              <div class="weight-loss-item">❌ À éviter : <span>régime sevère</span> — risque de perte musculaire</div>
            </div>
          </div>`;
        weightGoalEl.style.display = '';
      } else {
        weightGoalEl.innerHTML = '';
        weightGoalEl.style.display = 'none';
      }
    }

    bmiEl.innerHTML = `
      <div class="bmi-row">
        <div>
          <div class="bmi-value-big" style="color:${cat.cls==='normal'?'#15803d':cat.cls==='overweight'?'#a16207':cat.cls==='obese'?'#dc2626':'#4338ca'}">${bmi}</div>
          <div style="font-family:var(--font-body);font-size:11px;color:var(--text-muted)">IMC</div>
        </div>
        <span class="bmi-cat ${cat.cls}">${cat.label}</span>
      </div>
      <div class="bmi-bar-wrap">
        <div class="bmi-bar"></div>
        <div class="bmi-marker" style="left:${pct}%"></div>
      </div>
      <div class="bmi-scale">
        <span style="left:0%">15</span>
        <span style="left:17.5%">18.5</span>
        <span style="left:50%">25</span>
        <span style="left:75%">30</span>
        <span style="left:100%">35</span>
      </div>
      ${ideal ? `
      <div class="weight-range">
        <div class="weight-range-val">${ideal.min} – ${ideal.max} kg</div>
        <div class="weight-range-label">poids idéal sportif (IMC cible ${ideal.bmiRange || (sex==='F'?'20–22':'22–23')})</div>
      </div>` : ''}
    `;
  } else if (bmiEl) {
    bmiEl.innerHTML = '<div class="profile-indicator-empty">Renseignez taille et poids pour voir les calculs</div>';
    const weightGoalElEmpty = el('profile-weight-goal');
    if (weightGoalElEmpty) { weightGoalElEmpty.innerHTML = ''; weightGoalElEmpty.style.display = 'none'; }
  }

  // \u2500 Zones FC \u2500
  const zonesEl = el('profile-hr-zones');
  if (zonesEl && hrMax) {
    const useKarv = !!_avgRestingHR;
    setVal('profile-zones-method', useKarv ? 'Méthode Karvonen (FC repos Garmin)' : 'Méthode % FC max (Tanaka)');
    const zones = calcHRZones(hrMax, useKarv ? Math.round(_avgRestingHR) : null);
    // Pourcentages VMA par zone (Campus Coach definitions)
    const VMA_ZONES = [
      { low: 0.55, high: 0.65 },  // Z1 Récup
      { low: 0.65, high: 0.75 },  // Z2 Endurance fond.
      { low: 0.75, high: 0.83 },  // Z3 S60 / Tempo (79-83%)
      { low: 0.83, high: 0.93 },  // Z4 S30 / Seuil (83-93%)
      { low: 0.93, high: 1.05 },  // Z5 VMA
    ];
    zonesEl.innerHTML = `<div class="hr-zones-list">
      ${zones.map((z, i) => {
        const vmaZ = vma ? VMA_ZONES[i] : null;
        const sLow  = vmaZ ? Math.round(vma * vmaZ.low  * 10) / 10 : null;
        const sHigh = vmaZ ? Math.round(vma * vmaZ.high * 10) / 10 : null;
        const pFast = sHigh ? formatPace(3600 / sHigh) : null;
        const pSlow = sLow  ? formatPace(3600 / sLow)  : null;
        const speedHTML = sLow ? `
          <div class="hr-zone-speed">${sLow}–${sHigh} <span style="font-size:10px;color:var(--text-muted)">km/h</span></div>
          <div class="hr-zone-pace">${pFast}–${pSlow} <span style="font-size:10px;color:var(--text-muted)">/km</span></div>` : '';
        return `
        <div class="hr-zone-row">
          <div class="hr-zone-dot" style="background:${z.color}"></div>
          <div class="hr-zone-name">${z.name}</div>
          <div class="hr-zone-range">${z.low} – ${z.high} bpm</div>
          ${speedHTML}
          <div class="hr-zone-bar-wrap">
            <div class="hr-zone-bar" style="background:${z.color};width:${Math.round(z.pHigh*100)}%"></div>
          </div>
          <div class="hr-zone-desc">${z.desc}</div>
        </div>`;
      }).join('')}
    </div>`;
  } else if (zonesEl) {
    zonesEl.innerHTML = '<div class="profile-indicator-empty">Renseignez votre \u00e2ge pour voir les zones</div>';
  }

  // ─ Tableau Allures de course (ALLURE_PLUS_ZONES - Campus Coach definitions) ─
  const racePacesEl = el('profile-race-paces');
  if (racePacesEl && vma) {
    setVal('profile-paces-method', 'VMA ' + vma.toFixed(2) + ' km/h');

    // Table de reference Allure+ — Route + Trail (doit rester identique à
    // ALLURE_PLUS_ZONES dans campus.js, la vraie source de vérité)
    const APZ = {
      RECOVER:    { pL:0.55, pH:0.62, icon:'&#128994;', label:'Récupération',        color:'#94a3b8', note:'55–62% VMA', noTarget:true },
      EF:         { pL:0.62, pH:0.67, icon:'&#128995;', label:'EF — Endurance fond.', color:'#4ade80', note:'62–67% VMA', trailCorr:0.07 },
      TEMPO:      { pL:0.71, pH:0.75, icon:'&#128992;', label:'Tempo',                color:'#a3e635', note:'71–75% VMA', trailCorr:0.07 },
      AS42:       { pL:0.75, pH:0.78, icon:'&#127942;', label:'AS42 — Allure Marathon', color:'#818cf8', note:'75–78% VMA', trailCorr:0.07 },
      SWEET_SPOT: { pL:null, pH:null, icon:'&#11088;',  label:'Sweet Spot',           color:'#facc15', note:'95% vitesse S60',  isSweetSpot:true, trailCorr:0.07 },
      AS21:       { pL:0.82, pH:0.85, icon:'&#127942;', label:'AS21 — Allure Semi',   color:'#fb923c', note:'82–85% VMA', trailCorr:0.07 },
      S60:        { pL:0.84, pH:0.87, icon:'&#9200;',   label:'S60 — Seuil 60min',    color:'#f97316', note:'84–87% VMA', trailCorr:0.07 },
      AS10:       { pL:0.88, pH:0.91, icon:'&#127937;', label:'AS10 — Allure 10km',   color:'#c084fc', note:'88–91% VMA', trailCorr:0.08 },
      S30:        { pL:0.89, pH:0.92, icon:'&#9889;',   label:'S30 — Seuil 30min',    color:'#f87171', note:'89–92% VMA', trailCorr:0.07 },
      VMA:        { pL:0.95, pH:1.05, icon:'&#9889;',   label:'VMA',                  color:'#e879f9', note:'95–105% VMA', trailCorr:0.10 },
    };

    // Formatteur d'allure sec → min'ss"
    const fmtSec = (s) => Math.floor(s/60) + "'" + String(s%60).padStart(2,'0') + '"';
    const fmtPct = (pct) => fmtSec(Math.round(3600 / (vma * pct)));

    // Ligne du tableau — CSS Grid (alignement parfait header+données)
    const paceRow = (def) => {
      let pL = def.pL, pH = def.pH;
      if (def.isSweetSpot) { pL = APZ.S60.pL * 0.95; pH = APZ.S60.pH * 0.95; }

      let routeCell, trailCell;
      if (def.noTarget) {
        routeCell = '<em class="rpt-free">allure libre</em>';
        trailCell = '<em class="rpt-free">allure libre</em>';
      } else {
        routeCell = fmtPct(pH) + '<span class="rpt-dash"> – </span>' + fmtPct(pL);
        if (def.trailCorr) {
          const corr = def.trailCorr;
          const tMin = Math.round(3600 / (vma * pH) * (1 + corr));
          const tMax = Math.round(3600 / (vma * pL) * (1 + corr));
          trailCell = fmtSec(tMin) + '<span class="rpt-dash"> – </span>' + fmtSec(tMax)
            + ' <span class="rpt-badge">+' + Math.round(corr*100) + '%</span>';
        } else {
          trailCell = '<span class="rpt-na">–</span>';
        }
      }

      return '<div class="rpt-row" style="border-left:3px solid ' + def.color + '">'
        + '<div class="rpt-cell rpt-zone">'
          + '<div class="rpt-zone-name">' + def.label + '</div>'
          + '<div class="rpt-zone-pct">' + def.note + '</div>'
        + '</div>'
        + '<div class="rpt-cell rpt-route">' + routeCell + '</div>'
        + '<div class="rpt-cell rpt-trail">' + trailCell + '</div>'
        + '</div>';
    };

    racePacesEl.innerHTML =
      '<div class="rpt-table">'
      + '<div class="rpt-head">'
        + '<div class="rpt-cell rpt-zone">Zone</div>'
        + '<div class="rpt-cell rpt-route">' + personEmoji('running') + ' Route <span class="rpt-unit-hd">/km</span></div>'
        + '<div class="rpt-cell rpt-trail">🏔 Trail <span class="rpt-unit-hd">/km</span></div>'
      + '</div>'
      + paceRow(APZ.EF)
      + paceRow(APZ.TEMPO)
      + paceRow(APZ.AS42)
      + paceRow(APZ.SWEET_SPOT)
      + paceRow(APZ.AS21)
      + '<div class="rpt-sep"></div>'
      + paceRow(APZ.S60)
      + paceRow(APZ.AS10)
      + paceRow(APZ.S30)
      + '<div class="rpt-sep"></div>'
      + paceRow(APZ.VMA)
      + '</div>';
  } else if (racePacesEl) {
    racePacesEl.innerHTML = '<div class="profile-indicator-empty">Synchronisez Garmin pour calculer vos allures</div>';
  }

  // Conseils personnalis\u00e9s
  renderProfileAdvice();

  // Applications connect\u00e9es
  renderProfileApps();
}

function initProfileForm() {
  let _sex = loadProfileData().sex || 'M';

  // Toggle Homme/Femme
  [el('sex-m'), el('sex-f')].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      _sex = btn.dataset.val;
      el('sex-m').classList.toggle('active', _sex === 'M');
      el('sex-f').classList.toggle('active', _sex === 'F');
    });
  });

  // Sauvegarde
  const form = el('profile-form');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const data = {
        sex:    _sex,
        birthDate: el('input-birthdate')?.value || null,
        height: parseFloat(el('input-height')?.value) || null,
        weight: parseFloat(el('input-weight')?.value) || null,
        hrmax:  parseInt(el('input-hrmax')?.value)  || null,
      };
      saveProfileData(data);
      renderProfile();
      applyGenderedEmojis();
      // Mini feedback visuel
      const btn = form.querySelector('.btn-save-profile');
      const orig = btn.innerHTML;
      btn.innerHTML = '\u2713 Enregistr\u00e9 !';
      btn.style.background = '#16a34a';
      setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 1500);
    });
  }
}

// ─── Conseils personnalisés ────────────────────
function renderProfileAdvice() {
  const section = el('profile-advice-section');
  if (!section) return;
  const p = loadProfileData();
  const { sex = 'M', age, height, weight, hrmax } = p;
  const vo2 = _latestVO2Max;
  const hrRest = _avgRestingHR ? Math.round(_avgRestingHR) : null;
  const hrMax  = hrmax || (age ? Math.round(208 - 0.7 * age) : null);

  // ─ Calcul BMR (Mifflin-St Jeor) ─
  let bmr = null, tdee = null, hydro = null, hydroRest = null, hydroActive = null;
  if (weight && height && age) {
    bmr  = sex === 'F'
      ? 10 * weight + 6.25 * height - 5 * age - 161
      : 10 * weight + 6.25 * height - 5 * age + 5;
    tdee = Math.round(bmr * 1.6);  // facteur actif (sport 4-5x/sem)
  }
  // Hydratation : besoin repos vs entraînement (poids seul suffit)
  if (weight) {
    hydroRest   = Math.round(weight * 33 / 100) * 100;
    hydroActive = hydroRest + 600;
    hydro = hydroActive;
  }

  // ─ Macros recommandés pour endurance ─
  const protMin = weight ? Math.round(weight * 1.6) : null;
  const protMax = weight ? Math.round(weight * 2.0) : null;

  // ─ Sommeil : 7-9h selon OMS/sportif ─
  const sleepH = age && age > 45 ? '7–8h30' : '7–9h';

  // ─ Volume hebdo VMA ─
  let weeklyKm = null;
  if (vo2) {
    if      (vo2 < 42) weeklyKm = '20–35';
    else if (vo2 < 50) weeklyKm = '35–55';
    else if (vo2 < 58) weeklyKm = '55–75';
    else               weeklyKm = '75–100+';
  }

  // ─ Temps de récupération entre séances intenses ─
  const recovDays = age && age > 45 ? '48–72h' : '36–48h';

  function tip(icon, text) {
    return `<div class="advice-tip"><span class="advice-tip-icon">${icon}</span><span>${text}</span></div>`;
  }
  function card(cls, icon, title, tips, highlight) {
    return `
      <div class="advice-card advice-card--${cls}">
        <div class="advice-card-header">
          <span class="advice-card-icon">${icon}</span>
          <span class="advice-card-title">${title}</span>
        </div>
        <div class="advice-card-body">
          ${tips.join('')}
          ${highlight ? `<div class="advice-highlight">${highlight}</div>` : ''}
        </div>
      </div>`;
  }

  // ── 1. NUTRITION ──────────────────────────────
  const nutritionCard = card('nutrition', '️', 'Nutrition',
    [
      tip('', `<strong>Protéines&nbsp;:</strong> ${protMin && protMax ? `${protMin}–${protMax} g/jour` : '1.6–2.0 g/kg'} — priorité aux sources complètes (œufs, poulet, poisson, légumineuses)`),
      tip('', '<strong>Glucides complexes</strong> en pré-sortie&nbsp;: avoine, riz complet, patate douce — 2–3h avant l\'effort'),
      tip('', '<strong>Anti-inflammatoires</strong> quotidiens&nbsp;: fruits rouges, curcuma, oméga-3 (sardines, maquereau, noix)'),
      tip('⏰', '<strong>Fenêtre anabolique</strong>&nbsp;: protéines + glucides dans les 30–45 min post-effort pour optimiser la récupération'),
      tip('', 'Limiter sucres rapides, alcool et ultra-transformés — ils augmentent l\'inflammation et ralentissent la récupération'),
    ],
    tdee ? ` Votre besoin calorique estimé&nbsp;: <strong>${tdee} kcal/jour</strong> (sportif actif — base ${Math.round(bmr)} kcal)` : null
  );

  // ── 2. HYDRATATION ────────────────────────────
    const hydroCard = card('hydration', '', 'Hydratation',
    [
      tip('', hydroRest
        ? 'Jour de repos&nbsp;: <strong>' + (hydroRest/1000).toFixed(1) + ' L</strong>&nbsp;&middot;&nbsp;Jour d\'entraînement&nbsp;: <strong>' + (hydroActive/1000).toFixed(1) + ' L</strong>'
        : 'Renseignez votre <strong>poids</strong> dans le profil pour une estimation personnalisée'),
      tip('', '<strong>Pendant l\'effort&nbsp;:</strong> 500–750&nbsp;mL/heure — commencer à boire dès les premières minutes, ne pas attendre la soif'),
      tip('⚡', '<strong>Électrolytes</strong> si sortie > 1h&nbsp;: sodium, magnésium, potassium (boisson isotonique maison ou sel&nbsp;+&nbsp;citron)'),
      tip('☕', '<strong>Caféine avec modération</strong>&nbsp;: 1–2 cafés/jour max — effet diurétique, compensez +200&nbsp;mL/café'),
      tip('️', 'En chaleur&nbsp;: augmenter de 500&nbsp;mL à 1&nbsp;L — surveiller couleur des urines (jaune paille&nbsp;= hydraté)'),
    ],
    hydroActive ? ' Après une sortie, boire <strong>500&nbsp;mL dans les 30&nbsp;min</strong> qui suivent — besoin journalier&nbsp;: <strong>~' + (hydroActive/1000).toFixed(1) + '&nbsp;L</strong>' : null
  );

  // ── 3. SOMMEIL
  const sleepCard = card('sleep', '', 'Sommeil',
    [
      tip('\u23F1\uFE0F', `<strong>Durée recommandée&nbsp;:</strong> <strong>${sleepH}</strong>${age && age > 45 ? ' — après 45 ans, la qualité prime sur la quantité' : ''}`),
      tip('', '<strong>Écrans off 1h avant</strong> le coucher — la lumière bleue bloque la mélatonine et retarde l\'endormissement de 45–90 min'),
      tip('', '<strong>Chambre fraîche (17–19°C)</strong>&nbsp;: le corps doit baisser sa température centrale pour entrer dans le sommeil profond'),
      tip('\u26A1', '<strong>Éviter l\'effort intense</strong> après 19h — le cortisol et l\'adrénaline restent élevés 2–3h post-séance'),
      tip('', '<strong>Heure de réveil fixe</strong> 7j/7 — la régularité du cycle circadien améliore la qualité du sommeil profond (récupération musculaire)'),
    ],
    ` Le sommeil profond est où 80% de la <strong>production de GH</strong> (hormone de croissance = réparation musculaire) se produit`
  );

  // ── 4. RÉCUPÉRATION & STRESS
  const recovCard = card('recovery', '', 'Récupération & Stress',
    [
      tip('\u2764\uFE0F', `<strong>Cohérence cardiaque</strong> 3×5 min/jour (méthode 365)&nbsp;: 6 respirations/min pendant 5 min — réduit le cortisol de ~20%`),
      tip('', '<strong>Douche froide/contraste</strong> post-effort (chaud 3 min → froid 30 sec, ×3) — réduit l\'inflammation et les courbatures'),
      tip('', '<strong>Étirements passifs</strong> 15 min après chaque séance — prioriser ischio-jambiers, mollets, psoas (les zones les plus sollicitées en course)'),
      tip('', `<strong>Repos actif</strong> entre séances intenses&nbsp;: marche, vélo léger, natation à très faible intensité — ${recovDays} minimum`),
      tip('', '<strong>Magnésium bisglycinate</strong> le soir&nbsp;: 300–400 mg — réduit les crampes, améliore la qualité du sommeil, souvent déficitaire chez les sportifs'),
    ],
    ` Avec FC repos à <strong>${hrRest || '?'} bpm</strong>, surveillez toute élévation > 5 bpm le matin — signe de fatigue ou début de maladie`
  );

  // ── 5. ENTRAÎNEMENT OPTIMAL
  const trainingCard = card('training', '', 'Entraînement optimal',
    [
      tip('', '<strong>Règle 80/20</strong>&nbsp;: 80% de vos séances en Zone 2 (endurance fondamentale), 20% en haute intensité — les coureurs élites appliquent cette répartition'),
      tip('', `<strong>Volume hebdo</strong> recommandé selon votre VO₂max&nbsp;: ${weeklyKm ? '<strong>' + weeklyKm + ' km</strong>' : 'à définir selon forme actuelle'}`),
      tip('\u2B06\uFE0F', '<strong>Progression&nbsp;:</strong> ne pas augmenter le volume total de plus de <strong>10% par semaine</strong> — règle de base pour éviter les blessures'),
      tip('', '<strong>Musculation 2x/sem</strong>&nbsp;: gainage, squats, fentes — renforce les tendons et prévient les blessures du coureur (genou du coureur, tendinite)'),
      tip('', '<strong>Semaine de décharge</strong> toutes les 4 semaines&nbsp;: -30% de volume — permet la supercompensation et les gains réels'),
    ],
    vo2 ? ` Avec VO₂max <strong>${vo2.toFixed(1)}</strong>, votre potentiel de progression est <strong>${vo2 < 50 ? 'significatif' : vo2 < 58 ? 'bon' : 'excellent'}</strong> — la constance prime sur l'intensité` : null
  );

  // ── 6. SANTÉ CARDIOVASCULAIRE ─────────────────
  const cardioCard = card('cardio', '❤️', 'Santé cardiovasculaire',
    [
      tip('', `<strong>FC repos cible</strong>&nbsp;: ${hrRest ? `vous êtes à <strong>${hrRest} bpm</strong> — objectif progressif <strong>&lt;50 bpm</strong> pour un sportif entraîné` : 'viser < 55 bpm par l\'entraînement régulier en Z2'}`),
      tip('️', '<strong>Séances Z2 longues</strong> (1h30+) développent le réseau capillaire cardiaque et améliorent la VO₂max sur 3–6 mois'),
      tip('', '<strong>Bilan lipidique</strong> annuel&nbsp;: cholestérol, triglycérides, CRP — les sportifs ont souvent un profil favorable mais la surveillance reste importante'),
      tip('', '<strong>Variabilité FC (HRV)</strong>&nbsp;: indicateur de récupération — disponible sur Garmin. HRV élevée = bonne forme. HRV basse = récupérer'),
      tip('', '<strong>Sodium</strong>&nbsp;: important pour les coureurs longue distance mais surveiller la pression artérielle si antécédents familiaux'),
    ],
    vo2 && age ? ` Pour votre âge (${age} ans), un VO₂max de <strong>${vo2.toFixed(1)}</strong> vous classe <strong>${vo2 > 48 ? 'au-dessus' : 'dans'} la moyenne</strong> des sportifs de votre tranche` : null
  );

  section.innerHTML = `
    <div class="advice-section-title"> Conseils personnalisés${(!weight || !age) ? ' <span style="font-size:12px;font-weight:400;color:var(--text-muted)">(complétez votre profil pour personnaliser)</span>' : ''}</div>
    <div class="advice-grid">
      ${nutritionCard}${hydroCard}${sleepCard}${recovCard}${trainingCard}${cardioCard}
    </div>
  `;
}

// ─── Applications connectée
// Peupler le sélecteur d'années depuis les activités disponibles
function populateYearSelector() {
  const yearSel = el('filter-year');
  if (!yearSel) return;
  // Sauvegarder la sélection courante
  const prevVal = yearSel.value;
  // Conserver l'option "Toutes les années" (première option)
  while (yearSel.options.length > 1) yearSel.remove(1);

  // Calculer l'année la plus ancienne depuis les activités déjà chargées
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
    const hasPartial = _allActivities.some(a => {
      const d = new Date(a.date || a.startTimeLocal || '');
      return d.getFullYear() === y;
    });
    const isPartial = hasPartial && !_fullyLoadedYears.has(y) && y !== currentYear;
    opt.textContent = String(y);  // pas de ⚠ : l'utilisateur ne veut pas de marqueur d'année partielle
    yearSel.appendChild(opt);
  }
  // Restaurer la sélection précédente si elle est encore valide
  if (prevVal && yearSel.querySelector('option[value="' + prevVal + '"]')) {
    yearSel.value = prevVal;
  }
}
async function renderProfileApps() {
  try {
    const status = await fetchJSON('/api/campus/status').catch(() => null);
    const campusBadge = el('app-campus-badge');
    const campusStatus = el('app-campus-status');
    const campusLogin = el('campus-quick-login');
    const campusRow = el('app-campus-row');
    const campusHidden = localStorage.getItem('campus_hidden') === 'true';

    if (status?.connected) {
      // Campus connecte : afficher l'etat
      if (campusBadge) { campusBadge.textContent = '\u2713'; campusBadge.className = 'profile-app-badge connected'; }
      if (campusStatus) campusStatus.textContent = status.campusEmail || 'Connect\u00e9';
      if (campusLogin) campusLogin.style.display = 'none';
      if (campusRow) campusRow.style.display = '';
      const noCampusBtn = el('btn-no-campus');
      if (noCampusBtn) noCampusBtn.remove();
    } else if (campusHidden) {
      // Utilisateur sans Campus : masquer la ligne entiere
      if (campusRow) campusRow.style.display = 'none';
    } else {
      // Non connecte : afficher avec option de masquage
      if (campusBadge) { campusBadge.textContent = '\u2014'; campusBadge.className = 'profile-app-badge'; }
      if (campusStatus) campusStatus.textContent = 'Non connect\u00e9';
      if (campusLogin) campusLogin.style.display = '';
      if (campusRow) campusRow.style.display = '';
      // Ajouter bouton "Je n'ai pas de compte Campus" si absent
      if (!el('btn-no-campus') && campusRow) {
        const btn = document.createElement('button');
        btn.id = 'btn-no-campus';
        btn.className = 'btn-no-campus';
        btn.textContent = "Je n'ai pas de compte Campus Coach";
        btn.onclick = () => {
          localStorage.setItem('campus_hidden', 'true');
          if (campusRow) campusRow.style.display = 'none';
          btn.remove();
        };
        campusRow.insertAdjacentElement('afterend', btn);
      }
    }
  } catch(e) {}
}

async function connectCampusFromProfile() {
  const email = el('campus-profile-email')?.value;
  const password = el('campus-profile-password')?.value;
  if (!email || !password) { showToast('Email et mot de passe requis', 'error'); return; }
  try {
    showToast('Connexion à Campus Coach…', 'info');
    const res = await fetchJSON('/api/campus/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.success) {
      showToast('✅ Campus Coach connecté !', 'success');
      renderProfileApps();
    }
  } catch(e) { showToast('Erreur : ' + e.message, 'error'); }
}


// ══════════════════════════════════════════════════════
// THÈME DARK / LIGHT
// ══════════════════════════════════════════════════════
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('allure_theme', theme);
  // Swap logo sidebar
  const logo = document.getElementById('sidebar-logo-img');
  if (logo) logo.src = theme === 'dark' ? 'images/logo-allure-blanc.png' : 'images/logo-allure-noir.png';
  // Swap icône bouton
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) {
    btn.title = theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre';
    btn.innerHTML = theme === 'dark' ? getSunSVG() : getMoonSVG();
  }
}

function getMoonSVG() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
function getSunSVG() {
  return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
}

function initThemeToggle() {
  const saved = localStorage.getItem('allure_theme') || 'light';
  applyTheme(saved);
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });
}

// ══════════════════════════════════════════════════════
// SLIDESHOW DE FOND
// ══════════════════════════════════════════════════════
async function initBgSlideshow() {
  const layerA = document.getElementById('bg-layer-a');
  const layerB = document.getElementById('bg-layer-b');
  if (!layerA || !layerB) return;
  let images = [];
  try { images = await fetch('/api/bg-images').then(r => r.json()); } catch(e) {}
  if (!images.length) return;
  for (let i = images.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [images[i], images[j]] = [images[j], images[i]];
  }
  let currentIdx = 0, usingA = true;
  function preload(url) {
    return new Promise(resolve => { const img = new Image(); img.onload = img.onerror = resolve; img.src = url; });
  }
  async function showNext() {
    const nextIdx = (currentIdx + 1) % images.length;
    await preload(images[nextIdx]);
    if (usingA) {
      layerB.style.backgroundImage = `url('${images[nextIdx]}')`;
      layerB.classList.add('active');
      setTimeout(() => layerA.classList.remove('active'), 100);
    } else {
      layerA.style.backgroundImage = `url('${images[nextIdx]}')`;
      layerA.classList.add('active');
      setTimeout(() => layerB.classList.remove('active'), 100);
    }
    usingA = !usingA;
    currentIdx = nextIdx;
  }
  layerA.style.backgroundImage = `url('${images[0]}')`;
  layerA.style.transition = 'none';
  layerA.classList.add('active');
  setTimeout(() => { layerA.style.transition = ''; }, 50);
  if (images.length > 1) preload(images[1]);
  setInterval(showNext, 120_000);
}

// ══════════════════════════════════════════════════════
// AVATAR UTILISATEUR
// ══════════════════════════════════════════════════════
async function loadAvatar() {
  const frame = el('avatar-frame');
  const inner = el('avatar-frame-inner');
  if (!frame || !inner) return;
  try {
    const res = await fetch(`${API}/api/avatar`);
    const data = await res.json();
    if (data.url) {
      inner.innerHTML = `<img src="${data.url}?t=${Date.now()}" alt="Avatar" />`;
      frame.classList.add('has-avatar');
    } else {
      inner.textContent = 'A+';
      frame.classList.remove('has-avatar');
    }
  } catch (e) {
    inner.textContent = 'A+';
    frame.classList.remove('has-avatar');
  }
}

function initAvatarUpload() {
  const addBtn = el('avatar-frame-add');
  const removeBtn = el('avatar-frame-remove');
  const fileInput = el('avatar-file-input');

  if (addBtn && fileInput) addBtn.addEventListener('click', () => fileInput.click());

  if (fileInput) fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('avatar', file);
    try {
      const res = await fetch(`${API}/api/avatar`, { method: 'POST', body: formData });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erreur ${res.status}`); }
      await loadAvatar();
      if (typeof showToast === 'function') showToast('Photo de profil mise à jour', 'success');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Erreur : ' + e.message, 'error');
    }
    fileInput.value = '';
  });

  if (removeBtn) removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await fetch(`${API}/api/avatar`, { method: 'DELETE' });
      await loadAvatar();
    } catch (e) {}
  });
}

// ══════════════════════════════════════════════════════
// EMOJIS GENRÉS (selon le sexe renseigné dans le Profil)
// ══════════════════════════════════════════════════════
function personEmoji(kind) {
  const sex = loadProfileData().sex || 'M';
  const MAP = {
    running:  sex === 'F' ? '🏃🏽‍♀️' : '🏃🏽‍♂️',
    cycling:  sex === 'F' ? '🚴🏽‍♀️' : '🚴🏽‍♂️',
    walking:  sex === 'F' ? '🚶🏽‍♀️' : '🚶🏽‍♂️',
    strength: sex === 'F' ? '🏋🏽‍♀️' : '🏋🏽‍♂️',
  };
  return MAP[kind] || MAP.running;
}

function applyGenderedEmojis() {
  document.querySelectorAll('.gendered-emoji').forEach(elm => {
    elm.textContent = personEmoji(elm.dataset.kind || 'running');
  });
}

// ══════════════════════════════════════════════════════
// GESTION DES PHOTOS DE FOND (modale)
// ══════════════════════════════════════════════════════
function initBgManagerButton() {
  const btn = el('btn-bg-manager');
  if (btn) btn.addEventListener('click', openBgManagerModal);
}

async function openBgManagerModal() {
  if (document.getElementById('bgmgr-modal')) return;
  const bd = document.createElement('div');
  bd.className = 'bgmgr-modal-backdrop';
  bd.id = 'bgmgr-modal';
  bd.innerHTML = `
    <div class="bgmgr-modal" onclick="event.stopPropagation()">
      <div class="bgmgr-modal-header">
        <h2>Photos de fond</h2>
        <button class="bgmgr-modal-close" id="bgmgr-modal-close">&times;</button>
      </div>
      <div class="bgmgr-grid" id="bgmgr-grid"></div>
      <div class="bgmgr-footer">
        <button class="btn-sheets" id="bgmgr-add-btn">+ Ajouter une image</button>
        <input type="file" accept="image/*" id="bgmgr-file-input" style="display:none" />
      </div>
    </div>
  `;
  document.body.appendChild(bd);
  bd.addEventListener('click', closeBgManagerModal);
  document.getElementById('bgmgr-modal-close').addEventListener('click', closeBgManagerModal);
  document.getElementById('bgmgr-add-btn').addEventListener('click', () => document.getElementById('bgmgr-file-input').click());
  document.getElementById('bgmgr-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await fetch(`${API}/api/bg-images`, { method: 'POST', body: formData });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `Erreur ${res.status}`); }
      await renderBgManagerGrid();
      if (typeof showToast === 'function') showToast('Image ajoutée', 'success');
    } catch (err) {
      if (typeof showToast === 'function') showToast('Erreur : ' + err.message, 'error');
    }
    e.target.value = '';
  });
  await renderBgManagerGrid();
}

function closeBgManagerModal() {
  const modal = document.getElementById('bgmgr-modal');
  if (modal) modal.remove();
}

async function renderBgManagerGrid() {
  const grid = document.getElementById('bgmgr-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="table-loading">Chargement…</div>';
  let images = [];
  try { images = await fetch(`${API}/api/bg-images`).then(r => r.json()); } catch (e) {}
  if (images.length === 0) { grid.innerHTML = '<div class="table-loading">Aucune image</div>'; return; }
  grid.innerHTML = images.map(url => {
    const filename = url.split('/').pop();
    const thumbUrl = '/bg-thumbs/' + encodeURIComponent(filename);
    return `
      <div class="bgmgr-item">
        <img src="${thumbUrl}" alt="${filename}" />
        <button class="bgmgr-item-remove" data-filename="${filename}" title="Supprimer">&times;</button>
      </div>
    `;
  }).join('');
  grid.querySelectorAll('.bgmgr-item-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await fetch(`${API}/api/bg-images/${encodeURIComponent(btn.dataset.filename)}`, { method: 'DELETE' });
        await renderBgManagerGrid();
      } catch (e) {}
    });
  });
}

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════

// ══════════════════════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════════════════════
const ADMIN_EMAIL = 'shiznogoud@gmail.com';

function showAdminNav(userEmail) {
  const navAdmin = document.getElementById('nav-admin');
  if (navAdmin && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    navAdmin.style.display = 'flex';
  }
  const btnExport = document.getElementById('btn-export-plan-xlsx');
  if (btnExport && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    btnExport.style.display = 'inline-flex';
  }
}

// Implémentation réelle dans campus.js (a besoin de campusState.goal/weeks,
// le plan tel qu'affiché à l'écran - voir la fonction là-bas pour le detail)

async function loadAdminInfo() {
  try {
    const data = await fetch('/api/admin-info').then(r => r.json());

    // Serveur
    const srvEl = document.getElementById('admin-server-info');
    if (srvEl) {
      srvEl.innerHTML = [
        ['Uptime',       data.server.uptime],
        ['Node.js',      data.server.nodeVersion],
        ['Mémoire RSS',  data.server.memRSS],
        ['Heap utilisé', data.server.memHeap],
        ['PID',          data.server.pid],
      ].map(([l,v]) => `
        <div class="admin-info-row">
          <span class="admin-info-label">${l}</span>
          <span class="admin-info-value">${v}</span>
        </div>`).join('');
    }

    // Connexions
    const connEl = document.getElementById('admin-connections');
    if (connEl) {
      const g = data.garmin;
      const c = data.campus;
      connEl.innerHTML = `
        <div class="admin-info-row">
          <span class="admin-info-label">Garmin Connect</span>
          <span class="admin-info-value">
            <span class="admin-status-dot admin-status-dot--${g.connected ? 'ok' : 'err'}"></span>
            ${g.connected ? g.email : 'Non connecté'}
          </span>
        </div>
        <div class="admin-info-row">
          <span class="admin-info-label">Campus Coach</span>
          <span class="admin-info-value">
            <span class="admin-status-dot admin-status-dot--${c.connected ? 'ok' : 'err'}"></span>
            ${c.connected ? c.email : 'Non connecté'}
          </span>
        </div>
        <div class="admin-info-row">
          <span class="admin-info-label">Admin email</span>
          <span class="admin-info-value">${data.adminEmail || '—'}</span>
        </div>
      `;
    }
    // Référence D+ trail (repère pour la création de plans)
    const dplusEl = document.getElementById('admin-dplus-tiers');
    if (dplusEl && data.dplusTiers) renderAdminDplusTiers(dplusEl, data.dplusTiers);
  } catch(e) {
    const el = document.getElementById('admin-server-info');
    if (el) el.innerHTML = '<div class="table-loading">Erreur chargement</div>';
  }
}

const ADMIN_DPLUS_CATS = [
  { key: 'court', label: 'Trail court', dist: '< 21 km' },
  { key: 'moyen', label: 'Trail moyen', dist: '21 – 42 km' },
  { key: 'long',  label: 'Trail long',  dist: '42 – 80 km' },
  { key: 'ultra', label: 'Ultra-trail',  dist: '> 80 km' },
];

function renderAdminDplusTiers(el, dplusTiers) {
  const fmtRange = t => t.max == null
    ? `${t.min.toLocaleString('fr-FR')} m et plus`
    : `${t.min.toLocaleString('fr-FR')} – ${t.max.toLocaleString('fr-FR')} m`;

  const tierNames = (dplusTiers.long || dplusTiers.moyen || []).map(t => t.label);

  el.innerHTML = `
    <div class="admin-dplus-table-wrap">
      <table class="admin-dplus-table">
        <thead>
          <tr>
            <th>Catégorie</th>
            <th>Distance</th>
            ${tierNames.map(n => `<th>${n}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${ADMIN_DPLUS_CATS.map(cat => `
            <tr>
              <td class="admin-dplus-cat">${cat.label}</td>
              <td class="admin-dplus-dist">${cat.dist}</td>
              ${(dplusTiers[cat.key] || []).map(t => `<td>${fmtRange(t)}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div class="admin-dplus-note">Utilisé pour nommer les plans du catalogue trail (ex : <code>T_42_80_16S_4J_3500_5000_ACTIF.aplus</code>).</div>
  `;
}

async function loadAdminLogs() {
  const el = document.getElementById('admin-logs-content');
  if (!el) return;
  el.textContent = 'Chargement…';
  try {
    const data = await fetch('/api/logs').then(r => r.json());
    const lines = (data.lines || []).slice(-80).reverse();
    el.innerHTML = lines.map(line => {
      const cls = /error|ERR|exception/i.test(line) ? 'admin-log-line--error'
                : /warn|WARN/i.test(line)            ? 'admin-log-line--warn'
                : /✅|OK|success|connected/i.test(line) ? 'admin-log-line--ok'
                : '';
      return `<div class="${cls}">${line.replace(/</g,'&lt;')}</div>`;
    }).join('');
  } catch(e) { el.textContent = 'Impossible de lire server.log'; }
}

function initAdminPage() {
  loadAdminInfo();
  loadAdminLogs();
  // Refresh toutes les 30s si page admin active
  setInterval(() => {
    if (document.getElementById('page-admin')?.style.display !== 'none') {
      loadAdminInfo();
    }
  }, 30000);
}


// Global error handler – affiche les erreurs JS dans un bandeau rouge
window.addEventListener('error', (e) => {
  console.error('[APP ERROR]', e.message, e.filename, e.lineno);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#dc2626;color:#fff;padding:10px 20px;font-size:13px;font-family:monospace;';
  banner.textContent = `JS ERROR: ${e.message} (line ${e.lineno})`;
  document.body?.appendChild(banner);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[UNHANDLED PROMISE]', e.reason);
});

document.addEventListener('DOMContentLoaded', async () => {
  // ── Splash screen ────────────────────────────────────────────
  const splash = document.getElementById('splash-screen');
  const splashVideo = document.getElementById('splash-video');
  function dismissSplash() {
    if (splash && !splash.classList.contains('hidden')) {
      splash.classList.add('hidden');
    }
  }
  if (splashVideo) {
    // Arrêter la vidéo 2 secondes avant la fin (le zoom démarre tôt)
    const setupTrim = () => {
      const dur = splashVideo.duration;
      if (!isFinite(dur) || dur <= 0) return;
      const stopAt = Math.max(0, dur - 2);
      splashVideo.addEventListener('timeupdate', () => {
        if (splashVideo.currentTime >= stopAt) {
          splashVideo.pause();
          dismissSplash();
        }
      });
    };
    if (splashVideo.readyState >= 1) {
      setupTrim(); // durée déjà connue
    } else {
      splashVideo.addEventListener('loadedmetadata', setupTrim);
    }
    // Fallback : vérification toutes les 200ms au cas où les events tardent
    const trimGuard = setInterval(() => {
      if (splashVideo.duration && splashVideo.currentTime >= splashVideo.duration - 2) {
        clearInterval(trimGuard);
        splashVideo.pause();
        dismissSplash();
      }
    }, 200);
    splashVideo.addEventListener('ended', () => { clearInterval(trimGuard); dismissSplash(); });
    setTimeout(() => { clearInterval(trimGuard); dismissSplash(); }, 4500);
  } else if (splash) {
    setTimeout(dismissSplash, 3000);
  }
  // ─────────────────────────────────────────────────────────────

  try { initThemeToggle(); } catch(e) { console.error('initThemeToggle failed:', e); }
  initBgSlideshow(); // async, pas de throw critique
  try { initProfileForm(); } catch(e) { console.error('initProfileForm failed:', e); }
  try { initAvatarUpload(); loadAvatar(); } catch(e) { console.error('initAvatarUpload failed:', e); }
  try { initBgManagerButton(); } catch(e) { console.error('initBgManagerButton failed:', e); }
  applyGenderedEmojis();
  // Précharger les plans en arrière-plan dès le démarrage (évite le délai à l'ouverture de la page)
  if (typeof prefetchPlans === 'function') prefetchPlans();
  const refreshBtn = el('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshAll);
  // Redémarrer le serveur
  const restartBtn = el('restart-btn');
  if (restartBtn) {
    restartBtn.addEventListener('click', async () => {
      if (!confirm('Redémarrer le serveur Node.js ?\n(la page se rechargera dans 3 secondes)')) return;
      restartBtn.classList.add('restarting');
      restartBtn.textContent = 'Redémarrage…';
      try {
        await fetch(`${API}/api/restart`, { method: 'POST' });
      } catch {}
      // Attendre que le serveur redémarre puis recharger
      setTimeout(() => location.reload(), 3000);
    });
  }

  // Voir tout → naviguer vers Activités
  const seeAll = el('see-all-runs');
  if (seeAll) seeAll.addEventListener('click', () => navigateTo('activities'));

  // Filtres page activités (sport type)
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      renderAllActivities(_allActivities, pill.dataset.filter);
    });
  });

  // TASK 4 — Year/month selectors re-render with current sport filter
  function getCurrentSportFilter() {
    const activePill = document.querySelector('.filter-pill.active');
    return activePill ? (activePill.dataset.filter || 'all') : 'all';
  }

  const filterYear  = el('filter-year');
  const filterMonth = el('filter-month');
  // Overlay chargement année à la demande
  function showYearLoading(year) {
    const tbody = document.querySelector('#all-activities-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:48px 20px;">' +
      '<div style="font-size:36px;margin-bottom:14px">&#x1F4E5;</div>' +
      '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Chargement de ' + year + '</div>' +
      '<div style="font-size:13px;color:var(--text-secondary)">Récupération de vos activités Garmin — merci de patienter...</div>' +
    '</td></tr>';
  }

  if (filterYear) filterYear.addEventListener('change', async () => {
    const year = parseInt(filterYear.value) || 0;
    if (year && !_fullyLoadedYears.has(year)) {
      // Afficher le chargement dans la table (ID correct)
      const loadTbody = document.getElementById('all-activities-tbody');
      if (loadTbody) {
        loadTbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:48px 20px;">' +
          '<div style="font-size:36px;margin-bottom:14px">&#x1F4E5;</div>' +
          '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Chargement de ' + year + '</div>' +
          '<div style="font-size:13px;color:var(--text-secondary)">Récupération de vos activités Garmin — merci de patienter...</div>' +
          '</td></tr>';
      }
      // Toast de chargement (utiliser ID pour retrouver l'élément plus tard)
      showToast('⏳ Chargement de ' + year + ' en cours…', 'loading', 0);
      try {
        const resp = await fetch('/api/activities/year/' + year);
        // Fermer le toast de chargement via son ID
        const lt = document.getElementById('app-toast-loading');
        if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
        if (resp.ok) {
          const data = await resp.json();
          if (data.activities && data.activities.length > 0) {
            // Remplacer les activités de cette année
            _allActivities = _allActivities.filter(a => {
              const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
              return isNaN(d) || d.getFullYear() !== year;
            }).concat(data.activities);
            _fullyLoadedYears.add(year);
            // Retirer ⚠ de l'option
            Array.from(filterYear.options).forEach(opt => {
              if (parseInt(opt.value) === year) opt.textContent = String(year);
            });
            showToast('✓ ' + data.count + ' activité(s) pour ' + year, 'success', 6000);
          } else {
            _fullyLoadedYears.add(year);
            showToast('Aucune activité trouvée pour ' + year, 'info');
          }
        } else {
          showToast('Erreur serveur (' + resp.status + ')', 'error');
        }
      } catch(e) {
        const lt2 = document.getElementById('app-toast-loading');
        if (lt2) { lt2.style.opacity = '0'; setTimeout(() => lt2.remove(), 300); }
        showToast('Erreur réseau : ' + e.message, 'error');
      }
    }
    // Toujours mettre à jour l'affichage avec l'année sélectionnée
    renderAllActivities(_allActivities, getCurrentSportFilter(), year || null);
  });
  if (filterMonth) filterMonth.addEventListener('change', () => renderAllActivities(_allActivities, getCurrentSportFilter()));
  const filterSearch = el('filter-search');
  if (filterSearch) filterSearch.addEventListener('input', () => renderAllActivities(_allActivities, getCurrentSportFilter()));
  // Status + chargement initial
  await checkStatus();
  await Promise.all([loadDashboard(), loadHeartRate(), loadSleep(), loadWellnessRow()]);

  // Initialiser le sélecteur d'années complet (2010 → année courante)
  populateYearSelector();
  // Sélectionner l'année courante par défaut
  const defYearSel = el('filter-year');
  if (defYearSel && !defYearSel.value) {
    defYearSel.value = String(new Date().getFullYear());
  }
  renderAllActivities(_allActivities, 'all');
});
