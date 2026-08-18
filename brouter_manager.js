// Cycle de vie du process BRouter local (self-hosted). Demarrage paresseux :
// le process Java n'est lance qu'a la premiere generation d'itineraire
// demandee, pas au boot du serveur Allure+.
//
// Invocation reelle verifiee dans le depot BRouter (misc/scripts/standalone/server.cmd) :
//   java -cp brouter.jar btools.server.RouteServer <segmentdir> <profiledir> <customprofiledir> <port> <maxthreads>

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BROUTER_DIR = process.env.BROUTER_DIR || path.join(__dirname, 'brouter');
const JAVA_PATH_OVERRIDE = process.env.BROUTER_JAVA_PATH || null;
const JAR_PATH = process.env.BROUTER_JAR_PATH || path.join(BROUTER_DIR, 'brouter.jar');
const SEGMENTS_DIR = process.env.BROUTER_SEGMENTS_DIR || path.join(BROUTER_DIR, 'segments4');
const PROFILES_DIR = process.env.BROUTER_PROFILES_DIR || path.join(BROUTER_DIR, 'profiles2');
const CUSTOMPROFILES_DIR = process.env.BROUTER_CUSTOMPROFILES_DIR || path.join(BROUTER_DIR, 'customprofiles');
const PORT = parseInt(process.env.BROUTER_PORT || '17777', 10);

const STARTUP_TIMEOUT_MS = 25000;
const POLL_INTERVAL_MS = 500;

let brouterProcess = null;
let readyPromise = null;

function pingBrouter() {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port: PORT, path: '/brouter', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true); // toute reponse HTTP (meme une erreur de parametres) prouve que le port ecoute
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// Fichiers requis presents sur disque - independant du fait que le process
// tourne deja ou non (utilise pour /api/status, ne doit pas spawn).
function isBrouterConfigured() {
  return fs.existsSync(JAR_PATH) && fs.existsSync(SEGMENTS_DIR) && fs.existsSync(PROFILES_DIR);
}

// Version majeure Java minimale requise pour executer brouter.jar - verifie
// en inspectant le bytecode reel du jar embarque (class file major version
// 55 = Java 11, cf RouteServer.class). Un Java 8 (ou anterieur) demarre le
// process sans erreur de lancement (pas d'ENOENT) mais la JVM plante aussitot
// avec UnsupportedClassVersionError - le process s'arrete avant meme
// d'ouvrir le port, ce qui ressemblait auparavant a un simple "BRouter n'a
// pas repondu dans le delai imparti" (aucun message clair sur la cause).
const MIN_JAVA_MAJOR_VERSION = 11;

// Extrait la version majeure d'un executable java (gere l'ancien format
// "1.8.0_251" -> 8 et le nouveau "11.0.2"/"21.0.1" -> 11/21). Renvoie null
// si l'executable n'existe pas ou si la sortie n'est pas reconnue.
function getJavaMajorVersion(javaPath) {
  const result = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 5000 });
  if (!result || result.error) return null;
  const text = (result.stderr || '') + (result.stdout || ''); // java ecrit "-version" sur stderr
  const m = /version "([\d.]+)/.exec(text);
  if (!m) return null;
  const parts = m[1].split('.');
  return parseInt(parts[0] === '1' ? parts[1] : parts[0], 10);
}

