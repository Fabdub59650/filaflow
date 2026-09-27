/**
 * nfc.js — Service NFC pour ACR122U
 * - Écoute en permanence le lecteur
 * - Diffuse les scans via SSE aux clients connectés
 * - Lit l'UID et les données NDEF
 * - Écrit les infos filament sur la puce
 */

const db = require('./db');

// Chargement optionnel de nfc-pcsc — ne bloque pas le démarrage si absent
let NFC = null;
try {
  NFC = require('nfc-pcsc').NFC;
} catch (e) {
  console.warn('[NFC] nfc-pcsc non disponible :', e.message);
}

let nfcInstance   = null;
let lastCard      = null;        // Dernière carte détectée
let isAvailable   = false;       // Lecteur présent et opérationnel
let sseClients    = [];          // Clients SSE connectés
let currentReader = null;        // Référence au lecteur actif

// ── SSE : diffusion temps réel ──────────────────────────
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter(res => {
    try { res.write(msg); return true; }
    catch (_) { return false; }
  });
}

function addSseClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering Nginx
  res.flushHeaders();

  // Délai de reconnexion automatique du navigateur
  res.write('retry: 10000\n\n');

  // Envoyer l'état courant immédiatement
  res.write(`event: status\ndata: ${JSON.stringify({
    available: isAvailable,
    lastCard:  lastCard,
  })}\n\n`);

  // Keepalive toutes les 25s pour éviter timeout Nginx
  const keepalive = setInterval(() => {
    try { res.write(':keepalive\n\n'); }
    catch (_) { clearInterval(keepalive); }
  }, 25000);

  // Recyclage périodique de la connexion : le client se reconnecte aussitôt.
  // Évite qu'un flux sans fin bloque l'activation d'un nouveau service worker.
  const recycle = setTimeout(() => {
    try { res.write('event: bye\ndata: {}\n\n'); res.end(); } catch (_) {}
  }, parseInt(process.env.SSE_RECYCLE_MS) || 60000);

  sseClients.push(res);
  res.on('close', () => {
    clearTimeout(recycle);
    clearInterval(keepalive);
    sseClients = sseClients.filter(c => c !== res);
  });
}

// ── Formatage UID ───────────────────────────────────────
function formatUID(uid) {
  if (!uid) return null;
  if (Buffer.isBuffer(uid)) return uid.toString('hex').toUpperCase();
  return String(uid).toUpperCase().replace(/[^0-9A-F]/g, '');
}

// ── Données NDEF à écrire sur la puce ──────────────────
// Format simple : JSON encodé en texte dans un record NDEF Text
function buildNdefPayload(filament) {
  const data = {
    id:       filament.id,
    name:     filament.name,
    material: filament.material,
    color:    filament.color_name || '',
    brand:    filament.brand || '',
    weight:   Math.round(filament.weight_remaining || 0),
  };
  return JSON.stringify(data);
}

// Encoder un record NDEF Text (RFC 5646, lang=fr)
function encodeNdefText(text) {
  const lang    = 'fr';
  const langBuf = Buffer.from(lang, 'ascii');
  const textBuf = Buffer.from(text, 'utf8');
  const payload = Buffer.alloc(1 + langBuf.length + textBuf.length);
  payload[0]    = langBuf.length; // status byte : longueur de la langue
  langBuf.copy(payload, 1);
  textBuf.copy(payload, 1 + langBuf.length);

  // Record NDEF : MB=1, ME=1, SR=1, TNF=0x01 (Well-Known), type=T
  const typeField = Buffer.from('T');
  const header    = Buffer.alloc(4);
  header[0]       = 0xD1; // MB | ME | SR | TNF=Well-Known
  header[1]       = typeField.length;
  header[2]       = payload.length;
  const record    = Buffer.concat([header, typeField, payload]);

  // Message NDEF avec TLV
  const tlvLen = record.length < 0xFF ? 2 : 4;
  const tlv    = Buffer.alloc(tlvLen + record.length + 1);
  tlv[0]       = 0x03; // NDEF TLV
  if (record.length < 0xFF) {
    tlv[1]     = record.length;
    record.copy(tlv, 2);
    tlv[2 + record.length] = 0xFE; // Terminator TLV
  } else {
    tlv[1] = 0xFF;
    tlv.writeUInt16BE(record.length, 2);
    record.copy(tlv, 4);
    tlv[4 + record.length] = 0xFE;
  }
  return tlv;
}

