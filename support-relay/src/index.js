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
    message,
    `<!-- reporter:${email} -->`,
  ].filter(Boolean).join('\n\n');

  const issue = await gh(env, '/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body: issueBody, labels: [label] }),
  });
  return json({ ticket: summarizeIssue(issue, { includeReporter: true }) }, 201);
}

async function handleListTickets(req, env, url) {
  const email = (url.searchParams.get('email') || '').toLowerCase();
  const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
  const isAdmin = url.searchParams.get('adminKey') === env.ADMIN_KEY;

  const issues = await gh(env, '/issues?state=all&per_page=100&sort=updated');
  let tickets = issues
    .filter(i => !i.pull_request)
    .map(i => summarizeIssue(i, { includeReporter: scope === 'mine' || isAdmin }));

  if (scope === 'mine') {
    tickets = tickets.filter(t => t.reporterEmail === email);
  }
  return json({ tickets });
}

async function handleGetTicket(req, env, number) {
  const [issue, comments] = await Promise.all([
    gh(env, `/issues/${number}`),
    gh(env, `/issues/${number}/comments?per_page=100`),
  ]);
  const summary = summarizeIssue(issue, { includeReporter: true });
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
  const commentBody = `<!-- author:${marker} -->\n${message}`;
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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['tickets', ':number'?, 'comments'|'status'?]

    try {
      if (parts[0] !== 'tickets') return json({ message: 'Not found' }, 404);

      if (parts.length === 1 && req.method === 'POST') return await handleCreateTicket(req, env);
      if (parts.length === 1 && req.method === 'GET') return await handleListTickets(req, env, url);

      const number = Number(parts[1]);
      if (!Number.isInteger(number) || number <= 0) return json({ message: 'Ticket invalide' }, 400);

      if (parts.length === 2 && req.method === 'GET') return await handleGetTicket(req, env, number);
      if (parts.length === 3 && parts[2] === 'comments' && req.method === 'POST') return await handleAddComment(req, env, number);
      if (parts.length === 3 && parts[2] === 'status' && req.method === 'POST') return await handleSetStatus(req, env, number);

      return json({ message: 'Not found' }, 404);
    } catch (e) {
      const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
      return json({ message: e?.message || 'Erreur serveur' }, status);
    }
  },
};
