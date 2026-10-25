// ═══════════════════════════════════════════════════════════════════════
// PACK D'IMMERSION HALLOWEEN (illustrations SVG en ligne + CSS, aucune image)
// ═══════════════════════════════════════════════════════════════════════
// Direction : gothique et inquiétant plutôt que « mignon » — nuit presque noire,
// manoir éventré aux fenêtres mal éclairées (une silhouette y apparaît), arbres
// tordus et corbeaux, tombes, yeux qui s'allument dans le noir, araignée qui
// descend, toiles, fantôme diaphane, citrouille aux yeux fendus et aux crocs
// irréguliers, vignette sombre et grain. Trois pièces :
//   1. #season-sky    — décor plein écran FIXE derrière le contenu.
//   2. #season-hero   — bandeau « affiche » de la Synthèse (sous l'interrupteur de skin).
//   3. #season-mascot — petite citrouille allumée au pied de la sidebar.
// Styles et animations : css/season_halloween.css (coupées si l'utilisateur a
// demandé de réduire les animations). Branché par themes.js (SEASONS.halloween.pack).
(function () {
  const svg = (vb, body, cls, extra) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${cls || ''}" ${extra || ''} aria-hidden="true" focusable="false">${body}</svg>`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const INK = '#04070F'; // silhouettes

  // Dégradés partagés : UNE seule copie (SVG caché #season-defs), jamais dupliquée.
  const DEFS = `<defs>
    <linearGradient id="hw-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#02030A"/><stop offset=".5" stop-color="#070D24"/>
      <stop offset=".82" stop-color="#0F2342"/><stop offset="1" stop-color="#2B1C12"/>
    </linearGradient>
    <radialGradient id="hw-moon" cx=".4" cy=".38" r=".7"><stop offset="0" stop-color="#FFFBEA"/><stop offset=".7" stop-color="#D5E0F4"/><stop offset="1" stop-color="#8E9FC6"/></radialGradient>
    <radialGradient id="hw-halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#B7C8F0" stop-opacity=".5"/><stop offset="1" stop-color="#B7C8F0" stop-opacity="0"/></radialGradient>
    <radialGradient id="hw-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FF7A1A" stop-opacity=".7"/><stop offset=".55" stop-color="#E04A00" stop-opacity=".2"/><stop offset="1" stop-color="#E04A00" stop-opacity="0"/></radialGradient>
    <radialGradient id="hw-face" cx=".5" cy=".45" r=".62"><stop offset="0" stop-color="#FFEFA8"/><stop offset=".4" stop-color="#FFB02A"/><stop offset=".78" stop-color="#E64A00"/><stop offset="1" stop-color="#9E1C00"/></radialGradient>
    <linearGradient id="hw-pump" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stop-color="#C4540F"/><stop offset=".5" stop-color="#8A3208"/><stop offset="1" stop-color="#40160A"/></linearGradient>
    <radialGradient id="hw-haze" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#5A86C4" stop-opacity=".5"/><stop offset=".6" stop-color="#3A62A0" stop-opacity=".18"/><stop offset="1" stop-color="#3A62A0" stop-opacity="0"/></radialGradient>
    <linearGradient id="hw-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A1328"/><stop offset="1" stop-color="#04070F"/></linearGradient>
    <linearGradient id="hw-fogbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DB4E0" stop-opacity="0"/><stop offset="1" stop-color="#9DB4E0" stop-opacity=".28"/></linearGradient>
  </defs>`;

  // ─── Pièces dessinées ──────────────────────────────────────────────────
  // Chauve-souris (centrée en 0,0) — les ailes battent (CSS .hw-wing).
  const bat = (cls) => `<g class="${cls || ''}"><g class="hw-wing hw-wing--l"><path d="M-1.6-1C-6-6-12-5.5-17-1c3 0 4.5 1.6 6.5 4 1.2-1.8 3-2.8 5-2.2 1 .8 2.2 1.3 3.9.9z" fill="${INK}"/></g><g class="hw-wing hw-wing--r"><path d="M1.6-1C6-6 12-5.5 17-1c-3 0-4.5 1.6-6.5 4-1.2-1.8-3-2.8-5-2.2-1 .8-2.2 1.3-3.9.9z" fill="${INK}"/></g><ellipse cx="0" cy="1" rx="2.4" ry="3.6" fill="${INK}"/><path d="M-2.2-1.8L-2.8-5.4L-.6-2.6M2.2-1.8L2.8-5.4L.6-2.6" fill="${INK}"/></g>`;

  // Citrouille menaçante (≈ 100×92) : corps sombre craquelé, yeux fendus, crocs irréguliers.
  const pumpkin = (cls, glow) => `
    ${glow ? '<ellipse cx="50" cy="52" rx="90" ry="76" fill="url(#hw-glow)" class="hw-halo"/>' : ''}
    <path d="M45 18C42 10 47 3 56 2C54 7 57 10 62 10C60 13 57 15 54 19Z" fill="#26330F"/><path d="M48 18C47 12 50 8 55 6" stroke="#4A5D1E" stroke-width="1.4" fill="none"/>
    <ellipse cx="25" cy="55" rx="24" ry="34" fill="#4F1B05"/><ellipse cx="75" cy="55" rx="24" ry="34" fill="#4F1B05"/>
    <ellipse cx="38" cy="54" rx="24" ry="36" fill="#7A2D08"/><ellipse cx="62" cy="54" rx="24" ry="36" fill="#7A2D08"/>
    <ellipse cx="50" cy="53" rx="23" ry="37" fill="url(#hw-pump)"/>
    <path d="M50 18V89M36 22Q30 54 37 87M64 22Q70 54 63 87M22 31Q13 55 22 79M78 31Q87 55 78 79" stroke="#1E0A02" stroke-width="1.7" fill="none" opacity=".7"/>
    <path d="M30 26L35 31L31 35L37 40M70 25L66 31L71 35" stroke="#1E0A02" stroke-width="1.2" fill="none" opacity=".75"/>
    <g fill="#2B3A12" opacity=".22"><circle cx="20" cy="62" r="3"/><circle cx="82" cy="48" r="2.4"/><circle cx="68" cy="84" r="2"/></g>
    <ellipse cx="50" cy="64" rx="36" ry="30" fill="url(#hw-glow)" opacity=".55"/>
    <g class="${cls || 'hw-face'}" stroke="#220A02" stroke-width="1.3" stroke-linejoin="round">
      <path d="M20 37L47 49L30 55L25 48Z" fill="url(#hw-face)"/><path d="M80 37L53 49L70 55L75 48Z" fill="url(#hw-face)"/>
      <path d="M50 56L43 68L51 65L56 69Z" fill="url(#hw-face)"/>
      <path d="M14 66L22 61L26 72L33 62L38 77L45 65L50 80L55 65L62 77L67 62L74 72L78 61L86 66Q72 93 50 91Q28 93 14 66Z" fill="url(#hw-face)"/>
    </g>
    <path d="M27 83L30 74L34 85ZM43 90L46 80L50 91ZM57 91L60 80L64 90ZM70 84L72 75L76 82Z" fill="#3A1405"/>`;

  // Fenêtre gothique (arche) : allumée (vacille) ou éteinte.
  const arch = (x, y, w, h, fill, cls, d) => `<path ${cls ? `class="${cls}" style="animation-delay:-${d}s"` : ''} d="M${x} ${y + h}V${y + w / 2}Q${x} ${y} ${x + w / 2} ${y}Q${x + w} ${y} ${x + w} ${y + w / 2}V${y + h}Z" fill="${fill}"/>`;
  const lit = (x, y, w, h, d, red) => arch(x, y, w, h, red ? '#FF5A2A' : '#FFB43C', 'hw-win', d);
  const dark = (x, y, w, h) => arch(x, y, w, h, '#0B1124');

  // Manoir éventré : toit troué, tour à flèche de travers, aile affaissée, fenêtres mal éclairées.
  const mansion = (x, y, s, seed) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${INK}">
      <rect x="20" y="70" width="120" height="100"/>
      <path d="M8 76L52 42L60 47L66 31L80 16L98 33L104 26L152 76Z"/>
      <rect x="112" y="28" width="13" height="38"/>
      <path d="M-26 108L2 82L30 108V170H-26Z"/>
      <rect x="148" y="34" width="40" height="136"/><path d="M142 38L168 -46L194 38Z" transform="rotate(4 168 38)"/><path d="M169 -46V-66M163 -60H175" stroke="${INK}" stroke-width="2" transform="rotate(4 168 38)"/>
      <rect x="56" y="138" width="48" height="32" fill="#0A1124"/><path d="M52 138L80 122L108 138Z"/><rect x="58" y="138" width="4" height="32"/><rect x="98" y="138" width="4" height="32"/>
      ${lit(34, 92, 13, 24, seed)}${lit(66, 92, 14, 25, seed + 2)}${dark(100, 92, 13, 24)}
      ${dark(34, 128, 12, 22)}${lit(116, 128, 12, 22, seed + 5)}
      ${lit(160, 58, 14, 24, seed + 3, true)}${dark(160, 100, 14, 24)}${lit(160, 134, 14, 24, seed + 6)}
      ${lit(-12, 122, 11, 20, seed + 4)}
      <g class="hw-figure"><path d="M70 117V108Q70 103 73 103Q76 103 76 108V117Z" fill="${INK}"/><circle cx="73" cy="99" r="3.3" fill="${INK}"/></g>
      <path d="M14 170H-30M130 170H196" stroke="${INK}" stroke-width="6"/>
    </g>`;
  const cottage = (x, y, s, seed) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${INK}">
      <rect x="0" y="40" width="84" height="62"/><path d="M-8 46L40 -4L52 4L58 -6L92 46Z"/><rect x="62" y="6" width="9" height="24"/>
      ${lit(12, 56, 13, 22, seed)}${dark(36, 56, 13, 22)}${lit(60, 56, 13, 22, seed + 3)}${dark(24, 82, 12, 18)}
    </g>`;
  // Corbeau (posé) et arbre mort tordu qui en porte
  const crow = (x, y, s, f) => `<g transform="translate(${x} ${y}) scale(${f ? -s : s} ${s})" fill="${INK}"><g class="hw-crow"><ellipse cx="0" cy="0" rx="9" ry="5"/><circle cx="8" cy="-3.5" r="3.4"/><path d="M10.5-4.2L16-3L10.5-1.8Z"/><path d="M-8-1L-17 4L-16-1Z"/><path d="M-1 4V8M2 4V8" stroke="${INK}" stroke-width="1"/></g></g>`;
  const deadTree = (x, y, s, crows) => `<g transform="translate(${x} ${y}) scale(${s})">
      <g stroke="${INK}" fill="none" stroke-linecap="round">
        <path d="M0 0C-4-24 6-46-2-70C-6-88 4-104 0-122" stroke-width="10"/>
        <path d="M-1-52C-20-60-34-58-48-72M-48-72C-52-82-60-84-66-96M-48-72C-56-70-64-72-72-70" stroke-width="4"/>
        <path d="M0-80C16-88 28-86 42-102M42-102C46-112 56-114 60-126M42-102C52-100 60-102 68-100" stroke-width="4"/>
        <path d="M-2-104C-10-116-8-128-20-140M-2-110C6-122 4-134 14-146" stroke-width="3"/>
      </g>
      ${crows ? crow(-47, -76, .9, true) + crow(41, -106, .8, false) : ''}
    </g>`;
  const tomb = (x, y, s, kind) => `<g transform="translate(${x} ${y}) scale(${s})" fill="#0A1226" stroke="rgba(255,140,40,.22)" stroke-width="1.2">${
    kind === 1 ? '<path d="M0 0V-34Q0-46 11-46Q22-46 22-34V0Z"/><path d="M11-38V-22M5-31H17" stroke="rgba(160,180,220,.25)" fill="none"/>'
    : kind === 2 ? '<path d="M0 0V-26L9-34L18-26V0Z"/>'
    : '<path d="M0 0V-40H8V-30H20V-22H8V0Z"/>'}</g>`;
  const fence = (x, y, n, gap) => `<g transform="translate(${x} ${y})" fill="${INK}">${Array.from({ length: n }, (_, i) => `<path d="M${i * gap} 0V-30L${i * gap + 2.5} -36L${i * gap + 5} -30V0Z"/>`).join('')}<rect x="0" y="-20" width="${n * gap}" height="2.4"/></g>`;
  const lamp = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-1.5" y="-60" width="3" height="60" fill="${INK}"/><rect x="-6" y="-68" width="12" height="12" rx="2" fill="#FFB43C" class="hw-win"/><ellipse cx="0" cy="-62" rx="36" ry="36" fill="url(#hw-glow)" opacity=".55"/></g>`;
  // Yeux qui s'allument dans le noir
  const eyes = (x, y, c, d) => `<g class="hw-eyes" style="animation-delay:-${d}s;color:${c}"><ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.5" fill="${c}"/><ellipse cx="${x + 8}" cy="${y}" rx="2.6" ry="1.5" fill="${c}"/><ellipse cx="${x + 4}" cy="${y}" rx="11" ry="5" fill="${c}" opacity=".18"/></g>`;
  const star = (x, y, r, d) => `<circle class="hw-star" style="animation-delay:-${d}s" cx="${x}" cy="${y}" r="${r}" fill="#E4EBFF"/>`;
  const moon = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r * 2.7}" fill="url(#hw-halo)" class="hw-moon-halo"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#hw-moon)"/>
      <g fill="#8E9FC6" opacity=".5"><circle cx="${cx - r * .3}" cy="${cy - r * .25}" r="${r * .2}"/><circle cx="${cx + r * .35}" cy="${cy + r * .2}" r="${r * .14}"/><circle cx="${cx - r * .05}" cy="${cy + r * .45}" r="${r * .1}"/></g>`;
  const spider = (x, len) => `<g transform="translate(${x} 0)"><g class="hw-spider" style="--len:${len}px"><line x1="0" y1="-300" x2="0" y2="0" stroke="rgba(190,205,235,.55)" stroke-width="1"/><g transform="translate(0 6)" fill="${INK}" stroke="${INK}" stroke-width="1.3"><ellipse cx="0" cy="3" rx="4.6" ry="5.4" stroke="none"/><circle cx="0" cy="-3.6" r="2.8" stroke="none"/><path d="M-4-1L-11-6L-14 0M-4 2L-12 3L-14 9M-3 5L-9 10L-8 14M4-1L11-6L14 0M4 2L12 3L14 9M3 5L9 10L8 14" fill="none"/><circle cx="-1.2" cy="-4" r=".7" fill="#FF3B30" stroke="none"/><circle cx="1.2" cy="-4" r=".7" fill="#FF3B30" stroke="none"/></g></g></g>`;
  const web = (x, y, s, f) => `<g transform="translate(${x} ${y}) scale(${f ? -s : s} ${s})" fill="none" stroke="rgba(200,214,240,.34)" stroke-width=".9"><path d="M0 0H70M0 0L62 30M0 0L44 52M0 0L20 66M0 0V70"/><path d="M16 0Q14 14 0 16M32 0Q28 28 0 32M50 0Q42 44 0 50M66 0Q56 58 0 66"/></g>`;

  // ─── Bandeau « affiche » de la Synthèse ────────────────────────────────
  function heroHtml() {
    const stars = [[40,20,1.1,0],[120,46,.9,2],[210,14,1.2,4],[300,38,.9,1],[420,12,1.1,3],[560,30,.9,5],[690,16,1.2,2],[760,50,.9,6],[940,22,1,1],[980,64,.9,4]].map(a => star(...a)).join('');
    const body = `
      <rect width="1000" height="200" fill="url(#hw-sky)"/>
      ${stars}
      ${moon(852, 56, 28)}
      <g class="hw-cloud hw-cloud--a"><ellipse cx="820" cy="46" rx="70" ry="5" fill="#060B1B" opacity=".85"/><ellipse cx="880" cy="66" rx="60" ry="4" fill="#060B1B" opacity=".8"/></g>
      <g class="hw-cloud hw-cloud--b" opacity=".5"><ellipse cx="330" cy="30" rx="150" ry="10" fill="#101C3E"/></g>
      <ellipse cx="500" cy="150" rx="360" ry="96" fill="url(#hw-haze)"/>
      ${deadTree(52, 200, 1.02, true)}
      ${mansion(332, 44, .86, 1)}${cottage(640, 100, .9, 5)}
      ${deadTree(972, 200, .96, true)}
      <path d="M0 176Q120 168 260 177T520 178T800 175T1000 179V200H0Z" fill="url(#hw-ground)"/>
      ${tomb(236, 184, .9, 1)}${tomb(262, 186, .75, 3)}${tomb(766, 185, .85, 2)}${tomb(792, 187, .7, 1)}
      ${fence(690, 187, 9, 11)}${lamp(318, 186, 1)}
      <ellipse cx="156" cy="188" rx="160" ry="22" fill="url(#hw-glow)" opacity=".5" class="hw-halo"/>
      <g transform="translate(76 26) scale(1.55)">${pumpkin('hw-face', true)}</g>
      <g transform="translate(16 150) scale(.4)">${pumpkin('hw-face hw-face--b', true)}</g>
      <g transform="translate(296 158) scale(.3)">${pumpkin('hw-face hw-face--c', true)}</g>
      ${eyes(528, 190, '#FFD23A', 1)}${eyes(618, 193, '#FF4B2E', 7)}${eyes(876, 192, '#FFD23A', 4)}
      ${web(0, 0, 1.15)}${web(1000, 0, 1, true)}
      ${spider(430, 52)}
      <g class="hw-bat hw-bat--1" transform="translate(0 40)">${bat('hw-bat-body')}</g>
      <g class="hw-bat hw-bat--2" transform="translate(0 92)">${bat('hw-bat-body')}</g>
      <g class="hw-bat hw-bat--3" transform="translate(0 22)">${bat('hw-bat-body')}</g>
      <rect y="132" width="1000" height="68" fill="url(#hw-fogbar)"/>`;
    return `<div id="season-hero" class="season-hero">
      ${svg('0 0 1000 200', body, 'hw-hero-art', 'preserveAspectRatio="xMidYMid slice"')}
      <div class="hw-hero-text"><span class="hw-hero-kicker">Allure+ · 31 octobre</span><b>Nuit d’Halloween</b><span class="hw-hero-sub">Quelque chose court derrière toi… ne ralentis pas.</span></div>
    </div>`;
  }

  // ─── Ciel plein écran (fixe, derrière le contenu) ───────────────────────
  function skyHtml() {
    const stars = Array.from({ length: 40 }, () => star(rnd(0, 1600).toFixed(0), rnd(0, 360).toFixed(0), rnd(.6, 1.4).toFixed(1), rnd(0, 6).toFixed(1))).join('');
    const village = `
      <ellipse cx="800" cy="320" rx="760" ry="130" fill="url(#hw-haze)"/>
      ${deadTree(70, 400, 1.55, true)}${deadTree(255, 400, 1.2, false)}
      ${cottage(300, 266, 1.15, 2)}
      ${mansion(520, 196, 1.28, 5)}${cottage(880, 270, 1.05, 9)}${mansion(1010, 224, 1.05, 3)}
      ${deadTree(1330, 400, 1.3, true)}${deadTree(1500, 400, 1.55, true)}
      <path d="M0 360Q180 350 380 361T760 363T1160 358T1600 363V400H0Z" fill="url(#hw-ground)"/>
      ${tomb(100, 392, 1.2, 1)}${tomb(140, 394, 1, 3)}${tomb(1420, 392, 1.1, 2)}${tomb(1462, 394, 1.2, 1)}${tomb(1560, 393, 1, 3)}
      ${fence(560, 376, 14, 13)}${lamp(470, 376, 1.3)}${lamp(1190, 376, 1.3)}
      <g transform="translate(180 334) scale(.62)">${pumpkin('hw-face hw-face--b', true)}</g>
      <g transform="translate(40 354) scale(.4)">${pumpkin('hw-face hw-face--c', true)}</g>
      <g transform="translate(1370 336) scale(.55)">${pumpkin('hw-face', true)}</g>
      ${eyes(330, 384, '#FFD23A', 2)}${eyes(1010, 388, '#FF4B2E', 6)}${eyes(1250, 386, '#FFD23A', 9)}${eyes(700, 392, '#FFD23A', 4)}`;
    const bats = [
      { top: 14, dur: 34, delay: 0, s: 1.1 }, { top: 26, dur: 44, delay: -12, s: .8 }, { top: 8, dur: 52, delay: -30, s: .7 },
      { top: 38, dur: 40, delay: -20, s: .9 }, { top: 20, dur: 60, delay: -45, s: .6 },
    ].map(b => `<div class="hw-flyer" style="top:${b.top}vh;animation-duration:${b.dur}s;animation-delay:${b.delay}s;--s:${b.s}">${svg('-20 -12 40 24', bat('hw-bat-body'), 'hw-flyer-svg')}</div>`).join('');
    const embers = Array.from({ length: 20 }, () => `<span class="hw-ember" style="left:${rnd(0, 100).toFixed(1)}%;width:${rnd(2, 4).toFixed(1)}px;height:${rnd(2, 4).toFixed(1)}px;animation-duration:${rnd(9, 19).toFixed(1)}s;animation-delay:-${rnd(0, 18).toFixed(1)}s;--sway:${rnd(-40, 40).toFixed(0)}px"></span>`).join('');
    const leaf = c => svg('-9 -10 18 20', `<path d="M0-8C6-6 8 2 0 8C-8 2-6-6 0-8Z" fill="${c}"/><path d="M0-7V8" stroke="rgba(0,0,0,.4)" stroke-width=".9"/>`, 'hw-leaf-svg');
    const leaves = Array.from({ length: 8 }, (_, i) => `<span class="hw-leaf" style="left:${rnd(0, 100).toFixed(1)}%;animation-duration:${rnd(14, 26).toFixed(1)}s;animation-delay:-${rnd(0, 24).toFixed(1)}s;--sway:${rnd(-70, 70).toFixed(0)}px;--rot:${rnd(180, 520).toFixed(0)}deg">${leaf(['#8A3A0C', '#6B2A09', '#A8480F', '#4F1D06'][i % 4])}</span>`).join('');
    const ghost = svg('0 0 60 90', `<path d="M30 4C14 4 6 18 6 34V84L14 76L22 86L30 76L38 86L46 76L54 84V34C54 18 46 4 30 4Z" fill="#CFE0FF"/><ellipse cx="21" cy="32" rx="4.5" ry="7" fill="#02030A"/><ellipse cx="39" cy="32" rx="4.5" ry="7" fill="#02030A"/><ellipse cx="30" cy="50" rx="5" ry="8" fill="#02030A"/>`, 'hw-ghost-svg');
    return `<div id="season-sky" class="season-sky" aria-hidden="true">
      <div class="hw-sky-base"></div>
      ${svg('0 0 1600 360', stars, 'hw-stars', 'preserveAspectRatio="xMidYMin slice"')}
      <div class="hw-moon-wrap">${svg('-100 -100 200 200', moon(0, 0, 38), 'hw-moon-svg')}<i class="hw-moon-cloud"></i></div>
      <div class="hw-clouds"><i class="hw-c hw-c1"></i><i class="hw-c hw-c2"></i><i class="hw-c hw-c3"></i></div>
      ${bats}
      ${svg('0 0 1600 400', village, 'hw-village', 'preserveAspectRatio="xMidYMax slice"')}
      <div class="hw-ghost">${ghost}</div>
      <div class="hw-fog hw-fog--a"></div><div class="hw-fog hw-fog--b"></div>
      <div class="hw-glowfloor"></div>
      <div class="hw-particles">${embers}${leaves}</div>
      <div class="hw-vignette"></div><div class="hw-grain"></div>
    </div>`;
  }

  function mascotHtml() {
    return `<div id="season-mascot" class="season-mascot" aria-hidden="true">${svg('0 0 100 100', pumpkin('hw-face hw-face--m', true), 'hw-mascot-svg')}<span class="hw-mascot-cap">Il te regarde…</span></div>`;
  }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS.halloween = {
    build() {
      this.clear();
      if (document.body) document.body.insertAdjacentHTML('afterbegin', `<svg id="season-defs" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${DEFS}</svg>` + skyHtml());
      // Bandeau juste SOUS l'interrupteur de skin (comme le skin M8) ; à défaut, sous l'en-tête.
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
