#!/usr/bin/env node
/*
  Builds choice-data.json for the Choice page.

  Reads   1.csv   (counselling records: institute names + ranks)   [also r1.csv, r2.csv ... if present]
          all.csv (institute details: stipend, bond, penalty, beds)
  Matches institute names between the two files (strictly: when unsure, the institute is LEFT OUT),
  writes the matched details to choice-data.json and a human-readable match report.

  Usage (the GitHub workflow runs this for you):
    node scripts/build-choice-data.mjs --out _site/choice-data.json --report match-report.txt
  Optional: --counselling 1.csv,r1.csv   --all all.csv   --dir .
  No third-party packages are needed.
*/
import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------ arguments ------------------------------ */
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const nx = process.argv[i + 1];
    args[a.slice(2)] = nx === undefined || nx.startsWith('--') ? '1' : (i++, nx);
  }
}
const DIR = args.dir || '.';
const OUT = args.out || 'choice-data.json';
const REPORT = args.report || 'match-report.txt';
const ALL = path.join(DIR, args.all || 'all.csv');
let COUNSEL = args.counselling
  ? args.counselling.split(',').map(s => path.join(DIR, s.trim()))
  : [path.join(DIR, '1.csv'), ...fs.readdirSync(DIR).filter(f => /^r\d+\.csv$/i.test(f)).map(f => path.join(DIR, f))];
COUNSEL = [...new Set(COUNSEL)];

function fail(msg) {
  console.error('ERROR: ' + msg);
  try { fs.writeFileSync(REPORT, 'BUILD FAILED\n' + msg + '\nNo new choice-data.json was published.\n'); } catch {}
  process.exit(1);
}

/* ------------------------------ CSV parsing ------------------------------ */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const nl = text.search(/\r|\n/), first = nl < 0 ? text : text.slice(0, nl);
  const count = ch => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (!q && c === ch) n++; } return n; };
  let delim = ',', best = -1;
  for (const d of [',', '\t', ';']) { const n = count(d); if (n > best) { best = n; delim = d; } }
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
function readTable(file, need) {           // need: {field: regex tested on the simplified header}
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { error: `cannot read ${file} (${e.code || e.message})` }; }
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: `${file} has no data rows` };
  const hdr = rows[0].map(hkey), idx = {}, missing = [];
  for (const k in need) { const i = hdr.findIndex(h => need[k].test(h)); if (i < 0) missing.push(k); else idx[k] = i; }
  if (missing.length) return { error: `${file}: required column(s) not found: ${missing.join(', ')}. Columns present: ${rows[0].join(' | ')}` };
  return { rows: rows.slice(1), idx };
}

/* ------------------------------ name normalisation ------------------------------ */
const STATES = {
  'andaman and nicobar islands': ['andaman and nicobar', 'andaman nicobar', 'andaman'],
  'andhra pradesh': ['andhra pradesh', 'andhrapradesh'],
  'arunachal pradesh': ['arunachal pradesh', 'arunachal'],
  'assam': ['assam'], 'bihar': ['bihar'], 'chandigarh': ['chandigarh'],
  'chhattisgarh': ['chhattisgarh', 'chattisgarh', 'chhatisgarh'],
  'dadra and nagar haveli': ['dadra and nagar haveli', 'dadra nagar haveli', 'daman and diu', 'dadra'],
  'delhi': ['delhi'], 'goa': ['goa'], 'gujarat': ['gujarat'], 'haryana': ['haryana'],
  'himachal pradesh': ['himachal pradesh', 'himachal'],
  'jammu and kashmir': ['jammu and kashmir', 'jammu kashmir', 'j and k'],
  'jharkhand': ['jharkhand'], 'karnataka': ['karnataka'], 'kerala': ['kerala'], 'ladakh': ['ladakh'],
  'madhya pradesh': ['madhya pradesh', 'madhyapradesh'],
  'maharashtra': ['maharashtra', 'maharastra'], 'manipur': ['manipur'], 'meghalaya': ['meghalaya'],
  'mizoram': ['mizoram'], 'nagaland': ['nagaland'], 'odisha': ['odisha', 'orissa'],
  'pondicherry': ['pondicherry', 'puducherry'], 'punjab': ['punjab'], 'rajasthan': ['rajasthan'],
  'sikkim': ['sikkim'], 'tamil nadu': ['tamil nadu', 'tamilnadu'],
  'telangana': ['telangana', 'telengana'], 'tripura': ['tripura'],
  'uttar pradesh': ['uttar pradesh', 'uttarpradesh'], 'uttarakhand': ['uttarakhand', 'uttaranchal'],
  'west bengal': ['west bengal', 'westbengal'],
};
const STATE_ABBR = { 'tamil nadu': ['tn'], 'andhra pradesh': ['ap'], 'uttar pradesh': ['up'], 'madhya pradesh': ['mp'], 'west bengal': ['wb'],
  'maharashtra': ['mh'], 'karnataka': ['ka', 'kar'], 'kerala': ['kl'], 'telangana': ['ts', 'tg'], 'haryana': ['hr'], 'punjab': ['pb'],
  'rajasthan': ['rj'], 'gujarat': ['gj'], 'bihar': ['br'], 'odisha': ['od'], 'jharkhand': ['jh'], 'chhattisgarh': ['cg'],
  'uttarakhand': ['uk'], 'himachal pradesh': ['hp'], 'jammu and kashmir': ['jk'], 'delhi': ['dl', 'ncr'], 'goa': ['ga'] };