// ── Encodeur format ELEGOO (Centauri Carbon 2) ───────────
// Source : https://github.com/DnG-Crafts/ELG-RFID
// Pages 4-15 : URI (optionnel, compatibilité smartphone)
// Pages 16-24 : données filament lues par l'imprimante

// ── Tables codes matière ELEGOO officiels ────────────────
// Source officielle : https://github.com/ELEGOO-3D/ELEGOO-RFID-Tag-Guide
//
// Page 18 = 4 bytes du code matière directement (big-endian 32 bits)
// Page 19 = sous-type encodé ASCII 4 bytes, paddé 0x00

// Codes matière officiels ELEGOO — 4 bytes sur page 18
const ELEGOO_MATERIAL = {
  'PLA':   [0x00, 0x80, 0x76, 0x65],  // 0x00807665
  'PETG':  [0x80, 0x69, 0x84, 0x71],  // 0x80698471
  'ABS':   [0x00, 0x65, 0x66, 0x83],  // 0x00656683
  'ASA':   [0x00, 0x65, 0x83, 0x65],  // 0x00658365
  'TPU':   [0x00, 0x84, 0x80, 0x85],  // 0x00848085
  'Nylon': [0x00, 0x00, 0x80, 0x65],  // 0x00008065 (PA)
  'PC':    [0x00, 0x00, 0x80, 0x67],  // 0x00008067
  'PVA':   [0x00, 0x80, 0x86, 0x65],  // 0x00808665
  'HIPS':  [0x00, 0x65, 0x66, 0x83],  // pas de code officiel → ABS
  'autre': [0x00, 0x80, 0x76, 0x65],  // fallback PLA
};

// Sous-types ELEGOO — codes numériques page 19
// VÉRIFIÉS sur puces originales ELEGOO :
//   PLA standard : [0x00, 0x00, 0x00, 0x00]
//   PLA+         : [0x00, 0x01, 0x00, 0x00]
//   PLA-CF       : [0x00, 0x04, 0x00, 0x00]
//   PLA Matte    : [0x00, 0x06, 0x00, 0x00]
//   PETG-CF      : [0x01, 0x01, 0x00, 0x00]
//   PETG-GF      : [0x01, 0x02, 0x00, 0x00]
//   TPU 95A      : [0x03, 0x01, 0x00, 0x00]
//   ASA standard : [0x08, 0x00, 0x00, 0x00]
// Familles : PLA=0x00, PETG=0x01, TPU=0x03, ASA=0x08
const ELEGOO_SUBTYPE = {
  'Standard':  [0x00, 0x00, 0x00, 0x00],  // ✓ vérifié
  // PLA — vérifiés
  'PLA+':      [0x00, 0x01, 0x00, 0x00],  // ✓ vérifié
  'PLA-CF':    [0x00, 0x04, 0x00, 0x00],  // ✓ vérifié
  'Matte':     [0x00, 0x06, 0x00, 0x00],  // ✓ vérifié
  // PLA — estimations
  'Silk':      [0x00, 0x03, 0x00, 0x00],  // ✓ vérifié
  'Rapid':     [0x00, 0x0A, 0x00, 0x00],  // ✓ vérifié (Rapid PLA+)
  // PETG — vérifiés
  'CF':        [0x01, 0x01, 0x00, 0x00],  // ✓ vérifié PETG-CF
  'PETG-CF':   [0x01, 0x01, 0x00, 0x00],  // ✓ vérifié
  'GF':        [0x01, 0x02, 0x00, 0x00],  // ✓ vérifié PETG-GF
  'PETG-GF':   [0x01, 0x02, 0x00, 0x00],  // ✓ vérifié
  // TPU — vérifié
  'TPU 95A':   [0x03, 0x01, 0x00, 0x00],  // ✓ vérifié
  'TPU 87A':   [0x03, 0x02, 0x00, 0x00],  // estimation
  // ASA — vérifié
  'ASA':       [0x08, 0x00, 0x00, 0x00],  // ✓ vérifié ASA standard
  'ASA-CF':    [0x08, 0x01, 0x00, 0x00],  // estimation
  // ABS, PA — estimations
  'ABS-CF':    [0x02, 0x01, 0x00, 0x00],
  'PA-CF':     [0x05, 0x01, 0x00, 0x00],
  'PA-GF':     [0x05, 0x02, 0x00, 0x00],
};

