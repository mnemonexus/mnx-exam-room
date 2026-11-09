/** The shapes the build writes into assets/ (see content/SCHEMA.md and dev/build-content.mjs). */
import type { PracticeActivity } from '@mnemonexus/addon-sdk/practice';

export type Kind = 'paper' | 'design' | 'data';
export type Module = 'gem' | 'bri' | 'babs';
export type Origin = 'past-paper' | 'workshop' | 'lecture-question' | 'modelled';
export type Author = 'examiner' | 'lecturer' | 'author';

export interface Figure { id: string; src: string; alt: string; caption?: string; cite: string }
export interface Point { id: string; text: string; marks: number; guide?: string; by: 'examiner' | 'author'; cite: string }
export interface Pitfall { tag: string; text: string; cite: string }
export interface Part {
  id: string;
  heading?: string;
  intro?: string[];
  prompt: string;
  marks: number;
  lines?: number;
  figure?: string;
  skill?: string;
  /** Parts with the same `choose` are alternatives: only the one the learner wrote most in is marked. */
  choose?: string;
  hint?: { text: string; by: Author; cite: string };
  points: Point[];
  model: { text: string; by: Author; cite: string };
  feedback?: { text: string; cite: string };
  pitfalls?: Pitfall[];
}
export interface Activity {
  id: string;
  kind: Kind;
  module: Module;
  title: string;
  summary: string;
  level: 1 | 2 | 3;
  origin: Origin;
  source: string;
  marksBy?: 'source' | 'pack';
  marksTotal: number;
  /** Whether the question text is the source's own, or was written for this pack. */
  questionBy?: 'source' | 'pack';
  minutes: number;
  terms: string[];
  skills: string[];
  context?: string[];
  figures?: Figure[];
  parts: Part[];
  note?: string;
}

/** What the catalogue's opaque `launch` holds. */
export interface Launch { a: string; k: Kind; m: Module; t: number; b: 'source' | 'pack'; o: Origin; s: string; c: string[] }
export type CatalogueEntry = PracticeActivity & { launch: Launch & Record<string, unknown> };

/** What is kept between sessions. */
export interface Draft {
  v: 1;
  phase: 'write' | 'mark';
  answers: Record<string, string>;
  ticks: Record<string, boolean>;
  pitfalls: Record<string, boolean>;
  hints: Record<string, boolean>;
  elapsed: number;
  note: string;
  savedAt: number;
}
export interface DoneRecord { marks: number; total: number; at: number; valid: boolean }
