/**
 * One activity: write under a timer, then see the scheme and mark each point you earned.
 * Phases: write -> mark -> done. The draft (answers, ticks, time used) is saved after every pause in typing, so an
 * interrupted answer comes back where it stopped.
 */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import { Clock } from './clock';
import { figureUrl } from './data';
import { autosize, button, empty, h } from './dom';
import { buildResult, budgetSeconds, clock, emptyDraft, formatMarks, markedParts, parseDraft, partLabel, pitfallKey, pointKey, tally, totalWords, unitWord, wordCount, MIN_WORDS_TO_COUNT } from './report';
import { doneKey, draftKey, type Store } from './store';
import type { Activity, Author, Draft, Figure, Part } from './types';

export interface ActivityDeps {
  host: ExperienceHost;
  store: Store;
  settings: () => { timerStyle: 'down' | 'up'; showHints: boolean };
  /** Present when the learner chose this from the list, so there is somewhere to go back to. */
  onBack?: () => void;
  /** Present when the host chose this activity (practice-v1): the reason it was offered. */
  reason?: string;
}

const KIND_LABEL = { paper: 'Paper question', design: 'Design the experiment', data: 'Read the data' } as const;
const ORIGIN_LABEL = { 'past-paper': 'Past paper', workshop: 'Workshop question', 'lecture-question': 'Lecture question', modelled: 'Written for this pack' } as const;
const KIND_HELP = {
  paper: 'Write your answer first. The scheme and model answer appear when you finish.',
  design: 'Plan the experiment under each heading. Every heading is marked on its own points.',
  data: 'Look at the figure first, then answer what it shows. The scheme appears when you finish.',
} as const;
const SOURCE_NAMES: Record<string, string> = { 'gem-2425': 'GEM exam 2024/25', 'gem-2526': 'GEM exam 2025/26', 'bri-2425': 'BRI exam 2024/25', 'bri-2526': 'BRI exam 2025/26' };
/** Words per printed line of an exam answer box (Arial 11, A4), used only to tell the learner roughly how long an answer is. */
const WORDS_PER_LINE = 14;

export function citeText(cite: string): string {
  return cite.split(',').map((part) => {
    const [src, loc = ''] = part.trim().split(/:(.*)/s);
    const name = SOURCE_NAMES[src] ?? `Course packet ${src}`;
    if (loc.startsWith('img ')) return `${name}, ${loc}`;
    return SOURCE_NAMES[src] ? `${name}, extract lines ${loc.replace('-', '–')}` : `${name}, ${loc.replace('-', '–')}`;
  }).join('; ');
}

const modelLabel = (by: Author) => by === 'examiner' ? "Examiner's model answer" : by === 'lecturer' ? "Lecturer's answer" : 'Written for this pack, not by an examiner';

function paragraphs(text: string, className = 'mnx-text'): HTMLElement[] {
  return text.split(/\n+/).filter((line) => line.trim()).map((line) => h('p', { class: className }, line));
}