// Resout le chemin de l'executable java a utiliser, avec repli sur les
// emplacements d'installation connus (les memes qu'installe install.bat :
// winget puis, a defaut, telechargement direct du JRE Eclipse Adoptium 21)
// si le simple nom "java" n'est pas resolu par le PATH courant, OU si le
// java resolu est trop ancien (voir MIN_JAVA_MAJOR_VERSION ci-dessus).
// Pourquoi ce repli est necessaire (constats reels) :
// 1. Sur une install fraiche, install.bat installe Java PUIS l'utilisateur
//    lance immediatement Allure+ (case "Lancer Allure+" en fin d'installeur),
//    dans la MEME session Windows. Le PATH systeme est bien a jour dans le
//    registre, mais le processus qui vient de lancer l'app (herite de
//    l'Explorateur) ne le relit pas tant que la session n'est pas
//    rafraichie (deconnexion ou redemarrage) - Java est installe mais
//    invisible pour CE lancement precis.
// 2. install.bat ne verifie que la PRESENCE de java sur le PATH, pas sa
//    version - sur un PC ayant deja un tres vieux Java installe (ex: Java 8
//    pour un vieux logiciel), l'installeur considere Java "deja present" et
//    n'installe jamais le JRE 21 requis. Meme apres redemarrage du PC, ce
//    vieux Java reste trouve en premier sur le PATH.
// Resultat mis en cache (le disque ne bouge pas en cours de session).
let cachedJavaPath = null;
function resolveJavaPath() {
  if (cachedJavaPath) return cachedJavaPath;
  if (JAVA_PATH_OVERRIDE) { cachedJavaPath = JAVA_PATH_OVERRIDE; return cachedJavaPath; }

  const candidates = ['java'];
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean);
    const vendors = ['Eclipse Adoptium', 'Java', 'Zulu', 'Microsoft', 'Amazon Corretto'];
    for (const root of roots) {
      for (const vendor of vendors) {
        const vendorDir = path.join(root, vendor);
        let entries;
        try { entries = fs.readdirSync(vendorDir); } catch (_) { continue; }
        for (const entry of entries) {
          const candidate = path.join(vendorDir, entry, 'bin', 'java.exe');
          if (fs.existsSync(candidate)) candidates.push(candidate);
        }
      }
    }
  }
  for (const candidate of candidates) {
    if (getJavaMajorVersion(candidate) >= MIN_JAVA_MAJOR_VERSION) {
      cachedJavaPath = candidate;
      return cachedJavaPath;
    }
  }
  return null;
}

function spawnBrouter(onSpawnError) {
  if (!isBrouterConfigured()) {
    throw new Error(`BRouter non configure - fichiers manquants dans ${BROUTER_DIR} (brouter.jar / segments4 / profiles2). Voir README setup.`);
  }
  const javaPath = resolveJavaPath();
  if (!javaPath) {
    // "java" trouve sur le PATH mais version trop ancienne (cas reel : Java
    // 8 preexistant sur la machine, install.bat ne verifie que la presence
    // de java, pas sa version, et n'installe donc jamais le JRE 21 requis)
    // vs. aucun java du tout trouve nulle part - message adapte au cas.
    const oldJavaMajor = getJavaMajorVersion('java');
    const message = oldJavaMajor
      ? `Java ${oldJavaMajor} est installe mais trop ancien - BRouter necessite Java ${MIN_JAVA_MAJOR_VERSION} ou plus recent. ` +
        "Installez Eclipse Temurin 21 (https://adoptium.net/temurin/releases/?package=jre) puis relancez Allure+."
      : "Java est introuvable - necessaire a la generation d'itineraires (BRouter). " +
        "Si vous venez d'installer Allure+, redemarrez votre ordinateur puis reessayez " +
        "(Java a peut-etre ete installe mais necessite un redemarrage pour etre detecte). " +
        "Sinon, installez Java (Eclipse Temurin 21) puis relancez Allure+.";
    throw new Error(message
    );
  }
  const args = [
    '-Xmx256M', '-DmaxRunningTime=120', '-DuseRFCMimeType=false',
    '-cp', JAR_PATH, 'btools.server.RouteServer',
    SEGMENTS_DIR, PROFILES_DIR, CUSTOMPROFILES_DIR, String(PORT), '2',
  ];
  console.log('[brouter] demarrage:', javaPath, args.join(' '));
  const proc = spawn(javaPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => console.log('[brouter]', d.toString().trim()));
  proc.stderr.on('data', d => console.error('[brouter]', d.toString().trim()));
  proc.on('exit', (code) => {
    console.log(`[brouter] process arrete (code ${code})`);
    if (brouterProcess === proc) { brouterProcess = null; readyPromise = null; }
  });
  proc.on('error', (err) => {
    console.error('[brouter] erreur de lancement:', err.message);
    if (brouterProcess === proc) { brouterProcess = null; readyPromise = null; }
    // Signale l'echec immediatement plutot que de laisser ensureBrouterRunning
    // patienter les 25s completes en pingant un process qui n'a jamais demarre.
    if (onSpawnError) onSpawnError(err);
  });
  return proc;
}

