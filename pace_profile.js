const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const FitParser = require('fit-file-parser').default || require('fit-file-parser');
const { getGarminClient, getActivities } = require('./garmin_client');
const { getZoneRange } = require('./zones');

const DATA_DIR = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const PACE_PROFILE_FILE = path.join(DATA_DIR, 'pace_profile.json');

const PROFILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const ACTIVITIES_TO_SAMPLE = 6;

// Seuils de pente valides empiriquement (session de recherche BRouter) :
// une allure unique se trompait de 40%+ sur la duree reelle d'une sortie
// avec devers marques, d'ou ce decoupage par tranche.
const GRADIENT_BUCKETS = [
  { key: 'downhill', max: -0.02 },
  { key: 'flat', max: 0.02 },
  { key: 'moderate', max: 0.08 },
  { key: 'steep', max: Infinity },
];

// Repli generique (non personnalise) utilise tant qu'aucun profil reel n'a
// ete calcule - permet a route_generator de produire une estimation des le
// premier lancement, sans bloquer sur un appel Garmin.
const GENERIC_FALLBACK_PACE = { downhill: 7.5, flat: 6.5, moderate: 8.5, steep: 11.5 };

function bucketForGrade(grade) {
  for (const b of GRADIENT_BUCKETS) { if (grade < b.max) return b.key; }
  return 'steep';
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return fallback; }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeJsonSafe(filePath, data, retries = 5) {
  const payload = JSON.stringify(data, null, 2);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(filePath, payload, 'utf8');
      return true;
    } catch (e) {
      if (attempt === retries) { console.error('Erreur ecriture', filePath, e.message); return false; }
      sleepSync(150 * attempt);
    }
  }
  return false;
}

// Cloisonnement par compte (voir server.js: readScoped/writeScoped) - deux
// comptes Garmin utilises successivement sur la meme machine ne doivent
// jamais partager le meme profil d'allure.
function readScoped(filePath, email, fallback) {
  const all = readJsonSafe(filePath, {});
  const v = all && typeof all === 'object' ? all[(email || '').toLowerCase()] : undefined;
  return v !== undefined ? v : fallback;
}
function writeScoped(filePath, email, data) {
  const all = readJsonSafe(filePath, {});
  all[(email || '').toLowerCase()] = data;
  writeJsonSafe(filePath, all);
}

const R_EARTH = 6371000;
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

// Decoupe une activite en segments (fusionnes jusqu'a >=15m pour lisser le
// bruit GPS), accumule distance/temps par tranche de pente.
function accumulateByGradient(records, buckets) {
  const pts = records
    .filter(r => r.position_lat != null && r.position_long != null && r.enhanced_altitude != null && r.timestamp)
    .map(r => ({ lat: r.position_lat, lon: r.position_long, ele: r.enhanced_altitude, t: new Date(r.timestamp).getTime() }));

  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    let segDist = haversine(pts[i], pts[j]);
    while (segDist < 15 && j < pts.length - 1) { j++; segDist = haversine(pts[i], pts[j]); }
    const segTimeMin = (pts[j].t - pts[i].t) / 60000;
    if (segTimeMin > 0 && segDist > 0) {
      const grade = (pts[j].ele - pts[i].ele) / segDist;
      const bucket = bucketForGrade(grade);
      buckets[bucket].distM += segDist;
      buckets[bucket].timeMin += segTimeMin;
    }
    i = j;
  }
}

async function downloadAndParseFit(client, activity, tmpDir) {
  await client.downloadOriginalActivityData(activity, tmpDir);
  const files = fs.readdirSync(tmpDir).filter(f => f.includes(String(activity.activityId)));
  const zipFile = files.find(f => f.endsWith('.zip'));
  let fitBuffer = null;
  if (zipFile) {
    const zip = new AdmZip(path.join(tmpDir, zipFile));
    const entry = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.fit'));
    if (entry) fitBuffer = entry.getData();
  } else {
    const fitFile = files.find(f => f.endsWith('.fit'));
    if (fitFile) fitBuffer = fs.readFileSync(path.join(tmpDir, fitFile));
  }
  files.forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch (e) {} });
  if (!fitBuffer) return [];
  const parser = new FitParser({ mode: 'list' });
  const data = await parser.parseAsync(fitBuffer);
  return data.records || [];
}

