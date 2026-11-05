#!/usr/bin/env node
/*
 * Builds choice-data.json for the CHOICE page.
 *
 *   node scripts/build-choice-data.mjs [--src all.csv] [--rounds r1.csv,r2.csv] [--out choice-data.json] [--report match-report.txt]
 *
 * - Reads the private source file (all.csv, or 1.csv if that is the name used) and the institute names of the counselling-round CSVs
 *   (r1.csv, r2.csv, ... = the existing institute database).
 * - Fuzzy-matches institutes conservatively. An institute that cannot be matched with confidence is left out.
 * - Writes ONLY: institute name (as spelled in the existing database) -> [stipend year 1, bond, penalty, beds].
 *   The raw 1.csv is never copied anywhere and is not part of the published site.
 * Plain Node (>= 18), no dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---------------- tunables ---------------- */
export const MIN_SCORE = 0.85;        // weighted token similarity needed to accept a match
export const AMBIGUITY_GAP = 0.05;    // a second, different candidate this close to the best => ambiguous => excluded
const GENERIC_W = 0.4;                // weight of generic words (hospital, college, government ...)

/* ---------------- CSV ---------------- */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const nl = text.search(/\r|\n/), first = nl < 0 ? text : text.slice(0, nl);
  const cnt = ch => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  let delim = ',', best = -1;
  for (const d of [',', '\t', ';']) { const n = cnt(d); if (n > best) { best = n; delim = d; } }
  const rows = []; let row = [], f = '', inQ = false, i = 0; const L = text.length;
  while (i < L) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } inQ = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"' && f === '') { inQ = true; i++; continue; }
    if (c === delim) { row.push(f); f = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(f); f = '';
      if (row.length > 1 || row[0].trim() !== '') rows.push(row);
      row = []; if (c === '\r' && text[i + 1] === '\n') i++; i++; continue;
    }
    f += c; i++;
  }
  if (f !== '' || row.length) { row.push(f); if (row.length > 1 || row[0].trim() !== '') rows.push(row); }
  return rows;
}
const hkey = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------------- value parsing (missing values stay null, never 0) ---------------- */
export function parseMoney(s) {
  const t = String(s ?? '').replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}
