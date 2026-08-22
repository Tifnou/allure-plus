require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const os       = require('os');
const { spawn } = require('child_process');

// â?,â?,â?, Logger fichier (admin /api/logs) â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,
const _logFile = path.join(__dirname, 'server.log');
(function initFileLogger() {
  // Rotation : garder 400 dernif¨res lignes
  try {
    if (fs.existsSync(_logFile)) {
      const lines = fs.readFileSync(_logFile, 'utf8').split('\n');
      if (lines.length > 500) fs.writeFileSync(_logFile, lines.slice(-400).join('\n') + '\n', 'utf8');
    }
  } catch (_) {}
  // toISOString() renvoie toujours l'heure UTC (decalee de l'heure francaise) :
  // on force explicitement le fuseau Europe/Paris pour les logs.
  const _ts = () => new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false });
  const _write = (tag, args) => {
    try { fs.appendFileSync(_logFile, `[${tag}] ${_ts()} ${args.join(' ')}\n`, 'utf8'); } catch (_) {}
  };
  const _log = console.log.bind(console);
  const _err = console.error.bind(console);
  console.log   = (...a) => { _log(...a);   _write('INFO',   a); };
  console.error = (...a) => { _err(...a);   _write('ERREUR', a); };
  console.warn  = (...a) => { _log('[WARN]', ...a); _write('WARN', a); };
})();
// â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,â?,

const CAMPUS_TOKEN_FILE = path.join(__dirname, '.campus_token');

function saveCampusTokenToFile(token) {
  try { require('fs').writeFileSync(CAMPUS_TOKEN_FILE, token || '', 'utf8'); } catch(e) {}
}

function loadCampusTokenFromFile() {
  try {
    const t = require('fs').readFileSync(CAMPUS_TOKEN_FILE, 'utf8').trim();
    return t || null;
  } catch(e) { return null; }
}
const cookie   = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const { GarminConnect } = require('garmin-connect');
// Monkeypatch : ajoute le support MFA (code SMS) manquant dans garmin-connect
// 1.6.2 - voir garmin_mfa_patch.js pour le detail. Doit etre require avant
// toute connexion Garmin (charge une seule fois, patch le prototype partage).
const { GarminMfaRequiredError } = require('./garmin_mfa_patch');
const {
  computeStats,
  getRecentActivities,
  getPersonalRecords,
  buildGarminFunctions
} = require('./garmin_client');
const { getZoneRange, annotatePaceZones, ZONE_LABELS } = require('./zones');
const { isBrouterConfigured, isTilePresent, getTileRemoteSize, downloadTile } = require('./brouter_manager');
const { geocode, getCommunesForPostcode, getCommunesForDepartment, searchStreet, getTownHall, generateRouteOptions, buildGpxXml, trailLevelMidKmh, TRAIL_STYLE_PARAMS } = require('./route_generator');
const { getPaceProfile, refreshPaceProfile, migratePaceProfileToScoped, efFastPaceMinPerKm, applyEfPaceAnchor } = require('./pace_profile');
const { analyzeGpx, computeElevationProfile } = require('./gpx_parser');
const { getElevations } = require('./geoportail_client');
const { scheduleSync, runFullReconciliation, getSyncStatus, syncBinaryFile, deleteBinaryFile, syncAvatarFile, SYNC_TYPES } = require('./sync');
const syncClient = require('./sync_client');
const { buildPlanWorkbook } = require('./xlsx_export');
const {
  campusLogin,
  getActiveGoal,
  getGoal,
  getCurrentWeekSessions,
  exportSessionToGarmin,
  getFullTrainingPlan,
  getPaces,
} = require('./campus_client');

const app  = express();
const APP_VERSION = require('./package.json').version;
const PORT = process.env.PORT || 3001;

app.use(cors());
// 8mb : encodage base64 d'une image jointe a un ticket de support (voir
// /api/support/images) gonfle la taille brute d'~1/3 en plus de l'enveloppe
// JSON - 5mb etait trop juste pour une capture d'ecran meme compressee.
app.use(express.json({ limit: '8mb' }));
app.use(cookie());
// index:false f¢â, â," express.static ne sert PAS index.html directement
// f¢â, â," la route GET '/' s'ex©cute toujours et pose le cookie de session
app.use(express.static(path.join(__dirname, 'frontend'), { index: false }));
// Sert le dossier Images/ accessible via /bg-images/
app.use('/bg-images', express.static(path.join(__dirname, 'Images')));
// Liste les images de fond disponibles
app.get('/api/bg-images', (req, res) => {
  const imgDir = path.join(__dirname, 'Images');
  try {
    const files = require('fs').readdirSync(imgDir)
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .map(f => '/bg-images/' + f);
    res.json(files);
  } catch(e) { res.json([]); }
});

// Avatar utilisateur + upload des images de fond
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const UPLOADS_DIR = path.join(__dirname, 'uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
app.use('/uploads', express.static(UPLOADS_DIR));

// Cloisonnement par compte : uploads/ est un dossier plat partage par
// n'importe quel compte connecte sur cette machine - le nom de fichier porte
// donc l'identite du compte (avatar-<slug>.<ext>) pour qu'un compte sans
// avatar n'affiche jamais celui d'un autre compte deja utilise ici.
function slugifyEmail(email) {
  return (email || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
}
function findAvatarFile(email) {
  const slug = slugifyEmail(email);
  if (!slug) return null;
  try {
    const re = new RegExp(`^avatar-${slug}\\.[a-z0-9]+$`, 'i');
    return fs.readdirSync(UPLOADS_DIR).find(f => re.test(f)) || null;
  } catch (e) { return null; }
}

// Donnees utilisateur persistantes (records corriges, courses saisies) —
// fichiers plats jamais ecrases par une mise a jour/reinstallation (comme uploads/)
const DATA_DIR = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const RECORDS_OVERRIDES_FILE = path.join(DATA_DIR, 'records_overrides.json');
const RACES_FILE             = path.join(DATA_DIR, 'races.json');
const WEIGHT_HISTORY_FILE    = path.join(DATA_DIR, 'weight_history.json');
const HEALTH_SNAPSHOTS_FILE  = path.join(DATA_DIR, 'health_snapshots.json');
const PPS_FILE                = path.join(DATA_DIR, 'pps.json');
const PREFS_FILE              = path.join(DATA_DIR, 'prefs.json');
const USER_DATA_FILE          = path.join(DATA_DIR, 'user_data.json');
const ACTIVITIES_CACHE_FILE   = path.join(DATA_DIR, 'activities_cache.json');
const SESSION_ANALYSES_FILE   = path.join(DATA_DIR, 'session_analyses.json');
const GEAR_FILE                = path.join(DATA_DIR, 'gear.json');
const ACTIVITY_GEAR_FILE       = path.join(DATA_DIR, 'activity_gear.json');
const GOAL_GPX_FILE            = path.join(DATA_DIR, 'goal_gpx_profiles.json');
// Cases a cocher "sera propose" du tableau de suivi des plans (Admin, compte
// shiznogoud@gmail.com uniquement) - global, pas scope par compte Garmin
// (readScoped/writeScoped) : ce tableau n'a de sens que pour l'auteur des
// plans, jamais affiche a un autre compte.
const PLAN_PUBLISH_FLAGS_FILE  = path.join(DATA_DIR, 'plan_publish_flags.json');

// Tampon "Pref 2" — case a cocher reservee a ce compte, dans Profil > Mes informations
const PREF2_EMAIL = 'floflopavard@gmail.com';

// Campus Coach masque pour tous les comptes sauf celui-ci (09/2026) : la
// fonctionnalite reste entierement codee (routes, UI, sync du plan) mais
// n'est utile qu'a ce compte pour le moment (aucun autre utilisateur n'a de
// compte Campus Coach) - autant ne pas perturber les autres profils avec une
// option qui ne les concerne pas. Pour rouvrir a tout le monde : supprimer
// campusVisibleForSession() et repasser campusEnabled: CAMPUS_ENABLED (sans
// le && ) dans /api/campus/status.
const CAMPUS_VISIBLE_EMAIL = 'shiznogoud@gmail.com';
function campusVisibleForSession(session) {
  return (session?.email || '').toLowerCase() === CAMPUS_VISIBLE_EMAIL.toLowerCase();
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { return fallback; }
}
// Pause synchrone (pas de callback/await possible ici, writeJsonSafe doit
// rester synchrone pour ses appelants) - via Atomics.wait, sans dependance.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// EPERM/EBUSY/EACCES sur un fichier de data/ deja existant est generalement
// transitoire sous Windows (antivirus qui scanne le fichier juste apres une
// ecriture precedente, outil de sync qui l'a brievement ouvert...) plutot
// qu'un vrai probleme de droits permanent - constate en prod (EPERM sur
// session_analyses.json alors que d'autres liaisons avaient deja fonctionne
// sur la meme machine sans reinstallation entre-temps). On retente avant
// d'abandonner, pour ne pas faire perdre la saisie de l'utilisateur.
function writeJsonSafe(filePath, data, retries = 5) {
  const payload = JSON.stringify(data, null, 2);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(filePath, payload, 'utf8');
      return;
    } catch (e) {
      const transient = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (!transient || attempt === retries) throw e;
      sleepSync(150 * attempt);
    }
  }
}

// Cloisonnement par compte des fichiers de donnees locaux (records, courses,
// chaussures, PPS, poids, sante, analyses de seance, cache d'activites,
// profil d'allure) - meme motif que user_data.json (deja scope). Sans ca, un
// meme PC utilise successivement avec deux comptes Garmin differents (usage
// reel constate) affiche/melange les donnees de l'un sous l'autre, la synchro
// cloud etant elle deja correctement scopee par email cote relais. Voir
// migrateToScoped ci-dessous pour la conversion ponctuelle des fichiers
// existants (a plat) vers ce format.
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

app.get('/api/avatar', requireSession, (req, res) => {
  const f = findAvatarFile(req.session.email);
  res.json({ url: f ? '/uploads/' + f : null });
});

app.post('/api/avatar', requireSession, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
    if (!/^\.(jpe?g|png|webp|gif)$/.test(ext)) return res.status(400).json({ error: "Format d'image non supporte" });
    const existing = findAvatarFile(req.session.email);
    if (existing) fs.unlinkSync(path.join(UPLOADS_DIR, existing));
    const filename = 'avatar-' + slugifyEmail(req.session.email) + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    syncAvatarFile(req.session.email).catch(() => {});
    res.json({ url: '/uploads/' + filename });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/avatar', requireSession, (req, res) => {
  try {
    const f = findAvatarFile(req.session.email);
    if (f) {
      fs.unlinkSync(path.join(UPLOADS_DIR, f));
      deleteBinaryFile(req.session.email, f).catch(() => {});
    }
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

// Tampon "Pref 2" sous l'avatar : reglable uniquement par PREF2_EMAIL, mais
// l'etat (enabled) est stocke par compte et lu tel quel pour n'importe quelle
// session (permet par ex. de l'activer temporairement sur un autre compte
// pour verification, sans exposer la case a cocher a ce compte).
app.get('/api/pref2', requireSession, (req, res) => {
  const email = (req.session.email || '').toLowerCase();
  const prefs = readJsonSafe(PREFS_FILE, {});
  res.json({
    canEdit: email === PREF2_EMAIL.toLowerCase(),
    enabled: !!prefs[email]?.pref2
  });
});

app.post('/api/pref2', requireSession, (req, res) => {
  const email = (req.session.email || '').toLowerCase();
  if (email !== PREF2_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Reserve a ce compte' });
  }
  const prefs = readJsonSafe(PREFS_FILE, {});
  prefs[email] = { pref2: !!req.body?.enabled };
  writeJsonSafe(PREFS_FILE, prefs);
  res.json({ success: true, enabled: prefs[email].pref2 });
});

// Sauvegarde serveur de donnees auparavant stockees UNIQUEMENT en
// localStorage (profil, objectifs personnels, plan importe, seances
// pointees comme faites...) — vecu reel : un nettoyage de l'historique de
// navigation faisait tout perdre, sans aucune autre source (contrairement
// aux activites Garmin, re-telechargeables). Le client continue de lire/
// ecrire ces cles dans localStorage (acces synchrone, des dizaines d'appels
// existants comptent dessus) mais les mireoire desormais vers le serveur a
// chaque ecriture et les recharge depuis le serveur au demarrage — comme
// les autres fichiers de data/, jamais ecrase par l'installeur (cf
// allure-plus.iss). Cle/valeur libres (n'importe quelle cle localStorage
// "durable" cote client, cf DURABLE_LS_KEYS dans app.js), stocke par compte
// comme PREFS_FILE au cas ou plusieurs comptes utilisent le meme serveur.
// `meta` (updatedAt par cle, tire du sidecar de sync.js) permet au client de
// distinguer "jamais vu" de "deja vu mais perime depuis" — indispensable
// multi-appareils : la synchro cross-appareils (sync.js/runFullReconciliation)
// peut rafraichir ce fichier data/user_data.json EN ARRIERE-PLAN (pull
// periodique, ou juste apres connexion) sans que le navigateur de CETTE
// machine n'en soit informe ; sans horodatage, syncUserDataFromServer()
// (app.js) ne peut que "combler les cles manquantes" et ignore alors pour
// toujours une mise a jour faite depuis un autre appareil des que la cle
// existe deja localement, meme perimee (bug reel constate : "done"/ressenti
// d'une seance saisis sur le PC perso jamais recus sur le PC du bureau, une
// fois que celui-ci avait deja une valeur locale pour ces cles).
app.get('/api/user-data', requireSession, (req, res) => {
  const email = (req.session.email || '').toLowerCase();
  const store = readJsonSafe(USER_DATA_FILE, {});
  const sidecar = readJsonSafe(SYNC_TYPES.user_data.sidecarFile, {});
  const meta = {};
  Object.entries(sidecar[email] || {}).forEach(([key, m]) => { if (m && m.updatedAt) meta[key] = m.updatedAt; });
  res.json({ data: store[email] || {}, meta });
});

app.post('/api/user-data', requireSession, (req, res) => {
  const email = (req.session.email || '').toLowerCase();
  const updates = req.body || {};
  if (typeof updates !== 'object' || Array.isArray(updates)) return res.status(400).json({ error: 'Corps invalide' });
  const store = readJsonSafe(USER_DATA_FILE, {});
  store[email] = { ...(store[email] || {}), ...updates };
  writeJsonSafe(USER_DATA_FILE, store);
  Object.keys(updates).forEach(lsKey => scheduleSync('user_data', lsKey, email));
  res.json({ success: true });
});

// Ajout / suppression des images du diaporama de fond
app.post('/api/bg-images', requireSession, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
    if (!/^\.(jpe?g|png|webp|gif)$/.test(ext)) return res.status(400).json({ error: "Format d'image non supporte" });
    const base = path.basename(req.file.originalname, path.extname(req.file.originalname))
      .replace(/[^a-zA-Z0-9-_]+/g, '_') || 'photo';
    const imgDir = path.join(__dirname, 'Images');
    let filename = base + ext;
    let i = 1;
    while (fs.existsSync(path.join(imgDir, filename))) { filename = `${base}_${i}${ext}`; i++; }
    fs.writeFileSync(path.join(imgDir, filename), req.file.buffer);
    res.json({ url: '/bg-images/' + filename });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/bg-images/:filename', requireSession, (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Nom de fichier invalide' });
    }
    const imgDir = path.join(__dirname, 'Images');
    const filePath = path.join(imgDir, filename);
    if (path.dirname(filePath) !== imgDir) return res.status(400).json({ error: 'Nom de fichier invalide' });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const thumbPath = path.join(imgDir, 'thumbs', filename);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

// Vignettes legeres pour la modale de gestion des photos de fond (les
// photos originales ne sont jamais touchees - generation a la demande,
// mise en cache sur disque dans Images/thumbs/).
const sharp = require('sharp');
const BG_THUMBS_DIR = path.join(__dirname, 'Images', 'thumbs');
try { fs.mkdirSync(BG_THUMBS_DIR, { recursive: true }); } catch (e) {}
const bgThumbGenerating = new Map(); // filename -> Promise en cours (evite les generations concurrentes du meme fichier)

app.get('/bg-thumbs/:filename', async (req, res) => {
  const filename = req.params.filename;
  const imgDir = path.join(__dirname, 'Images');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Nom de fichier invalide');
  }
  const srcPath = path.join(imgDir, filename);
  const thumbPath = path.join(BG_THUMBS_DIR, filename);
  if (path.dirname(srcPath) !== imgDir) return res.status(400).send('Nom de fichier invalide');
  try {
    const srcStat = fs.statSync(srcPath);
    const needsGeneration = !fs.existsSync(thumbPath) || fs.statSync(thumbPath).mtimeMs < srcStat.mtimeMs;
    if (needsGeneration) {
      if (!bgThumbGenerating.has(filename)) {
        const job = sharp(srcPath).resize(320, 240, { fit: 'cover' }).jpeg({ quality: 70 }).toFile(thumbPath)
          .finally(() => bgThumbGenerating.delete(filename));
        bgThumbGenerating.set(filename, job);
      }
      await bgThumbGenerating.get(filename);
    }
    res.sendFile(thumbPath);
  } catch (err) {
    res.status(404).send('Introuvable');
  }
});

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Gestion des sessions en m©moire
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

const sessions = new Map();   // sessionId f¢â, â," { gc, email, fns, lastAccess }
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12h

// Connexions Garmin en attente d'un code MFA (SMS) - mfaToken -> { gc, email,
// kind: 'setup'|'login', setupFields, createdAt }. gc est l'instance en
// cours (cookies + etat MFA), a reprendre via gc.client.resumeWithMfa() une
// fois le code saisi (/api/login/mfa) - jamais recreee. Duree de vie courte :
// le temps de recevoir le SMS et de le saisir, pas une vraie session.
const pendingMfaLogins = new Map();
const MFA_PENDING_TTL_MS = 5 * 60 * 1000; // 5 min

// Nettoyage p©riodique des sessions expir©es
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastAccess > SESSION_TTL) {
      console.log('[CLEANUP] Session expiree supprimee:', s.email);
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000);

// Retombe sur la session d'auto-login (envSessionId) quand le cookie de la
// requete est absent/perime - sans ca, seuls /api/status et / avaient ce
// filet de securite (code duplique localement), toutes les AUTRES routes
// (dont /api/campus/status, /api/campus/training) rendaient un etat "non
// connecte" des que le cookie du navigateur ne correspondait plus a la
// session en memoire du serveur courant. Ca arrive a chaque redemarrage
// (mise a jour installee, `Redemarrer le serveur` admin...) si la fenetre
// de l'appli n'est pas rechargee entierement avant de rappeler une de ces
// routes - constate reel (14/08) : Campus Coach semblait deconnecte et
// l'appli retombait sur "sans plan" alors que le plan etait toujours actif.
function getSession(req) {
  const id = req.cookies?.sid;
  let s = id ? sessions.get(id) : null;
  if (!s && envSessionId && sessions.has(envSessionId)) {
    s = sessions.get(envSessionId);
  }
  if (!s) return null;
  s.lastAccess = Date.now();
  return s;
}

function requireSession(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Non connect©', redirect: '/login' });
  req.session = s;
  next();
}

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬ Campus Coach : token ind©pendant de Garmin f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
function getCampusToken(req) {
  // Priorité 1 : jeton auto-login .env — le plus fiable (refresh auto)
  if (_envCampusTokenCache) return _envCampusTokenCache;
  // Priorité 2 : cookie campus_token (connexion manuelle)
  if (req.cookies?.campus_token) return req.cookies.campus_token;
  // Priorité 3 : session Garmin (backward compat)
  const s = getSession(req);
  if (s?.campusToken) return s.campusToken;
  return null;
}
function requireCampusToken(req, res, next) {
  const token = getCampusToken(req);
  if (!token) return res.status(401).json({ error: 'Non connect©   Campus Coach' });
  req.campusToken = token;
  next();
}

// Meme constante que frontend/js/app.js (ADMIN_EMAIL) - export du plan
// reserve au compte admin, seul a partager son plan a des amis externes
const ADMIN_EMAIL = 'shiznogoud@gmail.com';
function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!s || !s.email || s.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Reserve au compte admin' });
  }
  next();
}

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Helpers
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

function handleError(res, err) {
  console.error('API Error:', err.message);
  res.status(500).json({ error: err.message });
}


// Deduit un nom d'affichage lisible depuis le profil Garmin (partage entre
// login complet et restauration par tokens, pour ne jamais retomber sur
// l'email par defaut quand l'un des deux chemins est utilise)
function computeDisplayName(profile) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const notUUID = (v) => v && !uuidRegex.test(v);
  if (notUUID(profile?.fullName)) return profile.fullName;
  if (notUUID(profile?.userProfileFullName)) return profile.userProfileFullName;
  if (notUUID(profile?.preferredDisplayName)) return profile.preferredDisplayName;
  const fn = (profile?.firstName || '').trim();
  const ln = (profile?.lastName  || '').trim();
  if (fn || ln) return (fn + ' ' + ln).trim();
  if (notUUID(profile?.displayName)) return profile.displayName;
  return null;
}

// Suite commune a une connexion reussie, que ce soit directement (pas de
// MFA) ou apres resumeWithMfa() (voir /api/login/mfa) - gc est deja
// authentifie dans les deux cas, cette fonction ne fait plus aucun appel
// SSO.
async function finalizeGarminSession(gc, email) {
  // Sauvegarder les tokens OAuth sur disque (par compte, cf garminTokenDirFor)
  // pour eviter le login SSO (et donc une nouvelle demande MFA) aux
  // prochains demarrages.
  try { gc.exportTokenToFile(garminTokenDirFor(email)); } catch(_) {}
  const fns = buildGarminFunctions(gc);

  let displayName = null;
  try {
    const profile = await gc.getUserProfile();
    displayName = computeDisplayName(profile);
  } catch(e) { /* silencieux */ }

  // Enregistre/actualise ce compte dans le repertoire des utilisateurs et
  // rejette la connexion s'il a ete bloque par l'admin (voir
  // checkUserDirectory plus bas - throw si blocked) - seule visibilite/
  // controle possible sur une appli distribuee en .exe, sans autre canal.
  const { ticketAccess } = await checkUserDirectory(email, displayName);

  return { gc, email, displayName, fns, lastAccess: Date.now(), ticketAccess };
}

async function createGarminSession(email, password) {
  const gc = new GarminConnect({ username: email, password });
  try {
    await gc.login();
  } catch (err) {
    // Garmin demande une confirmation MFA (code SMS) : gc reste attache a
    // l'erreur pour que l'appelant (/api/setup, /api/login) puisse la
    // mettre en attente (pendingMfaLogins) et la reprendre plus tard avec
    // resumeWithMfa() - jamais recreer une instance fraiche pour ça, l'etat
    // de connexion en cours (cookies, _mfaLoginState) vit sur celle-ci.
    if (err && err.mfaRequired) { err.gc = gc; err.email = email; }
    throw err;
  }
  return finalizeGarminSession(gc, email);
}

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬
// Auto-login .env au d©marrage
// f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬
// f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬f¢â, â?s¬

const ENV_EMAIL    = process.env.GARMIN_EMAIL;
const ENV_PASSWORD = process.env.GARMIN_PASSWORD;
const ENV_CAMPUS_EMAIL    = process.env.CAMPUS_EMAIL    || null;
const ENV_CAMPUS_PASSWORD = process.env.CAMPUS_PASSWORD || null;
let   CAMPUS_ENABLED = process.env.CAMPUS_ENABLED !== 'false';
let   envSessionId = null;
let   _envCampusTokenCache = loadCampusTokenFromFile();
if (_envCampusTokenCache) console.log('[START] Token Campus restaure depuis fichier');

// ─── Migration ponctuelle des fichiers locaux vers le format cloisonne par
// compte {[email]: donnees} (voir readScoped/writeScoped) ─────────────────
// Convertit les fichiers historiques "a plat" (un seul compte implicite par
// machine) en presumant qu'ils appartiennent au compte d'auto-connexion de
// cette machine (ENV_EMAIL) - meme convention que la migration deja faite
// pour user_data.json. Idempotent : si le fichier a deja l'air scope (toutes
// ses cles racine ressemblent a un email), ne fait rien. Doit tourner avant
// tout appel a ensureSyncScheduled/app.listen, jamais apres.
function migrateToScoped(filePath, envEmail) {
  if (!envEmail) return;
  const raw = readJsonSafe(filePath, null);
  if (raw === null) return;
  const looksScoped = !Array.isArray(raw) && typeof raw === 'object' &&
    Object.keys(raw).every(k => k.includes('@'));
  if (looksScoped) return;
  writeJsonSafe(filePath, { [envEmail.toLowerCase()]: raw });
}
[RECORDS_OVERRIDES_FILE, RACES_FILE, WEIGHT_HISTORY_FILE, HEALTH_SNAPSHOTS_FILE,
 PPS_FILE, SESSION_ANALYSES_FILE, GEAR_FILE, ACTIVITY_GEAR_FILE, ACTIVITIES_CACHE_FILE]
  .forEach(f => migrateToScoped(f, ENV_EMAIL));
