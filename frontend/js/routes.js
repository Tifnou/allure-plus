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
    routePaceMinPerKm: 6,    // allure visée (route + durée uniquement) - voir routesHasPaceField()
    terrain: 'trail',        // 'trail' | 'route'
    routeShape: 'loop',      // 'loop' | 'outback' | 'both'
    ascentM: 300,
    trailLevel: 'moyenplus', // niveau de traileur (trail uniquement) - voir ROUTES_TRAIL_LEVELS
    trailStyle: 'mixte',     // style de chemin en trail (roulant/mixte/technique) - voir ROUTES_TRAIL_STYLES
    searchWider: false,
    searchRadiusKm: 5,
    lastResult: null,
    openIndex: null,         // index de la carte résultat ouverte (une seule à la fois)
    pickingEndpoint: null,   // { idx, target: 'start'|'finish'|'loop' } - carte en attente d'un clic pour déplacer le départ/l'arrivée
  };
}

const routesState = routesDefaultState();

// Niveau de traileur -> vitesse A PLAT (km/h), appliquee a la distance
// equivalente plat (distance + D+/100, cf equivalentFlatKm) - table fournie
// par l'utilisateur (20/08, corrigee le 20/08 - une 1ere version donnait des
// vitesses bien trop lentes pour representer une allure a plat). MIROIR
// EXACT de TRAIL_LEVELS (route_generator.js, cote serveur) : garder les deux
// synchronises manuellement si les valeurs changent un jour (meme motif que
// ALLURE_PLUS_ZONES, cf CLAUDE.md) - utilisee ici uniquement pour l'apercu
// affiche AVANT de lancer la recherche (routesBuildLevelConfirmation), le
// calcul qui compte reellement est refait cote serveur avec la meme table.
const ROUTES_TRAIL_LEVELS = {
  elite:      { label: 'Élite / international', minKmh: 9.0,  maxKmh: 13.0 },
  excellent:  { label: 'Excellent traileur',     minKmh: 8.0,  maxKmh: 10.0 },
  tresbon:    { label: 'Très bon traileur',      minKmh: 7.0,  maxKmh: 9.0 },
  bon:        { label: 'Bon traileur',           minKmh: 6.0,  maxKmh: 8.0 },
  moyenplus:  { label: 'Moyen +',                minKmh: 5.5,  maxKmh: 7.0 },
  moyen:      { label: 'Moyen',                  minKmh: 4.5,  maxKmh: 6.0 },
  moyenmoins: { label: 'Moyen -',                minKmh: 3.5,  maxKmh: 5.0 },
  debutant:   { label: 'Débutant',               minKmh: 2.5,  maxKmh: 4.0 },
};

// Style de chemin en trail (retour utilisateur, aout 2026) : quel TYPE de
// voie BRouter privilegie DANS la direction choisie par la recherche - a ne
// pas confondre avec le niveau de traileur (vitesse) ci-dessus. MIROIR des
// libelles de TRAIL_STYLE_PARAMS (route_generator.js, cote serveur) ; la
// cle envoyee au serveur suffit, ce tableau ne sert qu'a l'affichage.
const ROUTES_TRAIL_STYLES = {
  roulant:   { label: 'Roulant',   hint: 'Privilégie les chemins/pistes larges déjà bien tracés — évite les détours vers un sentier étroit quand une alternative plus large existe à proximité.' },
  mixte:     { label: 'Mixte',     hint: 'Comportement équilibré (par défaut) — mélange de chemins larges et de sentiers selon ce que le terrain propose naturellement.' },
  technique: { label: 'Technique', hint: 'Recherche davantage les sentiers étroits et le hors-piste — quitte à emprunter un tracé plus sinueux qu\'un chemin large voisin.' },
};

function routesTrailLevelMidKmh(level) {
  const lvl = ROUTES_TRAIL_LEVELS[level];
  return lvl ? (lvl.minKmh + lvl.maxKmh) / 2 : null;
}