export function parseCount(s) {
  const t = String(s ?? '').replace(/[,\s]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/* ---------------- name normalisation ---------------- */
const STATES = {
  'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', 'assam': 'AS', 'bihar': 'BR', 'chhattisgarh': 'CG', 'goa': 'GA',
  'gujarat': 'GJ', 'haryana': 'HR', 'himachal pradesh': 'HP', 'jharkhand': 'JH', 'karnataka': 'KA', 'kerala': 'KL',
  'madhya pradesh': 'MP', 'maharashtra': 'MH', 'manipur': 'MN', 'meghalaya': 'ML', 'mizoram': 'MZ', 'nagaland': 'NL',
  'odisha': 'OD', 'orissa': 'OD', 'punjab': 'PB', 'rajasthan': 'RJ', 'sikkim': 'SK', 'tamil nadu': 'TN',
  'telangana': 'TS', 'tripura': 'TR', 'uttar pradesh': 'UP', 'uttarakhand': 'UK', 'west bengal': 'WB',
  'jammu and kashmir': 'JK', 'jammu & kashmir': 'JK', 'ladakh': 'LA', 'puducherry': 'PY', 'pondicherry': 'PY',
  'chandigarh': 'CH', 'andaman and nicobar islands': 'AN', 'dadra and nagar haveli': 'DN', 'daman and diu': 'DD',
  'lakshadweep': 'LD'
};
// Short codes that appear as a trailing ",AP" / ",TEL" segment in the abbreviated source names.
const CODES = { ap: 'AP', up: 'UP', mp: 'MP', tn: 'TN', tel: 'TS', ts: 'TS', wb: 'WB', hp: 'HP', jk: 'JK', uk: 'UK', cg: 'CG',
  hr: 'HR', pb: 'PB', rj: 'RJ', gj: 'GJ', mh: 'MH', ka: 'KA', kar: 'KA', kl: 'KL', od: 'OD', br: 'BR', jh: 'JH', as: 'AS', blr: 'KA' };
const STATE_CODE_OF = n => STATES[String(n).toLowerCase().trim()] || null;

const ABBR = {
  hosp: 'hospital', hos: 'hospital', hospt: 'hospital', hospl: 'hospital', hospitals: 'hospital', hsp: 'hospital',
  med: 'medical', medi: 'medical', medcoll: 'medical college', medcol: 'medical college',
  col: 'college', coll: 'college', colg: 'college', colleges: 'college',
  govt: 'government', gov: 'government', gvt: 'government', goverment: 'government', govermnent: 'government',
  dist: 'district', distt: 'district', distr: 'district', dis: 'district',
  gen: 'general', genl: 'general',
  ss: 'super specialty', sup: 'super', spl: 'specialty', sp: 'specialty', spec: 'specialty', specialty: 'specialty',
  mem: 'memorial', inst: 'institute', institution: 'institute', res: 'research', rsch: 'research',
  ctr: 'centre', cntr: 'centre', cen: 'centre', center: 'centre', centers: 'centre', centres: 'centre',
  univ: 'university', sci: 'sciences', science: 'sciences', scs: 'sciences',
  nsg: 'nursing', mat: 'maternity', hlth: 'health', ngr: 'nagar', rd: 'road', fdn: 'foundation', foundn: 'foundation',
  shri: 'sri', shree: 'sri', sree: 'sri', srii: 'sri',
  ltd: '', pvt: '', private: '', limited: '', and: '', of: '', the: '', dr: '', smt: '', sh: '', late: '', joint: '', unit: '',
  ind: 'india', rly: 'railway', rlwy: 'railway', railways: 'railway', cmp: 'campus'
};
const GENERIC = new Set(['hospital', 'medical', 'college', 'government', 'district', 'general', 'research', 'institute', 'centre',
  'specialty', 'super', 'multi', 'sciences', 'university', 'health', 'foundation', 'trust', 'nursing', 'home', 'clinic', 'campus']);

const canon = s => s.replace(/(.)\1+/g, '$1').replace(/ph/g, 'f').replace(/th/g, 't').replace(/sh/g, 's').replace(/w/g, 'v').replace(/y/g, 'i');

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
function sameToken(a, b) {
  if (a === b) return true;
  const L = Math.min(a.length, b.length);
  if (L >= 11) return lev(a, b, 2) <= 2;
  if (L >= 7) return lev(a, b, 1) <= 1;
  return false;
}

export function normalise(raw) {
  let s = String(raw ?? '').trim();
  let state = null;
  // trailing ", AP" / ", TEL" style code, or trailing state name
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z ]/g, '').trim();
    if (CODES[last]) { state = state || CODES[last]; parts.pop(); } else break;
  }
  s = parts.join(' , ');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\()/g, '$1 $2').toLowerCase().replace(/&/g, ' and ');
  s = s.replace(/new\s+delhi/g, 'delhi');
  for (const name of Object.keys(STATES).sort((a, b) => b.length - a.length)) {
    const re = new RegExp('\\b' + name.replace(/ /g, '\\s+') + '\\b', 'g');
    if (re.test(s)) { state = state || STATES[name]; s = s.replace(re, ' '); }
  }
  s = s.replace(/multi[\s-]*speciali?ty/g, 'multi specialty').replace(/super[\s-]*speciali?ty/g, 'super specialty')
       .replace(/specialit(y|ies)/g, 'specialty').replace(/speciality/g, 'specialty');
  const toks = [];
  for (const w of s.split(/[^a-z0-9]+/).filter(Boolean)) {
    const mapped = Object.prototype.hasOwnProperty.call(ABBR, w) ? ABBR[w] : w;
    for (const m of mapped.split(' ')) if (m) toks.push(m);
  }
  const out = toks.map(t => ({ t: canon(t), g: GENERIC.has(t) }));
  return { toks: out, state };
}