export async function openActivity(root: HTMLElement, deps: ActivityDeps, activity: Activity): Promise<void> {
  const { host, store } = deps;
  empty(root);
  const stored = parseDraft(await store.get(draftKey(activity.id)), activity);
  const draft: Draft = stored ?? emptyDraft();
  const resumed = stored !== null && (totalWords(stored) > 0 || stored.phase === 'mark' || stored.elapsed > 0);
  const clockwork = new Clock(draft.elapsed);
  const budget = budgetSeconds(activity);
  let paused = false;
  let finished = false;
  let footerMode: 'normal' | 'finish' | 'end' = 'normal';
  let timerTick: number | undefined;
  let saveTimer: number | undefined;
  const hintsOpen = new Set(Object.keys(draft.hints));
  const refs = { timer: null as HTMLElement | null, bar: null as HTMLElement | null, fill: null as HTMLElement | null, pause: null as HTMLButtonElement | null, total: null as HTMLElement | null };

  const shell = h('div', { class: 'er-root er-activity', 'data-view': 'activity', 'data-kind': activity.kind });
  root.append(shell);

  // ── saving ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (finished) return;
    draft.elapsed = clockwork.seconds();
    draft.hints = Object.fromEntries([...hintsOpen].map((k) => [k, true]));
    draft.savedAt = Date.now();
    await store.set(draftKey(activity.id), JSON.stringify(draft));
  };
  const saveSoon = () => { window.clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void save(), 700); };
  const onHide = () => { if (document.hidden) void save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  const dispose = () => {
    window.clearInterval(timerTick); window.clearTimeout(saveTimer); clockwork.dispose();
    document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onHide);
  };

  // ── pieces ────────────────────────────────────────────────────────────────
  const timerText = (): string => {
    const used = clockwork.seconds();
    if (deps.settings().timerStyle === 'up') return clock(used);
    return used <= budget ? `${clock(budget - used)} left` : `${clock(used - budget)} over`;
  };
  const refreshTimer = () => {
    if (!refs.timer) return;
    const used = clockwork.seconds();
    refs.timer.textContent = draft.phase === 'mark' ? `${clock(used)} used` : timerText();
    refs.timer.title = `Suggested time ${clock(budget)}`;
    if (refs.fill) {
      const ratio = Math.min(1, used / budget);
      refs.fill.style.width = `${Math.round(ratio * 100)}%`;
      refs.fill.dataset.over = used > budget ? 'true' : 'false';
    }
  };

  const bar = (): HTMLElement => {
    refs.timer = h('span', { class: 'er-time', role: 'timer', 'data-role': 'timer' });
    refs.fill = h('div', { class: 'mnx-progress__fill er-fill' });
    const left = h('div', { class: 'er-bar__title' },
      h('span', { class: 'er-eyebrow' }, KIND_LABEL[activity.kind]),
      h('span', { class: 'er-bar__name' }, activity.title));
    const right = h('div', { class: 'er-bar__timer' }, refs.timer);
    if (draft.phase === 'write') {
      refs.pause = button('Pause', 'ghost', () => setPaused(!paused), { small: true, 'data-action': 'pause', 'aria-pressed': 'false' });
      right.append(refs.pause);
    }
    const row = h('div', { class: 'er-bar__row' });
    if (deps.onBack) row.append(button('Back', 'ghost', () => { void leave(); }, { small: true, 'data-action': 'back', 'aria-label': 'Back to the list' }));
    row.append(left, right);
    return h('header', { class: 'er-bar' }, row, h('div', { class: 'mnx-progress er-progress', role: 'presentation' }, refs.fill));
  };

  const setPaused = (value: boolean) => {
    paused = value;
    if (paused) clockwork.stop(); else clockwork.start();
    shell.classList.toggle('is-paused', paused);
    shell.querySelectorAll<HTMLTextAreaElement>('textarea.er-answer').forEach((a) => { a.readOnly = paused; });
    if (refs.pause) { refs.pause.textContent = paused ? 'Resume' : 'Pause'; refs.pause.setAttribute('aria-pressed', String(paused)); }
    void save();
  };

  const figureBlock = (figure: Figure): HTMLElement => {
    const holder = h('figure', { class: 'er-figure', 'data-figure': figure.id });
    const slot = h('div', { class: 'er-figure__slot' }, h('span', { class: 'er-muted' }, 'Loading figure…'));
    holder.append(slot);
    if (figure.caption) holder.append(h('figcaption', { class: 'er-caption' }, figure.caption));
    figureUrl(host, figure.src).then((url) => {
      const img = h('img', { src: url, alt: figure.alt, class: 'er-figure__img', loading: 'eager' });
      const open = button('Enlarge', 'secondary', () => lightbox(url, figure.alt), { small: true, 'data-action': 'enlarge', 'aria-label': `Enlarge figure: ${figure.alt}` });
      empty(slot);
      slot.append(h('button', { type: 'button', class: 'er-figure__button', onclick: () => lightbox(url, figure.alt), 'aria-label': `Enlarge figure: ${figure.alt}` }, img), h('div', { class: 'er-figure__tools' }, open));
    }).catch(() => { empty(slot); slot.append(h('span', { class: 'er-muted' }, 'This figure could not be loaded.')); });
    return holder;
  };
  const lightbox = (url: string, alt: string) => {
    const frame = h('div', { class: 'er-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Figure' });
    const img = h('img', { src: url, alt, class: 'er-lightbox__img' });
    let actual = false;
    const toggle = button('Actual size', 'secondary', () => { actual = !actual; frame.classList.toggle('is-actual', actual); toggle.textContent = actual ? 'Fit to window' : 'Actual size'; }, { small: true });
    const close = () => { frame.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    frame.append(h('div', { class: 'er-lightbox__bar' }, toggle, button('Close', 'primary', close, { small: true, 'data-action': 'close-figure' })), h('div', { class: 'er-lightbox__view' }, img));
    shell.append(frame);
  };

  const figuresById = new Map((activity.figures ?? []).map((f) => [f.id, f]));
  /** Each figure is shown where it is first needed; figures no part names sit with the context. */
  const placedFigures = new Set<string>();

  const partHead = (part: Part): HTMLElement => {
    const many = activity.parts.length > 1;
    const marks = `${formatMarks(part.marks)} ${unitWord(activity, part.marks)}`;
    return h('div', { class: 'er-part__head' },
      many && !part.heading ? h('span', { class: 'er-part__tag', 'aria-hidden': 'true' }, `(${part.id})`) : null,
      part.heading ? h('h3', { class: 'er-part__heading' }, part.heading) : null,
      h('span', { class: 'er-part__marks' }, marks),
      part.lines ? h('span', { class: 'er-part__lines' }, `paper limit about ${part.lines} lines`) : null);
  };

  const headerBlock = (): HTMLElement => {
    const total = `${formatMarks(activity.marksTotal)} ${unitWord(activity, activity.marksTotal)}`;
    const authored = activity.parts.some((p) => p.points.some((q) => q.by === 'author'));
    const packQuestion = activity.origin === 'modelled' || activity.questionBy === 'pack';
    const block = h('section', { class: 'er-intro' },
      h('div', { class: 'er-badges' },
        h('span', { class: 'mnx-badge mnx-badge--accent' }, KIND_LABEL[activity.kind]),
        h('span', { class: 'mnx-badge' }, total),
        h('span', { class: 'mnx-badge' }, `about ${activity.minutes} min`),
        h('span', { class: `mnx-badge${packQuestion ? ' mnx-badge--warning' : ''}` }, packQuestion ? ORIGIN_LABEL.modelled : ORIGIN_LABEL[activity.origin])),
      h('p', { class: 'er-source' }, activity.source),
      draft.phase === 'write' ? h('p', { class: 'mnx-muted' }, KIND_HELP[activity.kind]) : null);
    if (activity.marksBy === 'pack') block.append(h('p', { class: 'mnx-muted' }, 'The source gives no mark value for this question, so each marking point counts as one point.'));
    const warning = packQuestion && authored ? "The question and the marking points on this one were written for this pack from the course material. They are not an examiner's scheme."
      : packQuestion ? "The question on this one was written for this pack from the course material. The marking points are statements from the course material, arranged by this pack, not an examiner's scheme."
      : authored ? "Some marking points here were written for this pack from the course material. They are labelled, and they are not an examiner's scheme." : '';
    if (warning) block.append(h('p', { class: 'mnx-feedback mnx-feedback--hint er-callout', 'data-role': 'provenance' }, warning));
    if (deps.reason) block.append(h('p', { class: 'mnx-muted' }, `Offered because: ${deps.reason}`));
    if (activity.note) block.append(h('p', { class: 'mnx-muted' }, activity.note));
    if (resumed) block.append(h('p', { class: 'mnx-feedback mnx-feedback--hint er-callout', role: 'status', 'data-role': 'resumed' },
      draft.phase === 'mark' ? 'Welcome back. You had finished writing, so your answers are shown with the scheme.' : `Welcome back. Your draft was restored, with ${clock(draft.elapsed)} already used.`));
    if (!store.working()) block.append(h('p', { class: 'mnx-muted' }, 'Drafts are not being kept in this window, so finish this one in one sitting.'));
    return block;
  };

  // ── write phase ───────────────────────────────────────────────────────────
  const renderWrite = () => {
    empty(shell);
    shell.append(bar());
    const main = h('main', { class: 'er-main' });
    main.append(headerBlock());
    if (activity.context?.length) main.append(h('section', { class: 'er-context' }, ...activity.context.map((t) => h('p', { class: 'er-prose' }, t))));
    for (const figure of activity.figures ?? []) {
      if (!activity.parts.some((p) => p.figure === figure.id)) { main.append(figureBlock(figure)); placedFigures.add(figure.id); }
    }
    const note = h('p', { class: 'mnx-feedback mnx-feedback--hint er-callout er-pausebanner', role: 'status' }, 'Paused. The timer has stopped and the answer boxes are locked. ', button('Resume', 'primary', () => setPaused(false), { small: true, 'data-action': 'resume' }));
    main.append(note);
    for (const part of activity.parts) {
      const section = h('section', { class: 'er-part', 'data-part': part.id });
      section.append(partHead(part));
      for (const line of part.intro ?? []) section.append(h('p', { class: 'er-prose' }, line));
      const fig = part.figure ? figuresById.get(part.figure) : undefined;
      if (fig && !placedFigures.has(fig.id)) { section.append(figureBlock(fig)); placedFigures.add(fig.id); }
      const promptId = `er-prompt-${activity.id}-${part.id}`;
      section.append(h('p', { class: 'er-prompt', id: promptId }, part.prompt));
      if (part.hint) {
        const slot = h('div', { class: 'er-hint', 'data-role': 'hint' });
        const show = () => { hintsOpen.add(part.id); empty(slot); slot.append(h('p', { class: 'mnx-feedback mnx-feedback--hint er-callout' }, `Hint (${part.hint!.by === 'author' ? 'written for this pack' : part.hint!.by}): ${part.hint!.text}`)); saveSoon(); };
        if (hintsOpen.has(part.id)) show();
        else slot.append(button('Show a hint', 'ghost', show, { small: true, 'data-action': 'hint' }));
        slot.hidden = !deps.settings().showHints && !hintsOpen.has(part.id);
        slot.dataset.hintSlot = part.id;
        section.append(slot);
      }
      const area = h('textarea', { class: 'mnx-textarea er-answer', 'data-answer': part.id, 'aria-labelledby': promptId, spellcheck: 'true', rows: 5, placeholder: 'Write your answer here.' }) as HTMLTextAreaElement;
      area.value = draft.answers[part.id] ?? '';
      const meter = h('p', { class: 'er-meter' });
      const refreshMeter = () => {
        const words = wordCount(area.value);
        const lines = Math.max(0, Math.ceil(words / WORDS_PER_LINE));
        let text = `${words} word${words === 1 ? '' : 's'}`;
        if (part.lines) text += `, about ${lines} of the paper's ${part.lines} lines`;
        if (part.lines && lines > part.lines * 1.25) text += '. Longer than the paper would have allowed.';
        meter.textContent = text;
      };
      area.addEventListener('input', () => { draft.answers[part.id] = area.value; autosize(area); refreshMeter(); saveSoon(); });
      section.append(area, meter);
      main.append(section);
      requestAnimationFrame(() => { autosize(area); refreshMeter(); });
    }
    const footer = h('footer', { class: 'er-footer', 'data-role': 'footer' });
    const renderFooter = () => {
      empty(footer);
      if (footerMode === 'normal') {
        footer.append(
          button('Finish writing and see the scheme', 'primary', () => { footerMode = totalWords(draft) < MIN_WORDS_TO_COUNT ? 'finish' : 'normal'; if (footerMode === 'normal') void toMark(); else renderFooter(); }, { 'data-action': 'finish-writing' }),
          button('End this run', 'ghost', () => { footerMode = 'end'; renderFooter(); }, { 'data-action': 'end' }));
      } else if (footerMode === 'finish') {
        footer.append(h('p', { class: 'er-confirm' }, 'You have written very little. You can look at the scheme, but a run with almost nothing written will not count.'),
          button('Show the scheme anyway', 'primary', () => { footerMode = 'normal'; void toMark(); }, { 'data-action': 'confirm-finish' }),
          button('Keep writing', 'secondary', () => { footerMode = 'normal'; renderFooter(); }));
      } else {
        footer.append(h('p', { class: 'er-confirm' }, 'End this run? It will not count, and your draft is kept so you can come back to it.'),
          button('End the run', 'danger', () => { void endEarly(); }, { 'data-action': 'confirm-end' }),
          button('Keep going', 'secondary', () => { footerMode = 'normal'; renderFooter(); }));
      }
    };
    renderFooter();
    main.append(footer);
    shell.append(main);
    refreshTimer();
    if (!paused) clockwork.start();
  };

  // ── mark phase ────────────────────────────────────────────────────────────
  const updateTotal = () => {
    const { earned, total } = tally(activity, draft.ticks, draft.answers);
    if (refs.total) refs.total.textContent = `Ticked ${formatMarks(earned)} of ${formatMarks(total)} ${unitWord(activity, total)}`;
  };
  const renderMark = () => {
    empty(shell);
    shell.append(bar());
    const main = h('main', { class: 'er-main' });
    main.append(headerBlock());
    main.append(h('section', { class: 'er-guidance' },
      h('h3', { class: 'er-subhead' }, 'How to mark yourself'),
      h('ul', { class: 'er-list' },
        h('li', null, 'Tick a point only if your answer says it clearly enough that a marker would not have to fill in the gap for you.'),
        h('li', null, 'Part of a point is not a tick. Leave it, and notice what was missing.'),
        h('li', null, 'Read the feedback on each part. It says what the cohort lost marks on, so you can see whether you did the same.'))));
    for (const figure of activity.figures ?? []) { if (!activity.parts.some((p) => p.figure === figure.id)) main.append(figureBlock(figure)); }
    const marked = new Set(markedParts(activity, draft.answers).map((p) => p.id));
    for (const part of activity.parts) {
      const section = h('section', { class: 'er-part er-part--mark', 'data-part': part.id });
      section.append(partHead(part), h('p', { class: 'er-prompt er-prompt--quiet' }, part.prompt));
      if (!marked.has(part.id)) {
        section.append(h('p', { class: 'mnx-muted', 'data-role': 'not-marked' }, 'You answered the alternative, so this part is not marked.'),
          h('details', { class: 'er-source-details' }, h('summary', null, 'Show its model answer'), ...paragraphs(part.model.text, 'er-prose')));
        main.append(section);
        continue;
      }
      const fig = part.figure ? figuresById.get(part.figure) : undefined;
      if (fig) section.append(figureBlock(fig));
      const answer = (draft.answers[part.id] ?? '').trim();
      const mine = h('div', { class: 'er-mine' },
        h('h4', { class: 'er-subhead' }, 'Your answer'),
        answer ? h('div', { class: 'er-answer-text', 'data-role': 'my-answer' }, answer) : h('p', { class: 'er-muted' }, 'Nothing written.'));
      const scheme = h('div', { class: 'er-scheme' }, h('h4', { class: 'er-subhead' }, 'Marking scheme'));
      const pointList = h('ul', { class: 'er-points' });
      for (const point of part.points) {
        const key = pointKey(part, point);
        const box = h('input', { type: 'checkbox', 'data-point': key, class: 'er-tick' }) as HTMLInputElement;
        box.checked = draft.ticks[key] === true;
        const row = h('li', { class: 'er-point' },
          h('label', { class: 'er-point__label' }, box,
            h('span', { class: 'er-point__body' },
              h('span', { class: 'er-point__text' }, point.text),
              point.by === 'author' ? h('span', { class: 'mnx-badge mnx-badge--warning er-point__badge' }, 'Written for this pack') : null,
              point.guide ? h('span', { class: 'er-point__guide' }, point.guide) : null),
            h('span', { class: 'er-point__marks' }, `${formatMarks(point.marks)}`)));
        box.addEventListener('change', () => { draft.ticks[key] = box.checked; row.classList.toggle('is-met', box.checked); updateTotal(); saveSoon(); });
        row.classList.toggle('is-met', box.checked);
        pointList.append(row);
      }
      scheme.append(pointList);
      section.append(h('div', { class: 'er-grid' }, mine, scheme));
      const model = h('div', { class: 'er-model' }, h('h4', { class: 'er-subhead' }, modelLabel(part.model.by)), ...paragraphs(part.model.text, 'er-prose'));
      section.append(model);
      if (part.feedback) section.append(h('div', { class: 'er-feedback' }, h('h4', { class: 'er-subhead' }, 'What the feedback says'), ...paragraphs(part.feedback.text, 'er-prose')));
      if (part.pitfalls?.length) {
        const group = h('fieldset', { class: 'er-pitfalls' }, h('legend', { class: 'er-subhead' }, 'Did any of these happen to you?'));
        for (const pit of part.pitfalls) {
          const key = pitfallKey(part, pit.tag);
          const box = h('input', { type: 'checkbox', class: 'er-tick', 'data-pitfall': key }) as HTMLInputElement;
          box.checked = draft.pitfalls[key] === true;
          box.addEventListener('change', () => { draft.pitfalls[key] = box.checked; saveSoon(); });
          group.append(h('label', { class: 'er-pitfall' }, box, h('span', null, pit.text)));
        }
        section.append(group);
      }
      const cites = new Set<string>();
      for (const point of part.points) cites.add(point.cite);
      cites.add(part.model.cite); if (part.feedback) cites.add(part.feedback.cite);
      section.append(h('details', { class: 'er-source-details' }, h('summary', null, 'Where this comes from'), h('ul', { class: 'er-list' }, ...[...cites].map((c) => h('li', null, citeText(c))))));
      main.append(section);
    }
    refs.total = h('p', { class: 'er-total', 'data-role': 'total', role: 'status' });
    const footer = h('footer', { class: 'er-footer er-footer--sticky' },
      refs.total,
      button('Finish and save this run', 'primary', () => { void finish(); }, { 'data-action': 'finish-marking' }));
    main.append(footer);
    shell.append(main);
    updateTotal();
    refreshTimer();
  };

  // ── transitions ───────────────────────────────────────────────────────────
  const toMark = async () => {
    clockwork.stop(); paused = false;
    draft.phase = 'mark';
    await save();
    renderMark();
    shell.scrollIntoView?.({ block: 'start' });
    root.scrollTop = 0;
  };

  const stop = () => { finished = true; dispose(); };

  const finish = async () => {
    const hintsUsed = hintsOpen.size;
    const result = buildResult({ activity, draft, hintsUsed, finished: true });
    const { earned, total } = tally(activity, draft.ticks, draft.answers);
    const elapsed = Math.round(clockwork.seconds());
    stop();
    await store.set(doneKey(activity.id), JSON.stringify({ marks: earned, total, at: Date.now(), valid: result.valid }));
    await store.delete(draftKey(activity.id));
    renderDone(earned, total, result.valid);
    const solved = result.criteria.filter((c) => c.met).map((c) => c.id).slice(0, 128);
    const study = host.props.study;
    host.complete({ completed: true, elapsedSeconds: Math.min(86400, elapsed), practice: result,
      // Only a study launch without a practice launch needs evidence of its own; the host reads the practice report otherwise.
      ...(study && !host.props.practice ? { studyEvidence: { runId: study.runId, taskId: study.taskId, contextFingerprint: study.contextFingerprint,
        solvedStepIds: solved.length ? solved : ['finished'], attempts: 1, hintsUsed } } : {}) });
  };

  const endEarly = async () => {
    const hintsUsed = hintsOpen.size;
    await save();
    const result = buildResult({ activity, draft, hintsUsed, finished: false });
    const elapsed = Math.round(clockwork.seconds());
    stop();
    renderEnded();
    host.complete({ completed: false, elapsedSeconds: Math.min(86400, elapsed), practice: result });
  };

  const leave = async () => { await save(); stop(); deps.onBack?.(); };

  const renderDone = (earned: number, total: number, valid: boolean) => {
    empty(shell);
    const list = h('ul', { class: 'er-list' });
    for (const part of markedParts(activity, draft.answers)) {
      const t = part.points.reduce((n, p) => n + p.marks, 0);
      const e = part.points.reduce((n, p) => n + (draft.ticks[pointKey(part, p)] ? p.marks : 0), 0);
      list.append(h('li', null, `${partLabel(activity, part) || 'Whole answer: '}${formatMarks(e)} of ${formatMarks(t)}`));
    }
    shell.append(h('main', { class: 'er-main er-donepage', 'data-view': 'done' },
      h('h2', { class: 'mnx-title' }, 'Saved'),
      h('p', { class: 'mnx-text', role: 'status' }, `You ticked ${formatMarks(earned)} of ${formatMarks(total)} ${unitWord(activity, total)}.`),
      valid ? null : h('p', { class: 'mnx-muted' }, 'Almost nothing was written, so this run does not count towards your practice record.'),
      list,
      h('p', { class: 'mnx-muted' }, 'The practice record keeps one line for every marking point, so what you missed comes back later.'),
      deps.onBack ? button('Back to the list', 'primary', () => deps.onBack?.(), { 'data-action': 'back-to-list' }) : null));
  };
  const renderEnded = () => {
    empty(shell);
    shell.append(h('main', { class: 'er-main er-donepage', 'data-view': 'ended' },
      h('h2', { class: 'mnx-title' }, 'Run ended'),
      h('p', { class: 'mnx-text', role: 'status' }, 'This run does not count. Your draft is kept, so you can pick it up again.'),
      deps.onBack ? button('Back to the list', 'primary', () => deps.onBack?.(), { 'data-action': 'back-to-list' }) : null));
  };

  // ── settings can change while this is open ────────────────────────────────
  const settingsChanged = () => {
    refreshTimer();
    shell.querySelectorAll<HTMLElement>('[data-hint-slot]').forEach((slot) => { slot.hidden = !deps.settings().showHints && !hintsOpen.has(slot.dataset.hintSlot ?? ''); });
  };
  (shell as HTMLElement & { settingsChanged?: () => void }).settingsChanged = settingsChanged;

  if (draft.phase === 'mark') renderMark(); else renderWrite();
  timerTick = window.setInterval(() => { refreshTimer(); if (draft.phase === 'write' && clockwork.running && Math.round(clockwork.seconds()) % 10 === 0) void save(); }, 500);
}
