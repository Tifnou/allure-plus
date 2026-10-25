// ═══════════════════════════════════════════════════════════════════════
// PACK D'IMMERSION NOËL (illustrations SVG en ligne + CSS, aucune image)
// ═══════════════════════════════════════════════════════════════════════
// Inspiré d'un « cadre » de décorations sur une table en bois chaud : branches de
// sapin et baies, boules rayées, étoiles écossaises, pain d'épices, cannes en
// sucre, cadeaux, guirlande lumineuse. Même cadre que le pack Halloween :
//   1. #season-sky    — décor plein écran FIXE derrière le contenu (bois, guirlande
//                       en haut avec boules qui se balancent, ampoules qui clignotent,
//                       neige, étincelles, cadeaux et friandises en bas).
//   2. #season-hero   — bandeau « affiche » de la Synthèse (sous l'interrupteur de skin).
//   3. #season-mascot — petit sapin illuminé au pied de la sidebar.
// Styles et animations : css/season_noel.css (coupées si « réduire les animations »).
(function () {
  const svg = (vb, body, cls, extra) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${cls || ''}" ${extra || ''} aria-hidden="true" focusable="false">${body}</svg>`;
  const rnd = (a, b) => a + Math.random() * (b - a);
  // Générateur déterministe : les branches ont toujours le même dessin d'un chargement à l'autre.
  const mk = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const DEFS = `<defs>
    <radialGradient id="nx-red" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FF6B6B"/><stop offset=".55" stop-color="#C4161C"/><stop offset="1" stop-color="#6E0A10"/></radialGradient>
    <radialGradient id="nx-gold" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#FFF1B0"/><stop offset=".55" stop-color="#E0A92E"/><stop offset="1" stop-color="#8A5C0E"/></radialGradient>
    <radialGradient id="nx-green" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#7FE0A0"/><stop offset=".55" stop-color="#1F8A4C"/><stop offset="1" stop-color="#0B4526"/></radialGradient>
    <radialGradient id="nx-blue" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#9DC8FF"/><stop offset=".55" stop-color="#2F6FD0"/><stop offset="1" stop-color="#12306B"/></radialGradient>
    <pattern id="nx-stripes" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(40)"><rect width="9" height="9" fill="#F7F3EA"/><rect width="4.5" height="9" fill="#C4161C"/></pattern>
    <pattern id="nx-plaid" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#B3141B"/><rect y="3" width="8" height="2" fill="#5E0A10" opacity=".7"/><rect x="3" width="2" height="8" fill="#5E0A10" opacity=".7"/><rect y="0" width="8" height="1" fill="#fff" opacity=".35"/></pattern>
    <radialGradient id="nx-flame" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#FFF8C8"/><stop offset=".5" stop-color="#FFC24A"/><stop offset="1" stop-color="#FF7A1A" stop-opacity="0"/></radialGradient>
    <radialGradient id="nx-lightglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".75"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient>
    <linearGradient id="nx-wood" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3A2013"/><stop offset=".5" stop-color="#4A2A18"/><stop offset="1" stop-color="#34190E"/></linearGradient>
  </defs>`;

  // ─── Pièces dessinées ──────────────────────────────────────────────────
  // Branche de sapin horizontale partant de (0,0) vers la droite (aiguilles en 3 verts).
  function branch(len, seed, thick) {
    const r = mk(seed), greens = ['#164A28', '#1F6B38', '#2C8A48', '#103A20'], n = Math.floor(len / 5);
    let g = `<path d="M0 0Q${len * .5} -5 ${len} 2" stroke="#3B2414" stroke-width="${thick || 3.2}" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < n; i++) {
      const x = i * len / n, y = 2 * (x / len) - 3 * Math.sin(x / len * Math.PI) * 0.6, taper = 1 - .45 * x / len;
      for (const sg of [-1, 1]) {
        const L = (14 + r() * 9) * taper, dx = 5 + r() * 6;
        g += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${(x + dx).toFixed(1)} ${(y + sg * L).toFixed(1)}" stroke="${greens[Math.floor(r() * 4)]}" stroke-width="${(2 + r() * .8).toFixed(1)}" stroke-linecap="round"/>`;
      }
    }
    return g;
  }
  const berries = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s || 1})"><circle cx="0" cy="0" r="4.6" fill="url(#nx-red)"/><circle cx="8" cy="3" r="4.2" fill="url(#nx-red)"/><circle cx="-6" cy="6" r="4" fill="url(#nx-red)"/><g fill="#fff" opacity=".7"><circle cx="-1.4" cy="-1.6" r="1.1"/><circle cx="6.8" cy="1.4" r="1"/><circle cx="-7.2" cy="4.4" r="1"/></g></g>`;
  const pinecone = (x, y, s, rot) => { let sc = ''; for (let row = 0; row < 7; row++) for (let c = -2; c <= 2; c++) { if (Math.abs(c) > 2 - (row > 4 ? 1 : 0)) continue; sc += `<path d="M${c * 6 - 3} ${row * 6}Q${c * 6} ${row * 6 + 7} ${c * 6 + 3} ${row * 6}" fill="${(row + c) % 2 ? '#7A4A24' : '#5C3418'}" stroke="#2B170A" stroke-width=".7"/>`; } return `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s || 1})"><ellipse cx="0" cy="18" rx="14" ry="22" fill="#4A2A14"/>${sc}</g>`; };
  // Boule suspendue : se balance autour de son crochet (CSS .nx-swing).
  const ball = (x, y, len, r, kind, d) => `<g class="nx-swing" style="animation-delay:-${d}s"><path d="M${x} ${y}V${y + len}" stroke="#E6D08A" stroke-width="1.2"/><rect x="${x - r * .3}" y="${y + len - 3}" width="${r * .6}" height="6" rx="1.5" fill="#D9B24A"/>
      <circle cx="${x}" cy="${y + len + r}" r="${r}" fill="${kind === 'stripes' ? 'url(#nx-stripes)' : `url(#nx-${kind})`}"/><circle cx="${x}" cy="${y + len + r}" r="${r}" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>
      <ellipse cx="${x - r * .35}" cy="${y + len + r * .6}" rx="${r * .26}" ry="${r * .15}" fill="#fff" opacity=".7" transform="rotate(-30 ${x - r * .35} ${y + len + r * .6})"/></g>`;
  const starOrn = (x, y, len, r, d) => `<g class="nx-swing" style="animation-delay:-${d}s"><path d="M${x} ${y}V${y + len}" stroke="#E6D08A" stroke-width="1.2"/><path transform="translate(${x} ${y + len + r}) scale(${r / 20})" d="M0-20L5.9-6.9L20-6.2L9.5 3.1L12.4 17.2L0 10L-12.4 17.2L-9.5 3.1L-20-6.2L-5.9-6.9Z" fill="url(#nx-plaid)" stroke="#E6D08A" stroke-width="1.6" stroke-linejoin="round"/><path transform="translate(${x} ${y + len + r}) scale(${r / 20})" d="M0-8V8M-7-4L7 4M-7 4L7-4" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></g>`;
  const gift = (x, y, w, h, c1, c2, rib) => `<g transform="translate(${x} ${y})"><rect x="0" y="${-h}" width="${w}" height="${h}" rx="2" fill="${c1}"/><rect x="0" y="${-h}" width="${w}" height="${h * .22}" rx="2" fill="${c2}" opacity=".5"/>
      <rect x="${w / 2 - 4}" y="${-h}" width="8" height="${h}" fill="${rib}"/><rect x="0" y="${-h / 2 - 4}" width="${w}" height="8" fill="${rib}" opacity=".95"/>
      <g transform="translate(${w / 2} ${-h})"><ellipse cx="-9" cy="-5" rx="10" ry="6" fill="${rib}" transform="rotate(-24 -9 -5)"/><ellipse cx="9" cy="-5" rx="10" ry="6" fill="${rib}" transform="rotate(24 9 -5)"/><circle cx="0" cy="-2" r="4" fill="${rib}"/><circle cx="0" cy="-2" r="4" fill="rgba(0,0,0,.18)"/></g></g>`;
  const cane = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s || 1})" fill="none" stroke-linecap="round"><path d="M0 0V-52Q0-70 15-70Q30-70 30-54" stroke="#F7F3EA" stroke-width="9"/><path d="M0 0V-52Q0-70 15-70Q30-70 30-54" stroke="#C4161C" stroke-width="9" stroke-dasharray="6 7"/></g>`;
  const ginger = (x, y, s, rot) => `<g transform="translate(${x} ${y}) rotate(${rot || 0}) scale(${s || 1})"><path d="M0-30C-9-30-12-22-9-16L-22-13L-21-3L-11-6L-15 14L-7 14L0 4L7 14L15 14L11-6L21-3L22-13L9-16C12-22 9-30 0-30Z" fill="#C98A4B" stroke="#8A5524" stroke-width="1.2"/>
      <path d="M-20-6Q-14-9-8-6M20-6Q14-9 8-6M-12 10Q-6 6-2 11M12 10Q6 6 2 11" stroke="#FFF6E0" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="-3.5" cy="-24" r="1.5" fill="#3A2010"/><circle cx="3.5" cy="-24" r="1.5" fill="#3A2010"/><path d="M-3-19Q0-16 3-19" stroke="#FFF6E0" stroke-width="1.4" fill="none"/><circle cx="0" cy="-8" r="2.2" fill="#C4161C"/><circle cx="0" cy="-1" r="2.2" fill="#2E8A4C"/></g>`;
  const poinsettia = (x, y, s) => { let p = ''; for (let i = 0; i < 8; i++) p += `<path d="M0 0C-10-14-8-30 0-44C8-30 10-14 0 0Z" fill="${i % 2 ? '#D41A24' : '#B3141B'}" transform="rotate(${i * 45})"/>`; return `<g transform="translate(${x} ${y}) scale(${s || 1})"><g fill="#1F6B38">${[20, 100, 200, 280].map(a => `<path d="M0 0C-8-18-6-36 0-52C6-36 8-18 0 0Z" transform="rotate(${a}) scale(1.1)"/>`).join('')}</g>${p}<circle r="6" fill="#F2C94C"/><g fill="#B8860B"><circle cx="-2" cy="-2" r="1.3"/><circle cx="2" cy="1" r="1.3"/><circle cx="-1" cy="3" r="1.2"/></g></g>`; };
  const snowflake = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".85">${[0, 60, 120].map(a => `<path d="M0-9V9M-3-6L0-9L3-6M-3 6L0 9L3 6" transform="rotate(${a})"/>`).join('')}</g>`;
  const candle = (x, y, s, d) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-7" y="-46" width="14" height="46" rx="2" fill="#F4EBD9"/><rect x="-7" y="-46" width="14" height="6" rx="2" fill="#E2D5BC"/><path d="M-7-38Q-2-34-3-28" stroke="#E2D5BC" stroke-width="3" fill="none"/>
      <ellipse cx="0" cy="-58" rx="22" ry="26" fill="url(#nx-lightglow)" class="nx-flicker" style="animation-delay:-${d}s"/><path class="nx-flicker" style="animation-delay:-${d}s" d="M0-68C-5-60-6-54 0-50C6-54 5-60 0-68Z" fill="url(#nx-flame)"/><rect x="-.8" y="-50" width="1.6" height="5" fill="#2B1A10"/></g>`;
  // Guirlande lumineuse : fil + ampoules réparties le long d'une courbe de Bézier.
  const colors = ['#FF5A4E', '#FFD35A', '#6BE08F', '#6BB7FF', '#FF9AD5'];
  function lights(p0, p1, p2, count, d0) {
    let g = `<path d="M${p0[0]} ${p0[1]}Q${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}" stroke="#0F0A06" stroke-width="1.6" fill="none"/>`;
    for (let i = 0; i < count; i++) {
      const t = (i + .5) / count, x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1], c = colors[(i + (d0 || 0)) % colors.length];
      g += `<g class="nx-bulb" style="--c:${c};animation-delay:-${((i * .55) % 3).toFixed(2)}s"><circle cx="${x.toFixed(1)}" cy="${(y + 9).toFixed(1)}" r="11" fill="${c}" opacity=".3"/><rect x="${(x - 2.6).toFixed(1)}" y="${(y - 1).toFixed(1)}" width="5.2" height="5" fill="#222"/><ellipse cx="${x.toFixed(1)}" cy="${(y + 9).toFixed(1)}" rx="4" ry="6" fill="${c}"/><ellipse cx="${(x - 1.2).toFixed(1)}" cy="${(y + 7).toFixed(1)}" rx="1" ry="2" fill="#fff" opacity=".7"/></g>`;
    }
    return g;
  }
  // Sapin décoré (bandeau + mascotte) : 4 étages, étoile qui scintille, boules, guirlande qui clignote.
  const tree = (x, y, s, withLights) => `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-9" y="0" width="18" height="16" rx="2" fill="#5A3318"/>
      ${[[0, -4, 70, 44, '#0F3D20'], [0, -34, 58, 40, '#14502A'], [0, -62, 46, 38, '#1A6535'], [0, -88, 34, 34, '#208040']].map(([cx, cy, w, h, c]) => `<path d="M${cx} ${cy - h}L${cx + w / 2} ${cy}Q${cx} ${cy + 7} ${cx - w / 2} ${cy}Z" fill="${c}"/>`).join('')}
      <g fill="#fff" opacity=".9"><path d="M-35-4Q-24 2-12-3Q0 3 12-3Q24 2 35-4L33-8L-33-8Z"/></g>
      ${withLights ? `<g class="nx-bulb" style="--c:#FF5A4E"><circle cx="-18" cy="-14" r="4" fill="#FF5A4E"/></g><g class="nx-bulb" style="--c:#FFD35A;animation-delay:-.8s"><circle cx="14" cy="-24" r="4" fill="#FFD35A"/></g><g class="nx-bulb" style="--c:#6BB7FF;animation-delay:-1.6s"><circle cx="-10" cy="-46" r="3.6" fill="#6BB7FF"/></g><g class="nx-bulb" style="--c:#FF5A4E;animation-delay:-2.2s"><circle cx="16" cy="-56" r="3.6" fill="#FF5A4E"/></g><g class="nx-bulb" style="--c:#6BE08F;animation-delay:-.4s"><circle cx="-4" cy="-76" r="3.2" fill="#6BE08F"/></g><g class="nx-bulb" style="--c:#FFD35A;animation-delay:-1.2s"><circle cx="8" cy="-80" r="3" fill="#FFD35A"/></g>` : ''}
      <path class="nx-twinkle" transform="translate(0 -128)" d="M0-14L3.6-4.4L14-4L5.8 2.4L8.6 12L0 6.4L-8.6 12L-5.8 2.4L-14-4L-3.6-4.4Z" fill="#FFD84A" stroke="#FFF4B8" stroke-width="1"/>
    </g>`;

  // ─── Bandeau « affiche » de la Synthèse ────────────────────────────────
  function heroHtml() {
    const planks = Array.from({ length: 9 }, (_, i) => `<rect x="${i * 112}" y="0" width="112" height="200" fill="${['#3A2013', '#432616', '#34190E', '#3E2214'][i % 4]}"/><path d="M${i * 112} 0V200" stroke="#1B0C06" stroke-width="2"/>`).join('');
    const grain = Array.from({ length: 26 }, (_, i) => { const r = mk(i + 3); const x = r() * 1000, y = r() * 200; return `<path d="M${x.toFixed(0)} ${y.toFixed(0)}q${(20 + r() * 40).toFixed(0)} ${(r() * 6 - 3).toFixed(1)} ${(60 + r() * 60).toFixed(0)} 0" stroke="#1E0E07" stroke-width="1" fill="none" opacity=".5"/>`; }).join('');
    const body = `${planks}${grain}
      <rect width="1000" height="200" fill="url(#nx-lightglow)" opacity=".25"/>
      <g transform="translate(-10 4) rotate(2)">${branch(520, 5, 3.6)}${berries(120, 8, 1.1)}${berries(300, 14, 1)}${berries(440, 16, .9)}</g>
      <g transform="translate(1010 6) scale(-1 1) rotate(2)">${branch(470, 11, 3.6)}${berries(150, 10, 1.1)}${berries(330, 16, 1)}</g>
      ${pinecone(560, 6, .8, 14)}${poinsettia(970, 38, .8)}
      ${lights([-10, 18], [250, 74], [520, 24], 11, 0)}${lights([520, 24], [760, 66], [1010, 20], 10, 2)}
      ${ball(250, 40, 22, 14, 'stripes', 0)}${ball(420, 46, 30, 12, 'gold', 1.3)}${starOrn(640, 40, 24, 13, .7)}${ball(840, 44, 28, 13, 'green', 2.1)}
      ${tree(106, 190, .92, true)}
      ${gift(220, 198, 54, 40, '#B3141B', '#D8363D', '#F2C94C')}${gift(278, 198, 40, 30, '#1F6B38', '#2E8A4C', '#F7F3EA')}${gift(250, 158, 36, 26, '#2F6FD0', '#5C8FE0', '#F2C94C')}
      ${ginger(372, 194, 1, -6)}${cane(430, 198, .8, 6)}${cane(452, 198, .7, -4)}${candle(700, 198, .9, 0)}${candle(738, 198, .7, 1.3)}
      ${snowflake(560, 120, 1)}${snowflake(612, 150, .7)}
      <rect y="176" width="1000" height="24" fill="#1B0C06" opacity=".55"/>`;
    return `<div id="season-hero" class="season-hero">
      ${svg('0 0 1000 200', body, 'nx-hero-art', 'preserveAspectRatio="xMidYMid slice"')}
      <div class="nx-snow-in"></div>
      <div class="nx-hero-text"><span class="nx-hero-kicker">Allure+ · 25 décembre</span><b>Joyeux Noël</b><span class="nx-hero-sub">Les sentiers sont blancs… chausse tes crampons.</span></div>
    </div>`;
  }

  // ─── Décor plein écran (fixe, derrière le contenu) ──────────────────────
  function skyHtml() {
    const top = `
      <g transform="translate(-30 -6) rotate(2.5)">${branch(760, 21, 4)}${berries(140, 10, 1.2)}${berries(380, 14, 1.1)}${berries(640, 18, 1)}</g>
      <g transform="translate(700 -10) rotate(1.5)">${branch(700, 33, 4)}${berries(120, 12, 1.1)}${berries(430, 16, 1.2)}</g>
      <g transform="translate(1640 -6) scale(-1 1) rotate(2)">${branch(720, 47, 4)}${berries(200, 10, 1.1)}${berries(520, 18, 1)}</g>
      ${pinecone(330, 6, .9, 10)}${pinecone(1130, 4, .85, -12)}${poinsettia(1500, 54, 1)}${poinsettia(60, 40, .7)}
      ${lights([0, 22], [200, 120], [420, 40], 12, 0)}${lights([420, 40], [700, 100], [980, 36], 13, 2)}${lights([980, 36], [1260, 110], [1600, 30], 14, 4)}
      ${ball(210, 48, 26, 16, 'stripes', 0)}${ball(520, 62, 44, 14, 'gold', 1.4)}${starOrn(760, 52, 30, 16, .6)}${ball(1010, 56, 36, 15, 'red', 2)}${starOrn(1240, 62, 26, 14, 1.1)}${ball(1400, 54, 38, 17, 'blue', .4)}`;
    const bottom = `
      <g transform="translate(-20 288) rotate(-2)">${branch(520, 61, 4)}${berries(90, -10, 1)}${berries(360, -6, 1.1)}</g>
      <g transform="translate(1620 292) scale(-1 1) rotate(-2)">${branch(560, 71, 4)}${berries(150, -8, 1.1)}${berries(400, -12, 1)}</g>
      ${gift(1230, 286, 80, 60, '#B3141B', '#D8363D', '#F2C94C')}${gift(1316, 286, 58, 44, '#1F6B38', '#2E8A4C', '#F7F3EA')}${gift(1262, 226, 52, 38, '#2F6FD0', '#5C8FE0', '#F2C94C')}${gift(1390, 286, 64, 50, '#7A1E8C', '#9B3FB0', '#F2C94C')}
      ${ginger(1500, 282, 1.5, 8)}${ginger(1180, 284, 1.2, -8)}${cane(1470, 286, 1.1, 10)}${cane(1160, 286, .9, -8)}${pinecone(1555, 278, .8, 20)}
      ${gift(260, 286, 70, 52, '#B3141B', '#D8363D', '#F2C94C')}${gift(336, 286, 50, 38, '#1F6B38', '#2E8A4C', '#F7F3EA')}${candle(470, 288, 1.2, 0)}${candle(520, 288, .9, 1.1)}${ginger(130, 282, 1.3, -6)}${cane(60, 286, 1, -6)}`;
    const flakes = Array.from({ length: 38 }, () => { const s = rnd(2, 6.5); return `<span class="nx-flake" style="left:${rnd(0, 100).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${rnd(9, 21).toFixed(1)}s;animation-delay:-${rnd(0, 20).toFixed(1)}s;--sway:${rnd(-50, 50).toFixed(0)}px;opacity:${rnd(.45, .95).toFixed(2)}"></span>`; }).join('');
    const sparks = Array.from({ length: 14 }, () => `<i class="nx-spark" style="left:${rnd(0, 100).toFixed(1)}%;top:${rnd(4, 92).toFixed(1)}%;animation-delay:-${rnd(0, 5).toFixed(1)}s;animation-duration:${rnd(2.4, 5).toFixed(1)}s"></i>`).join('');
    return `<div id="season-sky" class="season-sky nx-sky" aria-hidden="true">
      <div class="nx-wood"></div><div class="nx-warm"></div>
      ${svg('0 0 1600 240', top, 'nx-top', 'preserveAspectRatio="xMidYMin slice"')}
      ${svg('0 0 1600 300', bottom, 'nx-bottom', 'preserveAspectRatio="xMidYMax slice"')}
      <div class="nx-particles">${flakes}${sparks}</div>
      <div class="nx-vignette"></div>
    </div>`;
  }

  function mascotHtml() {
    return `<div id="season-mascot" class="season-mascot" aria-hidden="true">${svg('-50 -150 100 180', tree(0, 14, 1, true), 'nx-mascot-svg')}<span class="nx-mascot-cap">Joyeuses fêtes !</span></div>`;
  }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS.noel = {
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