migratePaceProfileToScoped(ENV_EMAIL);

// Nettoyage ponctuel des doublons PPS herites d'avant le dedoublonnage par
// numero dans sync.js (voir SYNC_TYPES.pps/fromEntries) : un meme PPS saisi
// independamment sur deux machines avant l'ajout de la synchro s'y trouvait
// sous deux `id` differents, jamais fusionnes tant qu'aucun changement ne
// redeclenchait fromEntries. Idempotent (ne reecrit que si un vrai doublon
// est trouve), tourne une seule fois au demarrage.
(function dedupeLegacyPps() {
  const all = readJsonSafe(PPS_FILE, null);
  if (!all || typeof all !== 'object') return;
  let changed = false;
  Object.keys(all).forEach(email => {
    const list = all[email];
    if (!Array.isArray(list) || list.length < 2) return;
    const byNumber = new Map();
    list.forEach(entry => {
      const key = entry && entry.number ? entry.number : entry.id;
      const existing = byNumber.get(key);
      if (!existing || new Date(entry.uploadedAt || 0) >= new Date(existing.uploadedAt || 0)) {
        byNumber.set(key, entry);
      }
    });
    if (byNumber.size !== list.length) {
      all[email] = Array.from(byNumber.values());
      changed = true;
    }
  });
  if (changed) writeJsonSafe(PPS_FILE, all);
})();

// Nettoyage ponctuel d'un double cloisonnement herite sur weight_history.json
// - all[email] valait { [email]: [...] } au lieu de [...] directement (origine
// inconnue, probablement un writeScoped(WEIGHT_HISTORY_FILE, email, dejaScope)
// quelque part avant l'ajout du cloisonnement). Reste invisible tant qu'aucune
// reconciliation ne lit reellement ce fichier - demasque uniquement une fois
// la synchro cross-appareils effectivement programmee pour ce compte (voir
// ensureSyncScheduled plus haut), avec un crash silencieux en boucle («
// .forEach is not a function ») a chaque cycle. Idempotent.
(function unwrapDoubleNestedWeightHistory() {
  const all = readJsonSafe(WEIGHT_HISTORY_FILE, null);
  if (!all || typeof all !== 'object') return;
  let changed = false;
  Object.keys(all).forEach(email => {
    const v = all[email];
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.prototype.hasOwnProperty.call(v, email)) {
      all[email] = Array.isArray(v[email]) ? v[email] : [];
      changed = true;
    }
  });
  if (changed) writeJsonSafe(WEIGHT_HISTORY_FILE, all);
})();

// Avatar legacy (avatar.<ext>, sans compte) -> avatar-<slug>.<ext> pour le
// compte d'auto-connexion de cette machine, meme logique que ci-dessus.
(function migrateLegacyAvatar() {
  if (!ENV_EMAIL) return;
  try {
    const legacy = fs.readdirSync(UPLOADS_DIR).find(f => /^avatar\.[a-z0-9]+$/i.test(f));
    if (!legacy) return;
    const ext = path.extname(legacy);
    fs.renameSync(path.join(UPLOADS_DIR, legacy), path.join(UPLOADS_DIR, 'avatar-' + slugifyEmail(ENV_EMAIL) + ext));
  } catch (e) {}
})();

// Dossier de persistance des tokens Garmin OAuth - cloisonne par compte
// (sous-dossier .garmin_tokens/<slug-email>/) pour la meme raison que les
// donnees locales (records, courses...) : deux comptes Garmin utilises sur
// la meme machine ne doivent jamais se marcher dessus. Chaque connexion
// reussie ecrit dans SON sous-dossier (createGarminSession) - au demarrage,
// restoreGarminSession doit determiner CE compte parmi ceux deja connectes
// sur cette machine avant de savoir ou lire.
const GARMIN_TOKEN_DIR = path.join(__dirname, '.garmin_tokens');
if (!fs.existsSync(GARMIN_TOKEN_DIR)) fs.mkdirSync(GARMIN_TOKEN_DIR, { recursive: true });
function garminTokenDirFor(email) {
  return path.join(GARMIN_TOKEN_DIR, slugifyEmail(email));
}

// Migration ponctuelle : les jetons vivaient jusqu'ici a plat directement
// dans GARMIN_TOKEN_DIR (un seul compte possible par machine). On les
// deplace dans le sous-dossier du compte reellement proprietaire - determine
// en interrogeant Garmin avec ces jetons memes (le seul moyen fiable, ENV_EMAIL
// peut etre absent ou perime). Idempotent : no-op si deja migre.
async function migrateLegacyGarminTokens() {
  const oauth1Path = path.join(GARMIN_TOKEN_DIR, 'oauth1_token.json');
  const oauth2Path = path.join(GARMIN_TOKEN_DIR, 'oauth2_token.json');
  if (!fs.existsSync(oauth1Path) || !fs.existsSync(oauth2Path)) return;
  try {
    const gc = new GarminConnect({ username: ENV_EMAIL, password: ENV_PASSWORD });
    gc.loadTokenByFile(GARMIN_TOKEN_DIR);
    const profile = await gc.getUserProfile();
    const owner = (profile?.userName || '').toLowerCase();
    if (!owner) return;
    const destDir = garminTokenDirFor(owner);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(oauth1Path, path.join(destDir, 'oauth1_token.json'));
    fs.renameSync(oauth2Path, path.join(destDir, 'oauth2_token.json'));
    console.log(`[START] Jetons Garmin migres vers le sous-dossier du compte : ${owner}`);
  } catch (e) {
    console.warn('[WARN] Migration des jetons Garmin impossible (jetons perimes) :', e.message);
  }
}

// Tenter de restaurer une session Garmin depuis les tokens sauvegardés sur disque.
// Sans indice explicite (ENV_EMAIL vide), on ne peut choisir automatiquement
// entre plusieurs comptes deja connectes sur cette machine sans risquer de
// restaurer le mauvais - dans ce cas precis, un seul sous-dossier present
// reste un choix sur (c'est alors le seul compte jamais connecte ici).
async function restoreGarminSession() {
  await migrateLegacyGarminTokens();

  let tokenDir;
  if (ENV_EMAIL && fs.existsSync(garminTokenDirFor(ENV_EMAIL))) {
    tokenDir = garminTokenDirFor(ENV_EMAIL);
  } else if (!ENV_EMAIL) {
    const subdirs = fs.readdirSync(GARMIN_TOKEN_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    if (subdirs.length === 1) tokenDir = path.join(GARMIN_TOKEN_DIR, subdirs[0]);
  }
  if (!tokenDir) return null;

  try {
    const gc = new GarminConnect({ username: ENV_EMAIL, password: ENV_PASSWORD });
    gc.loadTokenByFile(tokenDir);
    // Valider que la session est encore active avec un appel leger
    // (reutilise aussi pour calculer le nom d'affichage, comme au login complet)
    const profile = await gc.getUserProfile();
    const displayName = computeDisplayName(profile);
    const fns = buildGarminFunctions(gc);
    console.log('[START] Session Garmin restauree depuis tokens sauvegardes (pas de login SSO)');
    // email : toujours celui du PROFIL GARMIN reellement restaure (userName),
    // jamais ENV_EMAIL - un email errone ici fait echouer TOUT le
    // cloisonnement par compte des donnees locales (chaque route lit/ecrit
    // sous req.session.email, cf readScoped/writeScoped).
    const restoredEmail = (profile?.userName || ENV_EMAIL || '').toLowerCase();
    // Rejette la restauration si ce compte a ete bloque par l'admin - les
    // jetons OAuth restent valides sur disque (pas d'unlinkSync ici, voir le
    // catch ci-dessous reserve aux jetons vraiment perimes/invalides), le
    // blocage est une decision Allure+, pas un probleme d'authentification
    // Garmin.
    const { ticketAccess } = await checkUserDirectory(restoredEmail, displayName);
    return { gc, email: restoredEmail, displayName, fns, lastAccess: Date.now(), ticketAccess };
  } catch(e) {
    if (e.blocked) {
      console.warn(`[WARN] Compte bloque par l'administrateur, session non restauree : ${e.message}`);
      return null;
    }
    console.warn('[WARN] Tokens Garmin sauvegardes expires ou invalides, login SSO necessaire.');
    // Supprimer les tokens invalides (ce compte seulement)
    try { fs.unlinkSync(path.join(tokenDir, 'oauth1_token.json')); } catch(_) {}
    try { fs.unlinkSync(path.join(tokenDir, 'oauth2_token.json')); } catch(_) {}
    return null;
  }
}

// Demarre (une seule fois par email, quel que soit le nombre de connexions/
// onglets) une reconciliation immediate + un cycle periodique de synchro
// cross-appareils pour CE compte. Appele aussi bien pour le compte
// auto-login (.env) que pour tout compte connecte manuellement via le
// navigateur - la synchro ne doit jamais dependre de la presence d'un .env,
// sinon un compte sans auto-login pousserait bien ses propres changements
// (scheduleSync est deja generique, declenche a chaque ecriture locale) mais
// ne recupererait jamais automatiquement ceux pousses par un autre appareil.
// Doit rester a la racine du module (pas dans le callback tryAutoLogin().then(...)
// plus bas, qui ne s'execute qu'apres coup) : la route /api/login l'appelle
// directement, bien avant que ce callback ne s'execute - bug reel constate
// (14/08) ou cette fonction, definie plus bas dans ce callback differe,
// etait invisible depuis /api/login (avalee silencieusement par son
// try/catch, l'utilisateur restait connecte mais sans synchro programmee, le
// voyant restant bloque "en cours" indefiniment).
// async + attend la toute PREMIERE reconciliation (les appelants peuvent
// faire `await ensureSyncScheduled(email)` avant de repondre au client) -
// sans ca, un tout nouveau PC (aucune donnee locale, tout a rapatrier
// depuis le cloud : profil, objectifs, plan importe, PPS, avatar...)
// recevait la reponse de connexion AVANT que la reconciliation initiale
// n'ait fini de peupler data/*.json, et le frontend (syncUserDataFromServer,
// appele une seule fois au demarrage) ne retentait jamais - l'utilisateur
// se retrouvait avec une config vierge malgre des mois de donnees deja
// synchronisees depuis un autre appareil (constat reel 14/08, femme de
// l'utilisateur sur un PC neuf). Les cycles PERIODIQUES suivants restent
// fire-and-forget (aucune raison de faire attendre une page deja ouverte).
const _syncScheduledEmails = new Set();
async function ensureSyncScheduled(email) {
  if (!email || _syncScheduledEmails.has(email)) return;
  _syncScheduledEmails.add(email);
  setInterval(() => {
    runFullReconciliation(email).catch(e => console.error('[sync] reconciliation periodique echouee:', e.message));
  }, 5 * 60 * 1000);
  await runFullReconciliation(email).catch(e => console.error('[sync] reconciliation initiale echouee:', e.message));
}

async function tryAutoLogin() {
  // 1. Essayer d'abord de restaurer la session depuis les tokens deja valides
  //    sauvegardes sur disque (pas de nouveau login SSO). C'etait defini mais
  //    jamais appele : chaque redemarrage refaisait un login SSO complet, ce
  //    qui peut declencher une verification anti-fraude Garmin sur un
  //    appareil/IP inhabituel (ex: nouveau PC) et echouer silencieusement.
  const restored = await restoreGarminSession();
  if (restored) {
    envSessionId = uuidv4();
    sessions.set(envSessionId, restored);
    await ensureSyncScheduled(restored.email);
    await tryAutoLoginCampus();
    return;
  }

  if (!ENV_EMAIL || !ENV_PASSWORD) {
    // Pas de credentials Garmin f¢â?s¬â, tenter quand mªme le login Campus seul
    await tryAutoLoginCampus();
    return;
  }
  try {
    console.log('[LOGIN] Auto-login .env pour:', ENV_EMAIL);
    const s = await createGarminSession(ENV_EMAIL, ENV_PASSWORD);
    envSessionId = uuidv4();
    sessions.set(envSessionId, s);
    await ensureSyncScheduled(s.email);
    console.log('[OK] Auto-login Garmin reussi');
  } catch(e) {
    console.warn('[WARN] Auto-login Garmin echoue:', e.message);
  }
  // Campus : toujours tenter en parall¨le
  await tryAutoLoginCampus();
}

async function tryAutoLoginCampus() {
  if (!ENV_CAMPUS_EMAIL || !ENV_CAMPUS_PASSWORD) return;
  try {
    const camp = await campusLogin(ENV_CAMPUS_EMAIL, ENV_CAMPUS_PASSWORD);
    _envCampusTokenCache = camp.token;
    saveCampusTokenToFile(camp.token);
    // Stocker aussi dans la session .env si dispo
    const s = sessions.get(envSessionId);
    if (s) { s.campusToken = camp.token; s.campusEmail = ENV_CAMPUS_EMAIL; }
    console.log('[OK] Auto-login Campus Coach reussi :', ENV_CAMPUS_EMAIL);
  } catch(e) {
    console.warn('[WARN] Auto-login Campus Coach echoue:', e.message);
    // Do NOT overwrite the cached file token on failure f¢â?s¬â, keep last known-good token
    if (!_envCampusTokenCache) _envCampusTokenCache = loadCampusTokenFromFile();
  }
}

// Renouveler le token Campus toutes les 10h (tokens Campus expirent)
setInterval(tryAutoLoginCampus, 40 * 60 * 1000)  // Refresh toutes les 40min (token expire en ~1h);

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Routes AUTH
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

// Status (utilis© par login.html pour savoir si d©j  connect©)
app.get('/api/status', (req, res) => {
  let s = getSession(req);

  // Auto-restauration apres redemarrage : si le navigateur a un ancien sid invalide
  // mais que l'auto-login .env a reussi, on donne au navigateur le nouveau sid valide
  if (!s && envSessionId && sessions.has(envSessionId)) {
    s = sessions.get(envSessionId);
    res.cookie('sid', envSessionId, { httpOnly: true, sameSite: 'lax' });
    console.log('[SESSION] Session restauree automatiquement apres redemarrage');
  }

  res.json({
    connected:      !!s,
    user:           s?.email || null,
    displayName:    s?.displayName || null,
    envEmail:       ENV_EMAIL || null,
    campusEnabled:  CAMPUS_ENABLED,
    brouterConfigured: isBrouterConfigured(),
    version:        APP_VERSION,
    // false uniquement si explicitement desactive par l'admin (voir
    // checkUserDirectory) - undefined (relais jamais interroge, session
    // restauree avant l'ajout de ce champ...) reste "true" par defaut,
    // jamais bloquant pour un compte legitime.
    ticketAccess:   s?.ticketAccess !== false,
  });
});

// Statut de la synchro cross-appareils (voir sync.js) - affiche par l'UI
// (sync-status-bar, sidebar) pour confirmer que les donnees perso sont a
// jour avec le cloud, ou signaler un probleme.
app.get('/api/sync/status', requireSession, (req, res) => {
  res.json(getSyncStatus());
});

// ─────────────────────────────────────────────
// Verification de mise a jour (GitHub Releases)
// ─────────────────────────────────────────────
const UPDATE_REPO = 'Tifnou/allure-plus';
let _updateCheckCache = null; // { data, ts }
const UPDATE_CHECK_TTL_MS = 10 * 60 * 1000; // 10 min — evite de solliciter l'API GitHub (limite 60 req/h sans auth) a chaque ouverture de l'app, tout en restant reactif

// Decoupe le corps markdown d'UNE release en { "Nom de section" : [items] } —
// items = puces (lignes "- "/"* "), tout le reste (paragraphes libres) est
// ignore lors de la fusion multi-versions (rare dans nos notes de version).
function parseReleaseSections(body) {
  const sections = {};
  let current = null;
  (body || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('## ')) {
      current = line.slice(3).trim();
      if (!sections[current]) sections[current] = [];
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!current) return; // puce hors section (ne devrait pas arriver) -> ignoree
      sections[current].push(line.slice(2).trim());
    }
  });
  return sections;
}

// Normalise les titres de section libres (accents/orthographe variables
// possibles d'une release a l'autre) vers une des 3 categories canoniques -
// permet de FUSIONNER les puces de plusieurs versions sautees sous une seule
// section par categorie, plutot que d'empiler "## Version X" x N avec des
// sous-titres repetes (bien moins lisible quand plusieurs versions sont sautees).
const CHANGELOG_CATEGORY_ORDER = ['Nouveautés', 'Améliorations', 'Corrections'];
function normalizeChangelogCategory(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('nouveaut')) return 'Nouveautés';
  if (n.includes('amelior') || n.includes('amélior')) return 'Améliorations';
  if (n.includes('correct') || n.includes('fix')) return 'Corrections';
  return null; // categorie non reconnue (ancien format libre) -> ignoree
}

// Fusionne les notes de plusieurs releases en un seul changelog groupe par
// categorie (au lieu d'un empilement par version) - cf commentaire sur
// normalizeChangelogCategory. Reste du markdown simple ("## Titre" + "- item"),
// compatible tel quel avec renderChangelogHtml (app.js) sans rien y changer.
function mergeReleaseNotesByCategory(pendingReleases) {
  const merged = {};
  CHANGELOG_CATEGORY_ORDER.forEach(cat => { merged[cat] = []; });
  pendingReleases.forEach(rel => {
    const sections = parseReleaseSections(rel.body);
    Object.entries(sections).forEach(([header, items]) => {
      const cat = normalizeChangelogCategory(header);
      if (cat) merged[cat].push(...items);
    });
  });
  return CHANGELOG_CATEGORY_ORDER
    .filter(cat => merged[cat].length > 0)
    .map(cat => `## ${cat}\n` + merged[cat].map(i => `- ${i}`).join('\n'))
    .join('\n\n');
}

function isNewerVersion(latest, current) {
  const a = String(latest).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

// Recupere TOUTES les releases (pas juste /releases/latest) pour pouvoir
// cumuler les notes de version quand un utilisateur a saute plusieurs
// versions (ex: bloque sur 1.23.0 pendant que 1.24.0 puis 1.24.1 sortent) -
// sinon la modale ne montrerait que le changelog de la toute derniere
// version, en oubliant ce qui a change entre-temps.
// Factorisee (etait avant le corps direct de /api/check-update) pour etre
// reutilisee par /api/update/download : le telechargement re-derive son
// URL lui-meme depuis GitHub plutot que de faire confiance a un downloadUrl
// fourni par le client (evite qu'un appel direct a cette route serve de
// telechargeur generique vers une URL arbitraire).
async function getUpdateInfo() {
  let releases = (_updateCheckCache && (Date.now() - _updateCheckCache.ts) < UPDATE_CHECK_TTL_MS)
    ? _updateCheckCache.releases : null;
  if (!releases) {
    const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'AllurePlus-App' },
      cache: 'no-store',
    });
    if (!r.ok) return { updateAvailable: false };
    releases = await r.json();
    _updateCheckCache = { releases, ts: Date.now() };
  }

  const parsed = releases
    .filter(rel => !rel.draft && !rel.prerelease && rel.tag_name)
    .map(rel => ({
      version: rel.tag_name.replace(/^v/, ''),
      body: rel.body || '',
      assets: rel.assets || [],
      html_url: rel.html_url,
      published_at: rel.published_at,
    }))
    .sort((a, b) => isNewerVersion(a.version, b.version) ? 1 : -1); // ascending : plus ancien -> plus recent

  const pending = parsed.filter(rel => isNewerVersion(rel.version, APP_VERSION));
  if (pending.length === 0) {
    return { updateAvailable: false, currentVersion: APP_VERSION, latestVersion: APP_VERSION };
  }

  const latest = pending[pending.length - 1];
  const asset = latest.assets.find(a => a.name.endsWith('.exe'));
  // Fusion par categorie (Nouveautes/Ameliorations/Corrections) de toutes
  // les releases manquees, plutot qu'un empilement "## Version X.Y.Z" par
  // release - voir mergeReleaseNotesByCategory.
  const releaseNotes = mergeReleaseNotesByCategory(pending);

  return {
    updateAvailable: true,
    currentVersion: APP_VERSION,
    latestVersion: latest.version,
    releaseNotes,
    downloadUrl: asset ? asset.browser_download_url : latest.html_url,
    downloadIsExe: !!asset,
    publishedAt: latest.published_at,
  };
}

app.get('/api/check-update', async (req, res) => {
  try {
    res.json(await getUpdateInfo());
  } catch (e) {
    res.json({ updateAvailable: false });
  }
});

// ─────────────────────────────────────────────
// Telechargement + installation de la mise a jour (demande utilisateur,
// 20/08) : jusqu'ici "Telecharger" se contentait d'un <a download> pointant
// directement vers l'asset GitHub - un telechargement navigateur classique,
// invisible dans cette fenetre --app= sans barre de telechargement, et sans
// aucune suite (l'utilisateur devait retrouver le .exe lui-meme dans son
// dossier Telechargements puis le lancer a la main). Allure+ tourne avec son
// propre serveur local : le telechargement se fait desormais ICI (flux vers
// le disque, progression suivie en memoire), et l'installeur peut etre
// lance directement en fin de telechargement - le frontend n'a plus qu'a
// afficher une barre de progression en interrogeant /api/update/download-
// progress, puis proposer "installer maintenant" une fois `status: 'done'`.
let _updateDownloadState = { status: 'idle', downloadedBytes: 0, totalBytes: 0, filePath: null, error: null };

app.post('/api/update/download', async (req, res) => {
  if (_updateDownloadState.status === 'downloading') {
    return res.json({ started: false, reason: 'already-downloading' });
  }
  let info;
  try { info = await getUpdateInfo(); } catch (e) { return res.status(502).json({ error: 'Verification de mise a jour impossible.' }); }
  if (!info.updateAvailable || !info.downloadIsExe) {
    return res.status(400).json({ error: 'Aucune mise a jour telechargeable pour le moment.' });
  }

  const destPath = path.join(os.tmpdir(), `AllurePlus_Update_${info.latestVersion}.exe`);
  _updateDownloadState = { status: 'downloading', downloadedBytes: 0, totalBytes: 0, filePath: destPath, error: null };
  res.json({ started: true });

  // Asynchrone, apres la reponse : le frontend suit la progression via
  // /api/update/download-progress plutot que d'attendre cette requete.
  (async () => {
    try {
      const r = await fetch(info.downloadUrl, { redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`Telechargement echoue (HTTP ${r.status})`);
      _updateDownloadState.totalBytes = parseInt(r.headers.get('content-length') || '0', 10);
      const fileStream = fs.createWriteStream(destPath);
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        _updateDownloadState.downloadedBytes += value.length;
        await new Promise((resolve, reject) => fileStream.write(Buffer.from(value), (err) => err ? reject(err) : resolve()));
      }
      await new Promise((resolve, reject) => fileStream.end((err) => err ? reject(err) : resolve()));
      _updateDownloadState.status = 'done';
    } catch (e) {
      _updateDownloadState.status = 'error';
      _updateDownloadState.error = e.message;
      console.error('[UPDATE] Telechargement echoue:', e.message);
    }
  })();
});

app.get('/api/update/download-progress', (req, res) => {
  res.json(_updateDownloadState);
});

