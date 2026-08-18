// routes.js — page "Itinéraires" : génération de parcours (BRouter côté serveur)
// Saisie du départ en cascade (code postal -> ville -> rue, API officielles
// françaises) : la sélection explicite à chaque étape vaut confirmation,
// pas besoin de modale bloquante. Résultats compacts, repliables par défaut.

function routesDefaultState() {
  return {
    postcode: '',
    communes: [],
    selectedCommune: null,   // { nom, code, lat, lon }
    street: '',
    selectedStreet: null,    // { label, lat, lon }
    mode: 'distance',        // 'distance' | 'duration'
    distanceKm: 10,
    durationMin: 60,
    terrain: 'trail',        // 'trail' | 'route'
    routeShape: 'loop',      // 'loop' | 'outback' | 'both'
    ascentM: 300,
    searchWider: false,
    searchRadiusKm: 5,
    lastResult: null,
    openIndex: null,         // index de la carte résultat ouverte (une seule à la fois)
  };
}

const routesState = routesDefaultState();

// Le formulaire gardait la saisie precedente (adresse, distance, D+...)
// jusqu'a un refresh complet de la page - aucun moyen de repartir a zero
// sans ca. Reinitialise tout l'etat aux valeurs par defaut et re-affiche
// un formulaire vierge.
function routesResetForm() {
  Object.assign(routesState, routesDefaultState());
  showRoutesView('form');
  renderRoutesForm();
  showToast('Formulaire réinitialisé', 'info');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

function initRoutesPage() {
  showRoutesView('form');
  renderRoutesForm();
}

// Appelé depuis une carte de séance (Entraînements) pour pré-remplir les
// critères (durée, D+, terrain) avant de basculer sur la page Itinéraires -
// l'utilisateur n'a plus qu'à compléter le point de départ.
function goToRoutesWithPrefill(prefill = {}) {
  if (prefill.durationMin) {
    routesState.mode = 'duration';
    routesState.durationMin = Math.round(prefill.durationMin);
  }
  if (prefill.ascentM) {
    routesState.ascentM = Math.round(prefill.ascentM);
  }
  if (prefill.terrain) {
    routesState.terrain = prefill.terrain;
  }
  navigateTo('routes');
  showToast('Critères de la séance pré-remplis — complétez le point de départ', 'info');
}

function showRoutesView(view) {
  el('routes-form').style.display = view === 'form' ? '' : 'none';
  el('routes-results').style.display = view === 'results' ? '' : 'none';
}

function routesHasAscentField() { return routesState.terrain === 'trail'; }

// Champs numeriques du formulaire Itineraires : type="text" + inputmode="numeric"
// plutot que type="number" (retour utilisateur 18/08 - saisie fiable via les
// fleches natives mais chiffres perdus/tronques en tapant au clavier, ex :
// "12" tape dans le D+ ou le rayon donnait un resultat errone au lieu de 12).
// Filtre les caracteres non numeriques a chaque frappe plutot que de laisser
// le navigateur (re)interpreter/coercer la valeur d'un <input type=number>.
function wireNumericInput(id, onChange) {
  const input = el(id);
  input.oninput = e => {
    const clean = e.target.value.replace(/[^\d]/g, '');
    if (clean !== e.target.value) e.target.value = clean;
    onChange(clean);
  };
}

function renderRoutesForm() {
  const content = el('routes-form-content');
  content.innerHTML = `
    <div class="routes-field--full routes-reset-row">
      <button type="button" class="routes-reset-corner-btn" onclick="routesResetForm()">↺ Réinitialiser</button>
    </div>

    <div class="routes-field routes-field--full">
      <div class="routes-field-label">Point de départ</div>
      <div class="routes-address-row">
        <div>
          <div class="routes-microlabel">Code postal</div>
          <input type="text" id="routes-input-postcode" class="routes-text-input" inputmode="text" maxlength="5" placeholder="ex: 75015 ou 33" title="Code postal complet, ou 2 chiffres du département si vous ne le connaissez pas" value="${routesState.postcode}">
        </div>
        <div>
          <div class="routes-microlabel">Ville</div>
          <select id="routes-input-city" class="routes-select" ${routesState.communes.length ? '' : 'disabled'}></select>
        </div>
      </div>
      <div class="routes-address-street">
        <div class="routes-microlabel">Rue (optionnel — vide = mairie)</div>
        <input type="text" id="routes-input-street" class="routes-text-input" value="${routesState.street}" ${routesState.selectedCommune ? '' : 'disabled'}>
        <div id="routes-street-suggestions" class="routes-suggestions" style="display:none"></div>
      </div>
      <div id="routes-start-confirm" class="routes-start-confirm" style="display:none"></div>
    </div>

    <div class="routes-field">
      <div class="routes-field-label">Distance ou durée visée</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'distance' ? 'active' : ''}" data-mode="distance">Distance</button>
        <button type="button" class="routes-toggle-btn ${routesState.mode === 'duration' ? 'active' : ''}" data-mode="duration">Durée</button>
      </div>
      <div id="routes-mode-input" class="routes-number-row" style="margin-top:8px"></div>
    </div>

    <div class="routes-field">
      <div class="routes-field-label">Terrain</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'trail' ? 'active' : ''}" data-terrain="trail">Trail (chemins, sentiers, sous-bois)</button>
        <button type="button" class="routes-toggle-btn ${routesState.terrain === 'route' ? 'active' : ''}" data-terrain="route">Route (asphalte, chemin)</button>
      </div>
      ${routesState.terrain === 'route' ? `<div class="routes-hint">⚠️ Le tracé évite autant que possible les grands axes, mais peut encore emprunter une portion de route sans trottoir ni accotement séparé — vérifiez la sécurité du parcours avant de partir.</div>` : ''}
    </div>

    <div class="routes-field">
      <div class="routes-field-label">Forme du parcours</div>
      <div class="routes-toggle">
        <button type="button" class="routes-toggle-btn ${routesState.routeShape === 'loop' ? 'active' : ''}" data-shape="loop">Boucle</button>
        <button type="button" class="routes-toggle-btn ${routesState.routeShape === 'outback' ? 'active' : ''}" data-shape="outback">Aller-retour</button>
        <button type="button" class="routes-toggle-btn ${routesState.routeShape === 'both' ? 'active' : ''}" data-shape="both">Les deux</button>
      </div>
      <div class="routes-hint">${routesState.routeShape === 'outback'
        ? "L'aller-retour reprend exactement le même tracé au retour — reste jouable même sur un sentier sans boucle naturelle (impasse, cul-de-sac)."
        : routesState.routeShape === 'both'
          ? 'Les deux formes sont testées, les meilleures options (boucle ou aller-retour) sont proposées ensemble.'
          : "La boucle explore un chemin différent à l'aller et au retour."}</div>
    </div>

    <div class="routes-field" id="routes-ascent-field" style="display:${routesHasAscentField() ? '' : 'none'}">
      <div class="routes-field-label">D+ visé</div>
      <div class="routes-number-row">
        <input type="text" inputmode="numeric" id="routes-input-ascent" class="routes-number-input" value="${routesState.ascentM}"> m
      </div>
    </div>

    <div class="routes-field routes-field--full">
      <div class="routes-field-label">Recherche élargie</div>
      <div class="routes-hint">${routesHasAscentField()
        ? "Si le secteur ne permet pas d'atteindre le D+ (ou la distance/durée) visés sans trop s'écarter, la meilleure option trouvée sera proposée avec un message clair."
        : "Si le secteur ne permet pas d'atteindre la distance/durée visée sans trop s'écarter (impasse, réseau clairsemé…), la meilleure option trouvée sera proposée avec un message clair."}</div>
      <label class="routes-checkbox-row">
        <input type="checkbox" id="routes-input-search-wider" ${routesState.searchWider ? 'checked' : ''}>
        Chercher dans un rayon de
        <input type="text" inputmode="numeric" id="routes-input-search-radius" class="routes-number-input routes-number-input--xs" value="${routesState.searchRadiusKm}" ${routesState.searchWider ? '' : 'disabled'}> km
        si rien n'est disponible à l'adresse demandée
      </label>
    </div>
  `;

  wireRoutesAddressFields();

  content.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = () => { routesState.mode = btn.dataset.mode; renderRoutesForm(); };
  });
  content.querySelectorAll('[data-terrain]').forEach(btn => {
    btn.onclick = () => { routesState.terrain = btn.dataset.terrain; renderRoutesForm(); };
  });
  content.querySelectorAll('[data-shape]').forEach(btn => {
    btn.onclick = () => { routesState.routeShape = btn.dataset.shape; renderRoutesForm(); };
  });

  const modeInput = el('routes-mode-input');
  if (routesState.mode === 'distance') {
    modeInput.innerHTML = `<input type="text" inputmode="numeric" id="routes-input-distance" class="routes-number-input" value="${routesState.distanceKm}"> km`;
    wireNumericInput('routes-input-distance', v => { routesState.distanceKm = parseFloat(v) || 0; });
  } else {
    modeInput.innerHTML = `<input type="text" inputmode="numeric" id="routes-input-duration" class="routes-number-input" value="${routesState.durationMin}"> minutes`;
    wireNumericInput('routes-input-duration', v => { routesState.durationMin = parseInt(v, 10) || 0; });
  }

  if (routesHasAscentField()) {
    wireNumericInput('routes-input-ascent', v => { routesState.ascentM = parseInt(v, 10) || 0; });
  }
  // Recherche élargie : utile quel que soit le terrain (repli sur le D+ en
  // trail, sur la distance/durée en route) - plus conditionnée par
  // routesHasAscentField().
  el('routes-input-search-wider').onchange = e => { routesState.searchWider = e.target.checked; renderRoutesForm(); };
  wireNumericInput('routes-input-search-radius', v => { routesState.searchRadiusKm = parseFloat(v) || 0; });

  updateStartConfirmLine();
}

