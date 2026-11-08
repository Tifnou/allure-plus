// ============================================================
// routine_share.js — Partage d'une routine "hors plan" (v2.6.0)
//
// Principe : le compte admin (animateur) publie ses semaines (fiches de BASE,
// jamais ses variantes) dans son espace du relais de synchro ; les suiveurs
// invités les lisent et les posent dans leur propre magasin `suivi_free_routine`
// à côté de leurs semaines. Les séances sont des DSL à codes d'allure (pas des
// allures absolues) : chacun les voit avec SES allures (VMA), SES variantes,
// SON pointage "fait" / "passer".
//
// Ce fichier contient d'abord la partie PURE (publication, fusion, assainissement
// — testée par tests/routine_share.test.js), puis l'interface (modale animateur,
// invitation et quitter côté suiveur, relève périodique).
// Dépend de free_sessions.js / routine_engine.js / campus.js pour la partie UI.
// ============================================================

const ROUTINE_SHARE_KEY = 'suivi_routine_share';        // état côté suiveur (clé durable : suit le compte)
const ROUTINE_SHARE_MAX_WEEKS = 6;
const ROUTINE_SHARE_MAX_RECIPIENTS = 20;
const WEEK_MS = 7 * 86400000;

function _rsClean(s, max) {
  return String(s == null ? '' : s).replace(/[<>&"'`]/g, '').slice(0, max || 80);
}

// ─── Partie pure ─────────────────────────────────────────────────────────

// Fiche partagée d'une séance du magasin : toujours la fiche de BASE (jaune), jamais la variante.
// loadOf(dsl, wuCd) → { tier, load, totalSec, qualitySec } (calculé par le moteur de l'appelant).
function routineShareFiche(snap, loadOf) {
  const dsl = snap.baseDsl || snap.dsl;
  const l = loadOf(dsl, snap.wuCd !== false);
  return {
    slot: snap.slot || null, modelId: snap.modelId || null, name: snap.name, dsl, baseDsl: dsl,
    family: snap.family || null, role: snap.role || null, wuCd: snap.wuCd !== false, terrain: snap.terrain || 'route',
    totalSec: l.totalSec, qualitySec: l.qualitySec, tier: l.tier, load: l.load,
  };
}

// Charge utile publiée : semaines en cours et à venir (jamais le passé), sans rien de personnel
// (ni ressenti, ni pointage, ni réglages).
function buildSharePayload(store, now, loadOf, meta) {
  const weeks = [];
  Object.keys(store.weeks || {}).map(Number).sort((a, b) => a - b).forEach(k => {
    if (k + WEEK_MS < now) return;                                   // semaine passée
    const w = store.weeks[k];
    if (!w || w.shared || !w.sessions || !w.sessions.length) return;  // jamais re-partager une semaine reçue
    weeks.push({
      weekMs: k, phase: w.phase, phaseIdx: w.phaseIdx,
      macro: w.macro ? { cycleIdx: w.macro.cycleIdx, phaseName: w.macro.phaseName, themeLabel: w.macro.themeLabel, targetLabel: w.macro.targetLabel, why: w.macro.why } : null,
      sessions: w.sessions.map(s => routineShareFiche(s, loadOf)),
    });
  });
  return {
    v: 1, publishedAt: now, fromName: _rsClean(meta && meta.fromName, 40) || null,
    terrain: (meta && meta.terrain) || null, frequency: (meta && meta.frequency) || null,
    weeks: weeks.slice(0, ROUTINE_SHARE_MAX_WEEKS),
  };
}

// Index (dans le magasin du suiveur) d'une semaine de l'animateur : même lundi, à l'heure d'été près.
// anchorMonday du suiveur : ses clés de semaine sont anchorMonday + (n-1)×7 j (cf. freeWeekDate).
function routineShareKeyFor(anchorMonday, weekMs) {
  const n = Math.round((weekMs - anchorMonday) / WEEK_MS) + 1;
  return { n, key: anchorMonday + (n - 1) * WEEK_MS };
}

// Vérifie / nettoie une fiche reçue (jamais confiance aveugle : le relais est une donnée, pas du code).
// compile(dsl, opts) lève si le DSL est invalide.
function sanitizeShareFiche(f, compile, nameOf) {
  if (!f || typeof f.dsl !== 'string' || f.dsl.length > 400) return null;
  try { compile(f.dsl, { wuCd: f.wuCd !== false }); } catch (e) { return null; }
  const role = ['ef', 'quality', 'long'].includes(f.role) ? f.role : 'quality';
  return {
    slot: _rsClean(f.slot, 8) || null,
    modelId: _rsClean(f.modelId, 20) || null,
    name: _rsClean((nameOf && f.modelId && nameOf(f.modelId)) || f.name, 80) || 'Séance partagée',
    dsl: f.dsl, baseDsl: f.dsl, variant: 'yellow',
    family: _rsClean(f.family, 4) || null, role, wuCd: f.wuCd !== false,
    terrain: f.terrain === 'trail' ? 'trail' : 'route',
    totalSec: Math.max(0, Math.round(Number(f.totalSec) || 0)), qualitySec: Math.max(0, Math.round(Number(f.qualitySec) || 0)),
    tier: [0, 1, 2].includes(f.tier) ? f.tier : 1, load: Math.max(0, Math.round(Number(f.load) || 0)),
  };
}

// Pose les semaines publiées dans le magasin du suiveur.
// Règle (celle du moteur) : une semaine est remplacée SAUF si une séance y est pointée ou une
// variante choisie. Jamais de semaine passée. Une semaine partagée que l'animateur ne publie plus
// et que le suiveur n'a pas touchée est retirée (elle réapparaît en "en attente").
// ctx : { now, anchorMonday, from, fromName, isTouched(key, week), level, cap, compile, nameOf }
// → { changed, applied:[clés], kept:[clés gardées car touchées], removed:[clés] }
function applySharedWeeks(store, payload, ctx) {
  const res = { changed: false, applied: [], kept: [], removed: [] };
  const incoming = {};
  ((payload && payload.weeks) || []).slice(0, ROUTINE_SHARE_MAX_WEEKS).forEach(pw => {
    if (!pw || !isFinite(Number(pw.weekMs))) return;
    const { n, key } = routineShareKeyFor(ctx.anchorMonday, Number(pw.weekMs));
    if (n < 1 || key + WEEK_MS < ctx.now) return;                    // passé : on ne rattrape jamais
    const sessions = (pw.sessions || []).map(f => sanitizeShareFiche(f, ctx.compile, ctx.nameOf)).filter(Boolean);
    if (!sessions.length) return;
    sessions.forEach((s, i) => { s.trainingIndex = i; });
    incoming[key] = { pw, n, sessions };
  });
  Object.keys(incoming).forEach(k => {
    const key = Number(k);
    const { pw, n, sessions } = incoming[k];
    const existing = store.weeks[key];
    if (existing && ctx.isTouched(key, existing)) { res.kept.push(key); return; }
    store.weeks[key] = {
      weekNum: n, phase: _rsClean(pw.phase, 3) || 'S1', phaseIdx: Number(pw.phaseIdx) || 0, target: null, cap: ctx.cap != null ? ctx.cap : 2, level: ctx.level || 2,
      caution: false, macro: pw.macro || null, signals: null, plan: null, race: null,
      qualityCount: sessions.filter(s => s.role !== 'ef').length, hardCount: sessions.filter(s => s.tier >= 2).length,
      sessions, notes: [], warnings: [], generatedAt: ctx.now,
      preview: false, shared: true, sharedFrom: ctx.from, sharedFromName: ctx.fromName || null, sharedAt: ctx.now,
    };
    res.applied.push(key); res.changed = true;
  });
  // semaines partagées devenues absentes de la publication, intactes, à venir → retirées
  Object.keys(store.weeks).forEach(k => {
    const key = Number(k), w = store.weeks[k];
    if (!w || !w.shared || incoming[key] || key + WEEK_MS < ctx.now) return;
    if (key <= ctx.now && ctx.now < key + WEEK_MS) return;           // semaine en cours : on ne la retire jamais
    if (ctx.isTouched(key, w)) return;
    delete store.weeks[key]; res.removed.push(key); res.changed = true;
  });
  return res;
}

// Au moment de quitter : retire les semaines partagées À VENIR et intactes (la semaine en cours reste).
function leaveSharedWeeks(store, now, isTouched) {
  const removed = [];
  Object.keys(store.weeks).forEach(k => {
    const key = Number(k), w = store.weeks[k];
    if (!w || !w.shared) return;
    if (key <= now) return;                                          // en cours ou passée : intacte
    if (isTouched(key, w)) return;
    delete store.weeks[key]; removed.push(key);
  });
  return removed;
}

// Rend un état d'invitation à partir de la réponse du serveur et de l'état local.
//   local : { state: 'accepted'|'declined'|'left'|'ended'|null, inviteSince, appliedUpdatedAt }
//   inbox : { offered, since, updatedAt }
// → 'ask' (proposer), 'apply' (poser les semaines), 'end' (l'animateur a retiré ce suiveur), 'none'
function routineShareDecision(local, inbox) {
  const st = local && local.state;
  if (!inbox || !inbox.offered) return st === 'accepted' ? 'end' : 'none';
  if (st === 'accepted') {
    // une invitation NEUVE (l'animateur a arrêté puis repartagé : `since` différent) se redemande toujours —
    // l'ancien « oui » ne vaut pas pour une autre routine
    if (inbox.since && local.inviteSince && inbox.since !== local.inviteSince) return 'ask';
    return (inbox.updatedAt || '') > (local.appliedUpdatedAt || '') ? 'apply' : 'none';
  }
  // pas (ou plus) membre : on ne repropose que pour une NOUVELLE invitation (since différent)
  if ((st === 'declined' || st === 'left' || st === 'ended') && local.inviteSince === inbox.since) return 'none';
  return 'ask';
}

// ─── Interface ───────────────────────────────────────────────────────────
// Tout ce qui suit ne tourne que dans le navigateur.

function getRoutineShareState() {
  try { return JSON.parse(localStorage.getItem(ROUTINE_SHARE_KEY) || 'null') || {}; } catch (e) { return {}; }
}
function saveRoutineShareState(s) { localStorage.setItem(ROUTINE_SHARE_KEY, JSON.stringify(s)); }
function routineShareActive() { return getRoutineShareState().state === 'accepted'; }

function _rsTouched(key, w) {
  return !routineWeekIsUntouched(key, w);
}
function _rsCompile(dsl, opts) { return compileRoutineDsl(dsl, opts); }
function _rsNameOf(id) { const m = (typeof ROUTINE_CATALOG !== 'undefined' ? ROUTINE_CATALOG : []).find(x => x.id === id); return m ? m.name : null; }
function _rsLoadOf(dsl, wuCd) {
  const l = RoutineEngine.routineLoadOfDsl(dsl, wuCd);
  return { tier: l.tier, load: RoutineEngine.routineLoadValue(l), totalSec: Math.round(l.totalMin * 60), qualitySec: Math.round(l.qualityMin * 60) };
}

// ── Suiveur ──
let _rsChecking = false;
async function checkRoutineShare(opts) {
  if (_rsChecking) return;
  _rsChecking = true;
  try {
    const res = await fetch(`${API}/api/routine-share/inbox`);
    if (!res.ok) return;
    const inbox = await res.json();
    let local = getRoutineShareState();
    // « accepté » sans aucune routine active chez moi (plan/routine annulés, jamais appliqué) = pas membre :
    // on ne l'applique pas en silence, on redemande
    if (local.state === 'accepted') {
      const fp = getFreeSessionsPrefs();
      if (!fp || fp.dormant) { local = { inviteSince: local.inviteSince }; saveRoutineShareState(local); }
    }
    const what = routineShareDecision(local, inbox);
    if (what === 'ask') await askRoutineShare(inbox);
    else if (what === 'apply') await applyRoutineShare(inbox);
    else if (what === 'end') {
      // l'animateur a arrêté sa routine : on retire ses semaines à venir intactes (rien ne reste d'une ancienne routine)
      const st = getRoutineStore();
      const removed = leaveSharedWeeks(st, Date.now(), _rsTouched);
      if (removed.length) saveRoutineStore(st);
      saveRoutineShareState({ ...local, state: 'ended', inviteSince: local.inviteSince, endedAt: Date.now() });
      showToast('Le partage de routine avec ' + (local.fromName || 'ton animateur') + ' est terminé : ta routine reprend.', 'info');
      _rsRefreshRoutineView();
    }
  } catch (e) { /* hors-ligne ou relais indisponible : on réessaiera */ }
  finally { _rsChecking = false; }
}

async function askRoutineShare(inbox) {
  const who = _rsClean(inbox.fromName, 40) || 'Un utilisateur d’Allure+';
  const ok = await showConfirmModal({
    title: `${who} te propose de partager sa routine`,
    message: `Tu aurais les mêmes séances que ${who} (mêmes exercices, mêmes durées de sortie longue), avec TES allures, TES variantes d’intensité et ton propre pointage. Vous n’aurez pas forcément à les faire le même jour. Les nouvelles semaines arriveront toutes seules ; tu peux passer une séance ou quitter le partage quand tu veux. Une semaine où tu as déjà pointé une séance ou choisi une variante n’est jamais modifiée.`,
    confirmLabel: 'Accepter',
    cancelLabel: 'Pas maintenant',
    icon: '🤝',
  });
  const local = getRoutineShareState();
  if (!ok) {
    if (local.state === 'accepted') {                                  // l'ancien partage ne vaut plus : on nettoie ses semaines à venir
      const st = getRoutineStore();
      if (leaveSharedWeeks(st, Date.now(), _rsTouched).length) saveRoutineStore(st);
    }
    saveRoutineShareState({ ...local, state: 'declined', inviteSince: inbox.since });
    return;
  }
  // pas encore de routine : on en crée une de base (terrain / fréquence de l'animateur), le contenu vient du partage
  let prefs = getFreeSessionsPrefs();
  if (!prefs || prefs.dormant) {
    prefs = {
      terrain: inbox.payload && inbox.payload.terrain === 'trail' ? 'trail' : 'route',
      frequency: Math.min(5, Math.max(2, parseInt(inbox.payload && inbox.payload.frequency, 10) || 3)),
      maxMin: 90, anchorMonday: routineNextStartMonday(), engine: 'v2', engineStartWeek: 1,
      seedSalt: Math.floor(Math.random() * 1000000) + 1,
    };
    saveFreeSessionsPrefs(prefs);
  }
  saveRoutineShareState({ state: 'accepted', from: inbox.from, fromName: who, inviteSince: inbox.since, acceptedAt: Date.now(), appliedUpdatedAt: '' });
  await applyRoutineShare(inbox);
  showToast('Routine partagée avec ' + who + ' : séances ajoutées.', 'success');
}

async function applyRoutineShare(inbox) {
  const prefs = getFreeSessionsPrefs();
  const local = getRoutineShareState();
  if (!prefs || local.state !== 'accepted' || !inbox || !inbox.payload) return;
  // un plan déjà démarré passe avant : le partage est en pause (la mise à jour sera reprise après)
  const planInfo = typeof routineCurrentPlanInfo === 'function' ? routineCurrentPlanInfo() : null;
  if (planInfo && planInfo.startMs <= Date.now()) return;
  const acts = await routineActivities();
  const profile = RoutineEngine.routineAssessProfile(acts, Date.now(), prefs.maxMin || 90);
  const store = getRoutineStore();
  const r = applySharedWeeks(store, inbox.payload, {
    now: Date.now(), anchorMonday: prefs.anchorMonday, from: inbox.from, fromName: local.fromName || _rsClean(inbox.fromName, 40),
    isTouched: _rsTouched, level: profile.level, cap: 2, compile: _rsCompile, nameOf: _rsNameOf,
  });
  if (r.changed) saveRoutineStore(store);
  saveRoutineShareState({ ...local, appliedUpdatedAt: inbox.updatedAt || '', lastAppliedAt: Date.now() });
  if (r.changed) {
    if (r.kept.length) showToast('Routine partagée mise à jour (les semaines où tu as déjà pointé une séance sont restées telles quelles).', 'info');
    _rsRefreshRoutineView();
  }
}

function _rsRefreshRoutineView() {
  try {
    if (typeof campusState !== 'undefined' && campusState.usingImportedPlan && getFreeSessionsPrefs() && typeof renderFreeSessionsWeek === 'function'
      && document.getElementById('rt-head')) renderFreeSessionsWeek(campusState.selectedWeekIdx);
  } catch (e) { /* affichage au prochain rendu */ }
}

async function leaveRoutineShare() {
  const local = getRoutineShareState();
  const ok = await showConfirmModal({
    title: 'Quitter la routine partagée ?',
    message: 'Les semaines à venir que tu n’as pas encore commencées sont retirées ; ta routine personnelle reprend à la semaine suivante. Ce que tu as déjà fait reste dans ton historique.',
    confirmLabel: 'Quitter', icon: '↩️',
  });
  if (!ok) return;
  const store = getRoutineStore();
  const removed = leaveSharedWeeks(store, Date.now(), _rsTouched);
  if (removed.length) saveRoutineStore(store);
  saveRoutineShareState({ ...local, state: 'left', leftAt: Date.now() });
  showToast('Routine partagée quittée.', 'info');
  if (typeof renderFreeSessionsWeek === 'function') renderFreeSessionsWeek(campusState.selectedWeekIdx);
}

// Bandeau + bouton affichés dans l'écran des séances libres d'un suiveur
function routineShareBanner() {
  const st = getRoutineShareState();
  if (st.state !== 'accepted') return '';
  return `<div class="rt-plan-banner"><div>🤝 Routine <strong>partagée</strong> avec <strong>${_rsClean(st.fromName, 40) || 'ton animateur'}</strong> : mêmes séances, avec tes allures et tes variantes. Les nouvelles semaines arrivent automatiquement.</div>
    <button type="button" class="btn-plan-action" onclick="leaveRoutineShare()">Quitter le partage</button></div>`;
}

// Carte d'une semaine non publiée par l'animateur (suiveur)
function routineSharePendingCard() {
  const st = getRoutineShareState();
  return `<div class="rt-pending card"><div class="rt-pending-ico">🤝</div><div><div class="rt-pending-title">En attente de ${_rsClean(st.fromName, 40) || 'ton animateur'}</div>
    <div class="rt-pending-text">Cette semaine n’est pas encore publiée : elle apparaîtra ici dès que les séances seront prêtes.</div></div></div>`;
}

// ── Animateur (compte admin) ──
// Seul le compte admin peut partager (décision produit) ; la route serveur le revérifie (requireAdmin).
function routineShareIsAdmin() {
  return typeof _currentUserEmail === 'string' && typeof ADMIN_EMAIL === 'string' && _currentUserEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}
const RT_SHARE_ACTIVE_KEY = 'allure_rt_share_active';   // local : l'animateur partage (publication automatique)
function routineShareIsLeader() { try { return localStorage.getItem(RT_SHARE_ACTIVE_KEY) === '1'; } catch (e) { return false; } }

let _rsPublishTimer = null;
function routineShareOnStoreSaved() {
  if (!routineShareIsLeader()) return;
  clearTimeout(_rsPublishTimer);
  _rsPublishTimer = setTimeout(() => { publishRoutineShare().catch(() => {}); }, 2500);
}

async function publishRoutineShare(recipients) {
  const prefs = getFreeSessionsPrefs();
  if (!prefs) throw new Error('Aucune routine active');
  const store = getRoutineStore();
  const payload = buildSharePayload(store, Date.now(), _rsLoadOf, { fromName: (typeof loadProfileData === 'function' && (loadProfileData().firstName || '')) || 'Stéphane', terrain: prefs.terrain, frequency: prefs.frequency });
  const body = { payload };
  if (recipients) body.recipients = recipients;
  const res = await fetch(`${API}/api/routine-share/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Publication impossible');
  return data;
}

// Arrête le partage pour tout le monde (appelé quand l'animateur désactive / annule / remplace sa routine).
async function unpublishRoutineShare() {
  if (!routineShareIsAdmin()) return;
  try { localStorage.setItem(RT_SHARE_ACTIVE_KEY, '0'); } catch (e) { /* stockage indisponible */ }
  clearTimeout(_rsPublishTimer);
  try { await fetch(`${API}/api/routine-share/unpublish`, { method: 'POST' }); } catch (e) { /* relais indisponible : réessayé à la prochaine publication */ }
}

// Libellé du bouton d'en-tête : « Partage en cours… » tant qu'au moins une personne est destinataire.
// La vérité est sur le relais (l'indicateur local peut être périmé ou absent sur un autre poste).
function routineShareSetButton(active) {
  try { localStorage.setItem(RT_SHARE_ACTIVE_KEY, active ? '1' : '0'); } catch (e) { /* stockage indisponible */ }
  const b = document.getElementById('rt-share-btn');
  if (b) b.textContent = '🤝 ' + (active ? 'Partage en cours…' : 'Partager ma routine');
}
async function routineShareRefreshButton() {
  if (!routineShareIsAdmin() || !document.getElementById('rt-share-btn')) return;
  try {
    const p = await fetch(`${API}/api/routine-share/published`).then(r => r.json());
    if (!p.unavailable) routineShareSetButton((p.recipients || []).length > 0);
  } catch (e) { /* hors-ligne : on garde l'état local */ }
}

async function openRoutineShareModal() {
  if (document.getElementById('rt-share-backdrop')) return;
  let users = [], published = { recipients: [] };
  try {
    const [u, p] = await Promise.all([
      fetch(`${API}/api/admin/users`).then(r => r.json()),
      fetch(`${API}/api/routine-share/published`).then(r => r.json()).catch(() => ({ recipients: [] })),
    ]);
    users = (u.users || []).filter(x => x.email && x.email.toLowerCase() !== 'shiznogoud@gmail.com');
    published = p || { recipients: [] };
  } catch (e) { showToast('Liste des utilisateurs indisponible.', 'error'); return; }
  const chosen = new Set((published.recipients || []).map(e => e.toLowerCase()));
  const bd = document.createElement('div');
  bd.className = 'confirm-modal-backdrop';
  bd.id = 'rt-share-backdrop';
  const rows = users.map(x => `<label class="rt-share-row"><input type="checkbox" value="${_rsClean(x.email, 120)}"${chosen.has(x.email.toLowerCase()) ? ' checked' : ''}> <span>${_rsClean(x.displayName || x.email, 60)}</span> <span class="rt-share-mail">${_rsClean(x.email, 120)}</span></label>`).join('')
    || '<div class="rt-share-empty">Aucun autre utilisateur enregistré pour l’instant.</div>';
  bd.innerHTML = `<div class="confirm-modal rt-share-modal">
    <div class="confirm-modal-title">Partager ma routine avec…</div>
    <p class="rt-share-help">Les personnes cochées recevront une proposition à leur prochaine ouverture d’Allure+. Elles verront tes séances de base avec leurs propres allures ; tes variantes et ton pointage restent chez toi. Décoche pour arrêter le partage avec quelqu’un.</p>
    <div class="rt-share-list">${rows}</div>
    <div class="confirm-modal-actions"><button type="button" class="btn-plan-action" id="rt-share-cancel">Annuler</button><button type="button" class="btn-plan-action btn-primary" id="rt-share-save">Enregistrer</button></div></div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#rt-share-cancel').onclick = close;
  bd.querySelector('#rt-share-save').onclick = async () => {
    const recipients = [...bd.querySelectorAll('.rt-share-list input:checked')].map(i => i.value).slice(0, ROUTINE_SHARE_MAX_RECIPIENTS);
    try {
      await publishRoutineShare(recipients);
      routineShareSetButton(recipients.length > 0);   // le bouton change tout de suite, sans recharger la page
      showToast(recipients.length ? `Routine partagée avec ${recipients.length} personne${recipients.length > 1 ? 's' : ''}.` : 'Partage arrêté.', 'success');
      close();
    } catch (e) { showToast(e.message || 'Publication impossible', 'error'); }
  };
  if (typeof attachBackdropClose === 'function') attachBackdropClose(bd, close);
}

// Relève : au chargement puis toutes les 30 min (le relais n'est consulté que si un partage est possible)
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => { setTimeout(() => checkRoutineShare(), 6000); });
  setInterval(() => { try { checkRoutineShare(); } catch (e) { /* silencieux */ } }, 30 * 60 * 1000);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildSharePayload, applySharedWeeks, leaveSharedWeeks, routineShareDecision, routineShareKeyFor, sanitizeShareFiche, routineShareFiche };
}
