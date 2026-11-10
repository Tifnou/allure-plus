// ═══════════════════════════════════════════════════════════════════════
// PACK HALLOWEEN « CRÉPUSCULE BRUMEUX » (v2.6.9) — remplace l'ancien pack vectoriel
// sombre (manoir / corbeaux / araignée). Même id de saison 'halloween'.
// ═══════════════════════════════════════════════════════════════════════
// Direction : photo de crépuscule violet (pleine lune orange, manoir sur la colline, chemin
// pavé dans la brume, citrouille + lanterne) FIXE derrière le contenu, cartes en verre clair,
// barre latérale image « nuit violette ». Au-dessus de la photo : une lueur de lune qui respire,
// deux nappes de brume qui dérivent, des chauves-souris qui traversent l'écran (PNG fournis) et
// des FEUILLES D'AUTOMNE qui tombent poussées par une brise (canvas, même principe que les
// pétales de la Saint-Valentin). En pause quand l'onglet est caché, figées si « réduire les
// animations ». Rien ne reçoit la souris.
// Images : images/skin-halloween/ ; style : css/season_halloween.css ; palette : seasons.css.
(function () {
  // Lumières de la photo (lanternes, fenêtres, citrouilles) : [x %, y %, largeur du halo en % de la scène],
  // détectées automatiquement (amas de pixels chauds très clairs) dans images/skin-halloween/bg.jpg.
  // Si la photo change : les redétecter. La lune (plus gros amas) est exclue.
  const LIGHTS = [[86.04, 31.49, 9.56], [22.15, 77.49, 15.93], [23.09, 90.61, 13.81], [12.14, 49.38, 7.43], [81.91, 85.08, 7.43], [28.9, 36.12, 7.43], [26.03, 56.46, 4.25], [77.52, 67.58, 4.25], [91.34, 40.36, 11.68], [31.95, 38.41, 5.31], [31.1, 48.06, 5.31], [31.75, 85.46, 8.5], [24.2, 36.49, 5.31], [18.78, 37.03, 4.25], [34.3, 49.53, 4.25], [41.83, 22.58, 4.25], [91.66, 28.37, 5.31], [44.05, 20.53, 3.19], [26.16, 86.57, 5.31]];
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ─── Feuilles : sprites dessinés une fois (5 teintes d'automne) ─────────────
  const TINTS = [['#FFA23A', '#C2540A'], ['#F2751C', '#8F2E06'], ['#FFC05A', '#D9731A'], ['#D9481A', '#7A1C06'], ['#E8903A', '#A5410C']];
  function leafSprite(c0, c1) {
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d');
    // feuille d'érable stylisée : 5 lobes pointus + queue
    const pts = [[32, 4], [38, 18], [52, 14], [46, 30], [60, 36], [44, 42], [48, 54], [34, 48], [32, 62],
      [30, 48], [16, 54], [20, 42], [4, 36], [18, 30], [12, 14], [26, 18]];
    const p = new Path2D(); pts.forEach((q, i) => i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath();
    const gr = g.createLinearGradient(10, 6, 54, 60); gr.addColorStop(0, c0); gr.addColorStop(1, c1);
    g.fillStyle = gr; g.fill(p);
    g.strokeStyle = 'rgba(70,20,0,.45)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(32, 60); g.lineTo(32, 12); g.moveTo(32, 44); g.lineTo(46, 32); g.moveTo(32, 44); g.lineTo(18, 32); g.stroke();
    return cv;
  }

  let _leaves = null;
  function startLeaves(canvas) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d');
    const sprites = TINTS.map(t => leafSprite(t[0], t[1]));
    const COUNT = reduce ? 16 : 34;
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
    const ps = [];
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function spawn(p, anywhere) {
      const depth = Math.random();
      p.depth = depth; p.size = 12 + depth * 18; p.vy = 30 + depth * 50;
      p.sway = rnd(14, 36) * (0.5 + depth); p.phase = rnd(0, 6.28); p.freq = rnd(0.4, 0.95);
      p.rot = rnd(0, 6.28); p.spin = rnd(-1.1, 1.1);
      p.flip = rnd(0, 6.28); p.flipSp = rnd(1, 2.4);
      p.a = 0.6 + depth * 0.35; p.sprite = sprites[(Math.random() * sprites.length) | 0];
      p.x = rnd(-60, W + 60); p.y = anywhere ? rnd(-30, H) : rnd(-40, -10);
    }
    resize();
    for (let i = 0; i < COUNT; i++) { const p = {}; spawn(p, true); ps.push(p); }
    // Brise : souffle de fond + rafales lentes (px/s, > 0 = vers la droite)
    function breeze(t) {
      const s = t / 1000;
      return 14 + 8 * Math.sin(s * 0.25) + Math.max(0, Math.sin(s * 0.38 + 1.1)) ** 2 * 40 + Math.max(0, Math.sin(s * 0.9 + 2)) ** 3 * 16;
    }
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      const w = breeze(now - t0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      for (const p of ps) {
        p.phase += p.freq * dt; p.rot += (p.spin + w * 0.01) * dt; p.flip += p.flipSp * dt;
        p.x += (w * (0.4 + p.depth * 0.9) + Math.cos(p.phase) * p.sway * 0.55) * dt;
        p.y += (p.vy + Math.sin(p.phase * 0.8) * 8) * dt;
        if (p.y > H + 30 || p.x > W + 80 || p.x < -80) spawn(p, false);
        const sx = 0.4 + 0.6 * Math.abs(Math.cos(p.flip));
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
    _leaves = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); } };
  }
  function stopLeaves() { if (_leaves) { _leaves.stop(); _leaves = null; } }

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS['halloween'] = {
    build() {
      this.clear();
      if (!document.body) return;
      // Trois passages de chauves-souris (trajets/vitesses différents), via CSS
      const bats = [[8, 38, 0, .55], [16, 52, -19, .4], [5, 30, -33, .7]]
        .map(b => `<img class="hw-bat" src="images/skin-halloween/bats.png" alt="" style="top:${b[0]}vh;animation-duration:${b[1]}s;animation-delay:${b[2]}s;width:${Math.round(150 * b[3])}px">`).join('');
      // Halos chauds qui vacillent (durée/retard propres à chacun : jamais synchrones)
      const lights = LIGHTS.map(l => `<i class="hw-light" style="left:${l[0]}%;top:${l[1]}%;width:${l[2]}%;animation-duration:${rnd(1.6, 4.4).toFixed(2)}s;animation-delay:${(-rnd(0, 5)).toFixed(2)}s"></i>`).join('');
      document.body.insertAdjacentHTML('afterbegin', `
        <div id="season-sky" class="season-sky hw-sky" aria-hidden="true">
          <div class="hw-stage"><div class="hw-bg"></div><div class="hw-moonglow"></div>${lights}</div>
          <div class="hw-veil"></div>
          <div class="hw-mist hw-mist--a"></div><div class="hw-mist hw-mist--b"></div>
          ${bats}
          <canvas id="hw-leaves" class="hw-leaves"></canvas>
        </div>
        <div id="season-props" class="hw-props" aria-hidden="true"><i class="hw-pglow"></i><img class="hw-pumpkin" src="images/skin-halloween/pumpkin.png" alt=""></div>
        <div id="season-fg" aria-hidden="true"><img class="hw-fg hw-fg--tomb" src="images/skin-halloween/tomb.png" alt=""><img class="hw-fg hw-fg--skull" src="images/skin-halloween/skull.png" alt=""><img class="hw-fg hw-fg--lantern" src="images/skin-halloween/lantern.png" alt=""></div>`);
      startLeaves(document.getElementById('hw-leaves'));
    },
    clear() {
      stopLeaves();
      ['season-sky', 'season-props', 'season-fg', 'season-hero', 'season-mascot', 'season-defs'].forEach(id => document.getElementById(id)?.remove());
    },
  };
})();
