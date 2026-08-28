// support.js — Centre de support (remontée d'idées/bugs/questions)
// Backend réel : Issues GitHub via le relais Cloudflare (support-relay/),
// jamais exposé directement — server.js relaie tout (voir /api/support/*).

let _currentUserEmail = null;
let _supportModalTab = 'new'; // 'new' | 'mine' | 'all'
let _supportOpenTicket = null;
let _supportTicketsCache = { mine: [], all: [] };

const SUPPORT_CATEGORIES = [
  { key: 'bug', label: 'Bug', icon: '🪳' },
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

// ─── Piece jointe (capture d'ecran) ────────────────────────────────────
// Une seule image par ticket/reponse (garde le formulaire simple). Reduite
// cote client (canvas, max 1600px de large) avant encodage base64, pour
// rester loin de la limite de taille de requete (voir server.js,
// express.json 8mb) et de la limite KV du relais (support-relay, 4mb bruts).
function supportImagePickerHtml(idPrefix) {
  return `
    <div class="support-image-picker">
      <label class="support-image-label" for="${idPrefix}-image">📎 Ajouter une capture d'écran (optionnel)</label>
      <input type="file" accept="image/*" id="${idPrefix}-image" class="support-image-input">
      <div class="support-image-preview" id="${idPrefix}-image-preview" style="display:none"></div>
    </div>`;
}

function downscaleImageToDataUrl(file, maxDim) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.readAsDataURL(file);
  });
}

// Retourne un getter { getDataUrl() } lu au moment du submit - le picker
// vit dans le DOM entre temps, pas besoin de le faire remonter autrement.
function wireSupportImagePicker(idPrefix) {
  const input = document.getElementById(`${idPrefix}-image`);
  const preview = document.getElementById(`${idPrefix}-image-preview`);
  let dataUrl = null;
  if (!input) return { getDataUrl: () => null };
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) { dataUrl = null; preview.style.display = 'none'; preview.innerHTML = ''; return; }
    try {
      dataUrl = await downscaleImageToDataUrl(file, 1600);
      preview.innerHTML = `<img src="${dataUrl}" alt="Aperçu"><button type="button" class="support-image-remove" title="Retirer">✕</button>`;
      preview.style.display = 'flex';
      preview.querySelector('.support-image-remove').onclick = () => {
        dataUrl = null; input.value = ''; preview.style.display = 'none'; preview.innerHTML = '';
      };
    } catch (e) {
      showToast('Image illisible : ' + e.message, 'error');
      input.value = '';
    }
  };
  return { getDataUrl: () => dataUrl };
}

