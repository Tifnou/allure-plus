// ═══════════════════════════════════════════════════════════════════════
// PACK D'IMMERSION HALLOWEEN (illustrations SVG en ligne + CSS, aucune image)
// ═══════════════════════════════════════════════════════════════════════
// Inspiré d'une illustration « nuit bleue, citrouille géante lumineuse, village
// aux fenêtres allumées, lune, chauves-souris, brume ». Trois pièces :
//   1. #season-sky    — décor plein écran FIXE derrière le contenu : ciel, étoiles,
//                       lune, nuages, village, chauves-souris, brume, braises, feuilles.
//   2. #season-hero   — bandeau « affiche » en haut de la Synthèse (citrouille géante).
//   3. #season-mascot — petite citrouille allumée au pied de la sidebar.
// Styles et animations : css/season_halloween.css (coupées si l'utilisateur a
// demandé de réduire les animations). Branché par themes.js (SEASONS.halloween.pack).
(function () {
  const svg = (vb, body, cls, extra) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${cls || ''}" ${extra || ''} aria-hidden="true" focusable="false">${body}</svg>`;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Dégradés partagés (ids préfixés hw- : plusieurs SVG de la page les référencent)
  const DEFS = `<defs>
    <linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#050813"/><stop offset=".5" stop-color="#0B1838"/>
      <stop offset=".82" stop-color="#16345A"/><stop offset="1" stop-color="#4A3015"/>
    </linearGradient>
    <radialGradient id="hw-moon" cx=".4" cy=".38" r=".7"><stop offset="0" stop-color="#FFFDF0"/><stop offset=".7" stop-color="#DCE8FF"/><stop offset="1" stop-color="#A9BDE8"/></radialGradient>
    <radialGradient id="hw-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#BFD4FF" stop-opacity=".55"/><stop offset="1" stop-color="#BFD4FF" stop-opacity="0"/></radialGradient>
    <radialGradient id="hw-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FF9A2E" stop-opacity=".75"/><stop offset=".55" stop-color="#FF7A12" stop-opacity=".22"/><stop offset="1" stop-color="#FF7A12" stop-opacity="0"/></radialGradient>
    <radialGradient id="hw-face" cx=".5" cy=".5" r=".6"><stop offset="0" stop-color="#FFF3A6"/><stop offset=".55" stop-color="#FFC13A"/><stop offset="1" stop-color="#FF8A1F"/></radialGradient>
    <linearGradient id="hw-pump" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF9B3D"/><stop offset=".55" stop-color="#E9620F"/><stop offset="1" stop-color="#A8400B"/></linearGradient>
    <linearGradient id="hw-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E1B38"/><stop offset="1" stop-color="#070C1B"/></linearGradient>
  </defs>`;

  // ─── Pièces dessinées ──────────────────────────────────────────────────
  // Chauve-souris (centrée en 0,0, ~30 unités de large) — les ailes battent (CSS .hw-wing).
  const bat = (cls) => `<g class="${cls || ''}"><g class="hw-wing hw-wing--l"><path d="M-1.6-1C-6-6-12-5.5-17-1c3 0 4.5 1.6 6.5 4 1.2-1.8 3-2.8 5-2.2 1 .8 2.2 1.3 3.9.9z" fill="#04060F"/></g><g class="hw-wing hw-wing--r"><path d="M1.6-1C6-6 12-5.5 17-1c-3 0-4.5 1.6-6.5 4-1.2-1.8-3-2.8-5-2.2-1 .8-2.2 1.3-3.9.9z" fill="#04060F"/></g><ellipse cx="0" cy="1" rx="2.4" ry="3.6" fill="#04060F"/><path d="M-2.2-1.8L-2.8-5.4L-.6-2.6M2.2-1.8L2.8-5.4L.6-2.6" fill="#04060F"/></g>`;

  // Citrouille lumineuse (≈ 100×92). `cls` pilote le vacillement ; `glow` ajoute le halo.
  const pumpkin = (cls, glow) => `
    ${glow ? '<ellipse cx="50" cy="50" rx="86" ry="74" fill="url(#hw-glow)" class="hw-halo"/>' : ''}
    <path d="M46 14C46 6 52 2 60 2C58 8 60 12 63 15Z" fill="#3E5A1D"/><path d="M50 15C50 9 54 6 58 5" stroke="#6C8F2E" stroke-width="1.6" fill="none"/>
    <ellipse cx="26" cy="54" rx="24" ry="34" fill="#9A3A0A"/><ellipse cx="74" cy="54" rx="24" ry="34" fill="#9A3A0A"/>
    <ellipse cx="38" cy="53" rx="24" ry="36" fill="#C9500C"/><ellipse cx="62" cy="53" rx="24" ry="36" fill="#C9500C"/>
    <ellipse cx="50" cy="52" rx="23" ry="37" fill="url(#hw-pump)"/>
    <path d="M50 17V88M36 21Q30 54 37 86M64 21Q70 54 63 86M23 30Q14 54 23 78M77 30Q86 54 77 78" stroke="#8E3508" stroke-width="1.6" fill="none" opacity=".55"/>
    <path d="M30 28Q40 20 50 20" stroke="#FFC27A" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round"/>
    <g class="${cls || 'hw-face'}">
      <path d="M26 44L41 50L28 58Z" fill="url(#hw-face)"/><path d="M74 44L59 50L72 58Z" fill="url(#hw-face)"/>
      <path d="M50 56L44 66H56Z" fill="url(#hw-face)"/>
      <path d="M24 70Q34 86 50 79Q66 86 76 70Q66 76 60 72L56 78L50 73L44 78L40 72Q34 76 24 70Z" fill="url(#hw-face)"/>
    </g>`;

  // Maison hantée : corps, toits à pignon, tour à flèche, cheminée, fenêtres qui vacillent.
  const win = (x, y, w, h, d) => `<rect class="hw-win" style="animation-delay:-${d}s" x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="#FFB43C"/>`;
  const house = (x, y, s, seed) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#070D1F">
      <rect x="0" y="40" width="112" height="90"/>
      <path d="M-8 44L56 -4L120 44Z"/><rect x="82" y="8" width="9" height="26"/>
      <rect x="124" y="14" width="38" height="116"/><path d="M118 18L143 -48L168 18Z"/><rect x="141" y="-64" width="3" height="18"/>
      <path d="M0 130h162v6H0z"/>
      ${win(14, 62, 15, 21, seed)}${win(48, 62, 15, 21, seed + 3)}${win(82, 62, 15, 21, seed + 6)}
      ${win(14, 98, 15, 21, seed + 2)}${win(82, 98, 15, 21, seed + 5)}
      ${win(133, 36, 12, 17, seed + 4)}${win(133, 74, 12, 17, seed + 1)}
      <path d="M50 108h14v22H50z" fill="#FFB43C" class="hw-win" style="animation-delay:-${seed + 7}s"/>
    </g>`;
  const smallHouse = (x, y, s, seed) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#070D1F">
      <rect x="0" y="36" width="84" height="64"/><path d="M-6 40L42 -2L90 40Z"/><rect x="60" y="6" width="8" height="20"/>
      ${win(12, 52, 13, 18, seed)}${win(36, 52, 13, 18, seed + 2)}${win(60, 52, 13, 18, seed + 4)}${win(24, 78, 13, 18, seed + 1)}
    </g>`;
  // Arbre mort et arbre d'automne (feuillage orange)
  const deadTree = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#050A18" fill="none" stroke-linecap="round">
      <path d="M0 0C-2-30 4-60 0-100" stroke-width="9"/><path d="M0-60C-20-72-34-70-46-84M0-70C18-82 30-80 44-96M-2-90C-10-104-8-116-18-128M2-96C10-110 8-122 20-132M-26-76C-30-90-40-92-46-100" stroke-width="3.4"/>
    </g>`;
  const fallTree = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M0 0C-3-28 4-56 0-86" stroke="#050A18" stroke-width="9" fill="none" stroke-linecap="round"/>
      <g class="hw-leaves"><circle cx="-10" cy="-96" r="26" fill="#B8420C"/><circle cx="20" cy="-104" r="28" fill="#D9660F"/><circle cx="-34" cy="-76" r="20" fill="#C9500C"/><circle cx="40" cy="-80" r="22" fill="#E8791A"/><circle cx="6" cy="-120" r="20" fill="#F2931E"/><circle cx="-14" cy="-80" r="22" fill="#9A3A0A"/></g>
      <ellipse cx="4" cy="-96" rx="64" ry="50" fill="url(#hw-glow)" opacity=".45"/>
    </g>`;
  const lamp = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-1.5" y="-60" width="3" height="60" fill="#050A18"/><rect x="-6" y="-68" width="12" height="12" rx="2" fill="#FFCB5A" class="hw-win"/><ellipse cx="0" cy="-62" rx="34" ry="34" fill="url(#hw-glow)" opacity=".7"/></g>`;
  const fence = (x, y, n, gap) => `<g transform="translate(${x} ${y})" fill="#050A18">${Array.from({ length: n }, (_, i) => `<path d="M${i * gap} 0V-26L${i * gap + 2.5} -30L${i * gap + 5} -26V0Z"/>`).join('')}<rect x="0" y="-18" width="${n * gap}" height="2.6"/></g>`;
  const star = (x, y, r, d) => `<circle class="hw-star" style="animation-delay:-${d}s" cx="${x}" cy="${y}" r="${r}" fill="#EAF0FF"/>`;
  const moon = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r * 2.6}" fill="url(#hw-halo)" class="hw-moon-halo"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#hw-moon)"/>
      <g fill="#B9C9EE" opacity=".5"><circle cx="${cx - r * .3}" cy="${cy - r * .25}" r="${r * .2}"/><circle cx="${cx + r * .35}" cy="${cy + r * .2}" r="${r * .14}"/><circle cx="${cx - r * .05}" cy="${cy + r * .45}" r="${r * .1}"/></g>`;

  // ─── Bandeau « affiche » de la Synthèse ────────────────────────────────
  function heroHtml() {
    const stars = [[40,20,1.2,0],[120,46,1,2],[210,14,1.3,4],[300,38,1,1],[420,12,1.2,3],[560,30,1,5],[690,16,1.3,2],[760,50,1,6],[940,22,1.1,1],[980,64,1,4]].map(a => star(...a)).join('');
    const body = `
      <rect width="1000" height="200" fill="url(#hw-sky)"/>
      ${stars}
      ${moon(850, 54, 26)}
      <g class="hw-cloud hw-cloud--a" opacity=".5"><ellipse cx="620" cy="64" rx="150" ry="14" fill="#1B2F5C"/><ellipse cx="700" cy="76" rx="120" ry="10" fill="#223A6B"/></g>
      <g class="hw-cloud hw-cloud--b" opacity=".4"><ellipse cx="280" cy="36" rx="130" ry="11" fill="#1B2F5C"/></g>
      ${deadTree(46, 200, 1)}
      ${house(360, 56, .92, 1)}${smallHouse(560, 100, .86, 4)}${house(660, 70, .78, 8)}
      ${fallTree(1012, 200, 1.0)}
      <path d="M0 176Q120 168 260 176T520 178T800 174T1000 178V200H0Z" fill="url(#hw-ground)"/>
      ${fence(690, 184, 9, 11)}
      ${lamp(330, 184, 1)}
      <ellipse cx="150" cy="186" rx="150" ry="20" fill="url(#hw-glow)" opacity=".55" class="hw-halo"/>
      <g transform="translate(78 28) scale(1.5)">${pumpkin('hw-face', true)}</g>
      <g transform="translate(18 148) scale(.42)">${pumpkin('hw-face hw-face--b', true)}</g>
      <g transform="translate(290 156) scale(.34)">${pumpkin('hw-face hw-face--c', true)}</g>
      <g class="hw-bat hw-bat--1" transform="translate(0 40)">${bat('hw-bat-body')}</g>
      <g class="hw-bat hw-bat--2" transform="translate(0 92)">${bat('hw-bat-body')}</g>
      <g class="hw-bat hw-bat--3" transform="translate(0 22)">${bat('hw-bat-body')}</g>`;
    return `<div id="season-hero" class="season-hero">
      ${svg('0 0 1000 200', body, 'hw-hero-art', 'preserveAspectRatio="xMidYMid slice"')}
      <div class="hw-hero-text"><span class="hw-hero-kicker">Allure+ · 31 octobre</span><b>Nuit d’Halloween</b><span class="hw-hero-sub">Les sentiers sont hantés… ton allure, elle, reste sage.</span></div>
    </div>`;
  }

  // ─── Ciel plein écran (fixe, derrière le contenu) ───────────────────────
  function skyHtml() {
    const stars = Array.from({ length: 46 }, () => star(rnd(0, 1600).toFixed(0), rnd(0, 360).toFixed(0), rnd(.7, 1.6).toFixed(1), rnd(0, 6).toFixed(1))).join('');
    const village = `
      ${fallTree(60, 400, 1.35)}${deadTree(250, 400, 1.3)}
      ${smallHouse(300, 238, 1.2, 2)}
      ${house(520, 200, 1.3, 5)}${smallHouse(870, 252, 1.1, 9)}${house(1010, 214, 1.15, 3)}
      ${deadTree(1330, 400, 1.2)}${fallTree(1500, 400, 1.3)}
      <path d="M0 360Q180 350 380 360T760 362T1160 358T1600 362V400H0Z" fill="url(#hw-ground)"/>
      ${fence(560, 372, 14, 13)}${lamp(470, 372, 1.3)}${lamp(1190, 372, 1.3)}
      <g transform="translate(150 336) scale(.62)">${pumpkin('hw-face hw-face--b', true)}</g>
      <g transform="translate(40 352) scale(.4)">${pumpkin('hw-face hw-face--c', true)}</g>
      <g transform="translate(1390 338) scale(.55)">${pumpkin('hw-face', true)}</g>
      <g transform="translate(1520 356) scale(.36)">${pumpkin('hw-face hw-face--b', true)}</g>`;
    const bats = [
      { top: 14, dur: 34, delay: 0, s: 1.1 }, { top: 26, dur: 44, delay: -12, s: .8 }, { top: 8, dur: 52, delay: -30, s: .7 },
      { top: 38, dur: 40, delay: -20, s: .9 }, { top: 20, dur: 60, delay: -45, s: .6 },
    ].map((b, i) => `<div class="hw-flyer" style="top:${b.top}vh;animation-duration:${b.dur}s;animation-delay:${b.delay}s;--s:${b.s}">${svg('-20 -12 40 24', bat('hw-bat-body'), 'hw-flyer-svg')}</div>`).join('');
    const embers = Array.from({ length: 22 }, () => `<span class="hw-ember" style="left:${rnd(0, 100).toFixed(1)}%;width:${rnd(2, 4.5).toFixed(1)}px;height:${rnd(2, 4.5).toFixed(1)}px;animation-duration:${rnd(9, 19).toFixed(1)}s;animation-delay:-${rnd(0, 18).toFixed(1)}s;--sway:${rnd(-40, 40).toFixed(0)}px"></span>`).join('');
    const leaf = c => svg('-9 -10 18 20', `<path d="M0-8C6-6 8 2 0 8C-8 2-6-6 0-8Z" fill="${c}"/><path d="M0-7V8" stroke="rgba(0,0,0,.35)" stroke-width=".9"/>`, 'hw-leaf-svg');
    const leaves = Array.from({ length: 9 }, (_, i) => `<span class="hw-leaf" style="left:${rnd(0, 100).toFixed(1)}%;animation-duration:${rnd(14, 26).toFixed(1)}s;animation-delay:-${rnd(0, 24).toFixed(1)}s;--sway:${rnd(-70, 70).toFixed(0)}px;--rot:${rnd(180, 520).toFixed(0)}deg">${leaf(['#D9660F', '#B8420C', '#F2931E', '#9A3A0A'][i % 4])}</span>`).join('');
    return `<div id="season-sky" class="season-sky" aria-hidden="true">
      <div class="hw-sky-base"></div>
      ${svg('0 0 1600 360', stars, 'hw-stars', 'preserveAspectRatio="xMidYMin slice"')}
      <div class="hw-moon-wrap">${svg('-100 -100 200 200', moon(0, 0, 38), 'hw-moon-svg')}</div>
      <div class="hw-clouds"><i class="hw-c hw-c1"></i><i class="hw-c hw-c2"></i><i class="hw-c hw-c3"></i></div>
      ${bats}
      ${svg('0 0 1600 400', village, 'hw-village', 'preserveAspectRatio="xMidYMax slice"')}
      <div class="hw-fog hw-fog--a"></div><div class="hw-fog hw-fog--b"></div>
      <div class="hw-glowfloor"></div>
      <div class="hw-particles">${embers}${leaves}</div>
    </div>`;
  }

  function mascotHtml() {
    return `<div id="season-mascot" class="season-mascot" aria-hidden="true">${svg('0 0 100 100', pumpkin('hw-face hw-face--m', true), 'hw-mascot-svg')}<span class="hw-mascot-cap">Bonne chasse !</span></div>`;
  }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS.halloween = {
    build() {
      this.clear();
      if (document.body) document.body.insertAdjacentHTML('afterbegin', `<svg id="season-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${DEFS}</svg>` + skyHtml());
      const dash = document.querySelector('#page-dashboard .page-header');
      if (dash) dash.insertAdjacentHTML('afterend', heroHtml());
      const footer = document.querySelector('.sidebar-footer');
      if (footer) footer.insertAdjacentHTML('afterbegin', mascotHtml());
    },
    clear() {
      ['season-defs', 'season-sky', 'season-hero', 'season-mascot'].forEach(id => document.getElementById(id)?.remove());
    },
  };
})();