function routesFmtPaceFromKmh(kmh) {
  const secPerKm = 3600 / kmh;
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return `${m}'${String(s).padStart(2, '0')}"`;
}

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
// Allure cible explicite (route uniquement - le trail a deja des fourchettes
// d'allure par niveau de traileur, cf ROUTES_TRAIL_LEVELS) : necessaire
// uniquement en mode "duree", pour convertir la duree visee en distance
// reelle sans deviner l'allure de l'utilisateur (retour utilisateur, Thomas
// PAVARD - meme distance parcourue en 30 min a 5'40"/km ou 6'45"/km).
function routesHasPaceField() { return routesState.mode === 'duration' && routesState.terrain === 'route'; }

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
        <!-- Code postal/rue : Chrome propose ses adresses enregistrees
             (autofill "Adresses") meme avec autocomplete="off", des que le
             champ recoit le focus - "off" n'est plus respecte pour ce type
             de champ depuis quelques annees. readonly+onfocus (le champ
             devient editable seulement APRES avoir recu le focus) empeche
             Chrome de reconnaitre le champ comme cible d'autofill au moment
             ou il declenche habituellement la suggestion. -->
        <div>
          <div class="routes-microlabel">Code postal</div>
          <input type="text" id="routes-input-postcode" class="routes-text-input" inputmode="text" maxlength="5" placeholder="ex: 75015 ou 33" title="Code postal complet, ou 2 chiffres du département si vous ne le connaissez pas" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" value="${routesState.postcode}">
        </div>
        <div>
          <div class="routes-microlabel">Ville</div>
          <select id="routes-input-city" class="routes-select" ${routesState.communes.length ? '' : 'disabled'}></select>
        </div>
      </div>
      <div class="routes-address-street">
        <div class="routes-microlabel">Rue (optionnel — vide = mairie)</div>
        <input type="text" id="routes-input-street" class="routes-text-input" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')" value="${routesState.street}" ${routesState.selectedCommune ? '' : 'disabled'}>
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

    <div class="routes-field" id="routes-pace-field" style="display:${routesHasPaceField() ? '' : 'none'}">
      <div class="routes-field-label">Allure visée</div>
      <div class="routes-hint">Utilisée pour convertir la durée visée en distance réelle — vous ne parcourez pas la même distance en 30 min à 5'40"/km qu'à 6'45"/km.</div>
      <div class="routes-number-row" style="margin-top:6px" id="routes-pace-input"></div>
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

    <div class="routes-field routes-field--full" id="routes-level-field" style="display:${routesHasAscentField() ? '' : 'none'}">
      <div class="routes-field-label">Niveau de traileur</div>
      <div class="routes-hint">Utilisé pour estimer une durée réaliste sur un parcours avec du D+ — une allure unique se trompe largement dès que le terrain devient très pentu.</div>
      <select id="routes-input-level" class="routes-select" style="margin-top:6px;max-width:280px">
        ${Object.entries(ROUTES_TRAIL_LEVELS).map(([key, lvl]) =>
          `<option value="${key}" ${routesState.trailLevel === key ? 'selected' : ''}>${lvl.label} (${lvl.minKmh}–${lvl.maxKmh} km/h)</option>`
        ).join('')}
      </select>
      <button type="button" class="btn-text-link" id="routes-level-table-toggle" style="display:block;margin-top:8px">ⓘ Voir le tableau des niveaux</button>
      <div id="routes-level-table" style="display:none;margin-top:8px"></div>
    </div>

    <div class="routes-field routes-field--full" id="routes-style-field" style="display:${routesHasAscentField() ? '' : 'none'}">
      <div class="routes-field-label">Style de chemin</div>
      <div class="routes-hint">${(ROUTES_TRAIL_STYLES[routesState.trailStyle] || {}).hint || ''}</div>
      <div class="routes-toggle" style="margin-top:6px">
        ${Object.entries(ROUTES_TRAIL_STYLES).map(([key, s]) =>
          `<button type="button" class="routes-toggle-btn ${routesState.trailStyle === key ? 'active' : ''}" data-style="${key}">${s.label}</button>`
        ).join('')}
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
  content.querySelectorAll('[data-style]').forEach(btn => {
    btn.onclick = () => { routesState.trailStyle = btn.dataset.style; renderRoutesForm(); };
  });

  const modeInput = el('routes-mode-input');
  if (routesState.mode === 'distance') {
    modeInput.innerHTML = `<input type="text" inputmode="numeric" id="routes-input-distance" class="routes-number-input" value="${routesState.distanceKm}"> km`;
    wireNumericInput('routes-input-distance', v => { routesState.distanceKm = parseFloat(v) || 0; });
  } else {
    const h = Math.floor(routesState.durationMin / 60);
    const m = routesState.durationMin % 60;
    modeInput.innerHTML = `<input type="text" inputmode="numeric" id="routes-input-duration-h" class="routes-number-input routes-number-input--xs" value="${h}"> h <input type="text" inputmode="numeric" id="routes-input-duration-m" class="routes-number-input routes-number-input--xs" value="${String(m).padStart(2, '0')}"> min`;
    const updateDurationMin = () => {
      const hVal = parseInt(el('routes-input-duration-h').value, 10) || 0;
      const mVal = Math.min(59, parseInt(el('routes-input-duration-m').value, 10) || 0);
      routesState.durationMin = hVal * 60 + mVal;
    };
    wireNumericInput('routes-input-duration-h', updateDurationMin);
    wireNumericInput('routes-input-duration-m', updateDurationMin);
  }

  if (routesHasPaceField()) {
    const paceInput = el('routes-pace-input');
    const pMin = Math.floor(routesState.routePaceMinPerKm);
    const pSec = Math.round((routesState.routePaceMinPerKm - pMin) * 60);
    paceInput.innerHTML = `<input type="text" inputmode="numeric" id="routes-input-pace-min" class="routes-number-input routes-number-input--xs" value="${pMin}">' <input type="text" inputmode="numeric" id="routes-input-pace-sec" class="routes-number-input routes-number-input--xs" value="${String(pSec).padStart(2, '0')}">"/km`;
    const updatePace = () => {
      const minVal = parseInt(el('routes-input-pace-min').value, 10) || 0;
      const secVal = Math.min(59, parseInt(el('routes-input-pace-sec').value, 10) || 0);
      routesState.routePaceMinPerKm = Math.max(0.1, minVal + secVal / 60);
    };
    wireNumericInput('routes-input-pace-min', updatePace);
    wireNumericInput('routes-input-pace-sec', updatePace);
  }

  if (routesHasAscentField()) {
    wireNumericInput('routes-input-ascent', v => { routesState.ascentM = parseInt(v, 10) || 0; });
    el('routes-input-level').onchange = e => { routesState.trailLevel = e.target.value; };
    el('routes-level-table-toggle').onclick = () => {
      const tableEl = el('routes-level-table');
      const opening = tableEl.style.display === 'none';
      tableEl.style.display = opening ? '' : 'none';
      if (opening && !tableEl.dataset.built) {
        tableEl.dataset.built = '1';
        tableEl.innerHTML = `
          <table class="races-table">
            <thead><tr><th>Catégorie</th><th>Vitesse moyenne</th><th>Allure moyenne</th></tr></thead>
            <tbody>${Object.values(ROUTES_TRAIL_LEVELS).map(lvl => `
              <tr>
                <td>${lvl.label}</td>
                <td>${lvl.minKmh} – ${lvl.maxKmh} km/h</td>
                <td>${routesFmtPaceFromKmh(lvl.maxKmh)} – ${routesFmtPaceFromKmh(lvl.minKmh)}/km</td>
              </tr>`).join('')}
            </tbody>
          </table>`;
      }
    };
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
  routesState.pickingEndpoint = null;
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

// Change le texte d'un element avec un fondu (opacite 0 -> texte -> opacite
// 1) plutot qu'un remplacement brut - retour utilisateur : les messages de
// la modale de progression changeaient trop sec.
function routesSetTextFaded(node, text, fadeMs = 220) {
  node.style.opacity = '0';
  setTimeout(() => {
    node.textContent = text;
    node.style.opacity = '1';
  }, fadeMs);
}

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
    routesSetTextFaded(label, steps[i]);
  }, 3500);

  // Rotation lente (10-12s, aleatoire pour eviter un rythme trop mecanique)
  // avec fondu - retour utilisateur : la rotation initiale (4.2s, sans
  // transition) defilait trop vite pour avoir le temps de lire/apprecier
  // chaque message. Auto-replanifiee (setTimeout en chaine) plutot qu'un
  // setInterval fixe, pour varier legerement le tempo a chaque cycle.
  const funLabel = el('routes-progress-fun-msg');
  let funIdx = Math.floor(Math.random() * ROUTES_FUN_MESSAGES.length);
  funLabel.textContent = ROUTES_FUN_MESSAGES[funIdx];
  const scheduleNextFunMessage = () => {
    const delay = 10000 + Math.random() * 2000;
    _routesProgressFunTimer = setTimeout(() => {
      funIdx = (funIdx + 1) % ROUTES_FUN_MESSAGES.length;
      routesSetTextFaded(funLabel, ROUTES_FUN_MESSAGES[funIdx]);
      scheduleNextFunMessage();
    }, delay);
  };
  scheduleNextFunMessage();

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
  if (_routesProgressFunTimer) { clearTimeout(_routesProgressFunTimer); _routesProgressFunTimer = null; }
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