function buildElegooPayload(filament) {
  // Parser la couleur hex (#RRGGBB)
  const hex   = (filament.color_hex || '#cccccc').replace('#', '');
  const r     = parseInt(hex.slice(0,2), 16) || 0xCC;
  const g     = parseInt(hex.slice(2,4), 16) || 0xCC;
  const b     = parseInt(hex.slice(4,6), 16) || 0xCC;

  // Températures
  const tNozMin = parseInt(filament.temp_nozzle_min) || 190;
  const tNozMax = parseInt(filament.temp_nozzle_max) || 230;
  const tBedMin = parseInt(filament.temp_bed_min)    || 0;
  const tBedMax = parseInt(filament.temp_bed_max)    || 60;

  // Diamètre : valeur hex officielle ELEGOO (1.75mm → 0x00AF = 175)
  const diam   = Math.round((parseFloat(filament.diameter) || 1.75) * 100);
  // Poids en grammes (1000g → 0x03E8)
  const weight = parseInt(filament.weight_total) || 1000;

  // Code matière officiel ELEGOO (4 bytes → page 18 entière)
  const matCode = ELEGOO_MATERIAL[filament.material] || ELEGOO_MATERIAL['PLA'];

  // Sous-type ASCII 4 bytes → page 19 (Standard = 4x 0x00)
  const subCode = ELEGOO_SUBTYPE[filament.elegoo_subtype] || [0x00, 0x00, 0x00, 0x00];

  const pages = {};

  // ── Section URI (pages 4-15) — compatibilité smartphone ──
  pages[4]  = [0x01, 0x03, 0xA0, 0x0C];
  pages[5]  = [0x34, 0x03, 0x0F, 0xD1];
  pages[6]  = [0x01, 0x0B, 0x55, 0x04]; // URI record type "U", prefix https://
  pages[7]  = [0x65, 0x6C, 0x65, 0x67]; // "eleg"
  pages[8]  = [0x6F, 0x6F, 0x2E, 0x63]; // "oo.c"
  pages[9]  = [0x6F, 0x6D, 0xFE, 0x00]; // "om" + TLV terminator
  pages[10] = [0x00, 0x00, 0x00, 0x00];
  pages[11] = [0x00, 0x00, 0x00, 0x00];
  pages[12] = [0x00, 0x00, 0x00, 0x00];
  pages[13] = [0x00, 0x00, 0x00, 0x00];
  pages[14] = [0x00, 0x00, 0x00, 0x00];
  pages[15] = [0x00, 0x00, 0x00, 0x00];

  // ── Section filament (pages 16-24) — lue par l'imprimante ──
  // Basé sur le dump officiel PLA Elegoo Black 1KG
  pages[16] = [0x36, 0xEE, 0xEE, 0xEE]; // Header ELEGOO
  pages[17] = [0xEE, 0x00, 0x00, 0x00]; // Manufacturer ID (générique)

  // Page 18 : 4 bytes du code matière directement
  // PLA → [00,80,76,65] | PETG → [80,69,84,71] | ABS → [00,65,66,83]
  pages[18] = [matCode[0], matCode[1], matCode[2], matCode[3]];

  // Page 19 : sous-type encodé ASCII 4 bytes (Standard = 0x00000000)
  pages[19] = [subCode[0], subCode[1], subCode[2], subCode[3]];

  // Page 20 : couleur [R, G, B, 0xFF]
  // Dump officiel Black : [00, 00, 00, FF]
  pages[20] = [r, g, b, 0xFF];

  // Page 21 : températures buse [0x00, min_lo, min_hi, max_lo] (little-endian 16 bits)
  // Ex: ASA 240-260°C → [00, F0, 01, 04] : min=0x00F0=240, max=0x0104=260
  // Ex: PLA 190-230°C → [00, BE, 00, E6] : min=0x00BE=190, max=0x00E6=230
  pages[21] = [0x00, tNozMin & 0xFF, (tNozMin >> 8) & 0xFF, tNozMax & 0xFF];

  // Page 22 : températures plateau [0x00, min_lo, min_hi, max_lo]
  // Note: le byte max_hi est sur la page suivante (ignoré ici, toujours <256°C)
  pages[22] = [0x00, tBedMin & 0xFF, (tBedMin >> 8) & 0xFF, tBedMax & 0xFF];

  // Page 23 : diamètre + poids
  // Dump officiel 1.75mm / 1000g : [00, AF, 03, E8]
  // AF = 175 (1.75 × 100), 03E8 = 1000g big-endian
  pages[23] = [
    0x00,
    diam & 0xFF,
    (weight >> 8) & 0xFF,
    weight & 0xFF,
  ];

  // Page 24 : code production [00, 36, C8, 00] d'après dump officiel
  pages[24] = [0x00, 0x36, 0xC8, 0x00];

  return pages;
}

