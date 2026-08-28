// ============================================================
// gear.js — Équipement (chaussures) : gestion (Profil) + assignation
// par activité (Détail d'activité). Dépend de app.js (el, API,
// showToast, showConfirmModal, attachBackdropClose, escapeHtml, personEmoji).
// ============================================================

const GEAR_BRANDS = ['Nike', 'Adidas', 'Asics', 'Hoka', 'Brooks', 'Saucony', 'New Balance', 'Salomon', 'La Sportiva', 'Mizuno', 'On', 'Altra', 'Puma', 'Under Armour', 'Autre'];

let _gearData = [];

// ─── Carte "Équipement" (Profil) ───────────────────────────────────────
async function initGearSection() {
  const container = el('gear-list');
  if (!container) return;
  container.innerHTML = '<div class="profile-indicator-empty">Chargement…</div>';
  try {
    _gearData = await fetch(`${API}/api/gear`).then(r => r.json());
    renderGearList();
  } catch (e) {
    container.innerHTML = '<div class="profile-indicator-empty">Erreur de chargement.</div>';
  }
}

function renderGearList() {
  const container = el('gear-list');
  if (!container) return;
  if (!_gearData.length) {
    container.innerHTML = '<div class="profile-indicator-empty">Aucune paire enregistrée pour l’instant.</div>';
    return;
  }
  const typeOrder = { route: 0, trail: 1 };
  const sorted = [..._gearData].sort((a, b) =>
    (typeOrder[a.type] - typeOrder[b.type]) ||
    ((b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)) ||
    a.name.localeCompare(b.name, 'fr'));
  container.innerHTML = sorted.map(renderGearRow).join('');
}

function renderGearRow(g) {
  const km = g.currentKm || 0;
  const max = g.maxKm;
  const ratio = max ? Math.min(km / max, 1) : 0;
  const fillClass = !max ? '' : ratio >= 1 ? 'gear-progress-fill--danger' : ratio >= 0.85 ? 'gear-progress-fill--warn' : '';
  const barHtml = max
    ? `<div class="campus-progress-track gear-progress-track">
         <div class="campus-progress-fill ${fillClass}" style="width:${Math.round(ratio * 100)}%"></div>
       </div>
       <div class="gear-km-caption${ratio >= 1 ? ' gear-km-caption--danger' : ''}">${km.toFixed(0)} / ${max} km${ratio >= 1 ? ' — à remplacer !' : ''}</div>`
    : `<div class="gear-km-caption">${km.toFixed(0)} km parcourus</div>`;

  return `
    <div class="gear-row">
      <div class="gear-row-main">
        <span class="gear-type-badge gear-type-badge--${g.type}">${g.type === 'trail' ? '🏔️ Trail' : personEmoji('running') + ' Route'}</span>
        <div class="gear-row-info">
          <div class="gear-row-name">${escapeHtml(g.name)}${g.isDefault ? ' <span class="card-badge card-badge--blue">Par défaut</span>' : ''}</div>
          <div class="gear-row-brand">${escapeHtml(g.brand || '')}${g.firstUseDate ? ' &middot; depuis le ' + formatDate(g.firstUseDate) : ''}</div>
        </div>
      </div>
      <div class="gear-row-progress">${barHtml}</div>
      <div class="gear-row-actions">
        <button class="race-action-btn" onclick="openGearModal('${g.id}')" title="Modifier">&#9998;</button>
        <button class="race-action-btn" onclick="deleteGear('${g.id}')" title="Supprimer">&#128465;</button>
      </div>
    </div>`;
}

