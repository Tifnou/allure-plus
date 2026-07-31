const { GarminConnect } = require('garmin-connect');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let garminClient = null;

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {}
  return {};
}

function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Erreur sauvegarde cache:', e.message);
  }
}

function isCacheValid(cache, key) {
  if (!cache[key] || !cache[key]._timestamp) return false;
  return (Date.now() - cache[key]._timestamp) < CACHE_TTL_MS;
}

async function getGarminClient() {
  if (garminClient) return garminClient;
  
  const GC = new GarminConnect({
    username: process.env.GARMIN_EMAIL,
    password: process.env.GARMIN_PASSWORD
  });

  try {
    await GC.login();
    garminClient = GC;
    console.log('✅ Connecté à Garmin Connect');
    return GC;
  } catch (err) {
    console.error('❌ Erreur connexion Garmin:', err.message);
    throw new Error('Impossible de se connecter à Garmin Connect. Vérifiez vos credentials dans .env');
  }
}

async function getCachedData(key, fetchFn) {
  const cache = loadCache();

  if (isCacheValid(cache, key)) {
    console.log(`📦 Cache utilisé pour: ${key}`);
    return cache[key].data;
  }

  console.log(`🌐 Fetch Garmin pour: ${key}`);
  const data = await fetchFn();
  cache[key] = { _timestamp: Date.now(), data };
  saveCache(cache);
  return data;
}

// ─────────────────────────────────────────────
// Fonctions de récupération des données
// ─────────────────────────────────────────────

async function getActivities() {
  return getCachedData('activities_all', async () => {
    const client = await getGarminClient();
    const PAGE = 100;
    let all = [];
    let start = 0;
    while (true) {
      const page = await client.getActivities(start, PAGE);
      if (!page || page.length === 0) break;
      all = all.concat(page);
      if (page.length < PAGE) break;
      start += PAGE;
      if (all.length >= 5000) break;
    }
    return all;
  });
}

async function getUserProfile() {
  return getCachedData('profile', async () => {
    const gc = await getGarminClient();
    return gc.getUserProfile();
  });
}

async function getHeartRateData(days = 7) {
  return getCachedData(`heartrate_${days}`, async () => {
    const gc = await getGarminClient();
    const results = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      try {
        const hr = await gc.getHeartRate(d);
        if (hr) results.push({ date: d.toISOString().split('T')[0], data: hr });
      } catch (e) {}
    }
    return results;
  });
}

async function getVO2MaxData() {
  return getCachedData('vo2max', async () => {
    // La lib garmin-connect n'a pas de méthode dédiée VO2max.
    // On l'extrait directement depuis les activités de course.
    const gc = await getGarminClient();
    const activities = await gc.getActivities(0, 200);
    return activities
      .filter(a =>
        (a.activityType?.typeKey?.toLowerCase().includes('running') ||
         a.activityType?.typeKey?.toLowerCase().includes('trail')) &&
        a.vO2MaxValue && a.vO2MaxValue > 0
      )
      .map(a => ({
        calendarDate: (a.startTimeLocal || '').split('T')[0] || (a.startTimeLocal || '').split(' ')[0],
        vo2max: a.vO2MaxValue
      }))
      .sort((a, b) => new Date(a.calendarDate) - new Date(b.calendarDate));
  });
}

// VO2max precis (non arrondi) : Garmin affiche un entier (ex: 49) mais classe
// en interne sur la valeur precise (ex: 48.8), d'ou des categories qui peuvent
// paraitre incoherentes avec la valeur arrondie affichee. Endpoint non expose
// par la lib garmin-connect, appele directement via son client HTTP generique.
async function getVO2MaxPrecise() {
  return getCachedData('vo2max_precise', async () => {
    const gc = await getGarminClient();
    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const today = new Date();
    const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const url = `https://connectapi.garmin.com/metrics-service/metrics/maxmet/daily/${fmt(past)}/${fmt(today)}`;
    try {
      const res = await gc.get(url);
      const withValue = (Array.isArray(res) ? res : [])
        .filter(r => r.generic && typeof r.generic.vo2MaxPreciseValue === 'number')
        .sort((a, b) => new Date(b.generic.calendarDate) - new Date(a.generic.calendarDate));
      if (withValue.length === 0) return null;
      return {
        calendarDate: withValue[0].generic.calendarDate,
        vo2MaxPreciseValue: withValue[0].generic.vo2MaxPreciseValue,
        vo2MaxValue: withValue[0].generic.vo2MaxValue
      };
    } catch (e) {
      console.log('VO2max precis indisponible:', e.message);
      return null;
    }
  });
}

