/**
 * elegoo.js — Format RFID ELEGOO (Centauri Carbon 2) sur NTAG213/215
 *
 * Sources croisées :
 *   - https://github.com/Savion/elegoo-rfid-editor  (src/lib/materials.ts, ElegooSpool.ts)
 *   - https://github.com/DnG-Crafts/ELG-RFID         (table des pages 16-24)
 *   - Puces originales ELEGOO relues avec le lecteur ACR122U
 *
 * Section filament (pages 16-24, offsets octets 0x40-0x63) :
 *   p16  36 EE EE EE          en-tête
 *   p17  EE 00 00 00          identifiant fabricant
 *   p18  code matière          32 bits big-endian
 *   p19  sous-type             16 bits big-endian (famille << 8 | variante) + 00 00
 *   p20  R G B FF              couleur + modificateur
 *   p21  tMin tMax             températures buse, 2 × 16 bits big-endian
 *   p22  00 00 00 00           inconnu (plateau ?) — laissé à zéro comme sur les puces d'origine
 *   p23  diamètre poids        2 × 16 bits big-endian (175 = 1,75 mm ; grammes)
 *   p24  00 36 C8 00           code de production (valeur relevée sur puce d'origine)
 */

// Codes matière officiels (page 18)
const MATERIALS = {
  PLA:  0x00807665,
  PETG: 0x80698471,
  ABS:  0x00656683,
  TPU:  0x00848085,
  PA:   0x00008065,
  CPE:  0x00678069,
  PC:   0x00008067,
  PVA:  0x00808665,
  ASA:  0x00658365,
  BVOH: 0x42564F48,
  EVA:  0x00455641,
  HIPS: 0x48495053,
  PP:   0x00005050,
  PPA:  0x00505041,
  PPS:  0x00505053,
};

// Famille de chaque matière (octet haut du sous-type)
const FAMILIES = {
  PLA: 0x00, PETG: 0x01, ABS: 0x02, TPU: 0x03, PA: 0x04, CPE: 0x05, PC: 0x06, PVA: 0x07,
  ASA: 0x08, BVOH: 0x09, EVA: 0x0A, HIPS: 0x0B, PP: 0x0C, PPA: 0x0D, PPS: 0x0E,
};

// Sous-types (page 19). hidden = écrit sur la puce mais non affiché par la CC2.
const SUBTYPES = [
  [0x0000, 'PLA'], [0x0001, 'PLA+'], [0x0002, 'PLA Pro'], [0x0003, 'PLA Silk'], [0x0004, 'PLA-CF'],
  [0x0005, 'PLA Carbon', true], [0x0006, 'PLA Matte'], [0x0007, 'PLA Fluo'], [0x0008, 'PLA Wood'],
  [0x0009, 'PLA Basic'], [0x000A, 'RAPID PLA+'], [0x000B, 'PLA Marble'], [0x000C, 'PLA Galaxy'],
  [0x000D, 'PLA Red Copper'], [0x000E, 'PLA Sparkle', true],
  [0x0100, 'PETG'], [0x0101, 'PETG-CF'], [0x0102, 'PETG-GF'], [0x0103, 'PETG Pro', true],
  [0x0104, 'PETG Translucent'], [0x0105, 'RAPID PETG'],
  [0x0200, 'ABS'], [0x0201, 'ABS-GF', true],
  [0x0300, 'TPU'], [0x0301, 'TPU 95A'], [0x0302, 'RAPID TPU 95A'],
  [0x0400, 'PA'], [0x0401, 'PA-CF', true], [0x0403, 'PAHT-CF'], [0x0404, 'PA6', true],
  [0x0405, 'PA6-CF', true], [0x0406, 'PA12', true], [0x0407, 'PA12-CF', true],
  [0x0500, 'CPE'],
  [0x0600, 'PC'], [0x0601, 'PCTG', true], [0x0602, 'PC-FR'],
  [0x0700, 'PVA'], [0x0800, 'ASA'], [0x0900, 'BVOH'], [0x0A00, 'EVA'], [0x0B00, 'HIPS'],
  [0x0C00, 'PP'], [0x0C01, 'PP-CF', true], [0x0C02, 'PP-GF', true],
  [0x0D00, 'PPA'], [0x0D01, 'PPA-CF', true], [0x0D02, 'PPA-GF', true],
  [0x0E00, 'PPS'], [0x0E02, 'PPS-CF', true],
].map(([code, name, hidden]) => ({ code, name, family: code >> 8, hidden: !!hidden }));

const SUBTYPE_BY_NAME = Object.fromEntries(SUBTYPES.map(s => [s.name.toLowerCase(), s]));
const SUBTYPE_BY_CODE = Object.fromEntries(SUBTYPES.map(s => [s.code, s]));
const MATERIAL_BY_CODE = Object.fromEntries(Object.entries(MATERIALS).map(([n, c]) => [c >>> 0, n]));

// Matière FilaFlow → matière ELEGOO
function elegooMaterialName(material) {
  if (material === 'Nylon') return 'PA';
  if (MATERIALS[material] !== undefined) return material;
  return null; // 'autre' ou inconnue
}

