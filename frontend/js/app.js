// app.js

// Variables globales module
let _avgRestingHR = 0;  // FC repos moyenne (calculée depuis les données HR)
let _lastFilteredActivities = [];  // Dernier jeu filtre de la page Activites (globe.js)

// ═══════════════════════════════════════════════════════
// Fermeture d'une modale au clic sur le fond (backdrop)
// ═══════════════════════════════════════════════════════
// Ne ferme que si le clic a A LA FOIS demarre (mousedown) ET fini (click)
// sur le fond lui-meme. Sans ce garde-fou, selectionner du texte dans un
// champ de la modale (mousedown sur le champ) puis relacher la souris en
// dehors du cadre (sur le fond) declenche quand meme un evenement "click"
// sur le fond - car le navigateur cible le plus proche ancetre commun des
// cibles mousedown/mouseup, qui est le fond lui-meme - fermant la modale
// a tort en pleine saisie.
function attachBackdropClose(backdrop, onClose) {
  let downOnBackdrop = false;
  backdrop.addEventListener('mousedown', e => { downOnBackdrop = (e.target === backdrop); });
  backdrop.addEventListener('click', e => {
    if (downOnBackdrop && e.target === backdrop) onClose(e);
    downOnBackdrop = false;
  });
}

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
    attachBackdropClose(bd, () => close(false));
  });
}

/* ═══════════════════════════════════════════════
   SUIVI SPORT — App JS
   Navigation, fetch API, graphiques Chart.js
═══════════════════════════════════════════════ */
const API = '';

// ─── Sauvegarde durable (serveur) de donnees auparavant en localStorage
// seul ─────────────────────────────────────────────────────────────────
// Vecu reel : un nettoyage de l'historique de navigation a fait perdre le
// profil (sexe/date de naissance/taille/poids) ET les objectifs personnels
// d'une utilisatrice, sans aucun autre endroit ou les retrouver — a la
// difference des activites Garmin (re-telechargeables depuis Garmin,
// jamais perdues). localStorage.setItem est patche ci-dessous : toute
// ecriture sur une des cles "durables" est mireoiree vers /api/user-data
// (server.js, fichier data/user_data.json — protege comme les autres
// fichiers de data/, jamais ecrase par l'installeur) EN PLUS du
// localStorage habituel. Aucun des dizaines d'appels localStorage.setItem
// existants (campus.js, plans.js, records.js...) n'a besoin d'etre
// modifie : ils continuent de lire/ecrire localStorage tel quel, la
// synchronisation est transparente. syncUserDataFromServer() ne fait que
// COMBLER les cles manquantes au demarrage (jamais ecraser une valeur deja
// presente en local) — protege contre un revert vers une copie serveur
// perimee si un push precedent avait echoue (coupure reseau ponctuelle).
// support_tickets_seen/support_admin_seen (support.js) inclus : purement
// locaux jusqu'ici, un nettoyage du navigateur les faisait disparaitre et
// rallumait a tort le point rouge sur TOUS les tickets deja lus (constat
// utilisateur : la notification "reste" parfois sans raison apparente) -
// meme categorie de bug que le profil/plan importe avant leur ajout ici.
const DURABLE_LS_KEYS = ['suivi_sport_profile', 'suivi_personal_goals', 'suivi_imported_plan', 'suivi_local_done', 'suivi_session_mood', 'prefer_imported_plan', 'suivi_forced_goal_pace', 'suivi_free_sessions', 'support_tickets_seen', 'support_admin_seen'];
const DURABLE_LS_PREFIXES = ['suivi_objectif_dist_', 'suivi_objectif_dplus_', 'suivi_objectif_validated_', 'suivi_objectif_startvo2_'];
// Promesse de syncUserDataFromServer() exposee globalement (scope partage
// entre scripts) - campus.js l'attend avant toute decision basee sur
// localStorage, voir initCampus() dans campus.js.
let _userDataSyncPromise = null;
function isDurableLsKey(key) {
  return DURABLE_LS_KEYS.includes(key) || DURABLE_LS_PREFIXES.some(p => key.startsWith(p));
}
// nativeSetItem expose au-dela de l'IIFE : syncUserDataFromServer() (plus
// bas) doit pouvoir ecrire une valeur reçue DU serveur sans redeclencher un
// POST vers /api/user-data (echo inutile, et ça re-daterait a tort le
// sidecar de sync.js comme si CETTE machine venait de produire la valeur).
let _nativeLsSetItem = null;
(function patchLocalStorageForServerSync() {
  _nativeLsSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(key, value) {
    _nativeLsSetItem(key, value);
    if (isDurableLsKey(key)) {
      fetch(`${API}/api/user-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      }).catch(e => console.error('sync user-data (' + key + '):', e));
    }
  };
})();
// Cle purement locale (pas une DURABLE_LS_KEYS, jamais synchronisee) qui
// retient, par cle durable, l'horodatage serveur (meta.updatedAt) DEJA
// applique sur CET appareil — sans elle, syncUserDataFromServer() ne peut
// que "combler les cles manquantes" et ignore pour toujours une mise a jour
// faite depuis un autre appareil des qu'une valeur existe deja en local,
// meme perimee. Bug reel constate (compte de l'epouse, PC du bureau) :
// seances pointees "faites" et ressenti saisis sur son PC perso jamais
// repercutes sur le PC du bureau, qui avait deja sa propre valeur (souvent
// vide) pour suivi_local_done/suivi_session_mood. Purgee au logout comme le
// reste (localStorage.clear(), voir logout()) : une reconnexion repart d'un
// catch-up complet, jamais d'un etat perime d'un compte precedent.
const DURABLE_SYNC_APPLIED_KEY = '_durable_sync_applied_meta';
function readAppliedSyncMeta() {
  try { return JSON.parse(localStorage.getItem(DURABLE_SYNC_APPLIED_KEY) || '{}'); } catch (e) { return {}; }
}
async function syncUserDataFromServer() {
  try {
    const res = await fetch(`${API}/api/user-data`);
    if (!res.ok) return;
    const { data: serverData, meta: serverMeta } = await res.json();
    // Serveur -> local : adopte une valeur serveur si elle est soit absente
    // en local, soit plus recente (meta.updatedAt) que la derniere version
    // serveur deja appliquee sur CET appareil — jamais si le local est deja
    // a jour ou plus recent (protege toujours contre un revert vers une
    // copie serveur perimee, ex: coupure reseau ponctuelle lors d'un push).
    const applied = readAppliedSyncMeta();
    let appliedChanged = false;
    Object.entries(serverData || {}).forEach(([key, value]) => {
      if (!isDurableLsKey(key)) return;
      const serverTs = serverMeta && serverMeta[key];
      const localMissing = localStorage.getItem(key) == null;
      const serverIsNewer = serverTs && (!applied[key] || serverTs > applied[key]);
      if (localMissing || serverIsNewer) {
        _nativeLsSetItem(key, value);
        if (serverTs) { applied[key] = serverTs; appliedChanged = true; }
      }
    });
    if (appliedChanged) _nativeLsSetItem(DURABLE_SYNC_APPLIED_KEY, JSON.stringify(applied));
    // Local -> serveur : sauvegarde tout de suite les cles deja presentes en
    // local mais absentes du serveur (typiquement la toute premiere
    // synchro apres l'ajout de ce mecanisme) — sans attendre une prochaine
    // ecriture qui pourrait ne jamais survenir avant un nettoyage.
    const toPush = {};
    Object.keys(localStorage).forEach(key => {
      if (isDurableLsKey(key) && !(key in (serverData || {}))) toPush[key] = localStorage.getItem(key);
    });
    if (Object.keys(toPush).length) {
      fetch(`${API}/api/user-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPush),
      }).catch(e => console.error('sync user-data (backfill):', e));
    }
  } catch (e) { console.error('syncUserDataFromServer:', e); }
}

// ─── Helpers ───────────────────────────────────
function el(id) { return document.getElementById(id); }
function setVal(id, val) { const e = el(id); if (e) e.textContent = val; }