// Recalcule le profil d'allure/pente a partir des dernieres activites de
// course a pied reelles de l'utilisateur (trail_running en priorite).
// Operation lente (telechargement + parsing FIT par activite) - a appeler
// explicitement (bouton "Recalculer"), jamais en bloquant une requete de
// generation d'itineraire.
async function refreshPaceProfile(email, sampleSize = ACTIVITIES_TO_SAMPLE) {
  const client = await getGarminClient();
  const activities = await getActivities();

  const running = activities.filter(a => {
    const key = a.activityType?.typeKey || '';
    return (key.includes('running') || key.includes('trail')) && a.distance > 2000;
  });
  const trail = running.filter(a => (a.activityType?.typeKey || '').includes('trail'));
  const chosen = (trail.length >= 3 ? trail : running).slice(0, sampleSize);

  if (chosen.length === 0) {
    throw new Error('Aucune activite de course exploitable trouvee sur Garmin Connect.');
  }

  const buckets = {
    downhill: { distM: 0, timeMin: 0 },
    flat: { distM: 0, timeMin: 0 },
    moderate: { distM: 0, timeMin: 0 },
    steep: { distM: 0, timeMin: 0 },
  };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allureplus-pace-'));
  const usedActivityIds = [];
  try {
    for (const activity of chosen) {
      try {
        const records = await downloadAndParseFit(client, activity, tmpDir);
        if (records.length > 20) {
          accumulateByGradient(records, buckets);
          usedActivityIds.push(activity.activityId);
        }
      } catch (e) {
        console.error('Profil allure: activite ignoree', activity.activityId, e.message);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  if (usedActivityIds.length === 0) {
    throw new Error('Aucune activite n\'a pu etre analysee (donnees FIT insuffisantes).');
  }

  const paceMinPerKm = {};
  for (const key of Object.keys(buckets)) {
    const b = buckets[key];
    paceMinPerKm[key] = b.distM > 500 ? (b.timeMin / (b.distM / 1000)) : GENERIC_FALLBACK_PACE[key];
  }

  const profile = {
    computedAt: new Date().toISOString(),
    activitiesUsed: usedActivityIds,
    sampleDistanceKm: Object.values(buckets).reduce((s, b) => s + b.distM, 0) / 1000,
    paceMinPerKm,
  };
  writeScoped(PACE_PROFILE_FILE, email, profile);
  return profile;
}

// Lecture seule, rapide, sans appel reseau - a utiliser dans le chemin de
// generation d'itineraire.
function getPaceProfile(email) {
  const cached = readScoped(PACE_PROFILE_FILE, email, null);
  if (cached && cached.paceMinPerKm) {
    const ageMs = Date.now() - new Date(cached.computedAt).getTime();
    return { ...cached, isStale: ageMs > PROFILE_MAX_AGE_MS, isGeneric: false };
  }
  return { paceMinPerKm: GENERIC_FALLBACK_PACE, isStale: true, isGeneric: true, computedAt: null };
}

// Migration ponctuelle du fichier existant (a plat, un seul profil pour toute
// la machine) vers le format cloisonne par compte {[email]: profil} - a
// appeler une fois au demarrage du serveur (voir server.js), avant tout appel
// a getPaceProfile/refreshPaceProfile. Idempotent.
function migratePaceProfileToScoped(envEmail) {
  if (!envEmail) return;
  const raw = readJsonSafe(PACE_PROFILE_FILE, null);
  if (raw === null) return;
  const looksScoped = typeof raw === 'object' && Object.keys(raw).every(k => k.includes('@'));
  if (looksScoped) return;
  writeJsonSafe(PACE_PROFILE_FILE, { [envEmail.toLowerCase()]: raw });
}

// VMA (km/h) depuis le VO2max - meme formule que le reste de l'app
// (server.js /api/fitness-zones, health.js) : VMA = (VO2max - 3.5) / 0.2
// (mL/kg/min -> m/min), converti en km/h.
function vmaFromVo2max(vo2max) {
  return vo2max ? (vo2max - 3.5) / 0.2 * 60 / 1000 : null;
}

// Allure la plus RAPIDE de la zone EF (borne haute de %VMA, cf
// ALLURE_PLUS_ZONES.EF dans zones.js) - retour utilisateur explicite (aout
// 2026, sur ses generations d'itineraires) : "pour l'allure, toujours
// prendre la plus rapide de l'utilisateur en EF" (ex: EF 6'18-7'07/km ->
// prendre 6'18/km), l'EF etant deja par definition une allure d'endurance
// facile a laquelle l'utilisateur peut courir longtemps, pas la peine de la
// sous-estimer davantage. Retourne en min/km (unite de paceMinPerKm).
function efFastPaceMinPerKm(vo2max) {
  const vma = vmaFromVo2max(vo2max);
  if (!vma) return null;
  const ef = getZoneRange('EF');
  return (3600 / (vma * ef.pctHigh)) / 60;
}

// Recale un profil d'allure par tranche de pente (paceMinPerKm, cf
// GRADIENT_BUCKETS) sur l'allure EF rapide de l'utilisateur : conserve les
// ECARTS RELATIFS entre tranches (issus de ses sorties reelles - une pente a
// 8% lui prend structurellement plus de temps qu'un plat, quel que soit son
// niveau de forme du moment), mais ancre l'allure absolue sur son EF rapide
// ACTUEL plutot que sur la moyenne tous-efforts-confondus de ses dernieres
// sorties analysees (qui peut melanger allure facile et allure de course).
// Repli silencieux sur le profil non modifie si `efPace` indisponible (VO2max
// jamais capture) ou si le profil n'a pas de tranche "flat" exploitable.
function applyEfPaceAnchor(paceMinPerKm, efPace) {
  if (!efPace || !paceMinPerKm || !paceMinPerKm.flat) return paceMinPerKm;
  const scale = efPace / paceMinPerKm.flat;
  const out = {};
  for (const key of Object.keys(paceMinPerKm)) out[key] = paceMinPerKm[key] * scale;
  return out;
}

module.exports = {
  bucketForGrade,
  getPaceProfile,
  refreshPaceProfile,
  migratePaceProfileToScoped,
  GRADIENT_BUCKETS,
  GENERIC_FALLBACK_PACE,
  vmaFromVo2max,
  efFastPaceMinPerKm,
  applyEfPaceAnchor,
};
