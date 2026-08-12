// support.js — Centre de support (remontée d'idées/bugs/questions)
// Backend réel : Issues GitHub via le relais Cloudflare (support-relay/),
// jamais exposé directement — server.js relaie tout (voir /api/support/*).

let _currentUserEmail = null;
let _supportModalTab = 'new'; // 'new' | 'mine' | 'all'
let _supportOpenTicket = null;
let _supportTicketsCache = { mine: [], all: [] };

const SUPPORT_CATEGORIES = [
  { key: 'bug', label: 'Bug', icon: '🐞' },
  { key: 'amelioration', label: 'Amélioration', icon: '🔧' },
  { key: 'idee', label: 'Idée', icon: '💡' },
  { key: 'question', label: 'Question', icon: '❓' },
];
const SUPPORT_CATEGORY_MAP = Object.fromEntries(SUPPORT_CATEGORIES.map(c => [c.key, c]));
// Correspondance categorie <-> label GitHub (accents), voir support-relay/src/index.js CATEGORY_LABELS
const SUPPORT_CATEGORY_BY_GH_LABEL = { bug: 'bug', 'amélioration': 'amelioration', 'idée': 'idee', question: 'question' };

const SUPPORT_STATUS = {
  nouveau:  { label: 'Nouveau',  cls: 'support-status--new' },
  en_cours: { label: 'En cours', cls: 'support-status--progress' },
  resolu:   { label: 'Résolu',   cls: 'support-status--done' },
};

function isSupportAdmin() {
  return typeof _currentUserEmail === 'string' && typeof ADMIN_EMAIL === 'string'
    && _currentUserEmail.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// ─── Notification (point rouge sur l'icône) ────────────────────
const SUPPORT_SEEN_KEY = 'support_tickets_seen'; // { [number]: isoTimestamp }

function loadSupportSeenMap() {
  try { return JSON.parse(localStorage.getItem(SUPPORT_SEEN_KEY)) || {}; } catch { return {}; }
}
function markTicketSeen(number) {
  const map = loadSupportSeenMap();
  map[number] = new Date().toISOString();
  localStorage.setItem(SUPPORT_SEEN_KEY, JSON.stringify(map));
  updateSupportBadge();
}

async function checkSupportNotifications() {
  try {
    const res = await fetch(`${API}/api/support/tickets?scope=mine`);
    if (!res.ok) return;
    const { tickets } = await res.json();
    _supportTicketsCache.mine = tickets || [];
    updateSupportBadge();
  } catch (e) { /* silencieux — ne doit jamais bloquer le chargement de l'app */ }
}

function updateSupportBadge() {
  const seen = loadSupportSeenMap();
  const unseen = (_supportTicketsCache.mine || []).filter(t => {
    const last = seen[t.number];
    return !last || new Date(t.updatedAt) > new Date(last);
  }).length;
  const dot = el('support-fab-dot');
  if (dot) dot.style.display = unseen > 0 ? 'flex' : 'none';
}

// ─── Icône flottante + modale ───────────────────────────────────
// Libellé propre d'un nav-item : le texte brut inclut aussi les badges
// masqués (ex: "!" du profil incomplet, "Bêta" des itinéraires), retirés ici.
function navItemLabel(navItem) {
  const clone = navItem.cloneNode(true);
  clone.querySelectorAll('.nav-profile-badge, .nav-badge-beta, .nav-badge-count').forEach(b => b.remove());
  return clone.textContent.trim();
}

// Pages reservees au compte admin (Admin, Centre de support lui-meme) —
// jamais proposees dans "Page concernee", meme visibles pour ce compte-la :
// un utilisateur normal ne les a de toute facon pas dans sa sidebar.
const SUPPORT_EXCLUDED_PAGES = ['admin', 'support-admin'];

function pageOptionsHtml(selected) {
  const items = Array.from(document.querySelectorAll('.nav-item[data-page]'))
    .filter(n => !SUPPORT_EXCLUDED_PAGES.includes(n.dataset.page))
    .filter(n => n.offsetParent !== null || n.style.display !== 'none')
    .map(navItemLabel)
    .filter(Boolean);
  const unique = [...new Set(items)];
  return unique.map(label => `<option value="${escapeHtml(label)}" ${label === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function openSupportModal() {
  if (document.getElementById('support-modal-backdrop')) return;
  const bd = document.createElement('div');
  bd.className = 'confirm-modal-backdrop';
  bd.id = 'support-modal-backdrop';
  bd.innerHTML = `
    <div class="confirm-modal support-modal">
      <div class="support-modal-header">
        <div class="support-modal-title">💡 Remontée d'info</div>
        <button class="support-modal-close" id="support-close" type="button">✕</button>
      </div>
      <div class="support-modal-tabs">
        <button class="support-tab" data-tab="new" type="button">Nouveau ticket</button>
        <button class="support-tab" data-tab="mine" type="button">Mes tickets</button>
        <button class="support-tab" data-tab="all" type="button">Toutes les demandes</button>
      </div>
      <div class="support-modal-body" id="support-modal-body"></div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); };
  bd.querySelector('#support-close').onclick = close;
  attachBackdropClose(bd, close);
  bd.querySelectorAll('.support-tab').forEach(btn => {
    btn.onclick = () => { _supportOpenTicket = null; setSupportTab(btn.dataset.tab); };
  });
  setSupportTab('new');
}

