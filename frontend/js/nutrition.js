// nutrition.js — page "Nutrition" (carrousel + bibliothèque de recettes) et
// suggestion de repas "veille de séance" (Entraînements, campus.js).
// Données statiques : frontend/data/recipes.json + frontend/images/recipes/
// (catalogue généré une fois depuis 2 fichiers Word — voir CLAUDE.md).

let _nutritionRecipes = null;
let _nutritionCarouselTimer = null;
let _nutritionCarouselIdx = -1;
let _nutritionUsingA = true;

const NUTRITION_PROTEIN_LABELS = {
  poulet: 'Poulet', dinde: 'Dinde', boeuf: 'Bœuf', veau: 'Veau', porc: 'Porc', agneau: 'Agneau',
  jambon: 'Jambon', saumon: 'Saumon', truite: 'Truite', thon: 'Thon', poisson_blanc: 'Poisson blanc',
  crevettes: 'Crevettes', coquillages: 'Coquillages', oeuf: 'Œufs', tofu: 'Tofu',
  legumineuses: 'Légumineuses', fromage: 'Fromage',
};
const NUTRITION_SIDE_LABELS = {
  brocoli: 'Brocolis', epinard: 'Épinards', poivron: 'Poivron', courgette: 'Courgette', aubergine: 'Aubergine',
  tomate: 'Tomate', oignon: 'Oignon', poireau: 'Poireau', carotte: 'Carotte', champignon: 'Champignons',
  chou: 'Chou', asperge: 'Asperges', courge: 'Courge / potiron', concombre: 'Concombre', avocat: 'Avocat',
  radis: 'Radis', betterave: 'Betterave', panais: 'Panais', salade_verte: 'Salade verte', haricots_verts: 'Haricots verts',
  riz: 'Riz', pates: 'Pâtes', quinoa: 'Quinoa', semoule: 'Semoule', patate_douce: 'Patate douce',
  pomme_terre: 'Pomme de terre', polenta: 'Polenta', orge: 'Orge perlé', sarrasin: 'Sarrasin',
  millet: 'Millet', epeautre: 'Petit épeautre', pain: 'Pain', nouilles: 'Nouilles',
  legumineuses_feculent: 'Légumineuses',
};

async function loadNutritionRecipes() {
  if (_nutritionRecipes) return _nutritionRecipes;
  try {
    const res = await fetch('recipes.json');
    _nutritionRecipes = await res.json();
  } catch (e) {
    console.error('loadNutritionRecipes:', e);
    _nutritionRecipes = [];
  }
  return _nutritionRecipes;
}

async function initNutritionPage() {
  const recipes = await loadNutritionRecipes();
  if (!recipes.length) return;
  startNutritionCarousel(recipes);
  populateNutritionFilters(recipes);
  wireNutritionFilters();
  renderNutritionLibrary();
}

// ─── Carrousel (fondu, meme mecanique que initBgSlideshow, app.js) ─────
function startNutritionCarousel(recipes) {
  const layerA = el('nutri-carousel-a');
  const layerB = el('nutri-carousel-b');
  if (!layerA || !layerB) return;
  clearInterval(_nutritionCarouselTimer);

  function showRandom() {
    let idx = Math.floor(Math.random() * recipes.length);
    if (recipes.length > 1 && idx === _nutritionCarouselIdx) idx = (idx + 1) % recipes.length;
    _nutritionCarouselIdx = idx;
    const r = recipes[idx];
    const bg = r.image ? `url('${r.image}')` : nutritionPlaceholderGradient(r);
    const target = _nutritionUsingA ? layerB : layerA;
    const other = _nutritionUsingA ? layerA : layerB;
    target.style.backgroundImage = bg;
    target.classList.add('active');
    setTimeout(() => other.classList.remove('active'), 100);
    _nutritionUsingA = !_nutritionUsingA;
    renderNutritionCarouselInfo(r);
  }

  showRandom();
  layerA.style.transition = 'none';
  setTimeout(() => { layerA.style.transition = ''; layerB.style.transition = ''; }, 50);
  if (recipes.length > 1) _nutritionCarouselTimer = setInterval(showRandom, 7000);

  const carousel = el('nutri-carousel');
  if (carousel) carousel.onclick = () => {
    const r = recipes[_nutritionCarouselIdx];
    if (r) openRecipeModal(r);
  };
}

function renderNutritionCarouselInfo(recipe) {
  const info = el('nutri-carousel-info');
  if (!info) return;
  info.innerHTML = `
    <div class="nutri-carousel-emojis">${(recipe.emojis || []).join(' ')}</div>
    <div class="nutri-carousel-name">${escapeHtml(recipe.name)}</div>
    <div class="nutri-carousel-cta">Voir la recette →</div>
  `;
}

