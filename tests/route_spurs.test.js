const test = require('node:test');
const assert = require('node:assert');
const { removeSpurs, haversineDistance } = require('../route_generator');

// 0,0003 deg de longitude ~ 22 m a cette latitude ; 0,0003 deg de latitude ~ 33 m.
const P = (lat, lon) => ({ lat, lon });
const east = (n, lat = 48, lon0 = 2) => Array.from({ length: n }, (_, k) => P(lat, lon0 + k * 0.0003));
const len = pts => pts.reduce((d, p, i) => d + (i ? haversineDistance(pts[i - 1], p) : 0), 0);

test('demi-tour a un seul sommet (aller-retour de ~85 m) supprime', () => {
  const a = east(6);
  const tip = P(48.0008, a[5].lon);
  const pts = [...a, tip, P(a[5].lat, a[5].lon), ...east(5, 48, a[5].lon + 0.0003)];
  const r = removeSpurs(pts);
  assert.strictEqual(r.removed, 1);
  assert.ok(!r.points.some(p => p.lat === tip.lat && p.lon === tip.lon));
});

test('long cul-de-sac (~1,3 km aller puis retour par les memes points) supprime', () => {
  const a = east(6);
  const out = Array.from({ length: 60 }, (_, k) => P(48 + (k + 1) * 0.0002, a[5].lon));
  const back = out.slice(0, -1).reverse().map(p => P(p.lat, p.lon));
  const pts = [...a, ...out, ...back, P(a[5].lat, a[5].lon), ...east(5, 48, a[5].lon + 0.0003)];
  const r = removeSpurs(pts);
  assert.ok(r.removed >= 1);
  assert.ok(len(r.points) < len(pts) - 2000);
});

test('repasser PLUS TARD par le meme chemin (apres une vraie boucle) est conserve', () => {
  const stem = east(10);
  const e = stem[9];
  // boucle carree d'environ 1 km autour de l'extremite de la tige, aller et retour par des cotes differents
  const loop = [];
  for (let k = 1; k <= 12; k++) loop.push(P(e.lat + k * 0.0003, e.lon));            // nord
  for (let k = 1; k <= 12; k++) loop.push(P(e.lat + 12 * 0.0003, e.lon + k * 0.0003)); // est
  for (let k = 1; k <= 12; k++) loop.push(P(e.lat + (12 - k) * 0.0003, e.lon + 12 * 0.0003)); // sud
  for (let k = 1; k <= 12; k++) loop.push(P(e.lat, e.lon + (12 - k) * 0.0003));        // ouest, retour a l'extremite
  const backStem = stem.slice(0, -1).reverse().map(p => P(p.lat, p.lon));
  const pts = [...stem, ...loop, ...backStem];
  const r = removeSpurs(pts);
  assert.strictEqual(r.removed, 0);
  assert.strictEqual(r.points.length, pts.length);
});

test('boucle simple sans demi-tour : inchangee', () => {
  const pts = [];
  for (let k = 0; k <= 10; k++) pts.push(P(48, 2 + k * 0.0004));
  for (let k = 1; k <= 10; k++) pts.push(P(48 + k * 0.0003, 2.004));
  for (let k = 1; k <= 10; k++) pts.push(P(48.003, 2.004 - k * 0.0004));
  for (let k = 1; k <= 9; k++) pts.push(P(48.003 - k * 0.0003, 2));
  const r = removeSpurs(pts);
  assert.strictEqual(r.removed, 0);
});
