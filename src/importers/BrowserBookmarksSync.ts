import type { FolderNode, StorageSchema } from '../shared/types';

export interface BrowserBookmarksSyncResult {
  folderTitle: string;
  tabs: number;
  folders: number;
}

export async function syncSchemaToBrowserBookmarks(
  schema: StorageSchema,
  managedTitle: string,
): Promise<BrowserBookmarksSyncResult> {
  if (typeof chrome.bookmarks?.getTree !== 'function') {
    throw new Error('Browser bookmarks API is unavailable');
  }

  const roots = await chrome.bookmarks.getTree();
  const managedFolder = findTopLevelFolder(roots, managedTitle) ??
    await chrome.bookmarks.create({ parentId: getCreationParentId(roots), title: managedTitle });

  const existingChildren = managedFolder.children ?? [];
  await Promise.all(existingChildren.map((child) => chrome.bookmarks.removeTree(child.id)));

  const root = schema.nodes[schema.rootFolderId];
  if (!root || root.type !== 'folder') {
    throw new Error('Extension root folder not found');
  }

  let tabs = 0;
  let folders = 0;
  for (const childId of root.children) {
    const child = schema.nodes[childId];
    if (!child) {
      continue;
    }
    if (child.type === 'tab') {
      await chrome.bookmarks.create({ parentId: managedFolder.id, title: child.title, url: child.url });
      tabs += 1;
    } else {
      await createFolder(child, managedFolder.id);
      folders += 1 + countFolders(child);
      tabs += countTabs(child);
    }
  }

  return { folderTitle: managedTitle, tabs, folders };

  async function createFolder(folder: FolderNode, parentId: string): Promise<void> {
    const created = await chrome.bookmarks.create({ parentId, title: folder.title });
    for (const childId of folder.children) {
      const child = schema.nodes[childId];
      if (!child) {
        continue;
      }
      if (child.type === 'tab') {
        await chrome.bookmarks.create({ parentId: created.id, title: child.title, url: child.url });
      } else {
        await createFolder(child, created.id);
      }
    }
  }

  function countTabs(folder: FolderNode): number {
    return folder.children.reduce((count, childId) => {
      const child = schema.nodes[childId];
      return count + (child?.type === 'tab' ? 1 : child?.type === 'folder' ? countTabs(child) : 0);
    }, 0);
  }

  function countFolders(folder: FolderNode): number {
    return folder.children.reduce((count, childId) => {
      const child = schema.nodes[childId];
      return count + (child?.type === 'folder' ? 1 + countFolders(child) : 0);
    }, 0);
  }
}

function findTopLevelFolder(
  roots: chrome.bookmarks.BookmarkTreeNode[],
  title: string,
): chrome.bookmarks.BookmarkTreeNode | undefined {
  return roots
    .flatMap((root) => root.children ?? [])
    .find((node) => node.url === undefined && node.title === title);
}

function getCreationParentId(roots: chrome.bookmarks.BookmarkTreeNode[]): string {
  const root = roots[0];
  const preferred = root?.children?.find((node) => node.url === undefined);
  return preferred?.id ?? root?.id ?? '1';
}