/* weighted similarity of two normalised names; returns {score, ok} */
export function similarity(A, B) {
  const a = A.toks, b = B.toks;
  if (!a.length || !b.length) return { score: 0, ok: false };
  const w = x => (x.g ? GENERIC_W : 1);
  const usedB = new Array(b.length).fill(false);
  let matched = 0, matchedNG = 0, unmatchedNG = 0;
  const unA = [];
  for (const x of a) {
    let hit = -1;
    for (let j = 0; j < b.length; j++) if (!usedB[j] && b[j].g === x.g && sameToken(x.t, b[j].t)) { hit = j; break; }
    if (hit >= 0) { usedB[hit] = true; matched += w(x); if (!x.g) matchedNG++; } else unA.push(x);
  }
  let unB = b.filter((_, j) => !usedB[j]);
  // run-together spellings ("Vishwa Raj" vs "Vishwaraj"): compare the non-generic leftovers as one string
  const ngA = unA.filter(x => !x.g), ngB = unB.filter(x => !x.g);
  if (ngA.length && ngB.length && (ngA.length > 1 || ngB.length > 1)) {
    const ja = ngA.map(x => x.t).join(''), jb = ngB.map(x => x.t).join('');
    if (ja.length >= 6 && sameToken(ja, jb)) {
      matched += ngA.length; matchedNG += 1;
      unA.splice(0, unA.length, ...unA.filter(x => x.g)); unB = unB.filter(x => x.g);
    }
  }
  unmatchedNG = unA.filter(x => !x.g).length + unB.filter(x => !x.g).length;
  const wa = a.reduce((s, x) => s + w(x), 0), wb = b.reduce((s, x) => s + w(x), 0);
  const score = (2 * matched) / (wa + wb);
  // every distinguishing (non-generic) word must be present on both sides: an extra or different place name => not the same institute
  const ok = score >= MIN_SCORE && matchedNG >= 1 && unmatchedNG === 0;
  return { score, ok };
}

/* ---------------- source (1.csv) ---------------- */
export function readSource(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Source file has no data rows.');
  const hdr = rows[0].map(hkey);
  const find = re => hdr.findIndex(h => re.test(h));
  const idx = {
    course: find(/^course/), state: find(/^state/), inst: find(/institute/),
    stip: find(/stipend.*(1|one|first)/), bond: find(/^bond(years?)?$|bondyear/), pen: find(/penalt/), beds: find(/^beds?$/)
  };
  const need = { inst: 'Institute', stip: 'Stipend Year 1', bond: 'Bond Years', pen: 'Bond Penalty', beds: 'BED' };
  const missing = Object.keys(need).filter(k => idx[k] < 0).map(k => need[k]);
  if (missing.length) throw new Error('Source file is missing column(s): ' + missing.join(', '));
  const groups = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[idx.inst] || '').trim();
    if (!name) continue;
    const course = idx.course >= 0 ? (row[idx.course] || '') : '';
    const src = /plom/i.test(course) ? 'D' : 'N';   // matches "Diploma" and the "DIiploma" spelling used in the source
    const stateName = idx.state >= 0 ? (row[idx.state] || '').trim() : '';
    const rec = { src, v: [parseMoney(row[idx.stip]), parseCount(row[idx.bond]), parseMoney(row[idx.pen]), parseCount(row[idx.beds])] };
    const k = name.toLowerCase() + '|' + stateName.toLowerCase();
    let g = groups.get(k);
    if (!g) {
      const n = normalise(name);
      g = { name, n, state: STATE_CODE_OF(stateName) || n.state, recs: [] };
      groups.set(k, g);
    }
    g.recs.push(rec);
  }
  return [...groups.values()];
}

/* ---------------- round files (the existing institute database) ---------------- */
export function readInstitutes(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return new Map();
  const hdr = rows[0].map(hkey);
  const ii = hdr.findIndex(h => /institute/.test(h)), ci = hdr.findIndex(h => /^course/.test(h));
  if (ii < 0) throw new Error('Round file has no institute column.');
  const out = new Map();                     // name -> Set of kinds ('N' = NBEMS/DNB, 'D' = NBEMS-Diploma, 'O' = other)
  for (let r = 1; r < rows.length; r++) {
    const name = (rows[r][ii] || '').trim();
    if (!name) continue;
    const c = ci >= 0 ? (rows[r][ci] || '') : '';
    const kind = /^\(nbems-diploma\)/i.test(c.trim()) ? 'D' : /^\(nbems\)/i.test(c.trim()) ? 'N' : 'O';
    if (!out.has(name)) out.set(name, new Set());
    out.get(name).add(kind);
  }
  return out;
}