function setSupportTab(tab) {
  _supportModalTab = tab;
  document.querySelectorAll('.support-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'new') renderSupportNewForm();
  else renderSupportList(tab);
}

function renderSupportNewForm() {
  const body = el('support-modal-body');
  if (!body) return;
  body.innerHTML = `
    <form id="support-new-form" class="support-form">
      <div class="support-form-row">
        <div>
          <label class="support-form-label">Catégorie</label>
          <select class="form-input" id="support-field-category">${SUPPORT_CATEGORIES.map(c => `<option value="${c.key}">${c.icon} ${c.label}</option>`).join('')}</select>
        </div>
        <div>
          <label class="support-form-label">Page concernée</label>
          <select class="form-input" id="support-field-page"><option value="" selected>— Aucune en particulier —</option>${pageOptionsHtml('')}</select>
        </div>
      </div>
      <label class="support-form-label">Votre message</label>
      <textarea class="form-input support-form-textarea" id="support-field-message" placeholder="Décrivez le bug, l'idée ou la question…" required></textarea>
      <button class="btn-save-profile" type="submit">Envoyer le ticket</button>
    </form>`;
  body.querySelector('#support-new-form').addEventListener('submit', submitSupportTicket);
}

async function submitSupportTicket(e) {
  e.preventDefault();
  const category = el('support-field-category').value;
  const page = el('support-field-page').value;
  const message = el('support-field-message').value.trim();
  if (!message) return;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    const res = await fetch(`${API}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, page, message }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erreur');
    const { ticket } = await res.json();
    if (ticket?.number) markTicketSeen(ticket.number);
    showToast('✅ Ticket envoyé, merci !', 'success');
    _supportTicketsCache.mine = [];
    setSupportTab('mine');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Envoyer le ticket';
  }
}

async function renderSupportList(scope) {
  const body = el('support-modal-body');
  if (!body) return;
  body.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const res = await fetch(`${API}/api/support/tickets?scope=${scope}`);
    const { tickets } = await res.json();
    _supportTicketsCache[scope] = tickets || [];
    if (!tickets || tickets.length === 0) {
      body.innerHTML = `<div class="support-empty">${scope === 'mine' ? "Vous n'avez pas encore ouvert de ticket." : 'Aucune demande pour le moment.'}</div>`;
      return;
    }
    const seen = loadSupportSeenMap();
    body.innerHTML = `<div class="support-ticket-list">${tickets.map(t => {
      const cat = SUPPORT_CATEGORY_MAP[t.category ? SUPPORT_CATEGORY_BY_GH_LABEL[t.category] : null];
      const status = SUPPORT_STATUS[t.status] || SUPPORT_STATUS.nouveau;
      const isUnseen = scope === 'mine' && (!seen[t.number] || new Date(t.updatedAt) > new Date(seen[t.number]));
      return `
        <button class="support-ticket-item ${isUnseen ? 'support-ticket-item--unseen' : ''}" data-number="${t.number}" type="button">
          <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
          <span class="support-ticket-info">
            <span class="support-ticket-title">${escapeHtml((t.message || t.title || '').slice(0, 70))}</span>
            <span class="support-ticket-meta">${t.page ? escapeHtml(t.page) + ' · ' : ''}${formatDate(t.updatedAt)}</span>
          </span>
          <span class="support-status ${status.cls}">${status.label}</span>
        </button>`;
    }).join('')}</div>`;
    body.querySelectorAll('.support-ticket-item').forEach(btn => {
      btn.onclick = () => openSupportTicket(Number(btn.dataset.number), scope);
    });
  } catch (e) {
    body.innerHTML = '<div class="support-empty">Impossible de charger les tickets.</div>';
  }
}

async function openSupportTicket(number, scope) {
  _supportOpenTicket = number;
  const body = el('support-modal-body');
  if (!body) return;
  body.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const res = await fetch(`${API}/api/support/tickets/${number}`);
    const { ticket, comments } = await res.json();
    markTicketSeen(number);
    const cat = SUPPORT_CATEGORY_MAP[ticket.category ? SUPPORT_CATEGORY_BY_GH_LABEL[ticket.category] : null];
    const status = SUPPORT_STATUS[ticket.status] || SUPPORT_STATUS.nouveau;
    const canReply = scope === 'mine';
    body.innerHTML = `
      <button class="support-back" id="support-back" type="button">← Retour</button>
      <div class="support-thread-header">
        <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
        <div>
          <div class="support-ticket-title">${escapeHtml(ticket.message || ticket.title || '')}</div>
          <div class="support-ticket-meta">${ticket.page ? escapeHtml(ticket.page) + ' · ' : ''}Ouvert le ${formatDate(ticket.createdAt)}</div>
        </div>
        <span class="support-status ${status.cls}">${status.label}</span>
      </div>
      <div class="support-thread-comments">
        ${comments.length === 0 ? '<div class="support-empty">Pas encore de réponse.</div>' : comments.map(c => `
          <div class="support-comment ${c.author === 'admin' ? 'support-comment--admin' : 'support-comment--user'}">
            <div class="support-comment-author">${c.author === 'admin' ? "Réponse de l'équipe" : 'Vous'}</div>
            <div class="support-comment-msg">${escapeHtml(c.message)}</div>
            <div class="support-comment-date">${formatDate(c.createdAt)}</div>
          </div>`).join('')}
      </div>
      ${canReply ? `
      <form id="support-reply-form" class="support-reply-form">
        <textarea class="form-input support-form-textarea" id="support-reply-message" placeholder="Votre réponse…" required></textarea>
        <button class="btn-save-profile" type="submit">Répondre</button>
      </form>` : ''}
    `;
    body.querySelector('#support-back').onclick = () => { _supportOpenTicket = null; renderSupportList(scope); };
    const replyForm = body.querySelector('#support-reply-form');
    if (replyForm) {
      replyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = el('support-reply-message');
        const message = msgEl.value.trim();
        if (!message) return;
        const btn = replyForm.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Envoi…';
        try {
          const r = await fetch(`${API}/api/support/tickets/${number}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
          });
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
          markTicketSeen(number);
          openSupportTicket(number, scope);
        } catch (err) {
          showToast('Erreur : ' + err.message, 'error');
          btn.disabled = false; btn.textContent = 'Répondre';
        }
      });
    }
  } catch (e) {
    body.innerHTML = '<div class="support-empty">Impossible de charger ce ticket.</div>';
  }
}

