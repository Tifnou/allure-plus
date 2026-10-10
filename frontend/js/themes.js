// ═══════════════════════════════════════════════════════════════════════
// THEMES DE SAISON (Halloween, Noël, Saint-Valentin…)
// ═══════════════════════════════════════════════════════════════════════
// Palette + décors vivent ICI (et dans css/seasons.css) ; le calendrier (quels
// thèmes, quelles dates, forçage éventuel) vient du serveur
// (/api/season-config → seasonal_themes.json du dépôt Git, programmé depuis la
// page Admin) — il ne transporte que des identifiants et des dates.
//
// Priorité d'activation : aperçu local (admin, localStorage) > forçage (config)
// > calendrier (dates récurrentes chaque année). Pendant un thème, il IMPOSE son
// ambiance (clair ou sombre) : la préférence clair/sombre de l'utilisateur n'est
// jamais écrasée, juste masquée (voir applyTheme, app.js), et revient à la fin.
(function () {
  const LS_CACHE = 'allure_season_cache';
  const LS_PREVIEW = 'allure_season_preview';
  const REFRESH_MS = 3 * 60 * 60 * 1000;

  const HAT_SANTA = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M5 31C8 9 30 1 45 14c-9-2-17 3-19 17z" fill="#DC2626"/><rect x="1" y="28" width="31" height="9" rx="4.5" fill="#fff"/><circle cx="44.5" cy="14" r="5" fill="#fff"/></svg>';
  const HAT_WITCH = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M26 1l11 29H13z" fill="#6D28D9"/><rect x="3" y="28" width="42" height="7" rx="3.5" fill="#4C1D95"/><rect x="15" y="21" width="20" height="5" fill="#F97316"/></svg>';
  const HAT_HEART = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M24 36C8 24 6 12 14 8c5-2 9 1 10 5 1-4 5-7 10-5 8 4 6 16-10 28z" fill="#E11D48"/></svg>';

  // kind 'fall' : tombent ; 'rise' : montent. count volontairement modeste.
  const SEASONS = {
    halloween: { label: 'Halloween', emoji: '🎃', base: 'dark', hat: HAT_WITCH, fx: { kind: 'fall', chars: ['🦇', '🍂', '🎃', '🕸️'], count: 14 } },
    noel: { label: 'Noël', emoji: '🎄', base: 'dark', hat: HAT_SANTA, fx: { kind: 'fall', chars: ['❄', '❅', '❆', '✦'], count: 22 } },
    'saint-valentin': { label: 'Saint-Valentin', emoji: '💝', base: 'light', hat: HAT_HEART, fx: { kind: 'rise', chars: ['❤️', '💗', '💕', '💖'], count: 14 } },
  };
  const SEASON_IDS = Object.keys(SEASONS);
  window.SEASONS = SEASONS;

  const pad = n => String(n).padStart(2, '0');
  const mmdd = d => pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const isoDay = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const inRange = (cur, start, end) => start <= end ? (cur >= start && cur <= end) : (cur >= start || cur <= end);

  // → { id, reason: 'force' | 'schedule' } | null
  function resolveSeason(cfg, now) {
    if (!cfg) return null;
    now = now || new Date();
    const f = cfg.force;
    if (f && SEASONS[f.id] && (!f.until || isoDay(now) <= f.until)) return { id: f.id, reason: 'force' };
    const cur = mmdd(now);
    const hit = (cfg.themes || []).find(t => t.enabled !== false && SEASONS[t.id] && inRange(cur, t.start, t.end));
    return hit ? { id: hit.id, reason: 'schedule' } : null;
  }
  window.resolveSeason = resolveSeason;

  function getPreview() {
    try { const v = localStorage.getItem(LS_PREVIEW); return SEASONS[v] ? v : null; } catch (e) { return null; }
  }
  function setPreview(id) {
    try { if (id) localStorage.setItem(LS_PREVIEW, id); else localStorage.removeItem(LS_PREVIEW); } catch (e) { /* silencieux */ }
    applySeason();
  }

  let _cfg = null;
  try { _cfg = (JSON.parse(localStorage.getItem(LS_CACHE) || 'null') || {}).cfg || null; } catch (e) { _cfg = null; }

  function currentSeasonId() {
    return getPreview() || (resolveSeason(_cfg) || {}).id || null;
  }

  function clearDecor() {
    document.getElementById('season-fx')?.remove();
    document.getElementById('season-hat')?.remove();
    document.getElementById('season-badge')?.remove();
  }

  function buildDecor(id) {
    const s = SEASONS[id];
    clearDecor();
    if (document.body) {
      const fx = document.createElement('div');
      fx.id = 'season-fx';
      fx.setAttribute('aria-hidden', '1');
      fx.className = 'season-fx season-fx--' + s.fx.kind;
      for (let i = 0; i < s.fx.count; i++) {
        const p = document.createElement('span');
        p.className = 'season-particle';
        p.textContent = s.fx.chars[i % s.fx.chars.length];
        const size = 11 + Math.random() * 13;
        p.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;font-size:${size.toFixed(0)}px;` +
          `animation-duration:${(11 + Math.random() * 13).toFixed(1)}s;animation-delay:-${(Math.random() * 20).toFixed(1)}s;` +
          `--sway:${(Math.random() * 40 - 20).toFixed(0)}px;opacity:${(0.35 + Math.random() * 0.4).toFixed(2)}`;
        fx.appendChild(p);
      }
      document.body.appendChild(fx);
    }
    const brand = document.querySelector('.sidebar-brand');
    if (brand) {
      const hat = document.createElement('span');
      hat.id = 'season-hat';
      hat.className = 'season-hat';
      hat.innerHTML = s.hat;
      brand.appendChild(hat);
      const user = brand.querySelector('.brand-user');
      if (user && user.parentElement) {
        const badge = document.createElement('div');
        badge.id = 'season-badge';
        badge.className = 'season-badge';
        badge.textContent = s.emoji + ' ' + s.label;
        user.parentElement.appendChild(badge);
      }
    }
  }

  function lockToggle(id) {
    const tg = document.getElementById('theme-toggle');
    if (!tg) return;
    tg.classList.toggle('theme-toggle--locked', !!id);
    tg.title = id ? `Thème ${SEASONS[id].label} en cours — le choix clair/sombre reviendra à la fin de la période` : '';
  }

  // Applique (ou retire) le thème de saison courant. Idempotent.
  function applySeason() {
    const id = currentSeasonId();
    const root = document.documentElement;
    window.__activeSeasonBase = id ? SEASONS[id].base : null;
    if (id) root.dataset.season = id; else delete root.dataset.season;
    // Recalcule data-theme (+ logo) via la fonction de l'app : theme force si
    // saison active, sinon preference enregistree de l'utilisateur.
    if (typeof applyTheme === 'function') applyTheme(localStorage.getItem('allure_theme') || 'light');
    else root.dataset.theme = window.__activeSeasonBase || localStorage.getItem('allure_theme') || 'light';
    if (id && document.body) buildDecor(id); else clearDecor();
    lockToggle(id);
    document.dispatchEvent(new CustomEvent('season-changed', { detail: { id } }));
  }
  window.applySeason = applySeason;

  async function refreshSeasonConfig() {
    try {
      const r = await fetch('/api/season-config', { cache: 'no-store' });
      if (!r.ok) return;
      const { config, source } = await r.json();
      _cfg = config;
      try { localStorage.setItem(LS_CACHE, JSON.stringify({ cfg: config, source, ts: Date.now() })); } catch (e) { /* silencieux */ }
      applySeason();
    } catch (e) { /* hors ligne : on garde la derniere config connue */ }
  }

  // Évite le flash : la config en cache (dernier lancement) s'applique
  // immédiatement, avant le premier rendu complet.
  window.__activeSeasonBase = null;
  (function early() {
    const id = currentSeasonId();
    if (!id) return;
    window.__activeSeasonBase = SEASONS[id].base;
    document.documentElement.dataset.season = id;
    document.documentElement.dataset.theme = SEASONS[id].base;
  })();

  document.addEventListener('DOMContentLoaded', () => {
    applySeason();
    refreshSeasonConfig();
    setInterval(refreshSeasonConfig, REFRESH_MS);
  });

  // ─── Section Admin : tester, programmer, forcer, publier ─────────────
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  let _admin = null; // { cfg (edition), remote, inSync, canPublish, dirty }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function mdParts(v) { const [m, d] = String(v).split('-').map(Number); return { m, d }; }

  window.loadAdminSeasons = async function () {
    const box = document.getElementById('admin-seasons');
    if (!box) return;
    box.innerHTML = '<div class="table-loading">Chargement…</div>';
    try {
      const r = await fetch('/api/admin/season-config', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      _admin = { cfg: JSON.parse(JSON.stringify(d.local)), remote: d.remote, inSync: d.inSync, canPublish: d.canPublish, dirty: false };
      renderAdminSeasons();
    } catch (e) {
      box.innerHTML = '<div class="table-loading">Impossible de charger la programmation des thèmes.</div>';
    }
  };

  function statusLine() {
    const eff = resolveSeason(_admin.remote || _cfg);
    const prev = getPreview();
    const parts = [];
    parts.push(eff
      ? `Actif pour tous les utilisateurs : <strong>${SEASONS[eff.id].emoji} ${SEASONS[eff.id].label}</strong> (${eff.reason === 'force' ? 'forcé' : 'calendrier'})`
      : 'Actif pour tous les utilisateurs : <strong>aucun</strong> (interface normale)');
    if (prev) parts.push(`Aperçu local en cours : <strong>${SEASONS[prev].emoji} ${SEASONS[prev].label}</strong>`);
    const sync = !_admin.remote ? 'Dépôt : ⚠️ aucune programmation publiée trouvée sur GitHub (jamais publiée, ou hors ligne)'
      : (_admin.inSync && !_admin.dirty ? 'Dépôt : ✅ synchronisé avec ce que vous voyez ici' : 'Dépôt : ⚠️ modifications non publiées');
    parts.push(sync);
    return parts.map(p => `<div>${p}</div>`).join('');
  }

  function dateField(id, which, value) {
    const { m, d } = mdParts(value);
    return `<span class="season-date">
      <input type="number" min="1" max="31" value="${d}" data-season="${id}" data-field="${which}-d" aria-label="Jour">
      <select data-season="${id}" data-field="${which}-m" aria-label="Mois">${MONTHS.map((n, i) => `<option value="${i + 1}"${i + 1 === m ? ' selected' : ''}>${n}</option>`).join('')}</select>
    </span>`;
  }

  function renderAdminSeasons() {
    const box = document.getElementById('admin-seasons');
    if (!box || !_admin) return;
    const cfg = _admin.cfg, prev = getPreview();
    const force = cfg.force;
    box.innerHTML = `
      <div class="season-status">${statusLine()}</div>
      <table class="season-table">
        <thead><tr><th>Thème</th><th>Actif</th><th>Du</th><th>Au</th><th>Test local</th></tr></thead>
        <tbody>${cfg.themes.map(t => `
          <tr>
            <td><span class="season-name">${SEASONS[t.id].emoji} ${esc(SEASONS[t.id].label)}</span></td>
            <td><input type="checkbox" data-season="${t.id}" data-field="enabled"${t.enabled ? ' checked' : ''} aria-label="Activer ${esc(SEASONS[t.id].label)}"></td>
            <td>${dateField(t.id, 'start', t.start)}</td>
            <td>${dateField(t.id, 'end', t.end)}</td>
            <td><button type="button" class="btn-admin-action season-prev-btn${prev === t.id ? ' is-on' : ''}" data-season="${t.id}">${prev === t.id ? '⏹ Arrêter' : '👁 Aperçu'}</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="season-force">
        <label>Forcer pour tous :
          <select id="season-force-id">
            <option value="">— aucun forçage —</option>
            ${SEASON_IDS.map(id => `<option value="${id}"${force && force.id === id ? ' selected' : ''}>${SEASONS[id].emoji} ${esc(SEASONS[id].label)}</option>`).join('')}
          </select>
        </label>
        <label>jusqu'au <input type="date" id="season-force-until" value="${force && force.until ? force.until : ''}"></label>
        <span class="season-hint">Le forçage prime sur le calendrier. Sans date de fin, il reste actif jusqu'à ce que vous le retiriez.</span>
      </div>
      <div class="season-actions">
        <button type="button" class="btn-admin-action" id="season-save-btn">💾 Enregistrer</button>
        <button type="button" class="btn-admin-action season-publish-btn" id="season-publish-btn"${_admin.canPublish ? '' : ' disabled title="Ce poste ne contient pas le dépôt Git d\'Allure+"'}>🚀 Publier aux utilisateurs</button>
        <span class="season-hint">Publier = commit + push du fichier <code>seasonal_themes.json</code> uniquement. Les postes le récupèrent au lancement puis toutes les 3 h (≈ 5 min de délai GitHub).</span>
      </div>
      <div class="season-result" id="season-result" aria-live="polite"></div>`;
    wireAdminSeasons();
  }

  function readEdits() {
    const box = document.getElementById('admin-seasons');
    const cfg = _admin.cfg;
    cfg.themes.forEach(t => {
      const g = f => box.querySelector(`[data-season="${t.id}"][data-field="${f}"]`);
      t.enabled = !!g('enabled')?.checked;
      ['start', 'end'].forEach(w => {
        const m = Math.min(12, Math.max(1, parseInt(g(w + '-m')?.value, 10) || 1));
        const dmax = new Date(2024, m, 0).getDate();
        const d = Math.min(dmax, Math.max(1, parseInt(g(w + '-d')?.value, 10) || 1));
        t[w] = pad(m) + '-' + pad(d);
      });
    });
    const fid = box.querySelector('#season-force-id')?.value || '';
    const until = box.querySelector('#season-force-until')?.value || '';
    cfg.force = fid ? { id: fid, until: until || null } : null;
  }

  function showResult(msg, ok) {
    const el = document.getElementById('season-result');
    if (el) { el.textContent = msg; el.className = 'season-result ' + (ok ? 'is-ok' : 'is-err'); }
  }

  async function saveAdminSeasons() {
    readEdits();
    const r = await fetch('/api/admin/season-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: _admin.cfg }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'HTTP ' + r.status);
    const d = await r.json();
    _admin.cfg = d.config;
    _admin.dirty = true; // enregistre localement, pas encore publie
    _admin.inSync = false;
  }

  function wireAdminSeasons() {
    const box = document.getElementById('admin-seasons');
    if (!box._seasonWired) { box._seasonWired = true; box.addEventListener('change', () => { _admin.dirty = true; readEdits(); }); }
    box.querySelectorAll('.season-prev-btn').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.season;
      setPreview(getPreview() === id ? null : id);
      renderAdminSeasons();
    }));
    document.getElementById('season-save-btn').addEventListener('click', async () => {
      try { await saveAdminSeasons(); renderAdminSeasons(); showResult('Programmation enregistrée localement (pas encore publiée).', true); }
      catch (e) { showResult('Échec de l\'enregistrement : ' + e.message, false); }
    });
    document.getElementById('season-publish-btn').addEventListener('click', async () => {
      readEdits();
      const forced = _admin.cfg.force;
      const ok = typeof showConfirmModal === 'function' ? await showConfirmModal({
        title: 'Publier la programmation des thèmes ?',
        message: 'Tous les utilisateurs d\'Allure+ verront cette programmation à leur prochain lancement (ou sous 3 h)' +
          (forced ? `, avec le thème « ${SEASONS[forced.id].label} » FORCÉ${forced.until ? ' jusqu\'au ' + forced.until : ' sans date de fin'}` : '') +
          '. Un commit sera créé et poussé sur GitHub (fichier seasonal_themes.json uniquement).',
        confirmLabel: 'Publier', icon: '🚀',
      }) : true;
      if (!ok) return;
      try {
        await saveAdminSeasons();
        const r = await fetch('/api/admin/season-config/publish', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
        await window.loadAdminSeasons();
        showResult(d.committed ? 'Publié : commit créé et poussé sur GitHub.' : 'Rien de nouveau à publier : le dépôt était déjà à jour.', true);
      } catch (e) { showResult(e.message, false); }
    });
  }

  document.addEventListener('season-changed', () => { if (_admin && document.getElementById('admin-seasons')?.children.length) renderAdminSeasons(); });
})();
