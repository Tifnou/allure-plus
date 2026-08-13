// Synchro des fichiers binaires (avatar, certificats de course, PDF PPS) -
// module distinct de sync.js car la logique differe fondamentalement des
// collections JSON : pas de fusion par champ possible sur un binaire (PDF,
// JPEG...), seule la comparaison hash+date de modification a un sens, et le
// relais (sync-relay/) arbitre lui-meme les conflits (rejette une ecriture
// plus ancienne que ce qu'il a deja).
//
// Limite assumee (coherente avec la politique deja documentee dans sync.js -
// "dernier ecrit gagne, pas de resolution de conflit manuelle") : si une
// suppression de fichier echoue a atteindre le relais (ex: coupure reseau
// pile a ce moment, process tue avant la fin de l'appel) et qu'aucune autre
// action ne retouche ce fichier sur cet appareil, une reconciliation
// ulterieure pourrait re-telecharger l'ancien fichier depuis le cloud. Cas
// rare (fenetre de quelques secondes), non traite par une file d'attente
// persistante - disproportionne pour un usage a 2 appareils.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const syncClient = require('./sync_client');

const UPLOADS_DIR = path.join(__dirname, 'uploads');

function fileHashAndMtime(filepath) {
  const buf = fs.readFileSync(filepath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const mtimeMs = Math.round(fs.statSync(filepath).mtimeMs);
  return { buf, hash, mtimeMs };
}

async function downloadNamedFile(email, filename) {
  const result = await syncClient.downloadFile(email, filename);
  if (!result) return false; // rien a rapatrier (jamais existe ou supprime cote cloud)
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), result.buffer);
  if (result.mtimeMs) {
    try { fs.utimesSync(path.join(UPLOADS_DIR, filename), new Date(), new Date(result.mtimeMs)); } catch (e) {}
  }
  return true;
}

// Pousse ou tire un fichier nomme selon lequel est le plus recent - a
// appeler juste apres chaque ecriture/upload local d'un fichier synchronise
// (certificat de course, PDF PPS...), ET lors d'une reconciliation complete
// pour rapatrier ce qu'un autre appareil a deja synchronise.
async function syncNamedFile(email, filename) {
  if (!syncClient.isConfigured() || !email || !filename) return;
  try {
    const localPath = path.join(UPLOADS_DIR, filename);
    if (fs.existsSync(localPath)) {
      const { buf, hash, mtimeMs } = fileHashAndMtime(localPath);
      const result = await syncClient.uploadFile(email, filename, buf, hash, mtimeMs);
      if (result && result.applied === false) {
        // Le relais a rejete l'ecriture (version distante plus recente) -
        // on rapatrie cette version-la a la place.
        await downloadNamedFile(email, filename);
      }
    } else {
      await downloadNamedFile(email, filename);
    }
  } catch (e) {
    console.error(`[sync] fichier ${filename} echoue:`, e.message);
  }
}

async function deleteNamedFile(email, filename) {
  if (!syncClient.isConfigured() || !email || !filename) return;
  try { await syncClient.deleteFile(email, filename); }
  catch (e) { console.error(`[sync] suppression ${filename} echouee:`, e.message); }
}

// ─── Avatar : cas particulier ────────────────────────────────────────────
// Slot logique UNIQUE mais nom de fichier variable selon l'extension
// (avatar.jpg, avatar.png...) - il faut garantir qu'un seul avatar.* existe
// apres synchro, jamais deux extensions simultanement (contrairement aux
// certificats/PDF, dont le nom est stable et unique par id).
function findLocalAvatarFile() {
  try { return fs.readdirSync(UPLOADS_DIR).find(f => /^avatar\.[a-z0-9]+$/i.test(f)) || null; }
  catch (e) { return null; }
}

async function syncAvatarFile(email) {
  if (!syncClient.isConfigured() || !email) return;
  try {
    const manifest = await syncClient.pullFileManifest(email);
    const remoteEntries = Object.entries(manifest).filter(([name]) => /^avatar\.[a-z0-9]+$/i.test(name));
    const remoteLatest = remoteEntries
      .filter(([, meta]) => !meta.deletedAt)
      .sort((a, b) => (b[1].mtimeMs || 0) - (a[1].mtimeMs || 0))[0];

    const localFilename = findLocalAvatarFile();
    const localMeta = localFilename ? fileHashAndMtime(path.join(UPLOADS_DIR, localFilename)) : null;

    if (localMeta && (!remoteLatest || localMeta.mtimeMs > remoteLatest[1].mtimeMs)) {
      // Local plus recent (ou rien cote cloud) -> pousser, et supprimer
      // cote cloud toute AUTRE extension deja presente (superseee).
      await syncClient.uploadFile(email, localFilename, localMeta.buf, localMeta.hash, localMeta.mtimeMs);
      for (const [name] of remoteEntries) {
        if (name !== localFilename) await syncClient.deleteFile(email, name).catch(() => {});
      }
    } else if (remoteLatest && (!localMeta || remoteLatest[1].mtimeMs > localMeta.mtimeMs)) {
      // Cloud plus recent -> rapatrier, et supprimer localement toute AUTRE
      // extension existante (superseee).
      const [remoteFilename] = remoteLatest;
      const dl = await syncClient.downloadFile(email, remoteFilename);
      if (dl) {
        if (localFilename && localFilename !== remoteFilename) {
          try { fs.unlinkSync(path.join(UPLOADS_DIR, localFilename)); } catch (e) {}
        }
        fs.writeFileSync(path.join(UPLOADS_DIR, remoteFilename), dl.buffer);
      }
    }
    // sinon : local et distant deja identiques (meme mtime) ou rien nulle
    // part -> rien a faire.
  } catch (e) {
    console.error('[sync] avatar echoue:', e.message);
  }
}

// ─── Certificats de course / PDF PPS ─────────────────────────────────────
// La liste des fichiers a synchroniser se DEDUIT des entrees races.json/
// pps.json actuelles (deja reconciliees a ce stade), jamais d'un scan brut
// de uploads/ - un fichier reference par aucune entree active n'a pas a
// etre resynchronise (evite de ressusciter un fichier orphelin).
async function syncRaceCertificates(email, races) {
  for (const race of races || []) {
    if (race.certificateFile) await syncNamedFile(email, race.certificateFile);
  }
}
async function syncPpsFiles(email, ppsList) {
  for (const entry of ppsList || []) {
    if (entry.filename) await syncNamedFile(email, entry.filename);
  }
}

module.exports = { syncNamedFile, deleteNamedFile, syncAvatarFile, syncRaceCertificates, syncPpsFiles };
