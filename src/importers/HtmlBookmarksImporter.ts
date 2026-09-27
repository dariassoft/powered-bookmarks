import { findOrCreateFolder, saveImportedTab, type ImportOptions } from './importHelpers';
import { storageService } from '../shared/StorageService';

export interface HtmlImportResult {
  folders: number;
  tabs: number;
  duplicates: number;
}

export class HtmlBookmarksImporter {
  async importFile(file: File, options: ImportOptions = {}): Promise<HtmlImportResult> {
    const document = new DOMParser().parseFromString(await file.text(), 'text/html');
    const root = await storageService.getSchema();
    const result: HtmlImportResult = { folders: 0, tabs: 0, duplicates: 0 };
    const rootElement = document.querySelector('DL');

    if (!rootElement) {
      throw new Error('The selected file is not a Netscape bookmarks HTML file');
    }

    await this.importList(rootElement, root.rootFolderId, result, options);
    return result;
  }

  private async importList(
    list: Element,
    parentId: string,
    result: HtmlImportResult,
    options: ImportOptions,
  ): Promise<void> {
    for (const element of Array.from(list.children)) {
      if (element.tagName.toUpperCase() !== 'DT') {
        continue;
      }

      const folderHeading = element.querySelector(':scope > H3');
      const link = element.querySelector<HTMLAnchorElement>(':scope > A');
      if (folderHeading) {
        const folderResult = await findOrCreateFolder(parentId, folderHeading.textContent?.trim() || 'Imported folder');
        result.folders += Number(folderResult.created);
        const childList = element.querySelector(':scope > DL');
        if (childList) {
          await this.importList(childList, folderResult.folder.id, result, options);
        }
      } else if (link?.href) {
        const saveResult = await saveImportedTab({
          parentId,
          title: link.textContent?.trim() || link.href,
          url: link.href,
        }, options.duplicateStrategy ?? 'ignore');
        result.tabs += Number(saveResult.saved);
        result.duplicates += Number(saveResult.duplicate);
      }
    }
  }
}

export const htmlBookmarksImporter = new HtmlBookmarksImporter();