// Traduit le D+ vise (abstrait) en pente moyenne (%) et en distance/allure
// REELLE concrete pour le niveau de traileur choisi - demande utilisateur
// (20/08) : detecter une combinaison irrealiste AVANT de lancer une
// recherche couteuse (BRouter) plutot qu'apres coup sur un resultat absurde
// (cas reel : 900 m de D+ / 22,8 km estimes a 3h19, la ou meme un excellent
// traileur mettrait plus de 3h30). Meme formule "distance equivalente plat"
// que cote serveur (route_generator.js, TRAIL_LEVELS/equivalentFlatKm) :
// distance + D+ (m) / 100.
// Mode 'duration' (l'utilisateur vise une DUREE) : combien de km reels ce
// niveau peut-il parcourir dans ce temps, compte tenu du D+ deja fixe ?
// Mode 'distance' (l'utilisateur vise une DISTANCE) : a quelle vitesse
// reelle ce niveau irait-il sur cette distance avec ce D+ ?
function routesBuildLevelConfirmation() {
  const ascentM = routesState.ascentM || 0;
  const midKmh = routesTrailLevelMidKmh(routesState.trailLevel);
  if (!midKmh) return null;
  const levelLabel = (ROUTES_TRAIL_LEVELS[routesState.trailLevel] || {}).label || '';

  if (routesState.mode === 'duration') {
    const durationMin = routesState.durationMin;
    const equivKmAvailable = midKmh * (durationMin / 60);
    const realDistanceKm = equivKmAvailable - ascentM / 100;
    if (realDistanceKm <= 0.1) {
      return { ok: false, message: `Avec ${ascentM} m de D+ sur seulement ${durationMin} minutes, un(e) ${levelLabel.toLowerCase()} n'aurait même pas le temps de grimper ce dénivelé — réduisez le D+ visé, allongez la durée, ou choisissez un niveau plus rapide.` };
    }
    const avgGradePct = (ascentM / (realDistanceKm * 1000)) * 100;
    return { ok: true, message: `Sur une durée de <strong>${durationMin} minutes</strong>, avec un D+ de <strong>${ascentM} m</strong>, cela signifie que vous seriez à même de courir <strong>${realDistanceKm.toFixed(1)} km</strong> avec une pente moyenne de <strong>${avgGradePct.toFixed(0)} %</strong>. Confirmez-vous ces critères ?` };
  }

  const distanceKm = routesState.distanceKm || 0;
  if (distanceKm <= 0) return null;
  const equivKm = distanceKm + ascentM / 100;
  const durationHours = equivKm / midKmh;
  const realAvgSpeedKmh = distanceKm / durationHours;
  const avgGradePct = (ascentM / (distanceKm * 1000)) * 100;
  return { ok: true, message: `Sur une distance de <strong>${distanceKm} km</strong>, avec un D+ de <strong>${ascentM} m</strong>, cela signifie que vous seriez à même de courir à <strong>${realAvgSpeedKmh.toFixed(1)} km/h</strong> avec une pente moyenne de <strong>${avgGradePct.toFixed(0)} %</strong>. Confirmez-vous ces critères ?` };
}

