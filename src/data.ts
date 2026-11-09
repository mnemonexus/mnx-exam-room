/** Reading the catalogue, the content files and the figures from the pack's assets. */
import type { ExperienceHost } from '@mnemonexus/addon-sdk';
import type { PracticeCatalogue } from '@mnemonexus/addon-sdk/practice';
import type { Activity, CatalogueEntry, Module } from './types';

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

export async function loadCatalogue(host: ExperienceHost): Promise<CatalogueEntry[]> {
  const catalogue = JSON.parse(decode(await host.asset('assets/practice/catalogue.json'))) as PracticeCatalogue;
  return catalogue.activities as CatalogueEntry[];
}

const modules = new Map<Module, Promise<Record<string, Activity>>>();
export async function loadActivity(host: ExperienceHost, module: Module, id: string): Promise<Activity | null> {
  let pending = modules.get(module);
  if (!pending) {
    pending = host.asset(`assets/content/${module}.json`).then((buffer) => (JSON.parse(decode(buffer)) as { activities: Record<string, Activity> }).activities);
    modules.set(module, pending);
    pending.catch(() => modules.delete(module));
  }
  return (await pending)[id] ?? null;
}

const urls = new Map<string, Promise<string>>();
/** The sandbox only shows images from blob: and data: URLs. */
export function figureUrl(host: ExperienceHost, src: string): Promise<string> {
  let url = urls.get(src);
  if (!url) {
    const type = src.endsWith('.png') ? 'image/png' : 'image/jpeg';
    url = host.asset(src).then((buffer) => URL.createObjectURL(new Blob([buffer], { type })));
    urls.set(src, url);
    url.catch(() => urls.delete(src));
  }
  return url;
}
