// ═══════════════════════════════════════════════════════════════════════
// SKIN Gentle Mates · M8 (habillage réservé aux comptes choisis par l'admin)
// ═══════════════════════════════════════════════════════════════════════
// Droit : Admin > Utilisateurs > colonne « Skin M8 » (relais support, drapeau
// skinM8Access, relu par /api/status). Un compte autorisé voit un interrupteur
// sur sa page Synthèse ; l'admin y a toujours accès. Sans droit, le skin ne
// s'applique jamais, même si la clé locale existe encore (droit retiré).
//
// Priorité : skin activé > thème de saison (themes.js l'écarte, voir
// currentSeasonId) — le skin libère aussi le choix clair/sombre, que Halloween
// ou Noël verrouillent. Seul l'aperçu admin d'une saison reste prioritaire.
//
// Clés : `allure_skin` = 'm8' si l'interrupteur est activé (durable, suit le
// compte d'un PC à l'autre) ; `allure_skin_access` = dernier droit connu
// (purement local, évite un flash au démarrage avant la réponse du serveur).
// Chargé dans <head> pour appliquer l'attribut avant le premier rendu.
(function () {
  const LS_KEY = 'allure_skin';
  const LS_ACCESS = 'allure_skin_access';
  const SKIN = { id: 'm8', label: 'Gentle Mates · M8', badge: 'M8' };

  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  let _access = read(LS_ACCESS) === '1';

  // Skin effectivement appliqué : activé par l'utilisateur ET autorisé.
  function skinActive() { return _access && read(LS_KEY) === SKIN.id; }
  window.isSkinActive = skinActive;

  function applySkin() {
    const root = document.documentElement;
    const on = skinActive();
    if (on) root.dataset.skin = SKIN.id; else delete root.dataset.skin;
    document.getElementById('skin-badge')?.remove();
    document.getElementById('skin-band')?.remove();
    document.getElementById('skin-hero')?.remove();
    if (on && document.body) {
      // Bandeau de bas de page (rayures de maillot + signature répétée).
      const band = document.createElement('div');
      band.id = 'skin-band';
      band.className = 'skin-band';
      band.setAttribute('aria-hidden', '1');
      band.innerHTML = Array(14).fill('<span>Gentle Mates ✦ M8 ✦ Paris</span>').join('');
      document.body.appendChild(band);
      // Bandeau « affiche » de la Synthèse : écusson, logo graffiti, manette.
      const toggle = document.getElementById('skin-toggle');
      if (toggle) {
        const hero = document.createElement('div');
        hero.id = 'skin-hero';
        hero.className = 'skin-hero';
        hero.setAttribute('aria-hidden', '1');
        hero.innerHTML = '<img class="skin-hero-crest" src="images/skin-m8/crest.png" alt="">' +
          '<img class="skin-hero-word" src="images/skin-m8/wordmark.png" alt="">' +
          '<div class="skin-hero-text"><b>Gentle Mates</b>M8 ✦ Paris</div>' +
          '<img class="skin-hero-pad" src="images/skin-m8/pad.png" alt="">';
        toggle.insertAdjacentElement('afterend', hero);
      }
      const user = document.querySelector('.sidebar-brand .brand-user');
      if (user && user.parentElement) {
        const b = document.createElement('div');
        b.id = 'skin-badge';
        b.className = 'skin-badge';
        b.textContent = SKIN.badge;
        b.title = SKIN.label;
        user.parentElement.appendChild(b);
      }
    }
    // La saison reprend la main quand le skin s'éteint (et s'efface quand il s'allume).
    if (typeof applySeason === 'function') applySeason();
    else if (typeof applyTheme === 'function') applyTheme(read('allure_theme') || 'light');
    renderSkinToggle();
  }

  function renderSkinToggle() {
    const box = document.getElementById('skin-toggle');
    if (!box) return;
    box.hidden = !_access;
    const cb = box.querySelector('input');
    if (cb) cb.checked = read(LS_KEY) === SKIN.id;
  }

  // Appelé avec la réponse de /api/status (app.js).
  window.setSkinAccess = function (granted) {
    _access = !!granted;
    try { localStorage.setItem(LS_ACCESS, _access ? '1' : '0'); } catch (e) { /* silencieux */ }
    applySkin();
  };

  // Interrupteur de la page Synthèse.
  window.toggleSkin = function (on) {
    try {
      if (on) localStorage.setItem(LS_KEY, SKIN.id);
      else localStorage.removeItem(LS_KEY);
    } catch (e) { /* silencieux */ }
    applySkin();
  };

  // Attribut posé tout de suite (avant le premier rendu) : pas de flash.
  if (skinActive()) document.documentElement.dataset.skin = SKIN.id;

  document.addEventListener('DOMContentLoaded', applySkin);
  // La synchro serveur des clés durables peut rapporter le choix d'un autre PC.
  window.addEventListener('load', () => {
    if (typeof _userDataSyncPromise !== 'undefined' && _userDataSyncPromise && _userDataSyncPromise.then) {
      _userDataSyncPromise.then(applySkin, () => {});
    }
  });
})();