async function routesGenerateClicked() {
  const btn = el('routes-generate-btn');

  // Confirmation niveau/pente uniquement en Trail avec D+ (Route garde le
  // fonctionnement actuel : profil d'allure personnel, pas de niveau a
  // choisir ni de distance a confirmer ici - demande utilisateur explicite).
  if (routesHasAscentField()) {
    const confirmation = routesBuildLevelConfirmation();
    if (confirmation) {
      if (!confirmation.ok) {
        showToast(confirmation.message, 'error', 8000);
        return;
      }
      const proceed = await showConfirmModal({
        title: 'Vérifiez vos critères',
        message: confirmation.message,
        confirmLabel: 'Confirmer et lancer la recherche',
        cancelLabel: 'Modifier mes critères',
        icon: '🧭',
      });
      if (!proceed) return;
    }
  }

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
      trailLevel: routesHasAscentField() ? routesState.trailLevel : null,
      trailStyle: routesHasAscentField() ? routesState.trailStyle : null,
    };
    if (routesState.mode === 'distance') body.targetDistanceM = routesState.distanceKm * 1000;
    else body.targetDurationMin = routesState.durationMin;
    if (routesHasPaceField()) body.paceMinPerKm = routesState.routePaceMinPerKm;
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
  routesState.pickingEndpoint = null;
  renderRoutesResults(routesState.lastResult);
}

// Inverse le sens de parcours d'une option générée : la géométrie ne change
// pas, seul l'ordre des points s'inverse - distance/D+ totaux restent
// identiques (un aller-retour comme une boucle sont symétriques par
// construction), donc pas de recalcul de stats nécessaire. outLegPointCount/
// repeatedSegments (order-dependent) sont recalés en conséquence.
function reverseRouteOption(idx) {
  const opt = routesState.lastResult?.options?.[idx];
  if (!opt || !opt.points || opt.points.length < 2) return;
  const n = opt.points.length;
  opt.points = opt.points.slice().reverse();
  if (opt.outLegPointCount != null) opt.outLegPointCount = n - opt.outLegPointCount;
  if (opt.repeatedSegments) {
    opt.repeatedSegments = opt.repeatedSegments.map(s => ({ ...s, startIdx: n - 1 - s.endIdx, endIdx: n - 1 - s.startIdx }));
  }
  routesState.pickingEndpoint = null;
  renderRoutesResults(routesState.lastResult);
}

// Arme/désarme le mode "cliquez sur le tracé pour choisir le nouveau
// départ/arrivée" pour la carte idx - un nouveau clic sur le même bouton
// annule (toggle), cliquer un autre bouton réarme sur une autre cible.
function armRouteEndpointPicking(idx, target) {
  const cur = routesState.pickingEndpoint;
  routesState.pickingEndpoint = (cur && cur.idx === idx && cur.target === target) ? null : { idx, target };
  renderRoutesResults(routesState.lastResult);
}

// Applique le déplacement de départ/arrivée choisi par armRouteEndpointPicking
// une fois le point cliqué sur la carte (cf renderRouteMap) : rotation pour
// une boucle (même forme/distance), raccourci sinon (seule option possible
// sans changer la forme du reste du tracé, confirmé avec l'utilisateur) - la
// distance/D+/durée sont alors recalculés (approximation proportionnelle
// pour la durée, aucun profil d'allure recalculable côté client) et les
// correspondances D+/distance/durée visées à la génération sont effacées
// (elles ne représentent plus ce tracé raccourci manuellement).
function onRoutesEndpointPick(idx, target, opt, latlng) {
  const n = opt.points.length;
  const snappedIdx = findNearestPointIndexOnTrack(opt.points, latlng);
  let newPoints;
  if (target === 'loop') {
    if (snappedIdx <= 0 || snappedIdx >= n - 1) { showToast('Choisissez un point du tracé, différent du départ actuel.', 'error'); return; }
    newPoints = rotateLoopPoints(opt.points, snappedIdx);
    if (opt.repeatedSegments) {
      opt.repeatedSegments = opt.repeatedSegments
        .map(s => ({ ...s, startIdx: remapIndexAfterLoopRotate(s.startIdx, snappedIdx, n), endIdx: remapIndexAfterLoopRotate(s.endIdx, snappedIdx, n) }))
        .filter(s => s.endIdx > s.startIdx);
    }
    opt.outLegPointCount = null;
  } else if (target === 'start') {
    if (snappedIdx >= n - 1) { showToast("Choisissez un point avant l'arrivée actuelle.", 'error'); return; }
    newPoints = trimTrackPoints(opt.points, snappedIdx, n - 1);
    if (opt.repeatedSegments) opt.repeatedSegments = opt.repeatedSegments.map(s => ({ ...s, startIdx: s.startIdx - snappedIdx, endIdx: s.endIdx - snappedIdx })).filter(s => s.startIdx >= 0);
    if (opt.outLegPointCount != null) opt.outLegPointCount = Math.max(0, opt.outLegPointCount - snappedIdx);
  } else {
    if (snappedIdx <= 0) { showToast('Choisissez un point après le départ actuel.', 'error'); return; }
    newPoints = trimTrackPoints(opt.points, 0, snappedIdx);
    if (opt.repeatedSegments) opt.repeatedSegments = opt.repeatedSegments.filter(s => s.endIdx <= snappedIdx);
    if (opt.outLegPointCount != null && opt.outLegPointCount > snappedIdx) opt.outLegPointCount = null;
  }
  opt.points = newPoints;
  if (target !== 'loop') recomputeRouteOptionMetrics(opt);
  routesState.pickingEndpoint = null;
  renderRoutesResults(routesState.lastResult);
}

