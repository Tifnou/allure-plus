// Cycle de vie du process BRouter local (self-hosted). Demarrage paresseux :
// le process Java n'est lance qu'a la premiere generation d'itineraire
// demandee, pas au boot du serveur Allure+.
//
// Invocation reelle verifiee dans le depot BRouter (misc/scripts/standalone/server.cmd) :
//   java -cp brouter.jar btools.server.RouteServer <segmentdir> <profiledir> <customprofiledir> <port> <maxthreads>

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const BROUTER_DIR = process.env.BROUTER_DIR || path.join(__dirname, 'brouter');
const JAVA_PATH = process.env.BROUTER_JAVA_PATH || 'java';
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

function spawnBrouter() {
  if (!isBrouterConfigured()) {
    throw new Error(`BRouter non configure - fichiers manquants dans ${BROUTER_DIR} (brouter.jar / segments4 / profiles2). Voir README setup.`);
  }
  const args = [
    '-Xmx256M', '-DmaxRunningTime=120', '-DuseRFCMimeType=false',
    '-cp', JAR_PATH, 'btools.server.RouteServer',
    SEGMENTS_DIR, PROFILES_DIR, CUSTOMPROFILES_DIR, String(PORT), '2',
  ];
  console.log('[brouter] demarrage:', JAVA_PATH, args.join(' '));
  const proc = spawn(JAVA_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => console.log('[brouter]', d.toString().trim()));
  proc.stderr.on('data', d => console.error('[brouter]', d.toString().trim()));
  proc.on('exit', (code) => {
    console.log(`[brouter] process arrete (code ${code})`);
    if (brouterProcess === proc) { brouterProcess = null; readyPromise = null; }
  });
  proc.on('error', (err) => {
    console.error('[brouter] erreur de lancement:', err.message);
    if (brouterProcess === proc) { brouterProcess = null; readyPromise = null; }
  });
  return proc;
}

// A appeler avant tout appel de routage. Spawn le process si necessaire,
// attend qu'il reponde. Les appels concurrents partagent la meme attente.
async function ensureBrouterRunning() {
  if (await pingBrouter()) return true;
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    if (!brouterProcess) brouterProcess = spawnBrouter();
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await pingBrouter()) return true;
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error('BRouter n\'a pas repondu dans le delai imparti (25s).');
  })();

  try {
    return await readyPromise;
  } catch (err) {
    readyPromise = null;
    throw err;
  }
}

function shutdownBrouter() {
  if (brouterProcess) {
    try { brouterProcess.kill(); } catch (e) {}
    brouterProcess = null;
  }
}

process.on('exit', shutdownBrouter);
process.on('SIGINT', () => { shutdownBrouter(); process.exit(0); });
process.on('SIGTERM', () => { shutdownBrouter(); process.exit(0); });

module.exports = {
  ensureBrouterRunning,
  isBrouterConfigured,
  getPort: () => PORT,
};
