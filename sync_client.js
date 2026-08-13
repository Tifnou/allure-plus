// Client bas niveau HTTP vers sync-relay/ (Cloudflare Worker) - aucune
// connaissance des fichiers locaux ni de leur format, juste le protocole
// (enveloppes JSON horodatees + fichiers binaires). La logique de fusion et
// la traduction fichier-local <-> enveloppe vivent dans sync.js.
// Valeurs par defaut EN DUR (pas seulement dans .env.example) : ce sont des
// valeurs partagees/embarquees dans CHAQUE installation Allure+ (identifient
// l'app, pas une vraie protection - meme modele que SUPPORT_CLIENT_KEY), PAS
// des secrets par utilisateur comme GARMIN_EMAIL/PASSWORD. Bug reel constate
// (13/08) : /api/save-env (server.js, ecrit le .env lors de la configuration
// de l'auto-login) n'ecrit QUE les identifiants Garmin - une installation
// neuve n'a donc jamais ces deux valeurs dans son .env (jamais present dans
// l'installeur non plus, .env est exclu du packaging), et la synchro restait
// silencieusement non configuree (aucune erreur visible) sur toute machine
// autre que celle de developpement. process.env reste prioritaire si present
// (permet de pointer vers un autre relais en test), sinon ce filet de
// securite garantit que la synchro fonctionne des l'installation, sans
// dependre d'une etape .env manuelle que rien n'incite l'utilisateur a faire.
const SYNC_RELAY_URL  = process.env.SYNC_RELAY_URL  || 'https://allure-plus-sync-relay.support-relay.workers.dev';
const SYNC_CLIENT_KEY = process.env.SYNC_CLIENT_KEY || '635a64cf84014cfdd921fad461fc6373a90e037f713f9863';

function isConfigured() {
  return !!(SYNC_RELAY_URL && SYNC_CLIENT_KEY);
}

async function pushEntries(type, email, entries) {
  const res = await fetch(`${SYNC_RELAY_URL}/sync/${type}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, clientKey: SYNC_CLIENT_KEY, entries }),
  });
  if (!res.ok) throw new Error(`push ${type} a echoue (${res.status})`);
  const data = await res.json();
  return data.envelope;
}

async function pullEnvelope(type, email) {
  const url = `${SYNC_RELAY_URL}/sync/${type}?email=${encodeURIComponent(email)}&clientKey=${encodeURIComponent(SYNC_CLIENT_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pull ${type} a echoue (${res.status})`);
  const data = await res.json();
  return data.envelope;
}

async function pullFileManifest(email) {
  const url = `${SYNC_RELAY_URL}/sync/files/manifest?email=${encodeURIComponent(email)}&clientKey=${encodeURIComponent(SYNC_CLIENT_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest fichiers a echoue (${res.status})`);
  const data = await res.json();
  return data.manifest;
}

async function downloadFile(email, filename) {
  const url = `${SYNC_RELAY_URL}/sync/files/${encodeURIComponent(filename)}?email=${encodeURIComponent(email)}&clientKey=${encodeURIComponent(SYNC_CLIENT_KEY)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`telechargement ${filename} a echoue (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, hash: res.headers.get('X-File-Hash'), mtimeMs: Number(res.headers.get('X-File-Mtime')) };
}

// Retourne {applied:true} en cas de succes, ou {applied:false, remoteHash,
// remoteMtimeMs} si le relais a rejete l'ecriture (version distante plus
// recente) - jamais une exception dans ce cas precis, c'est un resultat
// normal du protocole, pas une erreur reseau.
async function uploadFile(email, filename, buffer, hash, mtimeMs) {
  const url = `${SYNC_RELAY_URL}/sync/files/${encodeURIComponent(filename)}?email=${encodeURIComponent(email)}&clientKey=${encodeURIComponent(SYNC_CLIENT_KEY)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'X-File-Hash': hash, 'X-File-Mtime': String(mtimeMs) },
    body: buffer,
  });
  if (res.status === 409) return await res.json();
  if (!res.ok) throw new Error(`upload ${filename} a echoue (${res.status})`);
  return await res.json();
}

async function deleteFile(email, filename) {
  const res = await fetch(`${SYNC_RELAY_URL}/sync/files/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, clientKey: SYNC_CLIENT_KEY }),
  });
  if (!res.ok) throw new Error(`suppression ${filename} a echoue (${res.status})`);
  return await res.json();
}

module.exports = { isConfigured, pushEntries, pullEnvelope, pullFileManifest, downloadFile, uploadFile, deleteFile };