// Recalcule distance/D+/durée après un raccourci (target 'start'/'finish') -
// une rotation de boucle (target 'loop') garde exactement la même distance/D+
// totaux, aucun recalcul n'est nécessaire dans ce cas. La durée est mise à
// l'échelle proportionnellement à la nouvelle distance (aucun profil
// d'allure par pente recalculable côté client, cf predictDurationMin côté
// serveur) - une approximation raisonnable plutôt qu'une durée totalement
// périmée. Les correspondances D+/distance/durée visées à la génération ne
// représentent plus ce tracé modifié manuellement, elles sont effacées.
function recomputeRouteOptionMetrics(opt) {
  const pts = opt.points;
  let distM = 0, ascentM = 0;
  for (let i = 1; i < pts.length; i++) {
    distM += haversineKm(pts[i - 1], pts[i]) * 1000;
    const dEle = pts[i].ele - pts[i - 1].ele;
    if (dEle > 0) ascentM += dEle;
  }
  const ratio = opt.distanceM > 0 ? distM / opt.distanceM : 1;
  opt.predictedDurationMin = Math.max(1, Math.round(opt.predictedDurationMin * ratio));
  opt.distanceM = Math.round(distM);
  opt.ascentM = Math.round(ascentM);
  opt.matchLabel = null;
  opt.durationMatch = null;
  opt.distanceMatch = null;
  opt.ascentMatch = null;
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
    // Arrondir la duree totale AVANT de la decouper en h/min - arrondir
    // les minutes seules (ex: 119.6 -> 1h60 au lieu de 2h00) produisait un
    // affichage invalide des que les minutes fractionnaires depassaient 59.5.
    const totalDurMin = Math.round(opt.predictedDurationMin);
    const durH = Math.floor(totalDurMin / 60);
    const durM = totalDurMin % 60;
    const hasRepeatZone = routesHasRepeatZone(opt);
    // Distance entre le point litteralement demande et le vrai point de
    // depart du trace (BRouter accroche toujours au reseau routable le plus
    // proche, meme sans recherche de depart alternatif) - affichee
    // systematiquement, pas seulement dans le cas d'un depart tres decale
    // (cf opt.alternateStart, deja couvert par son propre message).
    const startOffsetKm = (data.requestedStart && opt.points && opt.points[0])
      ? haversineKm(data.requestedStart, opt.points[0]) : null;
    // Correspondance globale (Excellente/Bonne/Compromis) - la pire des deux
    // correspondances individuelles duree/D+ quand les deux cibles existent
    // (cf worseMatchLabel, route_generator.js) : une option a l'heure mais
    // loin du D+ visé n'est pas "Excellente" pour autant. N'existe que si au
    // moins une cible (duree et/ou D+) a ete fournie.
    let matchBadge = '';
    if (opt.matchLabel) {
      const parts = [];
      if (opt.durationMatch) parts.push(`${opt.durationMatch.deltaMin >= 0 ? '+' : ''}${opt.durationMatch.deltaMin} min`);
      if (opt.distanceMatch) parts.push(`${opt.distanceMatch.deltaM >= 0 ? '+' : ''}${(opt.distanceMatch.deltaM / 1000).toFixed(1)} km`);
      if (opt.ascentMatch) parts.push(`D+ ${opt.ascentMatch.deltaM >= 0 ? '+' : ''}${opt.ascentMatch.deltaM} m`);
      const titleParts = [];
      if (opt.durationMatch) titleParts.push(`Durée visée : ${Math.floor(opt.durationMatch.targetMin / 60)}h${String(opt.durationMatch.targetMin % 60).padStart(2, '0')}`);
      if (opt.distanceMatch) titleParts.push(`Distance visée : ${(opt.distanceMatch.targetM / 1000).toFixed(1)} km`);
      if (opt.ascentMatch) titleParts.push(`D+ visé : ${opt.ascentMatch.targetM} m`);
      matchBadge = `<span class="routes-match-badge routes-match-badge--${opt.matchLabel.toLowerCase()}" title="${titleParts.join(' — ')}">${opt.matchLabel} (${parts.join(', ')})</span>`;
    }
    // Allure moyenne estimee sur l'ensemble du parcours (D+ deja inclus dans
    // predictedDurationMin, cf predictDurationMin cote serveur) - demande
    // utilisateur explicite, pour juger d'un coup d'oeil l'effort implique
    // sans avoir a recalculer distance/duree soi-meme.
    const paceSecPerKm = opt.distanceM > 0 ? (opt.predictedDurationMin * 60) / (opt.distanceM / 1000) : null;

    const card = document.createElement('div');
    card.className = 'routes-result-card';
    card.innerHTML = `
      <div class="routes-result-header" data-idx="${idx}">
        <span class="routes-result-chevron${open ? ' routes-result-chevron--open' : ''}">&#x25BC;</span>
        <span class="routes-result-label">${opt.label}</span>
        <div class="routes-mini-stats">
          ${matchBadge}
          <div class="routes-mini-stat"><b>${(opt.distanceM / 1000).toFixed(1)}</b> km</div>
          <div class="routes-mini-stat"><b>${opt.ascentM}</b> m D+</div>
          <div class="routes-mini-stat"><b>${durH}h${String(durM).padStart(2, '0')}</b></div>
          <div class="routes-mini-stat" title="Allure moyenne estimée sur l'ensemble du parcours, dénivelé inclus"><b>${formatPace(paceSecPerKm)}</b></div>
          ${startOffsetKm !== null ? `<div class="routes-mini-stat" title="Distance entre le point demandé et le départ réel du parcours"><b>${formatStartOffset(startOffsetKm)}</b> du départ</div>` : ''}
        </div>
      </div>
      <div class="routes-result-body" style="display:${open ? '' : 'none'}">
        <div class="routes-commentary">${opt.commentary || ''}</div>
        ${opt.surfaceBreakdown && opt.surfaceBreakdown.length ? `
        <div class="routes-surface-breakdown">
          <div class="routes-surface-bar">${opt.surfaceBreakdown.map(s => `<span class="routes-surface-seg routes-surface-seg--${routesSurfaceSlug(s.label)}" style="width:${s.pct}%" title="${s.label} : ${s.pct}% (${(s.distanceM / 1000).toFixed(1)} km)"></span>`).join('')}</div>
          <div class="routes-surface-legend">${opt.surfaceBreakdown.map(s => `<span class="routes-surface-legend-item"><span class="routes-surface-dot routes-surface-dot--${routesSurfaceSlug(s.label)}"></span>${s.label} : ${s.pct}%</span>`).join('')}</div>
        </div>` : ''}
        <div class="routes-elev-container"><canvas id="routes-elev-${idx}"></canvas></div>
        <div class="routes-result-map" id="routes-map-${idx}"></div>
        ${hasRepeatZone || opt.shape === 'outback' ? `<div class="routes-hint routes-map-legend">
          ${hasRepeatZone ? '<span class="routes-legend-swatch routes-legend-swatch--repeat"></span> Côte(s) répétée(s) pour le D+ &nbsp;' : ''}
          ${opt.shape === 'outback' ? '<span class="routes-legend-swatch routes-legend-swatch--return"></span> Retour (même tracé que l\'aller) &nbsp;' : ''}
          <span class="routes-legend-swatch routes-legend-swatch--normal"></span> Reste du parcours
        </div>` : ''}
        ${routesState.pickingEndpoint && routesState.pickingEndpoint.idx === idx ? `<div class="routes-hint routes-picking-hint">🖱️ Cliquez sur le tracé (carte ci-dessus) pour choisir le nouveau point.</div>` : ''}
        <div class="routes-card-actions">
          <button type="button" class="route-editor-btn-secondary routes-action-btn" id="routes-reverse-${idx}">↔ Inverser le sens</button>
          ${isClosedLoopTrack(opt.points) ? `
          <button type="button" class="route-editor-btn-secondary routes-action-btn${routesState.pickingEndpoint?.idx === idx && routesState.pickingEndpoint.target === 'loop' ? ' active' : ''}" id="routes-move-loop-${idx}">📍 Déplacer le départ/l'arrivée</button>` : `
          <button type="button" class="route-editor-btn-secondary routes-action-btn${routesState.pickingEndpoint?.idx === idx && routesState.pickingEndpoint.target === 'start' ? ' active' : ''}" id="routes-move-start-${idx}">📍 Déplacer le départ</button>
          <button type="button" class="route-editor-btn-secondary routes-action-btn${routesState.pickingEndpoint?.idx === idx && routesState.pickingEndpoint.target === 'finish' ? ' active' : ''}" id="routes-move-finish-${idx}">🏁 Déplacer l'arrivée</button>`}
          <button class="btn-plans-restart routes-download-btn" id="routes-download-${idx}">⬇ Télécharger le GPX</button>
        </div>
      </div>
    `;
    list.appendChild(card);
    card.querySelector('.routes-result-header').onclick = () => toggleRouteCard(idx);
    if (open) {
      card.querySelector(`#routes-download-${idx}`).onclick = () => downloadRouteGpx(opt);
      card.querySelector(`#routes-reverse-${idx}`).onclick = () => reverseRouteOption(idx);
      const loopBtn = card.querySelector(`#routes-move-loop-${idx}`);
      if (loopBtn) loopBtn.onclick = () => armRouteEndpointPicking(idx, 'loop');
      const startBtn = card.querySelector(`#routes-move-start-${idx}`);
      if (startBtn) startBtn.onclick = () => armRouteEndpointPicking(idx, 'start');
      const finishBtn = card.querySelector(`#routes-move-finish-${idx}`);
      if (finishBtn) finishBtn.onclick = () => armRouteEndpointPicking(idx, 'finish');
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
        mapCtrl = renderRouteMap(`routes-map-${routesState.openIndex}`, opt, { requestedStart: data.requestedStart, searchRadiusM: data.searchRadiusM, cardIdx: routesState.openIndex, picking: routesState.pickingEndpoint });
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

// ─── Sens du parcours / départ-arrivée déplaçables ──────────────────────
// Fonctions partagées par la page Itinéraires et l'Éditeur Parcours (routes.js
// charge avant route_editor.js dans index.html, cf haversineKm ci-dessus déjà
// réutilisé de la même façon) - une seule implémentation plutôt que deux.

// Circuit "boucle" = départ et arrivée au même endroit, à une tolérance près
// - jamais exactement identique (dérive GPS au démarrage/à l'arrêt de la
// montre, point de départ légèrement décalé du point d'arrivée sur un sentier
// avec une courte liaison vers le parking...). Permet de choisir un nouveau
// départ=arrivée n'importe où sur le tracé (rotation, même forme, même
// distance) plutôt que de le raccourcir (seul choix géométriquement possible
// sur un tracé non bouclé, cf trimTrackPoints) - une tolérance trop stricte
// fait passer à tort une vraie boucle importée pour un tracé non bouclé,
// avec pour conséquence un raccourci destructeur au lieu d'une simple
// rotation (bug réel constaté, retour utilisateur 25/08 : GPX importé
// manifestement bouclé mais détecté non-bouclé). 300 m, largement au-dessus
// de la dérive GPS typique en début/fin d'enregistrement (souvent <50 m),
// pour rester robuste sur les imports GPX réels plutôt que sur des tracés
// synthétiques parfaitement fermés.
function isClosedLoopTrack(points, toleranceKm = 0.3) {
  return !!points && points.length >= 3 && haversineKm(points[0], points[points.length - 1]) < toleranceKm;
}

// Fait tourner un tracé bouclé (dernier point ≈ premier, doublon de clôture)
// pour que pivotIdx devienne le nouveau départ=arrivée - même forme, même
// distance, seul le point de rupture départ/arrivée se déplace.
function rotateLoopPoints(points, pivotIdx) {
  if (pivotIdx <= 0 || pivotIdx >= points.length - 1) return points;
  const core = points.slice(0, points.length - 1);
  const rotated = [...core.slice(pivotIdx), ...core.slice(0, pivotIdx)];
  rotated.push(rotated[0]);
  return rotated;
}

// Recale un index existant (POI, zone répétée...) après rotateLoopPoints.
function remapIndexAfterLoopRotate(oldIdx, pivotIdx, n) {
  const core = n - 1;
  return ((oldIdx % core) - pivotIdx + core) % core;
}

// Raccourcit un tracé NON bouclé en ne gardant que [newStartIdx..newEndIdx] -
// seule façon géométriquement possible de déplacer le départ/l'arrivée sans
// changer la forme du reste du tracé (confirmé avec l'utilisateur).
function trimTrackPoints(points, newStartIdx, newEndIdx) {
  return points.slice(newStartIdx, newEndIdx + 1);
}

function findNearestPointIndexOnTrack(points, latlng) {
  const lon = latlng.lon != null ? latlng.lon : latlng.lng;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dLat = points[i].lat - latlng.lat, dLon = points[i].lon - lon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Chevrons directionnels le long d'un tracé (plugin leaflet-polylinedecorator,
// cf index.html) - montre le sens de parcours quelle que soit son origine
// (importé, généré, créé). Garde typeof : si le plugin CDN n'a pas pu
// charger (coupure réseau), la carte doit rester utilisable sans chevrons
// plutôt que de faire planter tout le rendu.
function addDirectionChevrons(map, latLngs) {
  if (!latLngs || latLngs.length < 2 || typeof L.polylineDecorator !== 'function') return null;
  return L.polylineDecorator(latLngs, {
    patterns: [{
      // polygon:false = chevron "en contour" (deux traits, comme un ">"),
      // pas un triangle plein - demande utilisateur explicite. Le style
      // passe alors par pathOptions en TRAIT (color/weight), pas fillOpacity.
      offset: 25, repeat: 90,
      symbol: L.Symbol.arrowHead({ pixelSize: 12, polygon: false, pathOptions: { color: '#1e293b', weight: 2, opacity: 0.9 } }),
    }],
  }).addTo(map);
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

// Classe CSS courte pour chaque categorie de opt.surfaceBreakdown (cf
// classifyWayTags, route_generator.js) - les libelles complets contiennent
// espaces/accents/slash, pas exploitables tels quels comme suffixe de classe.
function routesSurfaceSlug(label) {
  if (label.includes('cyclable')) return 'cycle';
  if (label.includes('fort trafic')) return 'road-busy';
  if (label.includes('calme')) return 'road-calm';
  if (label.includes('Chemin')) return 'path';
  return 'other';
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

  // Alterne vert (parcours normal) / orange (zone repetee), une paire par
  // côte sollicitée - genéralise le cas a une seule côte (comportement
  // inchangé) comme a plusieurs.
  // Chevauchement geometrique REEL et inevitable a l'approche d'une cote en
  // impasse/singletrack (confirme sur un cas reel, retour utilisateur) : la
  // toute derniere portion de l'approche naturelle (avant la 1ere repetition)
  // et le tout debut de la descente de la repetition retracent exactement
  // les MEMES coordonnees en sens inverse (un seul chemin existe pour
  // rejoindre le sommet). Les deux polylines (avant=vert, zone=orange) se
  // superposent alors pixel pour pixel sur ce court tronçon - sans mesure
  // explicite, l'ordre d'empilement SVG par defaut de Leaflet ne garantissait
  // pas que l'orange (le renseignement le plus important ici) l'emporte
  // visuellement. bringToFront() force l'orange au-dessus de tout, quel que
  // soit l'ordre d'ajout.
  const zonePolylines = [];
  function drawWithRepeatZones(latLngsSlice, zones) {
    if (zones.length > 0) {
      let cursor = 0;
      zones.forEach(zone => {
        const before = latLngsSlice.slice(cursor, zone.startIdx + 1);
        if (before.length > 1) L.polyline(before, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
        zonePolylines.push(L.polyline(latLngsSlice.slice(zone.startIdx, zone.endIdx + 1), { color: '#e8590c', weight: 4 }).addTo(map));
        cursor = zone.endIdx;
      });
      const after = latLngsSlice.slice(cursor);
      if (after.length > 1) L.polyline(after, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
    } else {
      L.polyline(latLngsSlice, { color: '#2f6f3e', weight: 3.5 }).addTo(map);
    }
  }

  const repeatZones = routesRepeatZones(opt).slice().sort((a, b) => a.startIdx - b.startIdx);
  // Aller-retour : le retour est TOUJOURS le meme trace que l'aller (par
  // definition de la forme), jamais une repetition de côte pour le D+ - deux
  // notions distinctes que l'affichage confondait (retour utilisateur
  // explicite) puisque les deux pouvaient apparaitre en vert uniforme sans
  // distinction. Le retour est donc trace en pointilles, separement des
  // eventuelles zones repetees (toujours situees dans la portion aller,
  // cf boostOutAndBackViaRepeats) qui gardent leur code couleur habituel.
  const outLegPointCount = opt.shape === 'outback' && Number.isInteger(opt.outLegPointCount) && opt.outLegPointCount > 1 && opt.outLegPointCount < latLngs.length
    ? opt.outLegPointCount : null;
  if (outLegPointCount) {
    drawWithRepeatZones(latLngs.slice(0, outLegPointCount), repeatZones);
    // Chevauche le dernier point de l'aller pour la continuite visuelle.
    L.polyline(latLngs.slice(outLegPointCount - 1), { color: '#2f6f3e', weight: 3, dashArray: '2,10', opacity: 0.75 }).addTo(map);
  } else {
    drawWithRepeatZones(latLngs, repeatZones);
  }
  addDirectionChevrons(map, latLngs);
  L.marker(latLngs[0]).addTo(map).bindTooltip('Départ du tracé');
  if (latLngs.length > 1) {
    L.circleMarker(latLngs[latLngs.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 0.95 })
      .addTo(map).bindTooltip('Arrivée du tracé');
  }

  // Sélection du nouveau départ/arrivée (armée par armRouteEndpointPicking,
  // boutons "Déplacer le départ/l'arrivée" de la carte) : un seul clic sur le
  // tracé suffit à appliquer, cette carte n'affichant qu'une seule option à
  // la fois (pas d'ambiguïté possible sur la cible du clic).
  if (context.picking && context.picking.idx === context.cardIdx) {
    map.on('click', e => onRoutesEndpointPick(context.cardIdx, context.picking.target, opt, e.latlng));
  }

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
  // bringToFront() APRES le premier fitBounds - avant, la projection
  // interne des paths (this._map._latLngToNewLayerPoint...) n'est pas
  // encore prete sur une carte fraichement creee, meme comportement que le
  // "Cannot read properties of undefined" deja documente ci-dessus pour
  // circle.getBounds() (bug reel constate en testant ce correctif : chaque
  // ouverture de carte avec une zone repetee levait une exception qui
  // coupait tout le rendu, avant meme d'atteindre ce fitBounds).
  zonePolylines.forEach(pl => pl.bringToFront());

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

// Waypoints Garmin "Répétition k/N" pour chaque côte répétée du parcours
// (Course Points GPX - alerte pop-up sur la montre en approchant du point,
// cf buildGpxXml côté serveur) - N = seg.reps + 1 : reps compte les passages
// ADDITIONNELS au sommet, en plus de la montée naturelle déjà présente dans
// la boucle de base (vérifié empiriquement - ne pas confondre avec la
// convention de l'Éditeur Parcours, où le compte saisi est déjà le total).
function buildRepeatWaypoints(opt) {
  const wps = [];
  (opt.repeatedSegments || []).forEach(seg => {
    const total = seg.reps + 1;
    for (let k = 1; k <= total; k++) {
      wps.push({ lat: seg.toLat, lon: seg.toLon, name: `Répétition ${k}/${total}`, sym: 'Flag, Blue' });
    }
  });
  return wps;
}

async function downloadRouteGpx(option) {
  try {
    const res = await fetch(`${API}/api/routes/gpx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: option.points, label: option.label, waypoints: buildRepeatWaypoints(option) }),
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