/* values of one source group, restricted to the course kind(s) the institute is actually used for */
function resolve(group, kinds) {
  const wantN = kinds.has('N'), wantD = kinds.has('D');
  let recs = group.recs;
  if (wantN !== wantD) {                       // used for exactly one of DNB / DNB-Diploma -> use that source's rows when present
    const pref = recs.filter(r => r.src === (wantN ? 'N' : 'D'));
    if (pref.length) recs = pref;
  }
  const v = [null, null, null, null];
  for (let f = 0; f < 4; f++) {
    const set = new Set(recs.map(r => r.v[f]).filter(x => x !== null));
    v[f] = set.size === 1 ? [...set][0] : null;          // conflicting or missing -> unknown, never guessed
  }
  return v;
}

export function buildData(sourceText, instituteMaps) {
  const groups = readSource(sourceText);
  const insts = new Map();
  for (const m of instituteMaps) for (const [n, k] of m) { if (!insts.has(n)) insts.set(n, new Set()); k.forEach(x => insts.get(n).add(x)); }
  const data = {}, report = { matched: [], ambiguous: [], none: [] };
  for (const [name, kinds] of insts) {
    const N = normalise(name);
    const cands = [];
    for (const g of groups) {
      if (N.state && g.state && N.state !== g.state) continue;      // different state => never the same institute
      const r = similarity(N, g.n);
      if (r.ok) cands.push({ g, score: r.score });
    }
    if (!cands.length) { report.none.push(name); continue; }
    cands.sort((a, b) => b.score - a.score);
    const top = cands[0];
    const close = cands.filter(c => c.score >= top.score - AMBIGUITY_GAP);
    const vals = close.map(c => JSON.stringify(resolve(c.g, kinds)));
    if (new Set(vals).size > 1) { report.ambiguous.push(`${name}  <->  ${close.map(c => c.g.name).join(' | ')}`); continue; }
    data[name] = resolve(top.g, kinds);
    report.matched.push(`${top.score.toFixed(3)}  ${name}  <->  ${top.g.name}`);
  }
  return { data, report, total: insts.size };
}

/* ---------------- CLI ---------------- */
function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const src = arg('src', fs.existsSync('all.csv') ? 'all.csv' : '1.csv');   // the file you commit daily: all.csv (or 1.csv)
    let rounds = arg('rounds', null);
    rounds = rounds ? rounds.split(',').map(s => s.trim()).filter(Boolean)
      : fs.readdirSync('.').filter(f => /^r\d+\.csv$/i.test(f)).sort();
    if (!fs.existsSync(src)) throw new Error('Source file not found: ' + src);
    if (!rounds.length) throw new Error('No round files (r1.csv ...) found.');
    const maps = rounds.map(f => readInstitutes(fs.readFileSync(f, 'utf8')));
    const { data, report, total } = buildData(fs.readFileSync(src, 'utf8'), maps);
    const out = arg('out', 'choice-data.json');
    fs.writeFileSync(out, JSON.stringify({ v: 1, updated: new Date().toISOString(), d: data }));
    const rep = arg('report', null);
    const text = `Institutes in round files: ${total}\nMatched: ${report.matched.length}\nAmbiguous (excluded): ${report.ambiguous.length}\nNo confident match (excluded): ${report.none.length}\n\n== MATCHED ==\n${report.matched.join('\n')}\n\n== AMBIGUOUS ==\n${report.ambiguous.join('\n')}\n`;
    if (rep) fs.writeFileSync(rep, text);
    console.log(`choice-data: ${report.matched.length} of ${total} institutes matched, ${report.ambiguous.length} ambiguous, ${report.none.length} unmatched -> ${out}`);
  } catch (e) { console.error('ERROR: ' + e.message); process.exit(1); }
}
