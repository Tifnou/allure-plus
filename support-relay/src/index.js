// Allure+ — Relais de support (Cloudflare Worker)
//
// Sert d'intermediaire entre chaque installation locale d'Allure+ et les
// Issues GitHub du repo public Tifnou/allure-plus, qui servent de backend
// de tickets gratuit (categorie = label, etat = open/closed + label "en
// cours", echange = fil de commentaires). Le seul role de ce relais est de
// garder le token GitHub (droits d'ecriture sur les Issues) hors de toute
// installation distribuee — chaque utilisateur n'a jamais acces qu'a ce
// Worker, jamais au token lui-meme.
//
// Toutes les requetes viennent du serveur Node local de chaque utilisateur
// (jamais directement d'un navigateur), donc pas de CORS a gerer.

const GITHUB_API = 'https://api.github.com';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'AllurePlus-Support-Relay',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(env, path, options = {}) {
  const res = await fetch(`${GITHUB_API}/repos/${env.GITHUB_REPO}${path}`, {
    ...options,
    headers: { ...ghHeaders(env), ...(options.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw { status: res.status, message: data?.message || 'Erreur GitHub', data };
  return data;
}

const CATEGORY_LABELS = {
  bug: 'bug',
  amelioration: 'amélioration',
  idee: 'idée',
  question: 'question',
};

// Ticket "prive" : label dedie, meme mecanique que "en cours"/"supprime"
// (jamais un champ GitHub natif, les Issues n'en ont pas). Un ticket prive
// reste techniquement lisible sur GitHub par quiconque a l'URL (le repo
// Tifnou/allure-plus est public) - ce label ne fait que le masquer entre
// utilisateurs de l'app elle-meme (cf. handleListTickets/handleGetTicket),
// ce n'est pas une vraie confidentialite cote GitHub.
const PRIVATE_LABEL = 'privé';

function stripMarker(body, marker) {
  const re = new RegExp(`\\n*<!--\\s*${marker}:(.*?)\\s*-->\\s*$`, 's');
  const m = body?.match(re);
  return { value: m ? m[1].trim() : null, cleaned: (body || '').replace(re, '').trim() };
}

function extractReporter(issueBody) {
  return stripMarker(issueBody, 'reporter');
}

function extractCommentAuthor(commentBody) {
  const m = commentBody?.match(/^<!--\s*author:(.*?)\s*-->\n?/s);
  return {
    author: m ? m[1].trim() : null,
    cleaned: m ? commentBody.slice(m[0].length) : (commentBody || ''),
  };
}

function ticketStatus(issue) {
  if (issue.state === 'closed') return 'resolu';
  if ((issue.labels || []).some(l => (l.name || l) === 'en cours')) return 'en_cours';
  return 'nouveau';
}

// "Suppression" = label dedie + fermeture, jamais une vraie suppression
// GitHub (reservee aux proprietaires de repo, hors de portee d'un token
// fine-grained Issues seul) - masque simplement le ticket de toutes les
// vues de l'app (mine/all/admin/detail), recuperable manuellement sur
// GitHub si besoin, sans droits supplementaires a demander.
function isDeleted(issue) {
  return (issue.labels || []).some(l => (l.name || l) === 'supprimé');
}

function isPrivateIssue(issue) {
  return (issue.labels || []).some(l => (l.name || l) === PRIVATE_LABEL);
}

function categoryFromLabels(labels) {
  const names = (labels || []).map(l => l.name || l);
  return Object.values(CATEGORY_LABELS).find(l => names.includes(l)) || null;
}

function summarizeIssue(issue, { includeReporter } = {}) {
  const { value: reporter, cleaned } = extractReporter(issue.body || '');
  const pageMatch = cleaned.match(/^\*\*Page concernée\s*:\*\*\s*(.*)$/m);
  const message = cleaned.replace(/^\*\*Page concernée\s*:\*\*\s*.*$/m, '').trim();
  return {
    number: issue.number,
    title: issue.title,
    category: categoryFromLabels(issue.labels),
    page: pageMatch ? pageMatch[1].trim() : null,
    message,
    status: ticketStatus(issue),
    private: isPrivateIssue(issue),
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    commentsCount: issue.comments,
    ...(includeReporter ? { reporterEmail: reporter } : {}),
  };
}

function requireFields(body, fields) {
  for (const f of fields) {
    if (!body || body[f] === undefined || body[f] === null || String(body[f]).trim() === '') {
      throw { status: 400, message: `Champ manquant : ${f}` };
    }
  }
}

// Une image jointe (voir handleUploadImage) est simplement une URL publique
// deja hebergee dans IMAGES_KV a ce point - GitHub affiche nativement une
// image via son URL en markdown, aucun upload cote GitHub necessaire.
function appendImage(text, imageUrl) {
  if (!imageUrl) return text;
  return `${text}\n\n![capture](${imageUrl})`;
}

// Repere les ids d'images hebergees par CE relais (IMAGES_KV) dans un texte
// libre (corps d'issue/commentaire) - utilise pour le nettoyage a la
// suppression d'un ticket (voir handleDeleteTicket). Se limite volontairement
// aux URLs `<origin>/images/:id` (jamais d'URL externe), pour ne jamais
// tenter de supprimer autre chose que ce que ce relais a lui-meme stocke.
function extractImageIds(text, origin) {
  if (!text) return [];
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}/images/([a-zA-Z0-9-]+)`, 'g');
  const ids = [];
  let m;
  while ((m = re.exec(text))) ids.push(m[1]);
  return ids;
}

async function handleCreateTicket(req, env) {
  const body = await req.json();
  requireFields(body, ['email', 'category', 'message']);
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const label = CATEGORY_LABELS[body.category];
  if (!label) throw { status: 400, message: 'Catégorie invalide' };
  const message = String(body.message).slice(0, 4000).trim();
  const page = body.page ? String(body.page).slice(0, 120).trim() : '';
  const email = String(body.email).slice(0, 200).trim().toLowerCase();

  const title = `[${label}] ${(page ? page + ' — ' : '') + message}`.slice(0, 90).trim();
  const issueBody = [
    page ? `**Page concernée :** ${page}` : null,
    appendImage(message, body.imageUrl),
    `<!-- reporter:${email} -->`,
  ].filter(Boolean).join('\n\n');
  const labels = body.private ? [label, PRIVATE_LABEL] : [label];

  const issue = await gh(env, '/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body: issueBody, labels }),
  });
  return json({ ticket: summarizeIssue(issue, { includeReporter: true }) }, 201);
}

async function handleListTickets(req, env, url) {
  const email = (url.searchParams.get('email') || '').toLowerCase();
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
  const isAdmin = url.searchParams.get('adminKey') === env.ADMIN_KEY;

  const issues = await gh(env, '/issues?state=all&per_page=100&sort=updated');
  // reporterEmail toujours extrait ici (meme cote non-admin/scope=all) pour
  // pouvoir filtrer les tickets prives des AUTRES utilisateurs ci-dessous -
  // retire du resultat juste avant le retour si non autorise (comportement
  // inchange pour qui a le droit de le voir ou non).
  let tickets = issues
    .filter(i => !i.pull_request && !isDeleted(i))
    .map(i => summarizeIssue(i, { includeReporter: true }));

  if (scope === 'mine') {
    tickets = tickets.filter(t => t.reporterEmail === email);
  } else if (!isAdmin) {
    tickets = tickets.filter(t => !t.private || t.reporterEmail === email);
  }

  if (!(scope === 'mine' || isAdmin)) {
    tickets = tickets.map(({ reporterEmail, ...rest }) => rest);
  }
  return json({ tickets });
}

async function handleGetTicket(req, env, number, url) {
  const [issue, comments] = await Promise.all([
    gh(env, `/issues/${number}`),
    gh(env, `/issues/${number}/comments?per_page=100`),
  ]);
  if (isDeleted(issue)) throw { status: 404, message: 'Ticket introuvable' };
  const summary = summarizeIssue(issue, { includeReporter: true });
  const isAdmin = url.searchParams.get('adminKey') === env.ADMIN_KEY;
  const email = (url.searchParams.get('email') || '').toLowerCase();
  if (summary.private && !isAdmin && summary.reporterEmail !== email) {
    throw { status: 403, message: 'Ce ticket est privé' };
  }
  const thread = comments.map(c => {
    const { author, cleaned } = extractCommentAuthor(c.body || '');
    return {
      id: c.id,
      author: author === 'admin' ? 'admin' : (author ? 'user' : 'inconnu'),
      message: cleaned,
      createdAt: c.created_at,
    };
  });
  return json({ ticket: summary, comments: thread });
}

async function handleAddComment(req, env, number) {
  const body = await req.json();
  requireFields(body, ['email', 'message']);
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const isAdmin = body.adminKey && body.adminKey === env.ADMIN_KEY;
  const email = String(body.email).slice(0, 200).trim().toLowerCase();
  const message = String(body.message).slice(0, 4000).trim();

  if (!isAdmin) {
    const issue = await gh(env, `/issues/${number}`);
    const { value: reporter } = extractReporter(issue.body || '');
    if (reporter !== email) throw { status: 403, message: "Ce ticket n'appartient pas à cet utilisateur" };
  }

  // Pas de prefixe visible ici : l'app affiche deja "Reponse de l'equipe" via
  // le champ author separe (support.js), inutile de le repeter dans le texte.
  const marker = isAdmin ? 'admin' : email;
  const commentBody = `<!-- author:${marker} -->\n${appendImage(message, body.imageUrl)}`;
  await gh(env, `/issues/${number}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: commentBody }),
  });
  return json({ ok: true }, 201);
}

