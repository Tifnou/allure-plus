// Allure+ — Relais de synchronisation cross-appareils (Cloudflare Worker)
//
// Magasin cle-valeur generique (Cloudflare KV) permettant a un meme compte
// (identifie par email) de synchroniser ses donnees personnelles (profil,
// objectifs, records, courses, chaussures, PPS, analyses de seances liees...)
// entre plusieurs installations locales d'Allure+ (ex: PC perso + PC bureau).
//
// Meme principe de confiance que support-relay/ : chaque server.js local
// parle a CE Worker (jamais le navigateur directement), avec une CLIENT_KEY
// partagee embarquee dans toute installation. Ce Worker ne connait AUCUNE
// logique metier (pas de notion de "course"/"chaussure") - c'est juste un
// stockage cle-valeur avec fusion par entree horodatee + tombstone. Toute la
// traduction fichier-local <-> enveloppe generique vit cote server.js.
//
// Format d'une enveloppe JSON (une cle KV = un (compte, type)) :
//   { "entries": { "<cle-metier>": { "value": {...}|null, "updatedAt": "...", "deletedAt": "..."|null } } }
//
// Fichiers binaires (avatar, PDF...) : cle KV separee "user:<email>:file:<nom>",
// valeur = octets bruts, metadata KV = { hash, mtimeMs, updatedAt, size, deletedAt }.

// Doit rester synchronise avec SYNC_TYPES (sync.js, cote server.js local) -
// simple garde-fou pour eviter qu'un type de donnee arbitraire cree des cles
// KV non bornees (le CLIENT_KEY protege deja l'acces, mais autant rester strict).
const ALLOWED_TYPES = [
  'user_data', 'records_overrides', 'races', 'gear', 'activity_gear',
  'session_analyses', 'weight_history', 'health_snapshots', 'pps', 'pace_profile',
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function envelopeKey(email, type) {
  return `user:${email}:${type}`;
}
function fileKey(email, filename) {
  return `user:${email}:file:${filename}`;
}

function checkAuth(env, clientKey) {
  return String(clientKey || '') === env.CLIENT_KEY;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Nom de fichier : un seul segment, jamais de traversee de chemin - les
// fichiers uploads/ d'Allure+ sont deja tous a plat (avatar.jpg, pps-<uuid>.pdf,
// race-<id>.pdf|.png), donc aucun besoin legitime de '/' ou '..' ici.
function isValidFilename(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 200
    && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..';
}

async function handleGetEnvelope(env, email, type) {
  const raw = await env.SYNC_KV.get(envelopeKey(email, type));
  const envelope = raw ? JSON.parse(raw) : { entries: {} };
  return json({ envelope });
}

// Fusion par entree : l'entrant ne gagne que s'il est strictement plus recent
// que l'existant. Point de surete central : les cles ABSENTES du payload
// entrant restent intactes dans l'enveloppe stockee - un push partiel est une
// UNION, jamais un remplacement total (sinon un appareil qui pousse un seul
// element effacerait tout ce que l'autre appareil a ajoute entre-temps).
async function handlePostEnvelope(req, env, type) {
  const body = await req.json();
  const email = normalizeEmail(body.email);
  if (!checkAuth(env, body.clientKey)) return json({ message: 'Client non autorisé' }, 401);
  if (!email) return json({ message: 'email requis' }, 400);
  const incoming = body.entries && typeof body.entries === 'object' ? body.entries : {};

  const key = envelopeKey(email, type);
  const raw = await env.SYNC_KV.get(key);
  const envelope = raw ? JSON.parse(raw) : { entries: {} };

  Object.entries(incoming).forEach(([entryKey, entry]) => {
    if (!entry || typeof entry.updatedAt !== 'string') return; // entree malformee -> ignoree
    const existing = envelope.entries[entryKey];
    if (!existing || entry.updatedAt > existing.updatedAt) {
      envelope.entries[entryKey] = entry;
    }
    // sinon : le serveur garde sa version (plus recente ou egale) - le push
    // ne "perd" jamais silencieusement, la reponse renvoie l'enveloppe
    // complete et server.js reconciliera sa copie locale avec elle.
  });

  await env.SYNC_KV.put(key, JSON.stringify(envelope));
  return json({ envelope });
}

// NOTE coherence : SYNC_KV.list() est "eventually consistent" cote Cloudflare
// (constate en test : jusqu'a ~30s de decalage apres un PUT/DELETE recent,
// alors que get()/getWithMetadata() sur la cle exacte est a jour immediatement).
// Sans consequence ici : le pire cas est qu'un fichier tout juste modifie
// n'apparaisse pas encore dans le manifest d'un autre appareil, rattrape au
// prochain cycle de reconciliation (5 min cote server.js) - jamais une perte.
async function handleFilesManifest(env, email) {
  const prefix = `user:${email}:file:`;
  const list = await env.SYNC_KV.list({ prefix });
  const manifest = {};
  list.keys.forEach(k => {
    const filename = k.name.slice(prefix.length);
    manifest[filename] = k.metadata || {};
  });
  return json({ manifest });
}

async function handleGetFile(env, email, filename) {
  const { value, metadata } = await env.SYNC_KV.getWithMetadata(fileKey(email, filename), 'arrayBuffer');
  if (!value || !metadata || metadata.deletedAt) return json({ message: 'Fichier introuvable' }, 404);
  return new Response(value, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Hash': metadata.hash || '',
      'X-File-Mtime': String(metadata.mtimeMs || ''),
      'X-File-Updated-At': metadata.updatedAt || '',
    },
  });
}

