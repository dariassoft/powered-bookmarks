import { storageService } from '../shared/StorageService';
import { findOrCreateFolder, saveImportedTab, type ImportOptions } from './importHelpers';

export interface TabGroupImportResult {
  groups: number;
  tabs: number;
  duplicates: number;
}

export class TabGroupsImporter {
  async import(options: ImportOptions = {}): Promise<TabGroupImportResult> {
    if (!this.isSupported()) {
      return { groups: 0, tabs: 0, duplicates: 0 };
    }

    const [groups, tabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
    const result: TabGroupImportResult = { groups: 0, tabs: 0, duplicates: 0 };
    const duplicateStrategy = options.duplicateStrategy ?? 'ignore';

    for (const group of groups) {
      const groupTabs = tabs.filter((tab) => tab.groupId === group.id && tab.id !== undefined);
      if (groupTabs.length === 0) {
        continue;
      }

      const folderResult = await findOrCreateFolder(
        (await storageService.getSchema()).rootFolderId,
        group.title || 'Untitled tab group',
      );
      const folder = folderResult.folder;
      const importedTabIds: number[] = [];

      for (const tab of groupTabs) {
        if (!tab.url) {
          continue;
        }

        const saveResult = await saveImportedTab({
          parentId: folder.id,
          title: tab.title || tab.url,
          url: tab.url,
          faviconUrl: tab.favIconUrl,
        }, duplicateStrategy);
        result.duplicates += Number(saveResult.duplicate);
        if (saveResult.saved && tab.id !== undefined) {
          importedTabIds.push(tab.id);
        }
      }

      if (importedTabIds.length > 0) {
        await chrome.tabs.remove(importedTabIds);
      }
      result.groups += 1;
      result.tabs += importedTabIds.length;
    }

    return result;
  }

  private isSupported(): boolean {
    return typeof chrome.tabGroups !== 'undefined' && typeof chrome.tabGroups.query === 'function';
  }
}

export const tabGroupsImporter = new TabGroupsImporter();
