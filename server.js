require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');

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
const {
  computeStats,
  getLastRunActivities,
  getPersonalRecords,
  buildGarminFunctions
} = require('./garmin_client');
const { getZoneRange, annotatePaceZones, ZONE_LABELS } = require('./zones');
const { buildPlanWorkbook } = require('./xlsx_export');
const {
  campusLogin,
  getActiveGoal,
  getGoal,
  getCurrentWeekSessions,
  exportSessionToGarmin,
  getFullTrainingPlan,
  getGoalSummary,
  getPaces,
} = require('./campus_client');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
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

function findAvatarFile() {
  try {
    return fs.readdirSync(UPLOADS_DIR).find(f => /^avatar\.[a-z0-9]+$/i.test(f)) || null;
  } catch (e) { return null; }
}

app.get('/api/avatar', requireSession, (req, res) => {
  const f = findAvatarFile();
  res.json({ url: f ? '/uploads/' + f : null });
});

app.post('/api/avatar', requireSession, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
    if (!/^\.(jpe?g|png|webp|gif)$/.test(ext)) return res.status(400).json({ error: "Format d'image non supporte" });
    const existing = findAvatarFile();
    if (existing) fs.unlinkSync(path.join(UPLOADS_DIR, existing));
    fs.writeFileSync(path.join(UPLOADS_DIR, 'avatar' + ext), req.file.buffer);
    res.json({ url: '/uploads/avatar' + ext });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/avatar', requireSession, (req, res) => {
  try {
    const f = findAvatarFile();
    if (f) fs.unlinkSync(path.join(UPLOADS_DIR, f));
    res.json({ ok: true });
  } catch (err) { handleError(res, err); }
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

function getSession(req) {
  const id = req.cookies?.sid;
  if (!id) return null;
  const s = sessions.get(id);
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

async function createGarminSession(email, password) {
  const gc = new GarminConnect({ username: email, password });
  await gc.login();
  // Sauvegarder les tokens OAuth sur disque pour eviter le login SSO aux prochains demarrages
  try { gc.exportTokenToFile(GARMIN_TOKEN_DIR); } catch(_) {}
  const fns = buildGarminFunctions(gc);

  let displayName = null;
  try {
    const profile = await gc.getUserProfile();
    displayName = computeDisplayName(profile);
  } catch(e) { /* silencieux */ }

  return { gc, email, displayName, fns, lastAccess: Date.now() };
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

// Dossier de persistance des tokens Garmin OAuth
const GARMIN_TOKEN_DIR = path.join(__dirname, '.garmin_tokens');
if (!fs.existsSync(GARMIN_TOKEN_DIR)) fs.mkdirSync(GARMIN_TOKEN_DIR, { recursive: true });

// Tenter de restaurer une session Garmin depuis les tokens sauvegardés sur disque
async function restoreGarminSession() {
  const oauth1Path = path.join(GARMIN_TOKEN_DIR, 'oauth1_token.json');
  const oauth2Path = path.join(GARMIN_TOKEN_DIR, 'oauth2_token.json');
  if (!fs.existsSync(oauth1Path) || !fs.existsSync(oauth2Path)) return null;
  try {
    const gc = new GarminConnect({ username: ENV_EMAIL, password: ENV_PASSWORD });
    gc.loadTokenByFile(GARMIN_TOKEN_DIR);
    // Valider que la session est encore active avec un appel leger
    // (reutilise aussi pour calculer le nom d'affichage, comme au login complet)
    const profile = await gc.getUserProfile();
    const displayName = computeDisplayName(profile);
    const fns = buildGarminFunctions(gc);
    console.log('[START] Session Garmin restauree depuis tokens sauvegardes (pas de login SSO)');
    return { gc, email: ENV_EMAIL, displayName, fns, lastAccess: Date.now() };
  } catch(e) {
    console.warn('[WARN] Tokens Garmin sauvegardes expires ou invalides, login SSO necessaire.');
    // Supprimer les tokens invalides
    try { fs.unlinkSync(path.join(GARMIN_TOKEN_DIR, 'oauth1_token.json')); } catch(_) {}
    try { fs.unlinkSync(path.join(GARMIN_TOKEN_DIR, 'oauth2_token.json')); } catch(_) {}
    return null;
  }
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
  });
});