function nutritionPlaceholderGradient(recipe) {
  return `linear-gradient(135deg, var(--accent-light), var(--bg-hover))`;
}

// ─── Bibliotheque + filtres ─────────────────────────────────────────
function populateNutritionFilters(recipes) {
  const proteinSel = el('nutri-filter-protein');
  const sideSel = el('nutri-filter-side');
  if (!proteinSel || !sideSel || proteinSel.dataset.built) return;
  proteinSel.dataset.built = '1';

  const proteinKeys = [...new Set(recipes.flatMap(r => r.proteinTags))]
    .sort((a, b) => (NUTRITION_PROTEIN_LABELS[a] || a).localeCompare(NUTRITION_PROTEIN_LABELS[b] || b, 'fr'));
  proteinKeys.forEach(k => {
    proteinSel.innerHTML += `<option value="${k}">${NUTRITION_PROTEIN_LABELS[k] || k}</option>`;
  });

  const sideKeys = [...new Set(recipes.flatMap(r => [...r.vegetableTags, ...r.starchTags]))]
    .sort((a, b) => (NUTRITION_SIDE_LABELS[a] || a).localeCompare(NUTRITION_SIDE_LABELS[b] || b, 'fr'));
  sideKeys.forEach(k => {
    sideSel.innerHTML += `<option value="${k}">${NUTRITION_SIDE_LABELS[k] || k}</option>`;
  });
}

function wireNutritionFilters() {
  const proteinSel = el('nutri-filter-protein');
  const sideSel = el('nutri-filter-side');
  const resetBtn = el('nutri-filter-reset');
  if (proteinSel && !proteinSel.dataset.wired) {
    proteinSel.dataset.wired = '1';
    proteinSel.onchange = renderNutritionLibrary;
  }
  if (sideSel && !sideSel.dataset.wired) {
    sideSel.dataset.wired = '1';
    sideSel.onchange = renderNutritionLibrary;
  }
  if (resetBtn && !resetBtn.dataset.wired) {
    resetBtn.dataset.wired = '1';
    resetBtn.onclick = () => {
      proteinSel.value = '';
      sideSel.value = '';
      renderNutritionLibrary();
    };
  }
}

function renderNutritionLibrary() {
  const grid = el('nutri-grid');
  const countEl = el('nutri-library-count');
  const resetBtn = el('nutri-filter-reset');
  if (!grid || !_nutritionRecipes) return;
  const protein = el('nutri-filter-protein')?.value || '';
  const side = el('nutri-filter-side')?.value || '';

  const filtered = _nutritionRecipes.filter(r => {
    if (protein && !r.proteinTags.includes(protein)) return false;
    if (side && !r.vegetableTags.includes(side) && !r.starchTags.includes(side)) return false;
    return true;
  });

  if (resetBtn) resetBtn.style.display = (protein || side) ? '' : 'none';
  if (countEl) countEl.textContent = `${filtered.length} recette${filtered.length > 1 ? 's' : ''}`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="nutri-empty">Aucune recette ne correspond à ces critères.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(r => `
    <button type="button" class="nutri-card" data-id="${r.id}">
      ${r.image
        ? `<img class="nutri-card-thumb" src="${r.image}" alt="${escapeHtml(r.name)}" loading="lazy">`
        : `<div class="nutri-card-thumb nutri-card-thumb--placeholder">${(r.emojis && r.emojis[0]) || '🍽️'}</div>`}
      <div class="nutri-card-body">
        <div class="nutri-card-name">${escapeHtml(r.name)}</div>
        <div class="nutri-card-tags">
          ${r.proteinTags.slice(0, 1).map(k => `<span class="nutri-tag nutri-tag--protein">${NUTRITION_PROTEIN_LABELS[k] || k}</span>`).join('')}
          ${r.vegetableTags.slice(0, 1).map(k => `<span class="nutri-tag nutri-tag--side">${NUTRITION_SIDE_LABELS[k] || k}</span>`).join('')}
          ${r.starchTags.slice(0, 1).map(k => `<span class="nutri-tag nutri-tag--side">${NUTRITION_SIDE_LABELS[k] || k}</span>`).join('')}
        </div>
      </div>
    </button>
  `).join('');

  grid.querySelectorAll('.nutri-card').forEach(btn => {
    btn.onclick = () => {
      const r = _nutritionRecipes.find(x => x.id === btn.dataset.id);
      if (r) openRecipeModal(r);
    };
  });
}

