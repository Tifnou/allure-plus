// Client bas niveau HTTP vers sync-relay/ (Cloudflare Worker) - aucune
// connaissance des fichiers locaux ni de leur format, juste le protocole
// (enveloppes JSON horodatees + fichiers binaires). La logique de fusion et
// la traduction fichier-local <-> enveloppe vivent dans sync.js.
const SYNC_RELAY_URL  = process.env.SYNC_RELAY_URL;
const SYNC_CLIENT_KEY = process.env.SYNC_CLIENT_KEY;

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