// ─── Page admin "Centre de support" ─────────────────────────────
let _supportAdminTicketsCache = [];
let _supportAdminFilter = 'all';
let _supportAdminOpenTicket = null;

const SUPPORT_ADMIN_SEEN_KEY = 'support_admin_seen';
function loadSupportAdminSeenMap() {
  try { return JSON.parse(localStorage.getItem(SUPPORT_ADMIN_SEEN_KEY)) || {}; } catch { return {}; }
}
function markAdminTicketSeen(number) {
  const map = loadSupportAdminSeenMap();
  map[number] = new Date().toISOString();
  localStorage.setItem(SUPPORT_ADMIN_SEEN_KEY, JSON.stringify(map));
  updateSupportAdminBadge();
}

function ticketNeedsAdminAttention(t, seen) {
  return t.status !== 'resolu' && (!seen[t.number] || new Date(t.updatedAt) > new Date(seen[t.number]));
}

async function checkSupportAdminNotifications() {
  try {
    const res = await fetch(`${API}/api/support/admin/tickets`);
    if (!res.ok) return;
    const { tickets } = await res.json();
    _supportAdminTicketsCache = tickets || [];
    updateSupportAdminBadge();
  } catch (e) { /* silencieux */ }
}

function updateSupportAdminBadge() {
  const seen = loadSupportAdminSeenMap();
  const count = (_supportAdminTicketsCache || []).filter(t => ticketNeedsAdminAttention(t, seen)).length;
  const badge = el('support-admin-badge');
  if (badge) { badge.style.display = count > 0 ? 'inline-flex' : 'none'; badge.textContent = String(count); }
}

async function loadSupportAdminPage() {
  const list = el('support-admin-list');
  if (!list) return;
  list.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const res = await fetch(`${API}/api/support/admin/tickets`);
    const { tickets } = await res.json();
    _supportAdminTicketsCache = tickets || [];
    updateSupportAdminBadge();
    wireSupportAdminFilters();
    renderSupportAdminList();
  } catch (e) {
    list.innerHTML = '<div class="support-empty">Impossible de charger les tickets.</div>';
  }
}

function wireSupportAdminFilters() {
  const filtersEl = el('support-admin-filters');
  if (!filtersEl || filtersEl.dataset.wired) return;
  filtersEl.dataset.wired = '1';
  filtersEl.querySelectorAll('.stats-pill').forEach(btn => {
    btn.onclick = () => {
      filtersEl.querySelectorAll('.stats-pill').forEach(b => b.classList.remove('stats-pill--active'));
      btn.classList.add('stats-pill--active');
      _supportAdminFilter = btn.dataset.status;
      renderSupportAdminList();
    };
  });
}

