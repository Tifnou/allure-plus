// ============================================================
// records.js — Records personnels editables + tableau de courses
// ============================================================

const RECORD_LABELS = { '1km': '1 km', '5km': '5 km', '10km': '10 km', semi: 'Semi', marathon: 'Marathon' };
const RECORD_DISTANCES_M = { '1km': 1000, '5km': 5000, '10km': 10000, semi: 21097.5, marathon: 42195 };
const RECORD_ORDER = ['1km', '5km', '10km', 'semi', 'marathon'];
// Meme tolerance que getPersonalRecords() (garmin_client.js) pour detecter
// qu'une course saisie correspond exactement a une distance de record.
const RECORD_TOLERANCE_M = {
  '1km':      { min: 900,   max: 1100 },
  '5km':      { min: 4500,  max: 5500 },
  '10km':     { min: 9000,  max: 11000 },
  semi:       { min: 19000, max: 22000 },
  marathon:   { min: 40000, max: 43500 },
};

let _recordsData = {};   // { '1km': {best, edited}, ... }
let _racesData = [];     // tableau de courses

function formatSpeed(secPerKm) {
  if (!secPerKm || secPerKm <= 0) return '—';
  return (3600 / secPerKm).toFixed(1) + ' km/h';
}

// "hh:mm:ss" ou "mm:ss" saisi -> secondes
function parseDurationInput(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':').map(s => parseInt(s, 10));
  if (parts.length === 0 || parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}
function secondsToDurationInput(sec) {
  if (!sec && sec !== 0) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Point d'entrée ────────────────────────────────────────────────────
async function initRecordsPage() {
  const container = el('records-list-full');
  if (container) container.innerHTML = '<div class="table-loading">Chargement…</div>';
  const wrap = el('races-table-wrap');
  if (wrap) wrap.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const [records, races] = await Promise.all([
      fetch('/api/records').then(r => r.json()),
      fetch('/api/races').then(r => r.json()),
    ]);
    _recordsData = records || {};
    _racesData = races || [];
    renderRecordsBandeau();
    renderRacesTable();
    checkForBetterComputedRecords();
  } catch (e) {
    if (container) container.innerHTML = '<div class="table-loading">Erreur de chargement.</div>';
    if (wrap) wrap.innerHTML = '';
  }
}

// ─── Bandeau des 5 records (editable) ───────────────────────────────────
function renderRecordsBandeau() {
  const container = el('records-list-full');
  if (!container) return;

  container.innerHTML = RECORD_ORDER.map(key => {
    const rec = _recordsData[key];
    const best = rec?.best;
    const editedBadge = rec?.edited
      ? `<span class="record-edited-badge" title="Valeur corrigée manuellement">modifié <button class="record-reset-link" onclick="resetRecord('${key}')" title="Revenir à la valeur Garmin">↺</button></span>`
      : '';

    if (!best) {
      return `
        <div class="record-item">
          <div class="record-left">
            <span class="record-distance">${RECORD_LABELS[key]}</span>
            <div><div class="record-name" style="color:var(--text-muted)">Pas encore de donnée</div></div>
          </div>
          <div class="record-right-group">
            <div class="record-right"><div class="record-time" style="color:var(--text-muted)">—</div></div>
            <button class="record-edit-btn" onclick="openRecordEditModal('${key}')" title="Saisir ce record">✎</button>
          </div>
        </div>`;
    }

    return `
      <div class="record-item">
        <div class="record-left">
          <span class="record-distance">${RECORD_LABELS[key]}</span>
          <div>
            <div class="record-name">${escapeHtml(best.name || RECORD_LABELS[key])} ${editedBadge}</div>
            <div class="record-date">${formatDate(best.date)}</div>
          </div>
        </div>
        <div class="record-right-group">
          <div class="record-right">
            <div class="record-time">${formatTime(best.duration)}</div>
            <div class="record-pace">${formatPace(best.pace)}</div>
          </div>
          <button class="record-edit-btn" onclick="openRecordEditModal('${key}')" title="Corriger ce record">✎</button>
        </div>
      </div>`;
  }).join('');
}