function formatDuration(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
  return `${date} à ${time}`;
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
let _activitiesYearDefaulted = false; // évite d'écraser "Toutes les années" (valeur vide) en revenant sur la page


// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════


function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = el(`page-${pageId}`);
  if (page) { page.classList.add('active'); }

  const navItem = el(`nav-${pageId}`);
  if (navItem) navItem.classList.add('active');

  if (pageId === 'activities') {
    const actYear = el('filter-year');
    const curYear = new Date().getFullYear();
    // Reconstruire le sélecteur si nécessaire (première visite)
    if (!actYear || actYear.options.length <= 1) {
      populateYearSelector();
    }
    // Définir l'année courante par défaut seulement lors de la toute première
    // visite — sinon un retour depuis le détail d'une activité écraserait le
    // choix "Toutes les années" (valeur vide, donc faussement "non défini")
    if (actYear && !actYear.value && !_activitiesYearDefaulted) {
      actYear.value = String(curYear);
    }
    _activitiesYearDefaulted = true;
    // Conserver le(s) filtre(s) sport actif(s) plutôt que de les réinitialiser sur "Tout"
    renderAllActivities(_allActivities, getActiveSportFilters(el('activity-filters')));
  }
  if (pageId === 'records')    { if (typeof initRecordsPage === 'function') initRecordsPage(); }
  if (pageId === 'health')     renderHealthPage();
  if (pageId === 'stats')      renderStatsPage();
  if (pageId === 'profile')    renderProfile();
  if (pageId === 'admin')      { loadAdminInfo(); loadAdminLogs(); loadAdminUsers(); }
  if (pageId === 'support-admin' && typeof loadSupportAdminPage === 'function') loadSupportAdminPage();
  if (pageId === 'goals')      { if (typeof loadGoalsPage === 'function') loadGoalsPage(); }
  if (pageId === 'routes')     { if (typeof initRoutesPage === 'function') initRoutesPage(); }
  if (pageId === 'route-editor') { if (typeof initRouteEditorPage === 'function') initRouteEditorPage(); }
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
  const bar  = el('server-status-bar');
  const overlay = el('server-down-overlay');

  // Plus de libellé texte visible (ligne condensée, voir CLAUDE.md) — le
  // statut détaillé reste accessible via le tooltip (title) du voyant.
  function setLed(state, label) {
    if (led) { led.className = 'server-led ' + state; }
    if (bar) { bar.title = label; }
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

    // Bouton deconnexion dans la sidebar - compte connecte visible
    // uniquement au survol (title), plus en texte permanent (voir
    // .sidebar-quit-row, index.html).
    const logoutBtn = el('btn-logout');
    if (logoutBtn) {
      logoutBtn.style.display = 'flex';
      if (data.user) logoutBtn.title = `Connecté : ${data.user} — changer de compte`;
    }
    if (data.user) { _currentUserEmail = data.user; }

    // Icône du centre de support : masquée si l'admin a retiré l'accès pour
    // ce compte (voir tableau Utilisateurs, page Admin) - visible par défaut
    // (data.ticketAccess absent ou true).
    const supportFab = el('support-fab');
    if (supportFab) supportFab.style.display = data.ticketAccess === false ? 'none' : '';

    if (typeof checkSupportNotifications === 'function') checkSupportNotifications();

    // Afficher menu Admin si compte administrateur
    showAdminNav(data.user);

    // Tampon "Pref 2" (case a cocher reservee a un compte, dans Mes informations)
    loadPref2State();

    // Badge profil : profil incomplet OU pesée à jour manquante (cloche)
    updateProfileBadge();

    // Numéro de version de l'appli
    const versionEl = el('app-version');
    if (versionEl && data.version) versionEl.textContent = 'v' + data.version;

    checkForUpdate();

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
  // Purge totale (pas une liste de cles a enumerer) : un changement de compte
  // sur ce meme navigateur ne doit jamais repousser les anciennes valeurs
  // (profil, plan, objectifs...) du compte precedent vers le nouveau via le
  // mecanisme de synchro localStorage -> /api/user-data (voir app.js,
  // syncUserDataFromServer/DURABLE_LS_KEYS). Sans danger : tout ce qui compte
  // redescend du serveur au prochain login.
  // Exception explicite : le theme clair/sombre est une preference
  // d'affichage pure (aucune donnee personnelle, aucun risque de fuite entre
  // comptes) - conservee a travers la deconnexion pour ne pas repartir en
  // theme clair a chaque reconnexion sur ce meme appareil (retour
  // utilisateur 14/08 : "le theme n'est pas garde, du moins pas tout le
  // temps" - c'etait ce clear() total qui l'effacait a chaque logout).
  const savedTheme = localStorage.getItem('allure_theme');
  try { localStorage.clear(); } catch (e) {}
  if (savedTheme) { try { localStorage.setItem('allure_theme', savedTheme); } catch (e) {} }
  window.location.href = '/login';
}

// ═══════════════════════════════════════════════
// MISE À JOUR (GitHub Releases)
// ═══════════════════════════════════════════════

let _updateInfo = null;

// Version dont la modale plein ecran a deja ete montree sur cet appareil -
// purement locale (pas une cle "durable" DURABLE_LS_KEYS/PREFIXES, aucune
// raison de la synchroniser entre appareils). Permet de ne montrer la
// modale qu'une fois par version : "plus tard" comme "telecharger" la
// marquent vue, elle ne revient donc pas le lendemain tant qu'aucune
// version plus recente n'est publiee (le badge pulsant, lui, reste affiche
// sans condition tant que la maj n'est pas faite - inchange).
const UPDATE_PROMPT_SEEN_KEY = 'allure_update_prompt_seen_version';

async function checkForUpdate() {
  try {
    const res = await fetch(`${API}/api/check-update`);
    const data = await res.json();
    _updateInfo = data;
    const badge = el('app-update-badge');
    if (badge) badge.style.display = data.updateAvailable ? 'inline-flex' : 'none';

    if (data.updateAvailable && localStorage.getItem(UPDATE_PROMPT_SEEN_KEY) !== data.latestVersion) {
      localStorage.setItem(UPDATE_PROMPT_SEEN_KEY, data.latestVersion);
      showUpdateModal();
    }
  } catch (e) { /* silencieux — ne doit jamais bloquer le chargement de l'app */ }
}

// ═══════════════════════════════════════════════
// SYNCHRO CROSS-APPAREILS (voir sync.js/server.js)
// ═══════════════════════════════════════════════
async function checkSyncStatus() {
  const bar = el('sync-status-bar');
  const led = el('sync-led');
  const txt = el('sync-status-text');
  if (!bar) return;
  try {
    const res = await fetch(`${API}/api/sync/status`);
    if (!res.ok) { bar.style.display = 'none'; return; }
    const data = await res.json();
    // Masque totalement le voyant si la synchro n'est pas configuree
    // (SYNC_RELAY_URL absent du .env) - inutile d'afficher un indicateur
    // pour une fonctionnalite que cette installation n'utilise pas.
    if (!data.configured) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    if (data.lastSyncAt == null) {
      led.className = 'sync-led led-loading';
      txt.textContent = '';
      bar.title = 'Synchro en cours…';
    } else if (data.lastSyncOk) {
      led.className = 'sync-led led-ok';
      // Libelle complet en tooltip (ligne condensee) - seule l'heure reste
      // affichee en permanence (demande explicite, pour garder un repere
      // rapide sans avoir a survoler).
      const when = new Date(data.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      txt.textContent = when;
      bar.title = `Synchronisé à ${when}`;
    } else {
      led.className = 'sync-led led-ko';
      txt.textContent = '';
      bar.title = 'Erreur de synchro';
    }
  } catch (e) { bar.style.display = 'none'; }
}

// Conversion minimale du markdown des release notes GitHub (##, listes, paragraphes)
// en HTML — echape le texte pour eviter toute injection depuis le contenu distant.
function renderChangelogHtml(md) {
  if (!md) return '';
  const escapeHtml = (str) => { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; };
  // **gras** -> <strong> — applique sur le texte deja echappe (** n'a aucun sens HTML, sans risque)
  const inline = (str) => escapeHtml(str).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  let html = '';
  let inList = false;
  md.split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) { if (inList) { html += '</ul>'; inList = false; } return; }
    if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<div class="update-modal-section-title">${inline(line.slice(3))}</div>`;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html += '<ul class="update-modal-list">'; inList = true; }
      html += `<li>${inline(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(line)}</p>`;
    }
  });
  if (inList) html += '</ul>';
  return html;
}

// Mise a jour en 3 etapes (20/08) : jusqu'ici "Telecharger" declenchait un
// <a download> classique vers l'asset GitHub - invisible dans cette fenetre
// --app= sans barre de telechargement, et sans suite (l'utilisateur devait
// retrouver puis lancer le .exe lui-meme). Allure+ a son propre serveur
// local : le telechargement se fait desormais cote serveur (voir
// /api/update/download*, server.js), suivi ici via polling pour une vraie
// barre de progression, puis "Installer maintenant" lance directement
// l'installeur telecharge (/api/update/install).
let _updatePollTimer = null;

function showUpdateModal() {
  if (!_updateInfo || !_updateInfo.updateAvailable) return;
  const bd = document.createElement('div');
  bd.className = 'confirm-modal-backdrop';
  bd.innerHTML = `<div class="confirm-modal update-modal" id="upd-modal-body"></div>`;
  document.body.appendChild(bd);
  const close = () => { if (_updatePollTimer) clearInterval(_updatePollTimer); bd.remove(); };
  attachBackdropClose(bd, close);
  renderUpdateStepChangelog(bd, close);
}

function renderUpdateStepChangelog(bd, close) {
  const body = bd.querySelector('#upd-modal-body');
  body.innerHTML = `
    <div class="confirm-modal-icon">🚀</div>
    <div class="confirm-modal-title">Nouvelle version disponible</div>
    <div class="update-modal-versions">v${_updateInfo.currentVersion} → v${_updateInfo.latestVersion}</div>
    <div class="update-modal-changelog">${renderChangelogHtml(_updateInfo.releaseNotes) || '<p>Voir la page de la release pour le détail.</p>'}</div>
    <div class="update-modal-smartscreen-note">
      ⚠️ Windows peut afficher un écran bleu <strong>« Windows a protégé votre ordinateur »</strong> au lancement de l'installeur téléchargé — c'est normal, l'appli n'est pas signée numériquement (pas de risque, c'est bien Allure+). Cliquez sur <strong>« Informations complémentaires »</strong> puis <strong>« Exécuter quand même »</strong>.
    </div>
    <div class="confirm-modal-actions">
      <button class="confirm-modal-btn confirm-modal-btn--cancel" id="upd-later">Plus tard</button>
      <button class="confirm-modal-btn confirm-modal-btn--confirm" id="upd-download">Télécharger</button>
    </div>`;
  body.querySelector('#upd-later').onclick = close;
  body.querySelector('#upd-download').onclick = () => startUpdateDownload(bd, close);
}

function renderUpdateStepError(bd, close, message) {
  const body = bd.querySelector('#upd-modal-body');
  body.innerHTML = `
    <div class="confirm-modal-icon">⚠️</div>
    <div class="confirm-modal-title">Échec du téléchargement</div>
    <div class="update-modal-changelog"><p>${message || 'Erreur inconnue.'}</p></div>
    <div class="confirm-modal-actions">
      <button class="confirm-modal-btn confirm-modal-btn--confirm" id="upd-close-err">Fermer</button>
    </div>`;
  body.querySelector('#upd-close-err').onclick = close;
}

async function startUpdateDownload(bd, close) {
  const body = bd.querySelector('#upd-modal-body');
  body.innerHTML = `
    <div class="confirm-modal-icon">⬇️</div>
    <div class="confirm-modal-title">Téléchargement en cours…</div>
    <div class="update-modal-progress-bar"><div class="update-modal-progress-fill" id="upd-progress-fill"></div></div>
    <div class="update-modal-progress-label" id="upd-progress-label">Démarrage…</div>`;

  try {
    const res = await fetch(`${API}/api/update/download`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || (!data.started && data.reason !== 'already-downloading')) {
      throw new Error(data.error || 'Échec du téléchargement.');
    }
  } catch (e) {
    renderUpdateStepError(bd, close, e.message);
    return;
  }

  _updatePollTimer = setInterval(async () => {
    let data;
    try {
      const res = await fetch(`${API}/api/update/download-progress`);
      data = await res.json();
    } catch (e) { return; } // coupure ponctuelle - le prochain tick reessaiera

    if (data.status === 'downloading') {
      const pct = data.totalBytes > 0 ? Math.round((data.downloadedBytes / data.totalBytes) * 100) : 0;
      const fill = el('upd-progress-fill'), label = el('upd-progress-label');
      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = data.totalBytes > 0
        ? `${pct} % — ${(data.downloadedBytes / 1048576).toFixed(1)} / ${(data.totalBytes / 1048576).toFixed(1)} Mo`
        : `${(data.downloadedBytes / 1048576).toFixed(1)} Mo téléchargés…`;
    } else if (data.status === 'done') {
      clearInterval(_updatePollTimer);
      renderUpdateStepInstallPrompt(bd, close);
    } else if (data.status === 'error') {
      clearInterval(_updatePollTimer);
      renderUpdateStepError(bd, close, data.error);
    }
  }, 400);
}

function renderUpdateStepInstallPrompt(bd, close) {
  const body = bd.querySelector('#upd-modal-body');
  body.innerHTML = `
    <div class="confirm-modal-icon">✅</div>
    <div class="confirm-modal-title">Téléchargement terminé</div>
    <div class="update-modal-smartscreen-note">
      ⚠️ Windows peut afficher un écran bleu <strong>« Windows a protégé votre ordinateur »</strong> au lancement — c'est normal, l'appli n'est pas signée numériquement. Cliquez sur <strong>« Informations complémentaires »</strong> puis <strong>« Exécuter quand même »</strong>.
    </div>
    <div class="confirm-modal-actions">
      <button class="confirm-modal-btn confirm-modal-btn--cancel" id="upd-install-later">Plus tard</button>
      <button class="confirm-modal-btn confirm-modal-btn--confirm" id="upd-install-now">Installer maintenant</button>
    </div>`;
  body.querySelector('#upd-install-later').onclick = close;
  const installBtn = body.querySelector('#upd-install-now');
  installBtn.onclick = async () => {
    // Retour visuel immediat au clic - avant meme l'appel reseau, jamais
    // apres (retour utilisateur explicite : lancer l'installeur prend un
    // instant sans aucun signe visible, l'utilisateur pensait son clic
    // ignore et re-cliquait, risquant de lancer l'installeur deux fois).
    installBtn.disabled = true;
    installBtn.textContent = 'Installation en cours…';
    try {
      const res = await fetch(`${API}/api/update/install`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.launched) throw new Error(data.error || "Impossible de lancer l'installeur.");
      close();
      if (typeof showToast === 'function') {
        showToast('Installeur lancé — suivez les instructions à l’écran.', 'success');
      }
    } catch (e) {
      installBtn.disabled = false;
      installBtn.textContent = 'Installer maintenant';
      if (typeof showToast === 'function') showToast(e.message || "Impossible de lancer l'installeur.", 'error');
    }
  };
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
    // Valeur precise (non arrondie) renvoyee par Garmin (metrics-service/maxmet) —
    // c'est celle-ci que Garmin utilise en interne (classification, courbe), l'entier
    // affiche a l'ecran arrondit toujours au meme chiffre pendant plusieurs jours.
    _latestVO2MaxPrecise = (typeof stats.vo2MaxPrecise === 'number') ? stats.vo2MaxPrecise : null;
    // _latestVO2Max sert de source unique a tout le reste de l'app (VMA, zones
    // d'allure, Profil...) : on lui donne la valeur precise quand elle est
    // disponible pour que ces calculs en beneficient automatiquement.
    if (_latestVO2MaxPrecise != null) {
      _latestVO2Max = _latestVO2MaxPrecise;
    } else if (_vo2maxSeries.length > 0) {
      _latestVO2Max = _vo2maxSeries[_vo2maxSeries.length - 1].vo2max || stats.latestVO2Max || null;
    } else if (stats.latestVO2Max) {
      _latestVO2Max = stats.latestVO2Max;
    }

    renderHeroStats(stats);
    renderWeeklyBreakdown();
    renderLastRun(lastRuns);
    renderHeatmap(stats.heatmap || {});
    renderSportsChart(stats.sportBreakdown || {});
    renderVO2MaxChart(stats.vo2maxSeries || []);

    // Date du jour dans tous les headers
    const now = new Date();
    const dayStr = now.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const dayFormatted = dayStr.charAt(0).toUpperCase() + dayStr.slice(1);
    setVal('page-date', dayFormatted);
    setVal('act-page-date', dayFormatted);
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
      setVal('last-updated', `Données Garmin ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`);
    }
  } catch(e) {
    console.error('Erreur dashboard:', e);
  }
}

// ─── Répartition de la semaine en cours (lun→dim) ────────────────────
// Regroupe _allActivities (deja charge par loadDashboard, pas d'appel
// reseau supplementaire) par jour de la semaine calendaire contenant
// aujourd'hui. Barres en pur HTML/CSS (pas Chart.js) - assez simple pour
// ne pas justifier un canvas, et l'infobulle au survol (liste d'activites
// du jour) est plus simple a construire en DOM qu'en tooltip Chart.js.
function renderWeeklyBreakdown() {
  const container = el('dash-week-breakdown');
  if (!container) return;

  const today = new Date();
  const dow = today.getDay(); // 0=dimanche..6=samedi
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return { date: d, activities: [], totalSec: 0, totalDistKm: 0, typeSecs: {} };
  });
  const sunday = days[6].date;

  (_allActivities || []).forEach(a => {
    if (!a.date) return;
    const d = new Date(a.date);
    if (isNaN(d) || d < monday || d > new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59)) return;
    const idx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - monday) / 86400000);
    if (idx < 0 || idx > 6) return;
    const day = days[idx];
    const sec = a.durationSec || 0;
    day.activities.push(a);
    day.totalSec += sec;
    day.totalDistKm += (a.distanceKm || 0);
    const cls = getSportIconClass(a.activityType);
    day.typeSecs[cls] = (day.typeSecs[cls] || 0) + sec;
  });

  const totalSec = days.reduce((s, d) => s + d.totalSec, 0);
  const totalDistKm = days.reduce((s, d) => s + d.totalDistKm, 0);
  const maxSec = Math.max(...days.map(d => d.totalSec), 1);
  const dayLetters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const rangeLabel = monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' – ' + sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  // Barre segmentee par type d'activite (hauteur totale = temps du jour vs
  // max de la semaine, comme avant ; a l'interieur, chaque type occupe une
  // portion proportionnelle a son temps ce jour-la - une journee course+velo
  // affiche les 2 couleurs empilees) - meme palette CAL_TYPE_COLORS que la
  // vue calendrier (Activites), pour rester coherent d'une vue a l'autre.
  const barsHtml = days.map((d, i) => {
    const heightPct = d.totalSec > 0 ? Math.max(10, Math.round((d.totalSec / maxSec) * 100)) : 4;
    const isToday = d.date.toDateString() === today.toDateString();
    let barInner = '';
    if (d.totalSec > 0) {
      barInner = Object.entries(d.typeSecs)
        .map(([cls, sec]) => `<div class="dash-week-bar-seg" style="flex:${sec} 0 0;background:${CAL_TYPE_COLORS[cls] || CAL_TYPE_COLORS['']}"></div>`)
        .join('');
    }
    return `<div class="dash-week-col" data-idx="${i}">
      <div class="dash-week-bar${d.totalSec > 0 ? ' dash-week-bar--active' : ''}" style="height:${heightPct}%">${barInner}</div>
      <div class="dash-week-letter${isToday ? ' dash-week-letter--today' : ''}">${dayLetters[i]}</div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="dash-week-total">
      <div class="dash-week-total-value">${formatDuration(totalSec)}</div>
      <div class="dash-week-total-label">${totalDistKm.toFixed(1)} km · ${rangeLabel}</div>
    </div>
    <div class="dash-week-bars">${barsHtml}</div>`;

  container.querySelectorAll('.dash-week-col').forEach(col => {
    const d = days[parseInt(col.dataset.idx, 10)];
    if (!d.activities.length) return;
    col.classList.add('dash-week-col--hoverable');
    let tip = null;
    col.addEventListener('mouseenter', () => {
      const dateLbl = d.date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      tip = document.createElement('div');
      tip.className = 'dash-week-tooltip';
      tip.innerHTML = `<div class="dash-week-tooltip-date">${dateLbl.charAt(0).toUpperCase() + dateLbl.slice(1)}</div>`
        + d.activities.map(a => `<div class="dash-week-tooltip-row">${typeof getSportIcon === 'function' ? getSportIcon(a.activityType) : ''}<span>${a.name || 'Activité'} · ${formatDuration(a.durationSec)}</span></div>`).join('');
      col.appendChild(tip);
    });
    col.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
  });
}

function fmtRaceTime(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Prédicteur de courses (Synthèse) ──────────────────────────────
// Garmin propose un widget equivalent ("Race Predictor") mais l'algorithme
// exact n'est pas documente publiquement, et la metrique n'est de toute
// facon pas accessible depuis notre client Garmin OAuth (voir CLAUDE.md,
// section "Page Sante/Performance" : chemin gc-api reserve a une session
// navigateur). Calcul maison a la place, avec la MEME formule VMA/%VMA deja
// utilisee et affichee ailleurs dans l'app (estimateRaceTime, definie plus
// haut - projections Objectifs, allures cibles) : pas de 2e formule
// concurrente qui donnerait des chiffres differents pour un meme VO2max
// selon la page consultee.
function renderRacePredictor(vo2max, sex) {
  const container = el('dash-race-predictor');
  if (!container) return;
  const vma = vo2max ? calcVMA(vo2max, sex || 'M') : null;
  if (!vma) {
    container.innerHTML = '<div class="dash-predictor-empty">VO&#x2082;max indisponible</div>';
    return;
  }
  const dists = [
    { label: '5 km', km: 5 },
    { label: '10 km', km: 10 },
    { label: 'Semi', km: 21.0975 },
    { label: 'Marathon', km: 42.195 },
  ];
  container.innerHTML = dists.map(d => `
    <div class="dash-predictor-item">
      <div class="dash-predictor-time">${fmtRaceTime(estimateRaceTime(vma, d.km, 0, false))}</div>
      <div class="dash-predictor-label">${d.label}</div>
    </div>`).join('');
}

// ─── Hero Stats ────────────────────────────────
function renderHeroStats(stats) {
  setVal('stat-km-year', stats.totalKmYear);
  setVal('stat-km-run', `dont ${stats.totalKmRunYear} km en course`);
  setVal('stat-activities', stats.totalActivitiesYear);
  setVal('stat-time', `${stats.totalTimeHours}h d'entraînement`);

  // VO2max
  if (stats.latestVO2Max) {
    // Valeur precise renvoyee par Garmin (metrics-service/maxmet) quand disponible —
    // l'entier seul reste souvent identique plusieurs jours de suite alors que la
    // courbe Garmin, elle, bouge deja (cf. vo2MaxPrecise cote serveur).
    const vo2Display = (typeof stats.vo2MaxPrecise === 'number') ? stats.vo2MaxPrecise : stats.latestVO2Max;
    setVal('stat-vo2max', vo2Display.toFixed(1));
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
    if (vo2StatEl && typeof vo2maxGarminColor === 'function') {
      vo2StatEl.style.color = vo2maxGarminColor(vo2Display, profSex, profAge);
    }
    if (typeof vo2maxLabel === 'function') setVal('dash-vo2-label', vo2maxLabel(vo2Display, profSex, profAge));
    if (typeof renderVo2Bar === 'function') {
      const barEl = el('dash-vo2-bar-wrap');
      if (barEl) barEl.innerHTML = renderVo2Bar(vo2Display, profSex, profAge);
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
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      const lastP = (typeof last.preciseValue === 'number') ? last.preciseValue : last.value;
      const prevP = (typeof prev.preciseValue === 'number') ? prev.preciseValue : prev.value;
      // Arrondi au dixieme pour eviter des ecarts flottants illisibles (ex: 0.0999999)
      const diff = Math.round((lastP - prevP) * 10) / 10;
      const tag = el('stat-vo2max-trend');
      if (tag) {
        tag.style.display = 'inline-flex';
        if (diff === 0) {
          tag.textContent = '● stable';
          tag.className = 'stat-tag stat-tag--neutral';
        } else if (diff > 0) {
          tag.textContent = `▲ +${diff.toFixed(1)}`;
          tag.className = 'stat-tag stat-tag--up';
        } else {
          tag.textContent = `▼ ${diff.toFixed(1)}`;
          tag.className = 'stat-tag stat-tag--down';
        }
      }
    }
    renderRacePredictor(vo2Display, profSex);
  } else {
    setVal('stat-vo2max', '—');
    renderRacePredictor(null, null);
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
      <td><span class="run-type-text ${activityTypeClass(type)}">${activityTypeLabel(type)}</span>${typeof activityAnalysisBadge === 'function' ? activityAnalysisBadge(act.id) : ''}</td>
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
  if (t.includes('swim'))                          return 'sport-icon--swimming';
  return '';
}

// Regroupe toutes les variantes Garmin de natation (swimming,
// open_water_swimming, etc.) sous une seule cle 'swimming' - reutilise pour
// les repartitions agregees (Synthese, Statistiques) ou natation/piscine/eau
// libre doivent compter comme UNE seule categorie plutot que plusieurs
// tranches distinctes. Miroir de la meme regle cote serveur
// (garmin_client.js, calcul de sportBreakdown) - les deux doivent rester
// synchronises manuellement si de nouveaux types Garmin apparaissent.
function canonicalSportType(type) {
  const t = (type || 'other').toLowerCase();
  return t.includes('swim') ? 'swimming' : (type || 'other');
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

// ─── Filtres sport multi-selection (pastilles "Tout / Course / Trail / ...") ──
// Partagé entre la page Activités (#activity-filters, ici) et Statistiques
// (#stats-filters, stats.js) : "Tout" est exclusif (efface les autres), les
// pastilles sport se cumulent (clic = coche/décoche), et si la dernière
// pastille sport active est décochée on retombe automatiquement sur "Tout"
// plutôt que de laisser un filtre vide (qui ne matcherait plus rien).
function getActiveSportFilters(container) {
  if (!container) return ['all'];
  const active = [...container.querySelectorAll('.filter-pill.active')].map(p => p.dataset.filter);
  return active.length ? active : ['all'];
}
function wireSportFilterPills(container, onChange) {
  if (!container) return;
  const pills = [...container.querySelectorAll('.filter-pill')];
  pills.forEach(pill => {
    pill.addEventListener('click', () => {
      if (pill.dataset.filter === 'all') {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      } else {
        pill.classList.toggle('active');
        const allPill = pills.find(p => p.dataset.filter === 'all');
        const anySportActive = pills.some(p => p.dataset.filter !== 'all' && p.classList.contains('active'));
        if (allPill) allPill.classList.toggle('active', !anySportActive);
      }
      onChange(getActiveSportFilters(container));
    });
  });
}

// Sport type filter — filter est 'all', une seule cle, ou un tableau de cles
// cumulees (multi-selection des pastilles, cf wireSportFilterPills). Extrait
// de renderAllActivities pour etre reutilise par la vue calendrier (chips +
// recap hebdo/mensuel) - une seule logique de correspondance type<->filtre.
function activityMatchesSportFilter(activityType, filter) {
  const t = (activityType || '').toLowerCase();
  const filters = Array.isArray(filter) ? filter : [filter];
  return filters.includes('all') || filters.some(f => {
    if (f === 'running') return (t === 'running' || t === 'treadmill_running' || (t.includes('run') && !t.includes('trail')));
    if (f === 'trail')   return t.includes('trail');
    if (f === 'cycling') return t === 'cycling' || t.includes('cycl') || t.includes('bike');
    if (f === 'cardio')  return t.includes('cardio') || t.includes('fitness') || t.includes('indoor') || t.includes('strength') || t.includes('hiit') || t.includes('muscul');
    if (f === 'walking') return t.includes('walk') || t === 'walking';
    if (f === 'swimming') return t.includes('swim');
    return true;
  });
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
    const sportMatch = activityMatchesSportFilter(a.activityType, filter);
    // Year/month filter
    const date = new Date(a.startTimeLocal || a.startTimeGMT || a.beginTimestamp || a.date);
    const yearMatch  = !yearFilter  || date.getFullYear() === yearFilter;
    const monthMatch = !monthFilter || (date.getMonth() + 1) === monthFilter;
    // Recherche par nom d'activité (colonne "Activité")
    const searchTerm = (el('filter-search')?.value || '').trim().toLowerCase();
    const nameMatch = !searchTerm || (a.name || '').toLowerCase().includes(searchTerm);
    return sportMatch && yearMatch && monthMatch && nameMatch;
  });

  // Tri chronologique descendant explicite — _allActivities est alimenté par
  // lots (chargement initial + chargements par année à la demande) qui ne
  // sont pas forcément concaténés dans le bon ordre global.
  filtered.sort((a, b) => new Date(b.date || b.startTimeLocal || b.startTimeGMT || 0) - new Date(a.date || a.startTimeLocal || a.startTimeGMT || 0));

  // Expose le meme jeu filtre au globe des activites (globe.js) - reutilise
  // tel quel (sport + annee + mois + recherche), pas de logique dupliquee.
  // refreshActivityGlobe() est un no-op si la modale n'est pas ouverte.
  _lastFilteredActivities = filtered;
  if (typeof refreshActivityGlobe === 'function') refreshActivityGlobe();

  // Avertir si une recherche texte porte sur "Toutes les années" alors que
  // certaines années n'ont aucune activité chargée en mémoire (chargement à
  // la demande par année) — la recherche ne peut alors être que partielle.
  // Seules les années totalement absentes de _allActivities sont signalées :
  // une année qui a déjà des activités visibles (via le lot initial) ne doit
  // pas être annoncée comme "non chargée".
  const searchWarnEl = el('activities-search-warning');
  if (searchWarnEl) {
    const searchTerm = (el('filter-search')?.value || '').trim();
    const currentYear = new Date().getFullYear();
    const missingYears = [];
    if (searchTerm && !yearFilter) {
      const yearsWithData = new Set();
      _allActivities.forEach(a => {
        const d = new Date(a.date || a.startTimeLocal || a.startTimeGMT || '');
        if (!isNaN(d)) yearsWithData.add(d.getFullYear());
      });
      let earliest = yearsWithData.size ? Math.min(...yearsWithData) : currentYear;
      earliest = Math.min(earliest, 2010);
      for (let y = earliest; y < currentYear; y++) {
        if (!yearsWithData.has(y)) missingYears.push(y);
      }
    }
    // Regrouper les années consécutives en plages (ex: 2010-2018, 2020)
    const ranges = [];
    missingYears.forEach(y => {
      const last = ranges[ranges.length - 1];
      if (last && y === last[1] + 1) last[1] = y; else ranges.push([y, y]);
    });
    const rangesLabel = ranges.map(([a, b]) => a === b ? String(a) : `${a}–${b}`).join(', ');
    searchWarnEl.innerHTML = missingYears.length > 0 ? `
      <div class="weight-loss-advice" style="margin:0 0 16px 0">
        <div style="font-family:var(--font-body);font-size:12px;color:var(--text-secondary);white-space:normal">⚠️ Recherche partielle : les années <strong style="color:var(--text-primary)">${rangesLabel}</strong> n'ont aucune activité chargée. Sélectionnez-les une à une dans le filtre année pour une recherche complète.</div>
      </div>` : '';
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="table-loading">Aucune activite trouvee pour ce filtre</td></tr>`;
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
        <td>${formatDateShort(a.date, true)}</td>
        <td><span class="activity-type-cell ${activityTypeClass(type)}">${icon}<span class="run-type-text">${activityTypeLabel(type)}</span>${typeof activityAnalysisBadge === 'function' ? activityAnalysisBadge(a.id) : ''}</span></td>
        <td style="color:var(--text-primary);max-width:180px;overflow:hidden;text-overflow:ellipsis">${a.name || '\u2014'}</td>
        <td class="col-mood">${typeof sessionMoodBadgeForActivity === 'function' ? sessionMoodBadgeForActivity(a.id) : ''}</td>
        <td class="dist-value">${a.distanceKm ? a.distanceKm.toFixed(2)+' km' : '\u2014'}</td>
        <td style="color:var(--text-secondary)">${formatDuration(a.durationSec)}</td>
        <td class="pace-value">${formatPace(a.avgPaceSecPerKm)}</td>
        <td class="hr-value">${a.avgHR ? Math.round(a.avgHR)+' bpm' : '\u2014'}</td>
        <td style="color:var(--text-secondary)">${a.elevationGain ? Math.round(a.elevationGain)+' m' : '\u2014'}</td>
        <td style="color:var(--text-muted)">${a.calories ? Math.round(a.calories) : '\u2014'}</td>
        <td class="col-chevron"><span class="row-chevron">&rsaquo;</span></td>
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

// ─── Vue calendrier (page Activités) ───────────────────────────────
// Bascule Liste/Calendrier sur la meme donnee que le tableau (_allActivities,
// via ensureYearLoaded/stats.js pour les mois d'annees pas encore chargees) -
// pas de route API dediee. Etat du mois affiche independant du filtre
// annee/mois du tableau (propre navigation mois par mois, comme un vrai
// calendrier), reinitialise sur le mois courant a chaque ouverture.
const CAL_TYPE_COLORS = {
  'sport-icon--running': '#3b82f6', 'sport-icon--trail': '#2dd4bf',
  'sport-icon--cycling': '#fb923c', 'sport-icon--walking': '#a78bfa',
  'sport-icon--cardio': '#f87171', 'sport-icon--swimming': '#06b6d4',
  '': '#8a8fa3',
};

// Libelles/couleurs des repartitions par sport (donut Synthese, barres
// Statistiques) - source unique, reutilisee par stats.js (charge apres,
// scope global partage). 'swimming' regroupe deja toutes les variantes
// natation cote serveur/agregation (voir canonicalSportType) : jamais de
// cle 'open_water_swimming' distincte a ce stade.
const SPORT_TYPE_LABELS_FR = {
  running: 'Course', trail_running: 'Trail', cycling: 'Vélo',
  swimming: 'Natation', walking: 'Marche', hiking: 'Randonnée',
  strength_training: 'Musculation', indoor_cardio: 'Cardio indoor',
  treadmill_running: 'Tapis', mountain_biking: 'VTT', yoga: 'Yoga',
  other: 'Autre'
};
const SPORT_TYPE_COLORS = ['#2563EB','#7C3AED','#16A34A','#D97706','#DC2626','#0891B2','#DB2777'];
let _calDate = new Date();
let _calViewMode = 'month'; // 'month' | 'year' (cf. calSetMode)

function showActivitiesListView() {
  el('activities-table-card').classList.remove('act-view-hidden');
  el('activities-calendar-card').classList.add('act-view-hidden');
  document.querySelectorAll('.act-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
}
function showActivitiesCalendarView() {
  el('activities-table-card').classList.add('act-view-hidden');
  el('activities-calendar-card').classList.remove('act-view-hidden');
  document.querySelectorAll('.act-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'calendar'));
  renderActivitiesCalendar();
}

function calSetMode(mode) {
  _calViewMode = mode;
  document.querySelectorAll('.cal-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const grid = el('cal-grid');
  if (grid) grid.classList.toggle('cal-grid--year', mode === 'year');
  renderActivitiesCalendar();
}

async function calNavigate(delta) {
  _calDate = (_calViewMode === 'year')
    ? new Date(_calDate.getFullYear() + delta, _calDate.getMonth(), 1)
    : new Date(_calDate.getFullYear(), _calDate.getMonth() + delta, 1);
  await renderActivitiesCalendar();
}
// "Aujourd'hui" ramenait le calendrier au mois courant sans toucher aux
// selecteurs Annee/Mois du haut de page, qui restaient donc sur un filtre
// perime (ex: "2024 / Fevrier" affiche alors que le calendrier montre deja
// "Aout 2026") - on les remet a la date du jour puis on delegue leurs
// handlers `change` deja en place (chargement de l'annee si besoin, refresh
// liste, ET synchro calendrier via _calSyncFromActivityFilters) plutot que
// dupliquer cette logique ici.
async function calGoToday() {
  const today = new Date();
  const yearSel = el('filter-year');
  const monthSel = el('filter-month');
  if (yearSel) { yearSel.value = String(today.getFullYear()); yearSel.dispatchEvent(new Event('change')); }
  if (monthSel) { monthSel.value = String(today.getMonth() + 1); monthSel.dispatchEvent(new Event('change')); }
  _calDate = today;
  await renderActivitiesCalendar();
}

// Les selecteurs Annee/Mois du haut de page ne pilotaient que la vue Liste -
// la vue Calendrier restait bloquee sur le mois courant, quel que soit le
// filtre choisi (retour utilisateur). Appele par les handlers filterYear/
// filterMonth (app.js) : aligne _calDate sur le filtre (annee choisie ou
// annee deja affichee si "Toutes les annees", meme logique pour le mois),
// puis ne recalcule que si la vue Calendrier est actuellement visible -
// meme garde que le filtre sport un peu plus haut.
function _calSyncFromActivityFilters() {
  const yearVal = parseInt(el('filter-year')?.value) || 0;
  const monthVal = parseInt(el('filter-month')?.value) || 0;
  const newYear = yearVal || _calDate.getFullYear();
  const newMonth = monthVal ? (monthVal - 1) : _calDate.getMonth();
  _calDate = new Date(newYear, newMonth, 1);
  if (typeof renderActivitiesCalendar === 'function' && el('activities-calendar-card') && !el('activities-calendar-card').classList.contains('act-view-hidden')) {
    renderActivitiesCalendar();
  }
}

// Dispatcheur mois/annee - cal-prev/cal-next/cal-today/le filtre sport et
// showActivitiesCalendarView appellent tous cette fonction sans se soucier
// du mode courant.
async function renderActivitiesCalendar() {
  return _calViewMode === 'year' ? renderActivitiesCalendarYear() : renderActivitiesCalendarMonth();
}

async function renderActivitiesCalendarMonth() {
  const grid = el('cal-grid');
  const label = el('cal-month-label');
  if (!grid || !label) return;

  const year = _calDate.getFullYear(), month = _calDate.getMonth();
  label.textContent = _calDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  label.textContent = label.textContent.charAt(0).toUpperCase() + label.textContent.slice(1);

  // Charge l'annee affichee si pas encore en memoire (mois d'une annee
  // passee jamais visitee dans le tableau) - meme mecanisme que le filtre
  // annee des Activites, cf. stats.js.
  if (typeof ensureYearLoaded === 'function' && year < new Date().getFullYear()) {
    await ensureYearLoaded(year);
  }
  const raceIds = await calGetRaceActivityIds();

  // Respecte le filtre sport actif (pastilles Tout/Course/Trail/...) - meme
  // logique que le tableau (activityMatchesSportFilter), sur puces ET totaux.
  const currentFilter = typeof getActiveSportFilters === 'function' ? getActiveSportFilters(el('activity-filters')) : 'all';
  const activitiesInScope = (_allActivities || []).filter(a => activityMatchesSportFilter(a.activityType, currentFilter));

  const firstOfMonth = new Date(year, month, 1);
  const firstDow = (firstOfMonth.getDay() + 6) % 7; // 0=lundi
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const gridStart = new Date(year, month, 1 - firstDow);

  const today = new Date();
  const todayKey = today.toDateString();

  // Regroupe les activites par jour (cle: toDateString) pour tout
  // l'intervalle affiche (peut deborder sur le mois precedent/suivant).
  const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
  const gridEnd = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + totalCells - 1, 23, 59, 59);
  const byDay = {};
  activitiesInScope.forEach(a => {
    if (!a.date) return;
    const d = new Date(a.date);
    if (isNaN(d) || d < gridStart || d > gridEnd) return;
    const key = d.toDateString();
    (byDay[key] = byDay[key] || []).push(a);
  });

  const weekdayRow = '<div class="cal-weekday-row"><div>Lun</div><div>Mar</div><div>Mer</div><div>Jeu</div><div>Ven</div><div>Sam</div><div>Dim</div><div></div></div>';

  const actsById = {}; // pour les tooltips au survol, attaches apres coup (voir plus bas)
  let monthDist = 0, monthSec = 0, monthCount = 0;
  const weekRows = [];
  for (let w = 0; w < totalCells / 7; w++) {
    const cells = [];
    let weekDist = 0, weekSec = 0, weekCal = 0, weekHasData = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + i);
      const key = d.toDateString();
      const dayActs = byDay[key] || [];
      const isOutside = d.getMonth() !== month;
      const isToday = key === todayKey;
      if (!isOutside) {
        dayActs.forEach(a => {
          weekDist += (a.distanceKm || 0); weekSec += (a.durationSec || 0); weekCal += (a.calories || 0);
          weekHasData = true;
          monthDist += (a.distanceKm || 0); monthSec += (a.durationSec || 0); monthCount++;
        });
      }
      const MAX_CHIPS = 2;
      const chips = dayActs.slice(0, MAX_CHIPS).map(a => {
        actsById[a.id] = a;
        const cls = getSportIconClass(a.activityType);
        const color = CAL_TYPE_COLORS[cls] || CAL_TYPE_COLORS[''];
        // Libelle toujours = le type (Course/Trail/Velo...), jamais la
        // distance - retour utilisateur : l'ancien "km si seule activite du
        // jour, sinon type" rendait les cases incoherentes d'un jour a
        // l'autre. Le detail (distance/duree/FC) passe desormais par la
        // vignette au survol (cf. attachCalChipTooltips ci-dessous).
        const labelTxt = activityTypeLabel(a.activityType);
        const star = raceIds.has(String(a.id)) ? '<span class="cal-chip-star" title="Liee a une course dans Mes courses">&#9733;</span>' : '';
        return `<div class="cal-chip" data-actid="${a.id}" style="--chip-color:${color}" onclick="event.stopPropagation();calOpenActivity('${a.id}')">${getSportIcon(a.activityType)}<span class="cal-chip-label">${labelTxt}</span>${star}</div>`;
      }).join('');
      const more = dayActs.length > MAX_CHIPS ? `<div class="cal-chip-more">+${dayActs.length - MAX_CHIPS}</div>` : '';
      cells.push(`<div class="cal-day-cell${isOutside ? ' cal-day-cell--outside' : ''}${isToday ? ' cal-day-cell--today' : ''}">
        <div class="cal-day-num">${d.getDate()}</div>${chips}${more}
      </div>`);
    }
    const recapHtml = weekHasData
      ? `<div class="cal-week-recap">
          <div class="cal-week-recap-row">Dist. <strong>${weekDist.toFixed(1)} km</strong></div>
          <div class="cal-week-recap-row">Durée <strong>${formatDuration(weekSec)}</strong></div>
          <div class="cal-week-recap-row">Cal. <strong>${Math.round(weekCal)}</strong></div>
        </div>`
      : '<div class="cal-week-recap cal-week-recap--empty">—</div>';
    weekRows.push(`<div class="cal-week-row">${cells.join('')}${recapHtml}</div>`);
  }

  grid.innerHTML = weekdayRow + weekRows.join('');

  // Total du mois affiche, discret, a cote du libelle du mois.
  const monthTotalEl = el('cal-month-total');
  if (monthTotalEl) {
    monthTotalEl.textContent = monthCount > 0
      ? `${monthCount} activité${monthCount > 1 ? 's' : ''} · ${monthDist.toFixed(1)} km · ${formatDuration(monthSec)}`
      : '';
  }

  attachCalChipTooltips(grid, actsById);
}

const CAL_MONTH_NAMES = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

// Vue "Année" (calSetMode) : 12 mini-calendriers façon Garmin, sans en
// reprendre le style — un trait de couleur (type de la 1ere activite du
// jour) sous le numero plutot qu'un texte, trop de place manque a cette
// echelle pour des puces lisibles. Detail complet dans la vignette au survol
// (attachCalChipTooltips, reutilisee au niveau du jour entier ici).
async function renderActivitiesCalendarYear() {
  const grid = el('cal-grid');
  const label = el('cal-month-label');
  if (!grid || !label) return;

  const year = _calDate.getFullYear();
  label.textContent = String(year);

  if (typeof ensureYearLoaded === 'function' && year < new Date().getFullYear()) {
    await ensureYearLoaded(year);
  }

  const currentFilter = typeof getActiveSportFilters === 'function' ? getActiveSportFilters(el('activity-filters')) : 'all';
  const activitiesInScope = (_allActivities || []).filter(a => activityMatchesSportFilter(a.activityType, currentFilter));

  const byDay = {};
  let yearDist = 0, yearSec = 0, yearCount = 0;
  activitiesInScope.forEach(a => {
    if (!a.date) return;
    const d = new Date(a.date);
    if (isNaN(d) || d.getFullYear() !== year) return;
    const key = d.toDateString();
    (byDay[key] = byDay[key] || []).push(a);
    yearDist += (a.distanceKm || 0); yearSec += (a.durationSec || 0); yearCount++;
  });

  const today = new Date();
  const todayKey = today.toDateString();
  const actsById = {};

  const monthsHtml = CAL_MONTH_NAMES.map((mName, m) => {
    const firstOfMonth = new Date(year, m, 1);
    const firstDow = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const totalCells = Math.ceil((firstDow + daysInMonth) / 7) * 7;
    const gridStart = new Date(year, m, 1 - firstDow);

    const dayCells = [];
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = d.toDateString();
      const dayActs = byDay[key] || [];
      const isOutside = d.getMonth() !== m;
      const isToday = key === todayKey;
      let barHtml = '';
      if (!isOutside && dayActs.length) {
        const cls = getSportIconClass(dayActs[0].activityType);
        const color = CAL_TYPE_COLORS[cls] || CAL_TYPE_COLORS[''];
        const dayId = 'calYearDay_' + key.replace(/[^a-zA-Z0-9]/g, '');
        actsById[dayId] = dayActs;
        barHtml = `<div class="cal-year-bar" data-dayid="${dayId}" style="--chip-color:${color}"></div>`;
      }
      dayCells.push(`<div class="cal-year-day${isOutside ? ' cal-year-day--outside' : ''}${isToday ? ' cal-year-day--today' : ''}">
        <span class="cal-year-day-num">${d.getDate()}</span>${barHtml}
      </div>`);
    }

    return `<div class="cal-year-month">
      <div class="cal-year-month-label">${mName}</div>
      <div class="cal-year-mini-weekdays"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>
      <div class="cal-year-mini-days">${dayCells.join('')}</div>
    </div>`;
  }).join('');

  grid.innerHTML = `<div class="cal-year-grid">${monthsHtml}</div>`;

  const totalEl = el('cal-month-total');
  if (totalEl) {
    totalEl.textContent = yearCount > 0
      ? `${yearCount} activité${yearCount > 1 ? 's' : ''} · ${yearDist.toFixed(0)} km · ${formatDuration(yearSec)}`
      : '';
  }

  // Vignette au survol d'un jour (liste des activites, meme jour peut en
  // porter plusieurs meme si un seul trait de couleur est affiche).
  grid.querySelectorAll('.cal-year-bar').forEach(bar => {
    const acts = actsById[bar.dataset.dayid];
    if (!acts || !acts.length) return;
    const cell = bar.closest('.cal-year-day');
    let tip = null;
    cell.addEventListener('mouseenter', () => {
      tip = document.createElement('div');
      tip.className = 'cal-chip-tooltip cal-year-tooltip';
      tip.innerHTML = acts.map(a => {
        const rows = [a.distanceKm ? a.distanceKm.toFixed(2) + ' km' : null, a.durationSec ? formatDuration(a.durationSec) : null].filter(Boolean).join(' · ');
        return `<div class="cal-chip-tooltip-name">${activityTypeLabel(a.activityType)}</div><div class="cal-chip-tooltip-stats">${rows}</div>`;
      }).join('');
      cell.appendChild(tip);
    });
    cell.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
  });
}

// Vignette au survol d'une puce du calendrier (nom, distance, duree, FC) -
// meme mecanisme que l'infobulle de "Votre semaine" (dashboard).
function attachCalChipTooltips(grid, actsById) {
  grid.querySelectorAll('.cal-chip').forEach(chip => {
    const a = actsById[chip.dataset.actid];
    if (!a) return;
    let tip = null;
    chip.addEventListener('mouseenter', () => {
      tip = document.createElement('div');
      tip.className = 'cal-chip-tooltip';
      const rows = [
        a.distanceKm ? `${a.distanceKm.toFixed(2)} km` : null,
        a.durationSec ? formatDuration(a.durationSec) : null,
        a.avgHR ? Math.round(a.avgHR) + ' bpm' : null,
      ].filter(Boolean).join(' · ');
      tip.innerHTML = `<div class="cal-chip-tooltip-name">${a.name || activityTypeLabel(a.activityType)}</div><div class="cal-chip-tooltip-stats">${rows}</div>`;
      chip.appendChild(tip);
    });
    chip.addEventListener('mouseleave', () => { if (tip) { tip.remove(); tip = null; } });
  });
}

// Recupere une seule fois (mise en cache) les activityId lies a une course
// dans "Mes courses" (/api/races) - independant du cycle de vie de
// records.js (_racesData n'y est peuple qu'apres visite de cette page), la
// vue calendrier peut etre ouverte sans jamais etre passe par Records.
let _calRaceActivityIdsCache = null;
async function calGetRaceActivityIds() {
  if (_calRaceActivityIdsCache) return _calRaceActivityIdsCache;
  try {
    const races = await fetch('/api/races').then(r => r.json());
    _calRaceActivityIdsCache = new Set((races || []).filter(r => r.activityId).map(r => String(r.activityId)));
  } catch (e) { _calRaceActivityIdsCache = new Set(); }
  return _calRaceActivityIdsCache;
}

// Ouverture d'une activite depuis une puce du calendrier - _allActivities
// contient deja l'annee affichee (ensureYearLoaded ci-dessus avant le
// rendu de la grille), pas besoin du fallback reseau de openActivityFromId
// (pensee pour Records et courses, backTo='records' non pertinent ici).
function calOpenActivity(id) {
  const act = (_allActivities || []).find(a => String(a.id) === String(id));
  if (act) showActivityDetail(act, 'activities');
  else if (typeof showToast === 'function') showToast('Activité introuvable', 'error');
}

if (el('cal-prev')) el('cal-prev').addEventListener('click', () => calNavigate(-1));
if (el('cal-next')) el('cal-next').addEventListener('click', () => calNavigate(1));
if (el('cal-today')) el('cal-today').addEventListener('click', calGoToday);

// Ouvre le detail d'une activite (page Activites) depuis son id Garmin —
// utilise par le lien "course -> activite" de la page Records et courses.
// _allActivities n'est peuple qu'avec l'annee courante au demarrage (voir
// loadDashboard) + les annees deja parcourues dans le filtre Activites
// (_fullyLoadedYears) : si on arrive directement sur Records et courses et
// que la course date d'une annee jamais visitee, l'activite liee n'y est
// pas encore — on la charge alors a la demande (meme route que le filtre
// annee) avant de reessayer, plutot que d'echouer silencieusement.
async function openActivityFromId(id, year) {
  let act = (_allActivities || []).find(a => String(a.id) === String(id));
  if (!act && year && !_fullyLoadedYears.has(year)) {
    showToast('Chargement de l\'activité…', 'loading', 0);
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
        act = _allActivities.find(a => String(a.id) === String(id));
      }
    } catch (e) { /* silencieux, le toast d'erreur ci-dessous couvre le cas */ }
    const lt = document.getElementById('app-toast-loading');
    if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
  }
  if (act) { showActivityDetail(act, 'records'); }
  else if (typeof showToast === 'function') { showToast('Activité introuvable (elle a peut-être été supprimée de Garmin)', 'error'); }
}

// ─── Envoi d'une activite vers "Mes courses" (page Records) ───────────
function isRaceEligibleActivity(activity) {
  const t = (activity.activityType || '').toLowerCase();
  return (t.includes('run') || t.includes('trail')) && activity.distanceKm > 0 && activity.durationSec > 0;
}

function sendActivityToRaces(activity) {
  const isTrail = (activity.activityType || '').toLowerCase().includes('trail');
  const prefill = {
    name: activity.name || '',
    type: isTrail ? 'trail' : 'route',
    date: (activity.date || '').slice(0, 10),
    distanceKm: activity.distanceKm || null,
    durationSec: activity.durationSec || null,
    elevationGain: activity.elevationGain ? Math.round(activity.elevationGain) : null,
    vo2max: activity.vO2MaxValue || null,
    activityId: activity.id || null,
  };
  navigateTo('records');
  if (typeof openRaceModal === 'function') openRaceModal(null, prefill);
}

// ─── Detail d une activite ─────────────────────────────────────────
// backTo : page vers laquelle revient le bouton "Retour" — 'activities' par
// defaut (liste des activites), 'records' quand on arrive via le lien 🏃
// d'une course (Records et courses, cf. openActivityFromId) pour repartir
// d'ou l'on vient plutot que d'atterrir systematiquement sur Activites.
function showActivityDetail(activity, backTo = 'activities') {
  if (!activity) return;

  navigateTo('activity-detail');
  el('nav-' + backTo)?.classList.add('active');

  const type  = activity.activityType || '';
  const dist  = activity.distanceKm ? activity.distanceKm.toFixed(2) + ' km' : '\u2014';
  const dur   = formatDuration(activity.durationSec);
  const pace  = formatPace(activity.avgPaceSecPerKm);
  const avgHR = activity.avgHR ? Math.round(activity.avgHR) + ' bpm' : '\u2014';
  const maxHR = activity.maxHR ? Math.round(activity.maxHR) + ' bpm' : '\u2014';
  const elev  = activity.elevationGain ? Math.round(activity.elevationGain) + ' m' : '\u2014';
  const cal   = activity.calories ? Math.round(activity.calories) : '\u2014';
  // vO2MaxValue (par activite, cote Garmin) est un entier arrondi ; l'historique
  // quotidien officiel (_vo2maxSeries, deja charge pour la page Sante) porte la
  // valeur precise (preciseValue) pour le meme jour calendaire - preferee ici
  // pour l'affichage en decimales (demande utilisateur), simple confort visuel.
  const vo2Series = (typeof _vo2maxSeries !== 'undefined' ? _vo2maxSeries : []);
  const vo2Day = (activity.date || '').slice(0, 10);
  const vo2Match = vo2Series.find(p => (p.date || '').slice(0, 10) === vo2Day);
  const vo2 = activity.vO2MaxValue == null ? '\u2014'
    : (typeof vo2Match?.preciseValue === 'number' ? vo2Match.preciseValue.toFixed(1) : activity.vO2MaxValue);

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
      <div class="activity-stats-grid" style="margin-top:8px">
        <div class="activity-stat"><div class="activity-stat-value">${dist}</div><div class="activity-stat-label">Distance</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${dur}</div><div class="activity-stat-label">Duree</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${pace}</div><div class="activity-stat-label">Allure moy.</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${avgHR}</div><div class="activity-stat-label">FC moyenne</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${maxHR}</div><div class="activity-stat-label">FC max</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${elev}</div><div class="activity-stat-label">Denivele +</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${cal}</div><div class="activity-stat-label">Calories</div></div>
        <div class="activity-stat"><div class="activity-stat-value">${vo2}</div><div class="activity-stat-label">VO2max estimee</div></div>
        ${(type.toLowerCase().includes('run') || type.toLowerCase().includes('trail') || type.toLowerCase().includes('walk') || type.toLowerCase().includes('hik')) ? `<div class="activity-stat"><div class="activity-stat-value" id="activity-gear-value">\u2014</div><div class="activity-stat-label">Chaussures</div></div>` : ''}
        ${typeof activityMoodStatHtml === 'function' ? activityMoodStatHtml(activity.id) : ''}
      </div>
      <div class="activity-detail-actions">
        <div class="activity-detail-actions-row">
          ${activity.id ? `<a href="https://connect.garmin.com/modern/activity/${activity.id}" target="_blank" class="activity-link">Voir sur Garmin Connect</a>` : ''}
          ${isRaceEligibleActivity(activity) ? `<button type="button" class="activity-link" id="btn-send-to-races" style="cursor:pointer">🏅 Envoyer vers Courses</button>` : ''}
        </div>
        ${(() => { const a = typeof renderActivityAnalysisButtons === 'function' ? renderActivityAnalysisButtons(activity) : ''; return a ? `<div class="activity-detail-actions-row">${a}</div>` : ''; })()}
      </div>
    </div>`;

  const sendBtn = el('btn-send-to-races');
  if (sendBtn) sendBtn.onclick = () => sendActivityToRaces(activity);
  if (typeof wireActivityAnalysisButtons === 'function') wireActivityAnalysisButtons(activity);
  if (typeof mountActivityGearField === 'function') mountActivityGearField(activity);
  if (typeof wireActivityMoodStat === 'function') wireActivityMoodStat();

  // Reinitialise la carte GPS (elements statiques, reutilises a chaque activite)
  const routeLoading = el('route-loading');
  const routeBadge   = el('route-badge');
  const routeCanvas  = el('route-canvas');
  if (routeLoading) { routeLoading.style.display = ''; routeLoading.innerHTML = '<div class="route-loading-spinner"></div><div>Chargement du trace...</div>'; }
  if (routeBadge)   { routeBadge.style.display = 'none'; }
  if (routeCanvas)  { const ctx = routeCanvas.getContext('2d'); if (ctx) ctx.clearRect(0, 0, routeCanvas.width, routeCanvas.height); }
  const hrZonesPanel = el('activity-hr-zones-panel');
  const hrZonesContent = el('activity-hr-zones-content');
  if (hrZonesPanel) hrZonesPanel.style.display = 'none';
  if (hrZonesContent) hrZonesContent.innerHTML = '';

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

  // Bouton retour — contextuel (voir backTo ci-dessus)
  const backBtn = el('btn-back-activities');
  backBtn.onclick = () => navigateTo(backTo);
  backBtn.lastChild.textContent = backTo === 'records' ? ' Retour aux courses' : ' Retour aux activités';

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
  } finally {
    renderActivityHRZonesCard();
  }
}

// ─── Temps passé dans chaque zone FC (Karvonen) sur la trace GPS ────
// Reutilise _lastRouteElevation (deja recupere pour le profil d'elevation
// et le GAP, cf. /api/activity/:id/gps cote serveur) — pas d'appel Garmin
// supplementaire. Zones = memes bornes que la page Profil (calcHRZones),
// jamais les zones Garmin, pour rester coherent avec le reste de l'app.
function computeCurrentUserHRZones() {
  const p = loadProfileData();
  const birthDate = p.birthDate || null;
  const age = birthDate ? (() => {
    const b = new Date(birthDate);
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  })() : (p.age || null);
  const hrMax = calcHRMax(age, p.hrmax || null);
  if (!hrMax) return null;
  const hrRest = _avgRestingHR ? Math.round(_avgRestingHR) : null;
  return { zones: calcHRZones(hrMax, hrRest), useKarvonen: !!hrRest };
}

function computeHRZoneTimes(elevation, zones) {
  const times = zones.map(() => 0);
  for (let i = 1; i < elevation.length; i++) {
    const prev = elevation[i - 1], cur = elevation[i];
    if (prev.sec == null || cur.sec == null || !cur.hr) continue;
    const dt = cur.sec - prev.sec;
    if (dt <= 0) continue;
    let idx = zones.findIndex((z, zi) => cur.hr >= z.low && (cur.hr < z.high || zi === zones.length - 1));
    if (idx === -1) idx = cur.hr < zones[0].low ? 0 : zones.length - 1;
    times[idx] += dt;
  }
  return times;
}

function renderActivityHRZonesCard() {
  const panel = el('activity-hr-zones-panel');
  const content = el('activity-hr-zones-content');
  const methodEl = el('activity-hr-zones-method');
  if (!panel || !content) return;
  panel.style.display = '';

  const computed = computeCurrentUserHRZones();
  const elevation = _lastRouteElevation;
  if (!computed) {
    if (methodEl) methodEl.textContent = '';
    content.innerHTML = '<p class="no-data">Renseignez votre profil (âge, FC max) pour voir vos zones</p>';
    return;
  }
  if (methodEl) methodEl.textContent = computed.useKarvonen ? '(Karvonen)' : '(% FC max)';
  if (!elevation || elevation.length < 2 || !elevation.some(pt => pt.hr)) {
    content.innerHTML = '<p class="no-data">Pas de données FC disponibles pour cette activité</p>';
    return;
  }

  const { zones } = computed;
  const times = computeHRZoneTimes(elevation, zones);
  const total = times.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    content.innerHTML = '<p class="no-data">Pas de données FC disponibles pour cette activité</p>';
    return;
  }
  // Barres a l'echelle de la zone dominante (histogramme comparatif) - le %
  // affiche a droite reste lui la part reelle du temps total, seul l'ecart
  // visuel des barres est relatif au max pour mieux distinguer les zones.
  const maxTime = Math.max(...times, 1);
  content.innerHTML = zones.map((z, i) => {
    const t = times[i];
    const pct = t / total * 100;
    const barPct = t / maxTime * 100;
    return `<div class="hrz-row">
      <div class="hrz-label">
        <span class="hrz-name">${z.name}</span>
        <span class="hrz-range">${z.low}-${z.high} bpm</span>
      </div>
      <div class="hrz-bar-wrap"><div class="hrz-track"><div class="hrz-fill" style="width:${barPct.toFixed(1)}%;background:${z.color}"></div></div></div>
      <div class="hrz-stats">${formatDuration(Math.round(t))} · ${Math.round(pct)}%</div>
    </div>`;
  }).reverse().join('');
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



// ─── Détection Circuits vs Intervalles ────────────────────
// Garmin Circuits = laps déclenchés par distance (tous ~1km)
// Garmin Intervalles = laps manuels avec distances variées
// Extrait de loadActivityAnalysis (etait une closure interne) pour etre
// reutilisable par le moteur de comparaison seance prevue/realisee (session-analysis.js)
// Une seance structuree (Garmin distingue explicitement les laps WARMUP/
// ACTIVE/RECOVERY/COOLDOWN, cas d'un entrainement guide envoye sur la montre)
// n'est JAMAIS un simple decoupage automatique au km, meme si les distances
// des blocs se ressemblent par coincidence (ex: 5' d'effort et 4' de recup a
// une allure proche produisent des laps de longueur similaire) — le tag
// Garmin explicite doit toujours primer sur l'heuristique de distance
// ci-dessous, sinon une vraie seance fractionnee (3x5' Seuil 60 par exemple)
// se fait classer a tort en "circuits" et perd toute son analyse par bloc.
function hasExplicitIntervalStructure(laps) {
  const tags = laps.map(l => {
    const raw = (typeof l.intensityType === 'string' ? l.intensityType : l.intensityType?.typeKey) || l.intensity || '';
    return raw.toLowerCase();
  });
  const hasActive = tags.some(t => t === 'active');
  const hasNonActive = tags.some(t => t === 'recovery' || t === 'rest' || t === 'warmup' || t === 'cooldown');
  return hasActive && hasNonActive;
}

function isKmCircuits(laps) {
  if (laps.length < 3) return false;
  if (hasExplicitIntervalStructure(laps)) return false;
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

function describeDuration(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = sec / 60;
  return `${Number.isInteger(min) ? min : min.toFixed(1)}min`;
}

// ─── Regroupement des efforts par duree similaire ────────────────────
// Une seance peut enchainer plusieurs types de repetition a des allures
// volontairement differentes (ex: 30s + 2min + 6min) : les traiter comme
// un seul bloc fausse regularite/derive/split. On les separe par duree
// (tolerance 20%, plancher 8s) et on classe chaque groupe dans sa zone.
function groupEffortsByDuration(effortEntries, vma, isTrail) {
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

async function loadActivityAnalysis(activity) {

  const panel = el('activity-analysis-panel');
  const analysisCard = el('activity-analysis-card');
  const lapsEl = el('activity-laps-table');
  const analysisEl = el('activity-analysis-text');
  const lapsFilterEl = el('activity-laps-filter');
  if (!panel || !activity?.id) return;
  panel.style.display = '';
  if (analysisCard) analysisCard.style.display = '';
  if (lapsFilterEl) lapsFilterEl.innerHTML = '';

  // Contexte pour la classification en zone (VMA du coureur + trail ou route)
  const activityTypeLower = (activity.activityType || '').toLowerCase();
  // Meme methode que pour les allures affichees dans le plan/l'analyse
  // seance prevue/realisee (cf isTrailSession, campus.js) : on se fie a ce
  // que la SEANCE declare (D+ attendu, bloc en cote, texte "cote/montee"),
  // jamais au D+ reellement grimpe pendant l'activite (un profil vallonne ne
  // signifie pas que la seance visait des allures ajustees) ni au seul type
  // Garmin de l'activite (une seance en cote peut tres bien etre enregistree
  // en type "Course"). Si cette activite est liee a une seance du plan, sa
  // detection cote/trail (deja calculee et stockee) fait autorite ; sinon on
  // retombe sur le type Garmin, seul signal disponible pour une sortie libre.
  const linkedRecord = (typeof _analysisIndex !== 'undefined') ? _analysisIndex.byActivity[String(activity.id)] : null;
  const isTrail = linkedRecord
    ? !!linkedRecord.sessionSnapshot?.isTrail
    : activityTypeLower.includes('trail');
  // Les zones d'allure (S60, AS10, EF...) sont calibrées sur la course à pied
  // — les appliquer à une autre activité (vélo, marche, cardio...) produirait
  // une analyse dénuée de sens (allure vélo comparée à une zone de course).
  // Tant que le vélo n'a pas sa propre analyse (§ non demandée pour l'instant),
  // ces activités se limitent aux statistiques basiques.
  const isRunActivity = activityTypeLower.includes('run') || isTrail;
  const _zoneProfile = loadProfileData();
  const vma = calcVMA(_latestVO2Max, _zoneProfile.sex || 'M');

  // ─── Analyse basique (fallback sans laps, ou activités non course à pied) ────────────────────
  function buildBasicAnalysis(act) {
    const insights = [];
    if (act.avgPaceSecPerKm > 0) insights.push(`Allure moyenne : <strong>${formatPace(act.avgPaceSecPerKm)}</strong>`);
    if (act.avgHR)      insights.push(`FC moyenne : <strong>${Math.round(act.avgHR)} bpm</strong>`);
    if (act.maxHR)      insights.push(`FC max : <strong>${Math.round(act.maxHR)} bpm</strong>`);
    if (act.distanceKm) insights.push(`Distance : <strong>${act.distanceKm.toFixed(2)} km</strong>`);
    if (act.calories)   insights.push(`Calories : <strong>${Math.round(act.calories)} kcal</strong>`);
    return insights;
  }

  if (!isRunActivity) {
    // Pas d'analyse par zone d'allure hors course à pied/trail (cf. plus
    // haut), mais Garmin envoie quand même des laps pour les autres sports
    // (auto-lap à distance fixe : ~5 km en vélo, ~1 km en marche/rando...) —
    // autant les afficher tels quels (tableau brut, sans interprétation)
    // plutôt que de masquer une donnée que Garmin fournit déjà.
    try {
      const result = await fetchJSON(`/api/activity/${activity.id}/laps`);
      const validLaps = Array.isArray(result?.laps) ? result.laps : [];
      if (validLaps.length > 0) {
        lapsEl.innerHTML = `
          <table class="laps-table">
            <thead><tr><th>Segment</th><th>Durée</th><th>Allure</th><th>FC</th></tr></thead>
            <tbody>${validLaps.map(lap => {
              const dur  = Math.round(lap.elapsedDuration || lap.movingDuration || lap.duration || 0);
              const pace = (lap.averageSpeed && lap.averageSpeed > 0) ? formatPace(1000/lap.averageSpeed) : '—';
              const hr   = lap.averageHR ? Math.round(lap.averageHR)+' bpm' : '—';
              const dist = lap.distance ? (lap.distance/1000).toFixed(2)+' km' : '—';
              return `<tr class="lap-row">
                <td>${dist}</td>
                <td>${formatDuration(dur)}</td>
                <td class="pace-value">${pace}</td>
                <td class="hr-value">${hr}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>`;
      } else {
        lapsEl.innerHTML = '<p class="no-data" style="font-size:11px">Intervalles non disponibles pour cette activité</p>';
      }
    } catch(e) {
      lapsEl.innerHTML = '<p class="no-data">Chargement impossible</p>';
      console.error('Laps error:', e);
    }
    const basics = buildBasicAnalysis(activity);
    analysisEl.innerHTML = basics.map(i=>`<div class="analysis-item">${i}</div>`).join('') || '<p class="no-data">Aucune donnée disponible</p>';
    return;
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
          // D+ affiche ici = activity.elevationGain (meme total que la carte d'activite) et
          // non une somme des elevationGain par lap, qui diverge legerement (arrondis/seuils
          // par lap) et affichait un chiffre different de celui de la carte au-dessus.
          const totalElevGain = activity.elevationGain || repLaps.reduce((s,l) => s + (l.elevationGain || 0), 0);
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
        const groups = groupEffortsByDuration(effortEntries, vma, isTrail);
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

        // Filtre par type de lap (petites vignettes colorees, meme teinte que
        // le fond des lignes .lap-warmup/.lap-effort/.lap-rest) - un seul type
        // affiche a la fois, re-cliquer sur le meme bouton revient a tout afficher.
        if (lapsFilterEl) {
          const filterBtns = [
            warmupLaps.length > 0 ? { type: 'warmup', label: 'ÉCH', title: 'Échauffement' } : null,
            effortEntries.length > 0 ? { type: 'effort', label: 'EFF', title: 'Effort' } : null,
            restLaps.length > 0 ? { type: 'rest', label: 'RÉC', title: 'Récupération' } : null,
          ].filter(Boolean);
          lapsFilterEl.innerHTML = filterBtns.map(b =>
            `<button type="button" class="laps-filter-btn" data-type="${b.type}" title="${b.title}">${b.label}</button>`
          ).join('');
          lapsFilterEl.querySelectorAll('.laps-filter-btn').forEach(btn => {
            btn.onclick = () => {
              const wasActive = btn.classList.contains('active');
              lapsFilterEl.querySelectorAll('.laps-filter-btn').forEach(b => b.classList.remove('active'));
              const rows = lapsEl.querySelectorAll('tbody tr');
              if (wasActive) {
                rows.forEach(r => { r.style.display = ''; });
              } else {
                btn.classList.add('active');
                rows.forEach(r => { r.style.display = r.classList.contains('lap-' + btn.dataset.type) ? '' : 'none'; });
              }
            };
          });
        }

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
  series.forEach(p => {
    const m = p.date?.slice(0,7);
    if (m) byMonth[m] = (typeof p.preciseValue === 'number') ? p.preciseValue : p.value;
  });
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


// La page Santé/Performance elle-même est rendue par renderHealthPage()
// dans health.js (chargé après ce fichier), qui remplace cette fonction.

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

// Statut d'entrainement : Garmin renvoie DEUX signaux independants pour un
// meme releve - "trainingStatus" (code numerique, categorie de fond a plus
// long terme) et "trainingStatusFeedbackPhrase" (categorie affichee en
// titre par Garmin, peut differer du code numerique : constate en reel,
// trainingStatus=3/Maintien avec phrase=OVERREACHING_1 en meme temps).
// Garmin affiche la PHRASE comme statut principal (confirme par capture :
// "Effort trop soutenu" en rouge alors que le code correspondait a
// "Maintien"), donc on indexe desormais uniquement par le prefixe de la
// phrase (avant le "_N" final) - jamais par le code numerique, qui n'est
// pas fiable pour l'affichage. Couleurs calees sur la legende officielle
// de l'app Garmin Connect (capture fournie par l'utilisateur, 23/08) -
// avant cela Maintien et Productif etaient tous deux verts (quasi
// indiscernables sur la bande "Statut d'entrainement"), et Desentrainement
// etait bleu (confondu avec Recuperation, bleu egalement).
const TRAINING_STATUS_MAP = {
  NO_STATUS:    { label: 'Aucun statut',        color: '#B0B4B8', tier: 'neutral' },
  DETRAINING:   { label: 'Désentraînement',      color: '#8B9299', tier: 'attention' },
  RECOVERY:     { label: 'Récupération',         color: '#3B82F6', tier: 'neutral' },
  MAINTAINING:  { label: 'Maintien',             color: '#F2C94C', tier: 'neutral' },
  PRODUCTIVE:   { label: 'Productif',            color: '#22C55E', tier: 'good' },
  PEAKING:      { label: 'Pic',                  color: '#8B5FBF', tier: 'good' },
  OVERREACHING: { label: 'Effort trop soutenu',  color: '#E8433A', tier: 'attention' },
  UNPRODUCTIVE: { label: 'Non productif',        color: '#E8833A', tier: 'attention' },
  STRAINED:     { label: 'Sous tension',         color: '#C2469C', tier: 'attention' },
};
function trainingStatusCategory(phrase) {
  // .trim().toUpperCase() : DETRAINING est bien dans TRAINING_STATUS_MAP,
  // donc un statut vu non traduit ("désentraînement" attendu, brut affiché)
  // est plus probablement un decalage de casse/espace cote Garmin (deja
  // vu : la meme donnee existe aussi sous forme "affichable" ailleurs dans
  // l'API, pas garantie majuscules strictes) qu'une cle reellement absente -
  // normaliser avant comparaison ne peut que rattraper ces cas, jamais nuire
  // (nos cles sont deja toutes en MAJUSCULES).
  const base = String(phrase || '').trim().toUpperCase().replace(/_\d+$/, '');
  return TRAINING_STATUS_MAP[base] || null;
}
// Repli si Garmin renvoie un libelle absent de TRAINING_STATUS_MAP (nouveau
// statut cote Garmin, pas encore rencontre) : plutot que d'afficher le code
// brut ("NO_RECENT_TRAINING_HISTORY") tel quel, on le rend lisible - pas
// une vraie traduction (on ne connait pas son sens), mais au moins un texte
// qui ne ressemble pas a une erreur et ne deborde plus du cadre (les
// espaces redonnent des points de coupure a la mise en page).
function prettifyUnknownTrainingStatus(phrase) {
  return String(phrase || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

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
      const info = trainingStatusCategory(tsJson.data.phrase) || { label: tsJson.data.phrase ? prettifyUnknownTrainingStatus(tsJson.data.phrase) : '—', color: '#9CA3AF' };
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

  const entries = Object.entries(breakdown)
    .filter(([,v]) => v.count > 0)
    .sort((a,b) => b[1].count - a[1].count);

  if (entries.length === 0) return;

  const labels = entries.map(([k]) => SPORT_TYPE_LABELS_FR[k] || k.replace(/_/g,' '));
  const values = entries.map(([,v]) => v.count);
  const colors = entries.map((_, i) => SPORT_TYPE_COLORS[i % SPORT_TYPE_COLORS.length]);

  if (sportsChart) sportsChart.destroy();
  sportsChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }]},
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
        <div class="legend-dot" style="background:${colors[i]}"></div>
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
      await Promise.all([loadAdminInfo(), loadAdminLogs(), loadAdminUsers()]);
    }
    // Santé/Performance : les catégories sont construites une seule fois par
    // session (_healthCategoryBuilt), il faut les invalider explicitement
    // pour qu'un refresh sur cette page ne reste pas figé sur les anciennes valeurs.
    if (typeof invalidateHealthCategories === 'function') {
      invalidateHealthCategories();
      if (document.getElementById('page-health')?.classList.contains('active') && typeof renderHealthCategory === 'function') {
        await renderHealthCategory();
      }
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

// ─── Historique du poids (serveur, pour suivi dans le temps + page Santé) ─
let _weightHistory = [];

async function loadWeightHistory() {
  try {
    const res = await fetch(`${API}/api/weight-history`);
    if (res.ok) _weightHistory = await res.json();
  } catch (e) { console.error('loadWeightHistory:', e); }
}

// Vrai si la dernière pesée date de 7 jours ou plus (ou si aucune pesée) —
// pilote a la fois la cloche de notification du menu Profil et l'encadré
// clignotant dans la page Profil (renderWeightReminder).
function isWeightReminderDue() {
  if (!_weightHistory.length) return false;
  const last = _weightHistory[_weightHistory.length - 1];
  const daysSince = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  return daysSince >= 7;
}

// Cloche de notification sur le menu Profil (sidebar) : profil incomplet OU
// pesée à mettre à jour. Appelée au chargement (checkStatus) et juste après
// une sauvegarde du profil, pour que la cloche disparaisse immédiatement.
function updateProfileBadge() {
  const profile = JSON.parse(localStorage.getItem('suivi_sport_profile') || '{}');
  const profileBadge = el('nav-profile-badge');
  if (!profileBadge) return;
  profileBadge.style.display =
    (!(profile.birthDate || profile.age) || !profile.height || !profile.weight || isWeightReminderDue())
      ? 'inline-flex' : 'none';
}

function renderWeightReminder() {
  const lastDateEl = el('profile-weight-lastdate');
  const reminderEl = el('profile-weight-reminder');
  if (!_weightHistory.length) {
    if (lastDateEl) lastDateEl.textContent = '';
    if (reminderEl) reminderEl.innerHTML = '';
    return;
  }
  const last = _weightHistory[_weightHistory.length - 1];
  const daysSince = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
  if (lastDateEl) lastDateEl.textContent = `(dernière saisie : ${formatDate(last.date)})`;
  if (reminderEl) {
    reminderEl.innerHTML = daysSince >= 7 ? `
      <div class="weight-loss-advice weight-loss-advice--blink" style="margin-top:10px">
        <div class="weight-loss-title">⚖️ Pensez à vous peser</div>
        <div class="weight-loss-items">
          <div class="weight-loss-item weight-loss-item--wrap">Dernière saisie il y a <span>${daysSince} jours</span> (${formatDate(last.date)}) — mettez à jour votre poids pour suivre son évolution</div>
        </div>
      </div>` : '';
  }
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

/** Estimation du temps de course en secondes depuis la VMA (deplacee ici
 *  depuis campus.js, seule source de verite : reutilisee par les
 *  projections d'objectifs ET le Predicteur de courses de la Synthese,
 *  memes chiffres partout pour un meme VO2max).
 *  Trail : methode km equivalents (1m D+ = 10m plat), standard trail francais */
function estimateRaceTime(vma, distKm, dplusM, isTrail) {
  if (!vma || !distKm) return null;
  const equivKm = (isTrail && dplusM > 0) ? distKm + dplusM / 100 : distKm;
  let pctVma = isTrail
    ? (distKm <= 21 ? 0.70 : distKm <= 42 ? 0.65 : distKm <= 80 ? 0.58 : 0.50)
    : (distKm <= 5  ? 0.97 : distKm <= 10 ? 0.90 : distKm <= 21.1 ? 0.83 : 0.76);
  return Math.round((equivKm / (vma * pctVma)) * 3600);
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
// Noms volontairement physiologiques (pas de mot d'allure/distance course :
// "Tempo", "Marathon", "Semi", "10km") — une zone FC et une zone d'allure
// (ALLURE_PLUS_ZONES, campus.js) ne se recouvrent jamais exactement (derive
// cardiaque, fatigue...), leur donner le même nom laisse croire à une
// correspondance stricte qui n'existe pas. allureZone : correspondance
// qualitative fournie par l'utilisateur (pas calculee) — affichee en plage,
// jamais en valeur unique, meme logique que fcZone sur ALLURE_PLUS_ZONES.
function calcHRZones(hrMax, hrRest) {
  const zones = [
    { name:'Z1 — Récupération',       pLow:0.50, pHigh:0.60, color:'#9ca3af', desc:'Effort très léger, récupération active', allureZone:'Récupération' },
    { name:'Z2 — Endurance aérobie',  pLow:0.60, pHigh:0.70, color:'#60a5fa', desc:'Effort facile, base aérobie', allureZone:'EF à Tempo' },
    { name:'Z3 — Endurance soutenue', pLow:0.70, pHigh:0.80, color:'#4ade80', desc:'Effort modéré, encore confortable', allureZone:'Tempo à AS21' },
    { name:'Z4 — Seuil',              pLow:0.80, pHigh:0.90, color:'#fb923c', desc:'Effort soutenu à difficile', allureZone:'AS21 à S30' },
    { name:'Z5 — VO₂max',             pLow:0.90, pHigh:1.00, color:'#f87171', desc:'Effort maximal, haute intensité', allureZone:'S30 à VMA' },
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
  renderWeightReminder();

  // VO2max depuis données Garmin — _latestVO2Max porte deja la valeur precise
  // (avec decimale) quand Garmin la fournit, cf. loadDashboard()
  const vo2 = _latestVO2Max;
  if (vo2) {
    const vo2color = vo2maxGarminColor(vo2, sex, age);
    setVal('profile-vo2-value', vo2.toFixed(1));
    const vo2El = el('profile-vo2-value');
    if (vo2El) vo2El.style.color = vo2color;
    setVal('profile-vo2-label', vo2maxLabel(vo2, sex, age));
    const barEl = el('profile-vo2-bar-wrap');
    if (barEl) barEl.innerHTML = renderVo2Bar(vo2, sex, age);
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
    // Allure EF : lue depuis ALLURE_PLUS_ZONES.EF (campus.js, source de
    // verite unique) plutot qu'un pourcentage fixe — evite de reafficher
    // une valeur figee qui se decale a chaque ajustement des zones d'allure.
    const efZone = (typeof ALLURE_PLUS_ZONES !== 'undefined') ? ALLURE_PLUS_ZONES.EF : null;
    const efPct = efZone ? efZone.pctHigh : null; // borne haute de l'EF (allure la plus soutenue de la zone)
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
      ${vma && efZone ? `
      <div class="profile-ind-card">
        <div style="display:flex;align-items:baseline;gap:4px">
          <div class="profile-ind-value">${Math.round(vma * efPct * 10) / 10}</div>
          <div class="profile-ind-unit">km/h</div>
        </div>
        <div class="profile-ind-label">Allure EF</div>
        <div class="profile-ind-sub">${Math.round(efZone.pctLow * 100)}–${Math.round(efZone.pctHigh * 100)}% VMA · ${formatPace(3600 / (vma * efPct))} min/km — endurance fond.</div>
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
    zonesEl.innerHTML = `<div class="hr-zones-list">
      ${zones.map(z => {
        const allureLabel = z.allureZone;
        const allureHTML = allureLabel ? `<div class="hr-zone-allure">Allure ≈ <b>${allureLabel}</b></div>` : '<div class="hr-zone-allure"></div>';
        return `
        <div class="hr-zone-row">
          <div class="hr-zone-dot" style="background:${z.color}"></div>
          <div class="hr-zone-name">${z.name}</div>
          <div class="hr-zone-range">${z.low} – ${z.high} bpm</div>
          ${allureHTML}
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

    // Ligne du tableau — CSS Grid (alignement parfait header+données) —
    // ref lu directement dans ALLURE_PLUS_ZONES (campus.js, source de
    // verite unique) via calcAllureRef/calcAllureRefTrail, memes fonctions
    // que la modale "Allures de course" (Objectifs) : les deux tableaux
    // affichent donc toujours des valeurs identiques par construction.
    const paceRow = (key) => {
      const ref = ALLURE_PLUS_ZONES[key];
      const note = ref.isSweetSpot ? '95% vitesse S60' : (Math.round(ref.pctLow * 100) + '–' + Math.round(ref.pctHigh * 100) + '% VMA');
      const road = calcAllureRef(key, vma);
      const routeCell = fmtPace(road.paceMin) + '<span class="rpt-dash"> – </span>' + fmtPace(road.paceMax);
      let trailCell;
      if (ref.trailCorr) {
        const trail = calcAllureRefTrail(key, vma);
        trailCell = fmtPace(trail.paceMin) + '<span class="rpt-dash"> – </span>' + fmtPace(trail.paceMax)
          + ' <span class="rpt-badge">+' + Math.round((trail.trailCorr || 0) * 100) + '%</span>';
      } else {
        trailCell = '<span class="rpt-na">–</span>';
      }

      return '<div class="rpt-row" style="border-left:3px solid ' + ref.color + '">'
        + '<div class="rpt-cell rpt-zone">'
          + '<div class="rpt-zone-name">' + ref.label + '</div>'
          + '<div class="rpt-zone-pct">' + note + '</div>'
        + '</div>'
        + '<div class="rpt-cell rpt-fczone">' + (ref.fcZone || '<span class="rpt-na">–</span>') + '</div>'
        + '<div class="rpt-cell rpt-route">' + routeCell + '</div>'
        + '<div class="rpt-cell rpt-trail">' + trailCell + '</div>'
        + '</div>';
    };

    racePacesEl.innerHTML =
      '<div class="rpt-table">'
      + '<div class="rpt-head">'
        + '<div class="rpt-cell rpt-zone">Zone</div>'
        + '<div class="rpt-cell rpt-fczone">Zone FC associée</div>'
        + '<div class="rpt-cell rpt-route">' + personEmoji('running') + ' Route <span class="rpt-unit-hd">/km</span></div>'
        + '<div class="rpt-cell rpt-trail">🏔 Trail <span class="rpt-unit-hd">/km</span></div>'
      + '</div>'
      + paceRow('EF')
      + paceRow('TEMPO')
      + paceRow('AS42')
      + paceRow('SWEET_SPOT')
      + paceRow('AS21')
      + '<div class="rpt-sep"></div>'
      + paceRow('S60')
      + paceRow('AS10')
      + paceRow('S30')
      + '<div class="rpt-sep"></div>'
      + paceRow('VMA')
      + '</div>';
  } else if (racePacesEl) {
    racePacesEl.innerHTML = '<div class="profile-indicator-empty">Synchronisez Garmin pour calculer vos allures</div>';
  }

  // Conseils personnalis\u00e9s
  renderProfileAdvice();

  // Applications connect\u00e9es
  renderProfileApps();

  // \u00c9quipement (chaussures)
  if (typeof initGearSection === 'function') initGearSection();
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
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = {
        sex:    _sex,
        birthDate: el('input-birthdate')?.value || null,
        height: parseFloat(el('input-height')?.value) || null,
        weight: parseFloat(el('input-weight')?.value) || null,
        hrmax:  parseInt(el('input-hrmax')?.value)  || null,
      };
      saveProfileData(data);
      if (data.weight) {
        try {
          const res = await fetch(`${API}/api/weight-history`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight: data.weight }),
          });
          if (res.ok) _weightHistory = (await res.json()).history;
        } catch (err) { console.error('weight-history save:', err); }
      }
      renderProfile();
      applyGenderedEmojis();
      updateProfileBadge();
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

    // Campus masque au niveau du compte (cf campusVisibleForSession, server.js) :
    // pas juste "non connecte", carrement hors sujet pour ce profil - la ligne
    // entiere disparait, sans meme proposer le bouton "je n'ai pas de compte".
    if (status && status.campusEnabled === false && !status.connected) {
      if (campusRow) campusRow.style.display = 'none';
      return;
    }

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
  // Le curseur de l'interrupteur (theme-toggle-thumb) glisse via CSS
  // ([data-theme="dark"] .theme-toggle-thumb, style.css) - rien a faire ici,
  // seul l'attribut data-theme compte.
}

function initThemeToggle() {
  const saved = localStorage.getItem('allure_theme') || 'light';
  applyTheme(saved);
  const btnLight = document.getElementById('btn-theme-light');
  const btnDark = document.getElementById('btn-theme-dark');
  if (btnLight) btnLight.addEventListener('click', () => applyTheme('light'));
  if (btnDark) btnDark.addEventListener('click', () => applyTheme('dark'));
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
  if (images.length === 1) {
    layerA.style.backgroundImage = `url('${images[0]}')`;
    layerA.style.transition = 'none';
    layerA.classList.add('active');
    return;
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
// PPS (Pass Prévention Santé) — jusqu'à 2, bouton unique sous l'avatar
// ══════════════════════════════════════════════════════
const PPS_ICON_COPY  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const PPS_ICON_TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const PPS_DOT_COLOR = { empty: '#94A3B8', unknown: '#94A3B8', green: '#16A34A', orange: '#D97706', red: '#DC2626' };

let _ppsList = [];
let _ppsEditingId = null;

function ppsStatus(entry) {
  if (!entry) return 'empty';
  if (!entry.expiryDate) return 'unknown';
  const expiry = new Date(entry.expiryDate);
  const now = new Date();
  const oneMonthBefore = new Date(expiry);
  oneMonthBefore.setMonth(oneMonthBefore.getMonth() - 1);
  if (now >= expiry) return 'red';
  if (now >= oneMonthBefore) return 'orange';
  return 'green';
}

// Couleur du bouton = statut le plus urgent parmi les PPS charges
function ppsGlobalStatus() {
  if (!_ppsList.length) return 'empty';
  const rank = { red: 0, orange: 1, unknown: 2, green: 3 };
  return _ppsList.map(ppsStatus).sort((a, b) => rank[a] - rank[b])[0];
}

function renderPpsButton() {
  const btn = el('pps-btn');
  if (!btn) return;
  btn.className = 'pps-btn pps-btn--' + ppsGlobalStatus();
  btn.title = _ppsList.length ? _ppsList.map(e => e.lastName || e.number || 'PPS').join(' · ') : 'Ajouter un PPS';
}

async function loadPpsList() {
  try { _ppsList = await fetch(`${API}/api/pps`).then(r => r.json()); }
  catch (e) { _ppsList = []; }
  renderPpsButton();
}

function closePpsPanel() {
  const panel = el('pps-panel');
  if (panel) panel.style.display = 'none';
  _ppsEditingId = null;
}

function renderPpsEntryEditForm(entry) {
  return `
    <div class="pps-entry-block">
      <div class="pps-panel-title">Vérifier les informations du PPS</div>
      <div class="form-row">
        <span class="form-label">Nom</span>
        <input type="text" class="form-input" id="pps-edit-lastname-${entry.id}" style="max-width:100%" value="${escapeHtml(entry.lastName || '')}" placeholder="Ex : Martin" />
      </div>
      <div class="form-row">
        <span class="form-label">Numéro PPS</span>
        <input type="text" class="form-input" id="pps-edit-number-${entry.id}" style="max-width:100%" value="${escapeHtml(entry.number || '')}" placeholder="Ex : P2FE48867F8" />
      </div>
      <div class="form-row">
        <span class="form-label">Date de validité</span>
        <input type="date" class="form-input" id="pps-edit-date-${entry.id}" style="max-width:100%" value="${entry.expiryDate || ''}" />
      </div>
      <div class="pps-panel-actions">
        <button type="button" class="btn-text-link" data-action="cancel-edit" data-id="${entry.id}">Annuler</button>
        <button type="button" class="btn-wizard-next" data-action="save-edit" data-id="${entry.id}" style="margin-left:auto">Enregistrer</button>
      </div>
    </div>`;
}

function renderPpsEntryView(entry) {
  const dateLabel = entry.expiryDate ? formatDate(entry.expiryDate) : 'Non renseignée';
  const status = ppsStatus(entry);
  return `
    <div class="pps-entry-block">
      <div class="pps-entry-name">
        <span class="pps-entry-dot" style="background:${PPS_DOT_COLOR[status]}"></span>
        ${escapeHtml(entry.lastName || 'PPS')}
      </div>
      <div class="pps-panel-row">
        <span class="pps-panel-label">N° PPS</span>
        <span class="pps-panel-value">${escapeHtml(entry.number || '—')}</span>
        <button type="button" class="pps-copy-btn" data-action="copy" data-id="${entry.id}" title="Copier le numéro">${PPS_ICON_COPY}</button>
      </div>
      <div class="pps-panel-row">
        <span class="pps-panel-label">Validité</span>
        <span class="pps-panel-value">${dateLabel}</span>
      </div>
      <div class="pps-panel-actions">
        <a href="/uploads/${encodeURIComponent(entry.filename)}" target="_blank" rel="noopener" class="btn-text-link">Télécharger le PDF</a>
        <button type="button" class="btn-text-link" data-action="edit" data-id="${entry.id}">Corriger</button>
        <button type="button" class="pps-delete-btn" data-action="delete" data-id="${entry.id}" title="Supprimer">${PPS_ICON_TRASH}</button>
      </div>
    </div>`;
}

function renderPpsPanel() {
  const panel = el('pps-panel');
  if (!panel) return;
  let html = '';
  if (!_ppsList.length) {
    html += '<div class="pps-empty-state">Aucun PPS enregistré</div>';
  } else {
    html += _ppsList.map(entry => entry.id === _ppsEditingId ? renderPpsEntryEditForm(entry) : renderPpsEntryView(entry)).join('');
  }
  if (_ppsList.length < 2) {
    html += `<button type="button" class="pps-add-btn" id="pps-add-btn">+ Ajouter ${_ppsList.length ? 'un second PPS' : 'un PPS'}</button>`;
  }
  panel.innerHTML = html;

  panel.querySelectorAll('[data-action="edit"]').forEach(b => b.onclick = () => { _ppsEditingId = b.dataset.id; renderPpsPanel(); });
  panel.querySelectorAll('[data-action="cancel-edit"]').forEach(b => b.onclick = () => { _ppsEditingId = null; renderPpsPanel(); });
  panel.querySelectorAll('[data-action="copy"]').forEach(b => b.onclick = () => {
    const entry = _ppsList.find(e => e.id === b.dataset.id);
    navigator.clipboard.writeText(entry?.number || '').then(() => showToast('Numéro copié', 'success'));
  });
  panel.querySelectorAll('[data-action="delete"]').forEach(b => b.onclick = async () => {
    const ok = await showConfirmModal({ title: 'Supprimer ce PPS ?', message: 'Le document sera définitivement supprimé.', confirmLabel: 'Supprimer', danger: true, icon: PPS_ICON_TRASH });
    if (!ok) return;
    await fetch(`${API}/api/pps/${b.dataset.id}`, { method: 'DELETE' });
    await loadPpsList();
    renderPpsPanel();
  });
  panel.querySelectorAll('[data-action="save-edit"]').forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const lastName = el(`pps-edit-lastname-${id}`).value.trim();
    const number = el(`pps-edit-number-${id}`).value.trim();
    const expiryDate = el(`pps-edit-date-${id}`).value;
    try {
      const res = await fetch(`${API}/api/pps/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastName, number, expiryDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      _ppsEditingId = null;
      await loadPpsList();
      showToast('PPS mis à jour', 'success');
      renderPpsPanel();
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  });
  const addBtn = el('pps-add-btn');
  if (addBtn) addBtn.onclick = () => el('pps-file-input').click();
}

function openPpsPanel() {
  const panel = el('pps-panel');
  const btn = el('pps-btn');
  if (!panel || !btn) return;
  if (panel.style.display !== 'none') { closePpsPanel(); return; }
  const rect = btn.getBoundingClientRect();
  panel.style.display = '';
  panel.style.top = (rect.bottom + 8) + 'px';
  panel.style.right = (window.innerWidth - rect.right) + 'px';
  renderPpsPanel();
}

function initPpsButtons() {
  const btn = el('pps-btn');
  const fileInput = el('pps-file-input');
  if (btn) btn.addEventListener('click', openPpsPanel);

  if (fileInput) fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('pdf', file);
    try {
      showToast('Import du PPS en cours…', 'loading', 0);
      const res = await fetch(`${API}/api/pps`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      await loadPpsList();
      showToast('PPS importé', 'success');
      _ppsEditingId = (!data.entry.number || !data.entry.expiryDate) ? data.entry.id : null;
      if (el('pps-panel').style.display === 'none') openPpsPanel(); else renderPpsPanel();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  });

  document.addEventListener('click', (e) => {
    const panel = el('pps-panel');
    if (panel && panel.style.display !== 'none' && !panel.contains(e.target) && e.target.id !== 'pps-btn') {
      closePpsPanel();
    }
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
  attachBackdropClose(bd, closeBgManagerModal);
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
  const navSupportAdmin = document.getElementById('nav-support-admin');
  if (navSupportAdmin && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    navSupportAdmin.style.display = 'flex';
    if (typeof checkSupportAdminNotifications === 'function') checkSupportAdminNotifications();
  }
  const plansTracker = document.getElementById('plans-admin-tracker');
  if (plansTracker && userEmail && userEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    plansTracker.style.display = '';
  }
}

// ══════════════════════════════════════════════════════
// TAMPON "PREF 2"
// ══════════════════════════════════════════════════════
async function loadPref2State() {
  try {
    const res = await fetch(`${API}/api/pref2`);
    if (!res.ok) return;
    const data = await res.json();

    const row = el('pref2-row');
    if (row) row.style.display = data.canEdit ? 'flex' : 'none';

    const tampon = el('pref2-tampon');
    if (tampon) tampon.style.display = data.enabled ? 'block' : 'none';

    const checkbox = el('input-pref2');
    if (checkbox) {
      checkbox.checked = !!data.enabled;
      if (!checkbox.dataset.pref2Bound) {
        checkbox.dataset.pref2Bound = '1';
        checkbox.addEventListener('change', async () => {
          try {
            const r = await fetch(`${API}/api/pref2`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled: checkbox.checked })
            });
            const d = await r.json();
            if (tampon) tampon.style.display = d.enabled ? 'block' : 'none';
          } catch (e) {}
        });
      }
    }
  } catch (e) {}
}

// Implémentation réelle dans campus.js (a besoin de campusState.goal/weeks,
// le plan tel qu'affiché à l'écran - voir la fonction là-bas pour le detail)

// Bandeau compact toujours visible (voyant + version + uptime) - le detail
// (cartes Serveur/Connexions/Logs/D+ trail) reste disponible derriere
// "Diagnostics", replie par defaut (retour utilisateur 14/08).
function wireAdminDiagToggle() {
  const btn = document.getElementById('admin-diag-toggle');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  const chevron = document.getElementById('admin-diag-chevron');
  btn.onclick = () => {
    const diag = document.getElementById('admin-diagnostics');
    if (!diag) return;
    const open = diag.style.display === 'none';
    diag.style.display = open ? '' : 'none';
    if (chevron) chevron.textContent = open ? '▴' : '▾';
  };
}

// Meme mecanisme que wireAdminDiagToggle ci-dessus, pour le repli/depli du
// tableau Utilisateurs (replie par defaut, demande utilisateur 20/08) - le
// chargement des donnees (loadAdminUsers) reste independant de la visibilite.
function wireAdminUsersToggle() {
  const header = document.getElementById('admin-users-header');
  if (!header || header.dataset.wired) return;
  header.dataset.wired = '1';
  const chevron = document.getElementById('admin-users-chevron');
  header.onclick = () => {
    const body = document.getElementById('admin-users-body');
    if (!body) return;
    const open = body.style.display === 'none';
    body.style.display = open ? '' : 'none';
    if (chevron) chevron.textContent = open ? '▴' : '▾';
  };
}

async function loadAdminInfo() {
  wireAdminDiagToggle();
  try {
    const data = await fetch('/api/admin-info').then(r => r.json());

    // Bandeau compact
    const stripDot  = document.getElementById('admin-strip-dot');
    const stripText = document.getElementById('admin-strip-text');
    if (stripDot)  stripDot.className = 'admin-status-strip-dot admin-status-strip-dot--ok';
    if (stripText) {
      const version = document.getElementById('app-version')?.textContent || '';
      stripText.textContent = `Serveur actif ${version ? '· ' + version + ' ' : ''}· uptime ${data.server.uptime}`;
    }

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

// Repertoire des utilisateurs (voir server.js /api/admin/users, relais
// support-relay routes /users/*) - ecran principal de la page Admin.
async function loadAdminUsers() {
  wireAdminUsersToggle();
  const wrap = document.getElementById('admin-users-table');
  if (!wrap) return;
  wrap.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const { users } = await fetch(`${API}/api/admin/users`).then(r => r.json());
    if (!users || users.length === 0) {
      wrap.innerHTML = '<div class="support-empty">Aucun utilisateur pour le moment.</div>';
      return;
    }
    wrap.innerHTML = `
      <div class="admin-users-table-wrap">
        <table class="admin-users-table">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Nom Garmin</th>
              <th>1ère connexion</th>
              <th>Dernière connexion</th>
              <th>Accès tickets</th>
              <th>Accès Allure+</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr class="admin-users-row-clickable ${u.blocked ? 'admin-users-row--blocked' : ''}" data-email="${escapeHtml(u.email)}">
                <td class="admin-users-email"><span class="admin-users-chevron">&#9656;</span>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.displayName || '—')}</td>
                <td>${formatDate(u.firstSeen)}</td>
                <td>${formatDateTime(u.lastSeen)}</td>
                <td>
                  <label class="admin-users-checkbox" onclick="event.stopPropagation()">
                    <input type="checkbox" data-email="${escapeHtml(u.email)}" data-field="ticketAccess" ${u.ticketAccess !== false ? 'checked' : ''} title="Peut prendre jusqu'à 2 minutes pour s'appliquer si ce compte est déjà connecté">
                  </label>
                </td>
                <td>
                  <button class="admin-users-block-btn ${u.blocked ? 'admin-users-block-btn--blocked' : ''}" data-email="${escapeHtml(u.email)}" type="button" onclick="event.stopPropagation()">
                    ${u.blocked ? '🔒 Bloqué — débloquer' : '🔓 Bloquer'}
                  </button>
                </td>
              </tr>
              <tr class="admin-users-detail-row">
                <td colspan="6">
                  <div class="admin-users-detail-panel"></div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    // Depli/repli fiche detaillee (fondu, cf. .admin-users-detail-panel) -
    // fetch paresseux au premier clic seulement (cache dans le dataset de la
    // ligne), pas un appel par utilisateur liste des l'ouverture de la page.
    wrap.querySelectorAll('tr.admin-users-row-clickable').forEach(row => {
      row.addEventListener('click', () => toggleAdminUserDetail(row));
    });

    wrap.querySelectorAll('input[data-field="ticketAccess"]').forEach(cb => {
      cb.onchange = async () => {
        cb.disabled = true;
        try {
          await fetch(`${API}/api/admin/users/${encodeURIComponent(cb.dataset.email)}/ticket-access`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticketAccess: cb.checked }),
          });
          showToast('Accès tickets mis à jour', 'success');
        } catch (e) {
          showToast('Erreur : ' + e.message, 'error');
          cb.checked = !cb.checked;
        }
        cb.disabled = false;
      };
    });
    wrap.querySelectorAll('.admin-users-block-btn').forEach(btn => {
      btn.onclick = async () => {
        const email = btn.dataset.email;
        const willBlock = !btn.classList.contains('admin-users-block-btn--blocked');
        if (willBlock) {
          const ok = await showConfirmModal({
            title: 'Bloquer ce compte ?',
            message: `${email} ne pourra plus se connecter à Allure+ tant que vous ne le débloquez pas (coupure sous quelques minutes si déjà connecté).`,
            confirmLabel: 'Bloquer', danger: true, icon: '🔒',
          });
          if (!ok) return;
        }
        btn.disabled = true;
        try {
          await fetch(`${API}/api/admin/users/${encodeURIComponent(email)}/block`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocked: willBlock }),
          });
          loadAdminUsers();
        } catch (e) {
          showToast('Erreur : ' + e.message, 'error');
          btn.disabled = false;
        }
      };
    });
  } catch (e) {
    wrap.innerHTML = '<div class="support-empty">Impossible de charger les utilisateurs.</div>';
  }
}

// Depli/repli avec fondu (voir .admin-users-detail-panel, style.css) - une
// seule fiche ouverte a la fois (plus lisible qu'un empilement de plusieurs
// fiches). Fetch paresseux : /api/admin/users/:email/details n'est appele
// qu'au tout premier depli de CETTE ligne (panel.dataset.loaded), jamais au
// chargement de la liste - decrit dans server.js (pullEnvelope sync-relay,
// pas de Worker a redeployer, portee volontairement limitee : VO2max,
// sexe/age, plan suivi, assiduite - rien d'autre, cf. echange utilisateur).
async function toggleAdminUserDetail(row) {
  const email = row.dataset.email;
  const detailRow = row.nextElementSibling;
  const panel = detailRow?.querySelector('.admin-users-detail-panel');
  if (!panel) return;
  const isOpen = panel.classList.contains('admin-users-detail-panel--open');

  document.querySelectorAll('.admin-users-detail-panel--open').forEach(p => {
    if (p !== panel) {
      p.classList.remove('admin-users-detail-panel--open');
      p.closest('tr').previousElementSibling?.querySelector('.admin-users-chevron')?.classList.remove('admin-users-chevron--open');
    }
  });

  panel.classList.toggle('admin-users-detail-panel--open', !isOpen);
  row.querySelector('.admin-users-chevron')?.classList.toggle('admin-users-chevron--open', !isOpen);

  if (!isOpen && !panel.dataset.loaded) {
    panel.dataset.loaded = '1';
    panel.innerHTML = '<div class="admin-users-detail-loading">Chargement…</div>';
    try {
      const details = await fetch(`${API}/api/admin/users/${encodeURIComponent(email)}/details`).then(r => r.json());
      panel.innerHTML = renderAdminUserDetail(details);
    } catch (e) {
      panel.innerHTML = '<div class="admin-users-detail-loading">Impossible de charger la fiche.</div>';
      panel.dataset.loaded = '';
    }
  }
}

// Couleurs par seuil d'assiduité - reprend EXACTEMENT celles de fillBucket
// (page Objectifs, frontend/js/campus.js) pour rester visuellement cohérent
// entre les deux endroits où ce même chiffre peut apparaître.
function adminAssiduityColor(pct) {
  if (pct == null) return '';
  return pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
}

// Toujours exactement les 6 mêmes tuiles, dans le même ordre, pour tout le
// monde - avec "—" en valeur plutôt qu'une tuile absente quand une donnée
// manque (retour utilisateur explicite : le format doit être identique
// d'une fiche à l'autre, pas 3 tuiles pour l'un et 5 pour l'autre).
function renderAdminUserDetail(d) {
  const items = [];
  items.push({ label: 'Sexe', value: d.profile?.sex === 'M' ? 'Homme' : d.profile?.sex === 'F' ? 'Femme' : '—' });
  items.push({ label: 'Âge', value: d.profile?.age != null ? d.profile.age + ' ans' : '—' });

  // Unité et date en plus petit/atténué (admin-users-detail-sub) - demande
  // utilisateur explicite, la valeur elle-même reste seule mise en avant.
  items.push({
    label: 'VO₂max',
    value: d.vo2max != null
      ? `${d.vo2max.toFixed(1)}<span class="admin-users-detail-sub"> mL/kg/min${d.vo2maxDate ? ' · ' + formatDate(d.vo2maxDate) : ''}</span>`
      : '—',
  });

  // "default" = aucune trace locale trouvée (ni plan importé, ni séances
  // libres) - PAS présumé "Plan Campus Coach" comme avant (bug réel corrigé
  // côté serveur, cf. server.js) : Campus Coach est de toute façon
  // techniquement inaccessible à tout compte autre que CAMPUS_VISIBLE_EMAIL.
  let planLabel = '—', planSub = '';
  if (d.plan?.type === 'imported') {
    planLabel = 'Plan importé — ' + ([d.plan.raceName, d.plan.label].filter(Boolean).join(' · ') || 'sans détail');
    const parts = [];
    if (d.plan.weeksTotal) parts.push(`${d.plan.weeksTotal} semaines`);
    if (d.plan.sessionsPerWeek) parts.push(`${d.plan.sessionsPerWeek} j/sem`);
    if (parts.length) planSub = `<span class="admin-users-detail-sub">${parts.join(' · ')}</span>`;
  } else if (d.plan?.type === 'free') planLabel = 'Séances libres (par défaut)';
  else if (d.plan?.type === 'campus') planLabel = 'Plan Campus Coach';
  else if (d.plan?.type === 'default') planLabel = 'Plan par défaut Allure+';
  items.push({ label: 'Plan suivi', value: planLabel + (planSub ? `<br>${planSub}` : '') });

  items.push({ label: 'Assiduité course', value: d.adherenceCardio != null ? d.adherenceCardio + '%' : '—', color: adminAssiduityColor(d.adherenceCardio) });
  items.push({ label: 'Assiduité renfo', value: d.adherenceStrength != null ? d.adherenceStrength + '%' : '—', color: adminAssiduityColor(d.adherenceStrength) });

  return `<div class="admin-users-detail-grid">${items.map(i => `
    <div class="admin-users-detail-item">
      <div class="admin-users-detail-label">${i.label}</div>
      <div class="admin-users-detail-value"${i.color ? ` style="color:${i.color}"` : ''}>${i.value}</div>
    </div>`).join('')}</div>`;
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
  // Recharge depuis le serveur les cles localStorage "durables" manquantes
  // (profil, objectifs...) AVANT tout le reste de l'init — cf commentaire
  // pres de DURABLE_LS_KEYS plus haut dans ce fichier.
  _userDataSyncPromise = syncUserDataFromServer();
  try { await _userDataSyncPromise; } catch (e) { console.error('syncUserDataFromServer (boot):', e); }

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
  try { await loadWeightHistory(); } catch(e) { console.error('loadWeightHistory failed:', e); }
  try { initAvatarUpload(); loadAvatar(); } catch(e) { console.error('initAvatarUpload failed:', e); }
  try { initPpsButtons(); loadPpsList(); } catch(e) { console.error('initPpsButtons failed:', e); }
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

  // Quitter l'application : arrête node.exe (voir /api/quit, server.js) puis
  // referme la fenêtre — l'appli tourne dans une fenêtre Chrome/Edge "--app="
  // indépendante du process serveur (start.bat), donc fermer juste la fenêtre
  // avec la croix laisse habituellement node.exe tourner en tâche de fond.
  const quitBtn = el('btn-quit-app');
  if (quitBtn) {
    quitBtn.addEventListener('click', async () => {
      const ok = typeof showConfirmModal === 'function'
        ? await showConfirmModal({
            title: 'Quitter Allure+ ?',
            message: 'Le serveur va s\'arrêter et la fenêtre va se fermer.',
            confirmLabel: 'Quitter', cancelLabel: 'Annuler', danger: true,
            icon: '<img class="confirm-modal-icon-img confirm-modal-icon-img--light" src="images/picto/quit_light.png" alt="">'
                + '<img class="confirm-modal-icon-img confirm-modal-icon-img--dark" src="images/picto/quit_dark.png" alt="">',
          })
        : confirm('Quitter Allure+ ?\nLe serveur va s\'arrêter et la fenêtre va se fermer.');
      if (!ok) return;
      quitBtn.classList.add('quitting');
      quitBtn.querySelector('span').textContent = 'Fermeture…';
      try {
        await fetch(`${API}/api/quit`, { method: 'POST' });
      } catch {}
      // window.close() n'aboutit que si la fenêtre a été ouverte par un
      // script OU s'il s'agit d'une fenêtre "app" sans onglets (notre cas,
      // cf --app= dans open_browser.ps1) — sinon Chrome l'ignore
      // silencieusement ; dans ce cas on laisse un message clair plutôt que
      // rien ne se passer sans explication.
      window.close();
      setTimeout(() => {
        quitBtn.classList.remove('quitting');
        quitBtn.querySelector('span').textContent = 'Quitter l\'application';
        if (typeof showToast === 'function') showToast('Serveur arrêté — vous pouvez fermer cette fenêtre', 'success');
      }, 600);
    });
  }

  // Voir tout → naviguer vers Activités
  const seeAll = el('see-all-runs');
  if (seeAll) seeAll.addEventListener('click', () => navigateTo('activities'));

  // Filtres page activités (sport type, multi-selection)
  wireSportFilterPills(el('activity-filters'), (filters) => {
    renderAllActivities(_allActivities, filters);
    // La vue calendrier suit le meme filtre sport (puces + totaux semaine/mois)
    // quand elle est active - inutile de la recalculer si elle est cachee.
    if (typeof renderActivitiesCalendar === 'function' && el('activities-calendar-card') && !el('activities-calendar-card').classList.contains('act-view-hidden')) {
      renderActivitiesCalendar();
    }
  });

  // TASK 4 — Year/month selectors re-render with current sport filter
  function getCurrentSportFilter() {
    return getActiveSportFilters(el('activity-filters'));
  }

  const filterYear  = el('filter-year');
  const filterMonth = el('filter-month');
  // Overlay chargement année à la demande
  function showYearLoading(year) {
    const tbody = document.querySelector('#all-activities-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:48px 20px;">' +
      '<div style="font-size:36px;margin-bottom:14px">&#x1F4E5;</div>' +
      '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Chargement de ' + year + '</div>' +
      '<div style="font-size:13px;color:var(--text-secondary)">Récupération de vos activités Garmin — merci de patienter...</div>' +
    '</td></tr>';
  }

  // "Toutes les années" (valeur vide du filtre) affichait un total qui ne
  // reflétait que ce qui se trouvait déjà en mémoire pour cette session
  // (les 200 activités les plus récentes au démarrage, + les années
  // visitées entre-temps) - jamais le veritable historique complet tant que
  // la page Statistiques (qui charge tout automatiquement) n'avait pas ete
  // visitee au moins une fois. Retour utilisateur 14/08 : total tres
  // inferieur a celui annonce par Garmin. Charge desormais toutes les
  // annees manquantes (reutilise ensureYearLoaded/getStatsYearRange de
  // stats.js, meme mecanisme que la page Statistiques) avant de calculer
  // le total "Toutes les années".
  async function loadAllYearsForActivitiesTotal() {
    if (typeof getStatsYearRange !== 'function' || typeof ensureYearLoaded !== 'function') return;
    const missing = getStatsYearRange().filter(y => !_fullyLoadedYears.has(y));
    if (!missing.length) return;
    const loadTbody = document.getElementById('all-activities-tbody');
    if (loadTbody) {
      loadTbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:48px 20px;">' +
        '<div style="font-size:36px;margin-bottom:14px">&#x1F4E5;</div>' +
        '<div style="font-size:16px;font-weight:700;color:var(--text-primary);margin-bottom:6px">Chargement de l\'historique complet</div>' +
        '<div style="font-size:13px;color:var(--text-secondary)">Récupération de toutes vos années Garmin — merci de patienter...</div>' +
      '</td></tr>';
    }
    showToast('⏳ Chargement de l\'historique complet…', 'loading', 0);
    let stillMissing = [];
    try {
      // loadYearsWithRetry (stats.js, deja confirmee disponible par la garde
      // en tete de fonction) retente jusqu'a 2 fois les annees en echec
      // avant d'abandonner - un hoquet reseau/Garmin transitoire ne doit pas
      // laisser une annee durablement manquante pour le reste de la session
      // (bug reel constate : historique parfois incomplet, seul un
      // relancement complet de l'appli reglait le probleme).
      stillMissing = await loadYearsWithRetry(missing);
    } finally {
      const lt = document.getElementById('app-toast-loading');
      if (lt) { lt.style.opacity = '0'; setTimeout(() => lt.remove(), 300); }
    }
    if (stillMissing.length) {
      showToast(`⚠ Certaines années n'ont pas pu être chargées (${stillMissing.join(', ')})`, 'error', 6000);
    } else {
      showToast('✓ Historique complet chargé', 'success', 4000);
    }
  }

  if (filterYear) filterYear.addEventListener('change', async () => {
    const year = parseInt(filterYear.value) || 0;
    if (!year) {
      await loadAllYearsForActivitiesTotal();
    } else if (!_fullyLoadedYears.has(year)) {
      // Afficher le chargement dans la table (ID correct)
      const loadTbody = document.getElementById('all-activities-tbody');
      if (loadTbody) {
        loadTbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:48px 20px;">' +
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
    _calSyncFromActivityFilters();
  });
  if (filterMonth) filterMonth.addEventListener('change', () => {
    renderAllActivities(_allActivities, getCurrentSportFilter());
    _calSyncFromActivityFilters();
  });
  const filterSearch = el('filter-search');
  if (filterSearch) filterSearch.addEventListener('input', () => renderAllActivities(_allActivities, getCurrentSportFilter()));
  // Status + chargement initial
  await checkStatus();
  // Non-bloquant : le voyant de synchro cloud est un filet de securite en
  // arriere-plan, pas ce qui alimente l'affichage (les donnees locales sont
  // deja a jour independamment du resultat) - inutile de retarder le
  // chargement du dashboard pour lui.
  checkSyncStatus();
  setInterval(checkSyncStatus, 60000);
  await Promise.all([loadDashboard(), loadHeartRate(), loadSleep(), loadWellnessRow()]);
  if (typeof loadAnalysisIndex === 'function') loadAnalysisIndex();

  // Initialiser le sélecteur d'années complet (2010 → année courante)
  populateYearSelector();
  // Sélectionner l'année courante par défaut
  const defYearSel = el('filter-year');
  if (defYearSel && !defYearSel.value) {
    defYearSel.value = String(new Date().getFullYear());
  }
  renderAllActivities(_allActivities, 'all');
});
