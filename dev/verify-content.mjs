// Checks content files against content/SCHEMA.md and against the sources they cite.
//   node dev/verify-content.mjs [files or folders...]      (default: every file under content/)
// Exit code 1 when there is any error. Warnings are printed but do not fail.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKETS = process.env.EXAM_ROOM_PACKETS || 'E:/MnemoNexus-data/claude-docs/packets';
const PAPERS = join(ROOT, 'sources', 'papers');
const PAPER_IDS = { 'gem-2425': 'gem-2425-qa.txt', 'gem-2526': 'gem-2526-qa.txt', 'bri-2425': 'bri-2425-qa.txt', 'bri-2526': 'bri-2526-qa.txt' };

export const KINDS = ['paper', 'design', 'data'];
export const MODULES = ['gem', 'bri', 'babs'];
export const ORIGINS = ['past-paper', 'workshop', 'lecture-question', 'modelled'];
export const BASE_SKILLS = {
  'design-experiment': 'Design an experiment', 'use-controls': 'Choose and justify controls', 'predict-results': 'Predict what results would show',
  'read-data': 'Describe what data shows', 'interpret-data': 'Interpret data mechanistically', calculation: 'Calculations and units',
  'mechanism-words': 'Explain a mechanism in words', transcription: 'Transcription', 'rna-processing': 'RNA processing', translation: 'Translation',
  replication: 'DNA replication', 'cell-cycle': 'The cell cycle', 'dna-damage-repair': 'DNA damage and repair', telomeres: 'Telomeres',
  mutagenesis: 'Mutagens and mutations', 'enzyme-catalysis': 'Enzyme catalysis', 'cofactors-redox': 'Cofactors and redox', ribozymes: 'Ribozymes',
  spectroscopy: 'Spectroscopy', 'mass-spec': 'Mass spectrometry', 'binding-thermodynamics': 'Binding and thermodynamics',
  'biophysical-methods': 'Biophysical methods', 'kinetics-practical': 'Kinetics practical', 'statistics-analysis': 'Statistics and analysis',
};

const issues = [];
const err = (where, msg) => issues.push({ level: 'error', where, msg });
const warn = (where, msg) => issues.push({ level: 'warning', where, msg });

