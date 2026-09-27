import { findDuplicatesForUrl, type DuplicateStrategy } from '../shared/DuplicateService';
import { storageService } from '../shared/StorageService';
import type { FolderNode } from '../shared/types';

export interface ImportOptions {
  duplicateStrategy?: DuplicateStrategy;
}

export interface ImportedTabInput {
  parentId: string;
  title: string;
  url: string;
  faviconUrl?: string;
}

export interface SaveImportedTabResult {
  saved: boolean;
  duplicate: boolean;
}

export async function saveImportedTab(
  input: ImportedTabInput,
  strategy: DuplicateStrategy,
): Promise<SaveImportedTabResult> {
  const duplicates = await findDuplicatesForUrl(await storageService.getSchema(), input.url);
  if (duplicates.length === 0) {
    await storageService.createTab({
      ...input,
      faviconUrl: input.faviconUrl ?? faviconForUrl(input.url),
    });
    return { saved: true, duplicate: false };
  }

  if (strategy === 'ignore') {
    return { saved: false, duplicate: true };
  }
  if (strategy === 'remove') {
    for (const duplicate of duplicates) {
      await storageService.deleteNode(duplicate.id);
    }
  }

  await storageService.createTab({
    ...input,
    faviconUrl: input.faviconUrl ?? faviconForUrl(input.url),
    title: strategy === 'rename' ? `${input.title} (${duplicates.length + 1})` : input.title,
  });
  return { saved: true, duplicate: true };
}

function faviconForUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return undefined;
    }
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

export async function findOrCreateFolder(parentId: string, title: string): Promise<{ folder: FolderNode; created: boolean }> {
  const schema = await storageService.getSchema();
  const parent = schema.nodes[parentId];
  if (!parent || parent.type !== 'folder') {
    throw new Error(`Import parent folder not found: ${parentId}`);
  }

  const existing = parent.children
    .map((childId) => schema.nodes[childId])
    .find((child) => child?.type === 'folder' && child.title === title);
  if (existing?.type === 'folder') {
    return { folder: existing, created: false };
  }

  return {
    folder: await storageService.createFolder({ parentId, title }),
    created: true,
  };
}
