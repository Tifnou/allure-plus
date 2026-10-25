/* ═══════════════════════════════════════════════
   Test VMA 3'+9' (Profil)
   Protocole Running Addict / Campus Coach : 3' a fond, 30' de recuperation,
   9' a fond ; VMA = moyenne des vitesses des deux efforts. Le resultat est
   compare a la VMA de la formule (calcVMA, app.js) ; si l'utilisateur
   l'applique, on retient le COEFFICIENT D'ECART (VMA test / VMA formule du
   jour) qui est ensuite applique a la formule : la VMA continue de suivre la
   VO2max Garmin du moment. Etat dans la cle durable `suivi_vma_test`
   (loadVmaTestState / getVmaAdjustment, app.js). Rien n'est applique sans clic.
═══════════════════════════════════════════════ */
const VMA_TEST_REMIND_MONTHS = 6;   // « à renouveler bientôt »
const VMA_TEST_OLD_MONTHS    = 12;  // « test ancien »
const VMA_TEST_GAP_WARN_PCT  = 10;  // au-delà : vérifier la saisie avant d'appliquer
const VMA_TEST_SPEED_RANGE   = [6, 30]; // km/h plausibles pour un effort de 3' ou 9'

let _vmaTestFormOpen = false;

function saveVmaTestState(st) {
  localStorage.setItem('suivi_vma_test', JSON.stringify({ tests: st.tests, appliedId: st.appliedId || null }));
}

