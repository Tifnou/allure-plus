// ═══════════════════════════════════════════════════════════════════════
// SKINS (habillages choisis par l'utilisateur, ex : Gentle Mates M8)
// ═══════════════════════════════════════════════════════════════════════
// Différent des thèmes de saison (themes.js) : un skin est un CHOIX PERSONNEL
// permanent (Profil > Apparence), pas un calendrier. Il se superpose à la
// préférence clair/sombre sans jamais la forcer — chaque skin a donc sa palette
// claire ET sa palette sombre (css/skins.css). Un thème de saison actif reste
// prioritaire (le CSS exclut `[data-season]`).
// Clé `allure_skin` : durable (DURABLE_LS_KEYS, app.js) pour suivre le compte
// d'un PC à l'autre. Chargé dans <head> pour éviter le flash au démarrage.
(function () {
  const LS_KEY = 'allure_skin';

  // `swatches` : [clair, sombre, accent, accent secondaire] — aperçu du sélecteur.
  const SKINS = {
    m8: {
      label: 'Gentle Mates · M8',
      badge: 'M8',
      desc: 'Noir, blanc cassé et bleu royal du maillot, avec une touche dorée.',
      swatches: ['#F1F3F2', '#080808', '#1E4FA8', '#C9A24B'],
    },
  };
  window.SKINS = SKINS;

  function getSkin() {
    try { const v = localStorage.getItem(LS_KEY); return SKINS[v] ? v : null; } catch (e) { return null; }
  }

  function applySkin() {
    const id = getSkin();
    const root = document.documentElement;
    if (id) root.dataset.skin = id; else delete root.dataset.skin;
    document.getElementById('skin-badge')?.remove();
    if (id && document.body) {
      const user = document.querySelector('.sidebar-brand .brand-user');
      if (user && user.parentElement) {
        const b = document.createElement('div');
        b.id = 'skin-badge';
        b.className = 'skin-badge';
        b.textContent = SKINS[id].badge;
        b.title = SKINS[id].label;
        user.parentElement.appendChild(b);
      }
    }
    renderSkinPicker();
  }

  function setSkin(id) {
    try {
      if (id && SKINS[id]) localStorage.setItem(LS_KEY, id);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* silencieux */ }
    applySkin();
  }
  window.setSkin = setSkin;
  window.applySkin = applySkin;

  function tile(id, label, desc, swatches, selected) {
    const sw = swatches.map(c => `<span class="skin-sw" style="background:${c}"></span>`).join('');
    return `<button type="button" class="skin-tile${selected ? ' is-selected' : ''}" role="radio" aria-checked="${selected}" onclick="setSkin(${id ? `'${id}'` : 'null'})">` +
      `<span class="skin-sws">${sw}</span><span class="skin-tile-name">${label}</span><span class="skin-tile-desc">${desc}</span></button>`;
  }

  function renderSkinPicker() {
    const box = document.getElementById('skin-picker');
    if (!box) return;
    const cur = getSkin();
    box.innerHTML = tile(null, 'Allure+', 'L’habillage d’origine.', ['#F7F6F3', '#0B0D14', '#2563EB', '#6CB840'], !cur) +
      Object.keys(SKINS).map(id => tile(id, SKINS[id].label, SKINS[id].desc, SKINS[id].swatches, cur === id)).join('');
  }

  // Attribut posé tout de suite (avant le premier rendu) : pas de flash.
  const early = getSkin();
  if (early) document.documentElement.dataset.skin = early;

  document.addEventListener('DOMContentLoaded', applySkin);
  // La synchro serveur des clés durables peut rapporter le skin d'un autre PC.
  window.addEventListener('load', () => {
    if (typeof _userDataSyncPromise !== 'undefined' && _userDataSyncPromise && _userDataSyncPromise.then) {
      _userDataSyncPromise.then(applySkin, () => {});
    }
  });
})();
