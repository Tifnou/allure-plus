// Orchestration de la synchro cross-appareils (voir sync-relay/ pour le
// relais cloud, sync_client.js pour le protocole bas niveau). Ce module
// traduit chaque fichier local data/<X>.json en une collection cle->valeur
// horodatee (l'enveloppe generique que comprend le relais), et inversement.
//
// Principe de fusion "dernier ecrit gagne, par element" (voir CLAUDE.md /
// plan de session) : les metadonnees de synchro (updatedAt/deletedAt) ne
// sont JAMAIS ecrites dans le fichier metier lui-meme (sauf session_analyses/
// pace_profile qui en ont deja un nativement, reutilise tel quel) - elles
// vivent dans un fichier sidecar separe data/<X>.sync.json, invisible du
// reste du code (aucune route existante ne les lit). Ca garantit qu'aucun
// champ inattendu n'apparait jamais dans les reponses API existantes.
//
// scheduleSync(type, key, email, deleted) doit etre appele juste APRES
// chaque ecriture locale reussie (writeJsonSafe) sur un fichier synchronise -
// jamais a la place de l'ecriture locale, qui reste la source de verite
// immediate pour l'utilisateur courant.
const fs = require('fs');
const path = require('path');
const syncClient = require('./sync_client');
const syncFiles = require('./sync_files');