function wireRoutesAddressFields() {
  const postcodeInput = el('routes-input-postcode');
  const cityInput = el('routes-input-city');
  const streetInput = el('routes-input-street');

  // Reconstruit uniquement la liste "Ville" (+ etat du champ "Rue") a partir
  // de routesState - ne touche JAMAIS a postcodeInput lui-meme. Auparavant,
  // le handler ci-dessous appelait renderRoutesForm() (regenere TOUT le
  // formulaire via innerHTML, y compris ce champ) des qu'une pause de frappe
  // >=400ms survenait, meme sur une saisie encore incomplete - le navigateur
  // recree alors un tout nouveau noeud <input>, perdant le focus/curseur en
  // plein milieu de la frappe (retour utilisateur 14/08 : "on perd la main
  // sur cette case, parfois impossible de taper"). Comme n'importe quel code
  // postal complet passe forcement par son prefixe departement a 2 chiffres
  // en cours de frappe (ex: "75" avant "75015"), ce cas se declenchait quasi
  // systematiquement.
  function syncCityAndStreetFields() {
    const placeholder = routesState.selectedCommune ? '' : '<option value="" selected disabled>— Choisir —</option>';
    cityInput.innerHTML = placeholder + routesState.communes.map(c =>
      `<option value="${c.code}" ${routesState.selectedCommune && routesState.selectedCommune.code === c.code ? 'selected' : ''}>${c.nom}</option>`
    ).join('');
    cityInput.disabled = routesState.communes.length === 0;
    streetInput.value = routesState.street;
    streetInput.disabled = !routesState.selectedCommune;
    el('routes-street-suggestions').style.display = 'none';
    updateStartConfirmLine();
  }

  // Accepte soit un code postal complet (5 chiffres), soit un code
  // departement seul (2 chiffres, 2A/2B, ou 971-976 outre-mer) quand le code
  // postal complet n'est pas connu — le debounce evite de declencher une
  // recherche departement inutile pendant qu'on tape encore vers un code
  // postal complet (ex: pause sur "75" avant de continuer vers "75015").
  const DEPARTMENT_CODE_RE = /^(\d{2}|2[ab]|97[1-6])$/i;
  // Jeton anti-desordre : un code postal (5 chiffres) et son prefixe
  // departement (2 chiffres) declenchent chacun leur propre requete
  // (debounce independant a chaque frappe, mais toutes deux passent par ce
  // meme handler) - sans garde, la reponse la plus LENTE a arriver ecrasait
  // routesState.communes meme si elle correspond a une saisie deja perimee
  // (ex: "75" -> tous les codes postaux de Paris, resout apres "75015" ->
  // juste Paris ville : la ville n'apparaissait alors plus dans la liste,
  // ou une liste incoherente avec ce qui est tape). Seule la reponse a la
  // DERNIERE requete emise est appliquee, les autres sont ignorees.
  let communesRequestToken = 0;
  postcodeInput.oninput = debounce(async (e) => {
    routesState.postcode = e.target.value.trim();
    routesState.communes = [];
    routesState.selectedCommune = null;
    routesState.selectedStreet = null;
    routesState.street = '';
    const value = routesState.postcode;
    const isPostcode = /^\d{5}$/.test(value);
    const isDepartment = !isPostcode && DEPARTMENT_CODE_RE.test(value);
    const myToken = ++communesRequestToken;
    if (!isPostcode && !isDepartment) { syncCityAndStreetFields(); return; }
    try {
      const param = isPostcode ? `postcode=${value}` : `department=${value}`;
      const res = await fetch(`${API}/api/routes/communes?${param}`);
      const data = await res.json();
      if (myToken !== communesRequestToken) return; // une saisie plus recente a deja pris le relais
      if (!res.ok) throw new Error(data.error || 'Code introuvable');
      if (!data.communes || data.communes.length === 0) {
        showToast(isPostcode ? 'Aucune ville trouvée pour ce code postal' : 'Aucune ville trouvée pour ce département', 'error');
        return;
      }
      routesState.communes = data.communes;
      routesState.selectedCommune = data.communes.length === 1 ? data.communes[0] : null;
      syncCityAndStreetFields();
    } catch (err) {
      if (myToken === communesRequestToken) showToast('Erreur : ' + err.message, 'error');
    }
  }, 400);

  syncCityAndStreetFields();
  cityInput.onchange = () => {
    routesState.selectedCommune = routesState.communes.find(c => c.code === cityInput.value) || null;
    routesState.selectedStreet = null;
    routesState.street = '';
    syncCityAndStreetFields();
  };

  streetInput.oninput = debounce(async (e) => {
    routesState.street = e.target.value;
    routesState.selectedStreet = null;
    updateStartConfirmLine();
    const box = el('routes-street-suggestions');
    if (!routesState.selectedCommune || routesState.street.trim().length < 2) {
      box.style.display = 'none';
      return;
    }
    try {
      const res = await fetch(`${API}/api/routes/street-suggestions?q=${encodeURIComponent(routesState.street)}&citycode=${routesState.selectedCommune.code}`);
      const data = await res.json();
      if (!data.suggestions || data.suggestions.length === 0) { box.style.display = 'none'; return; }
      box.innerHTML = data.suggestions.map((s, i) => `<div class="routes-suggestion-item" data-idx="${i}">${s.label}</div>`).join('');
      box.style.display = '';
      box.querySelectorAll('.routes-suggestion-item').forEach(item => {
        item.onclick = () => {
          const s = data.suggestions[parseInt(item.dataset.idx, 10)];
          routesState.selectedStreet = s;
          routesState.street = s.label;
          streetInput.value = s.label;
          box.style.display = 'none';
          updateStartConfirmLine();
        };
      });
    } catch (err) { box.style.display = 'none'; }
  }, 300);
}