async function getSleepData(days = 30) {
  return getCachedData(`sleep_${days}`, async () => {
    const gc = await getGarminClient();

    // Construire la liste des dates (aujourd'hui inclus)
    const dates = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const year  = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day   = String(d.getDate()).padStart(2, '0');
      dates.push({ dateStr: `${year}-${month}-${day}`, d });
    }

    // Fetch PARALLÈLE (toutes les dates en même temps)
    const fetches = dates.map(async ({ dateStr, d }) => {
      try {
        const sleepUrl = gc.url?.DAILY_SLEEP;
        let sleep;
        if (sleepUrl && gc.client) {
          sleep = await gc.client.get(sleepUrl, { params: { date: dateStr } });
        } else {
          sleep = await gc.getSleepData(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
        }
        if (!sleep) return null;
        const s = sleep.dailySleepDTO || sleep;
        const sleepSec = s.sleepTimeSeconds || s.totalSleepSeconds || 0;
        if (sleepSec <= 0) return null;
        return {
          date: dateStr,
          calendarDate: s.calendarDate || dateStr,
          sleepTimeSeconds: sleepSec,
          deepSleepSeconds:  s.deepSleepSeconds  || 0,
          lightSleepSeconds: s.lightSleepSeconds || 0,
          remSleepSeconds:   s.remSleepSeconds   || 0,
        };
      } catch (e) {
        console.log(`💤 Sleep ${dateStr}: ${e.message?.slice(0,60) || 'vide'}`);
        return null;
      }
    });

    const settled = await Promise.allSettled(fetches);
    const results = settled
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => a.date.localeCompare(b.date));

    console.log(`💤 Sleep: ${results.length} nuits trouvées sur ${days} jours`);
    return results;
  });
}


// ─────────────────────────────────────────────
// Calculs / agrégations
// ─────────────────────────────────────────────