async function resetRecord(key) {
  const ok = await showConfirmModal({
    title: 'Réinitialiser ce record ?',
    message: 'La correction manuelle sera supprimée et la valeur recalculée depuis Garmin sera réaffichée.',
    confirmLabel: 'Réinitialiser',
    icon: '↺',
  });
  if (!ok) return;
  try {
    await fetch(`/api/records/${key}`, { method: 'DELETE' });
    _recordsData = await fetch('/api/records').then(r => r.json());
    renderRecordsBandeau();
    renderRacesTable();
    showToast('Record réinitialisé', 'success');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

function openRecordEditModal(key, prefill = null) {
  if (document.getElementById('record-edit-modal')) return;
  const current = prefill || _recordsData[key]?.best || {};
  const backdrop = document.createElement('div');
  backdrop.className = 'stats-modal-backdrop';
  backdrop.id = 'record-edit-modal';
  backdrop.innerHTML = `
    <div class="stats-modal" style="width:min(440px,94vw)" onclick="event.stopPropagation()">
      <div class="stats-modal-header">
        <h2>Corriger le record ${RECORD_LABELS[key]}</h2>
        <button class="stats-modal-close" id="record-modal-close-btn">&times;</button>
      </div>
      <div class="form-row">
        <span class="form-label">Nom de la performance</span>
        <input type="text" class="form-input" id="record-form-name" style="max-width:100%" placeholder="Ex : Marathon des Causses" />
      </div>
      <div class="form-row">
        <span class="form-label">Date</span>
        <input type="date" class="form-input" id="record-form-date" style="max-width:100%" />
      </div>
      <div class="form-row">
        <span class="form-label">Distance (m)</span>
        <input type="number" class="form-input" id="record-form-distance" style="max-width:100%" />
      </div>
      <div class="form-row">
        <span class="form-label">Chrono (hh:mm:ss ou mm:ss)</span>
        <input type="text" class="form-input" id="record-form-duration" style="max-width:100%" placeholder="Ex : 19:16" />
      </div>
      <div class="race-modal-actions">
        <button class="btn-wizard-back" id="record-modal-cancel">Annuler</button>
        <button class="btn-wizard-next" id="record-modal-save">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  el('record-form-name').value = current.name || '';
  el('record-form-date').value = current.date ? String(current.date).slice(0, 10) : '';
  el('record-form-distance').value = current.distance || RECORD_DISTANCES_M[key];
  el('record-form-duration').value = current.duration ? secondsToDurationInput(current.duration) : '';

  const close = () => backdrop.remove();
  attachBackdropClose(backdrop, close);
  document.getElementById('record-modal-close-btn').onclick = close;
  document.getElementById('record-modal-cancel').onclick = close;
  document.getElementById('record-modal-save').onclick = async () => {
    const name = el('record-form-name').value.trim();
    const date = el('record-form-date').value;
    const distanceM = parseFloat(el('record-form-distance').value);
    const durationSec = parseDurationInput(el('record-form-duration').value);
    if (!name || !date || !distanceM || !durationSec) {
      showToast('Merci de remplir tous les champs', 'error');
      return;
    }
    try {
      await fetch(`/api/records/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, date, distanceM, durationSec }),
      });
      _recordsData = await fetch('/api/records').then(r => r.json());
      renderRecordsBandeau();
      renderRacesTable(); // les badges trophee dependent des records
      showToast('Record mis à jour', 'success');
      close();
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  };
}