function updateStartConfirmLine() {
  const line = el('routes-start-confirm');
  if (!routesState.selectedCommune) { line.style.display = 'none'; return; }
  const label = routesState.selectedStreet
    ? routesState.selectedStreet.label
    : `Mairie de ${routesState.selectedCommune.nom} (par défaut)`;
  line.style.display = '';
  line.innerHTML = `📍 Départ : ${label}`;
}

async function routesResolveStart() {
  if (!routesState.selectedCommune) {
    showToast('Renseignez un code postal et choisissez une ville', 'error');
    return null;
  }
  if (routesState.street.trim().length === 0) {
    const res = await fetch(`${API}/api/routes/town-hall?citycode=${routesState.selectedCommune.code}`);
    const data = await res.json();
    if (res.ok) return data.townHall;
    // La recherche de mairie repose sur une adresse "Place/Rue de la Mairie"
    // dans la Base Adresse Nationale — fiable dans les petites communes,
    // souvent absente dans les villes moyennes/grandes (autre nommage de
    // voirie autour de l'hôtel de ville). Plutôt que de bloquer la
    // génération, on repart du centre de la commune déjà connu (issu de
    // /api/routes/communes), toujours disponible.
    const c = routesState.selectedCommune;
    showToast(`Mairie non localisée précisément pour ${c.nom} — départ pris au centre de la commune`, 'info');
    return { label: `Centre de ${c.nom}`, lat: c.lat, lon: c.lon };
  }
  if (!routesState.selectedStreet) {
    showToast('Sélectionnez une rue dans la liste, ou videz le champ pour partir de la mairie', 'error');
    return null;
  }
  return routesState.selectedStreet;
}