/** Lowercase, straight quotes and dashes, no mark annotations, single spaces. */
export function norm(text) {
  return String(text)
    .replace(/[\u2018\u2019\u201B\u2032\u00B4`]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u00A0|\u200B/g, ' ')
    .replace(/\(\s*(?:\d+(?:\.\d+)?|1\/2|½)\s*(?:marks?)?\s*\)/gi, ' ')
    .replace(/\(\s*(?:\d+(?:\.\d+)?|1\/2|½)\s*marks?\s*\)/gi, ' ')
    .replace(/\[IMG:[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
const squash = (s) => norm(s).replace(/[^a-z0-9]+/g, '');

const packetCache = new Map();
function packet(num) {
  if (packetCache.has(num)) return packetCache.get(num);
  let out = null;
  const dir = existsSync(PACKETS) ? readdirSync(PACKETS).find((d) => d.startsWith(`${num}-`)) : null;
  if (dir && existsSync(join(PACKETS, dir, 'source.md'))) {
    const lines = []; const index = new Map();
    for (const raw of readFileSync(join(PACKETS, dir, 'source.md'), 'utf8').split(/\r?\n/)) {
      const m = /^\[([^\]]+)\]\s?(.*)$/.exec(raw);
      if (m) { index.set(m[1], lines.length); lines.push({ id: m[1], text: m[2] }); }
    }
    out = { dir, lines, index };
  }
  packetCache.set(num, out);
  return out;
}
const paperCache = new Map();
function paper(id) {
  if (paperCache.has(id)) return paperCache.get(id);
  let out = null;
  const file = PAPER_IDS[id] && join(PAPERS, PAPER_IDS[id]);
  if (file && existsSync(file)) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).map((raw) => /^\[(\d+)\] ?(.*)$/.exec(raw)).filter(Boolean).map((m) => ({ id: m[1], text: m[2] }));
    const index = new Map(lines.map((l, i) => [l.id, i]));
    out = { lines, index, media: join(PAPERS, `${PAPER_IDS[id].replace('.txt', '')}-media`) };
  }
  paperCache.set(id, out);
  return out;
}

/** Resolves one cite part like "073:A.35-A.37" or "gem-2425:57-58". Returns {text} or {error}. */
function resolveCite(part) {
  const m = /^([a-z0-9-]+):(.+)$/.exec(part.trim());
  if (!m) return { error: `bad cite "${part}" (use source:lines)` };
  const [, src, loc] = m;
  if (PAPER_IDS[src]) {
    const p = paper(src);
    if (!p) return { error: `paper ${src} not found` };
    const img = /^img\s+(\S+)$/.exec(loc);
    if (img) return existsSync(join(p.media, img[1])) ? { text: '' , image: true } : { error: `${src} has no image ${img[1]}` };
    const range = /^(\d+)(?:-(\d+))?$/.exec(loc);
    if (!range) return { error: `bad paper lines "${loc}"` };
    const a = Number(range[1]); const b = Number(range[2] ?? range[1]);
    const chosen = p.lines.filter((l) => Number(l.id) >= a && Number(l.id) <= b);
    if (!chosen.length || b < a) return { error: `${src} has no lines ${loc}` };
    return { text: chosen.map((l) => l.text).join(' ') };
  }
  if (/^\d{3}$/.test(src)) {
    const p = packet(src);
    if (!p) return { error: `packet ${src} not found under ${PACKETS}` };
    const [from, to] = loc.includes('-') && !/^T\d+@/.test(loc) ? splitRange(loc) : [loc, loc];
    const i = p.index.get(from); const j = p.index.get(to);
    if (i === undefined) return { error: `packet ${src} has no line ${from}` };
    if (j === undefined) return { error: `packet ${src} has no line ${to}` };
    if (j < i) return { error: `packet ${src} range ${loc} runs backwards` };
    return { text: p.lines.slice(i, j + 1).map((l) => l.text).join(' ') };
  }
  return { error: `unknown source "${src}"` };
}
function splitRange(loc) {
  // Ids may contain hyphens only in transcripts; a range is "X-Y" where both exist. Try each hyphen.
  const dashes = [...loc.matchAll(/-/g)].map((m) => m.index);
  for (const d of dashes) return [loc.slice(0, d), loc.slice(d + 1)];
  return [loc, loc];
}
function cite(where, value, { needText = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) { err(where, 'missing cite'); return ''; }
  let text = '';
  for (const part of value.split(',')) {
    const r = resolveCite(part);
    if (r.error) err(where, `cite: ${r.error}`); else text += ` ${r.text}`;
  }
  return text;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const ORDINARY = new Set(['repair', 'data', 'binding', 'control', 'controls', 'protein', 'proteins', 'gene', 'genes', 'cell', 'cells', 'experiment', 'enzyme', 'dna', 'rna', 'mutation', 'result', 'results', 'method', 'sample', 'question', 'figure', 'graph', 'level', 'levels', 'reaction', 'reactions', 'enzymes', 'analysis', 'sequence', 'mutant', 'strand', 'spectrum', 'sequencing', 'analyte', 'assay', 'measure', 'complex', 'domain', 'process', 'activity', 'function', 'structure', 'product', 'mixture', 'binding', 'inhibition', 'mutants', 'samples', 'peaks', 'curve', 'model']);

function checkTerm(where, term) {
  if (!str(term, 80)) return err(where, 'term must be 1 to 80 characters');
  const words = term.trim().split(/\s+/);
  if (words.length > 1) return;
  if (/[A-Z].*[A-Z]|\d|-|[A-Z]{2,}/.test(term)) return;
  if (ORDINARY.has(term.toLowerCase()) || (/^[a-z]+$/.test(term) && term.length < 6)) err(where, `single word "${term}" will never match; use a phrase or a distinctive name`);
}

function fuzzyContains(haystack, needle) {
  const h = squash(haystack); const n = squash(needle);
  if (!n) return true;
  return h.includes(n);
}

/** Everything the activity cites, as one text: the whole of each paper or packet it names. */
function corpusFor(a) {
  const ids = new Set();
  const grab = (c) => { if (typeof c === 'string') for (const part of c.split(',')) ids.add(part.trim().split(':')[0]); };
  for (const f of a.figures ?? []) grab(f.cite);
  for (const p of a.parts ?? []) { for (const q of p.points ?? []) grab(q.cite); grab(p.model?.cite); grab(p.feedback?.cite); grab(p.hint?.cite); }
  let text = '';
  for (const id of ids) {
    if (PAPER_IDS[id]) text += ' ' + (paper(id)?.lines ?? []).map((l) => l.text).join(' ');
    else if (/^\d{3}$/.test(id)) text +=' ' + (packet(id)?.lines ?? []).map((l) => l.text).join(' ');
  }
  return text;
}

/** How much of the question text (stems and prompts) is word for word in what the activity cites. */
export function questionShare(a) {
  const corpus = corpusFor(a);
  const paras = [...(a.context ?? []), ...a.parts.flatMap((p) => [...(p.intro ?? []), ...(a.kind === 'design' ? [] : [p.prompt])])].filter((t) => squash(t).length >= 30);
  const missing = paras.filter((t) => !fuzzyContains(corpus, t)).length;
  return { total: paras.length, missing };
}

export function verifyActivity(a, ctx) {
  const at = `${a?.id ?? '(no id)'}`;
  if (!a || typeof a !== 'object') return err(at, 'not an object');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.id ?? '') || a.id.length > 60) err(at, 'id must be kebab-case, at most 60 characters');
  if (ctx.ids.has(a.id)) err(at, 'duplicate id'); ctx.ids.add(a.id);
  if (!KINDS.includes(a.kind)) err(at, `kind must be one of ${KINDS}`);
  if (!MODULES.includes(a.module)) err(at, `module must be one of ${MODULES}`);
  if (!ORIGINS.includes(a.origin)) err(at, `origin must be one of ${ORIGINS}`);
  if (!str(a.title, 90)) err(at, 'title: 1 to 90 characters');
  if (!str(a.summary, 300)) err(at, 'summary: 1 to 300 characters');
  if (!str(a.source, 200)) err(at, 'source label missing');
  if (![1, 2, 3].includes(a.level)) err(at, 'level must be 1, 2 or 3');
  if (a.marksBy !== undefined && !['source', 'pack'].includes(a.marksBy)) err(at, 'marksBy must be source or pack');
  if (a.minutes !== undefined && !(isNum(a.minutes) && a.minutes > 0 && a.minutes <= 120)) err(at, 'minutes must be 0-120');
  if (a.module && ctx.file && !ctx.file.replace(/\\/g, '/').includes(`/${a.module}/`)) warn(at, `module ${a.module} but the file is not under content/${a.module}/`);
  if (!Array.isArray(a.terms) || a.terms.length < 4 || a.terms.length > 12) err(at, 'terms: 4 to 12 phrases');
  else a.terms.forEach((t, i) => checkTerm(`${at}.terms[${i}]`, t));
  if (!Array.isArray(a.skills) || !a.skills.length || a.skills.length > 4) err(at, 'skills: 1 to 4');
  else for (const s of a.skills) if (!ctx.skills[s]) err(at, `unknown skill "${s}"`);
  if (a.origin === 'modelled' || a.origin === 'workshop' && a.parts?.some((p) => p.points?.some((q) => q.by === 'author'))) { /* author points are allowed */ }
  if (a.context !== undefined && (!Array.isArray(a.context) || a.context.some((c) => !str(c, 4000)))) err(at, 'context must be an array of strings');
  const figureIds = new Set();
  for (const [i, f] of (a.figures ?? []).entries()) {
    const w = `${at}.figures[${i}]`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(f.id ?? '')) err(w, 'figure id must be kebab-case');
    if (figureIds.has(f.id)) err(w, 'duplicate figure id'); figureIds.add(f.id);
    const file = f.file && join(ROOT, f.file);
    if (!f.file || !/^content\/figures\/[a-z0-9-]+\.(png|jpg|jpeg)$/.test(f.file)) err(w, 'file must be content/figures/<id>.png or .jpg');
    else if (!existsSync(file)) err(w, `missing file ${f.file}`);
    else {
      const size = statSync(file).size;
      if (size > 700 * 1024) warn(w, `${f.file} is ${(size / 1024) | 0} KB; shrink it`);
    }
    if (!str(f.alt, 300)) err(w, 'alt: 1 to 300 characters');
    cite(`${w}.cite`, f.cite);
  }
  if (!Array.isArray(a.parts) || !a.parts.length) { err(at, 'needs parts'); return; }
  const corpus = corpusFor(a);
  const verbatim = (where, para) => { if (para && squash(para).length >= 30 && !fuzzyContains(corpus, para)) warn(where, `not found word for word in the cited sources: "${para.slice(0, 70)}"`); };
  for (const [i, c] of (a.context ?? []).entries()) verbatim(`${at}.context[${i}]`, c);
  const partIds = new Set(); let total = 0; let pointCount = 0; let authorPoints = 0;
  for (const [pi, p] of a.parts.entries()) {
    const w = `${at}.${p.id ?? pi}`;
    if (!str(p.id, 20) || partIds.has(p.id)) err(w, 'part id missing or duplicate'); partIds.add(p.id);
    if (a.kind === 'design' && !str(p.heading, 80)) err(w, 'design parts need a heading');
    if (!str(p.prompt, 3000)) err(w, 'prompt: 1 to 3000 characters');
    verbatim(`${w}.prompt`, p.prompt);
    for (const [i, line] of (p.intro ?? []).entries()) verbatim(`${w}.intro[${i}]`, line);
    if (/\(\s*\d+\s*marks?\b/i.test(p.prompt ?? '')) warn(w, 'prompt still contains a marks annotation');
    if (p.lines !== undefined && !(Number.isInteger(p.lines) && p.lines > 0 && p.lines <= 100)) err(w, 'lines must be a whole number');
    if (p.figure !== undefined && !figureIds.has(p.figure)) err(w, `figure "${p.figure}" is not in figures`);
    if (!Array.isArray(p.points) || !p.points.length) { err(w, 'needs points'); continue; }
    let sum = 0; const pointIds = new Set(); const sourceText = [];
    for (const [qi, q] of p.points.entries()) {
      const pw = `${w}.p${q.id ?? qi}`;
      pointCount++;
      if (!str(q.id, 20) || pointIds.has(q.id)) err(pw, 'point id missing or duplicate'); pointIds.add(q.id);
      if (!str(q.text, 600)) err(pw, 'text: 1 to 600 characters');
      if (!(isNum(q.marks) && q.marks > 0 && q.marks <= 100 && Math.abs(q.marks * 2 - Math.round(q.marks * 2)) < 1e-9)) err(pw, 'marks must be a positive multiple of 0.5');
      sum += q.marks || 0;
      if (q.guide !== undefined && !str(q.guide, 600)) err(pw, 'guide: 1 to 600 characters');
      if (!['examiner', 'author'].includes(q.by)) err(pw, 'by must be examiner or author');
      const text = cite(`${pw}.cite`, q.cite); sourceText.push(text);
      if (q.by === 'author') authorPoints++;
      if (q.by === 'examiner') {
        if (!str(q.quote, 600) || q.quote.trim().split(/\s+/).length < 4) err(pw, 'examiner points need a verbatim quote of 4 or more words');
        else if (!fuzzyContains(text, q.quote)) err(pw, `quote not found in cited lines: "${q.quote.slice(0, 70)}"`);
        else if (q.text && !fuzzyContains(q.quote, q.text) && !fuzzyContains(text, q.text)) warn(pw, `point text is not a verbatim fragment of the source (check it keeps the source's meaning): "${q.text.slice(0, 70)}"`);
      }
    }
    if (p.choose !== undefined && !/^[a-z0-9-]{1,30}$/.test(p.choose)) err(w, 'choose must be a short kebab-case group name');
    total += sum;
    if (!isNum(p.marks) || Math.abs(p.marks - sum) > 1e-9) err(w, `marks ${p.marks} but the points add up to ${sum}`);
    if (p.hint) { if (!str(p.hint.text, 600) || !['examiner', 'lecturer', 'author'].includes(p.hint.by)) err(w, 'hint needs text (<=600) and by'); cite(`${w}.hint.cite`, p.hint.cite); }
    if (!p.model || !str(p.model.text, 6000) || !['examiner', 'lecturer', 'author'].includes(p.model.by)) err(w, 'model needs text (<=6000) and by examiner|lecturer|author');
    else {
      const mt = cite(`${w}.model.cite`, p.model.cite);
      if (p.model.by !== 'author') {
        for (const para of p.model.text.split(/\n+/).filter((s) => s.trim())) {
          if (!fuzzyContains(mt, para)) err(w, `model text is not verbatim from the cited lines: "${para.slice(0, 80)}"`);
        }
      } else if (a.origin === 'past-paper') warn(w, 'author-written model on a past-paper question: check the paper really has no answer');
    }
    if (p.feedback) {
      if (!str(p.feedback.text, 3000)) err(w, 'feedback.text: 1 to 3000 characters');
      else {
        const ft = cite(`${w}.feedback.cite`, p.feedback.cite);
        for (const para of p.feedback.text.split(/\n+/).filter((s) => s.trim())) if (!fuzzyContains(ft, para)) err(w, `feedback is not verbatim from the cited lines: "${para.slice(0, 80)}"`);
      }
    }
    for (const [ti, t] of (p.pitfalls ?? []).entries()) {
      if (!str(t.tag, 60) || !str(t.text, 400)) err(w, `pitfalls[${ti}] needs tag (<=60) and text (<=400)`);
      cite(`${w}.pitfalls[${ti}].cite`, t.cite);
    }
  }
  const chooseGroups = {};
  for (const p of a.parts) if (p.choose) (chooseGroups[p.choose] ??= []).push(p);
  for (const [g, list] of Object.entries(chooseGroups)) if (list.length < 2 || new Set(list.map((p) => p.marks)).size > 1) err(at, `alternatives "${g}" need two or more parts with the same marks`);
  if (pointCount > 24) err(at, `${pointCount} points; the limit is 24`);
  if (a.marksBy === 'pack' && a.origin === 'past-paper') warn(at, 'a past paper always has printed marks; marksBy should be "source"');
  if (authorPoints && a.origin === 'past-paper') warn(at, 'author points inside a past-paper question');
  ctx.stats.push({ id: a.id, kind: a.kind, module: a.module, marks: total, points: pointCount, authorPoints, origin: a.origin });
}

