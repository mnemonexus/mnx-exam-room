// Turns content/**/*.json into what the pack ships:
//   assets/practice/catalogue.json   the practice-v1 catalogue (validated with the kit's own validator)
//   assets/content/<module>.json     the activities' full text, marking points and model answers
//   assets/fig/<id>.<ext>            the figures that activities use
// and keeps manifest.json's `assets` list in step with those files.
//   node dev/build-content.mjs
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getIssues, loadFiles, questionShare, verifyAll } from './verify-content.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KIT = process.env.MNX_KIT || resolve(ROOT, '..', 'mnx-addon-kit-release');
const { validatePracticeCatalogue } = await import(pathToFileURL(join(KIT, 'sdk', 'src', 'practice.mjs')).href);

const files = process.env.EXAM_ROOM_ONLY ? loadFiles(process.env.EXAM_ROOM_ONLY.split(';')) : loadFiles([]);
const { ctx, docs } = verifyAll(files);
const issues = getIssues();
for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR  ' : 'warning'} ${i.where}: ${i.msg}`);
if (issues.some((i) => i.level === 'error')) { console.error('\nContent has errors; nothing was built.'); process.exit(1); }

const PER_MARK_MINUTES = 1.7;
const KIND_LABEL = { paper: 'Paper question', design: 'Design the experiment', data: 'Read the data' };
const activities = docs.flatMap(({ doc }) => doc.activities);
const skillsUsed = new Set(activities.flatMap((a) => a.skills));

// Alternatives (parts sharing `choose`) count once, at the best any of them offers.
const totalMarks = (a) => {
  const groups = new Map();
  let sum = 0;
  for (const p of a.parts) { if (p.choose) groups.set(p.choose, Math.max(groups.get(p.choose) ?? 0, p.marks)); else sum += p.marks; }
  return sum + [...groups.values()].reduce((n, m) => n + m, 0);
};
const minutesOf = (a) => a.minutes ?? Math.max(2, Math.ceil(totalMarks(a) * PER_MARK_MINUTES) + (a.kind === 'data' && a.figures?.length ? 1 : 0));
const surfacesOf = (minutes) => (minutes <= 5 ? ['study', 'recall'] : minutes <= 12 ? ['study', 'planner'] : ['planner']);
/** Every place in the sources the activity draws on, as the cites its points carry (or just the sources, when that is too long for `launch`). */
const citeList = (a) => {
  const all = new Set();
  const grab = (c) => { if (typeof c === 'string') for (const part of c.split(',')) all.add(part.trim()); };
  for (const f of a.figures ?? []) grab(f.cite);
  for (const p of a.parts) { for (const q of p.points) grab(q.cite); grab(p.model?.cite); grab(p.feedback?.cite); grab(p.hint?.cite); }
  const full = [...all].sort();
  return JSON.stringify(full).length <= 1800 ? full : [...new Set(full.map((c) => c.split(':')[0]))].sort();
};

// Terms the course uses for the whole topic go on every activity of that skill family; dedupe case-insensitively.
// Single words an ordinary sentence uses all the time: the host would never be able to tell them from chatter, so they are left out.
const WEAK_TERMS = new Set(['residual', 'residuals', 'refeeding', 'synchronisation', 'immobilised', 'counterions', 'bioconversion', 'reversion', 'enhancer', 'operator', 'attenuation']);
const dedupe = (list) => { const seen = new Set(); return list.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

const catalogue = { version: 1, skills: {}, activities: [] };
for (const id of skillsUsed) catalogue.skills[id] = { label: ctx.skills[id].label };

const byModule = {};
for (const a of activities) {
  const minutes = minutesOf(a);
  const marks = totalMarks(a);
  // A question whose text is mostly not in the cited sources was written for this pack, and the screen says so.
  const share = questionShare(a);
  const questionBy = a.origin === 'modelled' || (share.total > 0 && share.missing * 2 > share.total) ? 'pack' : 'source';
  const entry = {
    id: a.id,
    title: a.title,
    summary: a.summary,
    minutes,
    level: a.level,
    terms: dedupe(a.terms.filter((t) => !WEAK_TERMS.has(t.toLowerCase()))),
    skills: a.skills,
    surfaces: surfacesOf(minutes),
    family: a.family ?? `${a.module}-${a.kind}-${a.skills[0]}`,
    launch: { a: a.id, k: a.kind, m: a.module, t: marks, b: a.marksBy ?? 'source', o: questionBy === 'pack' ? 'modelled' : a.origin, s: a.source, c: citeList(a) },
  };
  catalogue.activities.push(entry);

  const strip = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => (key === 'quote' ? undefined : value)));
  const content = strip({ ...a, marksTotal: marks, minutes, questionBy });
  for (const f of content.figures ?? []) {
    f.src = `assets/fig/${f.id}${f.file.slice(f.file.lastIndexOf('.'))}`;
    delete f.file;
  }
  (byModule[a.module] ??= {})[a.id] = content;
}
validatePracticeCatalogue(catalogue);

// Write assets fresh so removed activities do not linger.
const out = join(ROOT, 'assets');
for (const sub of ['content', 'fig']) rmSync(join(out, sub), { recursive: true, force: true });
mkdirSync(join(out, 'practice'), { recursive: true });
mkdirSync(join(out, 'content'), { recursive: true });
mkdirSync(join(out, 'fig'), { recursive: true });
writeFileSync(join(out, 'practice', 'catalogue.json'), JSON.stringify(catalogue));
for (const [module, map] of Object.entries(byModule)) writeFileSync(join(out, 'content', `${module}.json`), JSON.stringify({ version: 1, module, activities: map }));
let figures = 0;
for (const a of activities) for (const f of a.figures ?? []) { copyFileSync(join(ROOT, f.file), join(out, 'fig', `${f.id}${f.file.slice(f.file.lastIndexOf('.'))}`)); figures++; }

// Manifest assets: catalogue, one content file per module, every figure.
const manifestPath = join(ROOT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const mime = (name) => (name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : 'application/json');
const logical = ['assets/practice/catalogue.json', ...Object.keys(byModule).sort().map((m) => `assets/content/${m}.json`), ...readdirSync(join(out, 'fig')).sort().map((n) => `assets/fig/${n}`)];
manifest.assets = logical.map((logicalPath) => ({ logicalPath, mimeType: mime(logicalPath) }));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const size = (p) => statSync(join(ROOT, p)).size;
const figBytes = readdirSync(join(out, 'fig')).reduce((n, f) => n + statSync(join(out, 'fig', f)).size, 0);
const kinds = {}; for (const a of activities) kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
console.log(`\nbuilt ${activities.length} activities (${Object.entries(kinds).map(([k, v]) => `${KIND_LABEL[k]} ${v}`).join(', ')}), ${figures} figures (${(figBytes / 1024) | 0} KB), catalogue ${(size('assets/practice/catalogue.json') / 1024) | 0} KB`);