function routesRestart() {
  routesState.lastResult = null;
  routesState.openIndex = null;
  showRoutesView('form');
  renderRoutesForm();
}

// Verifie que la tuile OSM couvrant ce depart est presente localement ;
// sinon propose le telechargement (taille reelle affichee) avant de
// poursuivre. Retourne false si l'utilisateur refuse ou si ca echoue.
async function routesEnsureTileAvailable(start, btn) {
  const res = await fetch(`${API}/api/routes/tile-check?lat=${start.lat}&lon=${start.lon}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Vérification des données cartographiques impossible');
  if (data.present) return true;

  const sizeLabel = data.sizeBytes ? `${Math.round(data.sizeBytes / 1024 / 1024)} Mo` : 'taille inconnue';
  const ok = await showConfirmModal({
    title: 'Données cartographiques manquantes',
    message: `Cette zone (tuile ${data.tileName}) n'est pas encore téléchargée sur cette machine (~${sizeLabel}). Télécharger maintenant ? Cela peut prendre plusieurs minutes.`,
    confirmLabel: 'Télécharger',
    cancelLabel: 'Annuler',
    icon: '🗺️',
  });
  if (!ok) return false;

  btn.textContent = 'Téléchargement des données (peut prendre plusieurs minutes)…';
  const dlRes = await fetch(`${API}/api/routes/tile-download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: start.lat, lon: start.lon }),
  });
  const dlData = await dlRes.json();
  if (!dlRes.ok) throw new Error(dlData.error || 'Téléchargement des données cartographiques échoué');
  showToast('Données cartographiques téléchargées', 'success');
  return true;
}

// Messages "fun" pour faire patienter (rotation independante des etapes
// techniques ci-dessous) - demande utilisateur explicite, la generation
// peut depasser 1-2 min avec recherche elargie et personne n'aime fixer une
// barre muette aussi longtemps.
const ROUTES_FUN_MESSAGES = [
  "Ne t'inquiète pas, ça sera moins long que ta prochaine sortie 🏃",
  'On explore les sentiers du coin comme si on y était déjà',
  "Chaque bonne côte se mérite, même pour l'algorithme",
  "On évite les impasses pour toi, ça prend un peu de temps",
  'Les meilleurs single-tracks ne se trouvent pas en un clic',
  "On compare les options comme le ferait un vrai coach",
  'Petit échauffement pendant que ça calcule',
  'On négocie avec les cartes pour te trouver le meilleur tracé',
  'Patience, comme dans les 500 derniers mètres d\'une course',
  "On vérifie qu'il n'y a pas de sanglier sur le parcours (enfin, on essaie)",
  'Ça mouline, mais dans le bon sens — comme tes jambes en montée',
  'On teste plusieurs directions pour ne rien te faire rater',
  'Presque prêt, encore un petit effort',
  'On chausse nos baskets virtuelles pour explorer le secteur',
  "Le meilleur tracé arrive, plus vite qu'un négatif split",
];

// Pas de canal de progression reel serveur->client (un seul aller-retour
// HTTP, la generation peut prendre 20-40s avec recherche elargie +
// alternatives, jusqu'a 1-2 min sur les scenarios les plus exigeants) - une
// vraie barre 0-100% est donc simulee (converge vers 90% sans jamais
// l'atteindre pile, avance de plus en plus lente - snap a 100% seulement
// quand la reponse arrive reellement, cf routesStopProgress) plutot qu'une
// barre indeterminee statique. Les messages d'etape technique (existant)
// tournent independamment des messages "fun" ci-dessus.
let _routesProgressStepTimer = null;
let _routesProgressFunTimer = null;
let _routesProgressBarTimer = null;
let _routesProgressPct = 0;
function routesStartProgress() {
  const steps = ['Recherche de directions autour du départ…', 'Analyse du relief du secteur…', 'Construction du tracé…', 'Recherche de tracés alternatifs…'];
  if (routesHasAscentField() && routesState.ascentM) {
    steps.push('Vérification du dénivelé…');
    if (routesState.searchWider) steps.push('Recherche élargie de points de départ plus vallonnés…');
    steps.push('Recherche de côtes à répéter pour compléter le D+…');
  } else if (routesState.searchWider) {
    steps.push('Vérification de la distance/durée…');
    steps.push('Recherche élargie de points de départ mieux connectés…');
  }
  steps.push('Finalisation du tracé…');
  const label = el('routes-progress-label');
  let i = 0;
  label.textContent = steps[0];
  _routesProgressStepTimer = setInterval(() => {
    i = Math.min(i + 1, steps.length - 1);
    label.textContent = steps[i];
  }, 3500);

  const funLabel = el('routes-progress-fun-msg');
  let funIdx = Math.floor(Math.random() * ROUTES_FUN_MESSAGES.length);
  funLabel.textContent = ROUTES_FUN_MESSAGES[funIdx];
  _routesProgressFunTimer = setInterval(() => {
    funIdx = (funIdx + 1) % ROUTES_FUN_MESSAGES.length;
    funLabel.textContent = ROUTES_FUN_MESSAGES[funIdx];
  }, 4200);

  _routesProgressPct = 0;
  const fill = el('routes-progress-bar-fill');
  const pctLabel = el('routes-progress-percent');
  fill.style.transform = 'scaleX(0)';
  pctLabel.textContent = '0 %';
  _routesProgressBarTimer = setInterval(() => {
    _routesProgressPct += (90 - _routesProgressPct) * 0.04;
    fill.style.transform = `scaleX(${(_routesProgressPct / 100).toFixed(3)})`;
    pctLabel.textContent = Math.round(_routesProgressPct) + ' %';
  }, 300);

  el('routes-progress-modal').style.display = 'flex';
}
function routesStopProgress() {
  if (_routesProgressStepTimer) { clearInterval(_routesProgressStepTimer); _routesProgressStepTimer = null; }
  if (_routesProgressFunTimer) { clearInterval(_routesProgressFunTimer); _routesProgressFunTimer = null; }
  if (_routesProgressBarTimer) { clearInterval(_routesProgressBarTimer); _routesProgressBarTimer = null; }
  // Termine proprement a 100% (transition CSS) avant de refermer, plutot
  // qu'une disparition brusque en plein milieu d'un pourcentage.
  const fill = el('routes-progress-bar-fill');
  const pctLabel = el('routes-progress-percent');
  if (fill) fill.style.transform = 'scaleX(1)';
  if (pctLabel) pctLabel.textContent = '100 %';
  setTimeout(() => { const m = el('routes-progress-modal'); if (m) m.style.display = 'none'; }, 350);
}

// Recalcule le profil d'allure perso (par pente) a partir des dernieres
// sorties Garmin — operation lente (telechargement + parsing FIT), d'ou le
// bouton explicite plutot qu'un declenchement automatique. Relance ensuite
// la derniere recherche pour que les durees affichees refletent le nouveau
// profil sans action supplementaire de l'utilisateur.
async function recalcPaceProfile() {
  const btn = el('routes-recalc-pace-profile');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Analyse de vos sorties…';
  try {
    await fetch(`${API}/api/routes/pace-profile/refresh`, { method: 'POST' })
      .then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Erreur'); });
    showToast('✅ Profil d\'allure recalculé', 'success');
    if (routesState.lastResult) await routesGenerateClicked();
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Recalculer maintenant';
  }
}

async function routesGenerateClicked() {
  const btn = el('routes-generate-btn');
  btn.disabled = true;
  btn.textContent = 'Génération…';
  try {
    const start = await routesResolveStart();
    if (!start) return;

    const tileReady = await routesEnsureTileAvailable(start, btn);
    if (!tileReady) return;
    btn.textContent = 'Génération…';
    routesStartProgress();

    const body = {
      start: { lat: start.lat, lon: start.lon },
      targetAscentM: routesHasAscentField() ? routesState.ascentM : null,
      terrain: routesState.terrain,
      routeShape: routesState.routeShape,
    };
    if (routesState.mode === 'distance') body.targetDistanceM = routesState.distanceKm * 1000;
    else body.targetDurationMin = routesState.durationMin;
    if (routesState.searchWider && routesState.searchRadiusKm > 0) {
      body.searchRadiusKm = routesState.searchRadiusKm;
    }

    const res = await fetch(`${API}/api/routes/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Génération impossible');

    routesState.lastResult = data;
    routesState.openIndex = null;
    renderRoutesResults(data);
    showRoutesView('results');
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  } finally {
    routesStopProgress();
    btn.disabled = false;
    btn.textContent = 'Générer →';
  }
}