async function handleSetStatus(req, env, number) {
  const body = await req.json();
  if (body.adminKey !== env.ADMIN_KEY) throw { status: 401, message: 'Non autorisé' };
  const status = body.status;
  if (!['nouveau', 'en_cours', 'resolu'].includes(status)) throw { status: 400, message: 'Statut invalide' };

  const issue = await gh(env, `/issues/${number}`);
  const otherLabels = (issue.labels || []).map(l => l.name || l).filter(n => n !== 'en cours');
  const labels = status === 'en_cours' ? [...otherLabels, 'en cours'] : otherLabels;

  await gh(env, `/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: status === 'resolu' ? 'closed' : 'open', labels }),
  });
  return json({ ok: true });
}

// Bascule privé/public - uniquement les labels, jamais l'etat (state) du
// ticket : doit fonctionner aussi bien sur un ticket ouvert que deja
// archive/resolu (demande utilisateur explicite, "retroactivement"), sans
// jamais le rouvrir/refermer par effet de bord. Autorise le proprietaire du
// ticket OU l'admin (qui peut basculer n'importe quel ticket, meme sans
// jamais l'avoir ouvert au prealable).
async function handleSetPrivacy(req, env, number) {
  const body = await req.json();
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const isAdmin = body.adminKey && body.adminKey === env.ADMIN_KEY;
  const email = String(body.email || '').slice(0, 200).trim().toLowerCase();

  const issue = await gh(env, `/issues/${number}`);
  if (!isAdmin) {
    const { value: reporter } = extractReporter(issue.body || '');
    if (reporter !== email) throw { status: 403, message: "Ce ticket n'appartient pas à cet utilisateur" };
  }
  const otherLabels = (issue.labels || []).map(l => l.name || l).filter(n => n !== PRIVATE_LABEL);
  const labels = body.private ? [...otherLabels, PRIVATE_LABEL] : otherLabels;
  await gh(env, `/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  });
  return json({ ok: true, private: !!body.private });
}

