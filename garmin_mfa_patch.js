// garmin_mfa_patch.js
//
// Garmin exige parfois une confirmation par SMS (code a 6 chiffres) a la
// connexion (MFA/2FA sur le compte Garmin). La lib garmin-connect@1.6.2
// utilisee par cette appli NE GERE PAS ce cas : HttpClient.prototype.handleMFA
// est un no-op vide, laisse avec un commentaire "// TODO: Handle MFA" par
// l'auteur de la lib (verifie dans node_modules/garmin-connect/dist/common/
// HttpClient.js). La connexion echoue alors avec un message generique
// ("login failed (Ticket not found or MFA), please check username and
// password") qui ne permet jamais a l'utilisateur de saisir son code.
//
// Il existe une pull request ouverte (non fusionnee, non publiee sur npm)
// sur le depot de la lib qui implemente ce flux proprement. Plutot que de
// faire dependre Allure+ de cette branche non validee (ce qui obligerait
// TOUS les postes utilisateurs a compiler du TypeScript a l'installation,
// puisque l'installeur exclut node_modules et lance `npm install` en local -
// voir installer/allure-plus.iss), on reproduit ici SEULEMENT la logique
// MFA, sous forme de monkeypatch du prototype HttpClient partage par
// toutes les instances GarminConnect. Accessible par import profond car le
// package.json de la lib n'a pas de champ "exports" qui le bloquerait
// (verifie en direct).
//
// Le reste de l'enchainement OAuth (getOauth1Token, exchange) est reutilise
// TEL QUEL - ce sont des methodes deja existantes de la lib, deja utilisees
// avec succes par le flux de connexion normal (sans MFA) pour tous les
// autres utilisateurs. Seule l'etape "obtenir le ticket" est court-
// circuitee par Garmin quand le MFA est actif ; une fois le code verifie et
// le ticket obtenu, la suite est identique a une connexion normale.
const HttpClientModule = require('garmin-connect/dist/common/HttpClient');
const { HttpClient } = HttpClientModule;
const FormData = require('form-data');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