async function writeElegooFormat(filament) {
  if (!currentReader) throw new Error('Lecteur non disponible');
  if (!lastCard)      throw new Error('Posez la bobine sur le lecteur');

  const pages = buildElegooPayload(filament);
  const results = [];

  for (const [pageStr, data] of Object.entries(pages)) {
    const page = parseInt(pageStr);
    const buf  = Buffer.from(data);
    try {
      await currentReader.write(page, buf, 4);
      results.push({ page, ok: true });
    } catch (e) {
      results.push({ page, ok: false, error: e.message });
      throw new Error('Erreur écriture page ' + page + ' : ' + e.message);
    }
  }
  return results;
}

// ── Initialisation du démon NFC ─────────────────────────
function startNFC() {
  if (!NFC) {
    console.warn('[NFC] Bibliothèque nfc-pcsc non chargée — NFC désactivé');
    return;
  }

  // Intercepter les erreurs non catchées liées à nfc-pcsc
  // pour éviter de planter le processus principal
  const nfcErrHandler = (err) => {
    if (err && (err.message || '').includes('pcscd')) {
      console.warn('[NFC] Erreur pcscd ignorée :', err.message);
    }
  };
  process.on('uncaughtException', nfcErrHandler);

  try {
    nfcInstance = new NFC();

    nfcInstance.on('reader', reader => {
      console.log(`[NFC] Lecteur détecté : ${reader.reader.name}`);
      currentReader = reader;
      isAvailable   = true;
      broadcast('status', { available: true, reader: reader.reader.name });

      reader.on('card', async card => {
        const uid = formatUID(card.uid);
        console.log(`[NFC] Carte détectée : ${uid}`);
        lastCard = { uid, atr: card.atr?.toString('hex') };

        // Chercher si un filament est lié à cet UID
        let filament = null;
        try {
          const [[row]] = await db.query(
            'SELECT * FROM filaments WHERE nfc_uid=?', [uid]
          );
          filament = row || null;
        } catch (e) { console.error('[NFC] DB error:', e.message); }

        broadcast('card', { uid, filament });
      });

      reader.on('card.off', () => {
        lastCard = null;
        broadcast('card_removed', {});
      });

      reader.on('error', err => {
        console.error(`[NFC] Erreur lecteur : ${err.message}`);
        broadcast('error', { message: err.message });
      });

      reader.on('end', () => {
        console.log('[NFC] Lecteur déconnecté');
        currentReader = null;
        isAvailable   = false;
        broadcast('status', { available: false });
      });
    });

    nfcInstance.on('error', err => {
      console.error('[NFC] Erreur NFC :', err.message);
      isAvailable = false;
      broadcast('status', { available: false, error: err.message });
    });

  } catch (e) {
    console.warn('[NFC] Impossible d\'initialiser le lecteur NFC :', e.message);
    isAvailable = false;
  }
}

