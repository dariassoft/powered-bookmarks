import { storageService } from '../shared/StorageService';
import type { FolderNode } from '../shared/types';
import { findOrCreateFolder, saveImportedTab, type ImportOptions } from './importHelpers';

export interface BookmarkImportResult {
  folders: number;
  tabs: number;
  duplicates: number;
}

export class BookmarksImporter {
  async import(options: ImportOptions = {}): Promise<BookmarkImportResult> {
    const [tree] = await chrome.bookmarks.getTree();
    const schema = await storageService.getSchema();
    const rootFolder = schema.nodes[schema.rootFolderId];

    if (!rootFolder || rootFolder.type !== 'folder') {
      throw new Error('Cannot import bookmarks: extension root folder is invalid');
    }

    const result: BookmarkImportResult = { folders: 0, tabs: 0, duplicates: 0 };
    const duplicateStrategy = options.duplicateStrategy ?? 'ignore';
    for (const node of tree.children ?? []) {
      await this.importNode(node, rootFolder, result, duplicateStrategy);
    }
    return result;
  }

  private async importNode(
    node: chrome.bookmarks.BookmarkTreeNode,
    parent: FolderNode,
    result: BookmarkImportResult,
    duplicateStrategy: NonNullable<ImportOptions['duplicateStrategy']>,
  ): Promise<void> {
    if (node.url) {
      const saveResult = await saveImportedTab({
        parentId: parent.id,
        title: node.title || node.url,
        url: node.url,
      }, duplicateStrategy);
      result.tabs += Number(saveResult.saved);
      result.duplicates += Number(saveResult.duplicate);
      return;
    }

    const title = node.title || 'Untitled folder';
    const folderResult = await findOrCreateFolder(parent.id, title);
    result.folders += Number(folderResult.created);

    for (const child of node.children ?? []) {
      await this.importNode(child, folderResult.folder, result, duplicateStrategy);
    }
  }
}

export const bookmarksImporter = new BookmarksImporter();