function renderSupportAdminList() {
  const list = el('support-admin-list');
  if (!list) return;
  const seen = loadSupportAdminSeenMap();
  let tickets = _supportAdminTicketsCache;
  if (_supportAdminFilter !== 'all') tickets = tickets.filter(t => t.status === _supportAdminFilter);
  if (tickets.length === 0) { list.innerHTML = '<div class="support-empty">Aucun ticket.</div>'; return; }
  list.innerHTML = tickets.map(t => {
    const cat = SUPPORT_CATEGORY_MAP[t.category ? SUPPORT_CATEGORY_BY_GH_LABEL[t.category] : null];
    const status = SUPPORT_STATUS[t.status] || SUPPORT_STATUS.nouveau;
    const unseen = ticketNeedsAdminAttention(t, seen);
    return `
      <button class="support-ticket-item ${unseen ? 'support-ticket-item--unseen' : ''} ${_supportAdminOpenTicket === t.number ? 'support-ticket-item--active' : ''}" data-number="${t.number}" type="button">
        <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
        <span class="support-ticket-info">
          <span class="support-ticket-title">${escapeHtml((t.message || t.title || '').slice(0, 60))}</span>
          <span class="support-ticket-meta">${t.reporterEmail ? escapeHtml(t.reporterEmail) + ' · ' : ''}${formatDate(t.updatedAt)}</span>
        </span>
        <span class="support-status ${status.cls}">${status.label}</span>
      </button>`;
  }).join('');
  list.querySelectorAll('.support-ticket-item').forEach(btn => {
    btn.onclick = () => openSupportAdminTicket(Number(btn.dataset.number));
  });
}

async function openSupportAdminTicket(number) {
  _supportAdminOpenTicket = number;
  renderSupportAdminList();
  const detail = el('support-admin-detail');
  if (!detail) return;
  detail.innerHTML = '<div class="table-loading">Chargement…</div>';
  try {
    const res = await fetch(`${API}/api/support/tickets/${number}`);
    const { ticket, comments } = await res.json();
    markAdminTicketSeen(number);
    const cat = SUPPORT_CATEGORY_MAP[ticket.category ? SUPPORT_CATEGORY_BY_GH_LABEL[ticket.category] : null];
    detail.innerHTML = `
      <div class="support-thread-header">
        <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
        <div>
          <div class="support-ticket-title">${escapeHtml(ticket.message || ticket.title || '')}</div>
          <div class="support-ticket-meta">${ticket.page ? escapeHtml(ticket.page) + ' · ' : ''}${ticket.reporterEmail ? escapeHtml(ticket.reporterEmail) + ' · ' : ''}Ouvert le ${formatDate(ticket.createdAt)}</div>
        </div>
        <select class="form-input support-status-select" id="support-admin-status-select">
          ${Object.entries(SUPPORT_STATUS).map(([k, v]) => `<option value="${k}" ${ticket.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="support-thread-comments">
        ${comments.length === 0 ? '<div class="support-empty">Pas encore de réponse.</div>' : comments.map(c => `
          <div class="support-comment ${c.author === 'admin' ? 'support-comment--admin' : 'support-comment--user'}">
            <div class="support-comment-author">${c.author === 'admin' ? 'Vous (équipe)' : (ticket.reporterEmail || 'Utilisateur')}</div>
            <div class="support-comment-msg">${escapeHtml(c.message)}</div>
            <div class="support-comment-date">${formatDate(c.createdAt)}</div>
          </div>`).join('')}
      </div>
      <form id="support-admin-reply-form" class="support-reply-form">
        <textarea class="form-input support-form-textarea" id="support-admin-reply-message" placeholder="Votre réponse…" required></textarea>
        <button class="btn-save-profile" type="submit">Répondre</button>
      </form>
    `;
    el('support-admin-status-select').onchange = async (e) => {
      const status = e.target.value;
      try {
        const r = await fetch(`${API}/api/support/admin/tickets/${number}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
        showToast('Statut mis à jour', 'success');
        const t = _supportAdminTicketsCache.find(x => x.number === number);
        if (t) t.status = status;
        renderSupportAdminList();
      } catch (err) { showToast('Erreur : ' + err.message, 'error'); }
    };
    detail.querySelector('#support-admin-reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = el('support-admin-reply-message');
      const message = msgEl.value.trim();
      if (!message) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        const r = await fetch(`${API}/api/support/tickets/${number}/comments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
        openSupportAdminTicket(number);
      } catch (err) {
        showToast('Erreur : ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Répondre';
      }
    });
  } catch (e) {
    detail.innerHTML = '<div class="support-empty">Impossible de charger ce ticket.</div>';
  }
}