async function handleDeleteTicket(req, env, number) {
  const body = await req.json();
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const isAdmin = body.adminKey && body.adminKey === env.ADMIN_KEY;
  const email = String(body.email || '').slice(0, 200).trim().toLowerCase();

  const issue = await gh(env, `/issues/${number}`);
  if (!isAdmin) {
    const { value: reporter } = extractReporter(issue.body || '');
    if (reporter !== email) throw { status: 403, message: "Ce ticket n'appartient pas à cet utilisateur" };
  }

  // Nettoyage des images jointes (ticket + tous ses commentaires) - sinon
  // IMAGES_KV grossit indefiniment meme apres suppression d'un ticket (retour
  // utilisateur 14/08). Ne bloque jamais la suppression du ticket lui-meme
  // si ce nettoyage echoue (ticket deja "supprime" plus important que la
  // recuperation immediate de l'espace).
  try {
    const comments = await gh(env, `/issues/${number}/comments?per_page=100`);
    const relayOrigin = new URL(req.url).origin;
    const allText = [issue.body, ...comments.map(c => c.body)].filter(Boolean).join('\n');
    const ids = [...new Set(extractImageIds(allText, relayOrigin))];
    await Promise.all(ids.map(id => env.IMAGES_KV.delete(id)));
  } catch (e) { /* silencieux */ }

  const labels = [...new Set([...(issue.labels || []).map(l => l.name || l), 'supprimé'])];
  await gh(env, `/issues/${number}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed', labels }),
  });
  return json({ ok: true });
}

// ─── Repertoire des utilisateurs (USERS_KV) ───────────────────────────────
// Une entree par compte Garmin ayant deja ouvert Allure+ - seule visibilite
// possible pour l'admin sur une appli distribuee en .exe, sans autre canal
// de telemetrie. Permet aussi de couper l'acces (blocked) si l'executable
// venait a circuler hors du controle de l'admin. Cle KV = email en minuscules.
function userKey(email) {
  return `user:${String(email).trim().toLowerCase()}`;
}

async function handleUserPing(req, env) {
  const body = await req.json();
  requireFields(body, ['email']);
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const email = String(body.email).slice(0, 200).trim().toLowerCase();
  const displayName = body.displayName ? String(body.displayName).slice(0, 120).trim() : null;
  const now = new Date().toISOString();

  // Nouveau compte : acces tickets ferme par defaut (l'admin l'ouvre au cas
  // par cas depuis le tableau Utilisateurs) - sauf pour le compte admin
  // lui-meme (isAdmin, transmis par server.js qui seul connait ADMIN_EMAIL),
  // ouvert d'office. N'affecte jamais un compte deja existant (seule la
  // creation initiale du record lit ce champ).
  const key = userKey(email);
  const existing = await env.USERS_KV.get(key, { type: 'json' });
  const record = existing || { email, firstSeen: now, blocked: false, ticketAccess: !!body.isAdmin };
  record.lastSeen = now;
  if (displayName) record.displayName = displayName;
  await env.USERS_KV.put(key, JSON.stringify(record));
  return json({ blocked: !!record.blocked, ticketAccess: record.ticketAccess !== false });
}

// Endpoint volontairement leger (pas d'adminKey) : interroge en continu par
// chaque installation pour detecter rapidement un blocage decide en cours de
// session (voir server.js, checkBlockedAccounts) - une simple clientKey
// suffit, aucune donnee sensible exposee (juste un booleen).
async function handleUserStatus(req, env, email) {
  if (new URL(req.url).searchParams.get('clientKey') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  const record = await env.USERS_KV.get(userKey(email), { type: 'json' });
  return json({
    blocked: !!(record && record.blocked),
    ticketAccess: record ? record.ticketAccess !== false : true,
  });
}

async function handleListUsers(req, env, url) {
  if (url.searchParams.get('adminKey') !== env.ADMIN_KEY) throw { status: 401, message: 'Non autorisé' };
  const list = await env.USERS_KV.list({ prefix: 'user:' });
  const records = await Promise.all(list.keys.map(k => env.USERS_KV.get(k.name, { type: 'json' })));
  const users = records.filter(Boolean).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  return json({ users });
}

async function handleSetUserFlag(req, env, email, field) {
  const body = await req.json();
  if (String(body.adminKey || '') !== env.ADMIN_KEY) throw { status: 401, message: 'Non autorisé' };
  const key = userKey(email);
  const record = await env.USERS_KV.get(key, { type: 'json' });
  if (!record) throw { status: 404, message: 'Utilisateur introuvable' };
  record[field] = !!body[field];
  await env.USERS_KV.put(key, JSON.stringify(record));
  return json({ ok: true, [field]: record[field] });
}

// ─── Images jointes aux tickets (IMAGES_KV) ───────────────────────────────
// Simple stockage cle/valeur pour heberger une capture d'ecran et lui donner
// une URL publique stable, que GitHub affiche nativement en markdown dans le
// corps d'une issue/d'un commentaire - pas besoin d'API GitHub dediee aux
// pieces jointes (non accessible avec un simple PAT Issues).
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // large pour une capture compressee cote client

async function handleUploadImage(req, env) {
  const body = await req.json();
  requireFields(body, ['dataBase64', 'contentType']);
  if (String(body.clientKey || '') !== env.CLIENT_KEY) throw { status: 401, message: 'Client non autorisé' };
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(body.contentType)) throw { status: 400, message: "Type d'image non supporté" };
  let bytes;
  try {
    bytes = Uint8Array.from(atob(body.dataBase64), c => c.charCodeAt(0));
  } catch (e) {
    throw { status: 400, message: 'Image invalide' };
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw { status: 413, message: 'Image trop volumineuse' };
  const id = crypto.randomUUID();
  await env.IMAGES_KV.put(id, bytes, { metadata: { contentType: body.contentType } });
  const url = new URL(req.url);
  return json({ id, url: `${url.origin}/images/${id}` }, 201);
}

async function handleGetImage(env, id) {
  const { value, metadata } = await env.IMAGES_KV.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!value) return json({ message: 'Image introuvable' }, 404);
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['tickets', ':number'?, 'comments'|'status'?]

    try {
      if (parts[0] === 'users') {
        if (parts.length === 2 && parts[1] === 'ping' && req.method === 'POST') return await handleUserPing(req, env);
        if (parts.length === 1 && req.method === 'GET') return await handleListUsers(req, env, url);
        if (parts.length === 3 && parts[2] === 'status' && req.method === 'GET') return await handleUserStatus(req, env, decodeURIComponent(parts[1]));
        if (parts.length === 3 && parts[2] === 'block' && req.method === 'POST') return await handleSetUserFlag(req, env, decodeURIComponent(parts[1]), 'blocked');
        if (parts.length === 3 && parts[2] === 'ticket-access' && req.method === 'POST') return await handleSetUserFlag(req, env, decodeURIComponent(parts[1]), 'ticketAccess');
        return json({ message: 'Not found' }, 404);
      }

      if (parts[0] === 'images') {
        if (parts.length === 1 && req.method === 'POST') return await handleUploadImage(req, env);
        if (parts.length === 2 && req.method === 'GET') return await handleGetImage(env, parts[1]);
        return json({ message: 'Not found' }, 404);
      }

      if (parts[0] !== 'tickets') return json({ message: 'Not found' }, 404);

      if (parts.length === 1 && req.method === 'POST') return await handleCreateTicket(req, env);
      if (parts.length === 1 && req.method === 'GET') return await handleListTickets(req, env, url);

      const number = Number(parts[1]);
      if (!Number.isInteger(number) || number <= 0) return json({ message: 'Ticket invalide' }, 400);

      if (parts.length === 2 && req.method === 'GET') return await handleGetTicket(req, env, number, url);
      if (parts.length === 3 && parts[2] === 'comments' && req.method === 'POST') return await handleAddComment(req, env, number);
      if (parts.length === 3 && parts[2] === 'status' && req.method === 'POST') return await handleSetStatus(req, env, number);
      if (parts.length === 3 && parts[2] === 'privacy' && req.method === 'POST') return await handleSetPrivacy(req, env, number);
      if (parts.length === 3 && parts[2] === 'delete' && req.method === 'POST') return await handleDeleteTicket(req, env, number);

      return json({ message: 'Not found' }, 404);
    } catch (e) {
      const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
      return json({ message: e?.message || 'Erreur serveur' }, status);
    }
  },
};
