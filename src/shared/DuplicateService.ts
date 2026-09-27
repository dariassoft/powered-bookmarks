import type { StorageSchema, TabNode } from './types';

export type DuplicateStrategy = 'keep' | 'rename' | 'remove' | 'ignore';

export interface DuplicateGroup {
  url: string;
  tabs: TabNode[];
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLocaleLowerCase();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function findDuplicateGroups(schema: StorageSchema): DuplicateGroup[] {
  const byUrl = new Map<string, TabNode[]>();
  for (const node of Object.values(schema.nodes)) {
    if (node.type !== 'tab') {
      continue;
    }
    const key = normalizeUrl(node.url);
    const tabs = byUrl.get(key) ?? [];
    tabs.push(node);
    byUrl.set(key, tabs);
  }

  return [...byUrl.entries()]
    .filter(([, tabs]) => tabs.length > 1)
    .map(([url, tabs]) => ({ url, tabs }));
}

export function findDuplicatesForUrl(schema: StorageSchema, url: string): TabNode[] {
  const normalizedUrl = normalizeUrl(url);
  return Object.values(schema.nodes).filter(
    (node): node is TabNode => node.type === 'tab' && normalizeUrl(node.url) === normalizedUrl,
  );
}