function openGearModal(gearId = null) {
  if (document.getElementById('gear-edit-modal')) return;
  const current = gearId ? _gearData.find(g => g.id === gearId) : null;
  const isKnownBrand = current && GEAR_BRANDS.includes(current.brand);

  const backdrop = document.createElement('div');
  backdrop.className = 'stats-modal-backdrop';
  backdrop.id = 'gear-edit-modal';
  backdrop.innerHTML = `
    <div class="stats-modal" style="width:min(440px,94vw)" onclick="event.stopPropagation()">
      <div class="stats-modal-header">
        <h2>${current ? 'Modifier la paire' : 'Ajouter une paire'}</h2>
        <button class="stats-modal-close" id="gear-modal-close-btn">&times;</button>
      </div>
      <div class="form-row">
        <span class="form-label">Marque</span>
        <select class="form-input" id="gear-form-brand" style="max-width:100%">
          <option value="">—</option>
          ${GEAR_BRANDS.map(b => `<option value="${b}">${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-row" id="gear-form-brand-other-row" style="display:none">
        <span class="form-label">Précisez la marque</span>
        <input type="text" class="form-input" id="gear-form-brand-other" style="max-width:100%" placeholder="Ex : Topo Athletic" />
      </div>
      <div class="form-row">
        <span class="form-label">Nom de la paire</span>
        <input type="text" class="form-input" id="gear-form-name" style="max-width:100%" placeholder="Ex : Pegasus 40 grise" />
      </div>
      <div class="form-row">
        <span class="form-label">Type</span>
        <div class="form-toggle-group">
          <button type="button" class="form-toggle active" id="gear-type-route" data-val="route">${personEmoji('running')} Route</button>
          <button type="button" class="form-toggle" id="gear-type-trail" data-val="trail">&#127956;&#65039; Trail</button>
        </div>
      </div>
      <div class="form-row">
        <span class="form-label">Date de première utilisation</span>
        <div class="form-input-wrap">
          <input type="date" class="form-input" id="gear-form-firstusedate" style="max-width:100%" />
        </div>
        <div class="gear-form-hint">Les km déjà parcourus depuis cette date seront calculés automatiquement à partir des activités ${personEmoji('running')}/&#127956;&#65039; correspondantes (celles pas déjà assignées à une autre paire).</div>
      </div>
      <div class="form-row">
        <span class="form-label">Km max avant remplacement</span>
        <div class="form-input-wrap">
          <input type="number" class="form-input" id="gear-form-maxkm" min="0" step="10" placeholder="optionnel" />
          <span class="form-unit">km</span>
        </div>
      </div>
      <div class="form-row">
        <label class="form-checkbox-inline">
          <input type="checkbox" id="gear-form-default" /> Paire par défaut pour ce type
        </label>
      </div>
      <div class="race-modal-actions">
        <button class="btn-wizard-back" id="gear-modal-cancel">Annuler</button>
        <button class="btn-wizard-next" id="gear-modal-save">Enregistrer</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const brandSelect = el('gear-form-brand');
  const brandOtherRow = el('gear-form-brand-other-row');
  const brandOtherInput = el('gear-form-brand-other');
  brandSelect.onchange = () => { brandOtherRow.style.display = brandSelect.value === 'Autre' ? '' : 'none'; };

  if (current) {
    brandSelect.value = isKnownBrand ? current.brand : (current.brand ? 'Autre' : '');
    if (!isKnownBrand && current.brand) { brandOtherRow.style.display = ''; brandOtherInput.value = current.brand; }
  }
  el('gear-form-name').value = current?.name || '';
  el('gear-form-firstusedate').value = current?.firstUseDate ? String(current.firstUseDate).slice(0, 10) : '';
  el('gear-form-maxkm').value = current?.maxKm ?? '';
  el('gear-form-default').checked = !!current?.isDefault;

  const typeRoute = el('gear-type-route'), typeTrail = el('gear-type-trail');
  let selType = current?.type || 'route';
  const setType = (t) => {
    selType = t;
    typeRoute.classList.toggle('active', t === 'route');
    typeTrail.classList.toggle('active', t === 'trail');
  };
  setType(selType);
  typeRoute.onclick = () => setType('route');
  typeTrail.onclick = () => setType('trail');

  const close = () => backdrop.remove();
  attachBackdropClose(backdrop, close);
  el('gear-modal-close-btn').onclick = close;
  el('gear-modal-cancel').onclick = close;
  el('gear-modal-save').onclick = async () => {
    const brand = brandSelect.value === 'Autre' ? brandOtherInput.value.trim() : brandSelect.value;
    const name = el('gear-form-name').value.trim();
    const firstUseDate = el('gear-form-firstusedate').value || null;
    const maxKmRaw = el('gear-form-maxkm').value;
    const isDefault = el('gear-form-default').checked;
    if (!name) { showToast('Merci de donner un nom à la paire', 'error'); return; }
    const payload = { brand, name, type: selType, firstUseDate, maxKm: maxKmRaw !== '' ? Number(maxKmRaw) : null, isDefault };
    try {
      const url = current ? `${API}/api/gear/${current.id}` : `${API}/api/gear`;
      const method = current ? 'PUT' : 'POST';
      const dateChanged = firstUseDate && firstUseDate !== (current?.firstUseDate ? String(current.firstUseDate).slice(0, 10) : null);
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || 'Erreur');
      await initGearSection();
      showToast(current ? 'Paire mise à jour' : (dateChanged ? 'Paire ajoutée — kilométrage calculé depuis les activités' : 'Paire ajoutée'), 'success');
      close();
    } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
  };
}

