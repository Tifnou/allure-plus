// ═══════════════════════════════════════════════════════════════════════
// PACK SAINT-VALENTIN « COUCHER DE SOLEIL » (v2.6.9) — remplace l'ancien pack
// bois clair / tulipes (même id de saison 'saint-valentin').
// ═══════════════════════════════════════════════════════════════════════
// Direction : photo de coucher de soleil rose (arbre en fleurs, cœurs suspendus,
// banc, lanterne) FIXE derrière le contenu, cartes en verre rose, barre latérale
// image « fleurs de cerisier ». Au-dessus de la photo : des PÉTALES DE ROSE qui
// tombent au rythme d'une brise (canvas : chute lente, balancement, vrille des
// pétales, rafales qui poussent tout dans le même sens). En pause quand l'onglet
// est caché, figés si « réduire les animations ». Rien ne reçoit la souris.
// Images dans images/skin-valentin/ ; style dans css/season_valentin.css ;
// palette dans seasons.css.
(function () {
  // Points lumineux du cœur dessiné dans le ciel de la photo : [x %, y %] détectés automatiquement dans
  // images/skin-valentin/bg.jpg et triés par angle autour du cœur (ils scintillent l'un après l'autre,
  // en farandole). Si la photo change : les redétecter.
  const HEART_PTS = [[83.93, 16.09], [83.93, 15.28], [84.23, 13.65], [84.85, 12.21], [85.31, 11.66], [86.43, 11.03], [87.3, 11.3], [88.01, 11.48], [88.93, 12.48], [89.49, 13.47], [89.85, 14.2], [90.92, 11.75], [92.19, 10.31], [92.6, 10.13], [93.47, 9.76], [94.13, 10.04], [94.54, 10.22], [95.1, 10.76], [95.61, 11.66], [95.87, 12.66], [96.17, 13.83], [95.87, 16.37], [95.26, 18.26], [94.29, 19.44], [93.47, 20.61], [92.55, 22.15], [91.89, 22.78], [91.33, 24.32], [90.51, 25.5], [89.85, 27.03], [89.64, 26.4], [89.39, 25.77], [88.62, 24.5], [87.7, 23.06], [86.73, 22.15], [85.51, 20.52], [84.54, 19.08], [84.08, 17.54]];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ─── Pétales : sprites dessinés une fois (6 teintes), puis tamponnés ──────
  const TINTS = [
    ['#FF8FA9', '#D81B4A'], ['#FF6F8F', '#B3123F'], ['#FFB3C6', '#E8527A'],
    ['#E83561', '#8F0F31'], ['#FF9DB5', '#C42456'], ['#FFC9D6', '#F06A8E'],
  ];
  function petalSprite(c0, c1) {
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    // Forme de pétale : large en haut, pointe en bas, légèrement asymétrique.
    const p = new Path2D();
    p.moveTo(32, 58);
    p.bezierCurveTo(8, 46, 4, 20, 22, 8);
    p.bezierCurveTo(30, 3, 38, 4, 44, 9);
    p.bezierCurveTo(60, 20, 56, 46, 32, 58);
    p.closePath();
    const gr = g.createLinearGradient(14, 8, 50, 58);
    gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fill(p);
    // nervure et reflet
    g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(32, 54); g.quadraticCurveTo(31, 32, 34, 12); g.stroke();
    const hl = g.createRadialGradient(24, 20, 1, 24, 20, 20);
    hl.addColorStop(0, 'rgba(255,255,255,.38)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl; g.fill(p);
    return cv;
  }

  let _petals = null;
  function startPetals(canvas) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d');
    const sprites = TINTS.map(t => petalSprite(t[0], t[1]));
    const COUNT = reduce ? 26 : 62;
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
    const ps = [];
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function spawn(p, anywhere) {
      const depth = Math.random();                 // 0 loin (petit, lent, pâle) → 1 proche (gros, vif)
      p.depth = depth;
      p.size = 9 + depth * 17;                     // px
      p.vy = 26 + depth * 44;                      // chute lente
      p.sway = rnd(10, 30) * (0.5 + depth);        // balancement latéral
      p.phase = rnd(0, 6.28); p.freq = rnd(0.45, 1.05);
      p.rot = rnd(0, 6.28); p.spin = rnd(-0.9, 0.9);
      p.flip = rnd(0, 6.28); p.flipSp = rnd(1.2, 2.8);   // vrille (le pétale « se retourne »)
      p.a = 0.55 + depth * 0.4;
      p.sprite = sprites[(Math.random() * sprites.length) | 0];
      p.x = rnd(-60, W + 60);
      p.y = anywhere ? rnd(-30, H) : rnd(-40, -10);
    }
    resize();
    for (let i = 0; i < COUNT; i++) { const p = {}; spawn(p, true); ps.push(p); }

    // Brise : souffle de fond doux + rafales lentes (px/s, > 0 = vers la droite).
    function breeze(t) {
      const s = t / 1000;
      const base = 16 + 9 * Math.sin(s * 0.27);
      const gust = Math.max(0, Math.sin(s * 0.41 + 0.8)) ** 2 * 38 + Math.max(0, Math.sin(s * 0.97 + 2.1)) ** 3 * 18;
      return base + gust;
    }
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      const w = breeze(now - t0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.phase += p.freq * dt; p.rot += (p.spin + w * 0.012) * dt; p.flip += p.flipSp * dt;
        p.x += (w * (0.4 + p.depth * 0.9) + Math.cos(p.phase) * p.sway * 0.55) * dt;
        p.y += (p.vy + Math.sin(p.phase * 0.8) * 8) * dt;
        if (p.y > H + 30 || p.x > W + 80 || p.x < -80) spawn(p, false);
        const sx = 0.35 + 0.65 * Math.abs(Math.cos(p.flip));   // aplatissement = vrille
        ctx.globalAlpha = p.a;
        ctx.setTransform(dpr * Math.cos(p.rot), dpr * Math.sin(p.rot), -dpr * Math.sin(p.rot) * sx, dpr * Math.cos(p.rot) * sx, p.x * dpr, p.y * dpr);
        ctx.drawImage(p.sprite, -p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduce) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    if (reduce) { frame(performance.now()); cancelAnimationFrame(raf); } else raf = requestAnimationFrame(frame);
    _petals = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); } };
  }
  function stopPetals() { if (_petals) { _petals.stop(); _petals = null; } }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS['saint-valentin'] = {
    build() {
      this.clear();
      if (!document.body) return;
      const P = 3.6;  // durée d'un tour complet (s)
      const sparks = HEART_PTS.map((q, i) => `<i class="sv-spark" style="left:${q[0]}%;top:${q[1]}%;animation-duration:${P}s;animation-delay:${(i / HEART_PTS.length * P).toFixed(3)}s"></i>`).join('');
      document.body.insertAdjacentHTML('afterbegin', `
        <div id="season-sky" class="season-sky sv-sky" aria-hidden="true">
          <div class="sv-stage"><div class="sv-bg"></div>${sparks}</div>
          <div class="sv-veil"></div>
          <canvas id="sv-petals" class="sv-petals"></canvas>
        </div>
        <div id="season-props" class="sv-props" aria-hidden="true"><img class="sv-bear" src="images/skin-valentin/bear.png" alt=""></div>`);
      startPetals(document.getElementById('sv-petals'));
    },
    clear() {
      stopPetals();
      ['season-sky', 'season-props'].forEach(id => document.getElementById(id)?.remove());
    },
  };
})();