async function uploadSupportImage(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(.*);base64,(.*)$/);
  if (!match) throw new Error('Image invalide');
  const res = await fetch(`${API}/api/support/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: match[1], dataBase64: match[2] }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Échec de l'envoi de l'image");
  const { url } = await res.json();
  return url;
}

// Le relais (support-relay) stocke l'image en l'ajoutant en markdown
// (`![capture](url)`) a la fin du texte brut sur GitHub - a l'affichage, on
// l'extrait pour la rendre comme une vraie <img>, jamais comme du texte brut.
function extractImageFromMessage(message) {
  const m = (message || '').match(/\n*!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)\s*$/);
  if (!m) return { text: message || '', imageUrl: null };
  return { text: message.slice(0, m.index).trim(), imageUrl: m[1] };
}

// ─── Émojis rapides (équivalent léger du sélecteur Windows+.) ──────────
const SUPPORT_QUICK_EMOJIS = [
  // Smileys / émotions
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
  '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌',
  '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🥵', '🥶',
  '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '🙁',
  '😮', '😯', '😲', '🥺', '😢', '😭', '😱', '😖', '😞', '😓',
  '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '💀', '🤡',
  '👻', '🤖', '😺', '😻', '😹', '🙀', '😿',
  // Coeurs
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💋',
  // Mains / gestes
  '👍', '👎', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👉',
  '👆', '👇', '☝️', '👋', '🖐️', '✋', '👏', '🙌', '🤲', '🙏',
  '✍️', '💪',
  // Fêtes / sport
  '🎉', '🎊', '🎁', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '⚽',
  '🏃', '🚴', '🏋️', '🧘', '🏊',
  // Nature / météo
  '☀️', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '❄️', '☃️', '🌈', '⭐',
  '🌟', '✨', '🔥', '💧', '🌊', '🌙',
  // Objets / symboles
  '💡', '🚀', '⏰', '📌', '📍', '✅', '❌', '❗', '❓', '⚠️',
  '🔔', '🔒', '📷', '🎯', '💯', '🔧', '📈', '📉',
  // Nourriture
  '☕', '🍕', '🍔', '🍰', '🍺', '🍷',
];
function emojiToolbarHtml(idPrefix) {
  return `<div class="support-emoji-toolbar"><button type="button" class="support-emoji-btn" id="${idPrefix}-emoji-btn" title="Insérer un émoji">😀</button></div>`;
}
function wireEmojiPicker(idPrefix) {
  const btn = document.getElementById(`${idPrefix}-emoji-btn`);
  const textarea = document.getElementById(`${idPrefix}-message`);
  if (!btn || !textarea) return;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.support-emoji-popover').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'support-emoji-popover';
    pop.innerHTML = SUPPORT_QUICK_EMOJIS.map(em => `<button type="button" class="support-emoji-opt">${em}</button>`).join('');
    // Ajoute au <body> (pas au conteneur du bouton) et position:fixed calcule
    // depuis le bouton - le modal support (.support-modal-body) a
    // overflow-y:auto, ce qui force overflow-x a se couper (regle CSS
    // implicite : un axe "visible" a cote d'un axe non-visible devient
    // "auto") et coupait le popover en position:absolute (constat
    // utilisateur, 14/08).
    document.body.appendChild(pop);
    const rect = btn.getBoundingClientRect();
    const popW = pop.offsetWidth;
    const popH = pop.offsetHeight;
    const left = Math.max(8, Math.min(rect.right - popW, window.innerWidth - popW - 8));
    // S'ouvre vers le haut si pas assez de place en dessous (bouton proche du
    // bas de l'ecran) - sinon les dernieres rangees restaient hors-viewport,
    // inaccessibles puisque position:fixed ne suit aucun scroll (constat
    // utilisateur, 14/08).
    const top = (rect.bottom + 6 + popH > window.innerHeight - 8)
      ? Math.max(8, rect.top - popH - 6)
      : rect.bottom + 6;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.querySelectorAll('.support-emoji-opt').forEach(opt => {
      opt.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        const emoji = opt.textContent;
        textarea.value = textarea.value.slice(0, start) + emoji + textarea.value.slice(end);
        const newPos = start + emoji.length;
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
        pop.remove();
      };
    });
    setTimeout(() => {
      const closeOnOutside = (ev) => {
        if (!pop.contains(ev.target) && ev.target !== btn) {
          pop.remove();
          document.removeEventListener('click', closeOnOutside);
        }
      };
      document.addEventListener('click', closeOnOutside);
    }, 0);
  };
}

function renderSupportMsgHtml(message) {
  const { text, imageUrl } = extractImageFromMessage(message);
  return `${escapeHtml(text)}${imageUrl ? `<a href="${imageUrl}" target="_blank" rel="noopener"><img class="support-msg-image" src="${imageUrl}" alt="Capture d'écran jointe"></a>` : ''}`;
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
      ${emojiToolbarHtml('support-field')}
      ${supportImagePickerHtml('support-new')}
      <label class="form-checkbox-inline support-privacy-checkbox">
        <input type="checkbox" id="support-field-private" /> 🔒 Ticket privé — visible uniquement par vous et l'administrateur
      </label>
      <button class="btn-save-profile" type="submit">Envoyer le ticket</button>
    </form>`;
  const imagePicker = wireSupportImagePicker('support-new');
  wireEmojiPicker('support-field');
  body.querySelector('#support-new-form').addEventListener('submit', (e) => submitSupportTicket(e, imagePicker));
}