const STATE_BY_KEY = new Map(Object.keys(STATES).map(s => [hkey(s), s]));

function words(s) {
  s = String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2');
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
const CANON = {
  govt: 'government', gov: 'government', dist: 'district', distt: 'district', dt: 'district',
  hosp: 'hospital', hosps: 'hospital', hospitals: 'hospital', inst: 'institute', instt: 'institute',
  med: 'medical', medi: 'medical', ctr: 'centre', cen: 'centre', cntr: 'centre', center: 'centre', centres: 'centre', centers: 'centre',
  univ: 'university', res: 'research', mem: 'memorial', sci: 'sciences', science: 'sciences', coll: 'college', clg: 'college', mc: 'college',
  specialty: 'speciality', multispeciality: 'speciality', multispecialty: 'speciality', superspeciality: 'speciality',
  superspecialty: 'speciality', super: 'speciality', multi: 'speciality', spec: 'speciality', specialities: 'speciality',
  homes: 'home', ss: 'speciality', sshosp: 'speciality',
  // common alternative spellings of the same city (both files are mapped to the first-listed modern spelling)
  shimoga: 'shivamogga', bengaluru: 'bangalore', mysuru: 'mysore', thiruvananthapuram: 'trivandrum', kozhikode: 'calicut',
  kochi: 'cochin', vadodara: 'baroda', calcutta: 'kolkata', kolkatta: 'kolkata', madras: 'chennai', gurgaon: 'gurugram',
  allahabad: 'prayagraj', vizag: 'visakhapatnam', tumkur: 'tumakuru', belgaum: 'belagavi', mangalore: 'mangaluru',
  gulbarga: 'kalaburagi', bijapur: 'vijayapura', bellary: 'ballari', poona: 'pune', bombay: 'mumbai', anantapuramu: 'anantapur',
  ananthapuram: 'anantapur', ananthpur: 'anantapur', anantapuram: 'anantapur', thrissur: 'trichur', puducherry: 'pondicherry',
};
// Words too common to identify an institute on their own (they are ignored when comparing names).
const GENERIC = new Set(['the', 'of', 'and', 'at', 'in', 'for', 'a', 'an', 'pvt', 'ltd', 'limited', 'private', 'hospital', 'medical', 'college',
  'centre', 'institute', 'research', 'health', 'healthcare', 'care', 'government', 'general', 'sciences', 'speciality', 'trust', 'society',
  'foundation', 'charitable', 'dr', 'shri', 'sri', 'smt', 'no', 'unit', 'campus', 'university', 'clinic', 'nursing', 'home', 'city', 'post',
  'po', 'near', 'opp', 'road', 'rd', 'street', 'st', 'nagar', 'colony', 'sector', 'main', 'lane', 'ps', 'taluk', 'tehsil', 'block',
  'village', 'vill', 'tal', 'teh', 'india']);
const AFFIX = ['government', 'govt', 'district', 'distt', 'dist', 'hospital', 'hosp', 'medical', 'college', 'institute', 'centre', 'center'];
function splitJoined(w, out, tail) {      // "govtdisthosp" -> govt dist hosp
  let guard = 0;
  while (w.length > 7 && guard++ < 6 && !CANON[w] && !GENERIC.has(w) && !AFFIX.includes(w)) {
    const a = AFFIX.find(x => w.startsWith(x) && w.length - x.length >= 4);
    const b = a ? null : AFFIX.find(x => w.endsWith(x) && w.length - x.length >= 4);
    if (a) { out.push(a); w = w.slice(a.length); }
    else if (b) { tail.unshift(b); w = w.slice(0, -b.length); }
    else break;
  }
  return w;
}
function canonWords(s) {
  const res = [];
  for (const raw of words(s)) {
    const out = [], tail = [];
    const core = /^\d+$/.test(raw) ? raw : splitJoined(raw, out, tail);
    for (const w of [...out, core, ...tail]) res.push(CANON[w] || w);
  }
  return res;
}
const distinctive = ws => ws.filter(w => !GENERIC.has(w) && !/^\d+$/.test(w) && w.length > 1);

function lev1(a, b) {                     // true when the edit distance is at most 1
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, d = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) i++; else j++;
  }
  return d + (la - i) + (lb - j) <= 1;
}
function tokMatch(a, b) {                 // a = word from all.csv, b = word from the counselling text
  if (a === b) return true;
  if (a.length >= 3 && b.length > a.length && b.startsWith(a) && /^[a-z]+$/.test(a)) return true;   // abbreviation (e.g. "chandr" ~ "chandra" is NOT used: needs >=3 letters prefix)
  if (a.length >= 6 && b.length >= 6 && a[0] === b[0] && lev1(a, b)) return true;                  // one-letter spelling difference
  return false;
}
const hasTok = (tokens, a) => tokens.some(b => tokMatch(a, b));