const CSRF_RE = /name="_csrf"\s+value="(.+?)"/;
const TICKET_RE = /ticket=([^"]+)"/;
// Fichier de diagnostic (voir dumpUnrecognizedLoginPage plus bas) - dans
// data/ comme le reste des fichiers proteges (jamais ecrase par
// l'installeur, jamais commite).
const DEBUG_DUMP_FILE = path.join(__dirname, 'data', 'garmin_login_debug.html');
// Meme constante que celle utilisee en interne par la lib pour ses propres
// requetes de connexion (dist/common/HttpClient.js) - Garmin sert une page
// differente selon le user-agent, on doit rester coherent avec le reste du
// flux deja effectue par la meme instance.
const USER_AGENT_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';

class GarminMfaRequiredError extends Error {
  constructor() {
    super('MFA verification required');
    this.name = 'GarminMfaRequiredError';
    this.mfaRequired = true;
  }
}

// Cookie jar minimal, en memoire, par instance (21/08 - cause racine reelle
// du MFA qui ne se declenchait jamais, confirmee sur le HTML de diagnostic
// capture chez un collegue : compte AVEC MFA active cote Garmin (confirme -
// il doit saisir un code SMS en se connectant sur connect.garmin.com dans un
// vrai navigateur), mais la reponse Allure+ ressemblait a un tout premier
// chargement de la page de connexion, sans aucune trace de MFA ni d'erreur).
// HttpClient.js n'a AUCUNE gestion de cookies (verifie : zero occurrence de
// "cookie" dans le fichier) - son client HTTP est un axios.create() nu, qui
// contrairement a un vrai navigateur ne persiste PAS les cookies entre deux
// requetes Node. Le flux de connexion enchaine pourtant plusieurs requetes
// (GET page de connexion, GET jeton CSRF, POST identifiant/mot de passe) que
// Garmin relie normalement via un cookie de session. Sur un compte SANS MFA
// ca ne se voit jamais : Garmin delivre le ticket des la 3e requete, le
// jeton CSRF seul suffit a valider la demande en un coup. Mais le flux MFA a
// BESOIN de cette continuite de session entre "la requete qui soumet le mot
// de passe" et, plus tard, "la requete qui soumettra le code SMS" - sans
// cookie transmis, Garmin ne reconnait pas la 2e requete comme faisant
// partie de la meme connexion et retombe sur la page de connexion vierge.
// Scope volontairement simple (nom=valeur seulement, ignore domaine/path/
// expiration/secure) : tout le flux reste sur le meme hote SSO Garmin et
// dure quelques secondes, un vrai jar (tough-cookie) serait disproportionne
// pour ce besoin.
function installCookieJar(client) {
  if (client._cookieJarInstalled) return;
  client._cookieJarInstalled = true;
  const jar = {};

  function captureSetCookie(headers) {
    const setCookie = headers && headers['set-cookie'];
    if (!Array.isArray(setCookie)) return;
    setCookie.forEach((sc) => {
      const eq = sc.indexOf('=');
      if (eq <= 0) return;
      const semi = sc.indexOf(';');
      const name = sc.slice(0, eq).trim();
      const value = sc.slice(eq + 1, semi > eq ? semi : undefined).trim();
      jar[name] = value;
    });
  }

  client.interceptors.request.use((config) => {
    const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) {
      config.headers = config.headers || {};
      config.headers['Cookie'] = cookieHeader;
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => { captureSetCookie(response.headers); return response; },
    (error) => {
      if (error && error.response) captureSetCookie(error.response.headers);
      return Promise.reject(error);
    }
  );
}

// Installe le jar des la construction (avant la toute premiere requete du
// flux, step1 de getLoginTicket, qui appelle this.client.get(...) EN DIRECT
// sans passer par HttpClient.prototype.get) - impossible d'intercepter
// "this.client = axios.create()" en ne patchant que des methodes du
// prototype, d'ou cette sous-classe qui enveloppe le constructeur. Reste
// entierement transparent pour handleMFA/resumeWithMfa ci-dessus (heritees
// normalement via la chaine de prototypes) et pour le flux normal sans MFA
// (n'ajoute qu'un header Cookie, ignore silencieusement quand le jar est
// vide).
class HttpClientWithCookies extends HttpClient {
  constructor(url) {
    super(url);
    installCookieJar(this.client);
  }
}
// Reaffecte sur l'OBJET module.exports partage (jamais une const locale) :
// GarminConnect.js (dist/garmin/GarminConnect.js) fait `new HttpClient_1.
// HttpClient(this.url)`, une lecture de propriete EN DIRECT sur ce meme
// objet a chaque connexion - pas une valeur figee a son propre require()
// initial - donc cette reaffectation est bien prise en compte meme si
// GarminConnect.js a deja ete charge avant ce patch (c'est le cas : server.js
// charge 'garmin-connect' avant ce fichier).
HttpClientModule.HttpClient = HttpClientWithCookies;

// Diagnostic (21/08) : premier retour utilisateur reel contre un compte
// MFA (collegue, jamais teste avant faute de compte de test disponible - cf
// note en tete de fichier) et la detection ci-dessous n'a PAS reconnu la
// page comme MFA (message generique "Ticket not found or MFA" renvoye tel
// quel a l'utilisateur, cf /api/setup dans server.js) - la detection a donc
// ete ecrite par retro-ingenierie d'une PR non fusionnee, sur un HTML jamais
// verifie contre un vrai defi MFA Garmin. Plutot que de re-deviner a
// l'aveugle une deuxieme fois (risque de regression sur les comptes SANS
// MFA qui fonctionnent deja en production si le motif est trop large - une
// simple sous-chaine "mfa" insensible a la casse peut apparaitre dans un
// blob JS/JSON de config sans rapport), on capture le HTML reel recu quand
// ni la detection MFA ni le ticket normal ne matchent, pour ajuster ce
// motif avec des preuves plutot qu'une hypothese. Fichier ecrase a chaque
// nouvelle tentative (pas d'accumulation) - purement local, jamais envoye
// nulle part, jamais commite (voir .gitignore).
function dumpUnrecognizedLoginPage(htmlStr) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_DUMP_FILE), { recursive: true });
    fs.writeFileSync(DEBUG_DUMP_FILE, htmlStr, 'utf8');
    console.log('[MFA] Page de connexion non reconnue (ni MFA, ni ticket normal) - HTML sauvegarde dans', DEBUG_DUMP_FILE);
  } catch (e) { /* diagnostic best-effort, ne doit jamais faire echouer la connexion */ }
}

