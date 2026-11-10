// ═══════════════════════════════════════════════════════════════════════
// PACK NOËL « GIVRÉ » (remplace l'ancien pack bois/sapin)
// ═══════════════════════════════════════════════════════════════════════
// Direction : nuit d'hiver enneigée aux guirlandes lumineuses, cartes en verre
// givré coiffées de neige, barre latérale « panneau de glace », lanterne et
// paquets-cadeaux au PREMIER PLAN. Images dans images/skin-noel2/ (planches
// découpées par l'utilisateur). Le DOM est construit ici, le style est dans
// css/season_noel.css, la palette dans seasons.css (id 'noel').
//
// Calques (z-index) : sky 0 (fond + lumières qui clignotent + neige) → contenu
// → props (lanterne + cadeaux) devant tout. Rien ne reçoit la souris.
// La neige est un <canvas> : chute + VENT (rafales lentes qui poussent tous les
// flocons du même côté, plus fort sur les gros flocons proches). Coupée / figée
// si « réduire les animations », en pause quand l'onglet est caché.
(function () {
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Ampoules DÉTECTÉES dans la photo de fond (bg.jpg) : [x %, y %, rayon px à 1672 px de large].
  const BULBS = [[12.5,0.1,7.0],[13.1,0.2,6.4],[14.7,0.3,5.7],[12.6,1.0,10.3],[11.9,0.7,5.4],[16.1,0.8,5.1],[8.3,1.2,8.9],[15.2,1.6,11.4],[22.2,1.6,9.0],[20.8,1.6,10.0],[14.2,1.6,5.1],[16.9,3.2,10.5],[7.9,3.4,6.6],[9.0,3.7,5.7],[11.0,4.0,10.4],[8.8,4.0,5.1],[8.4,4.5,10.9],[19.5,4.1,5.1],[19.8,4.1,5.4],[19.8,4.6,7.5],[19.6,4.5,5.1],[5.0,6.1,5.4],[5.2,6.6,5.7],[7.5,6.9,5.1],[7.7,7.5,12.3],[0.6,7.5,5.4],[3.1,9.4,10.3],[5.8,10.4,6.4],[5.3,11.3,9.7],[4.9,11.3,7.0],[5.6,11.3,5.1],[6.5,11.8,5.4],[6.4,12.3,6.8],[11.2,12.8,6.6],[10.3,14.9,7.5],[12.1,14.9,6.2],[10.6,15.4,7.8],[11.7,15.8,11.6],[15.0,15.8,8.5],[12.9,16.2,6.4],[19.6,16.3,6.6],[17.2,16.7,10.0],[9.8,16.6,8.4],[12.3,16.4,5.4],[13.5,16.5,6.6],[13.1,17.1,11.7],[19.5,16.7,6.6],[10.1,17.0,5.1],[7.2,17.4,6.4],[18.0,17.2,5.4],[7.7,17.7,10.5],[9.5,17.3,7.5],[14.1,17.4,7.9],[16.6,17.4,5.9],[9.8,17.6,5.1],[23.2,17.7,7.2],[90.8,17.7,5.4],[18.1,18.2,5.9],[18.6,18.5,10.9],[20.7,18.1,5.1],[16.6,18.2,5.1],[19.9,18.2,5.7],[20.4,18.2,6.2],[16.5,18.4,5.1],[19.3,18.6,8.4],[15.4,18.6,6.2],[16.0,18.7,7.3],[20.0,18.9,10.9],[21.6,18.9,9.7],[17.7,18.7,5.7],[24.4,18.9,8.8],[16.3,18.8,5.1],[16.1,19.2,7.9],[91.7,19.0,5.4],[20.2,19.7,5.9],[13.1,20.1,6.4],[14.0,20.2,5.7],[23.8,20.3,6.4],[20.2,20.6,8.4],[20.8,20.5,5.1],[13.4,20.9,10.5],[23.8,20.6,5.7],[21.6,21.1,8.1],[22.9,21.2,5.4],[22.6,21.2,5.1],[91.0,21.2,5.1],[92.8,21.9,10.1],[90.6,22.5,7.8],[92.2,22.5,6.4],[7.2,22.6,5.1],[8.1,23.2,5.1],[92.4,23.4,5.9],[91.5,23.7,5.1],[92.1,24.2,7.0],[93.2,25.1,7.3],[95.6,25.8,5.1],[92.5,26.3,5.1],[91.6,26.6,5.1],[93.3,27.6,12.5],[92.9,28.1,5.7],[93.4,28.3,6.6],[5.7,28.6,6.4],[0.9,28.8,7.6],[95.8,28.7,5.1],[5.7,29.0,5.4],[90.0,29.0,5.7],[92.9,29.0,6.6],[89.6,29.6,7.3],[6.5,29.6,5.9],[16.6,29.8,7.3],[92.8,29.7,5.1],[17.8,29.8,6.2],[92.2,30.3,10.1],[3.1,31.2,11.0],[93.2,30.9,7.2],[95.0,31.1,7.2],[93.9,31.7,11.7],[16.4,31.7,9.9],[13.8,31.7,8.8],[6.8,31.6,6.6],[9.4,31.7,6.8],[93.2,31.5,6.2],[6.4,32.0,9.0],[88.9,31.9,5.9],[92.9,31.9,5.1],[9.2,32.1,5.4],[90.0,32.4,6.2],[92.6,32.4,7.5],[6.5,32.9,7.2],[0.6,33.2,6.6],[6.4,33.5,8.2],[95.5,33.2,5.1],[95.8,33.4,5.1],[91.4,33.4,5.1],[98.2,33.5,5.1],[93.9,34.0,8.1],[94.4,34.6,10.2],[8.3,34.6,5.4],[1.4,34.9,6.4],[0.6,35.1,7.5],[8.3,34.9,5.1],[0.9,35.2,8.1],[8.1,35.3,7.5],[7.9,35.8,6.6],[93.5,35.7,5.4],[92.0,35.9,5.1],[2.8,36.2,8.2],[7.8,36.2,6.8],[1.4,36.4,6.2],[10.8,36.7,6.2],[93.4,36.5,7.0],[8.0,36.9,9.7],[89.2,36.7,5.4],[9.6,37.3,5.7],[94.6,37.2,5.4],[5.8,37.4,5.1],[94.9,37.6,9.6],[4.2,37.5,5.7],[93.5,38.0,9.8],[5.0,37.6,5.4],[89.0,37.6,5.1],[94.5,38.0,7.6],[88.4,37.9,5.4],[89.2,38.0,5.4],[11.3,38.3,7.0],[15.5,38.2,8.1],[4.4,38.6,10.7],[15.2,38.6,9.1],[93.1,38.4,5.4],[88.2,38.8,8.9],[89.0,38.6,5.4],[8.2,38.6,5.1],[93.8,38.6,5.4],[16.0,38.9,6.8],[82.5,39.0,5.9],[93.8,39.7,7.5],[14.5,40.2,6.8],[95.4,40.3,7.9],[19.2,41.4,9.6],[91.6,41.2,5.4],[92.0,41.5,7.8],[96.7,42.3,13.0],[13.3,42.3,5.1],[96.0,42.4,7.3],[26.8,42.6,11.0],[28.2,43.2,7.5],[57.7,43.1,5.7],[96.9,43.3,5.4],[89.2,43.7,7.0],[89.6,43.6,5.9],[97.2,43.5,5.4],[26.7,43.6,5.1],[89.5,44.3,9.2],[93.1,44.5,8.6],[96.3,44.2,5.1],[89.9,44.7,7.3],[92.6,44.9,6.2],[90.8,45.5,12.5],[91.2,45.0,7.6],[89.3,45.2,5.9],[94.7,45.1,5.7],[52.6,45.3,7.2],[96.3,45.3,5.9],[94.9,45.4,5.1],[94.7,45.7,5.1],[89.1,46.0,7.0],[88.3,46.1,5.9],[88.5,46.6,7.2],[96.4,46.8,7.6],[52.1,46.8,6.2],[88.0,46.8,7.5],[17.7,46.9,7.3],[92.5,46.9,6.4],[92.2,47.9,10.6],[91.2,47.8,6.2],[91.8,47.9,6.8],[51.5,47.9,5.7],[96.5,47.9,5.1],[57.5,48.0,7.2],[91.4,48.5,6.8],[88.9,48.5,5.1],[88.0,48.7,5.1],[92.2,48.8,6.6],[93.0,49.0,6.6],[92.5,49.5,12.6],[90.9,50.3,5.1],[18.1,52.0,8.2],[89.8,51.8,5.1],[94.0,52.3,11.4],[97.5,52.4,7.5],[87.6,52.7,11.3],[20.9,53.0,9.2],[88.1,52.7,5.1],[88.9,52.7,5.4],[88.5,52.8,6.4],[94.9,53.2,5.9],[95.6,53.7,9.1],[23.7,54.0,9.1],[25.8,53.9,9.8],[27.4,54.0,9.0],[93.9,53.8,5.7],[14.0,54.3,10.5],[21.9,54.2,10.1],[28.9,54.1,5.1],[95.8,54.2,7.5],[20.3,54.6,11.7],[93.6,54.5,7.3],[15.6,54.5,7.9],[22.2,54.5,5.9],[20.9,54.7,5.9],[16.6,54.9,5.7],[18.0,55.7,11.0],[90.2,55.6,5.7],[97.9,55.5,5.7],[94.5,55.9,5.4],[19.2,56.4,11.0],[22.6,56.2,7.2],[17.4,56.5,10.7],[14.4,56.7,5.9],[91.6,56.9,8.6],[90.2,57.3,10.9],[87.6,57.2,7.6],[89.2,57.0,5.1],[93.7,57.4,8.5],[16.8,57.6,10.1],[95.4,57.8,9.7],[95.8,57.7,8.1],[14.2,57.7,5.4],[90.7,57.8,6.6],[96.1,57.8,5.4],[96.3,58.2,5.1],[91.4,58.7,5.9],[90.6,59.1,7.9],[87.2,58.9,5.7],[94.9,59.5,11.2],[96.1,59.0,5.4],[97.4,59.5,5.4],[86.4,59.6,6.8],[92.0,59.7,5.1],[94.1,59.7,5.7],[90.7,59.9,5.7],[13.3,60.7,10.1],[12.6,61.0,5.9],[93.3,61.0,5.4],[97.4,61.0,5.1],[96.2,61.7,13.0],[95.5,61.4,6.2],[91.3,61.7,5.1],[94.3,62.1,5.4],[96.4,62.9,8.2],[97.6,62.6,7.2],[97.9,63.0,6.4],[94.0,63.2,9.8],[98.3,63.2,7.5],[95.5,63.6,10.0],[96.7,63.6,7.9],[97.1,63.5,5.7],[90.9,63.9,9.9],[87.4,63.6,5.9],[97.2,63.9,6.6],[99.3,63.9,5.1],[90.6,64.1,5.4],[89.3,64.1,5.7],[91.4,64.7,5.4],[97.5,64.7,5.4],[96.9,65.0,5.4],[17.6,65.1,5.1],[86.8,65.3,6.4],[93.0,65.6,8.5],[87.2,65.7,6.2],[92.6,65.8,5.4],[97.4,66.1,5.1],[89.7,66.6,5.7],[95.0,66.8,7.5],[91.5,68.3,6.4],[94.5,68.4,5.1],[93.5,69.2,12.0],[97.0,69.5,6.2],[96.8,69.8,5.4],[93.1,71.1,9.0],[91.0,71.5,7.8],[94.6,71.8,5.4],[93.3,74.5,5.1],[92.6,74.8,9.8],[90.1,75.3,10.2],[90.7,75.2,5.9],[91.5,75.1,5.4],[92.5,75.1,5.7],[86.8,76.0,9.0],[87.4,76.1,5.1]];

  // ─── Guirlandes : l'ampoule « s'éteint » vraiment ───────────────────────
  // Phase allumée : halo jaune additif par-dessus l'ampoule de la photo.
  // Phase éteinte : disque sombre (couleur du fond autour) posé SUR l'ampoule
  // et son halo → elle disparaît. Trois groupes en alternance (chenillard).
  let _lights = null;
  function makeSprite(size, stops) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d'), r = size / 2, gr = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(s => gr.addColorStop(s[0], s[1]));
    g.fillStyle = gr; g.fillRect(0, 0, size, size); return c;
  }
  function startLights(canvas, reduce) {
    const ctx = canvas.getContext('2d');
    // Petits et nets : noyau blanc-jaune serré, halo court ; disque d'extinction à bord franc.
    const on = makeSprite(64, [[0, 'rgba(255,252,225,1)'], [.3, 'rgba(255,222,120,.95)'], [.55, 'rgba(255,180,60,.28)'], [1, 'rgba(255,150,30,0)']]);

    const items = BULBS.filter(b => b[2] <= 9.5).map((b, i) => ({ x: b[0] / 100, y: b[1] / 100, r: b[2], grp: i % 3, ph: Math.random() * 6.28, sp: 0.9 + Math.random() * 0.5 }));
    let W = 0, H = 0, dpr = 1, raf = 0, t0 = performance.now();
    // Extinction RÉELLE : bg-off.jpg = la photo dont les ampoules ont été effacées (remplies par
    // les pixels voisins). Pour chaque ampoule on prélève un petit patch de cette version « éteinte »
    // (bord fondu) et on le fait apparaître par-dessus la photo : l'ampoule disparaît vraiment
    // au lieu qu'un point sombre vienne se poser dessus.
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      items.forEach(it => {
        const q = Math.max(5, (it.r - 3) / 2.1) * 3.2;         // rayon du patch, en px de l'image source
        const size = Math.ceil(q * 2), p = document.createElement('canvas'); p.width = p.height = size;
        const pg = p.getContext('2d');
        pg.drawImage(c, it.x * c.width - q, it.y * c.height - q, q * 2, q * 2, 0, 0, size, size);
        pg.globalCompositeOperation = 'destination-in';       // masque radial : cœur opaque, bord transparent
        const gr = pg.createRadialGradient(q, q, 0, q, q, q);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.6, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        pg.fillStyle = gr; pg.fillRect(0, 0, size, size);
        it.off = p; it.q = q;
      });
    };
    img.src = 'images/skin-noel2/bg-off.jpg';
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(now) {
      const sw = Math.max(W, H * 16 / 9), sh = sw * 9 / 16, ox = (W - sw) / 2, oy = (H - sh) / 2, k = sw / 1672;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      for (const it of items) {
        // phase d'allumage 0..1 : plateau allumé, bascule rapide vers éteint, groupes décalés
        const v = Math.sin(t * it.sp * 1.25 + it.grp * 2.09 + it.ph * 0.18);
        const lit = reduce ? 1 : Math.min(1, Math.max(0, 0.5 + v * 3.2));
        const x = ox + it.x * sw, y = oy + it.y * sh, rad = Math.max(1.6, (it.r - 3) / 2.1 * k);
        if (lit < 0.98 && it.off) {
          const d = it.q * k; ctx.globalAlpha = 1 - lit; ctx.globalCompositeOperation = 'source-over';
          ctx.drawImage(it.off, x - d, y - d, d * 2, d * 2);
        }
        if (lit > 0.02) {
          const d = rad * 2.4; ctx.globalAlpha = lit * 0.8; ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(on, x - d, y - d, d * 2, d * 2);
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    function loop(now) { draw(now); raf = requestAnimationFrame(loop); }
    const onVis = () => { cancelAnimationFrame(raf); if (!document.hidden && !reduce) raf = requestAnimationFrame(loop); };
    const onResize = () => { resize(); if (reduce) draw(performance.now()); };
    resize(); window.addEventListener('resize', onResize); document.addEventListener('visibilitychange', onVis);
    if (reduce) draw(performance.now()); else raf = requestAnimationFrame(loop);
    _lights = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis); } };
  }
  function stopLights() { if (_lights) { _lights.stop(); _lights = null; } }

  // ─── Neige avec vent ────────────────────────────────────────────────────
  let _snow = null;
  function startSnow(canvas) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, raf = 0, last = 0, t0 = performance.now();
    const COUNT = reduce ? 60 : 170;
    const flakes = [];

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(f, anywhere) {
      const depth = Math.random();              // 0 = loin (petit, lent) → 1 = proche (gros, rapide)
      f.depth = depth;
      f.r = 0.9 + depth * depth * 3.4;
      f.vy = 22 + depth * 62;                    // px/s
      f.sway = rnd(8, 26) * (0.5 + depth);       // amplitude du balancement
      f.phase = rnd(0, 6.28); f.freq = rnd(0.5, 1.4);
      f.a = 0.45 + depth * 0.5;
      f.x = rnd(-80, W + 80);
      f.y = anywhere ? rnd(-20, H) : rnd(-30, -4);
    }
    resize();
    for (let i = 0; i < COUNT; i++) { const f = {}; spawn(f, true); flakes.push(f); }

    // Vent : fond léger + deux rafales de périodes différentes (px/s, > 0 = vers la droite).
    function wind(t) {
      const s = t / 1000;
      const base = 20 + 10 * Math.sin(s * 0.21);
      const gust = Math.max(0, Math.sin(s * 0.37)) ** 2 * 46 + Math.max(0, Math.sin(s * 0.91 + 1.7)) ** 3 * 24;
      return base + gust;
    }
    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
      const w = wind(now - t0);
      ctx.clearRect(0, 0, W, H);
      for (const f of flakes) {
        f.phase += f.freq * dt;
        f.x += (w * (0.35 + f.depth * 0.9) + Math.cos(f.phase) * f.sway * 0.6) * dt;
        f.y += f.vy * dt + Math.sin(f.phase * 0.7) * 4 * dt;
        if (f.y > H + 8 || f.x > W + 90 || f.x < -90) spawn(f, false);
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 1.6);
        g.addColorStop(0, `rgba(255,255,255,${f.a})`);
        g.addColorStop(0.55, `rgba(240,247,255,${f.a * 0.8})`);
        g.addColorStop(1, 'rgba(235,244,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.6, 0, 6.2832); ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) { last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    if (reduce) frame(performance.now()), cancelAnimationFrame(raf);
    else raf = requestAnimationFrame(frame);
    _snow = { stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); } };
  }

  function stopSnow() { if (_snow) { _snow.stop(); _snow = null; } }

  const IMG = 'images/skin-noel2/';

  window.SEASON_PACKS = window.SEASON_PACKS || {};
  window.SEASON_PACKS['noel'] = {
    build() {
      this.clear();
      if (!document.body) return;
      document.body.insertAdjacentHTML('afterbegin', `
        <div id="season-sky" class="season-sky nz-sky" aria-hidden="true">
          <div class="nz-stage"><div class="nz-bg"></div></div>
          <canvas id="nz-lights" class="nz-lights"></canvas>
          <div class="nz-veil"></div>
          <canvas id="nz-snow" class="nz-snow"></canvas>
        </div>`);
      document.body.insertAdjacentHTML('beforeend', `
        <div id="season-props" class="nz-props" aria-hidden="true">
          <i class="nz-props-glow"></i>
          <img src="${IMG}props.png" alt="">
        </div>`);
      startLights(document.getElementById('nz-lights'), !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));
      startSnow(document.getElementById('nz-snow'));
    },
    clear() {
      stopSnow(); stopLights();
      ['season-sky', 'season-props'].forEach(id => document.getElementById(id)?.remove());
    },
  };
})();