// Liste exposée au frontend : { PLA: [{name, hidden}], ... } (variante de base exclue)
function subtypesByMaterial() {
  const out = {};
  for (const [mat, fam] of Object.entries(FAMILIES)) {
    out[mat] = SUBTYPES.filter(s => s.family === fam && s.name !== mat)
      .map(s => ({ name: s.name, hidden: s.hidden }));
  }
  out.Nylon = out.PA;
  return out;
}

const be16 = v => [(v >> 8) & 0xFF, v & 0xFF];
const be32 = v => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
const clamp16 = v => Math.max(0, Math.min(0xFFFF, Math.round(v)));

/**
 * Construit les pages à écrire. Renvoie { pages, warnings, resolved }.
 */
function encode(filament) {
  const warnings = [];
  let mat = elegooMaterialName(filament.material);
  if (!mat) {
    warnings.push('Matière « ' + filament.material + ' » sans équivalent ELEGOO : codée en PLA.');
    mat = 'PLA';
  }
  const family = FAMILIES[mat];

  // Sous-type : doit appartenir à la famille de la matière, sinon variante de base
  let sub = SUBTYPE_BY_CODE[family << 8];
  if (filament.elegoo_subtype) {
    const wanted = SUBTYPE_BY_NAME[String(filament.elegoo_subtype).toLowerCase()];
    if (!wanted) {
      warnings.push('Sous-type « ' + filament.elegoo_subtype + ' » inconnu : variante standard utilisée.');
    } else if (wanted.family !== family) {
      warnings.push('Sous-type « ' + wanted.name + ' » incompatible avec ' + mat + ' : variante standard utilisée.');
    } else {
      sub = wanted;
    }
  }
  if (sub.hidden) warnings.push('« ' + sub.name + ' » est écrit sur la puce mais n\'est pas affiché par la Centauri Carbon 2.');

  const hex = String(filament.color_hex || '#cccccc').replace('#', '');
  const rgb = [0, 2, 4].map(i => { const v = parseInt(hex.slice(i, i + 2), 16); return isNaN(v) ? 0xCC : v; });
  const tMin   = clamp16(parseInt(filament.temp_nozzle_min) || 190);
  const tMax   = clamp16(parseInt(filament.temp_nozzle_max) || 230);
  const diam   = clamp16((parseFloat(filament.diameter) || 1.75) * 100);
  const weight = clamp16(parseFloat(filament.weight_total) || 1000);

  const pages = {
    // Section URI (pages 4-15) — ouvre elegoo.com sur un smartphone
    4:  [0x01, 0x03, 0xA0, 0x0C],
    5:  [0x34, 0x03, 0x0F, 0xD1],
    6:  [0x01, 0x0B, 0x55, 0x04],
    7:  [0x65, 0x6C, 0x65, 0x67],
    8:  [0x6F, 0x6F, 0x2E, 0x63],
    9:  [0x6F, 0x6D, 0xFE, 0x00],
    10: [0, 0, 0, 0], 11: [0, 0, 0, 0], 12: [0, 0, 0, 0],
    13: [0, 0, 0, 0], 14: [0, 0, 0, 0], 15: [0, 0, 0, 0],
    // Section filament (pages 16-24)
    16: [0x36, 0xEE, 0xEE, 0xEE],
    17: [0xEE, 0x00, 0x00, 0x00],
    18: be32(MATERIALS[mat]),
    19: [...be16(sub.code), 0x00, 0x00],
    20: [rgb[0], rgb[1], rgb[2], 0xFF],
    21: [...be16(tMin), ...be16(tMax)],
    22: [0x00, 0x00, 0x00, 0x00],
    23: [...be16(diam), ...be16(weight)],
    24: [0x00, 0x36, 0xC8, 0x00],
  };
  return { pages, warnings, resolved: { material: mat, subtype: sub.name, hidden: sub.hidden } };
}

/**
 * Décode les pages 16-24 lues sur une puce. pagesBytes : { 16: [4 octets], ... }
 */
function decode(pagesBytes) {
  const p = n => pagesBytes[n] || [0, 0, 0, 0];
  const u16 = (a, i) => (a[i] << 8) | a[i + 1];
  const header = p(16);
  const isElegoo = header[0] === 0x36 && header[1] === 0xEE;
  const matCode = ((p(18)[0] << 24) | (p(18)[1] << 16) | (p(18)[2] << 8) | p(18)[3]) >>> 0;
  const subCode = u16(p(19), 0);
  const sub = SUBTYPE_BY_CODE[subCode];
  const c = p(20);
  return {
    elegoo: isElegoo,
    material: MATERIAL_BY_CODE[matCode] || null,
    material_code: '0x' + matCode.toString(16).padStart(8, '0').toUpperCase(),
    subtype: sub ? sub.name : null,
    subtype_code: '0x' + subCode.toString(16).padStart(4, '0').toUpperCase(),
    subtype_hidden: sub ? sub.hidden : false,
    color_hex: '#' + [c[0], c[1], c[2]].map(v => v.toString(16).padStart(2, '0')).join(''),
    temp_nozzle_min: u16(p(21), 0),
    temp_nozzle_max: u16(p(21), 2),
    diameter: u16(p(23), 0) / 100,
    weight: u16(p(23), 2),
  };
}

module.exports = { MATERIALS, FAMILIES, SUBTYPES, subtypesByMaterial, encode, decode, elegooMaterialName };