const DATA_DIR = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return fallback; }
}
function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[sync] Ecriture ${path.basename(filePath)} echouee:`, e.message);
  }
}

// ─── Registre des types synchronises ────────────────────────────────────
// toEntries(local)   : transforme la forme native du fichier (array/objet)
//                      en map { cle-metier: valeur } pour la fusion.
// fromEntries(map)   : operation inverse, reconstruit la forme native.
// Chaque type ajoute ici doit avoir son pendant cote sync-relay/src/index.js
// (ALLOWED_TYPES).
// Tous les fichiers locaux sont desormais cloisonnes par compte,
// { [email]: <forme native> } (voir server.js: readScoped/writeScoped,
// migrateToScoped) - meme motif que user_data.json qui l'a toujours ete.
// toEntries(rawLocal, email)/fromEntries(map, email, rawLocal) ne lisent/
// n'ecrivent donc JAMAIS que la tranche `rawLocal[email]` du compte courant,
// jamais les autres comptes eventuellement presents dans le meme fichier -
// sinon un push enverrait les donnees d'un autre compte vers le cloud de
// celui-ci, ou une reconciliation ecraserait les donnees d'un autre compte.
const SYNC_TYPES = {
  weight_history: {
    file: path.join(DATA_DIR, 'weight_history.json'),
    sidecarFile: path.join(DATA_DIR, 'weight_history.sync.json'),
    defaultLocal: [],
    toEntries(rawLocal, email) {
      const map = {};
      ((rawLocal || {})[email] || []).forEach(item => { map[item.date] = item; });
      return map;
    },
    fromEntries(map, email, rawLocal) {
      const list = Object.values(map).sort((a, b) => new Date(a.date) - new Date(b.date));
      return { ...(rawLocal || {}), [email]: list };
    },
  },
  records_overrides: {
    // Deja un objet cle=distance -> aucune transformation necessaire (a part
    // le cloisonnement par compte).
    file: path.join(DATA_DIR, 'records_overrides.json'),
    sidecarFile: path.join(DATA_DIR, 'records_overrides.sync.json'),
    defaultLocal: {},
    toEntries(rawLocal, email) { return { ...((rawLocal || {})[email] || {}) }; },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: map }; },
  },
  gear: {
    file: path.join(DATA_DIR, 'gear.json'),
    sidecarFile: path.join(DATA_DIR, 'gear.sync.json'),
    defaultLocal: [],
    toEntries(rawLocal, email) {
      const map = {};
      ((rawLocal || {})[email] || []).forEach(item => { map[item.id] = item; });
      return map;
    },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: Object.values(map) }; },
  },
  activity_gear: {
    // Deja un objet cle=activityId -> aucune transformation necessaire.
    file: path.join(DATA_DIR, 'activity_gear.json'),
    sidecarFile: path.join(DATA_DIR, 'activity_gear.sync.json'),
    defaultLocal: {},
    toEntries(rawLocal, email) { return { ...((rawLocal || {})[email] || {}) }; },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: map }; },
  },
  // Metadonnees JSON uniquement (nom/date/distance...) - le certificat
  // binaire eventuel (champ certificateFile) est synchronise separement
  // par sync_files.js, derive de ces entrees une fois reconciliees.
  races: {
    file: path.join(DATA_DIR, 'races.json'),
    sidecarFile: path.join(DATA_DIR, 'races.sync.json'),
    defaultLocal: [],
    toEntries(rawLocal, email) {
      const map = {};
      ((rawLocal || {})[email] || []).forEach(item => { map[item.id] = item; });
      return map;
    },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: Object.values(map) }; },
  },
  // Idem races : le PDF (champ filename) est synchronise separement.
  // Cas vecu (13/08) : un PPS deja saisi independamment sur deux machines
  // AVANT que cette synchro n'existe recoit un `id` different sur chacune -
  // la fusion par id (comme toutes les autres collections ci-dessus) les
  // traite alors comme deux PPS distincts et les additionne au lieu de les
  // reconcilier, doublant l'affichage. Comme le numero PPS identifie le meme
  // document reel quel que soit l'id local, fromEntries deduplique dessus
  // (garde l'entree la plus recemment televersee) juste avant l'ecriture -
  // toEntries reste par id pour ne pas perdre une entree pas encore numerotee.
  pps: {
    file: path.join(DATA_DIR, 'pps.json'),
    sidecarFile: path.join(DATA_DIR, 'pps.sync.json'),
    defaultLocal: [],
    toEntries(rawLocal, email) {
      const map = {};
      ((rawLocal || {})[email] || []).forEach(item => { map[item.id] = item; });
      return map;
    },
    fromEntries(map, email, rawLocal) {
      const byNumber = new Map();
      Object.values(map).forEach(entry => {
        const dedupeKey = entry && entry.number ? entry.number : entry.id;
        const existing = byNumber.get(dedupeKey);
        if (!existing || new Date(entry.uploadedAt || 0) >= new Date(existing.uploadedAt || 0)) {
          byNumber.set(dedupeKey, entry);
        }
      });
      return { ...(rawLocal || {}), [email]: Array.from(byNumber.values()) };
    },
  },
  session_analyses: {
    file: path.join(DATA_DIR, 'session_analyses.json'),
    sidecarFile: path.join(DATA_DIR, 'session_analyses.sync.json'),
    defaultLocal: [],
    toEntries(rawLocal, email) {
      const map = {};
      ((rawLocal || {})[email] || []).forEach(item => { map[item.id] = item; });
      return map;
    },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: Object.values(map) }; },
  },
  // { [metric]: [{date, value}] } -> aplati en cle composite "metric::date"
  // pour que la fusion se fasse au bon grain (un instantane par jour et par
  // metrique, jamais tout le tableau d'une metrique d'un coup).
  health_snapshots: {
    file: path.join(DATA_DIR, 'health_snapshots.json'),
    sidecarFile: path.join(DATA_DIR, 'health_snapshots.sync.json'),
    defaultLocal: {},
    toEntries(rawLocal, email) {
      const map = {};
      Object.entries((rawLocal || {})[email] || {}).forEach(([metric, arr]) => {
        (arr || []).forEach(entry => { map[`${metric}::${entry.date}`] = entry; });
      });
      return map;
    },
    fromEntries(map, email, rawLocal) {
      const obj = {};
      Object.entries(map).forEach(([key, entry]) => {
        const metric = key.split('::')[0];
        if (!obj[metric]) obj[metric] = [];
        obj[metric].push(entry);
      });
      Object.values(obj).forEach(arr => arr.sort((a, b) => new Date(a.date) - new Date(b.date)));
      return { ...(rawLocal || {}), [email]: obj };
    },
  },
  // Objet unique (pas une collection) -> une seule cle fixe "profile".
  pace_profile: {
    file: path.join(DATA_DIR, 'pace_profile.json'),
    sidecarFile: path.join(DATA_DIR, 'pace_profile.sync.json'),
    defaultLocal: null,
    toEntries(rawLocal, email) {
      const profile = (rawLocal || {})[email];
      return profile ? { profile } : {};
    },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: map.profile || null }; },
  },
  user_data: {
    file: path.join(DATA_DIR, 'user_data.json'),
    sidecarFile: path.join(DATA_DIR, 'user_data.sync.json'),
    defaultLocal: {},
    toEntries(rawLocal, email) { return { ...((rawLocal || {})[email] || {}) }; },
    fromEntries(map, email, rawLocal) { return { ...(rawLocal || {}), [email]: map }; },
  },
};

// ─── Etat en memoire (dirty keys + debounce + statut) ───────────────────
const _dirty = {};   // type -> Set(cles) pas encore poussees avec succes
const _timers = {};  // type -> handle setTimeout (debounce)
const _emailByType = {}; // type -> dernier email connu (pour le flush debounced)
const DEBOUNCE_MS = 4000;

const status = { lastSyncAt: null, lastSyncOk: null, lastError: null, configured: syncClient.isConfigured() };

function getSyncStatus() {
  return { ...status };
}

// Marque une cle "sale" dans le sidecar (horodatage immediat) et programme
// un push debounce (absorbe les ecritures rafales, ex: import en masse).
// Le sidecar est lui-meme cloisonne par compte, { [email]: { [cle]: meta } } -
// sans ca, deux comptes utilisant la meme machine et partageant une cle
// metier identique (ex: distance "10km", meme date de pesee) ecraseraient
// mutuellement leurs metadonnees de synchro dans un sidecar commun.
function scheduleSync(type, key, email, deleted = false) {
  if (!syncClient.isConfigured() || !email || !key) return;
  const cfg = SYNC_TYPES[type];
  if (!cfg) return;

  const sidecar = readJsonSafe(cfg.sidecarFile, {});
  const now = new Date().toISOString();
  const forAccount = sidecar[email] || (sidecar[email] = {});
  forAccount[key] = deleted ? { deletedAt: now, updatedAt: now } : { updatedAt: now, deletedAt: null };
  writeJsonSafe(cfg.sidecarFile, sidecar);

  _dirty[type] = _dirty[type] || new Set();
  _dirty[type].add(key);
  _emailByType[type] = email;

  if (_timers[type]) clearTimeout(_timers[type]);
  _timers[type] = setTimeout(() => {
    flushType(type).catch(e => {
      status.lastError = `${type}: ${e.message}`;
      console.error(`[sync] flush ${type} echoue:`, e.message);
    });
  }, DEBOUNCE_MS);
}

// Applique une enveloppe distante (recue par push ou pull) au fichier local
// - n'adopte une entree que si elle est strictement plus recente que ce que
// le sidecar local connait deja (protege contre l'ecrasement d'une donnee
// locale plus fraiche par un echo/une valeur perimee). `email` n'est utilise
// que par les types dont le fichier local est lui-meme indexe par compte
// (voir user_data) - les autres adaptateurs l'ignorent silencieusement.
function reconcileEnvelope(type, envelope, email) {
  const cfg = SYNC_TYPES[type];
  if (!cfg || !envelope || !envelope.entries || !email) return;
  const sidecar = readJsonSafe(cfg.sidecarFile, {});
  const forAccount = sidecar[email] || (sidecar[email] = {});
  const local = readJsonSafe(cfg.file, cfg.defaultLocal);
  const map = cfg.toEntries(local, email);
  let changed = false;

  Object.entries(envelope.entries).forEach(([key, entry]) => {
    const localMeta = forAccount[key];
    const localTs = localMeta ? (localMeta.deletedAt || localMeta.updatedAt) : null;
    if (localTs && entry.updatedAt <= localTs) return; // local deja a jour ou plus recent

    if (entry.deletedAt) {
      delete map[key];
    } else {
      map[key] = entry.value;
    }
    forAccount[key] = { updatedAt: entry.updatedAt, deletedAt: entry.deletedAt || null };
    changed = true;
  });

  if (changed) {
    writeJsonSafe(cfg.file, cfg.fromEntries(map, email, local));
    writeJsonSafe(cfg.sidecarFile, sidecar);
  }
}

async function flushType(type) {
  const cfg = SYNC_TYPES[type];
  const keys = _dirty[type];
  const email = _emailByType[type];
  if (!cfg || !keys || keys.size === 0 || !email) return;

  const sidecar = readJsonSafe(cfg.sidecarFile, {});
  const forAccount = sidecar[email] || {};
  const local = readJsonSafe(cfg.file, cfg.defaultLocal);
  const map = cfg.toEntries(local, email);

  const entries = {};
  keys.forEach(key => {
    const meta = forAccount[key];
    if (!meta) return; // ne devrait pas arriver (ecrit par scheduleSync avant ce flush)
    entries[key] = { value: meta.deletedAt ? null : (map[key] ?? null), updatedAt: meta.updatedAt, deletedAt: meta.deletedAt || null };
  });

  const envelope = await syncClient.pushEntries(type, email, entries);
  // Succes : ces cles precises sont poussees, on les retire du set "sale"
  // (une nouvelle ecriture locale pendant l'appel reseau les y remettra).
  keys.clear();
  reconcileEnvelope(type, envelope, email);
  status.lastSyncAt = new Date().toISOString();
  status.lastSyncOk = true;
  status.lastError = null;
}

// Pousse les elements locaux qui n'ont ENCORE JAMAIS ete vus par la synchro
// (aucune entree sidecar) - le cas typique est une donnee saisie AVANT
// l'ajout de ce mecanisme (ou avant la toute premiere synchro reussie sur
// cette machine), qui ne serait sinon jamais poussee (rien ne la modifie
// plus pour re-declencher scheduleSync). Sans ca, un utilisateur avec des
// mois d'historique existant verrait seulement ses FUTURES saisies se
// synchroniser, jamais son historique deja present.
async function backfillUnsyncedLocal(type, email) {
  const cfg = SYNC_TYPES[type];
  const sidecar = readJsonSafe(cfg.sidecarFile, {});
  const forAccount = sidecar[email] || (sidecar[email] = {});
  const local = readJsonSafe(cfg.file, cfg.defaultLocal);
  const map = cfg.toEntries(local, email);
  const missingKeys = Object.keys(map).filter(k => !forAccount[k]);
  if (missingKeys.length === 0) return;

  const now = new Date().toISOString();
  const entries = {};
  missingKeys.forEach(k => {
    forAccount[k] = { updatedAt: now, deletedAt: null };
    entries[k] = { value: map[k], updatedAt: now, deletedAt: null };
  });
  writeJsonSafe(cfg.sidecarFile, sidecar);
  const envelope = await syncClient.pushEntries(type, email, entries);
  reconcileEnvelope(type, envelope, email);
}

// Pull complet de tous les types enregistres - au demarrage du serveur et
// via un job periodique (voir server.js). Rapatrie ce que les autres
// appareils ont deja synchronise, PUIS pousse ce qui existe localement mais
// n'a encore jamais ete synchronise (voir backfillUnsyncedLocal).
async function runFullReconciliation(email) {
  if (!syncClient.isConfigured() || !email) return;
  let anyError = null;
  for (const type of Object.keys(SYNC_TYPES)) {
    try {
      const envelope = await syncClient.pullEnvelope(type, email);
      reconcileEnvelope(type, envelope, email);
      await backfillUnsyncedLocal(type, email);
    } catch (e) {
      anyError = `${type}: ${e.message}`;
      console.error(`[sync] reconciliation ${type} echouee:`, e.message);
    }
  }

  // Fichiers binaires : deduits des entrees races/pps qui viennent d'etre
  // reconciliees ci-dessus (voir sync_files.js) - doit toujours passer APRES
  // la boucle JSON, jamais avant, sinon on se baserait sur des metadonnees
  // perimees pour decider quels fichiers rapatrier.
  try {
    const racesRaw = readJsonSafe(SYNC_TYPES.races.file, {});
    const ppsRaw = readJsonSafe(SYNC_TYPES.pps.file, {});
    const races = (racesRaw || {})[email] || [];
    const ppsList = (ppsRaw || {})[email] || [];
    await syncFiles.syncRaceCertificates(email, races);
    await syncFiles.syncPpsFiles(email, ppsList);
    await syncFiles.syncAvatarFile(email);
  } catch (e) {
    anyError = `fichiers: ${e.message}`;
    console.error('[sync] reconciliation fichiers echouee:', e.message);
  }

  status.lastSyncAt = new Date().toISOString();
  status.lastSyncOk = !anyError;
  status.lastError = anyError;
}

module.exports = {
  scheduleSync, runFullReconciliation, getSyncStatus, SYNC_TYPES,
  syncBinaryFile: syncFiles.syncNamedFile,
  deleteBinaryFile: syncFiles.deleteNamedFile,
  syncAvatarFile: syncFiles.syncAvatarFile,
};