export function loadFiles(args) {
  const out = [];
  const walk = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) { for (const n of readdirSync(p).sort()) if (n !== 'figures') walk(join(p, n)); } else if (p.endsWith('.json') && basename(p) !== 'skills.json') out.push(p);
  };
  for (const a of args.length ? args : [join(ROOT, 'content')]) walk(resolve(a));
  return out;
}

export function verifyAll(files) {
  const ctx = { ids: new Set(), skills: { ...Object.fromEntries(Object.entries(BASE_SKILLS).map(([k, v]) => [k, { label: v }])) }, stats: [], file: '' };
  const docs = [];
  for (const file of files) {
    let doc;
    try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { err(file, `not valid JSON: ${e.message}`); continue; }
    docs.push({ file, doc });
    for (const [id, s] of Object.entries(doc.skills ?? {})) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id) || !str(s?.label, 60)) err(file, `bad skill ${id}`);
      else if (ctx.skills[id] && ctx.skills[id].label !== s.label) err(file, `skill ${id} is already labelled "${ctx.skills[id].label}"`);
      else ctx.skills[id] = s;
    }
  }
  for (const { file, doc } of docs) {
    ctx.file = file;
    if (!Array.isArray(doc.activities)) { err(file, 'needs an "activities" array'); continue; }
    for (const a of doc.activities) verifyActivity(a, ctx);
  }
  return { ctx, docs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = loadFiles(process.argv.slice(2));
  const { ctx } = verifyAll(files);
  for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR  ' : 'warning'} ${i.where}: ${i.msg}`);
  const by = {};
  for (const s of ctx.stats) { const k = `${s.module}/${s.kind}`; by[k] = (by[k] ?? 0) + 1; }
  console.log(`\n${files.length} file(s), ${ctx.stats.length} activities, ${ctx.stats.reduce((n, s) => n + s.marks, 0)} marks, ${ctx.stats.reduce((n, s) => n + s.points, 0)} points (${ctx.stats.reduce((n, s) => n + s.authorPoints, 0)} written by the author)`);
  console.log(Object.entries(by).map(([k, v]) => `${k}: ${v}`).join('   '));
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(`${errors} error(s), ${issues.length - errors} warning(s)`);
  process.exitCode = errors ? 1 : 0;
}

export const getIssues = () => issues;
export const resetIssues = () => { issues.length = 0; };