async function submitSupportTicket(e, imagePicker) {
  e.preventDefault();
  const category = el('support-field-category').value;
  const page = el('support-field-page').value;
  const message = el('support-field-message').value.trim();
  const isPrivate = el('support-field-private')?.checked || false;
  if (!message) return;
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Envoi…';
  try {
    const imageUrl = await uploadSupportImage(imagePicker?.getDataUrl());
    const res = await fetch(`${API}/api/support/tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, page, message, imageUrl, private: isPrivate }),
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
            <span class="support-ticket-title">${t.private ? '🔒 ' : ''}${escapeHtml(extractImageFromMessage(t.message || t.title || '').text.slice(0, 70))}</span>
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

// Utilise par la vue utilisateur (ses propres tickets) et la page admin
// (n'importe quel ticket) - onDeleted() reprend la main pour rafraichir la
// bonne liste selon le contexte appelant.
async function deleteSupportTicket(number, onDeleted) {
  const ok = await showConfirmModal({
    title: 'Supprimer ce ticket ?',
    message: 'Le ticket et son fil de discussion seront définitivement retirés de la liste. Cette action est irréversible.',
    confirmLabel: 'Supprimer',
    danger: true,
    icon: '🗑️',
  });
  if (!ok) return;
  // Le relais Cloudflare -> GitHub prend 1-3s : sans retour visuel immediat,
  // l'ecran semblait fige pendant ce delai (constat utilisateur, pris pour
  // un bug de rafraichissement alors que la suppression aboutissait bien).
  const btn = document.getElementById('support-delete-ticket') || document.getElementById('support-admin-delete-ticket');
  if (btn) { btn.disabled = true; btn.textContent = 'Suppression…'; }
  try {
    const r = await fetch(`${API}/api/support/tickets/${number}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
    showToast('Ticket supprimé', 'success');
    onDeleted();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗑️ Supprimer ce ticket'; }
  }
}

// Bascule privé/public - retroactive, fonctionne aussi sur un ticket deja
// archive/resolu (voir support-relay handleSetPrivacy, qui ne touche que les
// labels, jamais l'etat du ticket). Utilisee par la vue utilisateur (son
// propre ticket) et la page admin (n'importe quel ticket, meme sans en etre
// l'auteur).
async function toggleTicketPrivacy(number, makePrivate) {
  try {
    const r = await fetch(`${API}/api/support/tickets/${number}/privacy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ private: makePrivate }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
    showToast(makePrivate ? '🔒 Ticket rendu privé' : '🔓 Ticket rendu public', 'success');
    return true;
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    return false;
  }
}

function privacyToggleBtnHtml(idAttr, ticket) {
  return `<button type="button" class="support-privacy-toggle ${ticket.private ? 'is-private' : ''}" id="${idAttr}" title="${ticket.private ? 'Rendre ce ticket public' : 'Rendre ce ticket privé'}">${ticket.private ? '🔒' : '🔓'}</button>`;
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
          <div class="support-ticket-title">${ticket.private ? '🔒 ' : ''}${renderSupportMsgHtml(ticket.message || ticket.title || '')}</div>
          <div class="support-ticket-meta">${ticket.page ? escapeHtml(ticket.page) + ' · ' : ''}Ouvert le ${formatDate(ticket.createdAt)}</div>
        </div>
        <span class="support-status ${status.cls}">${status.label}</span>
        ${canReply ? privacyToggleBtnHtml('support-privacy-toggle', ticket) : ''}
      </div>
      <div class="support-thread-comments">
        ${comments.length === 0 ? '<div class="support-empty">Pas encore de réponse.</div>' : comments.map(c => `
          <div class="support-comment ${c.author === 'admin' ? 'support-comment--admin' : 'support-comment--user'}">
            <div class="support-comment-author">${c.author === 'admin' ? "Réponse de l'équipe" : 'Vous'}</div>
            <div class="support-comment-msg">${renderSupportMsgHtml(c.message)}</div>
            <div class="support-comment-date">${formatDate(c.createdAt)}</div>
          </div>`).join('')}
      </div>
      ${canReply ? `
      <form id="support-reply-form" class="support-reply-form">
        <textarea class="form-input support-form-textarea" id="support-reply-message" placeholder="Votre réponse…" required></textarea>
        ${emojiToolbarHtml('support-reply')}
        ${supportImagePickerHtml('support-reply')}
        <button class="btn-save-profile" type="submit">Répondre</button>
      </form>
      <button class="support-delete-btn" id="support-delete-ticket" type="button">🗑️ Supprimer ce ticket</button>` : ''}
    `;
    body.querySelector('#support-back').onclick = () => { _supportOpenTicket = null; renderSupportList(scope); };
    const privacyBtn = body.querySelector('#support-privacy-toggle');
    if (privacyBtn) {
      privacyBtn.onclick = async () => {
        privacyBtn.disabled = true;
        const ok = await toggleTicketPrivacy(number, !ticket.private);
        if (ok) openSupportTicket(number, scope); else privacyBtn.disabled = false;
      };
    }
    const deleteBtn = body.querySelector('#support-delete-ticket');
    if (deleteBtn) {
      deleteBtn.onclick = () => deleteSupportTicket(number, () => { _supportOpenTicket = null; renderSupportList(scope); });
    }
    const replyForm = body.querySelector('#support-reply-form');
    if (replyForm) {
      wireEmojiPicker('support-reply');
      const replyImagePicker = wireSupportImagePicker('support-reply');
      replyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = el('support-reply-message');
        const message = msgEl.value.trim();
        if (!message) return;
        const btn = replyForm.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'Envoi…';
        try {
          const imageUrl = await uploadSupportImage(replyImagePicker.getDataUrl());
          const r = await fetch(`${API}/api/support/tickets/${number}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, imageUrl }),
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
// Repertoire e-mail -> nom Garmin (reutilise /api/admin/users, deja charge
// par la page Admin > Utilisateurs) pour afficher un nom plutot qu'un e-mail
// dans le Centre de support admin.
let _supportUserDirectory = {};

function supportUserLabel(email) {
  if (!email) return 'Utilisateur';
  return _supportUserDirectory[email.toLowerCase()] || email;
}

async function loadSupportUserDirectory() {
  try {
    const { users } = await fetch(`${API}/api/admin/users`).then(r => r.json());
    _supportUserDirectory = Object.fromEntries(
      (users || []).filter(u => u.displayName).map(u => [u.email.toLowerCase(), u.displayName])
    );
  } catch (e) { /* silencieux - repli sur l'e-mail brut */ }
}

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
    const [res] = await Promise.all([fetch(`${API}/api/support/admin/tickets`), loadSupportUserDirectory()]);
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
  // "Tous" = tickets actifs uniquement (nouveau + en cours) - les resolus se
  // consultent via "Archives" (meme filtre 'resolu' sous le capot, juste
  // renomme), pour que la vue par defaut reste courte et utile au quotidien
  // (retour utilisateur : trop de tickets resolus melanges aux actifs).
  if (_supportAdminFilter === 'all') tickets = tickets.filter(t => t.status !== 'resolu');
  else tickets = tickets.filter(t => t.status === _supportAdminFilter);
  if (tickets.length === 0) { list.innerHTML = `<div class="support-empty">${_supportAdminFilter === 'resolu' ? 'Aucun ticket archivé.' : 'Aucun ticket.'}</div>`; return; }
  list.innerHTML = tickets.map(t => {
    const cat = SUPPORT_CATEGORY_MAP[t.category ? SUPPORT_CATEGORY_BY_GH_LABEL[t.category] : null];
    const status = SUPPORT_STATUS[t.status] || SUPPORT_STATUS.nouveau;
    const unseen = ticketNeedsAdminAttention(t, seen);
    return `
      <button class="support-ticket-item ${unseen ? 'support-ticket-item--unseen' : ''} ${_supportAdminOpenTicket === t.number ? 'support-ticket-item--active' : ''}" data-number="${t.number}" type="button">
        <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
        <span class="support-ticket-info">
          <span class="support-ticket-title">${t.private ? '🔒 ' : ''}${escapeHtml(extractImageFromMessage(t.message || t.title || '').text.slice(0, 60))}</span>
          <span class="support-ticket-meta">${t.reporterEmail ? escapeHtml(supportUserLabel(t.reporterEmail)) + ' · ' : ''}${formatDate(t.updatedAt)}</span>
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
    _supportAdminOpenTicketSig = `${ticket.status}|${comments.length}|${comments[comments.length - 1]?.createdAt || ''}`;
    markAdminTicketSeen(number);
    const cat = SUPPORT_CATEGORY_MAP[ticket.category ? SUPPORT_CATEGORY_BY_GH_LABEL[ticket.category] : null];
    detail.innerHTML = `
      <div class="support-thread-header">
        <span class="support-ticket-cat">${cat ? cat.icon : '📝'}</span>
        <div>
          <div class="support-ticket-title">${ticket.private ? '🔒 ' : ''}${renderSupportMsgHtml(ticket.message || ticket.title || '')}</div>
          <div class="support-ticket-meta">${ticket.page ? escapeHtml(ticket.page) + ' · ' : ''}${ticket.reporterEmail ? escapeHtml(supportUserLabel(ticket.reporterEmail)) + ' · ' : ''}Ouvert le ${formatDate(ticket.createdAt)}</div>
        </div>
        <select class="form-input support-status-select" id="support-admin-status-select">
          ${Object.entries(SUPPORT_STATUS).map(([k, v]) => `<option value="${k}" ${ticket.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
        </select>
        ${privacyToggleBtnHtml('support-admin-privacy-toggle', ticket)}
      </div>
      <div class="support-thread-comments">
        ${comments.length === 0 ? '<div class="support-empty">Pas encore de réponse.</div>' : comments.map(c => `
          <div class="support-comment ${c.author === 'admin' ? 'support-comment--admin' : 'support-comment--user'}">
            <div class="support-comment-author">${c.author === 'admin' ? 'Vous (équipe)' : escapeHtml(supportUserLabel(ticket.reporterEmail))}</div>
            <div class="support-comment-msg">${renderSupportMsgHtml(c.message)}</div>
            <div class="support-comment-date">${formatDate(c.createdAt)}</div>
          </div>`).join('')}
      </div>
      <form id="support-admin-reply-form" class="support-reply-form">
        <textarea class="form-input support-form-textarea" id="support-admin-reply-message" placeholder="Votre réponse…" required></textarea>
        ${emojiToolbarHtml('support-admin-reply')}
        ${supportImagePickerHtml('support-admin-reply')}
        <button class="btn-save-profile" type="submit">Répondre</button>
      </form>
      <button class="support-delete-btn" id="support-admin-delete-ticket" type="button">🗑️ Supprimer ce ticket</button>
    `;
    el('support-admin-delete-ticket').onclick = () => deleteSupportTicket(number, () => {
      _supportAdminOpenTicket = null;
      _supportAdminTicketsCache = _supportAdminTicketsCache.filter(t => t.number !== number);
      renderSupportAdminList();
      el('support-admin-detail').innerHTML = '<div class="support-empty">Sélectionnez un ticket dans la liste.</div>';
    });
    el('support-admin-privacy-toggle').onclick = async (e) => {
      e.target.disabled = true;
      const ok = await toggleTicketPrivacy(number, !ticket.private);
      if (ok) {
        const t = _supportAdminTicketsCache.find(x => x.number === number);
        if (t) t.private = !ticket.private;
        openSupportAdminTicket(number);
      } else {
        e.target.disabled = false;
      }
    };
    el('support-admin-status-select').onchange = async (e) => {
      const status = e.target.value;
      try {
        const r = await fetch(`${API}/api/support/admin/tickets/${number}/status`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur');
        showToast('Statut mis à jour', 'success');
        const t = _supportAdminTicketsCache.find(x => x.number === number);
        // Le changement de statut met a jour updatedAt cote GitHub (posterieur
        // au markAdminTicketSeen fait a l'OUVERTURE du ticket, donc anterieur a
        // cette action) - sans re-marquer vu ici, le prochain sondage (30s,
        // supportPollTick) le voyait "non lu" a nouveau juste parce que l'admin
        // venait lui-meme de le modifier (bug reel constate : la notification
        // se rallumait apres avoir traite le ticket).
        if (t) { t.status = status; t.updatedAt = new Date().toISOString(); }
        markAdminTicketSeen(number);
        renderSupportAdminList();
      } catch (err) { showToast('Erreur : ' + err.message, 'error'); }
    };
    wireEmojiPicker('support-admin-reply');
    const adminReplyImagePicker = wireSupportImagePicker('support-admin-reply');
    detail.querySelector('#support-admin-reply-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = el('support-admin-reply-message');
      const message = msgEl.value.trim();
      if (!message) return;
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Envoi…';
      try {
        const imageUrl = await uploadSupportImage(adminReplyImagePicker.getDataUrl());
        const r = await fetch(`${API}/api/support/tickets/${number}/comments`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, imageUrl }),
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

// ─── Rafraichissement periodique ─────────────────────────────────
// checkStatus() (app.js) ne declenche checkSupportNotifications() qu'une
// seule fois, au chargement de la page - sans boucle, une reponse admin ou
// un nouveau ticket ne se voyait donc jamais tant que l'utilisateur ne
// rechargeait pas la page a la main (constat utilisateur). Cette boucle
// rafraichit aussi, en plus des badges, la vue actuellement affichee
// (liste admin, fil de discussion ouvert) pour que l'app reste a jour sans
// action de l'utilisateur.
const SUPPORT_POLL_INTERVAL_MS = 30000;

// Signature legere d'une liste de tickets (numero+statut+updatedAt) - permet
// de sauter le re-rendu de la liste quand rien n'a change, pour eviter un
// clignotement visible toutes les 30s meme quand aucun ticket n'a bouge.
function ticketListSignature(tickets) {
  return (tickets || []).map(t => `${t.number}:${t.status}:${t.updatedAt}`).join('|');
}

// Signature d'un ticket ouvert (statut + nombre de commentaires + date du
// dernier) - meme logique que ticketListSignature, pour le fil affiche.
let _supportAdminOpenTicketSig = null;
async function refreshOpenAdminTicketIfChanged(number) {
  try {
    const res = await fetch(`${API}/api/support/tickets/${number}`);
    const { ticket, comments } = await res.json();
    const sig = `${ticket.status}|${comments.length}|${comments[comments.length - 1]?.createdAt || ''}`;
    if (sig === _supportAdminOpenTicketSig) return; // rien de neuf, on ne touche pas au DOM
    openSupportAdminTicket(number);
  } catch (e) { /* silencieux */ }
}

async function supportPollTick() {
  await checkSupportNotifications();
  if (!isSupportAdmin()) return;
  const prevListSig = ticketListSignature(_supportAdminTicketsCache);
  await checkSupportAdminNotifications();
  if (document.getElementById('page-support-admin')?.classList.contains('active')) {
    if (ticketListSignature(_supportAdminTicketsCache) !== prevListSig) renderSupportAdminList();
    // Ne pas reconstruire le fil (et donc la zone de reponse) si l'admin est
    // en train d'y taper, et seulement si le ticket a reellement change -
    // sinon le panneau clignotait toutes les 30s meme sans rien de nouveau
    // (constat utilisateur), et le focus/texte saisi etaient perdus.
    const replyEl = document.getElementById('support-admin-reply-message');
    const isTyping = replyEl && (document.activeElement === replyEl || replyEl.value.trim() !== '');
    if (_supportAdminOpenTicket != null && !isTyping) await refreshOpenAdminTicketIfChanged(_supportAdminOpenTicket);
  }
}

setInterval(supportPollTick, SUPPORT_POLL_INTERVAL_MS);
