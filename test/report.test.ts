import { describe, expect, test } from 'bun:test';
import { validatePracticeResult } from '../../mnx-addon-kit-release/sdk/src/practice.mjs';
import { budgetSeconds, buildResult, clock, emptyDraft, formatMarks, parseDraft, pitfallKey, pointKey, skillFor, tally, unitWord, wordCount } from '../src/report';
import { citeText } from '../src/activity';
import type { Activity } from '../src/types';

const activity: Activity = {
  id: 'test-design', kind: 'design', module: 'gem', title: 'T', summary: 'S', level: 2, origin: 'past-paper', source: 'X', marksTotal: 5, minutes: 9,
  terms: ['a b'], skills: ['design-experiment', 'use-controls', 'interpret-data'],
  parts: [
    { id: 'method', heading: 'Method', prompt: 'p', marks: 2, points: [{ id: '1', text: 'Use a plate', marks: 1, by: 'examiner', cite: 'x' }, { id: '2', text: 'Count colonies', marks: 0.5, by: 'examiner', cite: 'x' }, { id: '3', text: 'Known cfu', marks: 0.5, by: 'examiner', cite: 'x' }], model: { text: 'm', by: 'examiner', cite: 'x' } },
    { id: 'controls', heading: 'Controls', prompt: 'p', marks: 3, points: [{ id: '1', text: 'No extract', marks: 1, by: 'examiner', cite: 'x' }, { id: '2', text: 'Second strain', marks: 2, by: 'examiner', cite: 'x' }], model: { text: 'm', by: 'examiner', cite: 'x' },
      pitfalls: [{ tag: 'vague-control', text: 'Vague controls', cite: 'x' }] },
  ],
};
const written = () => ({ ...emptyDraft(), answers: { method: 'plate the strain on minimal medium and count the revertant colonies after two days', controls: 'a no extract plate and a second strain as comparison' } });

describe('marks', () => {
  test('formats half marks the way a marking scheme does', () => {
    expect([0.5, 1, 1.5, 2].map(formatMarks)).toEqual(['½', '1', '1½', '2']);
    expect(unitWord({}, 1)).toBe('mark');
    expect(unitWord({ marksBy: 'pack' }, 3)).toBe('points');
  });
  test('tallies ticked marks', () => {
    const d = written();
    d.ticks[pointKey(activity.parts[0], activity.parts[0].points[1])] = true;
    d.ticks[pointKey(activity.parts[1], activity.parts[1].points[1])] = true;
    expect(tally(activity, d.ticks)).toEqual({ earned: 2.5, total: 5 });
  });
});

describe('the report', () => {
  test('has one criterion per point, weighted by marks, and passes the host contract', () => {
    const d = written();
    d.ticks['method/1'] = true; d.ticks['controls/2'] = true;
    d.pitfalls[pitfallKey(activity.parts[1], 'vague-control')] = true;
    const result = buildResult({ activity, draft: d, hintsUsed: 1, finished: true });
    expect(() => validatePracticeResult(result)).not.toThrow();
    expect(result.valid).toBe(true);
    expect(result.criteria.map((c) => [c.id, c.met, c.weight])).toEqual([['method-1', true, 1], ['method-2', false, 0.5], ['method-3', false, 0.5], ['controls-1', false, 1], ['controls-2', true, 2]]);
    expect(result.hintsUsed).toBe(1);
    expect(result.misconceptions).toEqual(['vague-control']);
    expect(JSON.stringify(result)).not.toMatch(/grade|quality|percent/i);
  });
  test('reports skills by what was earned in each', () => {
    const d = written(); d.ticks['controls/2'] = true; d.ticks['controls/1'] = true;
    const result = buildResult({ activity, draft: d, hintsUsed: 0, finished: true });
    expect(Object.fromEntries(result.skills!.map((s) => [s.id, s.evidence]))).toEqual({ 'design-experiment': 0, 'use-controls': 1 });
  });
  test('an unfinished run is not valid and carries no criteria', () => {
    const result = buildResult({ activity, draft: written(), hintsUsed: 0, finished: false });
    expect(() => validatePracticeResult(result)).not.toThrow();
    expect(result.valid).toBe(false);
    expect(result.criteria).toEqual([]);
  });
  test('ticking an empty answer does not count', () => {
    const d = emptyDraft(); d.ticks['method/1'] = true;
    const result = buildResult({ activity, draft: d, hintsUsed: 0, finished: true });
    expect(result.valid).toBe(false);
  });
});

describe('skills and drafts', () => {
  test('design headings pick the skill they exercise', () => {
    expect(skillFor(activity, activity.parts[0])).toBe('design-experiment');
    expect(skillFor(activity, activity.parts[1])).toBe('use-controls');
    expect(skillFor({ ...activity, skills: ['replication'] }, activity.parts[1])).toBe('replication');
  });
  test('a saved draft only brings back what this activity can use', () => {
    const raw = JSON.stringify({ v: 1, phase: 'mark', answers: { method: 'x', gone: 'y' }, ticks: { 'method/1': true, 'method/2': 'yes' }, pitfalls: {}, hints: {}, elapsed: 61, note: '', savedAt: 5 });
    const d = parseDraft(raw, activity)!;
    expect(d.answers).toEqual({ method: 'x' });
    expect(d.ticks).toEqual({ 'method/1': true });
    expect(d.elapsed).toBe(61);
    expect(parseDraft('{"v":2}', activity)).toBeNull();
    expect(parseDraft('nope', activity)).toBeNull();
    expect(parseDraft(null, activity)).toBeNull();
  });
});

describe('small things', () => {
  test('words and clock', () => {
    expect(wordCount('  two words ')).toBe(2);
    expect(wordCount('')).toBe(0);
    expect(clock(65)).toBe('1:05');
    expect(clock(3725)).toBe('1:02:05');
    expect(budgetSeconds({ minutes: 14 })).toBe(840);
  });
  test('citations are shown in plain words', () => {
    expect(citeText('gem-2425:57-58')).toBe('GEM exam 2024/25, extract lines 57–58');
    expect(citeText('073:A.35-A.37')).toBe('Course packet 073, A.35–A.37');
    expect(citeText('gem-2425:img image6.png')).toBe('GEM exam 2024/25, img image6.png');
  });
});
