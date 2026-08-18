// Client HTTP vers l'API Altimetrie de la Geoplateforme IGN (Geoportail) -
// donnees RGE ALTI (LIDAR, tres precises sur la France), utilisees pour
// calculer un D+ reel a partir du trace genere, en remplacement du D+
// estime par BRouter (base sur un MNT grossier + facteur correctif
// approximatif - source des ecarts constates par l'utilisateur, ex: 500 m
// vises, 19 m obtenus). Suit le pattern de brouter_client.js/campus_client.js
// (module autonome, fonctions exportees), fetch natif Node.
//
// Gratuit, sans cle, limite a 5 requetes/seconde par IP (largement
// suffisant ici - un usage local mono-utilisateur). Couverture France
// uniquement (source IGN), sans consequence pour Allure+ (usage trail/route
// francais).

const BASE_URL = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest';
const RESOURCE = 'ign_rge_alti_wld';

// Nombre de points par appel - reste large sous la limite de longueur d'URL
// du proxy IGN (~8000 caracteres observee ; un appel a 822 points sur une
// requete GET a echoue en "400 Bad request", un appel a 165 points a
// fonctionne sans probleme - marge prise volontairement large).
const CHUNK_SIZE = 150;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// points: [{lat, lon}, ...] dans l'ordre du trace. Renvoie le D+ (positif)
// et D- (negatif) cumules sur l'ensemble du trace, ou null si l'appel
// echoue (zone hors couverture RGE ALTI, service indisponible...) - a
// utiliser en repli sur l'estimation BRouter dans ce cas, jamais en erreur
// bloquante (fonctionnalite d'appoint, pas critique au fonctionnement).
//
// Utilise elevationLine (pas le simple elevation) : cette route est concue
// pour suivre le relief REEL entre les points fournis (mode
// profile_mode=accurate), pas seulement a chaque point - important car un
// trace BRouter peut avoir des points assez espaces sur les portions
// rectilignes, et une simple interpolation lineaire entre eux manquerait le
// relief intermediaire. Verifie empiriquement (activite Garmin reelle,
// marche vallonnee a Cassis, D+ Garmin=471m) : elevationLine/accurate donne
// 488m (ecart ~4%), contre 421m avec un calcul manuel sur les points bruts
// de la meme route (ecart ~11%) - l'ecart vient bien de cette interpolation
// terrain, pas d'une difference de source de donnees.
async function getRouteAscent(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const chunks = chunk(points, CHUNK_SIZE);
  let positive = 0;
  let negative = 0;
  try {
    for (const c of chunks) {
      const lon = c.map(p => p.lon).join('|');
      const lat = c.map(p => p.lat).join('|');
      const params = new URLSearchParams({ lon, lat, resource: RESOURCE, profile_mode: 'accurate' });
      const res = await fetch(`${BASE_URL}/elevationLine.json?${params.toString()}`);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error || !data.height_differences) return null;
      positive += data.height_differences.positive;
      negative += data.height_differences.negative;
    }
  } catch (err) {
    return null; // reseau indisponible, timeout... - l'appelant se replie sur BRouter
  }
  return { ascentM: Math.round(positive), descentM: Math.round(negative) };
}

module.exports = { getRouteAscent };