// Admin info d©taill©
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
  });
});

// Setup (1er lancement / reconfiguration) - sans authentification requise
app.post('/api/setup', async (req, res) => {
  try {
    const {
      garminEmail, garminPassword, rememberGarmin,
      campusEnabled: campusEnabledReq, campusEmail, campusPassword, rememberCampus
    } = req.body;

    if (!garminEmail || !garminPassword) {
      return res.status(400).json({ error: 'E-mail et mot de passe Garmin requis.' });
    }

    // 1) Connexion Garmin
    console.log('Setup : connexion Garmin pour', garminEmail);
    const sessionData = await createGarminSession(garminEmail, garminPassword);
    const sid = uuidv4();
    sessions.set(sid, sessionData);
    res.cookie('sid', sid, { httpOnly: true, sameSite: 'lax' });

    // 2) Lire .env existant
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const setEnvVar = (content, key, value) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const line  = `${key}=${value}`;
      return regex.test(content) ? content.replace(regex, line) : content + (content.endsWith('\n') || !content ? '' : '\n') + line + '\n';
    };
    const delEnvVar = (content, key) => content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '');

    // 3) Sauvegarder credentials Garmin si demande
    if (rememberGarmin) {
      envContent = setEnvVar(envContent, 'GARMIN_EMAIL', garminEmail);
      envContent = setEnvVar(envContent, 'GARMIN_PASSWORD', garminPassword);
    }

    // 4) Preference Campus Coach
    CAMPUS_ENABLED = !!campusEnabledReq;
    envContent = setEnvVar(envContent, 'CAMPUS_ENABLED', CAMPUS_ENABLED ? 'true' : 'false');

    // 5) Campus Coach credentials si active
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

    // 6) Ecrire le .env mis a jour
    fs.writeFileSync(envPath, envContent.trimStart(), 'utf8');

    console.log('Setup : configuration sauvegardee. Campus enabled:', CAMPUS_ENABLED);
    res.json({ success: true, campusEnabled: CAMPUS_ENABLED });

  } catch(err) {
    console.error('Setup error:', err.message);
    const is429 = err.message.includes('429') || err.message.includes('427') || err.message.toLowerCase().includes('rate');
    const msg = is429
      ? 'Trop de tentatives de connexion. Garmin a temporairement bloqué l\'accès. Attendez 2-3 minutes et réessayez.'
      : (err.message.includes('401') || err.message.toLowerCase().includes('invalid')
          ? 'Identifiants Garmin incorrects. Vérifiez votre e-mail et mot de passe.'
          : 'Erreur de connexion : ' + err.message);
    res.status(is429 ? 429 : 401).json({ error: msg, retryable: is429 });
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
        return res.json({ success: true, user: sessionData.email });
      }
      sessionData = await createGarminSession(ENV_EMAIL, ENV_PASSWORD);
      envSessionId = uuidv4();
      sessions.set(envSessionId, sessionData);
      res.cookie('sid', envSessionId, { httpOnly: true, sameSite: 'lax' });
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
    console.log('[OK] Session creee pour:', email);
    res.json({ success: true, user: email });

  } catch (err) {
    console.error('Login error:', err.message);
    const is429 = err.message.includes('429') || err.message.includes('427') || err.message.toLowerCase().includes('rate');
    const msg = is429
      ? 'Trop de tentatives de connexion. Garmin a temporairement bloqué l\'accès. Attendez 2-3 minutes et réessayez.'
      : 'Identifiants Garmin incorrects. Vérifiez votre e-mail et mot de passe.';
    res.status(is429 ? 429 : 401).json({ error: msg, retryable: is429 });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
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
    const lastRuns = getLastRunActivities(activities, 50);
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
        stats.vo2maxSeries = history.map(h => ({ date: h.date, value: h.value }));
        const last = history[history.length - 1];
        stats.latestVO2Max = last.value;
        stats.vo2MaxPrecise = last.preciseValue;
      }
    } catch(e) { /* silencieux - on garde la serie issue des activites */ }

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
      vO2MaxValue:     a.vO2MaxValue
    }));
    res.json({ stats, lastRuns, allActivities, records, lastUpdated: new Date().toISOString() });
  } catch (err) { handleError(res, err); }
});

