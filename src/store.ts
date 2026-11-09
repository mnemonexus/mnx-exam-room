/**
 * mnx.storage with a fallback. Storage is optional: a refusal must never interrupt someone who is writing an answer.
 * The memory copy keeps this session's drafts even when the bridge says no.
 */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import type { DoneRecord } from './types';

export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  /** False once a write has been refused, so the screen can say drafts are not being kept. */
  readonly working: () => boolean;
}

export function makeStore(host: ExperienceHost): Store {
  const memory = new Map<string, string>();
  let ok = host.props.permissions.includes('storage:local');
  return {
    working: () => ok,
    async get(key) {
      if (ok) {
        try { const value = await host.storage.get(key); if (value !== null) return value; } catch { ok = false; }
      }
      return memory.get(key) ?? null;
    },
    async set(key, value) {
      memory.set(key, value);
      if (!ok) return false;
      try { await host.storage.set(key, value); return true; } catch { ok = false; return false; }
    },
    async delete(key) {
      memory.delete(key);
      if (!ok) return;
      try { await host.storage.delete(key); } catch { ok = false; }
    },
    async keys() {
      const names = new Set(memory.keys());
      if (ok) { try { for (const k of await host.storage.keys()) names.add(k); } catch { ok = false; } }
      return [...names];
    },
  };
}

export const draftKey = (id: string) => `draft:${id}`;
export const doneKey = (id: string) => `done:${id}`;

export function parseDone(raw: string | null): DoneRecord | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<DoneRecord>;
    if (typeof d.marks === 'number' && typeof d.total === 'number' && typeof d.at === 'number') return { marks: d.marks, total: d.total, at: d.at, valid: d.valid !== false };
  } catch { /* ignore a damaged record */ }
  return null;
}
