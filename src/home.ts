/** The list: opened by the learner from the Experiences page. When the host chooses an activity it goes straight to it. */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import { empty, h } from './dom';
import { formatMarks, unitWord } from './report';
import { doneKey, draftKey, parseDone, type Store } from './store';
import type { CatalogueEntry, DoneRecord, Kind, Module } from './types';

export const EXAMS_FROM = '2027-01-18';
const MODULE_SHORT: Record<Module, string> = { gem: 'Genome', bri: 'Reactions', babs: 'Bioscientist' };
const MODULE_LONG: Record<Module, string> = { gem: 'Genome Expression & Maintenance', bri: 'Biochemical Reactions & Interactions', babs: 'Becoming a Bioscientist' };
const KIND_LABEL: Record<Kind, string> = { paper: 'Paper question', design: 'Design the experiment', data: 'Read the data' };
const ORIGIN_SHORT = { 'past-paper': 'Past paper', workshop: 'Workshop', 'lecture-question': 'Lecture', modelled: 'Written for this pack' } as const;
const LEVEL = { 1: 'Introductory', 2: 'Intermediate', 3: 'Advanced' } as const;
const FILTER_KEY = 'ui:filters';

export interface HomeDeps { host: ExperienceHost; store: Store; entries: CatalogueEntry[]; onOpen: (entry: CatalogueEntry) => void }
interface Filters { module: Module | 'all'; kind: Kind | 'all'; search: string; undone: boolean }

export const daysUntil = (iso: string, now = Date.now()) => Math.ceil((Date.parse(`${iso}T00:00:00`) - now) / 86400000);

export async function openHome(root: HTMLElement, deps: HomeDeps): Promise<void> {
  const { store, entries } = deps;
  empty(root);
  const keys = new Set(await store.keys());
  const done = new Map<string, DoneRecord>();
  await Promise.all(entries.map(async (e) => {
    if (!keys.has(doneKey(e.id))) return;
    const record = parseDone(await store.get(doneKey(e.id)));
    if (record) done.set(e.id, record);
  }));
  let filters: Filters = { module: 'all', kind: 'all', search: '', undone: false };
  try {
    const saved = JSON.parse((await store.get(FILTER_KEY)) ?? 'null') as Partial<Filters> | null;
    if (saved) filters = { ...filters, ...saved, search: '' };
  } catch { /* a convenience only */ }

  const shell = h('div', { class: 'er-root er-home', 'data-view': 'home' });
  root.append(shell);
  const days = daysUntil(EXAMS_FROM);
  const examLine = days > 0 ? `Exams from 18 January 2027: ${days} day${days === 1 ? '' : 's'} to go.` : 'The exam period has started.';
  const list = h('ul', { class: 'er-cards', 'data-role': 'list' });
  const count = h('p', { class: 'mnx-muted', role: 'status', 'data-role': 'count' });
  const controls = h('div', { class: 'er-controls' });
  const persist = () => { void store.set(FILTER_KEY, JSON.stringify({ ...filters, search: '' })); };

  const chips = <T extends string>(label: string, current: T, options: [T, string][], set: (value: T) => void) => {
    const group = h('div', { class: 'er-chips', role: 'group', 'aria-label': label });
    for (const [value, text] of options) {
      group.append(h('button', { type: 'button', class: 'mnx-chip', 'aria-pressed': String(current === value), 'data-filter': `${label}:${value}`, onclick: () => { set(value); persist(); render(true); } }, text));
    }
    return group;
  };

  const render = (rebuildControls = false) => {
    if (rebuildControls) {
      empty(controls);
      controls.append(
        chips<Module | 'all'>('Module', filters.module, [['all', 'All modules'], ...(['gem', 'bri', 'babs'] as Module[]).map((m): [Module, string] => [m, MODULE_SHORT[m]])], (v) => { filters.module = v; }),
        chips<Kind | 'all'>('Kind', filters.kind, [['all', 'All kinds'], ...(['paper', 'design', 'data'] as Kind[]).map((k): [Kind, string] => [k, KIND_LABEL[k]])], (v) => { filters.kind = v; }),
        h('div', { class: 'er-chips', role: 'group', 'aria-label': 'Progress' },
          h('button', { type: 'button', class: 'mnx-chip', 'aria-pressed': String(filters.undone), 'data-filter': 'undone', onclick: () => { filters.undone = !filters.undone; persist(); render(true); } }, 'Not done yet')));
    }
    const q = filters.search.trim().toLowerCase();
    const shown = entries.filter((e) => {
      const l = e.launch;
      if (filters.module !== 'all' && l.m !== filters.module) return false;
      if (filters.kind !== 'all' && l.k !== filters.kind) return false;
      if (filters.undone && done.has(e.id)) return false;
      if (q && !`${e.title} ${l.s} ${e.summary ?? ''} ${e.terms.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    empty(list);
    for (const e of shown) {
      const l = e.launch;
      const record = done.get(e.id);
      const status = record ? `Done: ticked ${formatMarks(record.marks)} of ${formatMarks(record.total)}` : keys.has(draftKey(e.id)) ? 'Draft saved' : '';
      list.append(h('li', null, h('button', { type: 'button', class: 'er-card', 'data-activity': e.id, onclick: () => deps.onOpen(e) },
        h('span', { class: 'er-card__top' },
          h('span', { class: 'er-eyebrow' }, `${KIND_LABEL[l.k]} · ${MODULE_SHORT[l.m]}`),
          status ? h('span', { class: `mnx-badge${record ? ' mnx-badge--success' : ''}` }, status) : null),
        h('span', { class: 'er-card__title' }, e.title),
        h('span', { class: 'er-card__source' }, l.s),
        h('span', { class: 'er-card__meta' }, `${formatMarks(l.t)} ${unitWord({ marksBy: l.b }, l.t)} · about ${e.minutes} min · ${LEVEL[e.level]} · ${ORIGIN_SHORT[l.o]}`))));
    }
    count.textContent = shown.length === entries.length ? `${entries.length} activities.` : `${shown.length} of ${entries.length} activities.`;
    if (!shown.length) list.append(h('li', { class: 'mnx-empty' }, h('p', { class: 'mnx-empty__title' }, 'Nothing matches'), h('p', { class: 'mnx-empty__text' }, 'Clear a filter or the search to see more.')));
  };

  const search = h('input', { type: 'search', class: 'mnx-input', placeholder: 'Search titles, sources and topics', 'aria-label': 'Search', 'data-role': 'search' }) as HTMLInputElement;
  search.addEventListener('input', () => { filters.search = search.value; render(); });

  shell.append(h('main', { class: 'er-main' },
    h('header', { class: 'er-homehead' },
      h('h1', { class: 'mnx-title' }, 'Exam Room'),
      h('p', { class: 'mnx-text' }, 'Read the question, write your answer under the clock, then mark yourself against the scheme and the model answer.'),
      h('p', { class: 'mnx-muted' }, `${examLine} ${[...new Set(entries.map((e) => e.launch.m))].map((m) => MODULE_LONG[m]).join(', ')}.`),
      h('p', { class: 'mnx-muted' }, 'Private study pack: it contains university course material and is not for sharing.')),
    search, controls, count, list));
  render(true);
}
