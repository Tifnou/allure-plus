// ═══════════════════════════════════════════════════════════════════════
// PACK D'IMMERSION SAINT-VALENTIN (illustrations SVG en ligne + CSS, aucune image)
// ═══════════════════════════════════════════════════════════════════════
// Inspiré d'un « cadre » sur bois clair : tulipes rouges, cœurs à pois, oiseau
// blanc au nœud à pois (avec sa clochette), enveloppe rouge, rubans. Même cadre
// que les packs Halloween et Noël :
//   1. #season-sky    — décor plein écran FIXE derrière le contenu (bois clair,
//                       fanion de cœurs en haut, oiseau sur sa branche, tulipes qui
//                       se balancent, enveloppe, cœurs qui montent, pétales).
//   2. #season-hero   — bandeau « affiche » de la Synthèse (sous l'interrupteur de skin).
//   3. #season-mascot — petit oiseau au nœud à pois au pied de la sidebar.
// Styles et animations : css/season_valentin.css (coupées si « réduire les animations »).
(function () {
  const svg = (vb, body, cls, extra) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${cls || ''}" ${extra || ''} aria-hidden="true" focusable="false">${body}</svg>`;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const DEFS = `<defs>
    <linearGradient id="vl-tulip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF5A78"/><stop offset=".5" stop-color="#D81B45"/><stop offset="1" stop-color="#8F0A26"/></linearGradient>
    <linearGradient id="vl-leaf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2F7D32"/><stop offset="1" stop-color="#58B05B"/></linearGradient>
    <linearGradient id="vl-heart" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4D6D"/><stop offset="1" stop-color="#B3123A"/></linearGradient>
    <linearGradient id="vl-bird" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E4DFD9"/></linearGradient>
    <pattern id="vl-dots" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#D81B45"/><circle cx="4.5" cy="4.5" r="1.9" fill="#fff"/></pattern>
    <pattern id="vl-dots-w" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="#FFFFFF"/><circle cx="4.5" cy="4.5" r="1.9" fill="#D81B45"/></pattern>
    <radialGradient id="vl-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FF7A98" stop-opacity=".45"/><stop offset="1" stop-color="#FF7A98" stop-opacity="0"/></radialGradient>
  </defs>`;

  // ─── Pièces dessinées ──────────────────────────────────────────────────
  // Tulipe (pied en (0,0), fleur à ~120 au-dessus) ; se balance autour de son pied (CSS .vl-sway).
  const tulip = (x, y, s, rot, d, h) => { const H = h || 120; return `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s})"><g class="vl-sway" style="animation-delay:-${d || 0}s">
      <path d="M0 0C-26-28-26-${H * .75}-8-${H * .98}C-4-${H * .62}-2-30 0 0Z" fill="url(#vl-leaf)"/><path d="M0 0C24-24 30-${H * .65} 12-${H * .9}C6-${H * .55} 2-28 0 0Z" fill="#2F7D32" opacity=".9"/>
      <path d="M0 0C-4-${H * .33} 5-${H * .66} 0-${H}" stroke="#3E8E41" stroke-width="4.2" fill="none" stroke-linecap="round"/>
      <g transform="translate(0 -${H})"><path d="M0 2C-19 0-21-26-9-44C-3-34 1-16 0 2Z" fill="#A81029"/><path d="M0 2C19 0 21-26 9-44C3-34-1-16 0 2Z" fill="#B8132F"/>
      <path d="M-14-2C-19-24-8-42 0-49C8-42 19-24 14-2C8 6-8 6-14-2Z" fill="url(#vl-tulip)"/><path d="M-7-30Q-5-40 0-43" stroke="#fff" stroke-width="2" fill="none" opacity=".4" stroke-linecap="round"/></g></g></g>`; };
  // Cœur : 'dots' (rouge à pois blancs, bord cousu), 'white' (blanc à pois rouges), 'solid'.
  const HEART = 'M0 13C-15 2-19-11-10-18C-5-22 0-19 0-14C0-19 5-22 10-18C19-11 15 2 0 13Z';
  const heart = (x, y, s, kind, rot) => `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s})"><path d="${HEART}" fill="${kind === 'white' ? 'url(#vl-dots-w)' : kind === 'solid' ? 'url(#vl-heart)' : 'url(#vl-dots)'}" stroke="${kind === 'white' ? '#D81B45' : '#fff'}" stroke-width="1.4" stroke-dasharray="${kind === 'solid' ? '' : '3 2.2'}"/><path d="M-9-13Q-12-8-9-4" stroke="#fff" stroke-width="1.6" fill="none" opacity=".5" stroke-linecap="round"/></g>`;
  const bow = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s})"><path d="M0 0C-8 14-8 22-4 30L0 20Z" fill="url(#vl-dots)"/><path d="M0 0C8 14 8 22 4 30L0 20Z" fill="url(#vl-dots)"/><ellipse cx="-13" cy="-2" rx="13" ry="8" fill="url(#vl-dots)" transform="rotate(-18 -13 -2)" stroke="#fff" stroke-width="1" stroke-dasharray="3 2"/><ellipse cx="13" cy="-2" rx="13" ry="8" fill="url(#vl-dots)" transform="rotate(18 13 -2)" stroke="#fff" stroke-width="1" stroke-dasharray="3 2"/><circle cx="0" cy="0" r="5" fill="#B3123A"/></g>`;
  // Oiseau blanc au nœud à pois, perché ; la tête dodeline, la clochette se balance.
  const bird = (x, y, s, flip, d) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
      <path d="M-40 6C-20 8 20 8 44 4" stroke="#7A5A44" stroke-width="3.4" fill="none" stroke-linecap="round"/>
      <path d="M-24-4L-44-18L-34-2Z" fill="#DAD4CC"/><path d="M-26-2L-48-10L-33 2Z" fill="#E9E4DE"/>
      <ellipse cx="-2" cy="-18" rx="26" ry="19" fill="url(#vl-bird)"/><path d="M-14-14C-4-30 14-28 16-14C8-8-4-6-14-14Z" fill="#E1DBD4"/>
      <path d="M-6 0V6M8 0V6" stroke="#E08A4A" stroke-width="2" stroke-linecap="round"/>
      <g class="vl-bob"><circle cx="19" cy="-31" r="12" fill="url(#vl-bird)"/><path d="M29-33L38-30L29-27Z" fill="#E8903C"/><circle cx="23" cy="-34" r="2" fill="#2A1A14"/><circle cx="23.6" cy="-34.6" r=".7" fill="#fff"/>${bow(12, -20, .55, 8)}</g>
      <g class="vl-swing" style="animation-delay:-${d || 0}s"><path d="M-14 4V24" stroke="#9A9A9A" stroke-width="1"/><path d="M-20 24Q-14 22-8 24L-10 34H-18Z" fill="#B8B8BE" stroke="#8E8E96" stroke-width=".8"/><circle cx="-14" cy="35" r="1.6" fill="#6E6E76"/></g></g>`;
  const envelope = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s})"><rect x="0" y="0" width="90" height="62" rx="4" fill="#D8294A"/><path d="M0 4L45 38L90 4V0H0Z" fill="#B3123A"/><path d="M0 62L36 30M90 62L54 30" stroke="#A30E32" stroke-width="1.6"/><path d="M2 2L45 36L88 2" stroke="#F06A86" stroke-width="1.4" fill="none"/>
      <g transform="translate(45 38) scale(.8)"><path d="${HEART}" fill="#fff" stroke="#F8C6D0" stroke-width="1.4"/></g><g fill="none" stroke="#fff" stroke-width="1" opacity=".5"><path d="M14 52q4-5 8 0"/><path d="M66 52q4-5 8 0"/></g></g>`;
  const petal = c => svg('-8 -11 16 22', `<path d="M0-10C8-6 8 6 0 10C-8 6-8-6 0-10Z" fill="${c}"/><path d="M0-8V8" stroke="rgba(0,0,0,.18)" stroke-width=".8"/>`, 'vl-petal-svg');
  const plank = (i, w) => `<rect x="${i * w}" y="0" width="${w}" height="200" fill="${['#EDE3DD', '#E4D8D1', '#F0E7E1', '#E7DCD5'][i % 4]}"/><path d="M${i * w} 0V200" stroke="#BFB0A6" stroke-width="1.6" opacity=".7"/>`;

  // ─── Bandeau « affiche » de la Synthèse ────────────────────────────────
  function heroHtml() {
    const planks = Array.from({ length: 9 }, (_, i) => plank(i, 112)).join('');
    const grain = Array.from({ length: 22 }, (_, i) => `<path d="M${(i * 53) % 1000} ${(i * 37) % 190}q${20 + (i % 5) * 9} ${(i % 3) - 1} ${70 + (i % 4) * 20} 0" stroke="#B8A89C" stroke-width="1" fill="none" opacity=".45"/>`).join('');
    const bunting = (() => { let g = '<path d="M-10 6Q250 52 500 12T1010 8" stroke="#8A6A58" stroke-width="1.6" fill="none"/>'; for (let i = 0; i < 12; i++) { const t = (i + .5) / 12, x = -10 + t * 1020, y = 6 + Math.sin(t * Math.PI * 2.1) * 20 + 8; g += `<g class="vl-swing" style="animation-delay:-${(i * .55) % 4}s;transform-origin:${x}px ${y}px">${heart(x, y + 14, .9, i % 3 === 0 ? 'white' : i % 3 === 1 ? 'dots' : 'solid')}</g>`; } return g; })();
    const body = `${planks}${grain}
      <ellipse cx="260" cy="120" rx="300" ry="110" fill="url(#vl-glow)"/>
      ${bunting}
      ${tulip(36, 214, 1.05, -6, 0)}${tulip(78, 214, 1.15, 2, 1.1)}${tulip(120, 214, .95, 9, 2.2)}${tulip(160, 214, 1.1, 14, .6)}${tulip(1000, 214, 1.1, 6, 1.4)}${tulip(962, 214, 1, -8, 2.6)}
      ${heart(300, 150, 3.4, 'dots', -8)}${heart(372, 176, 1.4, 'white', 10)}${heart(244, 182, 1.1, 'solid', -12)}
      ${bird(300, 90, 1.5, false, 0)}
      ${envelope(470, 120, .9, -6)}${heart(520, 112, 1, 'solid', 8)}
      <path d="M552 120q14-26 28-6M610 150q10-20 22-6" stroke="#D81B45" stroke-width="1.4" fill="none" opacity=".5" stroke-linecap="round"/>`;
    return `<div id="season-hero" class="season-hero">
      ${svg('0 0 1000 200', body, 'vl-hero-art', 'preserveAspectRatio="xMidYMid slice"')}
      <div class="vl-hero-text"><span class="vl-hero-kicker">Allure+ · 14 février</span><b>Joyeuse Saint-Valentin</b><span class="vl-hero-sub">Cours avec le cœur… mais garde du souffle.</span></div>
    </div>`;
  }

  // ─── Décor plein écran (fixe, derrière le contenu) ──────────────────────
  function skyHtml() {
    const top = (() => { let g = '<path d="M-10 8Q200 70 420 20T820 24T1240 16T1610 10" stroke="#8A6A58" stroke-width="1.8" fill="none"/>'; for (let i = 0; i < 20; i++) { const t = (i + .5) / 20, x = -10 + t * 1620, y = 12 + Math.sin(t * Math.PI * 4.2) * 14 + 22 * Math.sin(t * Math.PI); g += `<g class="vl-swing" style="animation-delay:-${(i * .6) % 4.5}s;transform-origin:${x.toFixed(0)}px ${y.toFixed(0)}px">${heart(x.toFixed(0), (y + 18).toFixed(0), 1.15, ['dots', 'white', 'solid'][i % 3], (i % 2 ? 4 : -4))}</g>`; } return g; })();
    const bottom = `
      ${[0, 1, 2, 3, 4].map(i => tulip(70 + i * 46, 306, .95 + (i % 3) * .12, -14 + i * 7, i * .8, 104 + (i % 3) * 18)).join('')}
      ${[0, 1, 2, 3, 4, 5].map(i => tulip(1380 + i * 40, 306, 1 + (i % 3) * .1, -8 + i * 5, i * .9 + .4, 100 + (i % 3) * 20)).join('')}
      ${heart(300, 280, 1.6, 'dots', -10)}${heart(344, 292, 1, 'white', 8)}${bow(1290, 286, 1.2, -8)}
      ${envelope(1180, 244, .85, 7)}${heart(1230, 236, 1.1, 'solid', -6)}`;
    const birdLayer = `${bird(1460, 150, 1.5, true, 0)}${bird(150, 148, 1.1, false, 1.8)}`;
    const rise = Array.from({ length: 16 }, () => { const s = rnd(14, 30); return `<span class="vl-rise" style="left:${rnd(0, 100).toFixed(1)}%;width:${s.toFixed(0)}px;animation-duration:${rnd(11, 22).toFixed(1)}s;animation-delay:-${rnd(0, 20).toFixed(1)}s;--sway:${rnd(-45, 45).toFixed(0)}px;opacity:${rnd(.35, .75).toFixed(2)}">${svg('-22 -24 44 40', `<path d="${HEART}" transform="scale(1.7) translate(0 -1)" fill="${['#FF5A78', '#E11D48', '#FF9AB0', '#FFFFFF'][Math.floor(rnd(0, 4))]}"/>`, 'vl-rise-svg')}</span>`; }).join('');
    const petals = Array.from({ length: 10 }, (_, i) => `<span class="vl-petal" style="left:${rnd(0, 100).toFixed(1)}%;animation-duration:${rnd(13, 24).toFixed(1)}s;animation-delay:-${rnd(0, 22).toFixed(1)}s;--sway:${rnd(-70, 70).toFixed(0)}px;--rot:${rnd(200, 520).toFixed(0)}deg">${petal(['#D81B45', '#B8132F', '#F0405D'][i % 3])}</span>`).join('');
    const sparks = Array.from({ length: 12 }, () => `<i class="vl-spark" style="left:${rnd(0, 100).toFixed(1)}%;top:${rnd(4, 92).toFixed(1)}%;animation-delay:-${rnd(0, 5).toFixed(1)}s;animation-duration:${rnd(2.4, 5).toFixed(1)}s"></i>`).join('');
    return `<div id="season-sky" class="season-sky vl-sky" aria-hidden="true">
      <div class="vl-wood"></div><div class="vl-warm"></div>
      ${svg('0 0 1600 220', top, 'vl-top', 'preserveAspectRatio="xMidYMin slice"')}
      ${svg('0 0 1600 320', birdLayer, 'vl-birds', 'preserveAspectRatio="xMidYMin slice"')}
      ${svg('0 0 1600 320', bottom, 'vl-bottom', 'preserveAspectRatio="xMidYMax slice"')}
      <div class="vl-particles">${rise}${petals}${sparks}</div>
      <div class="vl-vignette"></div>
    </div>`;
  }

  function mascotHtml() {
    return `<div id="season-mascot" class="season-mascot" aria-hidden="true">${svg('-52 -52 104 96', bird(0, 6, 1, false, 0), 'vl-mascot-svg')}<span class="vl-mascot-cap">Un petit mot doux ?</span></div>`;
  }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS['saint-valentin'] = {
    build() {
      this.clear();
      if (document.body) document.body.insertAdjacentHTML('afterbegin', `<svg id="season-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${DEFS}</svg>` + skyHtml());
      const dash = document.getElementById('skin-toggle') || document.querySelector('#page-dashboard .page-header');
      if (dash) dash.insertAdjacentHTML('afterend', heroHtml());
      const footer = document.querySelector('.sidebar-footer');
      if (footer) footer.insertAdjacentHTML('afterbegin', mascotHtml());
    },
    clear() {
      ['season-defs', 'season-sky', 'season-hero', 'season-mascot'].forEach(id => document.getElementById(id)?.remove());
    },
  };
})();
