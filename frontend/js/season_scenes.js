// ═══════════════════════════════════════════════════════════════════════
// SCENES DE BAS DE PAGE DES THEMES DE SAISON (illustrations SVG en ligne)
// ═══════════════════════════════════════════════════════════════════════
// Une scène = un sol qui se répète en largeur (tuile SVG) + des éléments
// indépendants posés à un pourcentage de la largeur (pas une seule image
// étirée : reste proportionnée de 900 px à 2500 px d'écran). Le sol est
// dessiné AU-DESSUS des éléments pour que leurs pieds soient "enterrés"
// (ossements qui dépassent, sapins plantés dans la neige, pétales).
// Aucune image externe : tout est vectoriel, rien à embarquer dans l'installeur.
// Utilisé par themes.js (buildDecor) ; styles/animations dans seasons.css.
(function () {
  const svg = (vb, body, cls) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" class="${cls || ''}" aria-hidden="true">${body}</svg>`;
  const tile = (w, h, body) =>
    // %27 : encodeURIComponent laisse passer l'apostrophe, qui casserait l'attribut style='...' du HTML genere
    `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`).replace(/'/g, '%27')}")`;

  // ─────────────────────────── HALLOWEEN ───────────────────────────
  const pumpkin = () => svg('0 0 80 72', `
    <path d="M37 14C37 6 42 3 48 3C47 8 49 11 51 14Z" fill="#4d7c0f"/>
    <ellipse cx="22" cy="44" rx="19" ry="25" fill="#c2410c"/><ellipse cx="58" cy="44" rx="19" ry="25" fill="#c2410c"/>
    <ellipse cx="31" cy="43" rx="19" ry="27" fill="#ea580c"/><ellipse cx="49" cy="43" rx="19" ry="27" fill="#ea580c"/>
    <ellipse cx="40" cy="42" rx="17" ry="28" fill="#f97316"/>
    <path d="M40 16V70M28 20Q24 44 29 66M52 20Q56 44 51 66" stroke="#c2410c" stroke-width="1.6" fill="none" opacity=".55"/>
    <g class="sc-glow" fill="#fde047">
      <path d="M26 36L35 40L26 46Z"/><path d="M54 36L45 40L54 46Z"/><path d="M40 46L36 53H44Z"/>
      <path d="M25 56Q33 66 40 60Q47 66 55 56Q47 60 40 56Q33 60 25 56Z"/>
    </g>`);
  const tomb = (txt, tilt) => svg('0 0 50 66', `
    <g transform="rotate(${tilt} 25 66)">
      <path d="M4 66V24Q4 4 25 4Q46 4 46 24V66Z" fill="#9ca3af" stroke="#6b7280" stroke-width="2"/>
      <text x="25" y="30" text-anchor="middle" font-family="Georgia,serif" font-size="11" font-weight="700" fill="#4b5563">${txt}</text>
      <path d="M14 40H36M18 46H32" stroke="#6b7280" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M8 58q4-6 8-2q4-5 7 1" stroke="#4d7c0f" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>
    </g>`);
  const cross = () => svg('0 0 44 70', `<g transform="rotate(-6 22 70)"><rect x="19" y="6" width="7" height="64" rx="1.5" fill="#92400e"/><rect x="6" y="20" width="33" height="7" rx="1.5" fill="#a16207"/><path d="M19 30l7 6M19 44l7-6" stroke="#78350f" stroke-width="1" opacity=".6"/></g>`);
  const bone = angle => svg('0 0 40 56', `<g transform="rotate(${angle} 20 56)"><rect x="16.5" y="6" width="7" height="50" rx="3.5" fill="#f1ead7"/><circle cx="15" cy="7" r="5.2" fill="#f1ead7"/><circle cx="25" cy="7" r="5.2" fill="#f1ead7"/><path d="M18.5 22V50" stroke="#d6cdb4" stroke-width="1.5"/></g>`);
  const hand = () => svg('0 0 44 64', `<g class="sc-sway">
      <rect x="19" y="36" width="7" height="30" rx="3.5" fill="#f1ead7"/>
      <ellipse cx="22.5" cy="33" rx="12" ry="9" fill="#f1ead7"/>
      <rect x="10.5" y="9" width="5.2" height="24" rx="2.6" fill="#f1ead7"/><rect x="17" y="5" width="5.2" height="28" rx="2.6" fill="#f1ead7"/>
      <rect x="23.5" y="5" width="5.2" height="28" rx="2.6" fill="#f1ead7"/><rect x="30" y="10" width="5.2" height="23" rx="2.6" fill="#f1ead7"/>
      <rect x="2" y="26" width="5.2" height="17" rx="2.6" fill="#f1ead7" transform="rotate(-38 4.6 40)"/>
      <path d="M13 19H15.5M19.5 15H22M26 15H28.5M32.5 20H35" stroke="#cfc6ad" stroke-width="1.3" stroke-linecap="round"/>
    </g>`);
  const skull = () => svg('0 0 50 44', `
    <path d="M6 44V24C6 8 16 2 25 2C34 2 44 8 44 24V44Z" fill="#f1ead7"/>
    <ellipse cx="17" cy="24" rx="6" ry="7" fill="#1f1b24"/><ellipse cx="33" cy="24" rx="6" ry="7" fill="#1f1b24"/>
    <path d="M25 30l-3 7h6z" fill="#1f1b24"/><path d="M12 41h26" stroke="#1f1b24" stroke-width="2"/>
    <path d="M17 41v-5M22 41v-5M28 41v-5M33 41v-5" stroke="#1f1b24" stroke-width="1.6"/>`);

  const halloweenGround = tile(240, 44, `
    <path d="M0 13Q30 7 60 12T120 11T180 12T240 13V44H0Z" fill="#4a3220"/>
    <path d="M0 13Q30 7 60 12T120 11T180 12T240 13V19Q200 22 150 17T60 19T0 19Z" fill="#2e2140"/>
    <g fill="#3a2819"><circle cx="18" cy="28" r="2.4"/><circle cx="74" cy="34" r="3"/><circle cx="130" cy="27" r="2.2"/><circle cx="196" cy="35" r="2.8"/><circle cx="226" cy="26" r="2"/></g>
    <g fill="#5b3f29"><circle cx="40" cy="26" r="1.8"/><circle cx="102" cy="31" r="2.2"/><circle cx="158" cy="38" r="1.8"/><circle cx="214" cy="31" r="1.6"/></g>
    <g fill="#26180f"><ellipse cx="58" cy="37" rx="5" ry="2.4"/><ellipse cx="172" cy="29" rx="4" ry="2"/></g>`);

  // ───────────────────────────── NOËL ─────────────────────────────
  const tree = () => svg('0 0 70 104', `
    <rect x="30" y="86" width="10" height="16" rx="2" fill="#78350f"/>
    <path d="M35 14L58 46H12Z" fill="#15803d"/><path d="M35 34L63 72H7Z" fill="#166534"/><path d="M35 52L67 92H3Z" fill="#14532d"/>
    <path d="M12 46q12-6 23 0q11-6 23 0z" fill="#f8fafc" opacity=".95"/>
    <path d="M7 72q14-7 28 0q14-7 28 0z" fill="#f8fafc" opacity=".95"/>
    <path d="M3 92q16-8 32 0q16-8 32 0z" fill="#f8fafc" opacity=".95"/>
    <path d="M35 1l2.8 6 6.4.8-4.7 4.4 1.2 6.3-5.7-3.1-5.7 3.1 1.2-6.3-4.7-4.4 6.4-.8z" fill="#facc15" class="sc-twinkle"/>
    <path d="M18 40Q35 46 52 40M14 62Q35 72 56 62M10 82Q35 94 60 82" stroke="#fde68a" stroke-width="1.2" fill="none" stroke-dasharray="1 5" stroke-linecap="round"/>
    <g>
      <circle class="sc-twinkle" style="animation-delay:0s" cx="30" cy="36" r="3.4" fill="#ef4444"/>
      <circle class="sc-twinkle" style="animation-delay:.5s" cx="41" cy="30" r="3" fill="#facc15"/>
      <circle class="sc-twinkle" style="animation-delay:1s" cx="26" cy="58" r="3.6" fill="#3b82f6"/>
      <circle class="sc-twinkle" style="animation-delay:.3s" cx="44" cy="55" r="3.4" fill="#ef4444"/>
      <circle class="sc-twinkle" style="animation-delay:.8s" cx="35" cy="70" r="3.6" fill="#facc15"/>
      <circle class="sc-twinkle" style="animation-delay:1.3s" cx="18" cy="82" r="3.6" fill="#ef4444"/>
      <circle class="sc-twinkle" style="animation-delay:.2s" cx="52" cy="80" r="3.6" fill="#3b82f6"/>
      <circle class="sc-twinkle" style="animation-delay:.9s" cx="34" cy="88" r="3.2" fill="#a855f7"/>
    </g>`);
  const santa = () => svg('0 0 64 94', `
    <rect x="14" y="82" width="14" height="10" rx="3" fill="#111827"/><rect x="36" y="82" width="14" height="10" rx="3" fill="#111827"/>
    <rect x="16" y="62" width="11" height="22" fill="#b91c1c"/><rect x="37" y="62" width="11" height="22" fill="#b91c1c"/>
    <path d="M10 32Q32 24 54 32L58 68Q32 74 6 68Z" fill="#dc2626"/>
    <rect x="6" y="65" width="52" height="8" rx="4" fill="#f8fafc"/><rect x="29" y="30" width="6" height="40" fill="#f8fafc"/>
    <rect x="8" y="50" width="48" height="7" fill="#111827"/><rect x="26.5" y="48" width="11" height="11" rx="2" fill="none" stroke="#facc15" stroke-width="2.2"/>
    <path d="M13 36Q2 46 8 58" stroke="#dc2626" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="8" cy="58" r="5" fill="#f8fafc"/>
    <g class="sc-wave"><path d="M51 36Q64 32 58 16" stroke="#dc2626" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="58" cy="14" r="5" fill="#f8fafc"/></g>
    <circle cx="32" cy="24" r="11" fill="#fcd5b0"/>
    <path d="M20 24Q20 42 32 44Q44 42 44 24Q38 32 32 32Q26 32 20 24Z" fill="#fff"/><ellipse cx="32" cy="29" rx="6" ry="2.6" fill="#fff"/>
    <circle cx="32" cy="25.5" r="2.6" fill="#f9a8a8"/><circle cx="27.5" cy="21" r="1.3" fill="#111827"/><circle cx="36.5" cy="21" r="1.3" fill="#111827"/>
    <path d="M20 19Q20 4 36 3Q46 3 46 12Q44 16 43 19Z" fill="#dc2626"/><rect x="18" y="16" width="28" height="7" rx="3.5" fill="#fff"/><circle cx="47" cy="11" r="5" fill="#fff"/>`);
  const baubleColors = ['#ef4444', '#3b82f6', '#f59e0b', '#16a34a', '#a855f7', '#ec4899'];
  const bauble = (i, delay) => {
    const c = baubleColors[i % baubleColors.length];
    return svg('0 0 22 28', `
      <rect x="8.5" y="1" width="5" height="4.5" rx="1" fill="#fbbf24"/><path d="M11 1V0" stroke="#fbbf24"/>
      <circle cx="11" cy="17" r="10" fill="${c}"/><path d="M2 17Q11 12 20 17" stroke="#fff" stroke-width="1.4" fill="none" opacity=".45"/>
      <ellipse cx="7.5" cy="13" rx="2.6" ry="4" fill="#fff" opacity=".5"/>`, 'sc-bauble').replace('<svg ', `<svg style="--c:${c};--d:${delay}s" `);
  };
  const snowGround = tile(240, 44, `
    <path d="M0 15Q30 9 60 14T120 13T180 14T240 15V44H0Z" fill="#f1f5f9"/>
    <path d="M0 24Q40 19 80 25T160 24T240 25V44H0Z" fill="#dbe6f3"/>
    <g fill="#fff"><circle cx="22" cy="20" r="1.8"/><circle cx="84" cy="30" r="2"/><circle cx="144" cy="21" r="1.6"/><circle cx="206" cy="32" r="2"/></g>
    <g fill="#b6c8de" opacity=".7"><ellipse cx="50" cy="36" rx="9" ry="2.4"/><ellipse cx="170" cy="38" rx="11" ry="2.4"/></g>`);

  // ──────────────────────── SAINT-VALENTIN ────────────────────────
  const rose = (x, y, s, c1, c2, c3) => `<g transform="translate(${x} ${y}) scale(${s})">
      <circle r="11" fill="${c1}"/><path d="M-8-2Q-6-9 1-8Q9-6 8 1Q6 9-2 8Q-9 6-8-2Z" fill="${c2}"/>
      <path d="M-4-1Q-3-5 1-4Q5-3 4 1Q2 5-1 4Q-5 3-4-1Z" fill="${c3}"/><path d="M-1 0Q0-2 2-1" stroke="${c1}" stroke-width="1.4" fill="none"/></g>`;
  const bouquet = () => svg('0 0 90 108', `
    <g stroke="#15803d" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path d="M45 70L30 32M45 70L46 24M45 70L62 32M45 70L38 46M45 70L54 46"/></g>
    <g fill="#16a34a"><ellipse cx="24" cy="46" rx="9" ry="4" transform="rotate(-30 24 46)"/><ellipse cx="68" cy="46" rx="9" ry="4" transform="rotate(30 68 46)"/></g>
    <g fill="#fff" opacity=".9"><circle cx="16" cy="26" r="2.2"/><circle cx="22" cy="20" r="1.8"/><circle cx="72" cy="22" r="2.2"/><circle cx="78" cy="30" r="1.8"/><circle cx="46" cy="10" r="2"/><circle cx="36" cy="12" r="1.6"/><circle cx="58" cy="12" r="1.6"/></g>
    ${rose(30, 32, 1.05, '#9f1239', '#be123c', '#e11d48')}${rose(46, 22, 1.1, '#be123c', '#e11d48', '#fb7185')}${rose(62, 32, 1.05, '#9f1239', '#be123c', '#e11d48')}
    ${rose(38, 46, 1, '#be123c', '#f43f5e', '#fda4af')}${rose(54, 46, 1, '#be123c', '#e11d48', '#fb7185')}
    <path d="M18 54L45 106L72 54Q45 66 18 54Z" fill="#fbcfe8" stroke="#f472b6" stroke-width="1.6"/>
    <path d="M45 66L45 104M30 60L45 100M60 60L45 100" stroke="#f9a8d4" stroke-width="1" opacity=".8"/>
    <g fill="#dc2626"><path d="M45 74Q32 66 30 76Q32 84 45 74Z"/><path d="M45 74Q58 66 60 76Q58 84 45 74Z"/><circle cx="45" cy="74" r="4"/></g>`);
  const cupid = () => svg('0 0 80 78', `<g class="sc-bob">
      <path d="M27 38Q4 24 8 6Q24 6 32 28Z" fill="#fff" stroke="#fbcfe8" stroke-width="1.4"/>
      <path d="M13 12Q18 20 24 30M17 8Q22 18 28 28" stroke="#fbcfe8" stroke-width="1" fill="none"/>
      <path d="M45 38Q64 26 60 8Q46 8 40 28Z" fill="#fff" stroke="#fbcfe8" stroke-width="1.4"/>
      <ellipse cx="36" cy="46" rx="9" ry="11" fill="#fcd5b0"/>
      <path d="M27 52Q36 63 45 52L43 60Q36 64 29 60Z" fill="#fff" stroke="#fbcfe8" stroke-width="1"/>
      <rect x="29" y="58" width="5" height="14" rx="2.5" fill="#fcd5b0"/><rect x="38" y="58" width="5" height="14" rx="2.5" fill="#fcd5b0"/>
      <circle cx="36" cy="27" r="11" fill="#fcd5b0"/>
      <g fill="#fbbf24"><circle cx="27" cy="19" r="4"/><circle cx="33" cy="15" r="4.4"/><circle cx="40" cy="15" r="4.4"/><circle cx="46" cy="19" r="4"/><circle cx="36" cy="14" r="4"/></g>
      <circle cx="32" cy="28" r="1.4" fill="#3f2a1d"/><circle cx="41" cy="28" r="1.4" fill="#3f2a1d"/>
      <circle cx="29.5" cy="32" r="2.4" fill="#fda4af" opacity=".8"/><circle cx="43.5" cy="32" r="2.4" fill="#fda4af" opacity=".8"/>
      <path d="M33 33Q36.5 36 40 33" stroke="#9f1239" stroke-width="1.3" fill="none" stroke-linecap="round"/>
      <path d="M44 42L58 38" stroke="#fcd5b0" stroke-width="4.4" stroke-linecap="round"/>
      <path d="M58 22Q76 38 58 56" stroke="#d97706" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M58 22L58 56" stroke="#92400e" stroke-width="1"/>
      <path d="M40 39H76" stroke="#92400e" stroke-width="1.6"/><path d="M40 39l-4-3M40 39l-4 3" stroke="#f9a8d4" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M76 39l-5-3.4v6.8z" fill="#e11d48"/>
      <path d="M69 70c-3-3-2-6 1-5 1 0 2 1 2 2 0-1 1-2 2-2 3-1 4 2 1 5l-3 3z" fill="#fb7185" class="sc-twinkle"/>
    </g>`);
  const bear = (fur, inner, bow) => svg('0 0 54 64', `
    <circle cx="12" cy="10" r="7" fill="${fur}"/><circle cx="12" cy="10" r="3.5" fill="${inner}"/>
    <circle cx="42" cy="10" r="7" fill="${fur}"/><circle cx="42" cy="10" r="3.5" fill="${inner}"/>
    <ellipse cx="27" cy="48" rx="15" ry="14" fill="${fur}"/><ellipse cx="27" cy="50" rx="8.5" ry="9" fill="${inner}"/>
    <ellipse cx="10" cy="46" rx="5" ry="7.5" fill="${fur}" transform="rotate(20 10 46)"/><ellipse cx="44" cy="46" rx="5" ry="7.5" fill="${fur}" transform="rotate(-20 44 46)"/>
    <ellipse cx="17" cy="60" rx="7.5" ry="4.8" fill="${fur}"/><ellipse cx="37" cy="60" rx="7.5" ry="4.8" fill="${fur}"/>
    <ellipse cx="17" cy="60.5" rx="3.6" ry="2.4" fill="${inner}"/><ellipse cx="37" cy="60.5" rx="3.6" ry="2.4" fill="${inner}"/>
    <circle cx="27" cy="22" r="15.5" fill="${fur}"/><ellipse cx="27" cy="28" rx="7.5" ry="5.8" fill="${inner}"/>
    <ellipse cx="27" cy="25.4" rx="2.8" ry="1.9" fill="#3f2a1d"/><path d="M27 27.3V30M24 31Q27 33 30 31" stroke="#3f2a1d" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    <circle cx="21.5" cy="19" r="1.7" fill="#3f2a1d"/><circle cx="32.5" cy="19" r="1.7" fill="#3f2a1d"/>
    <g fill="${bow}"><path d="M27 36L20 32V40Z"/><path d="M27 36L34 32V40Z"/><circle cx="27" cy="36" r="2.2"/></g>
    <path d="M27 54c-5-4-4-9 0-7 4-2 5 3 0 7z" fill="#e11d48" class="sc-twinkle"/>`);
  const petalGround = tile(240, 44, `
    <path d="M0 15Q30 9 60 14T120 13T180 14T240 15V44H0Z" fill="#f9a8d4"/>
    <path d="M0 24Q40 19 80 25T160 24T240 25V44H0Z" fill="#f472b6"/>
    <g>
      <ellipse cx="14" cy="14" rx="7" ry="3.4" fill="#fb7185" transform="rotate(-20 14 14)"/><ellipse cx="52" cy="11" rx="6.5" ry="3.2" fill="#fecdd3" transform="rotate(25 52 11)"/>
      <ellipse cx="96" cy="13" rx="7" ry="3.4" fill="#be123c" transform="rotate(-10 96 13)"/><ellipse cx="140" cy="10" rx="6.5" ry="3.2" fill="#fda4af" transform="rotate(30 140 10)"/>
      <ellipse cx="184" cy="13" rx="7" ry="3.4" fill="#fb7185" transform="rotate(-25 184 13)"/><ellipse cx="224" cy="11" rx="6.5" ry="3.2" fill="#fff1f2" transform="rotate(15 224 11)"/>
      <ellipse cx="30" cy="26" rx="8" ry="3.6" fill="#fff1f2" transform="rotate(15 30 26)"/><ellipse cx="70" cy="30" rx="8" ry="3.6" fill="#be123c" transform="rotate(-30 70 30)"/>
      <ellipse cx="112" cy="27" rx="8" ry="3.6" fill="#fecdd3" transform="rotate(20 112 27)"/><ellipse cx="156" cy="32" rx="8" ry="3.6" fill="#fb7185" transform="rotate(-15 156 32)"/>
      <ellipse cx="198" cy="28" rx="8" ry="3.6" fill="#be123c" transform="rotate(25 198 28)"/><ellipse cx="234" cy="33" rx="8" ry="3.6" fill="#fda4af" transform="rotate(-10 234 33)"/>
      <ellipse cx="46" cy="38" rx="7" ry="3.2" fill="#fb7185" transform="rotate(-20 46 38)"/><ellipse cx="128" cy="39" rx="7" ry="3.2" fill="#fff1f2" transform="rotate(10 128 39)"/><ellipse cx="212" cy="40" rx="7" ry="3.2" fill="#be123c" transform="rotate(-25 212 40)"/>
    </g>`);

  // item(svgHtml, xPercent, widthPx, bottomPx, extraClass)
  const item = (html, x, w, b, cls) =>
    `<div class="sc-item ${cls || ''}" style="left:${x}%;--w:${w}px;--b:${b}px">${html}</div>`;

  const SCENES = {
    halloween: {
      ground: halloweenGround,
      items: () => [
        item(tomb('RIP', -4), 3, 46, 18), item(hand(), 11, 34, 14), item(pumpkin(), 16, 74, 17), item(cross(), 28, 38, 18),
        item(bone(-32), 36, 38, 10), item(skull(), 43, 44, 8), item(tomb('R.I.P', 5), 53, 50, 18), item(bone(28), 63, 40, 10),
        item(hand(), 71, 34, 14), item(tomb('RIP', -6), 79, 46, 18), item(pumpkin(), 88, 52, 17), item(bone(-24), 95, 34, 10),
      ].join(''),
    },
    noel: {
      ground: snowGround,
      items: () => {
        const baubles = [[27, 0], [31.5, .6], [46, 1.1], [52, .3], [60.5, .9], [68, 1.5], [77, .2], [83.5, 1.2], [93.5, .7]]
          .map(([x, d], i) => item(bauble(i, d), x, 20, 19 + (i % 3) * 4));
        return [
          item(tree(), 5, 66, 20), item(santa(), 15, 58, 16), item(tree(), 36, 54, 20),
          item(tree(), 72, 62, 20), item(tree(), 88, 44, 20), ...baubles,
        ].join('');
      },
    },
    'saint-valentin': {
      ground: petalGround,
      items: () => [
        item(bear('#c08457', '#f3d9b1', '#e11d48'), 3, 50, 16), item(bouquet(), 13, 80, 14), item(cupid(), 28, 72, 40, 'sc-float'),
        item(bear('#f5e6d3', '#fff7ed', '#ec4899'), 46, 46, 16), item(bear('#a16207', '#fcd9a8', '#dc2626'), 61, 54, 16),
        item(bouquet(), 74, 66, 14), item(bear('#e9b8a0', '#fff1ea', '#be123c'), 89, 42, 16),
      ].join(''),
    },
  };

  window.buildSeasonScene = function (id) {
    const sc = SCENES[id];
    if (!sc) return '';
    return `<div class="sc-items">${sc.items()}</div><div class="sc-ground" style='background-image:${sc.ground}'></div>`;
  };
})();