// A appeler avant tout appel de routage. Spawn le process si necessaire,
// attend qu'il reponde. Les appels concurrents partagent la meme attente.
async function ensureBrouterRunning() {
  if (await pingBrouter()) return true;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    let spawnError = null;
    if (!brouterProcess) brouterProcess = spawnBrouter((err) => { spawnError = err; });
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await pingBrouter()) return true;
      // Le process a echoue a demarrer (ex: ENOENT) - inutile d'attendre le
      // reste des 25s, l'erreur est deja connue et ne se resoudra pas seule.
      if (spawnError) throw new Error(`BRouter n'a pas pu demarrer : ${spawnError.message}`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error('BRouter n\'a pas repondu dans le delai imparti (25s).');
  })();

  try {
    return await readyPromise;
  } catch (err) {
    readyPromise = null;
    // Marqueur verifie par route_generator.js : distingue "BRouter est
    // injoignable" (aucune direction ne pourra jamais aboutir, inutile de
    // continuer a essayer) d'un simple "cette direction precise n'est pas
    // routable" (cas normal, une partie du scan echoue toujours). Sans ce
    // marqueur, un BRouter completement down (Java introuvable, jar
    // manquant...) finissait noye dans les echecs individuels de chaque
    // direction, et l'utilisateur ne voyait que le message generique
    // "Impossible de generer une boucle exploitable" au lieu de la vraie
    // cause (constat reel : ami avec Java installe par notre installeur,
    // jamais vu le message clair).
    err.brouterUnavailable = true;
    throw err;
  }
}

// callback optionnel appele une fois le process reellement termine (pas
// juste kill() envoye) - necessaire pour eviter un crash libuv observe en
// test quand process.exit() est appele immediatement apres kill() alors que
// les pipes stdout/stderr du enfant sont encore en cours de fermeture.
function shutdownBrouter(callback) {
  if (brouterProcess) {
    const proc = brouterProcess;
    brouterProcess = null;
    readyPromise = null;
    proc.once('exit', () => { if (callback) callback(); });
    try { proc.kill(); } catch (e) { if (callback) callback(); }
  } else if (callback) {
    callback();
  }
}

process.on('exit', () => shutdownBrouter()); // handler 'exit' : uniquement synchrone, pas de callback attendu
process.on('SIGINT', () => shutdownBrouter(() => process.exit(0)));
process.on('SIGTERM', () => shutdownBrouter(() => process.exit(0)));

// ─────────────────────────────────────────────
// Tuiles OSM (segments4/*.rd5) - telechargement a la demande
// ─────────────────────────────────────────────
// Convention de nommage verifiee ce soir (brouter.de/brouter/segments4/) :
// tuiles de 5x5 degres, nommees par leur coin sud-ouest.
const SEGMENTS_BASE_URL = 'https://brouter.de/brouter/segments4';

function tileNameForPoint(lat, lon) {
  const tileLon = Math.floor(lon / 5) * 5;
  const tileLat = Math.floor(lat / 5) * 5;
  const slon = tileLon < 0 ? `W${Math.abs(tileLon)}` : `E${tileLon}`;
  const slat = tileLat < 0 ? `S${Math.abs(tileLat)}` : `N${tileLat}`;
  return `${slon}_${slat}.rd5`;
}

function isTilePresent(lat, lon) {
  const tileName = tileNameForPoint(lat, lon);
  return { tileName, present: fs.existsSync(path.join(SEGMENTS_DIR, tileName)) };
}

async function getTileRemoteSize(tileName) {
  const res = await fetch(`${SEGMENTS_BASE_URL}/${tileName}`, { method: 'HEAD' });
  if (!res.ok) throw new Error(`Tuile introuvable sur le serveur BRouter (HTTP ${res.status}) - secteur peut-être hors couverture.`);
  const len = res.headers.get('content-length');
  return len ? parseInt(len, 10) : null;
}

// Telechargement direct sur disque (fichier temporaire puis rename atomique,
// pour ne jamais laisser une tuile a moitie ecrite si l'operation echoue).
async function downloadTile(tileName) {
  const res = await fetch(`${SEGMENTS_BASE_URL}/${tileName}`);
  if (!res.ok || !res.body) {
    throw new Error(`Téléchargement de la tuile échoué (HTTP ${res.status})`);
  }
  fs.mkdirSync(SEGMENTS_DIR, { recursive: true });
  const destPath = path.join(SEGMENTS_DIR, tileName);
  const tmpPath = `${destPath}.part`;
  const { Readable } = require('stream');
  const fileStream = fs.createWriteStream(tmpPath);
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
  fs.renameSync(tmpPath, destPath);
  return destPath;
}

module.exports = {
  ensureBrouterRunning,
  isBrouterConfigured,
  getPort: () => PORT,
  tileNameForPoint,
  isTilePresent,
  getTileRemoteSize,
  downloadTile,
};