/** "9:04", "9'04", "9m04" ou "544" (secondes) -> secondes, sinon null. */
function parseVmaTestTime(str) {
  const s = String(str || '').trim().replace(/[’′"]/g, "'");
  let m = s.match(/^(\d{1,2})\s*[:'m]\s*(\d{1,2})$/i);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = s.match(/^\d{2,4}$/);
  return m ? parseInt(s, 10) : null;
}

function fmtVmaTestTime(sec) {
  return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
}

/** Vitesses (km/h) et VMA du test ; null si une saisie est invalide. */
function computeVmaTest(d3, t3, d9, t9) {
  if (!(d3 > 0) || !(d9 > 0) || !(t3 > 0) || !(t9 > 0)) return null;
  const v3 = d3 / t3 * 3.6;
  const v9 = d9 / t9 * 3.6;
  return { v3, v9, vma: (v3 + v9) / 2 };
}

function vmaTestMonthsSince(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return 0;
  return (Date.now() - d.getTime()) / (30.44 * 86400000);
}

function vmaTestFmtPct(p) {
  return (p >= 0 ? '+' : '') + p.toFixed(1).replace('.', ',') + ' %';
}

function vmaTestCurrentFormula() {
  const sex = (typeof loadProfileData === 'function' ? loadProfileData().sex : null) || 'M';
  const vo2 = (typeof _latestVO2Max !== 'undefined') ? _latestVO2Max : null;
  const raw = vo2 ? calcVMA(vo2, sex, { raw: true }) : null;
  return { sex, vo2, raw };
}

function renderVmaTestCard() {
  const root = document.getElementById('profile-vma-test');
  if (!root) return;
  const st = loadVmaTestState();
  const applied = st.tests.find(t => t.id === st.appliedId) || null;
  const last = st.tests.length ? st.tests[st.tests.length - 1] : null;
  const f = vmaTestCurrentFormula();

  // Statut de la VMA actuellement utilisée
  let status = '';
  if (applied) {
    const months = vmaTestMonthsSince(applied.date);
    const age = months >= VMA_TEST_OLD_MONTHS
      ? `<span class="vt-flag vt-flag--old">Test ancien (${Math.floor(months)} mois) — à refaire</span>`
      : months >= VMA_TEST_REMIND_MONTHS
        ? `<span class="vt-flag vt-flag--soon">À renouveler bientôt (${Math.floor(months)} mois)</span>`
        : '';
    status = `<div class="vt-status">
      <div><strong>VMA ajustée par ton test</strong> du ${new Date(applied.date).toLocaleDateString('fr-FR')} :
      formule ${vmaTestFmtPct((applied.ratio - 1) * 100)} — elle suit toujours ta VO₂max Garmin.</div>
      ${age}
      <button class="btn-secondary vt-btn" onclick="clearVmaTestApplied()">Revenir à la formule standard</button>
    </div>`;
  } else {
    status = `<div class="vt-status vt-status--muted">Aucun test appliqué : la VMA vient de la formule standard à partir de ta VO₂max Garmin.</div>`;
  }

  // Dernier test non appliqué : comparaison + choix
  let compare = '';
  if (last && last.id !== st.appliedId && !last.dismissed) compare = renderVmaTestCompare(last, false);
  else if (applied) compare = renderVmaTestCompare(applied, true);

  const history = st.tests.length > 1 ? `
    <details class="vt-history"><summary>Historique des tests (${st.tests.length})</summary>
      ${st.tests.slice().reverse().map(t => `
        <div class="vt-hist-row">
          <span>${new Date(t.date).toLocaleDateString('fr-FR')}</span>
          <span>${t.vmaTest.toFixed(1)} km/h</span>
          <span>${vmaTestFmtPct(t.gapPct)} vs formule</span>
          <span>${t.id === st.appliedId ? '✓ appliqué' : ''}</span>
          <button class="vt-link" onclick="deleteVmaTest('${t.id}')">Supprimer</button>
        </div>`).join('')}
    </details>` : '';

  root.innerHTML = `
    <div class="card-header"><h2 class="card-title"><span class="card-title-icon">&#x23F1;&#xFE0F;</span> Test VMA 3'+9'</h2></div>
    <div class="vt-body">
      <p class="vt-intro">Deux efforts à fond (3 min puis 9 min) pour mesurer ta VMA réelle et la comparer à celle d'Allure+. À refaire une fois par an.</p>
      ${status}
      <div class="vt-actions">
        <button class="btn-primary vt-btn" onclick="openVmaTestProtocol()">Je vais faire le test — voir le protocole</button>
        <button class="btn-secondary vt-btn" onclick="toggleVmaTestForm()">J'ai fait le test — saisir mes distances</button>
      </div>
      ${_vmaTestFormOpen ? renderVmaTestForm(f) : ''}
      ${compare}
      ${history}
    </div>`;
  if (_vmaTestFormOpen) updateVmaTestPreview();
}

function renderVmaTestForm(f) {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="vt-form">
      <div class="vt-form-grid">
        <label>Date du test<input type="date" id="vt-date" value="${today}" max="${today}"></label>
        <label>Terrain
          <select id="vt-terrain">
            <option value="piste">Piste</option>
            <option value="route">Route plate</option>
            <option value="tapis">Tapis</option>
          </select>
        </label>
        <label>Effort de 3' — distance (m)<input type="number" id="vt-d3" min="100" max="2000" step="5" placeholder="ex : 1000" oninput="updateVmaTestPreview()"></label>
        <label>Temps réel (mm:ss)<input type="text" id="vt-t3" value="3:00" placeholder="2:53" oninput="updateVmaTestPreview()"></label>
        <label>Effort de 9' — distance (m)<input type="number" id="vt-d9" min="300" max="6000" step="5" placeholder="ex : 2800" oninput="updateVmaTestPreview()"></label>
        <label>Temps réel (mm:ss)<input type="text" id="vt-t9" value="9:00" placeholder="9:04" oninput="updateVmaTestPreview()"></label>
      </div>
      <p class="vt-hint">Si tu t'es arrêté au repère de piste le plus proche, entre le temps réel à ce repère (ex : 1000 m en 2:53).</p>
      <div id="vt-preview" class="vt-preview"></div>
      <div class="vt-actions">
        <button class="btn-primary vt-btn" id="vt-save" onclick="saveVmaTestResult()" disabled>Enregistrer le résultat</button>
        <button class="btn-secondary vt-btn" onclick="toggleVmaTestForm()">Annuler</button>
      </div>
      ${f.raw ? '' : '<p class="vt-hint vt-warn">VO₂max Garmin indisponible : le résultat sera enregistré mais la comparaison est impossible.</p>'}
    </div>`;
}

function readVmaTestForm() {
  const val = id => document.getElementById(id)?.value;
  const d3 = parseFloat(val('vt-d3')), d9 = parseFloat(val('vt-d9'));
  const t3 = parseVmaTestTime(val('vt-t3')), t9 = parseVmaTestTime(val('vt-t9'));
  return { d3, d9, t3, t9, calc: computeVmaTest(d3, t3, d9, t9) };
}

function updateVmaTestPreview() {
  const box = document.getElementById('vt-preview');
  const btn = document.getElementById('vt-save');
  if (!box) return;
  const { calc } = readVmaTestForm();
  if (!calc) { box.innerHTML = ''; if (btn) btn.disabled = true; return; }
  const [lo, hi] = VMA_TEST_SPEED_RANGE;
  const bad = [calc.v3, calc.v9].some(v => v < lo || v > hi);
  const f = vmaTestCurrentFormula();
  let html = `3' : <strong>${calc.v3.toFixed(2)} km/h</strong> · 9' : <strong>${calc.v9.toFixed(2)} km/h</strong> → VMA du test <strong>${calc.vma.toFixed(1)} km/h</strong>`;
  if (f.raw) html += ` <span class="vt-muted">(formule Allure+ : ${f.raw.toFixed(1)} km/h)</span>`;
  if (bad) html += `<div class="vt-warn">Vitesse hors de la plage plausible (${lo}–${hi} km/h) : vérifie distances et temps.</div>`;
  else if (calc.v9 >= calc.v3) html += `<div class="vt-warn">Le 9' est aussi rapide que le 3' : c'est inhabituel, vérifie ta saisie.</div>`;
  box.innerHTML = html;
  if (btn) btn.disabled = bad;
}

function toggleVmaTestForm() {
  _vmaTestFormOpen = !_vmaTestFormOpen;
  renderVmaTestCard();
}

function saveVmaTestResult() {
  const { d3, d9, t3, t9, calc } = readVmaTestForm();
  if (!calc) return;
  const f = vmaTestCurrentFormula();
  const test = {
    id: 't' + Date.now(),
    date: document.getElementById('vt-date')?.value || new Date().toISOString().slice(0, 10),
    terrain: document.getElementById('vt-terrain')?.value || 'piste',
    d3, t3, d9, t9,
    v3: +calc.v3.toFixed(3), v9: +calc.v9.toFixed(3),
    vmaTest: +calc.vma.toFixed(2),
    vmaFormula: f.raw ? +f.raw.toFixed(2) : null,
    vo2: f.vo2 || null,
    ratio: f.raw ? +(calc.vma / f.raw).toFixed(4) : null,
    gapPct: f.raw ? +((calc.vma / f.raw - 1) * 100).toFixed(2) : 0,
  };
  const st = loadVmaTestState();
  st.tests.push(test);
  saveVmaTestState(st);
  _vmaTestFormOpen = false;
  renderVmaTestCard();
  showToast('Test enregistré — choisis comment l\'utiliser', 'success');
}

function renderVmaTestCompare(t, isApplied) {
  if (!t.ratio) {
    return `<div class="vt-compare"><div>VMA du test : <strong>${t.vmaTest.toFixed(1)} km/h</strong>. Comparaison impossible (VO₂max Garmin indisponible le jour du test).</div></div>`;
  }
  const big = Math.abs(t.gapPct) > VMA_TEST_GAP_WARN_PCT;
  const note = t.gapPct > 0
    ? `Ton test est <strong>au-dessus</strong> de ce qu'estime Allure+ : la formule te sous-estime peut-être.`
    : `Ton test est <strong>en dessous</strong> de ce qu'estime Allure+ : la formule te surestime peut-être, ou le test était à moins que ton maximum.`;
  const choices = isApplied ? '' : `
    <div class="vt-actions">
      <button class="btn-primary vt-btn" onclick="applyVmaTest('${t.id}')">Ajuster ma VMA (${vmaTestFmtPct(t.gapPct)})</button>
      <button class="btn-secondary vt-btn" onclick="dismissVmaTest('${t.id}')">Garder la VMA Allure+</button>
    </div>
    <p class="vt-hint">L'écart est appliqué à la formule : ta VMA continue de varier avec ta VO₂max Garmin (forme du moment), seul le biais de la formule sur toi est corrigé.</p>`;
  return `
    <div class="vt-compare">
      <div class="vt-compare-title">Résultat du test du ${new Date(t.date).toLocaleDateString('fr-FR')}</div>
      <div class="vt-compare-row">
        <div><span class="vt-num">${t.vmaTest.toFixed(1)}</span> km/h<small>VMA du test</small></div>
        <div><span class="vt-num">${t.vmaFormula.toFixed(1)}</span> km/h<small>VMA Allure+ ce jour-là</small></div>
        <div><span class="vt-num vt-num--gap">${vmaTestFmtPct(t.gapPct)}</span><small>écart</small></div>
      </div>
      <p>${note}</p>
      ${big ? `<div class="vt-warn">Écart supérieur à ${VMA_TEST_GAP_WARN_PCT} % : vérifie tes distances et temps, ou refais le test avant d'appliquer.</div>` : ''}
      ${choices}
    </div>`;
}

async function applyVmaTest(id) {
  const st = loadVmaTestState();
  const t = st.tests.find(x => x.id === id);
  if (!t || !t.ratio) return;
  if (Math.abs(t.gapPct) > VMA_TEST_GAP_WARN_PCT) {
    const ok = await showConfirmModal({
      title: 'Écart important',
      message: `L'écart de ${vmaTestFmtPct(t.gapPct)} est supérieur à ${VMA_TEST_GAP_WARN_PCT} %. Es-tu sûr de tes distances et de tes temps ?`,
      confirmLabel: 'Appliquer quand même',
    });
    if (!ok) return;
  }
  st.appliedId = id;
  saveVmaTestState(st);
  afterVmaTestChange('VMA ajustée (' + vmaTestFmtPct(t.gapPct) + ')');
}

function dismissVmaTest(id) {
  // Garde le test dans l'historique, sans l'appliquer : on ne reproposera pas le choix.
  const st = loadVmaTestState();
  const t = st.tests.find(x => x.id === id);
  if (t) { t.dismissed = true; saveVmaTestState(st); }
  afterVmaTestChange('VMA Allure+ conservée');
}

function clearVmaTestApplied() {
  const st = loadVmaTestState();
  st.appliedId = null;
  saveVmaTestState(st);
  afterVmaTestChange('Retour à la formule standard');
}

async function deleteVmaTest(id) {
  const ok = await showConfirmModal({ title: 'Supprimer ce test ?', message: 'Si ce test est appliqué, la VMA reviendra à la formule standard.', confirmLabel: 'Supprimer', danger: true });
  if (!ok) return;
  const st = loadVmaTestState();
  st.tests = st.tests.filter(x => x.id !== id);
  if (st.appliedId === id) st.appliedId = null;
  saveVmaTestState(st);
  afterVmaTestChange('Test supprimé');
}

function afterVmaTestChange(msg) {
  if (typeof renderProfile === 'function') renderProfile();
  renderVmaTestCard();
  showToast(msg, 'success');
}

function openVmaTestProtocol() {
  const bd = document.createElement('div');
  bd.className = 'confirm-modal-backdrop';
  bd.innerHTML = `
    <div class="confirm-modal vt-protocol">
      <div class="confirm-modal-title">Protocole du test VMA 3'+9'</div>
      <div class="confirm-modal-msg">
        <p class="vt-hint">Sur une piste (ou route plate), en forme, sans vent fort. Prévois environ 1 h 20 au total.</p>
        <ol class="vt-steps">
          <li><strong>Échauffement — 15 min</strong><br>EF tranquille, puis gammes (talons-fesses, montées de genou, pointes de pieds…) en prenant le temps de te replacer entre chaque.</li>
          <li><strong>Mise en place sur la piste</strong><br>Prends ton temps pour être prêt(e) au départ.</li>
          <li><strong>Effort n°1 — 3 min à fond</strong><br>Arrête-toi au repère de piste le plus proche des 3 min et note la distance et le temps réel.</li>
          <li><strong>Récupération — 30 min</strong><br>5 min de marche · 10 min de jogging lent · 5 min de marche · 5 min de jogging lent · 5 min de marche.</li>
          <li><strong>Mise en place sur la piste</strong><br>Reviens à la ligne de départ, bien en place.</li>
          <li><strong>Effort n°2 — 9 min à fond</strong><br>Allure régulière, ne pars pas trop vite. Note la distance et le temps réel au repère le plus proche des 9 min.</li>
          <li><strong>Retour au calme — 10 à 15 min</strong><br>Jogging lent.</li>
        </ol>
        <p class="vt-hint">Ensuite, reviens ici : « J'ai fait le test » pour saisir tes deux distances. Allure+ calcule ta VMA (moyenne des vitesses des deux efforts) et la compare à la sienne.</p>
      </div>
      <div class="confirm-modal-actions">
        <button class="confirm-modal-btn confirm-modal-btn--confirm" id="vt-close">J'ai compris</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('#vt-close').onclick = close;
  attachBackdropClose(bd, close);
}