// Le Worker ARBITRE lui-meme (rejette 409 si la version entrante est plus
// ancienne que celle deja stockee) plutot que de faire confiance aveuglement
// au client - un client avec une vue perimee du cloud ne doit jamais pouvoir
// ecraser une version plus recente qu'il ne connait pas encore.
async function handlePutFile(req, env, url, email, filename) {
  const clientKey = url.searchParams.get('clientKey');
  if (!checkAuth(env, clientKey)) return json({ message: 'Client non autorisé' }, 401);
  const hash = req.headers.get('X-File-Hash') || '';
  const mtimeMs = Number(req.headers.get('X-File-Mtime') || 0);
  if (!hash || !mtimeMs) return json({ message: 'X-File-Hash et X-File-Mtime requis' }, 400);

  const key = fileKey(email, filename);
  const existingMeta = await env.SYNC_KV.getWithMetadata(key, 'arrayBuffer');
  const existing = existingMeta.metadata;
  if (existing && !existing.deletedAt && existing.mtimeMs >= mtimeMs && existing.hash !== hash) {
    return json({ applied: false, remoteHash: existing.hash, remoteMtimeMs: existing.mtimeMs }, 409);
  }
  if (existing && existing.hash === hash) {
    return json({ applied: true, unchanged: true });
  }

  const body = await req.arrayBuffer();
  const size = body.byteLength;
  const metadata = { hash, mtimeMs, size, updatedAt: new Date().toISOString(), deletedAt: null };
  await env.SYNC_KV.put(key, body, { metadata });
  return json({ applied: true });
}

async function handleDeleteFile(req, env, email, filename) {
  const body = await req.json().catch(() => ({}));
  if (!checkAuth(env, body.clientKey)) return json({ message: 'Client non autorisé' }, 401);
  const key = fileKey(email, filename);
  const existingMeta = await env.SYNC_KV.getWithMetadata(key, 'arrayBuffer');
  const metadata = {
    ...(existingMeta.metadata || {}),
    deletedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Tombstone : on garde la cle (avec un contenu vide) plutot qu'une vraie
  // suppression KV, pour que le manifest continue de signaler la suppression
  // aux autres appareils lors de leur prochaine reconciliation.
  await env.SYNC_KV.put(key, new ArrayBuffer(0), { metadata });
  return json({ ok: true });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['sync', ...]

    try {
      if (parts[0] !== 'sync') return json({ message: 'Not found' }, 404);

      // /sync/files/manifest | /sync/files/:filename
      if (parts[1] === 'files') {
        if (parts[2] === 'manifest' && req.method === 'GET') {
          const email = normalizeEmail(url.searchParams.get('email'));
          if (!checkAuth(env, url.searchParams.get('clientKey'))) return json({ message: 'Client non autorisé' }, 401);
          if (!email) return json({ message: 'email requis' }, 400);
          return await handleFilesManifest(env, email);
        }
        const filename = parts[2];
        if (!filename || !isValidFilename(filename)) return json({ message: 'Nom de fichier invalide' }, 400);

        if (req.method === 'GET') {
          const email = normalizeEmail(url.searchParams.get('email'));
          if (!checkAuth(env, url.searchParams.get('clientKey'))) return json({ message: 'Client non autorisé' }, 401);
          if (!email) return json({ message: 'email requis' }, 400);
          return await handleGetFile(env, email, filename);
        }
        if (req.method === 'PUT') {
          const email = normalizeEmail(url.searchParams.get('email'));
          if (!email) return json({ message: 'email requis' }, 400);
          return await handlePutFile(req, env, url, email, filename);
        }
        if (req.method === 'DELETE') {
          const body = await req.clone().json().catch(() => ({}));
          const email = normalizeEmail(body.email);
          if (!email) return json({ message: 'email requis' }, 400);
          return await handleDeleteFile(req, env, email, filename);
        }
        return json({ message: 'Not found' }, 404);
      }

      // /sync/:type
      const type = parts[1];
      if (!type || !ALLOWED_TYPES.includes(type)) return json({ message: 'Type invalide' }, 400);

      if (req.method === 'GET') {
        const email = normalizeEmail(url.searchParams.get('email'));
        if (!checkAuth(env, url.searchParams.get('clientKey'))) return json({ message: 'Client non autorisé' }, 401);
        if (!email) return json({ message: 'email requis' }, 400);
        return await handleGetEnvelope(env, email, type);
      }
      if (req.method === 'POST') {
        return await handlePostEnvelope(req, env, type);
      }
      return json({ message: 'Not found' }, 404);
    } catch (e) {
      return json({ message: e?.message || 'Erreur serveur' }, 500);
    }
  },
};