function detectStates(text) {
  const t = ' ' + words(text).join(' ') + ' ', found = new Set();
  for (const [st, aliases] of Object.entries(STATES))
    for (const al of aliases) if (t.includes(' ' + al + ' ')) { found.add(st); break; }
  return found;
}

/* ------------------------------ numbers ------------------------------ */
const money = s => { const d = String(s ?? '').replace(/[^0-9]/g, ''); return d === '' ? null : Number(d); };
const intOrNull = s => { const t = String(s ?? '').trim(); return /^\d+$/.test(t) ? Number(t) : null; };

/* ------------------------------ load all.csv ------------------------------ */
const allT = readTable(ALL, { course: /^course/, state: /^state/, inst: /^institute/, y1: /year1/, y2: /year2/, y3: /year3/, bondYears: /^bond(years?|yrs?)?$/, penalty: /penalt/, beds: /^beds?$/ });
if (allT.error) fail(allT.error);

const catalog = new Map();                // state|name -> record
let allRows = 0;
for (const r of allT.rows) {
  const inst = (r[allT.idx.inst] || '').trim(), stRaw = (r[allT.idx.state] || '').trim();
  if (!inst) continue;
  allRows++;
  const state = STATE_BY_KEY.get(hkey(stRaw)) || [...detectStates(stRaw)][0] || stRaw.toLowerCase();
  const key = state + '|' + words(inst).join(' ');
  let rec = catalog.get(key);
  if (!rec) {
    const cw = canonWords(inst), stw = new Set([...words(state), ...(STATE_ABBR[state] || [])]);
    rec = { key, name: inst, state, stateRaw: stRaw, tokens: [...new Set(distinctive(cw).filter(w => !stw.has(w)))], allTokens: cw, headGeneric: distinctive(canonWords(inst.split(',')[0])).filter(w => !stw.has(w)).length === 0, v: { m: null, d: null }, sector: new Set(), conflicts: [] };
    catalog.set(key, rec);
  }
  const src = r[allT.idx.course] || '';
  const variant = /dip/i.test(src) ? 'd' : 'm';      // d = Diploma sheets, m = DNB sheets
  rec.sector.add(/private/i.test(src) ? 'Private' : /public/i.test(src) ? 'Public Sector' : /gov/i.test(src) ? 'Government' : '');
  const vals = [money(r[allT.idx.y1]), intOrNull(r[allT.idx.bondYears]), money(r[allT.idx.penalty]), intOrNull(r[allT.idx.beds]), money(r[allT.idx.y2]), money(r[allT.idx.y3])];
  if (!rec.v[variant]) rec.v[variant] = vals;
  else if (JSON.stringify(rec.v[variant]) !== JSON.stringify(vals)) {
    const cur = rec.v[variant];                       // same institute twice with different numbers: fill blanks only, never overwrite
    vals.forEach((x, i) => {
      if (cur[i] === null && x !== null) cur[i] = x;
      else if (cur[i] !== null && x !== null && cur[i] !== x) rec.conflicts.push(variant.toUpperCase() + ' field ' + i + ': ' + cur[i] + ' vs ' + x);
    });
  }
}
const records = [...catalog.values()];
const byState = new Map();
for (const r of records) { if (!byState.has(r.state)) byState.set(r.state, []); byState.get(r.state).push(r); }