// Activites par annee (chargement a la demande)
app.get('/api/activities/year/:year', requireSession, async (req, res) => {
  try {
    const year = parseInt(req.params.year, 10);
    if (!year || year < 2000 || year > new Date().getFullYear()) {
      return res.status(400).json({ error: 'Annee invalide' });
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
      vO2MaxValue:     a.vO2MaxValue
    }));
    res.json({ year, activities: mapped, count: mapped.length });
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

// Body Battery
app.get('/api/body-battery', requireSession, async (req, res) => {
  try {
    const data = await req.session.fns.getBodyBatteryData();
    res.json({ data });
  } catch (err) { handleError(res, err); }
});

// Statut d'entrainement
app.get('/api/training-status', requireSession, async (req, res) => {
  try {
    const data = await req.session.fns.getTrainingStatusData();
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
    let elevation = [];
    if (Array.isArray(detail.metricDescriptors) && Array.isArray(detail.activityDetailMetrics)) {
      const keys = detail.metricDescriptors.map(m => m.key);
      const idxElev = keys.indexOf('directElevation');
      const idxDist = keys.indexOf('sumDistance');
      if (idxElev !== -1 && idxDist !== -1) {
        const rows = detail.activityDetailMetrics;
        const elevStep = Math.max(1, Math.floor(rows.length / MAX_PTS));
        elevation = rows
          .filter((_, i) => i % elevStep === 0)
          .map(r => ({ distKm: (r.metrics[idxDist] || 0) / 1000, alt: r.metrics[idxElev] }))
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
    campusEnabled:      CAMPUS_ENABLED,
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
    // Si goal vide → token probablement expiré → refresh et retry une fois
    if (!goal?._id) {
      console.log('[Campus] Pas de goal actif, tentative de refresh du token...');
      await tryAutoLoginCampus();
      if (_envCampusTokenCache && _envCampusTokenCache !== token) {
        console.log('[Campus] Retry avec nouveau token après refresh');
        goal = await getActiveGoal(_envCampusTokenCache);
      }
    }
    const goalId = goal?._id;
    if (!goalId) {
      return res.status(404).json({ error: 'Aucun plan actif trouvé sur Campus Coach', authError: false });
    }
    const freshTok = _envCampusTokenCache || token;
    const weeks = await getFullTrainingPlan(freshTok, goalId);
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

// R©sum© d©taill© du goal actif
app.get('/api/campus/goal-detail', requireCampusToken, async (req, res) => {
  try {
    const goal = await getActiveGoal(req.campusToken);
    const goalId = goal._id;
    if (!goalId) throw new Error('goalId introuvable');
    const summary = await getGoalSummary(req.campusToken, goalId);
    res.json({ goalId, summary });
  } catch(err) { handleError(res, err); }
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
  let dplusMin = null, dplusMax = null, dplusLabel = null;

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

    // Calcul du label D+
    if (dplusMin !== null && dplusMax !== null) {
      if (dplusMax <= 1000)       dplusLabel = '0_1000';
      else if (dplusMin >= 3000)  dplusLabel = '3000_9999';
      else                        dplusLabel = dplusMin + '_' + dplusMax;
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
    dplusMin, dplusMax, dplusLabel,
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
        dplusMin:   meta.dplusMin,
        dplusMax:   meta.dplusMax,
      };
    }

    res.json(data);
  } catch(err) { handleError(res, err); }
});

app.listen(PORT, () => {
    console.log('\n[START] Allure+ Dashboard demarre !');
    console.log(`[INFO] Ouvrez votre navigateur sur : http://localhost:${PORT}\n`);
    if (ENV_EMAIL) {
    console.log(`[OK] Auto-login configure pour : ${ENV_EMAIL}`);
    } else {
      console.log('[INFO] Aucun .env detecte - connexion requise via navigateur');
    }
  });
});