// Lance l'installeur telecharge - detached (le processus survit a l'arret
// du serveur Node courant, que l'installeur va justement devoir remplacer)
// et stdio ignore (aucune console a garder ouverte). Le reste (fermer
// proprement l'app en cours, demander confirmation ecrasement) est gere par
// l'installeur Inno Setup lui-meme, pas ce code.
app.post('/api/update/install', (req, res) => {
  if (_updateDownloadState.status !== 'done' || !_updateDownloadState.filePath) {
    return res.status(400).json({ error: 'Aucun installeur pret a etre lance.' });
  }
  try {
    const child = spawn(_updateDownloadState.filePath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    res.json({ launched: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// Centre de support (remontee d'idees/bugs/questions)
// ─────────────────────────────────────────────
// Le backend reel est le relais Cloudflare (support-relay/), qui garde le
// token GitHub hors de portee de toute installation distribuee — server.js
// ne fait que relayer les requetes en y ajoutant l'email de la session
// (identite Garmin, deja connue) et la cle client. Voir support-relay/src/index.js
// pour le detail du fonctionnement (Issues GitHub = tickets, labels = categorie/statut).
// Valeurs par defaut EN DUR pour URL/CLIENT_KEY (pas seulement dans
// .env.example) : embarquees dans CHAQUE installation Allure+, pas des
// secrets par utilisateur - meme raisonnement/bug que SYNC_RELAY_URL
// (sync_client.js) : /api/save-env n'ecrit que les identifiants Garmin dans
// le .env genere lors de la config de l'auto-login, donc une installation
// neuve n'avait jamais ces valeurs et le Centre de support restait
// silencieusement non configure. ADMIN_KEY reste EXCLUSIVEMENT via .env
// (vrai secret prive, jamais embarque - controle les actions admin sur les
// tickets de tous les utilisateurs).
const SUPPORT_RELAY_URL  = process.env.SUPPORT_RELAY_URL  || 'https://allure-plus-support-relay.support-relay.workers.dev';
const SUPPORT_CLIENT_KEY = process.env.SUPPORT_CLIENT_KEY || '6a23376104f76e64d2d263b72ecc7bfb1fd3e0d7bd427dd8';
const SUPPORT_ADMIN_KEY  = process.env.SUPPORT_ADMIN_KEY;

async function callSupportRelay(path, options = {}) {
  if (!SUPPORT_RELAY_URL) throw new Error('Centre de support non configure (SUPPORT_RELAY_URL manquant)');
  const res = await fetch(`${SUPPORT_RELAY_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || `Erreur relais (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ─────────────────────────────────────────────
// Repertoire des utilisateurs (voir support-relay/src/index.js, routes
// /users/*) - meme relais/cles que le Centre de support ci-dessus, aucun
// nouveau secret a configurer. Seule visibilite possible pour l'admin sur
// une appli distribuee en .exe (qui l'a deja lancee, quand) et seul moyen de
// couper l'acces si l'executable circule hors de son controle.
// ─────────────────────────────────────────────

// Enregistre/actualise ce compte a chaque connexion reussie (login complet
// ET restauration par jetons - voir createGarminSession/restoreGarminSession)
// et rejette la connexion si l'admin l'a bloque. Fail-open sur toute erreur
// reseau/relais : un probleme de connectivite au relais ne doit jamais
// empecher un compte legitime de se connecter a Allure+.
async function checkUserDirectory(email, displayName) {
  try {
    // isAdmin : seul un nouveau compte (jamais vu du relais) en tient compte,
    // pour s'ouvrir l'acces tickets d'office - tout autre compte demarre
    // ferme par defaut, l'admin l'ouvre au cas par cas (retour utilisateur
    // 14/08).
    const isAdmin = (email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const data = await callSupportRelay('/users/ping', {
      method: 'POST',
      body: JSON.stringify({ email, displayName, isAdmin, clientKey: SUPPORT_CLIENT_KEY }),
    });
    if (data.blocked) {
      const err = new Error("Accès à Allure+ suspendu pour ce compte. Contactez l'administrateur.");
      err.blocked = true;
      throw err;
    }
    return { ticketAccess: data.ticketAccess !== false };
  } catch (e) {
    if (e.blocked) throw e;
    console.warn('[users] Verification du repertoire impossible (fail-open) :', e.message);
    return { ticketAccess: true };
  }
}

// Sweep periodique : synchronise, pour chaque compte actuellement connecte,
// son blocage ET son acces tickets depuis le repertoire - sans ca, une
// action admin (bloquer, ou cocher/decocher l'acces tickets) ne prenait
// effet qu'au prochain redemarrage de l'appli du compte concerne, ce qui
// n'etait pas acceptable pour le blocage (scenario executable qui fuite,
// decision explicite de l'utilisateur 14/08) ni tres pratique pour l'acces
// tickets (meme retour 14/08). Un compte bloque voit toutes ses sessions
// actives revoquees (et envSessionId si c'est la session d'auto-login
// concernee, meme geste que le fix logout plus haut) ; un compte non
// bloque voit juste son ticketAccess mis a jour sur ses sessions actives
// (lu par /api/status, gate le bouton flottant du Centre de support cote
// client).
const ACCOUNT_SYNC_INTERVAL_MS = 2 * 60 * 1000;
async function syncActiveSessionsFromDirectory() {
  const emails = new Set();
  for (const s of sessions.values()) if (s.email) emails.add(s.email.toLowerCase());
  for (const email of emails) {
    try {
      const data = await callSupportRelay(`/users/${encodeURIComponent(email)}/status?clientKey=${encodeURIComponent(SUPPORT_CLIENT_KEY)}`);
      if (data.blocked) {
        for (const [sid, s] of sessions) {
          if (s.email && s.email.toLowerCase() === email) {
            sessions.delete(sid);
            if (sid === envSessionId) envSessionId = null;
          }
        }
        console.warn(`[users] Compte ${email} bloqué — session(s) révoquée(s)`);
        continue;
      }
      for (const s of sessions.values()) {
        if (s.email && s.email.toLowerCase() === email) s.ticketAccess = data.ticketAccess !== false;
      }
    } catch (e) { /* silencieux, retente au prochain cycle */ }
  }
}
setInterval(syncActiveSessionsFromDirectory, ACCOUNT_SYNC_INTERVAL_MS);

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const data = await callSupportRelay(`/users?adminKey=${encodeURIComponent(SUPPORT_ADMIN_KEY)}`);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.post('/api/admin/users/:email/block', requireAdmin, async (req, res) => {
  try {
    const data = await callSupportRelay(`/users/${encodeURIComponent(req.params.email)}/block`, {
      method: 'POST',
      body: JSON.stringify({ adminKey: SUPPORT_ADMIN_KEY, blocked: !!req.body?.blocked }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.post('/api/admin/users/:email/ticket-access', requireAdmin, async (req, res) => {
  try {
    const data = await callSupportRelay(`/users/${encodeURIComponent(req.params.email)}/ticket-access`, {
      method: 'POST',
      body: JSON.stringify({ adminKey: SUPPORT_ADMIN_KEY, ticketAccess: !!req.body?.ticketAccess }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// Fiche detaillee d'un utilisateur (panel Admin, cf. echange utilisateur) -
// lit UNIQUEMENT ce qui est deja synchronise par sync-relay (types deja
// autorises, aucun Worker a redeployer) : VO2max (health_snapshots, cf.
// capture dans /api/dashboard) + profil/plan/assiduite (user_data). Portee
// volontairement limitee (pas d'avatar/PPS/diplomes) : uniquement ce que
// l'utilisateur a explicitement demande.
app.get('/api/admin/users/:email/details', requireAdmin, async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const [healthEnv, userDataEnv] = await Promise.all([
      syncClient.pullEnvelope('health_snapshots', email).catch(() => null),
      syncClient.pullEnvelope('user_data', email).catch(() => null),
    ]);

    // VO2max : entree la plus recente parmi "vo2max::<date>" - jamais
    // reappliquee localement nulle part (cf. capture dans /api/dashboard),
    // purement une lecture admin.
    let vo2max = null, vo2maxDate = null;
    if (healthEnv?.entries) {
      Object.entries(healthEnv.entries).forEach(([key, entry]) => {
        if (!key.startsWith('vo2max::') || entry.deletedAt) return;
        const d = entry.value?.date;
        const precise = entry.value?.value?.precise;
        const v = (typeof precise === 'number') ? precise : entry.value?.value?.vo2max;
        if (v != null && (!vo2maxDate || d > vo2maxDate)) { vo2maxDate = d; vo2max = v; }
      });
    }

    const ud = {};
    if (userDataEnv?.entries) {
      Object.entries(userDataEnv.entries).forEach(([key, entry]) => {
        if (!entry.deletedAt) ud[key] = entry.value;
      });
    }

    let profile = null;
    if (ud.suivi_sport_profile) {
      try {
        const p = JSON.parse(ud.suivi_sport_profile);
        let age = null;
        if (p.birthDate) {
          const b = new Date(p.birthDate), now = new Date();
          age = now.getFullYear() - b.getFullYear();
          const m = now.getMonth() - b.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
        }
        profile = { sex: p.sex || null, age };
      } catch (e) { /* profil illisible -> reste null */ }
    }

    // Plan suivi : "importe" (un de nos .aplus, avec libelle depuis
    // goal.planCategory/name) prioritaire sur "libre" quand prefer_imported_plan
    // est actif (meme regle que campus.js) ; sinon, aucune trace locale ->
    // probablement un plan Campus Coach vivant (juste mentionne, jamais
    // interroge - cf. echange utilisateur, hors de portee sans son propre
    // token Campus).
    let plan = { type: 'campus' };
    let adherence = null;
    if (ud.suivi_imported_plan && ud.prefer_imported_plan === 'true') {
      try {
        const data = JSON.parse(ud.suivi_imported_plan);
        const goal = data.goal || {};
        const cat = goal.planCategory;
        const label = cat ? [cat.sportLabel, cat.distLabel, cat.dplusTier].filter(Boolean).join(' · ') : (goal.goalType || null);
        plan = { type: 'imported', raceName: goal.name || goal.goalTitle || null, label };

        // Assiduite : seances des semaines deja commencees, "done" vs total du.
        const localDone = ud.suivi_local_done ? JSON.parse(ud.suivi_local_done) : {};
        const now = Date.now();
        let due = 0, done = 0;
        (data.weeks || []).forEach(week => {
          if (!week.weekDate || week.weekDate > now) return;
          (week.sessions || []).forEach((sess, idx) => {
            due++;
            if (localDone[`${week._id}_${sess.trainingIndex ?? idx}`] === 'done') done++;
          });
        });
        if (due > 0) adherence = Math.round((done / due) * 100);
      } catch (e) { /* plan illisible -> reste "campus" par defaut */ }
    } else if (ud.suivi_free_sessions) {
      plan = { type: 'free' };
    }

    res.json({ vo2max, vo2maxDate, profile, plan, adherence });
  } catch (err) { handleError(res, err); }
});

// Upload d'une image jointe a un ticket (voir support-relay/src/index.js,
// /images) - route generique, reutilisee par la creation de ticket ET les
// reponses (support.js envoie d'abord l'image, recupere son URL, puis
// l'inclut dans le payload du ticket/commentaire).
app.post('/api/support/images', requireSession, async (req, res) => {
  try {
    const { dataBase64, contentType } = req.body || {};
    const data = await callSupportRelay('/images', {
      method: 'POST',
      body: JSON.stringify({ dataBase64, contentType, clientKey: SUPPORT_CLIENT_KEY }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.post('/api/support/tickets', requireSession, async (req, res) => {
  try {
    const { category, page, message, imageUrl } = req.body || {};
    const data = await callSupportRelay('/tickets', {
      method: 'POST',
      body: JSON.stringify({ email: req.session.email, category, page, message, imageUrl, clientKey: SUPPORT_CLIENT_KEY }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.get('/api/support/tickets', requireSession, async (req, res) => {
  try {
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    const params = new URLSearchParams({ email: req.session.email, scope });
    const data = await callSupportRelay(`/tickets?${params}`);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.get('/api/support/tickets/:number', requireSession, async (req, res) => {
  try {
    const data = await callSupportRelay(`/tickets/${Number(req.params.number)}`);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.post('/api/support/tickets/:number/comments', requireSession, async (req, res) => {
  try {
    const { message, imageUrl } = req.body || {};
    const isAdmin = req.session.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const data = await callSupportRelay(`/tickets/${Number(req.params.number)}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        email: req.session.email,
        message,
        imageUrl,
        clientKey: SUPPORT_CLIENT_KEY,
        adminKey: isAdmin ? SUPPORT_ADMIN_KEY : undefined,
      }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// Suppression (masquage) d'un ticket : l'auteur peut supprimer son propre
// ticket, l'admin peut supprimer n'importe lequel (meme logique isAdmin que
// pour les commentaires, deduite de la session cote serveur, jamais du client).
app.delete('/api/support/tickets/:number', requireSession, async (req, res) => {
  try {
    const isAdmin = req.session.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const data = await callSupportRelay(`/tickets/${Number(req.params.number)}/delete`, {
      method: 'POST',
      body: JSON.stringify({
        email: req.session.email,
        clientKey: SUPPORT_CLIENT_KEY,
        adminKey: isAdmin ? SUPPORT_ADMIN_KEY : undefined,
      }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─ Centre de support admin (reserve au compte admin) ─
app.get('/api/support/admin/tickets', requireAdmin, async (req, res) => {
  try {
    const params = new URLSearchParams({ scope: 'all', adminKey: SUPPORT_ADMIN_KEY });
    const data = await callSupportRelay(`/tickets?${params}`);
    res.json(data);
  } catch (err) { handleError(res, err); }
});

app.post('/api/support/admin/tickets/:number/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};
    const data = await callSupportRelay(`/tickets/${Number(req.params.number)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, adminKey: SUPPORT_ADMIN_KEY }),
    });
    res.json(data);
  } catch (err) { handleError(res, err); }
});

// ─────────────────────────────────────────────
// Génération d'itinéraires (BRouter)
// ─────────────────────────────────────────────

app.get('/api/routes/geocode', requireSession, async (req, res) => {
  try {
    const address = (req.query.address || '').trim();
    if (!address) return res.status(400).json({ error: 'Adresse manquante' });
    const candidates = await geocode(address);
    res.json({ candidates });
  } catch (err) { handleError(res, err); }
});

// Recherche en cascade (code postal -> ville -> rue) via les API officielles
// francaises, pour la saisie du depart sur la page Itineraires. Accepte
// aussi un code departement seul (2 chiffres, 2A/2B, ou 971-976 outre-mer)
// quand le code postal complet n'est pas connu - liste alors toutes les
// communes du departement, triees par ordre alphabetique.
const DEPARTMENT_CODE_RE = /^(\d{2}|2[AB]|97[1-6])$/i;
app.get('/api/routes/communes', requireSession, async (req, res) => {
  try {
    const postcode = (req.query.postcode || '').trim();
    const department = (req.query.department || '').trim();
    if (/^\d{5}$/.test(postcode)) {
      const communes = await getCommunesForPostcode(postcode);
      return res.json({ communes });
    }
    if (DEPARTMENT_CODE_RE.test(department)) {
      const communes = await getCommunesForDepartment(department.toUpperCase());
      return res.json({ communes });
    }
    return res.status(400).json({ error: 'Code postal ou code département invalide' });
  } catch (err) { handleError(res, err); }
});

app.get('/api/routes/street-suggestions', requireSession, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const citycode = (req.query.citycode || '').trim();
    if (q.length < 2 || !citycode) return res.json({ suggestions: [] });
    const suggestions = await searchStreet(q, citycode);
    res.json({ suggestions });
  } catch (err) { handleError(res, err); }
});

app.get('/api/routes/town-hall', requireSession, async (req, res) => {
  try {
    const citycode = (req.query.citycode || '').trim();
    if (!citycode) return res.status(400).json({ error: 'Ville manquante' });
    const townHall = await getTownHall(citycode);
    if (!townHall) return res.status(404).json({ error: 'Mairie introuvable pour cette commune' });
    res.json({ townHall });
  } catch (err) { handleError(res, err); }
});

// Verifie si la tuile OSM (segments4/*.rd5) couvrant ce point est deja
// presente en local ; sinon renvoie sa taille reelle (HEAD distant) pour
// que l'utilisateur confirme le telechargement avant de l'engager.
app.get('/api/routes/tile-check', requireSession, async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({ error: 'Coordonnées invalides' });
    }
    const { tileName, present } = isTilePresent(lat, lon);
    if (present) return res.json({ tileName, present: true });
    let sizeBytes = null;
    try { sizeBytes = await getTileRemoteSize(tileName); } catch (e) { /* taille non critique */ }
    res.json({ tileName, present: false, sizeBytes });
  } catch (err) { handleError(res, err); }
});

app.post('/api/routes/tile-download', requireSession, async (req, res) => {
  try {
    const { lat, lon } = req.body || {};
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return res.status(400).json({ error: 'Coordonnées invalides' });
    }
    const { tileName, present } = isTilePresent(lat, lon);
    if (present) return res.json({ success: true, tileName, alreadyPresent: true });
    await downloadTile(tileName);
    res.json({ success: true, tileName });
  } catch (err) { handleError(res, err); }
});

app.post('/api/routes/generate', requireSession, async (req, res) => {
  try {
    const { start, targetDistanceM, targetDurationMin, targetAscentM, terrain, searchRadiusKm, routeShape, trailLevel, trailStyle } = req.body || {};
    if (!start || typeof start.lat !== 'number' || typeof start.lon !== 'number') {
      return res.status(400).json({ error: 'Point de départ invalide (adresse non confirmée ?)' });
    }
    if ((!targetDistanceM || targetDistanceM < 500) && (!targetDurationMin || targetDurationMin < 5)) {
      return res.status(400).json({ error: 'Distance ou durée cible invalide' });
    }
    const paceProfile = getPaceProfile(req.session.email);
    // Ancre le profil d'allure par tranche de pente sur l'allure EF rapide de
    // l'utilisateur plutot que sur la moyenne (tous efforts confondus) de ses
    // dernieres sorties analysees - cf pace_profile.js applyEfPaceAnchor.
    // VO2max lu depuis le dernier instantane deja capture (health_snapshots,
    // cf captureHealthSnapshot appele a chaque chargement du dashboard) -
    // aucun appel Garmin supplementaire ici. Repli silencieux sur le profil
    // non modifie si aucun instantane n'existe encore (premier lancement).
    const vo2maxSnapshots = getHealthSnapshots('vo2max', null, req.session.email);
    const latestVo2max = vo2maxSnapshots.length ? vo2maxSnapshots[vo2maxSnapshots.length - 1].value?.vo2max : null;
    const efPace = efFastPaceMinPerKm(latestVo2max);
    const paceMinPerKm = applyEfPaceAnchor(paceProfile.paceMinPerKm, efPace);
    const isTrail = terrain !== 'route';
    const levelMidKmh = isTrail ? trailLevelMidKmh(trailLevel) : null;
    // Si seule la duree est fournie, estimation de depart pour la forme de la
    // boucle (affinee ensuite par generateLoop). Deux modeles selon le
    // contexte : en trail avec un niveau de traileur choisi, la MEME formule
    // "distance equivalente plat" (distance + D+/100) que le reste du calcul
    // niveau-based (voir route_generator.js, TRAIL_LEVELS) - reutilise ici en
    // sens inverse (duree+D++vitesse -> distance) pour une estimation de
    // depart deja realiste, cohérente avec ce qui a ete confirme cote client
    // (routesBuildLevelConfirmation, routes.js) avant l'envoi de cette
    // requete. Sinon (route, ou trail sans niveau fourni), comportement
    // d'origine : allure A PLAT du profil personnel, optimiste par
    // construction mais recalculee reellement une fois le tracé obtenu.
    const distanceEstimateM = targetDistanceM
      || (levelMidKmh
        ? Math.max(500, (levelMidKmh * (targetDurationMin / 60) - (targetAscentM || 0) / 100) * 1000)
        : (targetDurationMin * 1000) / paceMinPerKm.flat);
    const result = await generateRouteOptions({
      start,
      targetDistanceM: distanceEstimateM,
      targetDurationMin: targetDurationMin || null,
      targetAscentM: targetAscentM || null,
      terrain: isTrail ? 'trail' : 'route',
      paceMinPerKm,
      searchRadiusM: (searchRadiusKm && searchRadiusKm > 0) ? searchRadiusKm * 1000 : null,
      routeShape: ['loop', 'outback', 'both'].includes(routeShape) ? routeShape : 'loop',
      trailLevel: levelMidKmh ? trailLevel : null,
      trailStyle: isTrail && Object.prototype.hasOwnProperty.call(TRAIL_STYLE_PARAMS, trailStyle) ? trailStyle : null,
    });
    res.json({ ...result, paceProfileIsGeneric: paceProfile.isGeneric });
  } catch (err) { handleError(res, err); }
});

app.post('/api/routes/gpx', requireSession, (req, res) => {
  try {
    const { points, label } = req.body || {};
    if (!Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: 'Points de tracé manquants' });
    }
    const gpx = buildGpxXml(points, label);
    const filename = (label || 'itineraire').replace(/[^a-zA-Z0-9-_]+/g, '_') + '.gpx';
    res.set('Content-Type', 'application/gpx+xml');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(gpx);
  } catch (err) { handleError(res, err); }
});

app.get('/api/routes/pace-profile', requireSession, (req, res) => {
  res.json(getPaceProfile(req.session.email));
});

app.post('/api/routes/pace-profile/refresh', requireSession, async (req, res) => {
  try {
    const profile = await refreshPaceProfile(req.session.email);
    scheduleSync('pace_profile', 'profile', req.session.email);
    res.json(profile);
  } catch (err) { handleError(res, err); }
});

// Admin info d©taill©
// Référence D+ par catégorie de distance trail (tableau établi avec l'utilisateur) :
// chaque catégorie de distance a ses propres paliers de dénivelé positif, un D+
// "important" pour un trail court n'a pas le même sens qu'un D+ "important" pour
// un ultra-trail. Palier haut = [min, max), dernier palier = [min, +l'infini).
const TRAIL_DPLUS_TIERS = {
  court: [ // < 21 km
    { label: 'Peu vallonné',      min: 0,    max: 300  },
    { label: 'Vallonné',          min: 300,  max: 700  },
    { label: 'Montagneux',        min: 700,  max: 1200 },
    { label: 'Très montagneux',   min: 1200, max: null },
  ],
  moyen: [ // 21-42 km
    { label: 'Peu vallonné',      min: 0,    max: 600  },
    { label: 'Vallonné',          min: 600,  max: 1200 },
    { label: 'Montagneux',        min: 1200, max: 2200 },
    { label: 'Très montagneux',   min: 2200, max: null },
  ],
  long: [ // 42-80 km
    { label: 'Peu vallonné',      min: 0,    max: 2000 },
    { label: 'Vallonné',          min: 2000, max: 3500 },
    { label: 'Montagneux',        min: 3500, max: 5000 },
    { label: 'Très montagneux',   min: 5000, max: null },
  ],
  ultra: [ // > 80 km
    { label: 'Peu vallonné',      min: 0,    max: 2500 },
    { label: 'Vallonné',          min: 2500, max: 4000 },
    { label: 'Montagneux',        min: 4000, max: 6000 },
    { label: 'Très montagneux',   min: 6000, max: null },
  ],
};

function findDplusTierLabel(distCat, dplusMin) {
  const tiers = TRAIL_DPLUS_TIERS[distCat];
  if (!tiers || dplusMin == null) return null;
  const tier = tiers.find(t => dplusMin >= t.min && (t.max === null || dplusMin < t.max));
  return tier ? tier.label : null;
}

app.get('/api/admin-info', (req, res) => {
  const mem = process.memoryUsage();
  const upSec = Math.floor(process.uptime());
  const hours = Math.floor(upSec / 3600);
  const mins  = Math.floor((upSec % 3600) / 60);
  const secs  = upSec % 60;
  const upStr = `${hours}h ${mins}m ${secs}s`;

  // R©cup©rer les infos de session active
  let garminEmail = null, campusEmail = null, garminConnected = false, campusConnected = false;
  for (const [, s] of sessions) {
    if (s.email) { garminEmail = s.email; garminConnected = true; }
    if (s.campusEmail) { campusEmail = s.campusEmail; campusConnected = true; }
  }

  res.json({
    server: {
      uptime:   upStr,
      nodeVersion: process.version,
      memRSS:   Math.round(mem.rss / 1024 / 1024) + ' MB',
      memHeap:  Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
      pid:      process.pid,
    },
    garmin:  { connected: garminConnected, email: garminEmail },
    campus:  { connected: campusConnected, email: campusEmail },
    adminEmail: ENV_EMAIL || null,
    dplusTiers: TRAIL_DPLUS_TIERS,
  });
});

// Setup (1er lancement / reconfiguration) - sans authentification requise
// Suite de /api/setup une fois la connexion Garmin etablie (avec ou sans
// MFA entre-temps - voir /api/login/mfa) : credentials .env, Campus Coach,
// synchro cross-appareils. Extrait de /api/setup pour etre rejoue a
// l'identique depuis /api/login/mfa quand la connexion initiale demandait
// un code MFA.
async function finishSetup(res, sessionData, fields) {
  const {
    garminEmail, rememberGarmin,
    campusEnabled: campusEnabledReq, campusEmail, campusPassword, rememberCampus
  } = fields;

  const sid = uuidv4();
  sessions.set(sid, sessionData);
  res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });

  // Lire .env existant
  const envPath = path.join(__dirname, '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const setEnvVar = (content, key, value) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line  = `${key}=${value}`;
    return regex.test(content) ? content.replace(regex, line) : content + (content.endsWith('\n') || !content ? '' : '\n') + line + '\n';
  };
  const delEnvVar = (content, key) => content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '');

  // Sauvegarder credentials Garmin si demande
  if (rememberGarmin) {
    envContent = setEnvVar(envContent, 'GARMIN_EMAIL', garminEmail);
    envContent = setEnvVar(envContent, 'GARMIN_PASSWORD', fields.garminPassword);
  }

  // Preference Campus Coach
  CAMPUS_ENABLED = !!campusEnabledReq;
  envContent = setEnvVar(envContent, 'CAMPUS_ENABLED', CAMPUS_ENABLED ? 'true' : 'false');

  // Campus Coach credentials si active
  if (CAMPUS_ENABLED && campusEmail && campusPassword) {
    try {
      const camp = await campusLogin(campusEmail, campusPassword);
      _envCampusTokenCache = camp.token;
      saveCampusTokenToFile(camp.token);
      const s = sessions.get(sid);
      if (s) { s.campusToken = camp.token; s.campusEmail = campusEmail; }
      if (rememberCampus) {
        envContent = setEnvVar(envContent, 'CAMPUS_EMAIL', campusEmail);
        envContent = setEnvVar(envContent, 'CAMPUS_PASSWORD', campusPassword);
      }
      console.log('Setup : Campus Coach connecte :', campusEmail);
    } catch(e) {
      console.warn('Setup : Campus Coach echec :', e.message);
      // Ne pas bloquer - la connexion Garmin est OK
    }
  } else {
    // Pas de Campus : nettoyer TOUT l'etat Campus
    envContent = delEnvVar(envContent, 'CAMPUS_EMAIL');
    envContent = delEnvVar(envContent, 'CAMPUS_PASSWORD');
    _envCampusTokenCache = null;
    saveCampusTokenToFile('');  // Efface .campus_token
    const sClean = sessions.get(sid);
    if (sClean) { sClean.campusToken = null; sClean.campusEmail = null; }
  }

  // Ecrire le .env mis a jour
  fs.writeFileSync(envPath, envContent.trimStart(), 'utf8');

  // Synchro cross-appareils - CETTE route est la toute premiere connexion
  // sur une machine neuve (login.html: "setup-card", jamais /api/login) et
  // n'appelait jusqu'ici jamais ensureSyncScheduled : un compte deja
  // utilise sur un autre appareil (profil, objectifs, plan importe, PPS,
  // avatar...) demarrait ici sur une config entierement vierge, sans
  // jamais rapatrier ses donnees existantes (constat reel 14/08 - femme de
  // l'utilisateur sur un PC neuf). Attendu avant de repondre au client,
  // pour la meme raison que /api/login.
  await ensureSyncScheduled(garminEmail);

  console.log('Setup : configuration sauvegardee. Campus enabled:', CAMPUS_ENABLED);
  res.json({ success: true, campusEnabled: CAMPUS_ENABLED });
}

app.post('/api/setup', async (req, res) => {
  try {
    const { garminEmail, garminPassword } = req.body;

    if (!garminEmail || !garminPassword) {
      return res.status(400).json({ error: 'E-mail et mot de passe Garmin requis.' });
    }

    // 1) Connexion Garmin
    console.log('Setup : connexion Garmin pour', garminEmail);
    const sessionData = await createGarminSession(garminEmail, garminPassword);
    // 2-7) .env, Campus Coach, synchro - voir finishSetup()
    await finishSetup(res, sessionData, req.body);

  } catch(err) {
    // Garmin demande un code de verification (SMS) - suite en attente,
    // reprise via /api/login/mfa avec le meme corps de requete (fields)
    // que celui-ci pour ne rien perdre du formulaire deja rempli.
    if (err && err.mfaRequired) {
      const mfaToken = uuidv4();
      pendingMfaLogins.set(mfaToken, {
        gc: err.gc, email: err.email, kind: 'setup',
        setupFields: req.body, createdAt: Date.now(),
      });
      return res.json({ mfaRequired: true, mfaToken });
    }
    console.error('Setup error:', err.message);
    // err.blocked verifie EN PREMIER, avant toute recherche de sous-chaine :
    // le message de blocage ("...administrateur.") contient lui-meme la
    // sous-chaine "rate" (adminis-TRATE-ur), faussement classe comme un
    // rate-limit Garmin par la recherche ci-dessous si on ne le court-
    // circuite pas ici (constate reel 14/08).
    const is429 = !err.blocked && (err.message.includes('429') || err.message.includes('427') || err.message.toLowerCase().includes('rate'));
    const msg = err.blocked
      ? err.message
      : (is429
        ? 'Trop de tentatives de connexion. Garmin a temporairement bloqué l\'accès. Attendez 2-3 minutes et réessayez.'
        : (err.message.includes('401') || err.message.toLowerCase().includes('invalid')
            ? 'Identifiants Garmin incorrects. Vérifiez votre e-mail et mot de passe.'
            : 'Erreur de connexion : ' + err.message));
    res.status(err.blocked ? 403 : (is429 ? 429 : 401)).json({ error: msg, retryable: is429 });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password, useEnv } = req.body;

    let sessionData;
    if (useEnv && ENV_EMAIL && ENV_PASSWORD) {
      // R©utiliser la session .env existante ou en cr©er une nouvelle
      if (envSessionId && sessions.has(envSessionId)) {
        sessionData = sessions.get(envSessionId);
        // On va cr©er un nouveau cookie qui pointe vers cette mªme session
        res.cookie('sid', envSessionId, { httpOnly: true, sameSite: 'lax' });
        await ensureSyncScheduled(sessionData.email);
        return res.json({ success: true, user: sessionData.email });
      }
      sessionData = await createGarminSession(ENV_EMAIL, ENV_PASSWORD);
      envSessionId = uuidv4();
      sessions.set(envSessionId, sessionData);
      res.cookie('sid', envSessionId, { httpOnly: true, sameSite: 'lax' });
      await ensureSyncScheduled(sessionData.email);
      return res.json({ success: true, user: sessionData.email });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    console.log('[LOGIN] Login manuel pour:', email);
    sessionData = await createGarminSession(email, password);
    const sid = uuidv4();
    sessions.set(sid, sessionData);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
    // Generique, pas seulement pour le compte auto-login .env - voir
    // ensureSyncScheduled : sans ca, un compte connecte manuellement
    // pousserait bien ses propres changements (scheduleSync, a chaque
    // ecriture) mais ne recupererait jamais ceux des autres appareils.
    // Attendu (pas fire-and-forget) : un tout nouveau PC doit rapatrier ses
    // donnees existantes AVANT que le frontend ne verifie une seule fois au
    // demarrage (voir commentaire sur ensureSyncScheduled).
    await ensureSyncScheduled(email);
    console.log('[OK] Session creee pour:', email);
    res.json({ success: true, user: email });

  } catch (err) {
    // Garmin demande un code de verification (SMS) - suite en attente,
    // reprise via /api/login/mfa (meme mecanisme que /api/setup ci-dessus).
    if (err && err.mfaRequired) {
      const mfaToken = uuidv4();
      pendingMfaLogins.set(mfaToken, {
        gc: err.gc, email: err.email, kind: 'login', createdAt: Date.now(),
      });
      return res.json({ mfaRequired: true, mfaToken });
    }
    console.error('Login error:', err.message);
    // err.blocked verifie EN PREMIER - voir le meme correctif sur /api/setup
    // juste au-dessus (le message de blocage contient "rate" via
    // "administrateur", faussement classe rate-limit Garmin sinon).
    const is429 = !err.blocked && (err.message.includes('429') || err.message.includes('427') || err.message.toLowerCase().includes('rate'));
    const msg = err.blocked
      ? err.message
      : (is429
        ? 'Trop de tentatives de connexion. Garmin a temporairement bloqué l\'accès. Attendez 2-3 minutes et réessayez.'
        : 'Identifiants Garmin incorrects. Vérifiez votre e-mail et mot de passe.');
    res.status(err.blocked ? 403 : (is429 ? 429 : 401)).json({ error: msg, retryable: is429 });
  }
});

// Reprise d'une connexion Garmin apres saisie du code MFA (SMS) - voir
// garmin_mfa_patch.js et pendingMfaLogins. Fonctionne pour /api/setup et
// /api/login, distingues via pending.kind (le corps de formulaire complet
// de /api/setup est conserve dans pending.setupFields pour ne rien perdre
// du formulaire deja rempli).
app.post('/api/login/mfa', async (req, res) => {
  try {
    const { mfaToken, code } = req.body;
    if (!mfaToken || !code) {
      return res.status(400).json({ error: 'Code de vérification requis.' });
    }
    const pending = pendingMfaLogins.get(mfaToken);
    if (!pending || (Date.now() - pending.createdAt) > MFA_PENDING_TTL_MS) {
      pendingMfaLogins.delete(mfaToken);
      return res.status(400).json({ error: 'Session de connexion expirée. Veuillez recommencer.' });
    }

    // Ne retire pending QU'EN CAS DE SUCCES : un code errone laisse
    // _mfaLoginState intact sur gc.client (voir garmin_mfa_patch.js), un
    // nouvel essai avec le bon code doit rester possible sans tout
    // redemarrer depuis le formulaire email/mot de passe.
    await pending.gc.resumeWithMfa(String(code).trim());
    pendingMfaLogins.delete(mfaToken);
    const sessionData = await finalizeGarminSession(pending.gc, pending.email);

    if (pending.kind === 'setup') {
      await finishSetup(res, sessionData, pending.setupFields);
      return;
    }

    const sid = uuidv4();
    sessions.set(sid, sessionData);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });
    await ensureSyncScheduled(pending.email);
    console.log('[OK] Session creee (apres MFA) pour:', pending.email);
    res.json({ success: true, user: pending.email });
  } catch (err) {
    console.error('MFA resume error:', err.message);
    res.status(401).json({ error: 'Code de vérification incorrect ou expiré. Veuillez réessayer.' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  const sid = req.cookies?.sid;
  // Ce que CETTE requete voit reellement comme "connecte", en reutilisant la
  // meme resolution que le reste de l'appli (getSession, comparaison par
  // reference a sessions.get(envSessionId)) - jamais une simple comparaison
  // de sid. Depuis l'ajout du repli transparent de getSession() (14/08,
  // Campus Coach faussement "deconnecte" apres redemarrage), TOUTES les
  // routes protegees (dont /api/status, appelee par login.html) retombent
  // silencieusement sur envSessionId des que le cookie sid est absent/perime
  // - SANS jamais poser ce cookie cote navigateur (seul l'ancien bloc de
  // secours de /api/status le faisait, devenu mort puisque getSession()
  // resout deja le repli en amont). Consequence : le navigateur n'a alors
  // JAMAIS de cookie sid egal a envSessionId, donc l'ancienne comparaison
  // `sid === envSessionId` ci-dessous ne matchait plus jamais - envSessionId
  // ne s'effacait jamais, et la requete /api/status suivante (sur /login)
  // retombait dessus et reconnectait instantanement (bug reel constate
  // 21/08 : "je clique sur deconnexion, ca se reconnecte aussitot").
  const effective = getSession(req);
  // Capture la reference AVANT le sessions.delete(sid) qui suit : si sid
  // est directement egal a envSessionId, delete() supprimerait cette meme
  // entree en premier, et sessions.get(envSessionId) ne renverrait plus
  // qu'undefined juste apres - faussant la comparaison par reference.
  const envSession = envSessionId ? sessions.get(envSessionId) : null;
  if (sid) sessions.delete(sid);
  if (envSessionId && effective === envSession) envSessionId = null;
  res.clearCookie('sid');
  res.json({ success: true });
});

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Routes API prot©g©es
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

// Dashboard
app.get('/api/dashboard', requireSession, async (req, res) => {
  try {
    const { getActivities } = req.session.fns;
    const gc = req.session.gc;
    const activities = await getActivities(200);
    const stats    = computeStats(activities);
    const lastRuns = getRecentActivities(activities, 50);
    const records  = getPersonalRecords(activities);

    // VO2max : source de reference = historique quotidien officiel Garmin
    // (celui que Garmin Connect utilise lui-meme pour sa propre courbe), qui
    // remplace la serie construite a partir du champ vO2MaxValue de chaque
    // activite. Cette derniere peut diverger (une sortie donnee n'est pas
    // forcement celle qui declenche le recalcul Garmin d'un jour donne), ce
    // qui faussait aussi bien la valeur du jour que l'indicateur de tendance.
    // Si l'historique est indisponible, on retombe sur la serie de computeStats().
    try {
      const history = await req.session.fns.getVO2MaxHistory();
      if (Array.isArray(history) && history.length > 0) {
        stats.vo2maxSeries = history.map(h => ({ date: h.date, value: h.value, preciseValue: h.preciseValue }));
        const last = history[history.length - 1];
        stats.latestVO2Max = last.value;
        stats.vo2MaxPrecise = last.preciseValue;
      }
    } catch(e) { /* silencieux - on garde la serie issue des activites */ }

    // Instantane quotidien du VO2max, reutilisant tel quel le mecanisme deja
    // en place pour "Statut d'entrainement" (captureHealthSnapshot, deja
    // synchronise via health_snapshots - aucun nouveau type/Worker requis).
    // Lu UNIQUEMENT par le panel Admin (pullEnvelope cote serveur, jamais par
    // un client Allure+) : rien ne relit "vo2max" localement, donc rien ne
    // peut jamais l'utiliser pour ecraser la valeur Garmin en direct
    // affichee dans l'app - purement informatif pour l'admin.
    if (stats.latestVO2Max) {
      captureHealthSnapshot('vo2max', todayParisISO(), { vo2max: stats.latestVO2Max, precise: stats.vo2MaxPrecise ?? null }, req.session.email);
    }

    const allActivities = activities.map(a => ({
      id:              a.activityId,
      date:            a.startTimeLocal,
      name:            a.activityName,
      distanceKm:      Math.round((a.distance || 0) / 10) / 100,
      durationSec:     a.duration,
      avgPaceSecPerKm: a.distance > 0 ? (a.duration / (a.distance / 1000)) : null,
      avgHR:           a.averageHR,
      maxHR:           a.maxHR,
      elevationGain:   a.elevationGain,
      calories:        a.calories,
      activityType:    a.activityType?.typeKey,
      vO2MaxValue:     a.vO2MaxValue,
      aerobicTrainingEffect:      a.aerobicTrainingEffect,
      anaerobicTrainingEffect:    a.anaerobicTrainingEffect,
      trainingEffectLabel:        a.trainingEffectLabel,
      aerobicTrainingEffectMessage:   a.aerobicTrainingEffectMessage,
      anaerobicTrainingEffectMessage: a.anaerobicTrainingEffectMessage,
      // ?? null (jamais laisser `undefined`) : JSON.stringify supprime
      // silencieusement une cle a `undefined` a l'ecriture du cache
      // (writeScoped/ACTIVITIES_CACHE_FILE plus bas) - une activite SANS
      // GPS (ex: cardio en salle) produit alors un objet sans la cle
      // "startLat" du tout. Si CETTE activite precise se retrouve en
      // position 0 du tableau mis en cache (la plus recente de l'annee),
      // le controle de fraicheur du cache (cached[0].startLat !== undefined,
      // route /api/activities/year/:year plus bas) la prend a tort pour un
      // cache pre-migration entier et refait un aller-retour Garmin complet
      // a CHAQUE chargement de cette annee, indefiniment (bug reel constate :
      // 2024 systematiquement plus lente que les autres annees a la page
      // Statistiques, a cause d'une seance de cardio en salle du 30/12/2024
      // sans coordonnees). `null` survit lui a la serialisation JSON, donc
      // la cle reste presente meme pour une activite sans GPS.
      startLat:        a.startLatitude ?? null,
      startLon:        a.startLongitude ?? null,
    }));
    res.json({ stats, lastRuns, allActivities, records, lastUpdated: new Date().toISOString() });
  } catch (err) { handleError(res, err); }
});

// Activites par annee (chargement a la demande)
app.get('/api/activities/year/:year', requireSession, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    const currentYear = new Date().getFullYear();
    if (!year || year < 2000 || year > currentYear) {
      return res.status(400).json({ error: 'Annee invalide' });
    }
    // Cache serveur pour les annees PASSEES ET CLOSES uniquement (elles ne
    // changeront plus jamais) — jamais l'annee en cours, qui continue de se
    // recharger en direct depuis Garmin a chaque appel (nouvelles activites
    // en continu). Meme frontiere que l'ancien cache localStorage cote
    // client (stats.js), deplacee ici pour que ca survive a un nettoyage du
    // navigateur ET marche des le premier chargement sur n'importe quel
    // navigateur, sans dependre du localStorage du tout.
    const isPastYear = year < currentYear;
    if (isPastYear) {
      const cached = readScoped(ACTIVITIES_CACHE_FILE, req.session.email, {})[year];
      // cached[0].startLat === undefined : cache ecrit avant l'ajout des
      // coordonnees de depart (globe des activites) - on l'ignore une fois
      // pour forcer un refetch qui le repeuplera avec le champ manquant,
      // plutot que de laisser ces annees sans points sur le globe indefiniment.
      if (cached && (cached.length === 0 || cached[0].startLat !== undefined)) {
        return res.json({ year, activities: cached, count: cached.length, cached: true });
      }
    }
    const { getActivitiesForYear } = req.session.fns;
    if (!getActivitiesForYear) return res.status(501).json({ error: 'Non supporte' });
    const activities = await getActivitiesForYear(year);
    const mapped = activities.map(a => ({
      id:              a.activityId,
      date:            a.startTimeLocal,
      name:            a.activityName,
      distanceKm:      Math.round((a.distance || 0) / 10) / 100,
      durationSec:     a.duration,
      avgPaceSecPerKm: a.distance > 0 ? (a.duration / (a.distance / 1000)) : null,
      avgHR:           a.averageHR,
      maxHR:           a.maxHR,
      elevationGain:   a.elevationGain,
      calories:        a.calories,
      activityType:    a.activityType?.typeKey,
      vO2MaxValue:     a.vO2MaxValue,
      aerobicTrainingEffect:      a.aerobicTrainingEffect,
      anaerobicTrainingEffect:    a.anaerobicTrainingEffect,
      trainingEffectLabel:        a.trainingEffectLabel,
      aerobicTrainingEffectMessage:   a.aerobicTrainingEffectMessage,
      anaerobicTrainingEffectMessage: a.anaerobicTrainingEffectMessage,
      // ?? null (jamais laisser `undefined`) : JSON.stringify supprime
      // silencieusement une cle a `undefined` a l'ecriture du cache
      // (writeScoped/ACTIVITIES_CACHE_FILE plus bas) - une activite SANS
      // GPS (ex: cardio en salle) produit alors un objet sans la cle
      // "startLat" du tout. Si CETTE activite precise se retrouve en
      // position 0 du tableau mis en cache (la plus recente de l'annee),
      // le controle de fraicheur du cache (cached[0].startLat !== undefined,
      // route /api/activities/year/:year plus bas) la prend a tort pour un
      // cache pre-migration entier et refait un aller-retour Garmin complet
      // a CHAQUE chargement de cette annee, indefiniment (bug reel constate :
      // 2024 systematiquement plus lente que les autres annees a la page
      // Statistiques, a cause d'une seance de cardio en salle du 30/12/2024
      // sans coordonnees). `null` survit lui a la serialisation JSON, donc
      // la cle reste presente meme pour une activite sans GPS.
      startLat:        a.startLatitude ?? null,
      startLon:        a.startLongitude ?? null,
    }));
    if (isPastYear) {
      const cache = readScoped(ACTIVITIES_CACHE_FILE, req.session.email, {});
      cache[year] = mapped;
      writeScoped(ACTIVITIES_CACHE_FILE, req.session.email, cache);
    }
    res.json({ year, activities: mapped, count: mapped.length });
  } catch (err) { handleError(res, err); }
});

// ─── Records personnels : calcul Garmin + corrections manuelles ───────
const RECORD_KEYS = ['1km', '5km', '10km', 'semi', 'marathon'];

app.get('/api/records', requireSession, async (req, res) => {
  try {
    const { getActivities } = req.session.fns;
    const activities = await getActivities(200);
    const computed = getPersonalRecords(activities);
    const overrides = readScoped(RECORDS_OVERRIDES_FILE, req.session.email, {});
    const result = {};
    RECORD_KEYS.forEach(key => {
      const override = overrides[key];
      const computedBest = computed[key]?.best || null;
      if (override) {
        // Une correction manuelle reste affichee telle quelle, mais si une
        // activite Garmin recente la bat, on le signale (sans jamais
        // l'ecraser silencieusement) - le choix reste a l'utilisateur.
        result[key] = { best: override, edited: true };
        if (computedBest && computedBest.duration < override.duration) {
          result[key].betterCandidate = computedBest;
        }
      } else {
        // Aucune saisie manuelle -> aucun record affiche (pas de deduction
        // automatique depuis Garmin sur ce champ tant qu'il n'a jamais ete
        // renseigne). La premiere valeur doit toujours venir d'une saisie.
        result[key] = { best: null, edited: false };
      }
    });
    res.json(result);
  } catch (err) { handleError(res, err); }
});

app.put('/api/records/:distance', requireSession, (req, res) => {
  try {
    const distance = req.params.distance;
    if (!RECORD_KEYS.includes(distance)) return res.status(400).json({ error: 'Distance inconnue' });
    const { name, date, durationSec, distanceM } = req.body || {};
    if (!name || !date || !durationSec || !distanceM) {
      return res.status(400).json({ error: 'Champs manquants (name, date, durationSec, distanceM)' });
    }
    const overrides = readScoped(RECORDS_OVERRIDES_FILE, req.session.email, {});
    overrides[distance] = {
      name: String(name).slice(0, 200),
      date,
      duration: Number(durationSec),
      distance: Number(distanceM),
      pace: Number(durationSec) / (Number(distanceM) / 1000),
    };
    writeScoped(RECORDS_OVERRIDES_FILE, req.session.email, overrides);
    scheduleSync('records_overrides', distance, req.session.email);
    res.json({ success: true, record: overrides[distance] });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/records/:distance', requireSession, (req, res) => {
  try {
    const distance = req.params.distance;
    if (!RECORD_KEYS.includes(distance)) return res.status(400).json({ error: 'Distance inconnue' });
    const overrides = readScoped(RECORDS_OVERRIDES_FILE, req.session.email, {});
    delete overrides[distance];
    writeScoped(RECORDS_OVERRIDES_FILE, req.session.email, overrides);
    scheduleSync('records_overrides', distance, req.session.email, true);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Courses personnelles (saisie libre) ──────────────────────────────
app.get('/api/races', requireSession, (req, res) => {
  const races = readScoped(RACES_FILE, req.session.email, []);
  races.sort((a, b) => {
    const byName = (a.name || '').localeCompare(b.name || '', 'fr', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    return new Date(a.date) - new Date(b.date);
  });
  res.json(races);
});

app.post('/api/races', requireSession, (req, res) => {
  try {
    const { name, type, date, distanceKm, durationSec, elevationGain, vo2max, dnf, activityId } = req.body || {};
    if (!name || !['route', 'trail'].includes(type) || !date || !distanceKm || !durationSec) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (name, type, date, distanceKm, durationSec)' });
    }
    const races = readScoped(RACES_FILE, req.session.email, []);
    const race = {
      id: crypto.randomUUID(),
      name: String(name).slice(0, 200),
      type,
      date,
      distanceKm: Number(distanceKm),
      durationSec: Number(durationSec),
      elevationGain: elevationGain != null && elevationGain !== '' ? Number(elevationGain) : null,
      vo2max: vo2max != null && vo2max !== '' ? Number(vo2max) : null,
      dnf: !!dnf,
      // Lien vers l'activite Garmin d'origine : fourni automatiquement depuis
      // "Envoyer vers Courses" (Activites), ou ajoute a posteriori par
      // l'utilisateur (suggestion date+distance, jamais un lien automatique
      // silencieux — voir linkRaceToActivity/findLikelyActivityMatch, records.js)
      activityId: activityId ? String(activityId) : null,
    };
    races.push(race);
    writeScoped(RACES_FILE, req.session.email, races);
    scheduleSync('races', race.id, req.session.email);
    res.json({ success: true, race });
  } catch (err) { handleError(res, err); }
});

app.put('/api/races/:id', requireSession, (req, res) => {
  try {
    const races = readScoped(RACES_FILE, req.session.email, []);
    const idx = races.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Course introuvable' });
    const { name, type, date, distanceKm, durationSec, elevationGain, vo2max, dnf, activityId } = req.body || {};
    if (!name || !['route', 'trail'].includes(type) || !date || !distanceKm || !durationSec) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }
    races[idx] = {
      ...races[idx],
      name: String(name).slice(0, 200),
      type, date,
      distanceKm: Number(distanceKm),
      durationSec: Number(durationSec),
      elevationGain: elevationGain != null && elevationGain !== '' ? Number(elevationGain) : null,
      vo2max: vo2max != null && vo2max !== '' ? Number(vo2max) : null,
      dnf: !!dnf,
      activityId: activityId ? String(activityId) : (races[idx].activityId || null),
    };
    writeScoped(RACES_FILE, req.session.email, races);
    scheduleSync('races', races[idx].id, req.session.email);
    res.json({ success: true, race: races[idx] });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/races/:id', requireSession, (req, res) => {
  try {
    const races = readScoped(RACES_FILE, req.session.email, []);
    const race = races.find(r => r.id === req.params.id);
    if (race?.certificateFile) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, race.certificateFile)); } catch (e) {}
      deleteBinaryFile(req.session.email, race.certificateFile).catch(() => {});
    }
    const filtered = races.filter(r => r.id !== req.params.id);
    writeScoped(RACES_FILE, req.session.email, filtered);
    scheduleSync('races', req.params.id, req.session.email, true);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Diplome de course (PDF ou image), stocke dans uploads/ comme l'avatar
app.post('/api/races/:id/certificate', requireSession, upload.single('certificate'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    const ext = (path.extname(req.file.originalname) || '.pdf').toLowerCase();
    if (!/^\.(pdf|jpe?g|png)$/.test(ext)) return res.status(400).json({ error: 'Format non supporte (PDF, JPG ou PNG)' });
    const races = readScoped(RACES_FILE, req.session.email, []);
    const idx = races.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Course introuvable' });
    if (races[idx].certificateFile) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, races[idx].certificateFile)); } catch (e) {}
      deleteBinaryFile(req.session.email, races[idx].certificateFile).catch(() => {});
    }
    const filename = 'race-' + races[idx].id + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    races[idx].certificateFile = filename;
    writeScoped(RACES_FILE, req.session.email, races);
    scheduleSync('races', races[idx].id, req.session.email);
    syncBinaryFile(req.session.email, filename).catch(() => {});
    res.json({ success: true, certificateUrl: '/uploads/' + filename });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/races/:id/certificate', requireSession, (req, res) => {
  try {
    const races = readScoped(RACES_FILE, req.session.email, []);
    const idx = races.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Course introuvable' });
    if (races[idx].certificateFile) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, races[idx].certificateFile)); } catch (e) {}
      deleteBinaryFile(req.session.email, races[idx].certificateFile).catch(() => {});
    }
    delete races[idx].certificateFile;
    writeScoped(RACES_FILE, req.session.email, races);
    scheduleSync('races', races[idx].id, req.session.email);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Équipement (chaussures) ───────────────────────────────────────────
// gear.json : liste des paires. activity_gear.json : { [activityId]: { gearId, distanceKm, date } }
// Le kilometrage par paire est la somme des distances des activites assignees
// au moment de l'assignation (snapshot, pas de reappel Garmin necessaire pour
// recalculer le total a chaque affichage).
function computeGearKm(gearId, activityGear) {
  return Object.values(activityGear)
    .filter(a => a.gearId === gearId)
    .reduce((sum, a) => sum + (Number(a.distanceKm) || 0), 0);
}

// route/trail depuis activityType Garmin, meme logique que partout ailleurs
// (isRaceEligibleActivity, sendActivityToRaces...) - null pour les sports
// non concernes (velo, marche, cardio...), jamais assignes automatiquement.
function activityGearType(activityType) {
  const t = (activityType || '').toLowerCase();
  if (t.includes('trail')) return 'trail';
  if (t.includes('run')) return 'route';
  return null;
}

// Rattrapage du kilometrage a la creation/modification d'une paire : depuis
// "firstUseDate", assigne cette paire a toutes les activites du meme type
// (route/trail) qui n'ont PAS deja une chaussure assignee - une activite
// deja assignee (a cette paire ou a une autre) n'est jamais ecrasee, pour
// ne pas detruire une correction manuelle existante. Avec 2 paires du meme
// type sur la meme periode, l'utilisateur corrige ensuite au cas par cas
// depuis le detail de chaque activite (choix assume, pas d'heuristique
// pour deviner laquelle a ete reellement portee).
async function backfillGearKm(gear, firstUseDate, session) {
  if (!firstUseDate) return;
  const since = new Date(firstUseDate).getTime();
  if (!Number.isFinite(since)) return;
  const activities = await session.fns.getActivities(300);
  const mapped = getRecentActivities(activities, 300);
  const activityGear = readScoped(ACTIVITY_GEAR_FILE, session.email, {});
  let changed = false;
  for (const a of mapped) {
    if (!a.id || !a.distanceKm || activityGear[a.id]) continue;
    if (activityGearType(a.activityType) !== gear.type) continue;
    if (new Date(a.date).getTime() < since) continue;
    activityGear[a.id] = { gearId: gear.id, distanceKm: a.distanceKm, date: a.date };
    changed = true;
    scheduleSync('activity_gear', a.id, session.email);
  }
  if (changed) writeScoped(ACTIVITY_GEAR_FILE, session.email, activityGear);
}

app.get('/api/gear', requireSession, (req, res) => {
  const gear = readScoped(GEAR_FILE, req.session.email, []);
  const activityGear = readScoped(ACTIVITY_GEAR_FILE, req.session.email, {});
  const withKm = gear.map(g => ({ ...g, currentKm: Math.round(computeGearKm(g.id, activityGear) * 10) / 10 }));
  res.json(withKm);
});

app.post('/api/gear', requireSession, async (req, res) => {
  try {
    const { brand, name, type, maxKm, isDefault, firstUseDate } = req.body || {};
    if (!name || !['route', 'trail'].includes(type)) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (name, type)' });
    }
    const gear = readScoped(GEAR_FILE, req.session.email, []);
    const item = {
      id: crypto.randomUUID(),
      brand: brand ? String(brand).slice(0, 80) : '',
      name: String(name).slice(0, 120),
      type,
      maxKm: maxKm != null && maxKm !== '' ? Number(maxKm) : null,
      isDefault: !!isDefault,
      firstUseDate: firstUseDate || null,
      createdAt: new Date().toISOString(),
    };
    // isDefault peut retirer le statut par defaut d'AUTRES paires du meme
    // type -> ces paires-la aussi doivent etre resynchronisees, pas juste item.
    const demoted = item.isDefault ? gear.filter(g => g.type === type && g.isDefault).map(g => g.id) : [];
    if (item.isDefault) gear.forEach(g => { if (g.type === type) g.isDefault = false; });
    gear.push(item);
    writeScoped(GEAR_FILE, req.session.email, gear);
    scheduleSync('gear', item.id, req.session.email);
    demoted.forEach(id => scheduleSync('gear', id, req.session.email));
    if (item.firstUseDate) await backfillGearKm(item, item.firstUseDate, req.session);
    res.json({ success: true, gear: item });
  } catch (err) { handleError(res, err); }
});

app.put('/api/gear/:id', requireSession, async (req, res) => {
  try {
    const gear = readScoped(GEAR_FILE, req.session.email, []);
    const idx = gear.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Paire introuvable' });
    const { brand, name, type, maxKm, isDefault, firstUseDate } = req.body || {};
    if (!name || !['route', 'trail'].includes(type)) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (name, type)' });
    }
    const demoted = isDefault ? gear.filter(g => g.type === type && g.id !== req.params.id && g.isDefault).map(g => g.id) : [];
    if (isDefault) gear.forEach(g => { if (g.type === type && g.id !== req.params.id) g.isDefault = false; });
    const previousFirstUseDate = gear[idx].firstUseDate || null;
    gear[idx] = {
      ...gear[idx],
      brand: brand ? String(brand).slice(0, 80) : '',
      name: String(name).slice(0, 120),
      type,
      maxKm: maxKm != null && maxKm !== '' ? Number(maxKm) : null,
      isDefault: !!isDefault,
      firstUseDate: firstUseDate || null,
    };
    writeScoped(GEAR_FILE, req.session.email, gear);
    scheduleSync('gear', gear[idx].id, req.session.email);
    demoted.forEach(id => scheduleSync('gear', id, req.session.email));
    // Rattrapage relance seulement si la date a change (nouvelle ou modifiee) -
    // sinon inutile de re-parcourir les activites a chaque simple renommage.
    if (gear[idx].firstUseDate && gear[idx].firstUseDate !== previousFirstUseDate) {
      await backfillGearKm(gear[idx], gear[idx].firstUseDate, req.session);
    }
    res.json({ success: true, gear: gear[idx] });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/gear/:id', requireSession, (req, res) => {
  try {
    const gear = readScoped(GEAR_FILE, req.session.email, []);
    const filtered = gear.filter(g => g.id !== req.params.id);
    writeScoped(GEAR_FILE, req.session.email, filtered);
    scheduleSync('gear', req.params.id, req.session.email, true);
    const activityGear = readScoped(ACTIVITY_GEAR_FILE, req.session.email, {});
    let changed = false;
    for (const key of Object.keys(activityGear)) {
      if (activityGear[key].gearId === req.params.id) {
        delete activityGear[key];
        changed = true;
        scheduleSync('activity_gear', key, req.session.email, true);
      }
    }
    if (changed) writeScoped(ACTIVITY_GEAR_FILE, req.session.email, activityGear);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// Chaussure assignee a une activite donnee — objet complet ou null
app.get('/api/activity-gear/:activityId', requireSession, (req, res) => {
  const activityGear = readScoped(ACTIVITY_GEAR_FILE, req.session.email, {});
  res.json(activityGear[req.params.activityId] || null);
});

app.put('/api/activity-gear/:activityId', requireSession, (req, res) => {
  try {
    const { gearId, distanceKm, date } = req.body || {};
    const gear = readScoped(GEAR_FILE, req.session.email, []);
    if (!gearId || !gear.some(g => g.id === gearId)) {
      return res.status(400).json({ error: 'Paire introuvable' });
    }
    const activityGear = readScoped(ACTIVITY_GEAR_FILE, req.session.email, {});
    activityGear[req.params.activityId] = {
      gearId,
      distanceKm: Number(distanceKm) || 0,
      date: date || null,
    };
    writeScoped(ACTIVITY_GEAR_FILE, req.session.email, activityGear);
    scheduleSync('activity_gear', req.params.activityId, req.session.email);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/activity-gear/:activityId', requireSession, (req, res) => {
  try {
    const activityGear = readScoped(ACTIVITY_GEAR_FILE, req.session.email, {});
    scheduleSync('activity_gear', req.params.activityId, req.session.email, true);
    delete activityGear[req.params.activityId];
    writeScoped(ACTIVITY_GEAR_FILE, req.session.email, activityGear);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Analyses seance prevue vs realisee (liaison Entrainement <-> Activites) ──
// Le calcul (zones, VMA, classification des laps...) vit entierement cote
// client (campus.js/app.js/session-analysis.js) - le serveur ne fait que
// stocker le resultat, pour ne pas dupliquer ALLURE_PLUS_ZONES et consorts.
// Une activite ne peut etre liee qu'a une seule seance, et reciproquement
// (contrainte imposee ici, jamais seulement cote client).
app.get('/api/session-analyses', requireSession, (req, res) => {
  const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
  res.json(analyses);
});

app.get('/api/session-analyses/by-activity/:activityId', requireSession, (req, res) => {
  const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
  const found = analyses.find(a => String(a.activityId) === String(req.params.activityId));
  if (!found) return res.status(404).json({ error: 'Aucune analyse pour cette activite' });
  res.json(found);
});

app.get('/api/session-analyses/by-session', requireSession, (req, res) => {
  const { weekId, trainingIndex } = req.query;
  if (!weekId || trainingIndex === undefined) {
    return res.status(400).json({ error: 'weekId et trainingIndex requis' });
  }
  const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
  const found = analyses.find(a =>
    a.planKey?.weekId === weekId && String(a.planKey?.trainingIndex) === String(trainingIndex));
  if (!found) return res.status(404).json({ error: 'Aucune analyse pour cette seance' });
  res.json(found);
});

app.post('/api/session-analyses', requireSession, (req, res) => {
  try {
    const body = req.body || {};
    const { planKey, activityId } = body;
    if (!planKey?.weekId || planKey?.trainingIndex === undefined || !activityId) {
      return res.status(400).json({ error: 'planKey (weekId, trainingIndex) et activityId requis' });
    }
    const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
    if (analyses.some(a => String(a.activityId) === String(activityId))) {
      return res.status(409).json({ error: 'Cette activite est deja liee a une autre seance' });
    }
    if (analyses.some(a => a.planKey?.weekId === planKey.weekId && String(a.planKey?.trainingIndex) === String(planKey.trainingIndex))) {
      return res.status(409).json({ error: 'Cette seance est deja liee a une autre activite' });
    }
    const now = new Date().toISOString();
    const record = { ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    analyses.push(record);
    writeScoped(SESSION_ANALYSES_FILE, req.session.email, analyses);
    scheduleSync('session_analyses', record.id, req.session.email);
    res.json({ success: true, analysis: record });
  } catch (err) { handleError(res, err); }
});

app.put('/api/session-analyses/:id', requireSession, (req, res) => {
  try {
    const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
    const idx = analyses.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Analyse introuvable' });
    const body = req.body || {};
    const { planKey, activityId } = body;
    const existing = analyses[idx];
    // Un recalcul (bouton "Recalculer") renvoie le meme activityId/planKey
    // que l'enregistrement existant - ce n'est pas une nouvelle liaison, donc
    // pas besoin (et pas souhaitable) de revalider les conflits : un vieux
    // doublon orphelin ailleurs dans le fichier ne doit jamais bloquer le
    // recalcul d'une liaison qui, elle, ne change pas (cf. bug constate ou
    // seul un delier/relier - qui cree un nouvel id - contournait le blocage).
    const activityChanged = activityId && String(activityId) !== String(existing.activityId);
    const sessionChanged = planKey?.weekId && (planKey.weekId !== existing.planKey?.weekId ||
      String(planKey.trainingIndex) !== String(existing.planKey?.trainingIndex));
    if (planKey?.weekId && activityId && (activityChanged || sessionChanged)) {
      const conflictActivity = activityChanged && analyses.some(a => a.id !== req.params.id && String(a.activityId) === String(activityId));
      const conflictSession = sessionChanged && analyses.some(a => a.id !== req.params.id &&
        a.planKey?.weekId === planKey.weekId && String(a.planKey?.trainingIndex) === String(planKey.trainingIndex));
      if (conflictActivity) return res.status(409).json({ error: 'Cette activite est deja liee a une autre seance' });
      if (conflictSession) return res.status(409).json({ error: 'Cette seance est deja liee a une autre activite' });
    }
    analyses[idx] = { ...analyses[idx], ...body, id: analyses[idx].id, createdAt: analyses[idx].createdAt, updatedAt: new Date().toISOString() };
    writeScoped(SESSION_ANALYSES_FILE, req.session.email, analyses);
    scheduleSync('session_analyses', analyses[idx].id, req.session.email);
    res.json({ success: true, analysis: analyses[idx] });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/session-analyses/:id', requireSession, (req, res) => {
  try {
    const analyses = readScoped(SESSION_ANALYSES_FILE, req.session.email, []);
    const filtered = analyses.filter(a => a.id !== req.params.id);
    writeScoped(SESSION_ANALYSES_FILE, req.session.email, filtered);
    scheduleSync('session_analyses', req.params.id, req.session.email, true);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── Historique du poids (saisie profil) ──────────────────────────────
// Un seul releve par jour (date au format YYYY-MM-DD, fuseau Europe/Paris) :
// une nouvelle saisie le meme jour ecrase la precedente plutot que d'empiler.
function todayParisISO() {
  const parts = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

// ─── Instantanes santé/performance (métriques sans historique Garmin natif) ─
// Certaines métriques Garmin (statut d'entraînement, seuil lactique, scores
// de montée/endurance, préparation à l'entraînement...) n'exposent qu'un
// instantané "actuel", pas d'historique interrogeable par plage de dates.
// On construit donc notre propre historique en capturant un instantané par
// jour (au plus 1x/jour) à chaque fois que la valeur courante est consultée.
function captureHealthSnapshot(metric, dateStr, value, email) {
  if (value == null || !email) return;
  const store = readScoped(HEALTH_SNAPSHOTS_FILE, email, {});
  const arr = store[metric] || (store[metric] = []);
  if (arr.some(e => e.date === dateStr)) return;
  arr.push({ date: dateStr, value });
  arr.sort((a, b) => new Date(a.date) - new Date(b.date));
  writeScoped(HEALTH_SNAPSHOTS_FILE, email, store);
  scheduleSync('health_snapshots', `${metric}::${dateStr}`, email);
}

function getHealthSnapshots(metric, days, email) {
  const store = readScoped(HEALTH_SNAPSHOTS_FILE, email, {});
  const arr = store[metric] || [];
  if (!days) return arr;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  return arr.filter(e => new Date(e.date).getTime() >= cutoff);
}

app.get('/api/health-history/:metric', requireSession, (req, res) => {
  const days = parseInt(req.query.days) || null;
  res.json(getHealthSnapshots(req.params.metric, days, req.session.email));
});

app.get('/api/weight-history', requireSession, (req, res) => {
  const history = readScoped(WEIGHT_HISTORY_FILE, req.session.email, []);
  history.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json(history);
});

app.post('/api/weight-history', requireSession, (req, res) => {
  try {
    const { weight, date } = req.body || {};
    const w = Number(weight);
    if (!w || w <= 0) return res.status(400).json({ error: 'Poids invalide' });
    const entryDate = date || todayParisISO();
    const history = readScoped(WEIGHT_HISTORY_FILE, req.session.email, []);
    const idx = history.findIndex(e => e.date === entryDate);
    const entry = { date: entryDate, weight: w };
    if (idx !== -1) history[idx] = entry; else history.push(entry);
    history.sort((a, b) => new Date(a.date) - new Date(b.date));
    writeScoped(WEIGHT_HISTORY_FILE, req.session.email, history);
    scheduleSync('weight_history', entryDate, req.session.email);
    res.json({ success: true, entry, history });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/weight-history/:date', requireSession, (req, res) => {
  try {
    const history = readScoped(WEIGHT_HISTORY_FILE, req.session.email, []);
    const filtered = history.filter(e => e.date !== req.params.date);
    writeScoped(WEIGHT_HISTORY_FILE, req.session.email, filtered);
    scheduleSync('weight_history', req.params.date, req.session.email, true);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── PPS : extraction via QR code ───────────────────────────────────────
// Le PDF officiel athle.fr embarque un QR pointant vers
// https://pps.athle.fr/passes/<token>/verify?data=<base64url zlib deflate>.
// Une fois inflate, ce parametre est un JSON structure (nom, prenom, numero,
// date d'expiration) : bien plus fiable que l'heuristique texte ci-dessous
// (qui doit deviner la position des valeurs dans un texte PDF non ordonne).
// On extrait les images XObject de chaque page via pdfjs-dist (sans rendu
// canvas - juste getOperatorList + page.objs) et on tente un decodage jsQR
// sur chacune ; fallback silencieux sur l'heuristique texte si absent/echec
// (autre gabarit de PPS, QR illisible, etc.).
function pdfImageToRgba(img) {
  if (!img || !img.width || !img.height || !img.data) return null;
  const { width, height, data, kind } = img;
  const n = width * height;
  if (data.length === n * 4) return data; // deja RGBA (kind 3)
  if (data.length === n * 3) { // RGB (kind 2)
    const rgba = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      rgba[p * 4] = data[p * 3]; rgba[p * 4 + 1] = data[p * 3 + 1]; rgba[p * 4 + 2] = data[p * 3 + 2]; rgba[p * 4 + 3] = 255;
    }
    return rgba;
  }
  const bytesPerRow = Math.ceil(width / 8);
  if (data.length === bytesPerRow * height) { // 1bpp grayscale (kind 1)
    const rgba = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const byte = data[y * bytesPerRow + (x >> 3)];
        const v = ((byte >> (7 - (x & 7))) & 1) ? 255 : 0;
        const p = (y * width + x) * 4;
        rgba[p] = v; rgba[p + 1] = v; rgba[p + 2] = v; rgba[p + 3] = 255;
      }
    }
    return rgba;
  }
  return null;
}

function parsePpsQrUrl(text) {
  try {
    const u = new URL(text);
    if (!/(^|\.)pps\.athle\.fr$/i.test(u.hostname)) return null;
    const dataParam = u.searchParams.get('data');
    if (!dataParam) return null;
    const zlib = require('zlib');
    const buf = Buffer.from(dataParam.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const json = JSON.parse(zlib.inflateSync(buf).toString('utf8'));
    const toIso = (d) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
    if (!json.pps_identifier && !json.last_name) return null;
    return {
      number: json.pps_identifier || null,
      expiryDate: toIso(json.expiry_date),
      lastName: json.last_name || null,
    };
  } catch (e) { return null; }
}

async function extractPpsFromQr(buffer) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const jsQR = require('jsqr');
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const OPS = pdfjsLib.OPS;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const opList = await page.getOperatorList();
      const imgNames = [];
      opList.fnArray.forEach((fn, i) => {
        if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) imgNames.push(opList.argsArray[i][0]);
      });
      for (const name of imgNames) {
        const img = await new Promise((resolve) => page.objs.get(name, resolve));
        const rgba = pdfImageToRgba(img);
        if (!rgba) continue;
        let code = jsQR(rgba, img.width, img.height);
        if (!code) {
          const inverted = new Uint8ClampedArray(rgba);
          for (let i = 0; i < inverted.length; i += 4) { const v = 255 - inverted[i]; inverted[i] = v; inverted[i + 1] = v; inverted[i + 2] = v; }
          code = jsQR(inverted, img.width, img.height);
        }
        if (code && code.data) {
          const parsed = parsePpsQrUrl(code.data);
          if (parsed) return parsed;
        }
      }
    }
  } catch (e) { console.log('Extraction QR PPS impossible:', e.message); }
  return null;
}

// ─── PPS (Pass Prevention Sante) ───────────────────────────────────────
// Jusqu'a 2 PPS (nom de naissance / nom marital : une inscription a une
// course a pu etre faite avec l'un ou l'autre). PDF stocke dans uploads/,
// numero + date d'expiration extraits automatiquement a l'import (best
// effort - le texte d'un PDF n'est pas toujours extrait dans l'ordre
// visuel), corrigibles manuellement via PUT si l'extraction se trompe.
app.get('/api/pps', requireSession, (req, res) => {
  res.json(readScoped(PPS_FILE, req.session.email, []));
});

app.post('/api/pps', requireSession, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    if (req.file.mimetype !== 'application/pdf' && !/\.pdf$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ error: 'Le fichier doit etre un PDF' });
    }
    const list = readScoped(PPS_FILE, req.session.email, []);
    if (list.length >= 2) {
      return res.status(400).json({ error: 'Deux PPS sont deja enregistres — supprimez-en un avant d\'en ajouter un nouveau' });
    }

    let number = null, expiryDate = null, lastName = null;
    const qrData = await extractPpsFromQr(req.file.buffer);
    if (qrData) {
      ({ number, expiryDate, lastName } = qrData);
    } else
    try {
      const { PDFParse } = require('pdf-parse');
      const parser = new PDFParse({ data: req.file.buffer });
      const parsed = await parser.getText();
      const text = parsed.text || '';

      // Numero PPS : "P" suivi d'alphanumerique incluant au moins un
      // chiffre (evite de matcher un mot comme "PREVENTION").
      const numMatch = text.match(/\bP(?=[A-Z0-9]*\d)[A-Z0-9]{8,12}\b/);
      if (numMatch) number = numMatch[0];

      // Date de validite : l'extraction d'un PDF ne respecte pas forcement
      // l'ordre visuel du document ("EXPIRE" et sa date peuvent se
      // retrouver loin l'un de l'autre, ou une autre date - naissance -
      // plus proche dans le texte brut). Strategie fiable : parmi toutes
      // les dates JJ/MM/AAAA du document, ne garder que celles dont
      // l'annee est plausible pour une validite (annee courante -1 a +3),
      // une date de naissance etant toujours bien plus ancienne. En cas
      // d'ambiguite (plusieurs dates plausibles), departager par proximite
      // avec le mot "EXPIRE".
      const currentYear = new Date().getFullYear();
      const allDates = [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
      const plausible = allDates.filter(m => {
        const y = parseInt(m[3], 10);
        return y >= currentYear - 1 && y <= currentYear + 3;
      });
      const idxExpire = text.search(/EXPIRE/i);
      const closestToExpire = (candidates) => {
        if (idxExpire === -1) return candidates[0];
        let best = candidates[0], bestDist = Infinity;
        candidates.forEach(m => { const d = Math.abs(m.index - idxExpire); if (d < bestDist) { bestDist = d; best = m; } });
        return best;
      };
      const chosen = plausible.length ? closestToExpire(plausible) : (allDates.length ? closestToExpire(allDates) : null);
      if (chosen) expiryDate = `${chosen[3]}-${chosen[2]}-${chosen[1]}`;

      // Nom : sur un exemplaire reel, l'extraction PDF regroupe tous les
      // libelles ("PRENOM NOM", "EXPIRE LE"...) d'un cote et toutes les
      // valeurs de l'autre, dans un ordre qui ne suit ni l'un ni l'autre
      // agencement visuel - impossible de rattacher une valeur a son
      // libelle par simple proximite textuelle. On isole donc les tokens
      // capitalises qui ne sont ni un libelle connu ni la valeur du sexe :
      // il en reste exactement 2 (nom, prenom). Sur le gabarit observe, le
      // nom precede la date de validite dans le texte brut et le prenom la
      // suit - on utilise cette position relative pour les departager.
      const KNOWN_LABELS = new Set(['NUMERO', 'NUMÉRO', 'PPS', 'PRENOM', 'PRÉNOM', 'NOM', 'NE', 'NÉ', 'SEXE', 'EXPIRE', 'LE', 'ATHLE', 'ATHLÉ', 'PASS', 'PREVENTION', 'PRÉVENTION', 'SANTE', 'SANTÉ', 'MASCULIN', 'FEMININ', 'FÉMININ']);
      const nameMatches = [...text.matchAll(/\b([A-ZÀ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'\-]{1,30})\b/g)]
        .filter(m => !KNOWN_LABELS.has(m[1].toUpperCase()));
      if (nameMatches.length) {
        const before = chosen ? nameMatches.filter(m => m.index < chosen.index) : [];
        lastName = (before.length ? before[before.length - 1] : nameMatches[0])[1];
      }

      await parser.destroy();
    } catch (e) { console.log('Extraction PDF PPS impossible:', e.message); }

    const id = crypto.randomUUID();
    const filename = 'pps-' + id + '.pdf';
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.file.buffer);
    const entry = { id, number, expiryDate, lastName, filename, uploadedAt: new Date().toISOString() };
    list.push(entry);
    writeScoped(PPS_FILE, req.session.email, list);
    scheduleSync('pps', entry.id, req.session.email);
    syncBinaryFile(req.session.email, filename).catch(() => {});
    res.json({ success: true, entry });
  } catch (err) { handleError(res, err); }
});

app.put('/api/pps/:id', requireSession, (req, res) => {
  try {
    const list = readScoped(PPS_FILE, req.session.email, []);
    const idx = list.findIndex(e => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'PPS introuvable' });
    const { number, expiryDate, lastName } = req.body || {};
    if (number != null) list[idx].number = String(number).slice(0, 40);
    if (expiryDate != null) list[idx].expiryDate = expiryDate;
    if (lastName != null) list[idx].lastName = String(lastName).slice(0, 60);
    writeScoped(PPS_FILE, req.session.email, list);
    scheduleSync('pps', list[idx].id, req.session.email);
    res.json({ success: true, entry: list[idx] });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/pps/:id', requireSession, (req, res) => {
  try {
    const list = readScoped(PPS_FILE, req.session.email, []);
    const entry = list.find(e => e.id === req.params.id);
    if (entry?.filename) {
      try { fs.unlinkSync(path.join(UPLOADS_DIR, entry.filename)); } catch (e) {}
      deleteBinaryFile(req.session.email, entry.filename).catch(() => {});
    }
    const filtered = list.filter(e => e.id !== req.params.id);
    writeScoped(PPS_FILE, req.session.email, filtered);
    scheduleSync('pps', req.params.id, req.session.email, true);
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// ─── GPX de la course cible (Objectifs) ────────────────────────────────
// Retour utilisateur explicite (aout 2026) : le temps/allure de course
// estime (estimateRaceTime, app.js) applique une regle generique "1 m D+ =
// 10 m plat" au D+ total saisi, ignorant completement la descente et la
// repartition reelle des pentes (une meme quantite de D+ concentree sur un
// mur ou etalee sur une pente douce n'a pas le meme cout). Importer le GPX
// reel de la course permet un profil altimetrique reel (cf gpx_parser.js) :
// % plat/montee/descente, pente moyenne en montee/descente - a la fois pour
// affiner l'estimation et pour une visualisation du parcours (modale dediee,
// campus.js). Stocke localement (comme records_overrides.json) plutot que
// synchronise entre appareils (scheduleSync) - simplification assumee pour
// une premiere version, le GPX peut etre reimporte sur un autre poste au besoin.
app.post('/api/goals/gpx', requireSession, upload.single('gpx'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const planId = (req.body?.planId || 'plan').slice(0, 80);
    if (!/\.gpx$/i.test(req.file.originalname || '') && !/<gpx[\s>]/i.test(req.file.buffer.slice(0, 500).toString('utf8'))) {
      return res.status(400).json({ error: 'Le fichier doit être un GPX' });
    }
    const gpxText = req.file.buffer.toString('utf8');
    const result = analyzeGpx(gpxText);
    if (!result) return res.status(400).json({ error: 'GPX illisible ou sans trace exploitable (moins de 2 points).' });

    // Corrige les altitudes du trace (deja sous-echantillonne par analyzeGpx,
    // <=1200 points) via l'API Altimetrie IGN (RGE ALTI, precision LIDAR) -
    // meme logique deja appliquee aux itineraires generes (route_generator.js,
    // getRouteAscent) : les altitudes brutes d'un GPX externe (souvent issues
    // d'un MNT plus grossier, ou d'une capture GPS bruitee) peuvent surestimer
    // le D+. Retour utilisateur reel confirmant l'ecart : 1642 m affiches par
    // Allure+ contre 1562 m annonces par Garmin pour le MEME fichier (Garmin
    // applique sa propre correction a l'import). La distance, elle, vient du
    // trace BRUT (deja fiable, cf analyzeGpx/downsample) et n'est jamais
    // touchee ici - seules les altitudes (D+/D-, % plat/montee/descente,
    // pentes moyennes) beneficient de la correction. Repli silencieux sur les
    // altitudes brutes du GPX si Geoportail est indisponible ou hors
    // couverture (fonctionnalite d'appoint, jamais bloquante).
    try {
      const correctedElevations = await getElevations(result.points);
      if (correctedElevations) {
        const correctedPoints = result.points.map((p, i) => ({
          ...p, ele: correctedElevations[i] != null ? correctedElevations[i] : p.ele,
        }));
        const correctedStats = computeElevationProfile(correctedPoints);
        if (correctedStats) {
          result.stats = { ...correctedStats, totalDistM: result.stats.totalDistM };
          result.points = correctedPoints;
        }
      }
    } catch (err) { /* correction IGN indisponible - on garde les altitudes brutes du GPX */ }

    const store = readScoped(GOAL_GPX_FILE, req.session.email, {});
    store[planId] = {
      points: result.points,
      stats: result.stats,
      filename: req.file.originalname || 'course.gpx',
      importedAt: new Date().toISOString(),
    };
    writeScoped(GOAL_GPX_FILE, req.session.email, store);
    res.json({ success: true, stats: result.stats, filename: store[planId].filename });
  } catch (err) { handleError(res, err); }
});

app.get('/api/goals/gpx/:planId', requireSession, (req, res) => {
  const store = readScoped(GOAL_GPX_FILE, req.session.email, {});
  const entry = store[req.params.planId];
  if (!entry) return res.status(404).json({ error: 'Aucun GPX importé pour cet objectif' });
  res.json(entry);
});

app.delete('/api/goals/gpx/:planId', requireSession, (req, res) => {
  const store = readScoped(GOAL_GPX_FILE, req.session.email, {});
  if (store[req.params.planId]) {
    delete store[req.params.planId];
    writeScoped(GOAL_GPX_FILE, req.session.email, store);
  }
  res.json({ success: true });
});

// ─── Éditeur Parcours (MVP : import + analyse, pas d'édition/persistance) ──
// Meme parsing/correction d'altitude que /api/goals/gpx ci-dessus, mais sans
// stockage disque : la "copie de travail" (PDF Éditeur Parcours, section 2)
// vit uniquement en mémoire navigateur pour cette première itération - un
// rechargement de page perd l'import, limitation assumee (pas de chantier de
// persistance tant que l'édition de tracé elle-même n'existe pas encore).
app.post('/api/route-editor/import', requireSession, upload.single('gpx'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    if (!/\.gpx$/i.test(req.file.originalname || '') && !/<gpx[\s>]/i.test(req.file.buffer.slice(0, 500).toString('utf8'))) {
      return res.status(400).json({ error: 'Le fichier doit être un GPX' });
    }
    const gpxText = req.file.buffer.toString('utf8');
    const result = analyzeGpx(gpxText);
    if (!result) return res.status(400).json({ error: 'GPX illisible ou sans trace exploitable (moins de 2 points).' });

    try {
      const correctedElevations = await getElevations(result.points);
      if (correctedElevations) {
        const correctedPoints = result.points.map((p, i) => ({
          ...p, ele: correctedElevations[i] != null ? correctedElevations[i] : p.ele,
        }));
        const correctedStats = computeElevationProfile(correctedPoints);
        if (correctedStats) {
          result.stats = { ...correctedStats, totalDistM: result.stats.totalDistM };
          result.points = correctedPoints;
        }
      }
    } catch (err) { /* correction IGN indisponible - on garde les altitudes brutes du GPX */ }

    res.json({ filename: req.file.originalname || 'parcours.gpx', points: result.points, stats: result.stats });
  } catch (err) { handleError(res, err); }
});

// Recalcule les stats (distance/D+/D-/côtes...) d'un tableau de points deja
// connu du navigateur - reutilise pour deux besoins : stats globales apres
// une repetition de section, et previsualisation d'une section A->B avant
// application. Meme source de verite que l'import (computeElevationProfile),
// jamais reimplementee cote client.
app.post('/api/route-editor/analyze', requireSession, (req, res) => {
  try {
    const { points } = req.body || {};
    if (!Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: 'Points de tracé manquants' });
    }
    const stats = computeElevationProfile(points);
    if (!stats) return res.status(400).json({ error: 'Analyse impossible (tracé trop court)' });
    res.json({ stats });
  } catch (err) { handleError(res, err); }
});

// ─── Export / import des records + courses (changement de PC, reinstall) ──
app.get('/api/records-export', requireSession, (req, res) => {
  const records_overrides = readScoped(RECORDS_OVERRIDES_FILE, req.session.email, {});
  const races = readScoped(RACES_FILE, req.session.email, []);
  const weight_history = readScoped(WEIGHT_HISTORY_FILE, req.session.email, []);
  res.setHeader('Content-Disposition', 'attachment; filename=allure-plus-records.json');
  res.json({ records_overrides, races, weight_history, exportedAt: new Date().toISOString() });
});

app.post('/api/records-import', requireSession, (req, res) => {
  try {
    const { records_overrides, races, weight_history } = req.body || {};
    if (typeof records_overrides !== 'object' || records_overrides === null || !Array.isArray(races)) {
      return res.status(400).json({ error: 'Structure invalide (records_overrides ou races manquant)' });
    }
    writeScoped(RECORDS_OVERRIDES_FILE, req.session.email, records_overrides);
    writeScoped(RACES_FILE, req.session.email, races);
    // Import en masse (restauration d'un ancien export) : chaque cle doit
    // etre resynchronisee, pas seulement les prochaines ecritures - sinon un
    // import restaure localement mais jamais pousse vers le cloud.
    Object.keys(records_overrides).forEach(k => scheduleSync('records_overrides', k, req.session.email));
    races.forEach(r => {
      scheduleSync('races', r.id, req.session.email);
      // L'export ne contient jamais le contenu binaire du certificat (JSON
      // uniquement) - si le fichier reference existe deja cote cloud (import
      // sur une machine qui l'a deja synchronise avant), le rapatrier ;
      // sinon syncNamedFile ne fait rien (ni push ni pull possible).
      if (r.certificateFile) syncBinaryFile(req.session.email, r.certificateFile).catch(() => {});
    });
    if (Array.isArray(weight_history)) {
      writeScoped(WEIGHT_HISTORY_FILE, req.session.email, weight_history);
      weight_history.forEach(e => scheduleSync('weight_history', e.date, req.session.email));
    }
    res.json({ success: true, racesCount: races.length });
  } catch (err) { handleError(res, err); }
});

// VO2Max
app.get('/api/vo2max', requireSession, async (req, res) => {
  try {
    const data = await req.session.fns.getVO2MaxData();
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Fitness : VO2max, VMA et zones personnelles calcul©es
app.get('/api/fitness', requireSession, async (req, res) => {
  try {
    const gc = req.session.gc;
    const settings = await gc.getUserSettings();
    const ud = settings?.userData || {};

    const vo2max = ud.vo2MaxRunning || null;

    // VMA (km/h) = (VO2max - 3.5) / 0.2 m/min f¢â, â," km/h
    // Formule classique physiologie du sport (L©ger)
    const vma = vo2max ? parseFloat(((vo2max - 3.5) / 0.2 * 60 / 1000).toFixed(2)) : null;

    // Seuil lactique Garmin (m/s f¢â, â," pace min/km)
    // Note: la valeur Garmin peut ªtre incorrecte si non calibr©e
    const ltSpeedMs = ud.lactateThresholdSpeed || null;
    const ltPaceSec = ltSpeedMs && ltSpeedMs > 1 ? Math.round(1000 / ltSpeedMs) : null;
    const ltHR      = ud.lactateThresholdHeartRate || null;

    // Zones d'allure personnelles (% de VMA vitesse f¢â, â," pace en sec/km)
    // R©f©rence : m©thode fran§aise, zones trail/running
    let zones = null;
    if (vma) {
      const pace = (pct) => Math.round(3600 / (vma * pct)); // sec/km
      zones = {
        Z1: { label: 'Zone 1 f¢â?s¬â, R©cup©ration',    pctMin: 0.55, pctMax: 0.65, paceMin: pace(0.65), paceMax: pace(0.55) },
        Z2: { label: 'Zone 2 f¢â?s¬â, Endurance F.',     pctMin: 0.65, pctMax: 0.75, paceMin: pace(0.75), paceMax: pace(0.65) },
        Z3: { label: 'Zone 3 f¢â?s¬â, Allure Marathon',  pctMin: 0.75, pctMax: 0.85, paceMin: pace(0.85), paceMax: pace(0.75) },
        Z4: { label: 'Zone 4 f¢â?s¬â, Seuil',            pctMin: 0.85, pctMax: 0.93, paceMin: pace(0.93), paceMax: pace(0.85) },
        Z5: { label: 'Zone 5 f¢â?s¬â, VMA',              pctMin: 0.93, pctMax: 1.05, paceMin: pace(1.05), paceMax: pace(0.93) },
        RECOVER: { label: 'R©cup©ration',          pctMin: 0.55, pctMax: 0.65, paceMin: pace(0.65), paceMax: pace(0.55) },
      };
    }

    if (ltPaceSec || ltHR) captureHealthSnapshot('lactateThreshold', todayParisISO(), { ltPaceSec, ltHR }, req.session.email);

    res.json({ vo2max, vma, ltPaceSec, ltHR, zones });
  } catch (err) { handleError(res, err); }
});


// FC repos
app.get('/api/heartrate', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await req.session.fns.getHeartRateData(days);
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Sommeil
app.get('/api/sleep', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 14;
    const data = await req.session.fns.getSleepData(days);
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Pas
app.get('/api/steps', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await req.session.fns.getStepsData(days);
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Body Battery — sans "days" : instantane du jour (comportement historique,
// utilise par le widget Synthese). Avec "days" : serie quotidienne.
app.get('/api/body-battery', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 1;
    const data = days > 1
      ? await req.session.fns.getBodyBatteryRange(days)
      : await req.session.fns.getBodyBatteryData();
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Preparation a l'entrainement — contrairement au statut d'entrainement,
// Garmin expose ici un vrai historique par plage de dates (verifie) : pas
// besoin d'instantane local.
app.get('/api/training-readiness', requireSession, async (req, res) => {
  try {
    const data = await req.session.fns.getTrainingReadinessData();
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

app.get('/api/training-readiness-history', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await req.session.fns.getTrainingReadinessHistory(days);
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Calories (resume quotidien Garmin)
app.get('/api/calories', requireSession, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await req.session.fns.getCaloriesRange(days);
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Statut d'entrainement — chaque consultation capture aussi un instantane
// du jour (pas d'historique natif expose par Garmin pour cette metrique).
app.get('/api/training-status', requireSession, async (req, res) => {
  try {
    const data = await req.session.fns.getTrainingStatusData();
    if (data) {
      captureHealthSnapshot('trainingStatus', todayParisISO(), { trainingStatus: data.trainingStatus, phrase: data.phrase }, req.session.email);
      if (data.load) captureHealthSnapshot('trainingLoad', todayParisISO(), data.load, req.session.email);
    }
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Profil Garmin
app.get('/api/profile', requireSession, async (req, res) => {
  try {
    const profile = await req.session.fns.getUserProfile();
    res.json({ profile });
  } catch (err) { handleError(res, err); }
});

// GPS trac©
app.get('/api/activity/:id/gps', requireSession, async (req, res) => {
  try {
    const gc = req.session.gc;
    const activityId = req.params.id;
    const baseUrl = gc.url.ACTIVITY;
    const url = `${baseUrl}${activityId}/details?maxChartSize=1000&maxPolylineSize=3000`;
    const detail = await gc.get(url);
    if (typeof detail === 'string' || !detail?.geoPolylineDTO) {
      return res.json({ points: [], total: 0 });
    }
    const poly = detail.geoPolylineDTO.polyline || [];
    if (poly.length === 0) return res.json({ points: [], total: 0 });
    const MAX_PTS = 600;
    const step = Math.max(1, Math.floor(poly.length / MAX_PTS));
    const points = poly
      .filter((_, i) => i % step === 0)
      .map(p => ({ lat: p.lat, lon: p.lon, alt: p.altitude }));

    // Profil d'elevation : l'altitude du polyline (geoPolylineDTO) est souvent null.
    // Garmin fournit une serie temporelle separee (activityDetailMetrics) avec
    // elevation + distance cumulee deja calculees - plus fiable pour le profil.
    // hr (directHeartRate), gapMps (directGradeAdjustedSpeed, m/s) et sec
    // (sumDuration, cumule) : colonnes soeurs de l'elevation dans la meme
    // serie temporelle Garmin, utilisees par l'analyse pente/effort en cote
    // (session-analysis.js, isTrail) pour calculer une pente et une FC par
    // tronçon de ~50m plutot que par lap Garmin (1km ou plus) - un lap entier
    // dilue une cote courte et repetee (ex: 320m/45m D+) en une pente nette
    // quasi nulle si le reste du lap redescend ou est plat.
    let elevation = [];
    if (Array.isArray(detail.metricDescriptors) && Array.isArray(detail.activityDetailMetrics)) {
      const keys = detail.metricDescriptors.map(m => m.key);
      const idxElev = keys.indexOf('directElevation');
      const idxDist = keys.indexOf('sumDistance');
      const idxHR   = keys.indexOf('directHeartRate');
      const idxGap  = keys.indexOf('directGradeAdjustedSpeed');
      const idxSec  = keys.indexOf('sumDuration');
      if (idxElev !== -1 && idxDist !== -1) {
        const rows = detail.activityDetailMetrics;
        const elevStep = Math.max(1, Math.floor(rows.length / MAX_PTS));
        elevation = rows
          .filter((_, i) => i % elevStep === 0)
          .map(r => ({
            distKm: (r.metrics[idxDist] || 0) / 1000,
            alt: r.metrics[idxElev],
            hr: idxHR !== -1 ? r.metrics[idxHR] : null,
            gapMps: idxGap !== -1 ? r.metrics[idxGap] : null,
            sec: idxSec !== -1 ? r.metrics[idxSec] : null,
          }))
          .filter(p => p.alt != null);
      }
    }

    res.json({ points, total: poly.length, elevation });
  } catch (err) {
    console.error('GPS error:', err.message);
    res.json({ points: [], error: err.message });
  }
});

// Laps / intervalles d'une activit©
app.get('/api/activity/:id/laps', requireSession, async (req, res) => {
  try {
    const gc = req.session.gc;
    const activityId = req.params.id;
    const baseUrl = gc.url.ACTIVITY;

    // Garmin retourne 'lapDTOs' (pas 'lapDTOList') pour /laps et /splits
    let laps = [];
    for (const sub of ['laps', 'splits', 'details?maxChartSize=100&maxPolylineSize=100']) {
      try {
        const url = `${baseUrl}${activityId}/${sub}`;
        const d = await gc.get(url);
        let candidate = [];
        // Garmin /laps f¢â, â," { lapDTOs: [...] }
        if (d?.lapDTOs   && d.lapDTOs.length   > 0) candidate = d.lapDTOs;
        // Ancien champ alternatif
        else if (d?.lapDTOList && d.lapDTOList.length > 0) candidate = d.lapDTOList;
        // Reponse directement un tableau
        else if (Array.isArray(d) && d.length > 0) candidate = d;
        // Cle 'laps' dans l'objet
        else if (Array.isArray(d?.laps) && d.laps.length > 0) candidate = d.laps;

        if (candidate.length > 0) {
          console.log(`?.???"?.? [${sub}] found ${candidate.length} laps (key: ${d?.lapDTOs ? 'lapDTOs' : d?.lapDTOList ? 'lapDTOList' : 'array'})`);
          laps = candidate;
          break;
        }
      } catch(e) {
        console.log(`?.???"?.? [${sub}] error: ${e.message}`);
      }
    }

    console.log(`?.???"?.? Laps activity ${activityId}: ${laps.length} found`);
    res.json({ laps, total: laps.length });
  } catch(err) {
    console.error('Laps error:', err.message);
    res.json({ laps: [], error: err.message });
  }
});



// Force refresh cache
app.post('/api/refresh', requireSession, async (req, res) => {
  try {
    const fs = require('fs');
    const cacheFile = path.join(__dirname, 'cache.json');
    if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    // Vider aussi le cache de la session
    if (req.session.fns.clearCache) req.session.fns.clearCache();
    res.json({ success: true });
  } catch (err) { handleError(res, err); }
});

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Routes CAMPUS COACH (ind©pendant de Garmin)
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

const CAMPUS_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 };

// Connexion Campus Coach (pas de session Garmin requise)
app.post('/api/campus/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email et password requis' });
  try {
    const { token, refreshToken, raw } = await campusLogin(email, password);
    // Stocker dans le cookie campus_token
    res.cookie('campus_token', token, CAMPUS_COOKIE_OPTS);
    _envCampusTokenCache = token;
    saveCampusTokenToFile(token);
    res.cookie('campus_refresh', refreshToken || '', CAMPUS_COOKIE_OPTS);
    // Aussi dans la session Garmin si elle existe
    const s = getSession(req);
    if (s) { s.campusToken = token; s.campusUserId = raw?.userId; s.campusEmail = email; }
    console.log(`?.??o? Campus Coach connect' : ${email}`);
    res.json({ success: true, email });
  } catch(err) { handleError(res, err); }
});

// Statut connexion Campus
app.get('/api/campus/status', (req, res) => {
  const token = getCampusToken(req);
  const s = getSession(req);
  const campusEmail = s?.campusEmail || ENV_CAMPUS_EMAIL || null;
  res.json({
    connected:          !!token,
    campusEmail,
    hasEnvCredentials:  !!(ENV_CAMPUS_EMAIL && ENV_CAMPUS_PASSWORD),
    campusEnabled:      CAMPUS_ENABLED && campusVisibleForSession(s),
  });
});

// Plan actif (goal)
app.get('/api/campus/plan', requireCampusToken, async (req, res) => {
  try {
    const goal = await getActiveGoal(req.campusToken);
    res.json({ goal });
  } catch(err) { handleError(res, err); }
});

// S©ances de la semaine courante
app.get('/api/campus/week', requireCampusToken, async (req, res) => {
  try {
    const goalId = req.query.goalId;
    if (!goalId) return res.status(400).json({ error: 'goalId requis' });
    const data = await getCurrentWeekSessions(req.campusToken, goalId);
    res.json(data);
  } catch(err) { handleError(res, err); }
});

// Exporter une s©ance vers Garmin (sans branding Campus)
app.post('/api/campus/export', requireCampusToken, async (req, res) => {
  const { weekId, sessionNumber, sessionName, weekNum, sessionDisplay } = req.body;
  if (!weekId || sessionNumber === undefined || sessionNumber === null) {
    return res.status(400).json({ error: 'weekId et sessionNumber requis' });
  }
  try {
    // f'â,°tape 1 : Campus exporte vers Garmin f¢â, â," on r©cup¨re le workoutId
    const campusResult = await exportSessionToGarmin(req.campusToken, weekId, sessionNumber);
    if (!campusResult?.workoutId) {
      return res.json({ success: true, workout: campusResult, note: 'Export OK (sans modification)' });
    }

    // Essayer de retirer le branding Campus via notre session Garmin
    const garminSession = getSession(req);
    const gc = garminSession?.gc;
    if (!gc) {
      // Pas de session Garmin active f¢â?s¬â,  on retourne le r©sultat Campus tel quel
      return res.json({ success: true, workout: campusResult, note: 'Export OK (session Garmin inactive)' });
    }

    try {
      // f'â,°tape 2 : R©cup©rer la structure compl¨te du workout cr©© par Campus
      const detail = await gc.getWorkoutDetail({ workoutId: campusResult.workoutId });

      // f'â,°tape 3 : Construire un nom avec pr©fixe S01-01
      const baseName = (sessionName || detail.workoutName || '')
        .replace(/^campus\s*[-:f¢â?s¬â,"|]?\s*/i, '')
        .replace(/\s*[-:f¢â?s¬â,"|]?\s*campus$/i, '')
        .trim() || detail.workoutName;
      const wNum = String(weekNum || 1).padStart(2, '0');
      const sNum = String(sessionDisplay || 1).padStart(2, '0');
      const cleanName = `S${wNum}-${sNum} ${baseName}`;

      // Étape 4 : Allures cibles — priorité à la VMA Allure+ (sex-corrected) du frontend
      // Si absente, fallback sur VO2max Garmin avec ancienne formule
      const { allureplusVma: apVmaCampus, isTrail: isTrailCampus,
              trailCorrs: trailCorrsCampus, hasIntervals: hasIntervalsCampus } = req.body;

      // VMA : priorité à la valeur sex-corrected d'Allure+ (plus précise)
      // Fallback : VO2max Garmin avec ancienne formule (×0.300 au lieu de ×0.313)
      let vmaGarmin = apVmaCampus || null;
      if (!vmaGarmin) {
        try {
          const settings = await gc.getUserSettings();
          const vo2max = settings?.userData?.vo2MaxRunning;
          vmaGarmin = vo2max ? (vo2max - 3.5) / 0.2 * 60 / 1000 : null;
          if (vmaGarmin) console.log('[FALLBACK] VMA Garmin brut: ' + vmaGarmin.toFixed(2) + ' km/h');
        } catch (e) { /* silencieux */ }
      } else {
        console.log('[Allure+] VMA sex-corrected: ' + vmaGarmin + ' km/h isTrail=' + isTrailCampus);
      }

      // Calcule min/max vitesse (m/s) depuis une clé de zone, la VMA, et la correction trail
      function zoneToSpeed(zoneKey) {
        const ref = getZoneRange(zoneKey);
        if (!ref || !vmaGarmin) return null;
        const pL = ref.pctLow, pH = ref.pctHigh;
        // Correction trail : EF warmup (séance avec intervalles) → Route
        // EF sortie longue 100% endurance → Trail
        const isEfWarmup = hasIntervalsCampus && (zoneKey === 'EF');
        const isRecover  = zoneKey === 'RECOVER';
        const corr = (isTrailCampus && !isEfWarmup && !isRecover && trailCorrsCampus?.[zoneKey])
          ? trailCorrsCampus[zoneKey] : 0;
        const vmaEff = vmaGarmin;  // VMA déjà sex-corrected si allureplusVma fourni
        return {
          min: parseFloat((vmaEff * pL / 3.6 / (1 + corr)).toFixed(6)),   // vitesse lente m/s (trail = plus lent en m/s)
          max: parseFloat((vmaEff * pH / 3.6 / (1 + corr)).toFixed(6)),   // vitesse rapide m/s
          paceMin: Math.round(3600 / (vmaEff * pH) * (1 + corr)),          // allure rapide sec/km (trail = plus grand)
          paceMax: Math.round(3600 / (vmaEff * pL) * (1 + corr)),          // allure lente sec/km
        };
      }

      // Detecte la zone Allure+ depuis la description du step (identique a resolveAllurePlusZone)
      function stepDescToAlluref(desc) {
        if (!desc) return null;
        const d = desc.toLowerCase();
        // Recuperation
        if (/recup|recover|repos|rest|retour.au.calme|cooldown/i.test(d)) return 'RECOVER';
        // VMA / intervalles
        if (/vma|vo2|interval/i.test(d)) return 'VMA';
        // Sweet Spot
        if (/sweet.spot/i.test(d)) return 'SWEET_SPOT';
        // S30 / Seuil 30
        if (/(s30|seuil[\s_-]?30|seuil 30)/i.test(d)) return 'S30';
        // S60 / Seuil 60
        if (/(s60|seuil[\s_-]?60|seuil 60)/i.test(d)) return 'S60';
        // Autres seuils sans numero -> S60 par defaut
        if (/seuil|threshold/i.test(d)) return 'S60';
        // Tempo
        if (/tempo/i.test(d)) return 'TEMPO';
        // EF / Endurance / Echauffement
        if (/endurance|fond|\bef\b|marathon|semi|echauffement|warmup|warm-up/i.test(d)) return 'EF';
        return null;
      }

      // Helper formatage allure
      const fmtPace = s => { const m = Math.floor(s / 60); const sec = s % 60; return m + "'" + String(sec).padStart(2, '0') + '"'; };

      // Annote UN step avec nos allures calculees depuis la VMA Garmin
      // REGLE : on utilise TOUJOURS notre tableau de reference -> coherence totale avec Allure+
      function annotateStep(step) {
        // Groupe de repetitions : descendre recursivement
        if (step.type === 'RepeatGroupStepDTO' || (step.workoutSteps && Array.isArray(step.workoutSteps))) {
          return { ...step, workoutSteps: (step.workoutSteps || []).map(annotateStep) };
        }

        // Detecter la zone Allure+ depuis la description du step
        const apKey = stepDescToAlluref(step.description);
        if (!apKey || !vmaGarmin) return step;
        const spd = zoneToSpeed(apKey);
        if (!spd) return step;

        const paceHint = ` | ${fmtPace(spd.paceMin)} -> ${fmtPace(spd.paceMax)}/km`;
        const isRecovery = apKey === 'RECOVER';

        return {
          ...step,
          description: (step.description || '') + paceHint,
          stepType: isRecovery
            ? { stepTypeId: 4, stepTypeKey: 'recovery' }
            : (step.stepType || { stepTypeId: 3, stepTypeKey: 'interval' }),
          targetType:     { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' },
          targetValueOne: spd.min,  // vitesse lente m/s (borne basse)
          targetValueTwo: spd.max,  // vitesse rapide m/s (borne haute)
        };
      }

      // Appliquer r©cursivement sur tous les segments
      const workoutSegments = (detail.workoutSegments || []).map(seg => ({
        ...seg,
        workoutSteps: (seg.workoutSteps || []).map(annotateStep),
      }));

      const cleanWorkout = {
        workoutName: cleanName,
        description: detail.description || '',
        sportType: detail.sportType,
        subSportType: detail.subSportType || null,
        estimatedDurationInSecs: detail.estimatedDurationInSecs,
        estimatedDistanceInMeters: detail.estimatedDistanceInMeters || null,
        workoutSegments,
      };

      // Étape 5 : Supprimer le workout Campus original
      await gc.deleteWorkout({ workoutId: campusResult.workoutId });
      console.log(`[OK] Workout Campus supprimé (id:${campusResult.workoutId})`);

      // Étape 6 : Recréer via notre session plus de logo Campus
      const newWorkout = await gc.addWorkout(cleanWorkout);
      console.log(`?.??o? Workout recréé : "${cleanName}" (id:${newWorkout?.workoutId || '?'})`);

      return res.json({
        success: true,
        workout: { ...newWorkout, workoutName: cleanName },
        note: 'Export sans logo Campus',
      });

    } catch (garminErr) {
      // Si l'op©ration ©choue (ex: workout d©j  supprim©, session expir©e)
      // on retourne quand mªme un succ¨s avec le r©sultat Campus
      console.warn('[Garmin] Impossible de nettoyer le branding:', garminErr.message);
      return res.json({
        success: true,
        workout: campusResult,
        note: 'Export OK (nettoyage branding ©chou©: ' + garminErr.message.slice(0, 60) + ')',
      });
    }

  } catch(err) { handleError(res, err); }
});


// f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,
// BUILDER GARMIN DIRECT (depuis donn©es plan, sans Campus)
// f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,f¢â,¢,

const ZONE_FR = {
  Z1: 'Zone 1 - Recuperation', Z2: 'Zone 2 - Endurance fondamentale',
  Z3: 'Zone 3 - Allure Marathon', Z4: 'Zone 4 - Seuil',
  Z5: 'Zone 5 - VMA', RECOVER: 'Recuperation', RECOVERY: 'Recuperation',
  WARMUP: 'Echauffement', COOLDOWN: 'Retour au calme',
  GPP: 'PPG', INTERVAL: 'Intervalle', REST: 'Repos',
};

function _fmtPace(s) {
  if (!s) return '?';
  const m = Math.floor(s / 60), sec = s % 60;
  return m + "'" + String(sec).padStart(2, '0') + '"';
}

// Trouve la zone correspondant   une allure r©elle (en sec/km) par rapport   la VMA
// Utilis© pour distinguer Seuil 30 (Z4) de Seuil 60 (Z3) via les pace.value de Campus
function matchZoneFromPace(paceSecKm, vma) {
  if (!paceSecKm || !vma) return null;
  const speedKmh = 3600 / paceSecKm;
  const pct = speedKmh / vma;
  if (pct < 0.60) return 'RECOVER';
  if (pct < 0.65) return 'Z1';
  if (pct < 0.75) return 'Z2';
  if (pct < 0.85) return 'Z3';   // 75-85% VMA f¢â, â," Seuil 60, tempo
  if (pct < 0.95) return 'Z4';   // 85-95% VMA f¢â, â," Seuil 30, seuil lactique
  return 'Z5';                    // > 95% VMA f¢â, â," VMA, intervalles courts
}

function buildGarminWorkoutFromSession(session, weekNum, sessionDisplay, userZones, preferAllureplusZones = false) {
  // Nom du workout en ASCII propre
  const toAscii = s => (s||'').replace(/[^\x00-\x7F]/g, c => {
    const m = {'é':'e','è':'e','ê':'e','à':'a','â':'a','ù':'u','ô':'o','î':'i','ç':'c','É':'E','→':'->','\u00e9':'e'};
    return m[c] || '';
  });
  const baseName = toAscii(session.displayName || session.name || 'Seance')
    .replace(/^campus\s*[-:|]?\s*/i, '').trim();
  const wNum = String(weekNum || 1).padStart(2, '0');
  const sNum = String(sessionDisplay || 1).padStart(2, '0');
  const workoutName = `S${wNum}-${sNum} ${baseName}`;

  const paceZones = session.paceZones || [];
  const totalDuration = paceZones.reduce((s, z) => s + (z.duration || 0), 0)
    || session.stats?.expectedDuration || 1800;

  // Cible "no target" Garmin (obligatoire - ne jamais envoyer null)
  const NO_TARGET = { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target' };
  const ZONE_NAMES = { Z1:'Endurance confort',Z2:'Endurance Fondamentale',Z3:'Allure Marathon',Z4:'Seuil',Z5:'VMA',RECOVER:'Recuperation',RECOVERY:'Recuperation',WARMUP:'Echauffement',COOLDOWN:'Retour au calme' };

  // Construire un step Garmin depuis une zone paceZone (index relatif pour stepOrder)
  const mkStep = (zone, index) => {
    // Priorite 1: kind semantique (ne jamais le remplacer par une detection d'allure)
    const zKey = (zone.kind || '').toUpperCase();
    // La vraie zone de ce pas est déjà résolue depuis pace.slug (fiable, voir zones.js
    // resolveZoneFromExercise/annotatePaceZones) — plus de devinette texte ici.
    const refinedKey = zone.resolvedZone || zKey;
    const zoneName = ZONE_LABELS[refinedKey] || ZONE_NAMES[zKey] || zKey || 'Exercice';

    // Priorite des allures:
    // 1) zone.pace.value (allure calibree par Campus pour cet utilisateur) -> +-5%
    // 2) userZones (calcule depuis VO2max Garmin) -> si pas de pace Campus
    let targetType = NO_TARGET, targetValueOne = null, targetValueTwo = null;
    let description = toAscii(zoneName);

    const apUserZone = userZones && userZones[refinedKey] ? userZones[refinedKey] : null;
    // RECOVER/RECOVERY = allure libre (jamais de cible Garmin)
    // Le code brut (zKey) sert au type d'étape Garmin plus bas, pas à la cible :
    // un pas tagué RECOVER par Campus peut avoir un slug "ef" (ex: retour au calme
    // à allure EF) et doit alors recevoir une vraie cible, comme dans l'affichage.
    const isRecoverKind = refinedKey === 'RECOVER';
    if (isRecoverKind) {
      // Pas de cible : Garmin laisse le coureur récupérer à son rythme
    } else if (preferAllureplusZones && apUserZone) {
      // Zones Allure+ avec correction trail éventuelle (toujours prioritaires)
      const fmtP = s => { const m = Math.floor(s/60); const sec = s%60; return m+"'"+String(sec).padStart(2,'0')+'"'; };
      description += ` | ${fmtP(apUserZone.min)} -> ${fmtP(apUserZone.max)}/km`;
      targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
      targetValueOne = parseFloat((1000 / apUserZone.max).toFixed(6));  // vitesse lente m/s
      targetValueTwo = parseFloat((1000 / apUserZone.min).toFixed(6));  // vitesse rapide m/s
    } else if (zone.pace && zone.pace.value && zone.pace.value > 0) {
      // Fallback Campus : allure brute +-5%
      const pace = zone.pace.value;
      const slow = Math.round(pace * 1.05);
      const fast = Math.round(pace * 0.95);
      const fmtP = s => { const m = Math.floor(s/60); const sec = s%60; return m+"'"+String(sec).padStart(2,'0')+'"'; };
      description += ` | ${fmtP(fast)} -> ${fmtP(slow)}/km`;
      targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
      targetValueOne = parseFloat((1000 / slow).toFixed(6));
      targetValueTwo = parseFloat((1000 / fast).toFixed(6));
    } else if (userZones && userZones[zKey]) {
      // Fallback: zones depuis VO2max Garmin
      const z = userZones[zKey];
      const fmtP = s => { const m = Math.floor(s/60); const sec = s%60; return m+"'"+String(sec).padStart(2,'0')+'"'; };
      description += ` | ${fmtP(z.min)} -> ${fmtP(z.max)}/km`;
      targetType = { workoutTargetTypeId: 6, workoutTargetTypeKey: 'pace.zone' };
      targetValueOne = parseFloat((1000 / z.max).toFixed(6));
      targetValueTwo = parseFloat((1000 / z.min).toFixed(6));
    }


    // Type d'etape Garmin
    let stepTypeId, stepTypeKey;
    if (zKey === 'WARMUP')                                        { stepTypeId = 1; stepTypeKey = 'warmup'; }
    else if (zKey === 'COOLDOWN')                                 { stepTypeId = 2; stepTypeKey = 'cooldown'; }
    else if (['RECOVER','RECOVERY','REST'].includes(zKey))        { stepTypeId = 4; stepTypeKey = 'recovery'; }
    else                                                          { stepTypeId = 3; stepTypeKey = 'interval'; }

    const duration = Math.max(zone.duration || 60, 10);
    return {
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder: index + 1,
      childStepId: null,
      description,
      stepType: { stepTypeId, stepTypeKey },
      endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
      endConditionValue: duration,
      endConditionCompare: null,
      endConditionZone: null,
      preferredEndConditionUnit: null,
      targetType,
      targetValueOne,
      targetValueTwo,
      zoneNumber: null,
    };
  };

  // Detecter warmup/cooldown et groupes de repetitions
  function buildStructuredSteps(zones) {
    if (zones.length === 0) return [mkStep({ kind: '', duration: totalDuration }, 0)];

    const steps = zones.map(mkStep);
    let wStart = 0, cEnd = zones.length;

    // Warmup: 1ere zone Z1/Z2 si duree >= 3min ET il y a d'autres zones apres
    const firstKind = (zones[0].kind || '').toUpperCase();
    if (['Z1','Z2','WARMUP'].includes(firstKind) && (zones[0].duration || 0) >= 180 && zones.length > 1) {
      steps[0] = { ...steps[0], stepType: { stepTypeId: 1, stepTypeKey: 'warmup' } };
      wStart = 1;
    }

    // Cooldown: derniere zone Z1/Z2/RECOVER si duree >= 2min ET il y a des zones avant
    const lastKind = (zones[zones.length-1].kind || '').toUpperCase();
    if (['Z1','Z2','COOLDOWN','RECOVER','RECOVERY'].includes(lastKind) && (zones[zones.length-1].duration || 0) >= 120 && zones.length > wStart + 1) {
      const lastIdx = zones.length - 1;
      steps[lastIdx] = { ...steps[lastIdx], stepType: { stepTypeId: 2, stepTypeKey: 'cooldown' } };
      cEnd = lastIdx;
    }

    // Recherche de repetitions dans la partie centrale
    const midZones = zones.slice(wStart, cEnd);
    const midSteps = steps.slice(wStart, cEnd);
    let midResult = midSteps;

    if (midZones.length >= 4) {
      // Essayer des patterns de longueur 2 ou 3
      for (let patLen = 2; patLen <= Math.min(4, Math.floor(midZones.length / 2)); patLen++) {
        const pattern = midZones.slice(0, patLen);
        let reps = 1, j = patLen;
        while (j + patLen <= midZones.length) {
          const chunk = midZones.slice(j, j + patLen);
          const match = chunk.every((z, k) => {
            const pk = (pattern[k].kind || '').toUpperCase();
            const ck = (z.kind || '').toUpperCase();
            return pk === ck && Math.abs((z.duration || 0) - (pattern[k].duration || 0)) <= 15;
          });
          if (match) { reps++; j += patLen; }
          else break;
        }
        if (reps >= 2 && j === midZones.length) {
          // Pattern trouve! Creer un RepeatGroupDTO
          const repeatSteps = midSteps.slice(0, patLen).map((s, idx) => ({ ...s, stepOrder: idx + 1 }));
          const repeatGroup = {
            type: 'RepeatGroupDTO',
            stepId: null,
            stepOrder: -1, // fixe ci-dessous
            childStepId: 1,
            stepType: { stepTypeId: 6, stepTypeKey: 'repeat' },
            smartRepeat: false,
            numberOfIterations: reps,
            workoutSteps: repeatSteps,
          };
          midResult = [repeatGroup];
          break;
        }
      }
    }

    // Assembler le resultat final avec stepOrder sequentiel
    const result = [
      ...steps.slice(0, wStart),
      ...midResult,
      ...steps.slice(cEnd),
    ];
    return result.map((s, idx) => ({ ...s, stepOrder: idx + 1 }));
  }

  const workoutSteps = buildStructuredSteps(paceZones);
  const sportType = { sportTypeId: 1, sportTypeKey: 'running' };

  return {
    workoutName,
    description: undefined,
    sportType,
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps }],
  };
}



// Cr©er un workout Garmin directement depuis les donn©es de s©ance
// (utilis© pour les plans import©s f¢â?s¬â, ne n©cessite PAS de compte Campus)
app.post('/api/garmin/workout-from-session', requireSession, async (req, res) => {
  const { session, weekNum, sessionDisplay } = req.body;
  if (!session) return res.status(400).json({ error: 'Donn©es de s©ance requises' });

  try {
    const gc = req.session.gc;
    const { allureplusVma, isTrail, trailCorrs, hasIntervals, goalType } = req.body;

    // Résout la vraie zone de chaque pas depuis pace.slug (fiable), utilisée
    // ensuite par buildGarminWorkoutFromSession au lieu de deviner depuis le texte.
    session.paceZones = annotatePaceZones(session, goalType || '');

    // Zones Allure+ depuis VMA sex-corrected envoyee par le frontend (priorite)
    // ou fallback sur VO2max Garmin brut
    let userZones = null;

    if (allureplusVma && allureplusVma > 0) {
      const ZG = { Z1:'RECOVER', Z2:'EF', Z3:'TEMPO', Z4:'S60', Z5:'VMA', WARMUP:'EF', COOLDOWN:'EF', RECOVERY:'RECOVER' };
      // Détecter si la séance a des intervalles (S60/VMA etc) ou est 100% endurance
      const sessionZoneKeys = (session.paceZones || []).map(pz => {
        const pzKey = (pz.kind || '').toUpperCase();
        return ZG[pzKey] || pzKey;
      });
      const hasIntervalsServer = sessionZoneKeys.some(k => !['EF','RECOVER','RECOVERY','WARMUP','COOLDOWN'].includes(k));
      const calcZone = (zKey) => {
        const apKey    = ZG[zKey] || zKey;
        const z        = getZoneRange(apKey);
        if (!z) return null;
        // EF en warmup (session avec intervalles) → Route ; EF sortie longue → Trail
        // On utilise hasIntervals du frontend (déjà calculé correctement)
        const hasIntervalsEff = hasIntervals ?? hasIntervalsServer;
        const isEfWarmup = hasIntervalsEff && (apKey === 'EF' || apKey === 'WARMUP');
        const isEfLike   = apKey === 'RECOVER' || apKey === 'RECOVERY';  // RECOVER → jamais de cible
        const corr       = (isTrail && !isEfWarmup && !isEfLike && trailCorrs?.[apKey]) ? trailCorrs[apKey] : 0;
        return {
          min: Math.round(3600 / (allureplusVma * z.pctHigh) * (1 + corr)), // allure rapide sec/km
          max: Math.round(3600 / (allureplusVma * z.pctLow) * (1 + corr)), // allure lente sec/km
        };
      };
      userZones = {};
      ['Z1','Z2','Z3','Z4','Z5','RECOVER','RECOVERY','WARMUP','COOLDOWN',
       'EF','TEMPO','SWEET_SPOT','AS42','AS21','S60','S30','AS10','VMA'].forEach(k => {
        const z = calcZone(k); if (z) userZones[k] = z;
      });
      console.log('[Allure+] VMA=' + allureplusVma + ' isTrail=' + isTrail + ' zones calculees');
    } else {
      try {
        const settings = await gc.getUserSettings();
        const vo2max = settings?.userData?.vo2MaxRunning;
        const vma = vo2max ? (vo2max - 3.5) / 0.2 * 60 / 1000 : null;
        if (vma) {
          const pace = (pct) => Math.round(3600 / (vma * pct));
          userZones = {
            Z1:       { min: pace(0.65), max: pace(0.55) },
            Z2:       { min: pace(0.75), max: pace(0.65) },
            Z3:       { min: pace(0.85), max: pace(0.75) },
            Z4:       { min: pace(0.93), max: pace(0.85) },
            Z5:       { min: pace(1.05), max: pace(0.93) },
            RECOVER:  { min: pace(0.65), max: pace(0.55) },
            RECOVERY: { min: pace(0.65), max: pace(0.55) },
          };
        }
      } catch(e) { /* silencieux */ }
    }

    const workout = buildGarminWorkoutFromSession(session, weekNum, sessionDisplay, userZones, !!allureplusVma);

    // Note Garmin : contexte Allure+ (D+, mode trail/route, VMA)
    const toAsciiNote = str => (str || '').replace(/[^\x00-\x7F]/g, c => {
      const m = {'\u00e9':'e','\u00e8':'e','\u00ea':'e','\u00e0':'a','\u00e2':'a',
                 '\u00f9':'u','\u00f4':'o','\u00ee':'i','\u00e7':'c'};
      return m[c] || '';
    });
    const noteParts = [];
    noteParts.push(isTrail ? 'Mode: Trail / Cote (+7%)' : 'Mode: Route');
    // D+ : champs Campus = expectedElevationGain (min) + maxExpectedElevationGain (max)
    const elevMin = session.stats?.expectedElevationGain || session.stats?.dPlus
      || session.stats?.elevationGain || session.dPlus || 0;
    const elevMax = session.stats?.maxExpectedElevationGain || 0;
    if (elevMin > 0) {
      const dPlusStr = (elevMax > 0 && elevMax !== elevMin)
        ? elevMin + '-' + elevMax + ' m D+'
        : elevMin + ' m D+';
      noteParts.push(dPlusStr);
    }
    if (allureplusVma) noteParts.push('VMA Allure+: ' + allureplusVma + ' km/h');
    const origName = toAsciiNote(session.displayName || session.name || '');
    if (origName) noteParts.push('Seance: ' + origName);
    if (noteParts.length > 0) workout.description = noteParts.join(' | ');

    const result = await gc.addWorkout(workout);
    console.log('[OK] Workout cree dans Garmin : "' + workout.workoutName + '" (id:' + (result?.workoutId || '?') + ')');

    res.json({
      success: true,
      workout: { ...(result || {}), workoutName: workout.workoutName },
    });
  } catch(err) { handleError(res, err); }
});


// D©connexion Campus

app.post('/api/campus/logout', (req, res) => {
  res.clearCookie('campus_token');
  res.clearCookie('campus_refresh');
  const s = getSession(req);
  if (s) { s.campusToken = null; s.campusEmail = null; }
  _envCampusTokenCache = null; // Effacer aussi le cache global (sinon auto-login masque la deconnexion)
  saveCampusTokenToFile('');   // Effacer le fichier token
  res.json({ success: true });
});

// Plan d'entra®nement complet avec s©ances
// Le plan d'entrainement necessite toujours une session Garmin active
app.get('/api/campus/training', (req, res, next) => {
  // Verifier qu'une session Garmin existe
  const s = getSession(req);
  if (!s || !s.gc) return res.status(401).json({ error: 'Session Garmin requise' });
  next();
}, async (req, res) => {
  const fs = require('fs');
  const token = getCampusToken(req);

  // Mode plan import© (sans token)
  const importedFile = path.join(__dirname, 'imported_plan.json');
  if (!token && fs.existsSync(importedFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(importedFile, 'utf8'));
      return res.json(data);
    } catch(e) {
      return res.status(500).json({ error: 'Plan import© corrompu' });
    }
  }

  if (!token) {
    // Pas de token ET pas de plan importé → réponse explicite "aucun plan"
    // (différent d'une erreur d'auth, ne pas traiter comme 401)
    return res.status(404).json({ error: 'Aucun plan importe', noPlan: true });
  }

  try {
    let goal = await getActiveGoal(token);
    // Si goal vide → token probablement expiré → refresh et retry une fois.
    // Jamais pour un "background goal" deja trouve (isBackgroundGoal) : ce
    // type n'a jamais de _id par construction (voir campus_client.js), le
    // refresh serait un aller-retour inutile a chaque appel.
    if (!goal?._id && !goal?.isBackgroundGoal) {
      console.log('[Campus] Pas de goal actif, tentative de refresh du token...');
      await tryAutoLoginCampus();
      if (_envCampusTokenCache && _envCampusTokenCache !== token) {
        console.log('[Campus] Retry avec nouveau token après refresh');
        goal = await getActiveGoal(_envCampusTokenCache);
      }
    }
    if (!goal?._id && !goal?.isBackgroundGoal) {
      return res.status(404).json({ error: 'Aucun plan actif trouvé sur Campus Coach', authError: false });
    }
    // Background goal : les semaines sont deja attachees par getActiveGoal
    // (recuperees via la plage de dates, aucun _id disponible pour ce type
    // de plan - voir campus_client.js). Plan "classique" sinon, identifie
    // par _id.
    const weeks = goal.isBackgroundGoal
      ? goal.weeks
      : await getFullTrainingPlan(_envCampusTokenCache || token, goal._id);
    res.json({ goal, weeks: Array.isArray(weeks) ? weeks : [] });
  } catch(err) {
    const msg = (err.message || '').toLowerCase();
    const isAuthErr = msg.includes('401') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('token');
    if (isAuthErr) {
      // Refresh en arrière-plan pour la prochaine requête
      tryAutoLoginCampus().catch(() => {});
      return res.status(401).json({ error: 'Session Campus expirée, reconnexion automatique...', authError: true, retrying: true });
    }
    handleError(res, err);
  }
});

// Allures d'entra®nement
app.get('/api/campus/paces', requireCampusToken, async (req, res) => {
  try {
    const paces = await getPaces(req.campusToken);
    res.json({ paces });
  } catch(err) { handleError(res, err); }
});

// Export du plan complet en fichier .aplus
app.get('/api/campus/export-plan', requireCampusToken, async (req, res) => {
  try {
    const goal = await getActiveGoal(req.campusToken);
    const goalId = goal._id;
    if (!goalId) throw new Error('goalId introuvable');
    const weeks = await getFullTrainingPlan(req.campusToken, goalId);
    const exportData = {
      exportedAt: new Date().toISOString(),
      goal,
      weeks: Array.isArray(weeks) ? weeks : [],
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=plan.aplus');
    res.json(exportData);
  } catch(err) { handleError(res, err); }
});

// Export du plan actif en fichier Excel (.xlsx) presentable a des amis qui
// n'utilisent pas Allure+ - reserve au compte admin. Recoit goal/weeks
// directement du frontend (campusState, deja charge a l'ecran) plutot que
// de les re-chercher cote serveur : le plan affiche dans Entrainements peut
// venir d'un choix cote navigateur (localStorage "prefer_imported_plan")
// que le serveur ne voit pas, donc re-deviner la source cote serveur peut
// exporter le mauvais plan (ou aucun) meme quand un plan est bien affiche.
app.post('/api/campus/export-plan-xlsx', requireAdmin, async (req, res) => {
  try {
    const { goal, weeks, raceDayDurationSec } = req.body || {};
    if (!goal || !Array.isArray(weeks) || weeks.length === 0) {
      return res.status(400).json({ error: 'Aucun plan charge a exporter' });
    }
    const workbook = await buildPlanWorkbook(goal, weeks, { raceDayDurationSec });
    const safeName = (goal?.name || goal?.goalTitle || 'plan').replace(/[^a-zA-Z0-9-_]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plan-${safeName}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch(err) { handleError(res, err); }
});

// Import d'un plan .aplus (sans Campus auth)
app.post('/api/campus/import-plan', async (req, res) => {
  const fs = require('fs');
  // Lire le body brut (le fichier est envoy© en JSON direct ou multipart)
  try {
    let data;
    if (req.body && req.body.plan) {
      data = req.body.plan;
    } else if (typeof req.body === 'object' && req.body.goal) {
      data = req.body;
    } else {
      return res.status(400).json({ error: 'Donnees de plan invalides' });
    }
    const importedFile = path.join(__dirname, 'imported_plan.json');
    fs.writeFileSync(importedFile, JSON.stringify(data, null, 2), 'utf8');
    console.log('[INFO] ?.??o? Plan import sauvegard :', importedFile);
    res.json({ success: true, weeks: Array.isArray(data.weeks) ? data.weeks.length : 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Supprimer le plan importé côté serveur (bouton "Annuler le plan")
app.delete('/api/campus/import-plan', (req, res) => {
  try {
    const importedFile = path.join(__dirname, 'imported_plan.json');
    if (fs.existsSync(importedFile)) {
      fs.unlinkSync(importedFile);
      console.log('[INFO] Plan importé supprimé par l\'utilisateur');
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Sauvegarder identifiants Campus dans .env
app.post('/api/campus/save-env', requireCampusToken, (req, res) => {
  const fs = require('fs');
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email et password requis' });
  try {
    let content = fs.existsSync(path.join(__dirname, '.env'))
      ? fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      : `GARMIN_EMAIL=${ENV_EMAIL||''}\nGARMIN_PASSWORD=${ENV_PASSWORD||''}\nPORT=3001\n`;
    content = content.replace(/^CAMPUS_EMAIL=.*$/m, '').replace(/^CAMPUS_PASSWORD=.*$/m, '').trim();
    content += `\nCAMPUS_EMAIL=${email}\nCAMPUS_PASSWORD=${password}\n`;
    fs.writeFileSync(path.join(__dirname, '.env'), content, 'utf8');
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Logs serveur (lit server.log si lanc© via start.bat)
app.get('/api/logs', (req, res) => {
  const fs = require('fs');
  const logFile = path.join(__dirname, 'server.log');
  if (!fs.existsSync(logFile)) {
    // Pas de fichier log = lanc© depuis terminal, logs dans la console
    return res.json({ lines: ['[INFO] Serveur lanc© depuis un terminal f¢â?s¬â, logs visibles dans la console.'], source: 'console' });
  }
  try {
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim()).slice(-100);
    res.json({ lines, source: 'file' });
  } catch(e) {
    res.json({ lines: ['[ERREUR] Impossible de lire server.log'], source: 'error' });
  }
});

// Sauvegarder identifiants dans .env (auto-login futur)
app.post('/api/save-env', requireSession, (req, res) => {
  const fs = require('fs');
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email et password requis' });
  const campusLine = ENV_CAMPUS_EMAIL ? `\nCAMPUS_EMAIL=${ENV_CAMPUS_EMAIL}\nCAMPUS_PASSWORD=${ENV_CAMPUS_PASSWORD}` : '';
  const content = `GARMIN_EMAIL=${email}\nGARMIN_PASSWORD=${password}\nPORT=3001${campusLine}\n`;
  try {
    fs.writeFileSync(path.join(__dirname, '.env'), content, 'utf8');
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Impossible d\'©crire le fichier .env' });
  }
});

// Supprimer le .env (oublier les identifiants)
app.post('/api/delete-env', requireSession, (req, res) => {
  const fs = require('fs');
  const envFile = path.join(__dirname, '.env');
  try {
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: 'Impossible de supprimer le fichier .env' });
  }
});

// Red©marrage
app.post('/api/restart', (req, res) => {
  res.json({ success: true });
  setTimeout(() => process.exit(0), 300);
});

// Quitter l'application : l'appli tourne en fenetre de navigateur "--app="
// independante du process node.exe (voir start.bat/open_browser.ps1) - fermer
// juste la fenetre (croix) laisse donc node.exe tourner en tache de fond.
// Ce endpoint arrete explicitement le serveur ; le bouton cote client ferme
// ensuite la fenetre (voir wireQuitButton, app.js).
app.post('/api/quit', (req, res) => {
  res.json({ success: true });
  setTimeout(() => process.exit(0), 300);
});

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// Pages HTML
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'login.html'));
});

app.get('/', (req, res) => {
  // Si pas de session f¢â, â," redirect login
  const s = getSession(req);
  if (!s && !envSessionId) {
    return res.redirect('/login');
  }
  // Si session .env mais pas de cookie f¢â, â," mettre le cookie auto
  if (!s && envSessionId && sessions.has(envSessionId)) {
    res.cookie('sid', envSessionId, { httpOnly: true, sameSite: 'lax' });
  }
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬
// D©marrage
// f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬f¢â,â?s¬

tryAutoLogin().then(() => {
  
// ══════════════════════════════════════════════════════════════════
// PLANS DISPONIBLES — Lecture des fichiers .aplus du dossier /plans
// ══════════════════════════════════════════════════════════════════
const PLANS_DIR = path.join(__dirname, 'plans');

// Lecture récursive de tous les fichiers .aplus dans PLANS_DIR et ses sous-dossiers
function getAllPlanFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getAllPlanFiles(fullPath));
    } else if (entry.name.endsWith('.aplus')) {
      result.push(fullPath);
    }
  });
  return result;
}

function parsePlanMeta(filePath) {
  const filename = path.basename(filePath);
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const goal = raw.goal || {};
  const weeks = raw.weeks || [];

  const base = filename.replace('.aplus', '');
  const parts = base.split('_');
  const sportCode = parts[0];
  const sport = sportCode === 'T' ? 'T' : 'R';
  const sportLabel = sport === 'T' ? 'Trail' : 'Route';

  // Durée et séances (pattern indépendant de la position)
  const dureeStr   = parts.find(p => /^\d+S$/.test(p));
  const seancesStr = parts.find(p => /^\d+J$/.test(p));
  const duree   = dureeStr   ? parseInt(dureeStr)   : (goal.durationInWeeks  || 0);
  const seances = seancesStr ? parseInt(seancesStr) : (goal.sessionsPerWeek  || 0);

  let distCat = '', distLabel = '', niveau = '';
  let dplusMin = null, dplusMax = null, dplusLabel = null, dplusTier = null;

  if (sport === 'R') {
    // Route: R_SEMI_12S_4J_ACTIF  ou  R_MARATHON_...
    const distRaw = (parts[1] || '').toUpperCase();
    if (distRaw === 'SEMI')          { distCat = 'semi';     distLabel = 'Semi-marathon'; }
    else if (distRaw === 'MARATHON') { distCat = 'marathon'; distLabel = 'Marathon'; }
    else if (distRaw === '10K')      { distCat = '10k';      distLabel = '10 km'; }
    else if (distRaw === '20K')      { distCat = '20k';      distLabel = '20 km'; }
    else if (distRaw === '5K')       { distCat = '5k';       distLabel = '5 km'; }
    else                             { distCat = distRaw.toLowerCase(); distLabel = distRaw; }
    niveau = parts[parts.length - 1];

  } else {
    // Trail — deux formats :
    // Nouveau : T_{distMin}_{distMax}_{durS}_{sessJ}_{dplusMin}_{dplusMax}_{niveau}
    // Ancien  : T_{km}k_{durS}_{sessJ}_{niveau}
    if (/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      // === Nouveau format ===
      const distMin = parseInt(parts[1]);
      const distMax = parseInt(parts[2]);
      if (distMax <= 21)         { distCat = 'court'; distLabel = 'Court (< 21 km)'; }
      else if (distMin < 42)     { distCat = 'moyen'; distLabel = 'Moyen (21–42 km)'; }
      else if (distMin < 80)     { distCat = 'long';  distLabel = 'Long (42–80 km)'; }
      else                       { distCat = 'ultra'; distLabel = 'Ultra (> 80 km)'; }

      // Après durS et sessJ, les deux suivants numériques = D+
      const afterDurSess = parts.filter((p, i) => i > 2 && !/^\d+[SJ]$/.test(p));
      if (afterDurSess.length >= 3 && /^\d+$/.test(afterDurSess[0]) && /^\d+$/.test(afterDurSess[1])) {
        dplusMin = parseInt(afterDurSess[0]);
        dplusMax = parseInt(afterDurSess[1]);
        niveau   = afterDurSess[2];
      } else {
        niveau = afterDurSess[afterDurSess.length - 1] || 'ACTIF';
      }

    } else {
      // === Ancien format (ex: T_35k_12S_4J_ACTIF) ===
      const km = parseInt(parts[1]) || 0;
      if (km <= 20)       { distCat = 'court'; distLabel = 'Court (< 21 km)'; }
      else if (km <= 42)  { distCat = 'moyen'; distLabel = 'Moyen (21–42 km)'; }
      else if (km <= 80)  { distCat = 'long';  distLabel = 'Long (42–80 km)'; }
      else                { distCat = 'ultra'; distLabel = 'Ultra (> 80 km)'; }
      niveau = parts[parts.length - 1];
    }

    // Label D+ : toujours la plage exacte du fichier (jamais de bucket générique
    // qui écraserait des plages distinctes comme 2000-3500 et 3500-5000), plus
    // le palier sémantique correspondant à la catégorie de distance.
    if (dplusMin !== null && dplusMax !== null) {
      dplusLabel = dplusMin + '_' + dplusMax;
      dplusTier  = findDplusTierLabel(distCat, dplusMin);
    }
  }

  const NIVEAU_DESCS = {
    ACTIF:   'Entraînement continu, sans interruption notable',
    PAUSE:   'Petite coupure récente entre 2 et 3 semaines',
    REPRISE: 'Arrêt de plus d\'1 mois, reprise progressive nécessaire',
  };
  const niveauDesc = NIVEAU_DESCS[niveau] || '';

  // Comptage des sessions par type
  const sessionCounts = { EF: 0, SL: 0, Intensity: 0, PPG: 0 };
  weeks.forEach(w => {
    (w.sessions || []).forEach(s => {
      const tt = (s.trainingType || '').toUpperCase();
      const cat = (s.trainingCategory || '').toLowerCase();
      if (['EF', 'EF_LD', 'ENDURANCE', 'ENDURANCE_FONDAMENTALE'].includes(tt))
        sessionCounts.EF++;
      else if (['SL', 'SORTIE_LONGUE', 'LONG_RUN'].includes(tt))
        sessionCounts.SL++;
      else if (tt === 'PPG' || tt === 'RENFORCEMENT' || cat === 'gpp')
        sessionCounts.PPG++;
      else if (['INTENSITY', 'S60', 'S30', 'S20', 'VMA', 'FRACTIONNE', 'TEMPO'].some(k => tt.includes(k)))
        sessionCounts.Intensity++;
      // Competition, Special: non comptés dans les types principaux
    });
  });

  // ═══ Durée totale depuis weekStats (fiable) + volume/D+ depuis stats des sessions ═══
  let totalDurSec = 0;
  let runDurSec   = 0;   // durée de course uniquement (excl. PPG)
  let totalDplusM = 0;   // D+ cumulé total du plan

  // Catégories non-courantes (PPG, renforcement)
  const NON_RUNNING_TYPES = ['PPG', 'RENFORCEMENT', 'STRENGTH', 'GYM', 'MUSCU'];

  const weeksSummary = weeks.map((w, i) => {
    const durSec = (w.weekStats && w.weekStats.expectedDuration) ? w.weekStats.expectedDuration : 0;
    totalDurSec += durSec;

    // Parcourir les sessions pour volume courant et D+
    (w.sessions || []).forEach(s => {
      const tt  = (s.trainingType || '').toUpperCase();
      const cat = (s.trainingCategory || '').toLowerCase();
      const isNonRunning = NON_RUNNING_TYPES.some(k => tt.includes(k)) || cat === 'gpp';
      const sts = s.stats || {};
      const sessDurSec = sts.expectedDuration || 0;
      const sessElevM  = sts.expectedElevationGain || 0;

      if (!isNonRunning && sessDurSec > 0) {
        runDurSec += sessDurSec;
      }
      if (sessElevM > 0) {
        totalDplusM += sessElevM;
      }
    });

    return {
      weekNum:  i + 1,
      theme:    (w.context && w.context.cycleTheme) || '',
      sessions: (w.sessions || []).length,
      durMin:   Math.round(durSec / 60),
    };
  });

  const totalDurMin = Math.round(totalDurSec / 60);

  // Volume estimé : durée de course × allure moyenne (trail 7 km/h, route 10 km/h)
  // (trail plus lent en moyenne, tient compte des montées)
  const avgPaceKmh  = sport === 'T' ? 7 : 10;
  const runDurMin   = Math.round(runDurSec / 60);
  // Si on a de la durée de course → estimer depuis sessions individuelles
  // Sinon → fallback sur la durée totale du plan
  const estKm = runDurMin > 0
    ? Math.round(runDurMin / 60 * avgPaceKmh)
    : Math.round(totalDurMin / 60 * avgPaceKmh);

  // D+ total estimé (arrondi à 100 m près)
  const estDplusM = totalDplusM > 0 ? Math.round(totalDplusM / 100) * 100 : null;

  // Cycles
  const cycles = (goal.cycles || []).map(c => ({
    theme:       c.cycleTheme       || '',
    description: c.cycleDescription || '',
    duration:    c.cycleDuration    || 0,
  }));

  const planId = base;
  return {
    _id: planId, planId, filename,
    sport, sportLabel, distCat, distLabel,
    duree, seances, niveau, niveauDesc,
    totalWeeks: weeks.length,
    sessions:   sessionCounts,
    totalDurMin, estKm, estDplusM, cycles, weeksSummary,
    dplusMin, dplusMax, dplusLabel, dplusTier,
    dplus: dplusMin, // compatibilité affichage
  };
}


// GET /api/plans — liste tous les plans disponibles avec leurs métadonnées
app.get('/api/plans', (req, res) => {
  try {
    if (!fs.existsSync(PLANS_DIR)) return res.json([]);
    const files = getAllPlanFiles(PLANS_DIR).sort();
    const plans = [];
    files.forEach(filePath => {
      try { plans.push(parsePlanMeta(filePath)); }
      catch(e) { console.warn('[Plans] Erreur lecture ' + filePath + ': ' + e.message); }
    });
    console.log('[Plans] ' + plans.length + ' plans chargés depuis ' + PLANS_DIR);
    res.json(plans);
  } catch(err) { handleError(res, err); }
});

// GET /api/plans/load/:id — charger les données complètes d'un plan
app.get('/api/plans/load/:id', (req, res) => {
  try {
    const filename = req.params.id + '.aplus';
    // Recherche récursive dans tous les sous-dossiers
    const allFiles = getAllPlanFiles(PLANS_DIR);
    const filePath = allFiles.find(f => path.basename(f) === filename);
    if (!filePath) return res.status(404).json({ error: 'Plan non trouvé: ' + filename });
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Récupérer les métadonnées du plan depuis le nom de fichier
    const meta = parsePlanMeta(filePath);

    // Nettoyer les données de course d'origine (Marathon Des Causses, etc.)
    // et les remplacer par les catégories du plan
    if (data.goal) {
      // Supprimer les données de course spécifiques (distance réelle, D+ réel)
      // pour ne garder que les catégories du plan (distLabel, dplusLabel)
      data.goal.specificData = {
        ...(data.goal.specificData || {}),
        distance:      null,
        elevationGain: null,
        trailTitle:    null,
      };
      // Ajouter les catégories du plan pour l'affichage
      data.goal.planCategory = {
        sportLabel: meta.sportLabel,
        distLabel:  meta.distLabel,
        dplusLabel: meta.dplusLabel,
        dplusTier:  meta.dplusTier,
        dplusMin:   meta.dplusMin,
        dplusMax:   meta.dplusMax,
      };
    }

    res.json(data);
  } catch(err) { handleError(res, err); }
});

// Tableau de suivi du catalogue de plans (Admin, compte auteur uniquement) -
// scanne les fichiers .aplus reels (getAllPlanFiles/parsePlanMeta, deja
// utilises par le catalogue public) et regroupe leur presence par case
// route (distance x niveau) / trail (distance x palier D+ TRAIL_DPLUS_TIERS
// x niveau) - la grille cible (quelles distances/paliers existent en
// theorie) est definie cote client (frontend/js/plans.js), ce endpoint se
// contente de rapporter ce qui existe reellement sur disque, jamais une
// liste figee qui deriverait des vrais fichiers.
app.get('/api/admin/plans-catalog', requireAdmin, (req, res) => {
  try {
    const files = getAllPlanFiles(PLANS_DIR);
    const slots = {};
    files.forEach(f => {
      try {
        const meta = parsePlanMeta(f);
        // Cle inclut les seances/semaine (meta.seances, ex: 2/3/4/5j) - une
        // meme distance/palier/niveau peut exister en plusieurs frequences,
        // suivies independamment (retour utilisateur).
        const key = meta.sport === 'R'
          ? `route|${meta.distCat}|${meta.niveau}|${meta.seances}`
          : `trail|${meta.distCat}|${meta.dplusTier || ''}|${meta.niveau}|${meta.seances}`;
        if (!slots[key]) slots[key] = { count: 0, files: [], durations: [] };
        slots[key].count++;
        slots[key].files.push(meta.filename);
        // Duree (semaines) : dimension supplementaire non affichee comme
        // colonne a part (le tableau serait demesure) - juste listee au
        // survol de la case (retour utilisateur), cf. plans.js.
        if (meta.duree && !slots[key].durations.includes(meta.duree)) slots[key].durations.push(meta.duree);
      } catch (e) { /* fichier .aplus illisible/corrompu -> ignore ce fichier */ }
    });
    Object.values(slots).forEach(s => s.durations.sort((a, b) => a - b));
    const flags = readJsonSafe(PLAN_PUBLISH_FLAGS_FILE, {});
    // Grille cible trail : memes categories/paliers que la reference D+ Admin
    // (TRAIL_DPLUS_TIERS), seule source de verite - jamais une copie cote
    // client qui pourrait deriver (meme motif que le bug de zones d'allure
    // deja constate, cf. CLAUDE.md).
    const TRAIL_DIST_LABELS = { court: '< 21 km', moyen: '21 – 42 km', long: '42 – 80 km', ultra: '> 80 km' };
    const trailCategories = Object.keys(TRAIL_DPLUS_TIERS).map(distCat => ({
      distCat, distLabel: TRAIL_DIST_LABELS[distCat] || distCat,
      tiers: TRAIL_DPLUS_TIERS[distCat].map(t => t.label),
    }));
    res.json({ slots, flags, trailCategories });
  } catch (err) { handleError(res, err); }
});

app.post('/api/admin/plans-catalog/flag', requireAdmin, (req, res) => {
  try {
    const { key, value } = req.body || {};
    if (!key) return res.status(400).json({ error: 'key requis' });
    const flags = readJsonSafe(PLAN_PUBLISH_FLAGS_FILE, {});
    flags[key] = !!value;
    writeJsonSafe(PLAN_PUBLISH_FLAGS_FILE, flags);
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
});

// Demarrage avec retry sur EADDRINUSE : incident reel constate (12/08) - un
// node.exe zombie (jamais tue proprement, ex: crash anterieur ou permissions)
// restait sur le port pendant que start.bat en relancait un second qui
// echouait a se lier ET plantait silencieusement (fenetre masquee par
// -WindowStyle Hidden, cf start_server.ps1) sans que l'utilisateur le voie -
// il continuait sans le savoir a utiliser l'ancien process avec son cache
// memoire perime (cache de mise a jour notamment). Quelques tentatives
// espacees laissent le temps a Windows de liberer le port si c'est juste
// une course avec le "timeout /t 2" de start.bat, et le message clair dans
// server_err.log rend le vrai blocage diagnosticable si ca persiste.
function startServer(retriesLeft = 5) {
  const httpServer = app.listen(PORT, async () => {
    console.log('\n[START] Allure+ Dashboard demarre !');
    console.log(`[INFO] Ouvrez votre navigateur sur : http://localhost:${PORT}\n`);
    // email de la session .env reellement etablie au demarrage, jamais
    // ENV_EMAIL seul : quand l'auto-login vient des tokens Garmin sauvegardes
    // (restoreGarminSession, pas de mot de passe requis - cas le plus courant
    // apres le premier login), ENV_EMAIL/ENV_PASSWORD peuvent etre absents du
    // .env alors qu'une session est bien active. Filet de securite - les
    // branches de tryAutoLogin() ont deja fait ce meme appel (idempotent via
    // _syncScheduledEmails) avant que ce callback ne s'execute, dans les cas
    // courants.
    const envEmail = sessions.get(envSessionId)?.email || ENV_EMAIL;
    if (envEmail) {
      console.log(`[OK] Auto-login actif pour : ${envEmail}`);
      await ensureSyncScheduled(envEmail);
    } else {
      console.log('[INFO] Aucun .env detecte - connexion requise via navigateur');
    }
  });
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
      console.error(`[WARN] Port ${PORT} deja utilise (probablement un ancien node.exe pas encore libere) - nouvelle tentative dans 2s (${retriesLeft} restantes)`);
      setTimeout(() => startServer(retriesLeft - 1), 2000);
    } else {
      console.error(`[ERREUR FATALE] Impossible de demarrer sur le port ${PORT} : ${err.message}`);
      console.error('[ERREUR FATALE] Verifiez qu\'aucun autre node.exe ne tourne deja (Gestionnaire des taches) et relancez.');
      process.exit(1);
    }
  });
}

startServer();
});