async function deleteGear(id) {
  const gear = _gearData.find(g => g.id === id);
  const ok = await showConfirmModal({
    title: 'Supprimer cette paire ?',
    message: `« ${gear?.name || ''} » sera supprimée et désassociée des activités concernées.`,
    confirmLabel: 'Supprimer',
    icon: '🗑',
  });
  if (!ok) return;
  try {
    await fetch(`${API}/api/gear/${id}`, { method: 'DELETE' });
    await initGearSection();
    showToast('Paire supprimée', 'success');
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ─── Assignation d'une paire à une activité (Détail d'activité) ───────
// Prefill : paire par defaut du type correspondant (route/trail) si aucune
// assignation n'existe encore pour cette activite - et enregistree telle
// quelle (pas juste affichee) pour que le kilometrage de la paire par
// defaut se construise au fil des consultations, sans action manuelle
// repetee. Une assignation deja existante n'est jamais ecrasee.
async function mountActivityGearField(activity) {
  const wrap = el('activity-gear-value');
  if (!wrap || !activity?.id) return;
  const type = (activity.activityType || '').toLowerCase();
  const isTrail = type.includes('trail');
  // Marche/rando : pas de paire "attitrée" par defaut (aucune activite de ce
  // type n'a jamais servi a construire une paire route/trail) — la case reste
  // vide tant que l'utilisateur ne choisit pas lui-meme une paire existante.
  const isHike = type.includes('walk') || type.includes('hik');

  if (!_gearData.length) {
    try { _gearData = await fetch(`${API}/api/gear`).then(r => r.json()); } catch (e) {}
  }
  if (!_gearData.length) {
    wrap.innerHTML = '<span style="color:var(--text-muted);font-size:11px">Aucune paire enregistrée</span>';
    return;
  }

  let assigned = null;
  try { assigned = await fetch(`${API}/api/activity-gear/${activity.id}`).then(r => r.json()); } catch (e) {}
  const defaultGear = isHike ? null : _gearData.find(g => g.type === (isTrail ? 'trail' : 'route') && g.isDefault);
  const selectedId = assigned?.gearId || defaultGear?.id || '';

  wrap.innerHTML = `<select id="activity-gear-select" class="activity-gear-select">
    <option value="">Non renseigné</option>
    ${_gearData.map(g => `<option value="${g.id}" ${g.id === selectedId ? 'selected' : ''}>${escapeHtml(g.name)}${g.type === 'trail' ? ' (trail)' : ''}</option>`).join('')}
  </select>`;

  el('activity-gear-select').onchange = (e) => assignActivityGear(activity, e.target.value);

  if (!assigned && defaultGear) assignActivityGear(activity, defaultGear.id, /*silent*/ true);
}

async function assignActivityGear(activity, gearId, silent = false) {
  try {
    if (!gearId) {
      await fetch(`${API}/api/activity-gear/${activity.id}`, { method: 'DELETE' });
    } else {
      await fetch(`${API}/api/activity-gear/${activity.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gearId, distanceKm: activity.distanceKm || 0, date: activity.date || null }),
      });
    }
    if (!silent) showToast('Chaussures mises à jour', 'success');
  } catch (err) {
    if (!silent) showToast('Erreur : ' + err.message, 'error');
  }
}