// ── API : routes NFC ────────────────────────────────────
function setupRoutes(router) {

  // GET /api/nfc/status — état du lecteur
  router.get('/status', (req, res) => {
    res.json({ available: isAvailable, lastCard });
  });

  // GET /api/nfc/events — flux SSE temps réel
  router.get('/events', (req, res) => {
    addSseClient(res);
  });

  // POST /api/nfc/link — lier l'UID actuel à un filament
  router.post('/link', async (req, res) => {
    try {
      const { filament_id, uid } = req.body;
      const targetUid = uid || (lastCard && lastCard.uid);
      if (!targetUid) return res.status(400).json({ error: 'Aucune carte détectée' });
      if (!filament_id) return res.status(400).json({ error: 'filament_id requis' });

      // Délier l'ancien filament qui avait cet UID
      await db.query("UPDATE filaments SET nfc_uid=NULL WHERE nfc_uid=?", [targetUid]);
      // Lier le nouveau
      await db.query("UPDATE filaments SET nfc_uid=? WHERE id=?", [targetUid, filament_id]);

      const [[filament]] = await db.query('SELECT * FROM filaments WHERE id=?', [filament_id]);
      broadcast('linked', { uid: targetUid, filament });
      res.json({ ok: true, uid: targetUid, filament });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/nfc/link/:filamentId — délier un filament
  router.delete('/link/:filamentId', async (req, res) => {
    try {
      await db.query("UPDATE filaments SET nfc_uid=NULL WHERE id=?", [req.params.filamentId]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/nfc/dump — lire les pages 16-24 de la puce (debug)
  router.get('/dump', async (req, res) => {
    try {
      if (!currentReader) return res.status(503).json({ error: 'Lecteur non disponible' });
      if (!lastCard)      return res.status(400).json({ error: 'Posez la bobine sur le lecteur' });
      const dump = [];
      for (let page = 16; page <= 24; page++) {
        const data = await currentReader.read(page, 4, 4);
        dump.push({
          page,
          hex: Array.from(data).map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(' '),
          bytes: Array.from(data),
        });
      }
      res.json({ uid: lastCard.uid, pages: dump });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/nfc/write-elegoo — écrire au format ELEGOO Centauri Carbon 2
  router.post('/write-elegoo', async (req, res) => {
    try {
      if (!currentReader) return res.status(503).json({ error: 'Lecteur non disponible' });
      if (!lastCard)      return res.status(400).json({ error: 'Posez la bobine sur le lecteur' });

      const { filament_id } = req.body;
      if (!filament_id) return res.status(400).json({ error: 'filament_id requis' });

      const [[filament]] = await db.query('SELECT * FROM filaments WHERE id=?', [filament_id]);
      if (!filament) return res.status(404).json({ error: 'Filament non trouvé' });

      const results = await writeElegooFormat(filament);
      const pagesWritten = results.filter(r => r.ok).length;

      // Enregistrer dans l'historique
      try {
        await db.query(
          `INSERT INTO nfc_write_history (filament_id, uid, format, material, subtype, color_hex)
           VALUES (?,?,?,?,?,?)`,
          [filament_id, lastCard.uid, 'elegoo',
           filament.material, filament.elegoo_subtype||null, filament.color_hex||null]
        );
      } catch(_) {}

      res.json({
        ok: true,
        pages_written: pagesWritten,
        filament: filament.name,
        uid: lastCard.uid,
        details: results,
      });
    } catch (e) {
      console.error('[NFC-ELEGOO] Erreur écriture :', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/nfc/write — écrire les infos filament sur la puce
  router.post('/write', async (req, res) => {
    try {
      if (!currentReader) return res.status(503).json({ error: 'Lecteur non disponible' });
      if (!lastCard) return res.status(400).json({ error: 'Posez la bobine sur le lecteur' });

      const { filament_id } = req.body;
      if (!filament_id) return res.status(400).json({ error: 'filament_id requis' });

      const [[filament]] = await db.query('SELECT * FROM filaments WHERE id=?', [filament_id]);
      if (!filament) return res.status(404).json({ error: 'Filament non trouvé' });

      const payload = buildNdefPayload(filament);
      const ndefMsg = encodeNdefText(payload);

      // Écriture par blocs de 4 octets (Mifare / NTAG)
      // Les données commencent au bloc 4 sur NTAG213/215/216
      const blockSize   = 4;
      const startBlock  = 4;
      const paddedLen   = Math.ceil(ndefMsg.length / blockSize) * blockSize;
      const padded      = Buffer.alloc(paddedLen);
      ndefMsg.copy(padded);

      for (let i = 0; i < paddedLen; i += blockSize) {
        const block     = Math.floor(i / blockSize) + startBlock;
        const blockData = padded.slice(i, i + blockSize);
        await currentReader.write(block, blockData, blockSize);
      }

      res.json({ ok: true, written: payload.length + ' octets', data: payload });
    } catch (e) {
      console.error('[NFC] Erreur écriture :', e.message);
      res.status(500).json({ error: 'Erreur écriture : ' + e.message });
    }
  });

  // GET /api/nfc/read — lire les données de la carte présente
  router.get('/read', async (req, res) => {
    try {
      if (!currentReader) return res.status(503).json({ error: 'Lecteur non disponible' });
      if (!lastCard) return res.status(400).json({ error: 'Aucune carte sur le lecteur' });

      // Lire les blocs 4 à 20 (64 octets, suffisant pour les données filament)
      const chunks = [];
      for (let block = 4; block < 20; block++) {
        try {
          const data = await currentReader.read(block, 4, 4);
          chunks.push(data);
        } catch (_) { break; }
      }
      const raw   = Buffer.concat(chunks);
      const uid   = lastCard.uid;

      // Parser le TLV NDEF
      let text = null;
      if (raw[0] === 0x03) {
        const len    = raw[1] === 0xFF ? raw.readUInt16BE(2) : raw[1];
        const offset = raw[1] === 0xFF ? 4 : 2;
        const ndef   = raw.slice(offset, offset + len);
        // Extraire le payload du record Text (sauter header + type + lang)
        if (ndef.length > 5) {
          const langLen = ndef[4] & 0x3F;
          text = ndef.slice(5 + langLen).toString('utf8');
        }
      }

      let parsedData = null;
      try { if (text) parsedData = JSON.parse(text); } catch (_) {}

      res.json({ uid, raw: raw.toString('hex'), text, data: parsedData });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/nfc/history/:filamentId — historique des écritures
  router.get('/history/:filamentId', async (req, res) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM nfc_write_history WHERE filament_id=? ORDER BY written_at DESC LIMIT 20',
        [req.params.filamentId]
      );
      res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = { startNFC, setupRoutes, getStatus: () => ({ available: isAvailable, lastCard }) };