function computeStats(activities) {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  // Activités de l'année
  const thisYear = activities.filter(a => new Date(a.startTimeLocal) >= startOfYear);

  // KM totaux année (toutes activités)
  const totalKmYear = thisYear.reduce((sum, a) => sum + (a.distance || 0), 0) / 1000;

  // Activités CAP (running)
  const runActivities = thisYear.filter(a =>
    a.activityType?.typeKey?.toLowerCase().includes('running') ||
    a.activityType?.typeKey?.toLowerCase().includes('trail')
  );
  const totalKmRunYear = runActivities.reduce((sum, a) => sum + (a.distance || 0), 0) / 1000;

  // Nombre d'activités
  const totalActivitiesYear = thisYear.length;

  // Jours sans activité consécutifs
  let daysSinceLastActivity = 0;
  if (activities.length > 0) {
    const lastDate = new Date(activities[0].startTimeLocal);
    const diffMs = now - lastDate;
    daysSinceLastActivity = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  // Temps total entraînement (heures)
  const totalTimeHours = thisYear.reduce((sum, a) => sum + (a.duration || 0), 0) / 3600;

  // Répartition par sport
  const sportBreakdown = {};
  thisYear.forEach(a => {
    const type = a.activityType?.typeKey || 'other';
    if (!sportBreakdown[type]) sportBreakdown[type] = { count: 0, km: 0 };
    sportBreakdown[type].count++;
    sportBreakdown[type].km += (a.distance || 0) / 1000;
  });

  // VO2max depuis les activités
  const vo2maxSeries = activities
    .filter(a =>
      (a.activityType?.typeKey?.toLowerCase().includes('running') ||
       a.activityType?.typeKey?.toLowerCase().includes('trail')) &&
      a.vO2MaxValue && a.vO2MaxValue > 0
    )
    .map(a => ({
      date: (a.startTimeLocal || '').split('T')[0] || (a.startTimeLocal || '').split(' ')[0],
      value: a.vO2MaxValue
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const latestVO2Max = vo2maxSeries.length > 0 ? vo2maxSeries[vo2maxSeries.length - 1].value : null;
  const heatmap = {};
  const yearAgo = new Date(now);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  activities
    .filter(a => new Date(a.startTimeLocal) >= yearAgo)
    .forEach(a => {
      const day = a.startTimeLocal?.split('T')[0] || a.startTimeLocal?.split(' ')[0];
      if (day) {
        if (!heatmap[day]) heatmap[day] = 0;
        heatmap[day]++;
      }
    });

  return {
    totalKmYear: Math.round(totalKmYear * 10) / 10,
    totalKmRunYear: Math.round(totalKmRunYear * 10) / 10,
    totalActivitiesYear,
    daysSinceLastActivity,
    totalTimeHours: Math.round(totalTimeHours * 10) / 10,
    sportBreakdown,
    heatmap,
    vo2maxSeries,
    latestVO2Max
  };
}

function getLastRunActivities(activities, limit = 10) {
  return activities
    .filter(a =>
      a.activityType?.typeKey?.toLowerCase().includes('running') ||
      a.activityType?.typeKey?.toLowerCase().includes('trail')
    )
    .slice(0, limit)
    .map(a => ({
      id: a.activityId,
      date: a.startTimeLocal,
      name: a.activityName,
      distanceKm: Math.round((a.distance || 0) / 10) / 100,
      durationSec: a.duration,
      avgPaceSecPerKm: a.distance > 0 ? (a.duration / (a.distance / 1000)) : null,
      avgHR: a.averageHR,
      maxHR: a.maxHR,
      elevationGain: a.elevationGain,
      calories: a.calories,
      activityType: a.activityType?.typeKey,
      vO2MaxValue: a.vO2MaxValue
    }));
}

function getPersonalRecords(activities) {
  const runActivities = activities.filter(a =>
    a.activityType?.typeKey?.toLowerCase().includes('running') ||
    a.activityType?.typeKey?.toLowerCase().includes('trail')
  );

  const distances = {
    '1km': { threshold: 900, max: 1100, best: null },
    '5km': { threshold: 4500, max: 5500, best: null },
    '10km': { threshold: 9000, max: 11000, best: null },
    'semi': { threshold: 19000, max: 22000, best: null },
    'marathon': { threshold: 40000, max: 43500, best: null }
  };

  runActivities.forEach(a => {
    const dist = a.distance || 0;
    Object.keys(distances).forEach(key => {
      const { threshold, max } = distances[key];
      if (dist >= threshold && dist <= max) {
        const pace = a.duration / (dist / 1000);
        if (!distances[key].best || pace < distances[key].best.pace) {
          distances[key].best = {
            pace,
            date: a.startTimeLocal,
            duration: a.duration,
            distance: dist,
            name: a.activityName
          };
        }
      }
    });
  });

  return distances;
}


// ─────────────────────────────────────────────
// buildGarminFunctions — fonctions par session
// ─────────────────────────────────────────────

function buildGarminFunctions(gc) {
  // Cache en mémoire propre à chaque session (pas de fichier partagé)
  const cache = {};
  const TTL = 30 * 60 * 1000;

  function isFresh(key) {
    return cache[key] && (Date.now() - cache[key].ts) < TTL;
  }
  async function cached(key, fn) {
    if (isFresh(key)) return cache[key].data;
    const data = await fn();
    cache[key] = { ts: Date.now(), data };
    return data;
  }

  async function getActivities(limit = 100) {
    // Rapide : retourne seulement les N dernieres activites
    return cached(`acts_${limit}`, () => gc.getActivities(0, limit));
  }

  async function getActivitiesForYear(year) {
    // Chargement à la demande : pagine jusqu'à trouver toutes les activites de l'année
    return cached(`acts_year_${year}`, async () => {
      const PAGE = 100;
      const yStart = new Date(`${year}-01-01T00:00:00`).getTime();
      const yEnd   = new Date(`${year}-12-31T23:59:59`).getTime();
      const all = [];
      let start = 0;

      while (true) {
        const page = await gc.getActivities(start, PAGE);
        if (!page || page.length === 0) break;

        let passedYear = false;
        for (const act of page) {
          const ts = new Date(act.startTimeLocal || act.startTimeGMT || '').getTime();
          if (ts >= yStart && ts <= yEnd) {
            all.push(act);
          } else if (ts < yStart) {
            passedYear = true;
            break;
          }
          // ts > yEnd → activite trop recente, continuer
        }
        if (passedYear) break;
        if (page.length < PAGE) break;
        start += PAGE;
        if (start > 10000) break; // securite
      }
      return all;
    });
  }
  async function getUserProfile() {
    return cached('profile', () => gc.getUserProfile());
  }
  async function getHeartRateData(days = 7) {
    return cached(`hr_${days}`, async () => {
      const results = [];
      const today = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        try {
          const hr = await gc.getHeartRate(d);
          if (hr) results.push({ date: d.toISOString().split('T')[0], data: hr });
        } catch (e) {}
      }
      return results;
    });
  }
  async function getVO2MaxData() {
    return cached('vo2max', async () => {
      const activities = await gc.getActivities(0, 200);
      return activities
        .filter(a => (a.activityType?.typeKey?.toLowerCase().includes('running') ||
                      a.activityType?.typeKey?.toLowerCase().includes('trail')) &&
                     a.vO2MaxValue && a.vO2MaxValue > 0)
        .map(a => ({
          calendarDate: (a.startTimeLocal || '').split('T')[0] || (a.startTimeLocal || '').split(' ')[0],
          vo2max: a.vO2MaxValue
        }))
        .sort((a, b) => new Date(a.calendarDate) - new Date(b.calendarDate));
    });
  }
  async function getVO2MaxPrecise() {
    return cached('vo2max_precise', async () => {
      const fmt = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      };
      const today = new Date();
      const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      const url = `https://connectapi.garmin.com/metrics-service/metrics/maxmet/daily/${fmt(past)}/${fmt(today)}`;
      try {
        const res = await gc.get(url);
        const withValue = (Array.isArray(res) ? res : [])
          .filter(r => r.generic && typeof r.generic.vo2MaxPreciseValue === 'number')
          .sort((a, b) => new Date(b.generic.calendarDate) - new Date(a.generic.calendarDate));
        if (withValue.length === 0) return null;
        return {
          calendarDate: withValue[0].generic.calendarDate,
          vo2MaxPreciseValue: withValue[0].generic.vo2MaxPreciseValue,
          vo2MaxValue: withValue[0].generic.vo2MaxValue
        };
      } catch (e) {
        console.log('VO2max precis indisponible:', e.message);
        return null;
      }
    });
  }
  async function getSleepData(days = 30) {
    return cached(`sleep_${days}`, async () => {
      // Construire toutes les dates (aujourd'hui inclus i=0)
      const dates = [];
      for (let i = 0; i <= days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const year  = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day   = String(d.getDate()).padStart(2, '0');
        dates.push({ dateStr: `${year}-${month}-${day}`, d });
      }

      // Fetch parallèle
      const fetches = dates.map(async ({ dateStr, d }) => {
        try {
          const sleepUrl = gc.url?.DAILY_SLEEP;
          let sleep;
          if (sleepUrl && gc.client) {
            sleep = await gc.client.get(sleepUrl, { params: { date: dateStr } });
          } else {
            sleep = await gc.getSleepData(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0));
          }
          if (!sleep) return null;
          const s = sleep.dailySleepDTO || sleep;
          const sleepSec = s.sleepTimeSeconds || s.totalSleepSeconds || 0;
          if (sleepSec <= 0) return null;
          return {
            date: dateStr,
            calendarDate: s.calendarDate || dateStr,
            sleepTimeSeconds: sleepSec,
            deepSleepSeconds:  s.deepSleepSeconds  || 0,
            lightSleepSeconds: s.lightSleepSeconds || 0,
            remSleepSeconds:   s.remSleepSeconds   || 0,
          };
        } catch(e) { return null; }
      });

      const settled = await Promise.allSettled(fetches);
      return settled
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value)
        .sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  function clearCache() { Object.keys(cache).forEach(k => delete cache[k]); }

  return { getActivities, getActivitiesForYear, getUserProfile, getHeartRateData, getVO2MaxData, getVO2MaxPrecise, getSleepData, clearCache };
}

module.exports = {
  getActivities,
  getUserProfile,
  getHeartRateData,
  getVO2MaxData,
  getVO2MaxPrecise,
  getSleepData,
  computeStats,
  getLastRunActivities,
  getPersonalRecords,
  getGarminClient,
  buildGarminFunctions
};
