#!/usr/bin/env node
/*
  Independent integrity checks for the Choice page data. Uses its OWN CSV reader and its OWN column lookup
  (exact header names), so it does not share code with build-choice-data.mjs.

  Usage:  node scripts/verify-integrity.mjs [--dir .] [--json choice-data.json] [--report match-report.txt] [--out integrity-report.txt]
  Exit code 1 if any check fails (the deploy workflow then stops instead of publishing bad data).

  CHECK 1  CSV structure & integrity      (headers, duplicates, column counts, encoding, empty names)
  CHECK 2  Institute matching integrity   (no invented / unmatched / ambiguous institutes published, counts reconcile)
  CHECK 3  Column mapping & data accuracy (Stipend Y1 only from "Stipend Year 1", bond/bed/penalty/Y2/Y3, blanks preserved)
  CHECK 4  Repository checks              (no r1.csv left, page reads 1.csv, 1.csv is published, no CSV data copied into code)
*/
import fs from 'node:fs';
import path from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const DIR = args.dir || '.', JSONF = args.json || 'choice-data.json', REPORT = args.report || 'match-report.txt', OUT = args.out || 'integrity-report.txt';

const log = []; let failures = 0;
const say = s => log.push(s);
const ok = (c, msg) => { say((c ? '  PASS  ' : '  FAIL  ') + msg); if (!c) failures++; return c; };
const info = s => say('        ' + s);

