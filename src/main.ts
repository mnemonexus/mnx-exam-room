/** Exam Room: past-paper questions, design-the-experiment and read-the-data, marked against the scheme (practice-v1). */
import { getExperienceHost } from '@mnemonexus/addon-sdk';
import { installUi } from '@mnemonexus/addon-ui';
import './style.css';
import { openActivity } from './activity';
import { loadActivity, loadCatalogue } from './data';
import { button, empty, h } from './dom';
import { openHome } from './home';
import { makeStore } from './store';
import type { CatalogueEntry, Launch, Module } from './types';

const host = getExperienceHost();
installUi();
const store = makeStore(host);

type Settings = { timerStyle: 'down' | 'up'; showHints: boolean };
const settings = (): Settings => {
  const s = (host.props.settings ?? {}) as Record<string, unknown>;
  return { timerStyle: s.timerStyle === 'up' ? 'up' : 'down', showHints: s.showHints !== false };
};
host.onUpdate(() => {
  host.root.querySelectorAll<HTMLElement & { settingsChanged?: () => void }>('.er-activity').forEach((node) => node.settingsChanged?.());
});

function fail(message: string) {
  empty(host.root);
  host.root.append(h('div', { class: 'er-root' }, h('main', { class: 'er-main' },
    h('div', { class: 'mnx-error', role: 'alert' }, h('p', { class: 'mnx-error__title' }, 'This could not be opened'), h('p', { class: 'mnx-error__text' }, message)),
    button('Close', 'secondary', () => host.exit(), { 'data-action': 'close' }))));
}

async function run() {
  const entries = await loadCatalogue(host);
  const practice = host.props.practice;
  const show = async (entry: CatalogueEntry, onBack?: () => void, reason?: string) => {
    const launch = entry.launch as unknown as Launch;
    const activity = await loadActivity(host, launch.m as Module, launch.a);
    if (!activity) { fail('This activity is not in the pack. The pack may need reinstalling.'); return; }
    await openActivity(host.root, { host, store, settings, onBack, reason }, activity);
  };
  if (practice) {
    const wanted = (practice.launch as { a?: string }).a;
    const entry = entries.find((e) => e.id === practice.activityId) ?? entries.find((e) => e.id === wanted);
    if (!entry) { fail('This activity is not in the pack. The pack may need reinstalling.'); return; }
    await show(entry, undefined, practice.reason || undefined);
    return;
  }
  const home = (): Promise<void> => openHome(host.root, {
    host, store, entries,
    onOpen: (entry) => { show(entry, () => { void home(); }).catch((error) => fail(String((error as Error)?.message ?? error))); },
  });
  await home();
}

run().catch((error) => fail(String((error as Error)?.message ?? error)));
