/**
 * What a run reports to the host (practice-v1, HOST_CONTRACT.md section 13).
 * One criterion per marking point, weighted by its marks. The add-on never reports a grade: the host derives it.
 * Pure functions, so they can be tested without a browser.
 */
import type { PracticeCriterion, PracticeResult } from '@mnemonexus/addon-sdk/practice';
import type { Activity, Draft, Part, Point } from './types';

export const MAX_LABEL = 200;
export const MIN_WORDS_TO_COUNT = 8;
const MAX_ID = 128;
const MAX_NOTE = 600;
const MAX_MISCONCEPTIONS = 32;
const MAX_SKILLS = 16;

export const pointKey = (part: Part, point: Point) => `${part.id}/${point.id}`;
export const pitfallKey = (part: Part, tag: string) => `${part.id}/${tag}`;

export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
export const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export function totalWords(draft: Pick<Draft, 'answers'>): number {
  return Object.values(draft.answers).reduce((n, text) => n + wordCount(text), 0);
}

/** Marks as people say them: ½, 1, 1½ ... */
export function formatMarks(marks: number): string {
  const whole = Math.floor(marks);
  const half = marks - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}
export const unitWord = (activity: Pick<Activity, 'marksBy'>, marks: number) =>
  `${activity.marksBy === 'pack' ? 'point' : 'mark'}${marks === 1 ? '' : 's'}`;

export function criterionId(part: Part, point: Point): string {
  const raw = `${part.id}-${point.id}`.replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return (raw || 'point').slice(0, MAX_ID);
}

/** A design activity's headings map onto the skills they exercise; anything else uses the activity's first skill. */
export function skillFor(activity: Activity, part: Part): string {
  if (part.skill && activity.skills.includes(part.skill)) return part.skill;
  let wanted: string | undefined;
  if (activity.kind === 'design' && part.heading) {
    if (/interpret/i.test(part.heading)) wanted = 'interpret-data';
    else if (/control/i.test(part.heading)) wanted = 'use-controls';
    else if (/predict|expected|result/i.test(part.heading)) wanted = 'predict-results';
    else if (/aim|hypothes|method/i.test(part.heading)) wanted = 'design-experiment';
  }
  return wanted && activity.skills.includes(wanted) ? wanted : activity.skills[0];
}

/** How a part is named in a sentence: by its heading when it has one, else by its letter when there are several. */
export function partName(activity: Activity, part: Part): string {
  return part.heading ?? (activity.parts.length > 1 ? `(${part.id})` : '');
}
export function partLabel(activity: Activity, part: Part): string {
  const name = partName(activity, part);
  return name ? `${name}${part.heading ? ': ' : ' '}` : '';
}

/** The parts that are marked: all of them, except that of several alternatives (parts sharing `choose`) only the one with the longest answer is. */
export function markedParts(activity: Activity, answers: Record<string, string>): Part[] {
  const best = new Map<string, Part>();
  for (const part of activity.parts) {
    if (!part.choose) continue;
    const current = best.get(part.choose);
    if (!current || wordCount(answers[part.id] ?? '') > wordCount(answers[current.id] ?? '')) best.set(part.choose, part);
  }
  return activity.parts.filter((part) => !part.choose || best.get(part.choose) === part);
}

export function tally(activity: Activity, ticks: Record<string, boolean>, answers: Record<string, string> = {}): { earned: number; total: number } {
  let earned = 0; let total = 0;
  for (const part of markedParts(activity, answers)) for (const point of part.points) {
    total += point.marks;
    if (ticks[pointKey(part, point)]) earned += point.marks;
  }
  return { earned, total };
}

export interface ResultInput { activity: Activity; draft: Draft; hintsUsed: number; finished: boolean }

/** The report for one run. `finished` means the learner reached the end of marking. */
export function buildResult({ activity, draft, hintsUsed, finished }: ResultInput): PracticeResult {
  const words = totalWords(draft);
  const wrote = words >= MIN_WORDS_TO_COUNT;
  if (!finished) {
    return {
      version: 1, activityId: activity.id, valid: false, criteria: [], hintsUsed, attempts: words > 0 ? 1 : 0,
      note: 'This run was ended before it was marked, so it does not count.',
    };
  }
  const criteria: PracticeCriterion[] = [];
  const weights = new Map<string, { earned: number; total: number }>();
  const missedIn = new Set<string>();
  for (const part of markedParts(activity, draft.answers)) {
    const skill = skillFor(activity, part);
    for (const point of part.points) {
      const met = draft.ticks[pointKey(part, point)] === true;
      criteria.push({ id: criterionId(part, point), label: clip(`${partLabel(activity, part)}${point.text}`, MAX_LABEL), met, weight: point.marks, skill });
      const w = weights.get(skill) ?? { earned: 0, total: 0 };
      w.total += point.marks; if (met) w.earned += point.marks;
      weights.set(skill, w);
      if (!met) missedIn.add(partName(activity, part));
    }
  }
  const skills = [...weights].slice(0, MAX_SKILLS).map(([id, w]) => ({ id, evidence: Math.round((w.earned / w.total) * 100) / 100 }));
  const misconceptions: string[] = [];
  for (const part of activity.parts) for (const pit of part.pitfalls ?? []) {
    if (draft.pitfalls[pitfallKey(part, pit.tag)] && !misconceptions.includes(pit.tag)) misconceptions.push(clip(pit.tag, 120));
  }
  const { earned, total } = tally(activity, draft.ticks, draft.answers);
  const missed = [...missedIn].filter(Boolean);
  const noteParts = [`Marked by the learner against the ${activity.origin === 'past-paper' ? "examiner's" : 'written'} scheme: ${formatMarks(earned)} of ${formatMarks(total)} ${unitWord(activity, total)}.`];
  if (missed.length) noteParts.push(`Points were missed in ${missed.join('; ')}.`);
  if (!wrote) noteParts.push('Almost nothing was written, so this run does not count.');
  return {
    version: 1,
    activityId: activity.id,
    valid: wrote,
    criteria,
    skills,
    misconceptions: misconceptions.slice(0, MAX_MISCONCEPTIONS),
    hintsUsed,
    attempts: 1,
    note: clip(noteParts.join(' '), MAX_NOTE),
  };
}

/** The suggested time, in seconds. */
export const budgetSeconds = (activity: Pick<Activity, 'minutes'>) => Math.round(activity.minutes * 60);

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0'); const rr = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

export const emptyDraft = (): Draft => ({ v: 1, phase: 'write', answers: {}, ticks: {}, pitfalls: {}, hints: {}, elapsed: 0, note: '', savedAt: 0 });

/** A saved draft is only trusted when it has the shape this version writes. */
export function parseDraft(raw: string | null, activity: Activity): Draft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<Draft>;
    if (d.v !== 1 || (d.phase !== 'write' && d.phase !== 'mark')) return null;
    const known = new Set(activity.parts.map((p) => p.id));
    const answers: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.answers ?? {})) if (known.has(k) && typeof v === 'string') answers[k] = v;
    const flags = (src: unknown) => {
      const out: Record<string, boolean> = {};
      for (const [k, v] of Object.entries((src ?? {}) as Record<string, unknown>)) if (v === true) out[k] = true;
      return out;
    };
    return {
      v: 1, phase: d.phase, answers, ticks: flags(d.ticks), pitfalls: flags(d.pitfalls), hints: flags(d.hints),
      elapsed: typeof d.elapsed === 'number' && d.elapsed >= 0 && d.elapsed < 86400 ? d.elapsed : 0,
      note: typeof d.note === 'string' ? d.note.slice(0, 2000) : '', savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
    };
  } catch { return null; }
}