function csv(file) {
  const raw = fs.readFileSync(file);
  const text = raw.toString('utf8');
  const rows = []; let row = [], f = '', q = false;
  const t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') { q = true; continue; }
    if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; if (row.length > 1 || row[0].trim()) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return { header: rows[0], rows: rows.slice(1), text, unterminatedQuote: q, bom: text.charCodeAt(0) === 0xFEFF };
}
const money = s => { const t = String(s ?? '').replace(/[₹\s]/g, '').replace(/,/g, ''); return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const int = s => /^\d+$/.test(String(s ?? '').trim()) ? Number(String(s).trim()) : null;
const nrm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

/* ---------------- CHECK 1 ---------------- */
say('CHECK 1 - CSV STRUCTURE AND INTEGRITY');
const ALLH = ['Course', 'State', 'Institute', 'Stipend Year 1', 'Stipend Year 2', 'Stipend Year 3', 'Bond Years', 'Bond Penalty', 'BED'];
let all, one;
try { all = csv(path.join(DIR, 'all.csv')); one = csv(path.join(DIR, '1.csv')); ok(true, 'all.csv and 1.csv load'); }
catch (e) { ok(false, 'cannot load CSV files: ' + e.message); finish(); }
for (const [name, t] of [['all.csv', all], ['1.csv', one]]) {
  ok(!t.unterminatedQuote, name + ': no unterminated quoted field');
  ok(!t.text.includes('�'), name + ': valid UTF-8 (no replacement characters)');
  ok(t.rows.length > 0, name + ': ' + t.rows.length + ' data rows');
  const hd = t.header.map(h => h.trim());
  ok(new Set(hd.map(h => h.toLowerCase())).size === hd.length && hd.every(Boolean), name + ': no duplicate or empty headers');
  const bad = t.rows.filter(r => r.length !== t.header.length);
  ok(bad.length === 0, name + ': every row has ' + t.header.length + ' columns' + (bad.length ? ' (bad rows: ' + bad.length + ')' : ''));
}
ok(ALLH.every((h, i) => (all.header[i] || '').trim() === h), 'all.csv: headers are exactly ' + ALLH.join(' | '));
const oneH = one.header.map(h => h.trim()); const oneI = oneH.indexOf('Allotted Institute');
ok(oneI >= 0, '1.csv: column "Allotted Institute" present (headers: ' + oneH.join(' | ') + ')');
const AI = Object.fromEntries(ALLH.map((h, i) => [h, i]));
const emptyAll = all.rows.filter(r => !r[AI.Institute].trim()).length;
ok(emptyAll === 0, 'all.csv: no empty institute names (' + emptyAll + ')');
const emptyOne = one.rows.filter(r => !(r[oneI] || '').trim()).length;
info('1.csv rows with empty institute: ' + emptyOne + ' (informational: these rows are ignored by the build)');
const courses = {}; all.rows.forEach(r => { courses[r[AI.Course]] = (courses[r[AI.Course]] || 0) + 1; });
const unknownCourse = Object.keys(courses).filter(c => !/di+plom|dnb/i.test(c));
ok(unknownCourse.length === 0, 'all.csv: every row has a recognisable DNB / Diploma sheet name in "Course" (' + Object.keys(courses).length + ' sheet names)');
const badMoney = []; all.rows.forEach((r, n) => { for (const h of ['Stipend Year 1', 'Stipend Year 2', 'Stipend Year 3', 'Bond Penalty']) { const v = r[AI[h]].trim(); if (v && money(v) === null) badMoney.push('row ' + (n + 2) + ' ' + h + '="' + v + '"'); } for (const h of ['Bond Years', 'BED']) { const v = r[AI[h]].trim(); if (v && int(v) === null) badMoney.push('row ' + (n + 2) + ' ' + h + '="' + v + '"'); } });
ok(badMoney.length === 0, 'all.csv: every non-blank number parses (' + badMoney.length + ' invalid)' + (badMoney.length ? ': ' + badMoney.slice(0, 5).join('; ') : ''));
const groups = new Map(); all.rows.forEach(r => { const k = r[AI.Course] === undefined ? '' : (/di+plom/i.test(r[AI.Course]) ? 'd' : 'm') + '|' + nrm(r[AI.State]) + '|' + nrm(r[AI.Institute]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
const dupGroups = [...groups.values()].filter(g => g.length > 1);
info('duplicate institute rows within the same sheet type: ' + dupGroups.length + ' group(s); those with differing numbers are left blank by the build for the differing fields (see match report)');

/* ---------------- load build output ---------------- */
let J, R;
try { J = JSON.parse(fs.readFileSync(JSONF, 'utf8')); R = fs.readFileSync(REPORT, 'utf8'); } catch (e) { ok(false, 'cannot read build output: ' + e.message); finish(); }

const sec = name => { const a = R.indexOf('== ' + name); if (a < 0) return []; const rest = R.slice(a).split('\n').slice(1); const out = []; for (const l of rest) { if (l.startsWith('== ')) break; out.push(l); } return out; };
const matchedBlock = sec('MATCHED'), ambBlock = sec('AMBIGUOUS'), noneBlock = sec('NO CONFIDENT');
const pairs = []; for (let i = 0; i < matchedBlock.length; i++) { const m = matchedBlock[i].match(/^\[([\w-]+)\] (.*)$/); if (m) { const t = (matchedBlock[i + 1] || '').match(/^\s+=> (.*) \(([^()]*)\)(.*)$/); pairs.push({ tier: m[1], counsel: m[2], allName: t && t[1], allState: t && t[2], note: t && t[3] }); } }
const firstLines = b => b.filter(l => l && !l.startsWith('      ') && !l.startsWith(' '));
const ambNames = firstLines(ambBlock), noneNames = firstLines(noneBlock);

/* ---------------- CHECK 2 ---------------- */
say(''); say('CHECK 2 - INSTITUTE MATCHING INTEGRITY');
const names = new Set(one.rows.map(r => (r[oneI] || '').trim()).filter(n => n && n !== 'Institute not specified'));
const jkeys = Object.keys(J.d);
ok(jkeys.length === pairs.length, 'institutes with details (' + jkeys.length + ') = matched institutes in the report (' + pairs.length + ')');
ok(jkeys.every(k => names.has(k)), 'every published institute exists in 1.csv (nothing invented)');
ok(pairs.length + ambNames.length + noneNames.length === names.size, 'matched ' + pairs.length + ' + ambiguous ' + ambNames.length + ' + unmatched ' + noneNames.length + ' = ' + names.size + ' distinct institutes in 1.csv');
ok(ambNames.every(n => !(n in J.d)), 'no ambiguous institute carries all.csv details (' + ambNames.length + ' listed with blank details)');
ok(noneNames.every(n => !(n in J.d)), 'no unmatched institute carries all.csv details (' + noneNames.length + ' listed with blank details)');
const missing = pairs.filter(p => !(p.counsel in J.d)); ok(missing.length === 0, 'every matched institute is present in the output (nothing accidentally dropped)');
const allKeys = new Map(); all.rows.forEach(r => allKeys.set(nrm(r[AI.State]) + '|' + nrm(r[AI.Institute]), true));
const noRec = pairs.filter(p => !allKeys.has(nrm(p.allState) + '|' + nrm(p.allName)));
ok(noRec.length === 0, 'every matched record points to a real all.csv row (' + noRec.length + ' dangling)');
// false-positive screen: the matched all.csv name must share a distinctive word with the 1.csv text and its state must be in the text
const STOP = new Set('the of and at in for a an hospital hospitals hosp medical college centre center institute research health government govt general sciences speciality dr shri sri trust'.split(' '));
const toks = s => nrm(s.replace(/&/g, ' and ').replace(/[^A-Za-z0-9]+/g, ' ')).split(' ').filter(w => w.length > 2 && !STOP.has(w));
const suspicious = pairs.filter(p => { const a = toks(p.allName), b = new Set(toks(p.counsel)), joined = toks(p.counsel).join(''); return !a.some(w => b.has(w) || (w.length >= 5 && joined.includes(w)) || [...b].some(x => x.length >= 5 && w.includes(x)) || [...b].some(x => x.startsWith(w.slice(0, 5)) && w.length >= 5)); });
ok(suspicious.length === 0, 'false-positive screen: each match shares at least one distinctive word (' + suspicious.length + ' suspicious)' + (suspicious.length ? ': ' + suspicious.slice(0, 5).map(p => p.counsel + ' => ' + p.allName).join(' | ') : ''));
const claims = new Map(); pairs.forEach(p => { const k = nrm(p.allState) + '|' + nrm(p.allName); if (!claims.has(k)) claims.set(k, []); claims.get(k).push(p.counsel); });
const multi = [...claims.entries()].filter(([, v]) => v.length > 1);
info('all.csv records shared by several 1.csv names (same institute written differently): ' + multi.length);
info('match tiers: ' + ['exact', 'normalised', 'token', 'leading-words'].map(t => t + '=' + pairs.filter(p => p.tier === t).length).join(', '));

/* ---------------- CHECK 3 ---------------- */
say(''); say('CHECK 3 - COLUMN MAPPING AND DATA ACCURACY');
// expected values recomputed from all.csv straight by header name; a field is blank if the duplicate rows disagree
const expect = (state, name) => {
  const out = { m: null, d: null };
  for (const v of ['m', 'd']) {
    const rows = (groups.get(v + '|' + nrm(state) + '|' + nrm(name)) || []);
    if (!rows.length) continue;
    const g = (r) => [money(r[AI['Stipend Year 1']]), int(r[AI['Bond Years']]), money(r[AI['Bond Penalty']]), int(r[AI.BED]), money(r[AI['Stipend Year 2']]), money(r[AI['Stipend Year 3']])];
    const vals = rows.map(g);
    out[v] = vals[0].map((x, i) => vals.every(y => y[i] === x) ? x : null);
  }
  return out;
};
let wrong = 0, y1Wrong = 0, blankShown = 0, y1blankY2set = 0, checked = 0; const blanks = [0, 0, 0, 0, 0, 0];
for (const p of pairs) {
  const e = J.d[p.counsel]; if (!e) continue;
  const x = expect(p.allState, p.allName);
  for (const v of ['m', 'd']) {
    if (x[v] === null && e[v] === undefined) continue;
    if (x[v] === null || e[v] === undefined) { wrong++; continue; }
    checked++;
    x[v].forEach((val, i) => { if (val !== e[v][i]) { wrong++; if (i === 0) y1Wrong++; } if (e[v][i] === null) blanks[i]++; });
    if (x[v][0] === null && x[v][4] !== null && e[v][0] !== null) y1Wrong++;
    if (x[v][0] === null && x[v][4] !== null) y1blankY2set++;
    if (e[v].some(z => z === null)) blankShown++;
  }
}
ok(wrong === 0, 'all ' + checked + ' published variant records equal the values recomputed from all.csv (' + wrong + ' mismatches)');
ok(y1Wrong === 0, 'Stipend (index 0) is exactly "Stipend Year 1": 0 deviations; ' + y1blankY2set + ' record(s) have a blank Year 1 but a Year 2 value and stay blank (no substitution)');
const names6 = ['Stipend Year 1', 'Bond Years', 'Bond Penalty', 'BED', 'Stipend Year 2', 'Stipend Year 3'];
info('published records with a blank field kept (not removed): ' + blankShown + '   blanks per column: ' + names6.map((n, i) => n + '=' + blanks[i]).join(', '));
ok(blankShown > 0, 'matched institutes with blank Stipend/Bond/Bed/Penalty are published with the blanks preserved');
const badShape = jkeys.filter(k => { const e = J.d[k]; return !(e.m || e.d) || [e.m, e.d].some(a => a && (a.length !== 6 || a.some(z => z !== null && (typeof z !== 'number' || z < 0)))); });
ok(badShape.length === 0, 'every published record has well-formed [Y1, bond, penalty, beds, Y2, Y3] arrays (null = blank)');
const diplomaOnly = jkeys.filter(k => J.d[k].d).length;
ok(diplomaOnly > 0, 'Diploma sheets are recognised (' + diplomaOnly + ' published institutes carry Diploma figures)');

/* ---------------- CHECK 4 ---------------- */
say(''); say('CHECK 4 - REPOSITORY / WEBSITE CHECKS');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === '.git' || e.name === '_site' || e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const textFiles = walk(DIR).filter(f => /\.(html|mjs|js|json|yml|yaml|md|txt)$/i.test(f) && !/(choice-data|integrity-report|match-report)/.test(f) && f !== path.join(DIR, 'scripts', 'verify-integrity.mjs'));
const hits = textFiles.filter(f => /\br1\.csv\b/i.test(fs.readFileSync(f, 'utf8')));
ok(hits.length === 0, 'no "r1.csv" reference remains in ' + textFiles.length + ' code/config files' + (hits.length ? ': ' + hits.join(', ') : ''));
const html = fs.existsSync(path.join(DIR, 'index.html')) ? fs.readFileSync(path.join(DIR, 'index.html'), 'utf8') : '';
ok(/url:\s*'1\.csv'/.test(html), 'index.html loads 1.csv at runtime');
ok(/fetch\(r\.url,\s*\{\s*cache:\s*'no-cache'|cache:'no-cache'/.test(html), 'index.html fetches with cache:no-cache (always revalidates)');
const wf = path.join(DIR, '.github/workflows/pages.yml');
if (fs.existsSync(wf)) {
  const y = fs.readFileSync(wf, 'utf8');
  ok(!/--exclude='1\.csv'/.test(y), 'workflow publishes 1.csv with the site');
  ok(/on:\s*[\s\S]*push:[\s\S]*branches:\s*\[main\]/.test(y), 'workflow rebuilds on every push to main (CSV edits in GitHub redeploy automatically)');
  ok(/build-choice-data\.mjs/.test(y) && /verify-integrity\.mjs/.test(y), 'workflow builds the data and runs these integrity checks before publishing');
} else info('workflow file not found (skipped)');

finish();
function finish() {
  say(''); say(failures ? 'RESULT: ' + failures + ' CHECK(S) FAILED' : 'RESULT: ALL CHECKS PASSED');
  fs.writeFileSync(OUT, log.join('\n') + '\n'); console.log(log.join('\n'));
  process.exit(failures ? 1 : 0);
}