function toggleRouteCard(idx) {
  routesState.openIndex = routesState.openIndex === idx ? null : idx;
  renderRoutesResults(routesState.lastResult);
}

const ROUTES_OPTION_COUNT_WORDS = ['', 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq'];
function routesResultsTitle(count) {
  if (count <= 1) return 'Itinéraire proposé';
  const word = ROUTES_OPTION_COUNT_WORDS[count] || count;
  return `${word} options trouvées`;
}

function renderRoutesResults(data) {
  const header = el('routes-results-header');
  header.innerHTML = `
    <div class="routes-results-title">${routesResultsTitle(data.options.length)}</div>
    ${data.warning ? `<div class="routes-warning-banner">${data.warning}</div>` : ''}
    ${data.paceProfileIsGeneric ? `
    <div class="routes-warning-banner routes-warning-banner--info">
      Durées estimées avec une allure générique — recalculez votre profil d'allure personnel à partir de vos dernières sorties Garmin pour des estimations plus fiables.
      <button class="btn-text-link routes-pace-profile-btn" id="routes-recalc-pace-profile" type="button">Recalculer maintenant</button>
    </div>` : ''}
    ${routesState.terrain === 'route' ? `
    <div class="routes-warning-banner routes-warning-banner--info">
      ⚠️ Le tracé évite autant que possible les grands axes, mais peut encore emprunter une portion de route sans trottoir ni accotement séparé — vérifiez la sécurité du parcours avant de partir.
    </div>` : ''}
  `;
  const recalcBtn = el('routes-recalc-pace-profile');
  if (recalcBtn) recalcBtn.onclick = recalcPaceProfile;

  const list = el('routes-results-list');
  list.innerHTML = '';
  data.options.forEach((opt, idx) => {
    const open = routesState.openIndex === idx;
    const durH = Math.floor(opt.predictedDurationMin / 60);
    const durM = Math.round(opt.predictedDurationMin % 60);
    const hasRepeatZone = routesHasRepeatZone(opt);
    // Distance entre le point litteralement demande et le vrai point de
    // depart du trace (BRouter accroche toujours au reseau routable le plus
    // proche, meme sans recherche de depart alternatif) - affichee
    // systematiquement, pas seulement dans le cas d'un depart tres decale
    // (cf opt.alternateStart, deja couvert par son propre message).
    const startOffsetKm = (data.requestedStart && opt.points && opt.points[0])
      ? haversineKm(data.requestedStart, opt.points[0]) : null;

    const card = document.createElement('div');
    card.className = 'routes-result-card';
    card.innerHTML = `
      <div class="routes-result-header" data-idx="${idx}">
        <span class="routes-result-chevron${open ? ' routes-result-chevron--open' : ''}">&#x25BC;</span>
        <span class="routes-result-label">${opt.label}</span>
        <div class="routes-mini-stats">
          <div class="routes-mini-stat"><b>${(opt.distanceM / 1000).toFixed(1)}</b> km</div>
          <div class="routes-mini-stat"><b>${opt.ascentM}</b> m D+</div>
          <div class="routes-mini-stat"><b>${durH}h${String(durM).padStart(2, '0')}</b></div>
          ${startOffsetKm !== null ? `<div class="routes-mini-stat" title="Distance entre le point demandé et le départ réel du parcours"><b>${formatStartOffset(startOffsetKm)}</b> du départ</div>` : ''}
        </div>
      </div>
      <div class="routes-result-body" style="display:${open ? '' : 'none'}">
        <div class="routes-commentary">${opt.commentary || ''}</div>
        <div class="routes-elev-container"><canvas id="routes-elev-${idx}"></canvas></div>
        <div class="routes-result-map" id="routes-map-${idx}"></div>
        ${hasRepeatZone ? '<div class="routes-hint routes-map-legend"><span class="routes-legend-swatch routes-legend-swatch--repeat"></span> Portion(s) répétée(s) (aller-retour) &nbsp; <span class="routes-legend-swatch routes-legend-swatch--normal"></span> Reste du parcours</div>' : ''}
        <button class="btn-plans-restart routes-download-btn" id="routes-download-${idx}">⬇ Télécharger le GPX</button>
      </div>
    `;
    list.appendChild(card);
    card.querySelector('.routes-result-header').onclick = () => toggleRouteCard(idx);
    if (open) {
      card.querySelector(`#routes-download-${idx}`).onclick = () => downloadRouteGpx(opt);
    }
  });

  if (routesState.openIndex !== null) {
    const opt = data.options[routesState.openIndex];
    setTimeout(() => {
      // La carte et le profil sont deux rendus independants : une erreur
      // dans l'un (ex. Leaflet) ne doit jamais empecher l'autre de s'afficher
      // (bug reel constate : une exception dans renderRouteMap coupait aussi
      // le profil d'altitude, enchaîné juste apres dans le meme callback).
      let mapCtrl = null;
      try {
        mapCtrl = renderRouteMap(`routes-map-${routesState.openIndex}`, opt, { requestedStart: data.requestedStart, searchRadiusM: data.searchRadiusM });
      } catch (err) {
        console.error('[routes] Erreur rendu carte:', err);
      }
      renderElevationChart(`routes-elev-${routesState.openIndex}`, opt.points, (index) => {
        if (!mapCtrl) return;
        if (index === null || !mapCtrl.latLngs[index]) mapCtrl.hideCursor();
        else mapCtrl.showCursorAt(mapCtrl.latLngs[index]);
      });
    }, 0);
  }
}

function formatStartOffset(km) {
  if (km < 0.1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// opt.repeatedSegments[].{startIdx,endIdx} (calculés côté serveur, cf
// route_generator.js findRepeatedZoneIndexRange) désignent, pour chaque côte
// distincte sollicitée, la plage de points correspondant à sa zone
// d'aller-retour répétée - utilisé pour les colorer différemment sur la
// carte (une par une, jusqu'à 3) et afficher la légende dédiée. Un parcours
// peut solliciter plusieurs côtes différentes plutôt qu'une seule répétée
// en boucle (cf commentaire de MAX_REPEAT_SEGMENTS côté serveur).
function routesRepeatZones(opt) {
  return (opt.repeatedSegments || []).filter(seg => Number.isInteger(seg.startIdx) && Number.isInteger(seg.endIdx) && seg.endIdx > seg.startIdx);
}
function routesHasRepeatZone(opt) {
  return routesRepeatZones(opt).length > 0;
}

// onHoverIndex(index|null) est rappelé à chaque déplacement de la souris sur
// le graphique (index du point survolé, ou null en sortie) - permet de
// synchroniser un curseur sur la carte (cf renderRouteMap/showCursorAt).
function renderElevationChart(canvasId, points, onHoverIndex) {
  const canvas = el(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !points || points.length === 0) return null;
  let cum = 0;
  const labels = [];
  const data = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cum += haversineKm(points[i - 1], points[i]);
    labels.push(cum.toFixed(1) + ' km');
    data.push(Math.round(points[i].ele));
  }
  const baseOptions = typeof chartOptions === 'function' ? chartOptions() : { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: '#16A34A', backgroundColor: 'rgba(22,163,74,0.12)', borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true }] },
    options: {
      ...baseOptions,
      onHover: (evt, activeElements) => {
        if (typeof onHoverIndex === 'function') onHoverIndex(activeElements.length ? activeElements[0].index : null);
      },
    },
  });
  if (typeof onHoverIndex === 'function') {
    canvas.addEventListener('mouseleave', () => onHoverIndex(null));
  }
  return chart;
}