// Remplace le no-op de la lib. Appelee par HttpClient.prototype.getLoginTicket
// (code interne de la lib, inchange) juste apres la soumission du formulaire
// identifiant/mot de passe, avec le HTML de la reponse Garmin.
HttpClient.prototype.handleMFA = function (htmlStr) {
  const isMfaPage = htmlStr.includes('verifyMFA') || htmlStr.includes('setupEnterMfaCode') || htmlStr.includes('mfa-code');
  if (!isMfaPage) {
    if (!TICKET_RE.test(htmlStr)) dumpUnrecognizedLoginPage(htmlStr);
    return;
  }

  const csrfMatch = CSRF_RE.exec(htmlStr);
  // Meme URL que celle utilisee pour poster identifiant/mot de passe
  // (step3Url, prive dans getLoginTicket) - reconstruite ici a l'identique
  // plutot que capturee depuis cette variable locale non exposee : elle ne
  // depend que de this.url (constant pour toute la session), donc
  // strictement reproductible.
  const signinParams = {
    id: 'gauth-widget', embedWidget: true, clientId: 'GarminConnect', locale: 'en',
    gauthHost: this.url.GARMIN_SSO_EMBED, service: this.url.GARMIN_SSO_EMBED,
    source: this.url.GARMIN_SSO_EMBED,
    redirectAfterAccountLoginUrl: this.url.GARMIN_SSO_EMBED,
    redirectAfterAccountCreationUrl: this.url.GARMIN_SSO_EMBED,
  };
  const signinUrl = `${this.url.SIGNIN_URL}?${qs.stringify(signinParams)}`;

  this._mfaLoginState = { csrf: csrfMatch ? csrfMatch[1] : null, signinUrl };
  throw new GarminMfaRequiredError();
};

// Termine la connexion apres que handleMFA a leve GarminMfaRequiredError.
// Doit etre appelee sur la MEME instance GarminConnect/HttpClient que celle
// qui a essuye l'erreur (l'etat _mfaLoginState et la session HTTP en cours
// vivent dessus) - jamais une instance fraichement recreee.
HttpClient.prototype.resumeWithMfa = async function (mfaCode) {
  if (!this._mfaLoginState) {
    throw new Error('Aucune connexion MFA en attente - relancez la connexion.');
  }
  if (!this.OAUTH_CONSUMER) {
    await this.fetchOauthConsumer();
  }
  const { csrf, signinUrl } = this._mfaLoginState;

  // Meme construction (form-data + Content-Type urlencoded declare) que le
  // POST identifiant/mot de passe de la lib (getLoginTicket, step3) - garder
  // exactement le meme motif meme s'il semble incoherent (multipart produit,
  // urlencoded declare) : c'est ce motif qui fonctionne deja en production
  // pour la connexion normale, donc le plus sur a reproduire a l'identique.
  const mfaForm = new FormData();
  mfaForm.append('mfa-code', mfaCode);
  mfaForm.append('embed', 'true');
  mfaForm.append('_csrf', csrf);
  mfaForm.append('fromPage', 'setupEnterMfaCode');

  const mfaResult = await this.post(signinUrl, mfaForm, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Dnt: 1,
      Origin: this.url.GARMIN_SSO_ORIGIN,
      Referer: signinUrl,
      'User-Agent': USER_AGENT_BROWSER,
    },
  });

  const ticketMatch = TICKET_RE.exec(mfaResult);
  if (!ticketMatch) {
    throw new Error('Code de vérification incorrect ou expiré.');
  }
  const ticket = ticketMatch[1];
  this._mfaLoginState = undefined;

  // Suite identique a une connexion normale (dist/common/HttpClient.js,
  // HttpClient.prototype.login) - memes methodes, deja fonctionnelles.
  const oauth1 = await this.getOauth1Token(ticket);
  await this.exchange(oauth1);
  return this;
};

// Meme API que la lib expose deja pour .login() (GarminConnect.login()
// delegue a this.client.login()) - simple confort d'appel cote server.js
// (gc.resumeWithMfa(code) plutot que gc.client.resumeWithMfa(code)).
const GarminConnectModule = require('garmin-connect/dist/garmin/GarminConnect');
const GarminConnectClass = GarminConnectModule.default;
GarminConnectClass.prototype.resumeWithMfa = async function (mfaCode) {
  await this.client.resumeWithMfa(mfaCode);
  return this;
};

module.exports = { GarminMfaRequiredError };