// ─── Modale recette (partagee Nutrition <-> Entrainements) ────────────
function nutritionWhySections(why) {
  const sections = [];
  let current = null;
  (why || []).forEach(item => {
    if (item.category) {
      current = { category: item.category, points: [] };
      sections.push(current);
    } else if (item.point) {
      if (!current) { current = { category: null, points: [] }; sections.push(current); }
      current.points.push(item.point);
    }
  });
  return sections;
}

function openRecipeModal(recipe, banner) {
  const existing = document.getElementById('recipe-modal-backdrop');
  if (existing) existing.remove();
  const whySections = nutritionWhySections(recipe.why);

  const backdrop = document.createElement('div');
  backdrop.className = 'confirm-modal-backdrop';
  backdrop.id = 'recipe-modal-backdrop';
  backdrop.innerHTML = `
    <div class="recipe-modal" onclick="event.stopPropagation()">
      <button class="recipe-modal-close" id="recipe-modal-close" title="Fermer" aria-label="Fermer">&times;</button>
      ${recipe.image
        ? `<div class="recipe-modal-hero" style="background-image:url('${recipe.image}')"></div>`
        : `<div class="recipe-modal-hero recipe-modal-hero--placeholder">${(recipe.emojis && recipe.emojis[0]) || '🍽️'}</div>`}
      <div class="recipe-modal-body">
        ${banner ? `<div class="recipe-modal-banner">${escapeHtml(banner)}</div>` : ''}
        <div class="recipe-modal-emojis">${(recipe.emojis || []).join(' ')}</div>
        <h2 class="recipe-modal-name">${escapeHtml(recipe.name)}</h2>
        <div class="recipe-modal-portions">Pour ${recipe.portions || 2} personnes</div>

        <div class="recipe-modal-grid">
          <div class="recipe-modal-col">
            <div class="recipe-modal-section-title">Ingrédients</div>
            <ul class="recipe-ingredients-list">
              ${recipe.ingredients.map(i => `<li><label><input type="checkbox"> <span>${escapeHtml(i)}</span></label></li>`).join('')}
            </ul>
          </div>
          <div class="recipe-modal-col">
            <div class="recipe-modal-section-title">Préparation</div>
            <ol class="recipe-steps-list">
              ${recipe.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
            </ol>
          </div>
        </div>

        ${whySections.length ? `
        <div class="recipe-why-box">
          <div class="recipe-modal-section-title">🔥 Pourquoi c'est top</div>
          ${whySections.map(sec => `
            <div class="recipe-why-section">
              ${sec.category ? `<div class="recipe-why-category">${escapeHtml(sec.category)}</div>` : ''}
              <ul class="recipe-why-points">
                ${sec.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}
              </ul>
            </div>
          `).join('')}
        </div>` : ''}

        <div class="recipe-modal-actions">
          <button type="button" class="btn-recipe-print" id="recipe-modal-print">🖨️ Imprimer la recette</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', escHandler); };
  function escHandler(e) { if (e.key === 'Escape') close(); }
  backdrop.querySelector('#recipe-modal-close').onclick = close;
  backdrop.querySelector('#recipe-modal-print').onclick = () => printRecipe(recipe);
  attachBackdropClose(backdrop, close);
  document.addEventListener('keydown', escHandler);
}

// ─── Impression ───────────────────────────────────────────────────────
// Feuille dediee construite a la volee (jamais affichee a l'ecran, seulement
// en @media print - voir style.css) plutot qu'une nouvelle fenetre : plus
// fiable (pas de bloqueur de pop-up), et la mise en page profite directement
// des styles deja charges par la page.
function printRecipe(recipe) {
  const existing = document.getElementById('recipe-print-sheet');
  if (existing) existing.remove();
  const whySections = nutritionWhySections(recipe.why);
  const sheet = document.createElement('div');
  sheet.id = 'recipe-print-sheet';
  sheet.innerHTML = `
    <h1>${escapeHtml(recipe.name)}</h1>
    <div class="recipe-print-meta">Pour ${recipe.portions || 2} personnes ${(recipe.emojis || []).join(' ')}</div>
    ${recipe.image ? `<img src="${recipe.image}" alt="">` : ''}
    <div class="recipe-print-cols">
      <div>
        <h2>Ingrédients</h2>
        <ul>${recipe.ingredients.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
      </div>
      <div>
        <h2>Préparation</h2>
        <ol>${recipe.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
      </div>
    </div>
    ${whySections.length ? `
      <h2>Pourquoi c'est top</h2>
      ${whySections.map(sec => `
        <div class="recipe-print-why">
          ${sec.category ? `<strong>${escapeHtml(sec.category)}</strong>` : ''}
          <ul>${sec.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
        </div>`).join('')}
    ` : ''}
    <div class="recipe-print-footer">Allure+ — Nutrition</div>
  `;
  document.body.appendChild(sheet);
  window.print();
  setTimeout(() => sheet.remove(), 1000);
}

// ─── Suggestion "repas de la veille" (Entrainements, campus.js) ───────
// Categorise chaque type de seance (memes cles que SESSION_TYPE_PROFILES,
// session-analysis.js) vers les tags recette a privilegier la veille :
// - efforts longs/copieux (sortie longue, trail, marathon) -> feculent +
//   proteine consequente, pour bien remplir les reserves de glycogene.
// - efforts intenses courts (VMA, seuil) -> repas plus digeste, feculent a
//   IG modere, pas de proteine trop lourde a digerer juste avant l'effort.
// - EF/tempo -> pas de contrainte particuliere (toutes recettes valables).
const NUTRITION_SESSION_SIDE_PREF = {
  SORTIE_LONGUE: ['riz', 'pates', 'quinoa', 'patate_douce', 'semoule', 'pomme_terre'],
  TRAIL: ['riz', 'pates', 'quinoa', 'patate_douce', 'semoule', 'pomme_terre'],
  MARATHON_AS42: ['riz', 'pates', 'quinoa', 'patate_douce', 'semoule', 'pomme_terre'],
  VMA: ['riz', 'quinoa', 'patate_douce'],
  SEUIL: ['riz', 'quinoa', 'patate_douce'],
};
const NUTRITION_SUGGESTION_HISTORY_KEY = 'nutrition_suggestion_history';
const NUTRITION_SUGGESTION_HISTORY_MAX = 15;

function loadNutritionSuggestionHistory() {
  try { return JSON.parse(localStorage.getItem(NUTRITION_SUGGESTION_HISTORY_KEY)) || []; } catch { return []; }
}
function pushNutritionSuggestionHistory(id) {
  const hist = loadNutritionSuggestionHistory();
  hist.push(id);
  while (hist.length > NUTRITION_SUGGESTION_HISTORY_MAX) hist.shift();
  localStorage.setItem(NUTRITION_SUGGESTION_HISTORY_KEY, JSON.stringify(hist));
}

// Icone ronde placee dans l'en-tete "Description" d'une seance (campus.js,
// renderSessionDetail) - SVG dessine au trait (part de gateau), jamais un
// emoji, coherent avec le reste des icones de l'app (meme stroke-width que
// .nav-icon). Cliquer dessus recherche/affiche la seance depuis campusState
// (jamais l'objet session complet embarque dans l'attribut onclick) - voir
// handleMealSuggestClick.
function mealSuggestBtnHtml(session, weekId) {
  return `<button type="button" class="session-meal-suggest-btn" title="Suggestion pour le repas de la veille" onclick="event.stopPropagation(); handleMealSuggestClick('${weekId || ''}', ${session.trainingIndex ?? 0})">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 4 L20 20 L4 20 Z"/>
      <path d="M6.5 13c1.6-1.8 3.2-1.8 4.8 0s3.2 1.8 4.8 0"/>
      <circle cx="12" cy="4" r="1" fill="currentColor" stroke="none"/>
    </svg>
  </button>`;
}

function handleMealSuggestClick(weekId, trainingIndex) {
  const week = (campusState.weeks || []).find(w => w._id === weekId);
  const session = week?.sessions?.find(s => (s.trainingIndex ?? 0) === Number(trainingIndex));
  if (!session) {
    if (typeof showToast === 'function') showToast('Séance introuvable', 'error');
    return;
  }
  const goalType = campusState.goal?.goalType || '';
  const isTrail = typeof isTrailSession === 'function' ? isTrailSession(session) : false;
  const sessionTypeKey = typeof classifySessionType === 'function' ? classifySessionType(session, goalType, isTrail) : null;
  suggestMealForSession(session, sessionTypeKey);
}

async function suggestMealForSession(session, sessionTypeKey) {
  const recipes = await loadNutritionRecipes();
  if (!recipes.length) return;
  const preferredSides = NUTRITION_SESSION_SIDE_PREF[sessionTypeKey] || null;
  let pool = preferredSides
    ? recipes.filter(r => r.starchTags.some(t => preferredSides.includes(t)))
    : recipes.slice();
  if (!pool.length) pool = recipes.slice();

  const history = loadNutritionSuggestionHistory();
  const fresh = pool.filter(r => !history.includes(r.id));
  const candidates = fresh.length ? fresh : pool;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  pushNutritionSuggestionHistory(pick.id);

  const label = session?.displayName || session?.name || 'cette séance';
  openRecipeModal(pick, `💡 Suggestion pour le repas de la veille de « ${label} »`);
}