/* ------------------------------ load counselling files ------------------------------ */
const names = new Map();
const usedFiles = [];
for (const f of COUNSEL) {
  if (!fs.existsSync(f)) { if (path.basename(f) === '1.csv' && !args.counselling) fail(`required file ${f} is missing`); continue; }
  const t = readTable(f, { inst: /institute/ });
  if (t.error) { if (path.basename(f) === '1.csv') fail(t.error); console.error('WARNING: ' + t.error + ' (file skipped)'); continue; }
  usedFiles.push(path.basename(f));
  for (const r of t.rows) {
    const n = (r[t.idx.inst] || '').trim();
    if (!n || n === 'Institute not specified') continue;
    if (!names.has(n)) names.set(n, new Set());
    names.get(n).add(path.basename(f));
  }
}
if (!names.size) fail('no institute names found in the counselling file(s)');

/* ------------------------------ matching ------------------------------ */
const results = [];
for (const name of names.keys()) {
  const cw = canonWords(name), segs = name.split(',');
  const states = detectStates(name);
  const res = { name, status: 'none', reason: '', cands: [] };
  results.push(res);
  if (!states.size) { res.reason = 'no state found in the institute text'; continue; }
  const pool = [];
  for (const st of states) for (const r of (byState.get(st) || [])) pool.push(r);
  if (!pool.length) { res.reason = 'no all.csv institute in this state: ' + [...states].join(', '); continue; }
  const normFull = words(name).join(' ');
  // "headline" = distinctive words of the first comma-separated part (of the second part if the first is all generic)
  const headAll = canonWords(segs[0]);
  let head = distinctive(headAll), headFellBack = false;
  if (!head.length && segs[1]) { head = distinctive(canonWords(segs[1])); headFellBack = true; }
  const cands = [];
  for (const r of pool) {
    if (r.tokens.length < 2) continue;                               // all.csv name too short/generic to identify an institute safely
    const rn = words(r.name).join(' ');
    let tier = null;
    if (r.name.toLowerCase().replace(/\s+/g, ' ') === name.toLowerCase().replace(/\s+/g, ' ')) tier = 'exact';
    else if (normFull === rn || (' ' + normFull + ' ').includes(' ' + rn + ' ')) tier = 'normalised';
    if (!tier) {
      // controlled fuzzy: (1) every distinctive word of the all.csv name must be in the counselling text
      if (!r.tokens.every(a => hasTok(cw, a))) continue;
      // (2) the counselling headline must not carry many words the all.csv name lacks ("Apollo" must not match "Apollo Cradle")
      if (!head.length) continue;
      if (headFellBack && !r.headGeneric) continue;       // "Government Hospital, <town>" must not match a named hospital
      const KIND = ['college', 'institute', 'sciences', 'university'];   // "Institute/College" must not match a plain hospital
      if (KIND.some(k => headAll.includes(k) && !r.allTokens.includes(k))) continue;
      const covered = head.filter(h => r.tokens.some(a => tokMatch(a, h))).length;
      if (covered / head.length < 0.6) continue;
      tier = 'token';
    }
    cands.push({ rec: r, tier, score: r.tokens.length + (tier === 'token' ? 0 : 100) });
  }
  if (!cands.length) { res.reason = 'no all.csv institute in the same state shares all its distinctive words'; continue; }
  cands.sort((a, b) => b.score - a.score);
  const top = cands.filter(c => c.score === cands[0].score);
  res.cands = cands;
  const sameData = top.every(c => JSON.stringify([c.rec.v, c.rec.stateRaw]) === JSON.stringify([top[0].rec.v, top[0].rec.stateRaw]));
  if (top.length > 1 && !sameData) { res.status = 'ambiguous'; res.reason = 'several all.csv institutes fit equally well'; continue; }
  res.status = 'match'; res.tier = top[0].tier; res.rec = top[0].rec; res.tiedIdentical = top.length > 1;
}
// Safety: if two DIFFERENT counselling institutes fuzzy-claim the same all.csv record, they are only both kept when
// they are clearly the same institute written twice (same headline words and no conflicting PIN code). Otherwise neither is trusted.
const pins = s => new Set(String(s).match(/(?<![0-9])[1-9][0-9]{5}(?![0-9])/g) || []);
const headKey = n => distinctive(canonWords(n.split(',')[0])).join(' ');
const sameInstitute = (a, b) => {
  const pa = pins(a), pb = pins(b);
  if (pa.size && pb.size) return [...pa].some(x => pb.has(x));      // same PIN code => same place
  return headKey(a) === headKey(b);                                   // no PIN to compare: same headline words
};
const claim = new Map();
for (const r of results) if (r.status === 'match' && r.tier === 'token') { const k = r.rec.key; if (!claim.has(k)) claim.set(k, []); claim.get(k).push(r); }
for (const list of claim.values()) {
  if (list.length < 2) continue;
  let ok = true;
  for (let i = 0; i < list.length && ok; i++) for (let j = i + 1; j < list.length; j++) if (!sameInstitute(list[i].name, list[j].name)) { ok = false; break; }
  if (!ok) for (const x of list) { x.cands = [{ rec: x.rec }]; x.status = 'ambiguous'; x.reason = 'the same all.csv record also fits ' + (list.length - 1) + ' other institute(s) in the counselling data (cannot tell which one it is)'; x.rec = null; }
}