// showToast() ne fait pas confiance au HTML du message (textContent, pas
// innerHTML) - on construit donc un vrai bouton DOM pour la suggestion,
// plutot que d'essayer d'injecter un <button> dans un toast classique.
// showToast() ne fait pas confiance au HTML du message (textContent, pas
// innerHTML) - on construit donc un vrai bouton DOM plutot que d'essayer
// d'injecter un <button> dans un toast classique.
function showSuggestionBanner({ message, acceptLabel = 'Mettre à jour', onAccept, onResolve }) {
  document.getElementById('record-suggestion-banner')?.remove();
  const banner = document.createElement('div');
  banner.id = 'record-suggestion-banner';
  banner.className = 'record-suggestion-banner';

  const text = document.createElement('span');
  text.textContent = message;
  banner.appendChild(text);

  const updateBtn = document.createElement('button');
  updateBtn.className = 'toast-action-btn';
  updateBtn.textContent = acceptLabel;
  updateBtn.onclick = () => { banner.remove(); onAccept?.(); onResolve?.(true); };
  banner.appendChild(updateBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'record-suggestion-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => { banner.remove(); onResolve?.(false); };
  banner.appendChild(closeBtn);

  document.body.appendChild(banner);
  setTimeout(() => {
    if (document.body.contains(banner)) { banner.remove(); onResolve?.(false); }
  }, 15000);
}
function showRecordSuggestionBanner(matchKey, matchLabel, best) {
  showSuggestionBanner({
    message: `🏆 Cette course bat votre record du ${matchLabel} !`,
    acceptLabel: 'Mettre à jour',
    onAccept: () => openRecordEditModal(matchKey, best),
  });
}

// ─── Une activite Garmin recente bat-elle un record corrige manuellement ? ──
// Ne s'applique qu'aux records avec une correction manuelle (edited:true) :
// sans correction, le record est deja 100% automatique. Ne remplace jamais
// silencieusement - propose seulement, et retient un refus pour ne pas
// reproposer la meme activite en boucle a chaque visite de la page.
const RECORD_DISMISS_KEY = 'suivi_record_suggestion_dismissed';
function isCandidateDismissed(key, candidate) {
  try {
    const m = JSON.parse(localStorage.getItem(RECORD_DISMISS_KEY) || '{}');
    const d = m[key];
    return !!d && d.date === candidate.date && d.duration === candidate.duration;
  } catch (e) { return false; }
}
function dismissCandidate(key, candidate) {
  try {
    const m = JSON.parse(localStorage.getItem(RECORD_DISMISS_KEY) || '{}');
    m[key] = { date: candidate.date, duration: candidate.duration };
    localStorage.setItem(RECORD_DISMISS_KEY, JSON.stringify(m));
  } catch (e) { /* silencieux */ }
}

let _betterCandidateQueue = [];

function checkForBetterComputedRecords() {
  _betterCandidateQueue = RECORD_ORDER
    .filter(key => _recordsData[key]?.betterCandidate && !isCandidateDismissed(key, _recordsData[key].betterCandidate))
    .map(key => ({ key, label: RECORD_LABELS[key], candidate: _recordsData[key].betterCandidate }));
  showNextBetterCandidate();
}

function showNextBetterCandidate() {
  if (_betterCandidateQueue.length === 0) return;
  const { key, label, candidate } = _betterCandidateQueue[0];
  showSuggestionBanner({
    message: `🏃 Une activité récente bat votre record du ${label} corrigé manuellement (${formatTime(candidate.duration)} contre ${formatTime(_recordsData[key].best.duration)} actuellement) — l'adopter comme nouveau record ?`,
    acceptLabel: 'Adopter',
    onAccept: async () => {
      try {
        await fetch(`/api/records/${key}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: candidate.name, date: candidate.date, distanceM: candidate.distance, durationSec: candidate.duration }),
        });
        _recordsData = await fetch('/api/records').then(r => r.json());
        renderRecordsBandeau();
        showToast('Record mis à jour', 'success');
      } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
    },
    onResolve: (accepted) => {
      if (!accepted) dismissCandidate(key, candidate);
      _betterCandidateQueue.shift();
      showNextBetterCandidate();
    },
  });
}

// Distance exacte (tolerance identique au calcul Garmin) qui bat le record actuel
function checkExactRecordMatch(race) {
  const raceM = race.distanceKm * 1000;
  for (const key of RECORD_ORDER) {
    const { min, max } = RECORD_TOLERANCE_M[key];
    if (raceM >= min && raceM <= max) {
      const currentBest = _recordsData[key]?.best;
      if (!currentBest || race.durationSec < currentBest.duration) {
        return { key, label: RECORD_LABELS[key] };
      }
    }
  }
  return null;
}

// Estimation (allure constante) qu'une distance standard plus courte que la
// course a ete battue - seule methode possible sans donnees de split.
function computeRaceBadges(race) {
  const badges = [];
  const raceM = race.distanceKm * 1000;
  RECORD_ORDER.forEach(key => {
    const stdM = RECORD_DISTANCES_M[key];
    if (stdM >= raceM) return;
    const estimatedSec = race.durationSec * (stdM / raceM);
    const currentBest = _recordsData[key]?.best;
    if (!currentBest || estimatedSec < currentBest.duration) {
      badges.push({ key, label: RECORD_LABELS[key], estimatedSec, currentSec: currentBest ? currentBest.duration : null });
    }
  });
  return badges;
}

// ─── Tableau des courses (un cadre repliable par nom de course) ───────
const RACE_COLLAPSED_KEY = 'races_collapsed_groups';
let _collapsedRaceGroups = new Set();
try { _collapsedRaceGroups = new Set(JSON.parse(localStorage.getItem(RACE_COLLAPSED_KEY) || '[]')); }
catch (e) { _collapsedRaceGroups = new Set(); }

function saveCollapsedRaceGroups() {
  try { localStorage.setItem(RACE_COLLAPSED_KEY, JSON.stringify([..._collapsedRaceGroups])); }
  catch (e) { /* silencieux */ }
}

function groupRaces(races) {
  const groups = new Map();
  races.forEach(r => {
    const norm = (r.name || '').trim().toLowerCase();
    if (!groups.has(norm)) groups.set(norm, { key: norm, displayName: r.name, list: [] });
    groups.get(norm).list.push(r);
  });
  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'fr'));
  return groupKeys.map(k => {
    const g = groups.get(k);
    // Année la plus récente en premier au sein d'un même nom de course
    g.list.sort((a, b) => new Date(b.date) - new Date(a.date));
    // Une course abandonnée ne compte jamais comme meilleure performance
    let bestId = null, bestDur = Infinity;
    g.list.forEach(r => { if (!r.dnf && r.durationSec < bestDur) { bestDur = r.durationSec; bestId = r.id; } });
    g.list.forEach(r => { r._isBest = r.id === bestId; });
    g.bestDur = bestId ? bestDur : null;
    return g;
  });
}

function renderRacesTable() {
  const wrap = el('races-table-wrap');
  if (!wrap) return;
  if (!_racesData || _racesData.length === 0) {
    wrap.innerHTML = '<div class="table-loading">Aucune course enregistrée pour le moment — ajoutez votre première course avec le bouton ci-dessus.</div>';
    return;
  }
  const groups = groupRaces(_racesData);
  wrap.innerHTML = groups.map(renderRaceGroupCard).join('');

  wrap.querySelectorAll('.race-group-header').forEach(header => {
    header.addEventListener('click', () => toggleRaceGroup(header.dataset.group));
  });
}

function toggleRaceGroup(key) {
  if (_collapsedRaceGroups.has(key)) _collapsedRaceGroups.delete(key);
  else _collapsedRaceGroups.add(key);
  saveCollapsedRaceGroups();
  renderRacesTable();
}

function renderRaceGroupCard(g) {
  const collapsed = _collapsedRaceGroups.has(g.key);
  const editionsLabel = g.list.length + (g.list.length > 1 ? ' éditions' : ' édition');
  const bestLabel = g.bestDur != null ? `🏆 ${formatTime(g.bestDur)}` : '';
  const groupAttr = escapeHtml(g.key).replace(/"/g, '&quot;');
  return `
    <div class="race-group-card">
      <div class="race-group-header" data-group="${groupAttr}">
        <span class="race-group-chevron${collapsed ? '' : ' race-group-chevron--open'}">&#x25BC;</span>
        <span class="race-group-name">${escapeHtml(g.displayName)}</span>
        <span class="race-group-count">${editionsLabel}</span>
        <span class="race-group-best">${bestLabel}</span>
      </div>
      <div class="race-group-body" style="display:${collapsed ? 'none' : ''}">
        <div class="races-table-scroll">
          <table class="races-table">
            <thead>
              <tr>
                <th>Type</th><th>Date</th><th>Distance</th><th>Chrono</th>
                <th>Allure</th><th>Vitesse</th><th>D+</th><th>VO₂max</th><th></th><th></th><th></th>
              </tr>
            </thead>
            <tbody>${g.list.map(renderRaceRow).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderRaceRow(r) {
  const paceSecPerKm = r.distanceKm > 0 ? r.durationSec / r.distanceKm : null;
  // Une course abandonnée ne peut pas servir d'estimation de record (temps non representatif)
  const badges = r.dnf ? [] : computeRaceBadges(r);
  const trophyHtml = badges.length
    ? `<span class="race-trophy" title="${escapeHtml(badges.map(b =>
        `🏆 Estimation : votre allure pendant cette course aurait battu votre record du ${b.label} (${b.currentSec ? formatTime(b.currentSec) : '—'} → ~${formatTime(Math.round(b.estimatedSec))} estimé)`
      ).join(' | '))}">🏆</span>`
    : '';
  const dnfHtml = r.dnf ? `<span class="race-dnf-badge" title="Course non terminée">Abandon</span>` : '';
  const certHtml = r.certificateFile
    ? `<a href="/uploads/${encodeURIComponent(r.certificateFile)}" target="_blank" rel="noopener" class="race-cert-link" title="Voir le diplôme">📄</a>`
    : `<span class="race-cert-empty">—</span>`;

  let activityHtml;
  if (r.activityId) {
    // Ouvre le detail de l'activite dans Allure+ (page Activites), pas Garmin
    // Connect — cf. openActivityFromId (app.js). L'annee de la course est
    // transmise pour que la fonction puisse charger cette annee a la demande
    // si l'activite n'est pas deja dans le cache local (_allActivities).
    const raceYear = new Date(r.date).getFullYear();
    activityHtml = `<button type="button" class="race-cert-link" onclick="openActivityFromId('${r.activityId}', ${raceYear})" title="Voir l'activité dans Allure+">🏃</button>`;
  } else {
    const suggestion = findLikelyActivityMatch(r);
    const raceYear = new Date(r.date).getFullYear();
    if (suggestion) {
      activityHtml = `<button type="button" class="race-cert-link race-link-suggest" onclick="linkRaceToActivity('${r.id}','${suggestion.id}')" title="Lier à l'activité Garmin du ${formatDateShort(suggestion.date, true)} (${suggestion.distanceKm.toFixed(2)} km) ?">🔗</button>`;
    } else if (!_fullyLoadedYears.has(raceYear)) {
      // Annee pas encore chargee dans _allActivities : proposer de la
      // chercher directement, sans avoir a passer par Activites.
      activityHtml = `<button type="button" class="race-cert-link race-link-suggest" onclick="searchActivityForRace('${r.id}')" title="Chercher l'activité Garmin correspondante (${raceYear})">🔍</button>`;
    } else {
      activityHtml = `<span class="race-cert-empty">—</span>`;
    }
  }

  return `
    <tr class="races-row${r._isBest ? ' race-row--best' : ''}${r.dnf ? ' races-row--dnf' : ''}">
      <td>${r.type === 'trail' ? '⛰️ Trail' : '🏃 Route'}${dnfHtml}</td>
      <td>${formatDateShort(r.date, true)}</td>
      <td>${r.distanceKm.toFixed(2)} km</td>
      <td class="races-mono">${formatTime(r.durationSec)} ${trophyHtml}</td>
      <td class="races-mono">${formatPace(paceSecPerKm)}</td>
      <td class="races-mono">${formatSpeed(paceSecPerKm)}</td>
      <td>${r.elevationGain != null ? r.elevationGain + ' m' : '—'}</td>
      <td>${r.vo2max != null ? r.vo2max : '—'}</td>
      <td>${certHtml}</td>
      <td>${activityHtml}</td>
      <td class="races-actions">
        <button class="race-action-btn" onclick="editRace('${r.id}')" title="Modifier">✎</button>
        <button class="race-action-btn" onclick="deleteRace('${r.id}')" title="Supprimer">🗑</button>
      </td>
    </tr>`;
}

function editRace(id) {
  const race = _racesData.find(r => r.id === id);
  if (race) openRaceModal(race);
}

async function deleteRace(id) {
  const race = _racesData.find(r => r.id === id);
  const ok = await showConfirmModal({
    title: 'Supprimer cette course ?',
    message: `« ${escapeHtml(race?.name || '')} » sera définitivement supprimée${race?.certificateFile ? ', ainsi que son diplôme' : ''}.`,
    confirmLabel: 'Supprimer',
    danger: true,
    icon: '🗑',
  });
  if (!ok) return;
  try {
    await fetch(`/api/races/${id}`, { method: 'DELETE' });
    _racesData = _racesData.filter(r => r.id !== id);
    renderRacesTable();
    showToast('Course supprimée', 'success');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ─── Lien vers l'activité Garmin d'origine ────────────────────────────
// Pour une course saisie manuellement (pas de activityId), on propose une
// correspondance par date (meme jour ± 1, pour absorber un decalage de
// fuseau horaire) et distance approchante (±15%, min 300 m) plutot que de
// lier automatiquement — jamais de lien silencieux, l'utilisateur confirme
// via linkRaceToActivity (bouton "🔗" dans le tableau).
function findLikelyActivityMatch(race) {
  if (!race.distanceKm || !race.date || typeof isRaceEligibleActivity !== 'function') return null;
  const raceTime = new Date(race.date).getTime();
  const ONE_DAY = 24 * 3600 * 1000;
  const tolerance = Math.max(0.3, race.distanceKm * 0.15);
  let best = null, bestScore = Infinity;
  (_allActivities || []).forEach(a => {
    if (!isRaceEligibleActivity(a)) return;
    const dateDiff = Math.abs(new Date(a.date).getTime() - raceTime);
    if (dateDiff > ONE_DAY) return;
    const distDiff = Math.abs(a.distanceKm - race.distanceKm);
    if (distDiff > tolerance) return;
    const score = dateDiff / ONE_DAY + distDiff / race.distanceKm;
    if (score < bestScore) { bestScore = score; best = a; }
  });
  return best;
}

async function linkRaceToActivity(raceId, activityId) {
  const race = _racesData.find(r => r.id === raceId);
  const activity = (_allActivities || []).find(a => String(a.id) === String(activityId));
  if (!race || !activity) return;
  const ok = await showConfirmModal({
    title: 'Lier cette course ?',
    message: `« ${escapeHtml(race.name)} » sera liée à l'activité Garmin « ${escapeHtml(activity.name || '')} » du ${formatDate(activity.date)} (${activity.distanceKm.toFixed(2)} km).`,
    confirmLabel: 'Lier',
    icon: '🔗',
  });
  if (!ok) return;
  try {
    const res = await fetch(`/api/races/${raceId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...race, activityId: activity.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    _racesData = await fetch('/api/races').then(r => r.json());
    renderRacesTable();
    showToast('Course liée à l\'activité Garmin', 'success');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// findLikelyActivityMatch ne cherche que dans _allActivities, qui n'est
// peuplé au démarrage qu'avec les ~200 activités les plus récentes
// (loadDashboard, app.js) — une course plus ancienne n'a donc aucune chance
// d'y trouver de correspondance tant que son année n'a pas été chargée
// explicitement (jusqu'ici, uniquement possible via le filtre année de la
// page Activités, ce qui obligeait a jongler entre les deux pages). Ce
// bouton "🔍" déclenche ce chargement directement depuis Records et
// courses, comme le fait déjà openActivityFromId (app.js) pour un lien
// déjà confirmé.
async function searchActivityForRace(raceId) {
  const race = _racesData.find(r => r.id === raceId);
  if (!race) return;
  const year = new Date(race.date).getFullYear();
  showToast(`Recherche dans les activités ${year}…`, 'loading', 0);
  try {
    const resp = await fetch('/api/activities/year/' + year);
    if (resp.ok) {
      const data = await resp.json();
      if (data.activities && data.activities.length) {
        _allActivities = _allActivities.filter(a => {
          const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
          return isNaN(d) || d.getFullYear() !== year;
        }).concat(data.activities);
      }
      _fullyLoadedYears.add(year);
    } else {
      showToast('Erreur serveur lors du chargement de ' + year, 'error');
    }
  } catch (e) {
    showToast('Erreur réseau : ' + e.message, 'error');
  }
  const lt = document.getElementById('app-toast-loading');
  if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
  renderRacesTable();
  if (!findLikelyActivityMatch(race)) {
    showToast(`Aucune activité correspondante trouvée pour ${year}`, 'info');
  }
}

// ─── Ajout / édition d'une course ────────────────────────────────────
function suggestVo2MaxForDate(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  const THREE_DAYS = 3 * 24 * 3600 * 1000;
  let best = null, bestDiff = Infinity;
  (_allActivities || []).forEach(a => {
    if (a.vO2MaxValue == null) return;
    const diff = Math.abs(new Date(a.date).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = a.vO2MaxValue; }
  });
  if (best != null && bestDiff <= THREE_DAYS) return best;
  let bestSeries = null, bestSeriesDiff = Infinity;
  (_vo2maxSeries || []).forEach(p => {
    const diff = Math.abs(new Date(p.date).getTime() - target);
    if (diff < bestSeriesDiff) { bestSeriesDiff = diff; bestSeries = p.value; }
  });
  if (bestSeries != null && bestSeriesDiff <= THREE_DAYS) return bestSeries;
  return null;
}

function setRaceTypeToggle(type) {
  const modal = document.getElementById('race-edit-modal');
  if (!modal) return;
  modal.dataset.type = type;
  document.getElementById('race-type-route').classList.toggle('active', type !== 'trail');
  document.getElementById('race-type-trail').classList.toggle('active', type === 'trail');
}

function openRaceModal(existingRace = null, prefill = null) {
  if (document.getElementById('race-edit-modal')) return;
  const isEdit = !!existingRace;
  const initialData = existingRace || prefill;
  const backdrop = document.createElement('div');
  backdrop.className = 'stats-modal-backdrop';
  backdrop.id = 'race-edit-modal';
  backdrop.innerHTML = `
    <div class="stats-modal" style="width:min(560px,94vw)" onclick="event.stopPropagation()">
      <div class="stats-modal-header">
        <h2>${isEdit ? 'Modifier la course' : 'Ajouter une course'}</h2>
        <button class="stats-modal-close" id="race-modal-close-btn">&times;</button>
      </div>
      <div class="form-row">
        <span class="form-label">Nom de la course</span>
        <input type="text" class="form-input" id="race-form-name" style="max-width:100%" placeholder="Ex : Paris-Versailles" />
      </div>
      <div class="form-row">
        <span class="form-label">Type</span>
        <div class="type-toggle">
          <button type="button" class="type-toggle-btn active" id="race-type-route">🏃 Route</button>
          <button type="button" class="type-toggle-btn" id="race-type-trail">⛰️ Trail</button>
        </div>
      </div>
      <label class="form-row" style="flex-direction:row;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="race-form-dnf" style="width:16px;height:16px;margin:0" />
        <span class="form-label" style="margin:0">Abandon (course non terminée)</span>
      </label>
      <div class="race-form-grid">
        <div class="form-row">
          <span class="form-label">Date</span>
          <input type="date" class="form-input" id="race-form-date" style="max-width:100%" />
        </div>
        <div class="form-row">
          <span class="form-label">Distance (km)</span>
          <input type="number" step="0.01" class="form-input" id="race-form-distance" style="max-width:100%" />
        </div>
        <div class="form-row">
          <span class="form-label">Chrono (hh:mm:ss)</span>
          <input type="text" class="form-input" id="race-form-duration" style="max-width:100%" placeholder="Ex : 1:40:37" />
        </div>
        <div class="form-row">
          <span class="form-label">D+ (m, optionnel)</span>
          <input type="number" class="form-input" id="race-form-elevation" style="max-width:100%" />
        </div>
        <div class="form-row">
          <span class="form-label">VO₂max (optionnel)</span>
          <input type="number" step="0.1" class="form-input" id="race-form-vo2max" style="max-width:100%" />
        </div>
        <div class="form-row">
          <span class="form-label">Diplôme (PDF/JPG/PNG)</span>
          <input type="file" class="form-input" id="race-form-certificate" style="max-width:100%" accept=".pdf,.jpg,.jpeg,.png" />
        </div>
      </div>
      <div class="race-form-computed">
        <span>Allure : <strong id="race-form-pace">—</strong></span>
        <span>Vitesse : <strong id="race-form-speed">—</strong></span>
      </div>
      <div class="race-modal-actions">
        <button class="btn-wizard-back" id="race-modal-cancel">Annuler</button>
        <button class="btn-wizard-next" id="race-modal-save">${isEdit ? 'Enregistrer' : 'Ajouter'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  if (initialData) {
    el('race-form-name').value = initialData.name || '';
    el('race-form-date').value = (initialData.date || '').slice(0, 10);
    el('race-form-distance').value = initialData.distanceKm ?? '';
    el('race-form-duration').value = secondsToDurationInput(initialData.durationSec);
    el('race-form-elevation').value = initialData.elevationGain ?? '';
    el('race-form-vo2max').value = initialData.vo2max ?? '';
    el('race-form-dnf').checked = !!initialData.dnf;
    setRaceTypeToggle(initialData.type || 'route');
  } else {
    setRaceTypeToggle('route');
  }

  document.getElementById('race-type-route').onclick = () => setRaceTypeToggle('route');
  document.getElementById('race-type-trail').onclick = () => setRaceTypeToggle('trail');

  const updateComputed = () => {
    const distanceKm = parseFloat(el('race-form-distance').value);
    const durationSec = parseDurationInput(el('race-form-duration').value);
    if (distanceKm > 0 && durationSec > 0) {
      const paceSecPerKm = durationSec / distanceKm;
      el('race-form-pace').textContent = formatPace(paceSecPerKm);
      el('race-form-speed').textContent = formatSpeed(paceSecPerKm);
    } else {
      el('race-form-pace').textContent = '—';
      el('race-form-speed').textContent = '—';
    }
  };
  el('race-form-distance').addEventListener('input', updateComputed);
  el('race-form-duration').addEventListener('input', updateComputed);
  updateComputed();

  el('race-form-date').addEventListener('change', () => {
    if (el('race-form-vo2max').value) return; // ne pas ecraser une saisie manuelle
    const suggestion = suggestVo2MaxForDate(el('race-form-date').value);
    if (suggestion != null) el('race-form-vo2max').value = suggestion;
  });

  const close = () => backdrop.remove();
  attachBackdropClose(backdrop, close);
  document.getElementById('race-modal-close-btn').onclick = close;
  document.getElementById('race-modal-cancel').onclick = close;
  document.getElementById('race-modal-save').onclick = async () => {
    const name = el('race-form-name').value.trim();
    const type = backdrop.dataset.type || 'route';
    const date = el('race-form-date').value;
    const distanceKm = parseFloat(el('race-form-distance').value);
    const durationSec = parseDurationInput(el('race-form-duration').value);
    const elevationRaw = el('race-form-elevation').value;
    const vo2maxRaw = el('race-form-vo2max').value;
    if (!name || !date || !distanceKm || !durationSec) {
      showToast('Merci de remplir au moins Nom, Date, Distance et Chrono', 'error');
      return;
    }
    const dnf = el('race-form-dnf').checked;
    const payload = {
      name, type, date, distanceKm, durationSec,
      elevationGain: elevationRaw ? parseFloat(elevationRaw) : null,
      vo2max: vo2maxRaw ? parseFloat(vo2maxRaw) : null,
      dnf,
      // Present si la course vient de "Envoyer vers Courses" (Activites) ou
      // si elle a deja ete liee via linkRaceToActivity — jamais modifiable
      // depuis ce formulaire, donc simplement propage tel quel.
      activityId: initialData?.activityId || null,
    };
    try {
      const res = await fetch(isEdit ? `/api/races/${existingRace.id}` : '/api/races', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      const savedRace = data.race;

      const certFile = el('race-form-certificate').files[0];
      if (certFile) {
        const fd = new FormData();
        fd.append('certificate', certFile);
        await fetch(`/api/races/${savedRace.id}/certificate`, { method: 'POST', body: fd }).catch(() => {});
      }

      _racesData = await fetch('/api/races').then(r => r.json());
      renderRacesTable();
      showToast(isEdit ? 'Course modifiée' : 'Course ajoutée', 'success');
      close();

      // Suggestion (jamais automatique) si la distance correspond exactement a un record et le bat
      // — jamais pour une course abandonnee, le chrono n'est pas representatif
      const match = savedRace.dnf ? null : checkExactRecordMatch(savedRace);
      if (match) {
        showRecordSuggestionBanner(match.key, match.label, {
          name: savedRace.name, date: savedRace.date, duration: savedRace.durationSec, distance: Math.round(savedRace.distanceKm * 1000),
        });
      }
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  };
}

// ─── Export / import ──────────────────────────────────────────────────
async function exportRecordsData() {
  try {
    const res = await fetch('/api/records-export');
    if (!res.ok) throw new Error('Export impossible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'allure-plus-records.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Export téléchargé', 'success');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

async function importRecordsData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';
  try {
    const text = await file.text();
    if (text.trimStart().startsWith('<')) {
      showToast('Fichier invalide.', 'error');
      return;
    }
    let data;
    try { data = JSON.parse(text); }
    catch (e) { showToast('JSON invalide : ' + e.message, 'error'); return; }
    if (typeof data.records_overrides !== 'object' || data.records_overrides === null || !Array.isArray(data.races)) {
      showToast('Structure invalide (records_overrides ou races manquant).', 'error');
      return;
    }
    const ok = await showConfirmModal({
      title: 'Importer ces données ?',
      message: `Cela remplacera <strong>toutes</strong> vos corrections de records et vos ${_racesData.length} course(s) actuellement enregistrées par les ${data.races.length} course(s) du fichier importé, de façon irréversible.`,
      confirmLabel: 'Importer et remplacer',
      danger: true,
      icon: '⬆',
    });
    if (!ok) return;
    const res = await fetch('/api/records-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records_overrides: data.records_overrides, races: data.races }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Erreur import');
    showToast('Import réussi', 'success');
    initRecordsPage();
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}