// Renvoie un controleur { map, latLngs, showCursorAt, hideCursor } pour que
// l'appelant (renderElevationChart au survol) puisse deplacer un repere sur
// la carte en synchro avec le profil d'altitude, sans coupler les deux
// fonctions entre elles.
// context.requestedStart / context.searchRadiusM (optionnels, communs à
// toutes les options d'une même génération) : affichent le point réellement
// demandé et le rayon de recherche élargie, pour que l'écart entre ce point
// et le départ réel du tracé (déjà minimisé côté serveur, cf
// reorientLoopToClosestPoint) reste visible et compréhensible plutôt que
// silencieux.
function renderRouteMap(mapDivId, opt, context = {}) {
  const mapDiv = el(mapDivId);
  const points = opt && opt.points;
  if (!mapDiv || typeof L === 'undefined' || !points || points.length === 0) return null;
  const latLngs = points.map(p => [p.lat, p.lon]);
  const bounds = L.latLngBounds(latLngs);
  const map = L.map(mapDiv, { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://openstreetmap.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
  }).addTo(map);

  const repeatZones = routesRepeatZones(opt).slice().sort((a, b) => a.startIdx - b.startIdx);
  if (repeatZones.length > 0) {
    // Alterne vert (parcours normal) / orange (zone repetee), une paire par
    // côte sollicitée - genéralise le cas a une seule côte (comportement
    // inchangé) comme a plusieurs.
    let cursor = 0;
    repeatZones.forEach(zone => {
      const before = latLngs.slice(cursor, zone.startIdx + 1);
      if (before.length > 1) L.polyline(before, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
      L.polyline(latLngs.slice(zone.startIdx, zone.endIdx + 1), { color: '#e8590c', weight: 4 }).addTo(map);
      cursor = zone.endIdx;
    });
    const after = latLngs.slice(cursor);
    if (after.length > 1) L.polyline(after, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
  } else {
    L.polyline(latLngs, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
  }
  L.marker(latLngs[0]).addTo(map).bindTooltip('Départ du tracé');

  if (context.requestedStart) {
    const reqLatLng = [context.requestedStart.lat, context.requestedStart.lon];
    L.circleMarker(reqLatLng, { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 0.95 })
      .addTo(map).bindTooltip('Point demandé');
    bounds.extend(reqLatLng);
    if (context.searchRadiusM) {
      L.circle(reqLatLng, { radius: context.searchRadiusM, color: '#dc2626', weight: 1.5, dashArray: '6 6', fillOpacity: 0.04 }).addTo(map);
      // Etend bounds via une approximation degres/metres plutot que
      // circle.getBounds() : cette dernière projette via this._map (pixels
      // au zoom courant), qui n'existe pas encore avant le tout premier
      // fitBounds sur une carte fraichement créée - ça plantait ("Cannot
      // read properties of undefined (reading 'layerPointToLatLng')") et
      // interrompait tout le rendu de la carte (et du profil, enchaîné juste
      // après par l'appelant).
      const dLat = context.searchRadiusM / 111320;
      const dLon = context.searchRadiusM / (111320 * Math.cos(context.requestedStart.lat * Math.PI / 180));
      bounds.extend([context.requestedStart.lat + dLat, context.requestedStart.lon]);
      bounds.extend([context.requestedStart.lat - dLat, context.requestedStart.lon]);
      bounds.extend([context.requestedStart.lat, context.requestedStart.lon + dLon]);
      bounds.extend([context.requestedStart.lat, context.requestedStart.lon - dLon]);
    }
  }
  map.fitBounds(bounds, { padding: [12, 12] });

  let cursorMarker = null;
  return {
    map,
    latLngs,
    showCursorAt(latlng) {
      if (!cursorMarker) {
        cursorMarker = L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(map);
      } else {
        cursorMarker.setLatLng(latlng);
      }
    },
    hideCursor() {
      if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
    },
  };
}

async function downloadRouteGpx(option) {
  try {
    const res = await fetch(`${API}/api/routes/gpx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: option.points, label: option.label }),
    });
    if (!res.ok) throw new Error('Export GPX impossible');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (option.label || 'itineraire').replace(/[^a-zA-Z0-9-_]+/g, '_') + '.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast('Erreur : ' + err.message, 'error');
  }
}