/* ------------------------------ output ------------------------------ */
const d = {};
for (const r of results) if (r.status === 'match') {
  const sec = [...r.rec.sector].filter(Boolean);
  const e = {};
  if (r.rec.v.m) e.m = r.rec.v.m;          // DNB figures:     [stipend yr1, bond years, bond penalty, beds, stipend yr2, stipend yr3]
  if (r.rec.v.d) e.d = r.rec.v.d;          // Diploma figures: same order
  e.s = r.rec.stateRaw;
  if (sec.length === 1) e.k = sec[0];
  d[r.name] = e;
}
const matched = results.filter(r => r.status === 'match'), amb = results.filter(r => r.status === 'ambiguous'), none = results.filter(r => r.status === 'none');
if (!matched.length) fail('0 institutes matched between the counselling file(s) and all.csv - refusing to publish an empty result. Check that both files are the right ones.');

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ v: 2, updated: new Date().toISOString(), d }));

const tierCount = t => matched.filter(r => r.tier === t).length;
const usedKeys = new Set(matched.map(r => r.rec.key));
const L = [];
L.push('CHOICE PAGE - INSTITUTE MATCH REPORT', '');
L.push('Counselling files read: ' + usedFiles.join(', '));
L.push('Institutes in counselling files: ' + names.size);
L.push('all.csv rows: ' + allRows + '  (distinct institutes: ' + records.length + ')');
L.push('Matched (shown on the Choice page): ' + matched.length);
L.push('   exact: ' + tierCount('exact') + '   normalised: ' + tierCount('normalised') + '   word-by-word (controlled fuzzy): ' + tierCount('token'));
L.push('Ambiguous (excluded): ' + amb.length);
L.push('No confident match (excluded): ' + none.length);
L.push('all.csv institutes never matched: ' + records.filter(r => !usedKeys.has(r.key)).length, '');
L.push('== MATCHED ==');
for (const r of matched) L.push(`[${r.tier}] ${r.name}\n      => ${r.rec.name} (${r.rec.stateRaw})${r.tiedIdentical ? '  [tied records had identical data]' : ''}${r.rec.conflicts.length ? '  [conflicting numbers in all.csv: ' + r.rec.conflicts.join('; ') + ']' : ''}`);
L.push('', '== AMBIGUOUS (excluded) ==');
for (const r of amb) L.push(`${r.name}\n      ${r.reason}${r.cands.length ? '. Candidates: ' + r.cands.slice(0, 4).map(c => c.rec.name + ' (' + c.rec.stateRaw + ')').join(' | ') : ''}`);
L.push('', '== NO CONFIDENT MATCH (excluded) ==');
for (const r of none) L.push(`${r.name}\n      ${r.reason}`);
L.push('', '== all.csv INSTITUTES NEVER MATCHED (for your review) ==');
for (const r of records) if (!usedKeys.has(r.key)) L.push(`${r.name} (${r.stateRaw})`);
fs.writeFileSync(REPORT, L.join('\n') + '\n');
console.log(`choice-data.json: ${matched.length} matched, ${amb.length} ambiguous, ${none.length} unmatched (of ${names.size}).`);
