import './styles.css';
import { applyTranslations, getMessage } from '../shared/i18n';
import { storageService } from '../shared/StorageService';
import { searchNodes } from '../shared/SearchService';
import { findDuplicateGroups, normalizeUrl } from '../shared/DuplicateService';
import {
  bookmarksImporter,
  htmlBookmarksImporter,
  tabGroupsImporter,
  type ImportOptions,
} from '../importers';
import { buildCsv, buildNetscapeHtml, buildTxt, downloadExport } from '../exporters';
import { createEncryptedArchive, readEncryptedArchive } from '../shared/ArchiveService';
import { syncSchemaToBrowserBookmarks } from '../importers/BrowserBookmarksSync';
import type { BookmarkNode, FolderNode, SortMode, StorageSchema, TabNode } from '../shared/types';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Options page is missing: ${selector}`);
  }
  return element;
};

const tree = required<HTMLDivElement>('#folder-tree');
const content = required<HTMLDivElement>('#folder-content');
const folderTitle = required<HTMLElement>('#folder-title');
const emptyState = required<HTMLElement>('#empty-state');
const details = required<HTMLElement>('#tab-details');
const createFolder = required<HTMLButtonElement>('#create-folder');
const searchInput = required<HTMLInputElement>('#search-input');
const exportHtml = required<HTMLButtonElement>('#export-html');
const exportCsv = required<HTMLButtonElement>('#export-csv');
const exportTxt = required<HTMLButtonElement>('#export-txt');
const exportZip = required<HTMLButtonElement>('#export-zip');
const importZip = required<HTMLButtonElement>('#import-zip');
const zipFileInput = required<HTMLInputElement>('#zip-file-input');
const refreshImport = required<HTMLButtonElement>('#refresh-import');
const importHtml = required<HTMLButtonElement>('#import-html');
const syncBrowserBookmarks = required<HTMLButtonElement>('#sync-browser-bookmarks');
const htmlFileInput = required<HTMLInputElement>('#html-file-input');
const findDuplicates = required<HTMLButtonElement>('#find-duplicates');
const findEmptyFolders = required<HTMLButtonElement>('#find-empty-folders');
const selectAll = required<HTMLButtonElement>('#select-all');
const copySelected = required<HTMLButtonElement>('#copy-selected');
const deleteSelected = required<HTMLButtonElement>('#delete-selected');
const undoAction = required<HTMLButtonElement>('#undo-action');
const redoAction = required<HTMLButtonElement>('#redo-action');
const sortMode = required<HTMLSelectElement>('#sort-mode');
const treeSortMode = required<HTMLSelectElement>('#tree-sort-mode');
const foldersFirst = required<HTMLInputElement>('#folders-first');
const importStatus = required<HTMLElement>('#import-status');
const syncStatus = required<HTMLElement>('#sync-status');
const importStatusText = required<HTMLElement>('#import-status-text');
const importProgress = required<HTMLProgressElement>('#import-progress');
const contextMenu = required<HTMLDivElement>('#context-menu');
const messageModal = required<HTMLDialogElement>('#message-modal');
const messageModalText = required<HTMLElement>('#message-modal-text');
const messageModalClose = required<HTMLButtonElement>('#message-modal-close');
const spinner = required<HTMLElement>('.spinner');
const actionModal = required<HTMLDialogElement>('#action-modal');
const actionModalTitle = required<HTMLElement>('#action-modal-title');
const actionModalMessage = required<HTMLElement>('#action-modal-message');
const actionModalInput = required<HTMLInputElement>('#action-modal-input');
const actionModalCancel = required<HTMLButtonElement>('#action-modal-cancel');
const actionModalConfirm = required<HTMLButtonElement>('#action-modal-confirm');
const linkModal = required<HTMLDialogElement>('#link-modal');
const linkModalHeading = required<HTMLElement>('#link-modal-heading');
const linkModalFolder = required<HTMLElement>('#link-modal-folder');
const linkModalForm = required<HTMLFormElement>('#link-modal-form');
const linkModalUrl = required<HTMLInputElement>('#link-modal-url');
const linkModalTitleInput = required<HTMLInputElement>('#link-modal-title-input');
const linkModalCancel = required<HTMLButtonElement>('#link-modal-cancel');
const linkModalConfirm = required<HTMLButtonElement>('#link-modal-confirm');

let schema: StorageSchema;
let masterPassword = '';
let selectedFolderId: string;
let searchQuery = '';
let showDuplicates = false;
let showEmptyFolders = false;
const selectedNodeIds = new Set<string>();
let clipboardNodeIds: string[] = [];
type TreeSortMode = 'title' | 'tabCount' | 'nodeCount';
let selectedTreeSortMode: TreeSortMode = 'title';
const expandedFolders = new Set<string>();

async function initialize(): Promise<void> {
  applyTranslations();
  await unlockStorage();
  schema = await storageService.getSchema();
  selectedFolderId = schema.rootFolderId;
  expandedFolders.add(schema.rootFolderId);
  syncStatus.textContent = getMessage(
    'syncDisabledZipAvailable',
  );
  document.addEventListener('click', hideContextMenu);
  document.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || !contextMenu.contains(event.target)) {
      hideContextMenu();
    }

  });
  document.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof Element) ||
      (!contextMenu.contains(event.target) && !event.target.closest('[data-node-id]') && !event.target.closest('#folder-tree') && !event.target.closest('#folder-content'))) {
      hideContextMenu();
    }
  }, true);
  window.addEventListener('blur', hideContextMenu);
  document.addEventListener('scroll', hideContextMenu, true);
  messageModalClose.addEventListener('click', () => messageModal.close());
  actionModalCancel.addEventListener('click', () => actionModal.close());
  linkModalCancel.addEventListener('click', () => linkModal.close());
  tree.addEventListener('contextmenu', (event) => {
    if (event.target === tree) {
      void showContextMenu(event, undefined, schema.rootFolderId);
    }
  });
  content.addEventListener('contextmenu', (event) => {
    const targetElement = event.target as Element;
    if (!targetElement.closest('.content-item')) {
      void showContextMenu(event, undefined, selectedFolderId);
    }
  });
  render();
}

async function unlockStorage(): Promise<void> {
  const hasData = await storageService.hasStoredData();
  while (true) {
    const password = await requestText(
      getMessage(hasData ? 'masterPasswordPrompt' : 'masterPasswordCreatePrompt'),
      '',
      'password',
    );
    if (!password) {
      throw new Error(getMessage('masterPasswordRequired'));
    }
    if (!hasData) {
      const confirmation = await requestText(getMessage('masterPasswordConfirm'), '', 'password');
      if (confirmation !== password) {
        showMessage(getMessage('masterPasswordMismatch'));
        continue;
      }
    }
    try {
      await storageService.unlock(password);
      masterPassword = password;
      return;
    } catch {
      showMessage(getMessage('masterPasswordInvalid'));
    }
  }
}

function render(): void {
  renderTree();
  renderFolder();
  undoAction.disabled = !storageService.canUndo();
  redoAction.disabled = !storageService.canRedo();
}

function renderTree(): void {
  const fragment = document.createDocumentFragment();
  appendFolderToTree(schema.rootFolderId, fragment);
  tree.replaceChildren(fragment);
}

function appendFolderToTree(folderId: string, parent: DocumentFragment | HTMLElement): void {
  const folder = getFolder(folderId);
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.draggable = folder.id !== schema.rootFolderId;
  row.dataset.nodeId = folder.id;
  addDragHandlers(row, folder.id);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'collapse-toggle';
  toggle.textContent = expandedFolders.has(folder.id) ? '−' : '+';
  toggle.title = getMessage('toggleFolder');
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFolder(folder.id);
  });
  row.append(toggle);
  row.append(createSelectionCheckbox(folder));

  const button = document.createElement('button');
  button.type = 'button';
  button.className = folder.id === selectedFolderId ? 'tree-item selected' : 'tree-item';
  button.textContent = folder.title;
  button.title = folder.title;
  button.addEventListener('click', () => {
    selectedFolderId = folder.id;
    showEmptyFolders = false;
    hideDetails();
    render();
  });
  row.addEventListener('contextmenu', (event) => {
    event.stopPropagation();
    void showContextMenu(event, folder, folder.id);
  });
  button.addEventListener('contextmenu', (event) => {
    event.stopPropagation();
    void showContextMenu(event, folder, folder.id);
  });
  row.append(button);
  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = String(countDescendantNodes(folder.id));
  count.title = `${count.textContent} ${getMessage('nodesCount')}`;
  count.setAttribute('aria-label', count.title);
  row.append(count);
  parent.append(row);

  if (!expandedFolders.has(folder.id)) {
    return;
  }

  const children = document.createElement('div');
  children.className = 'tree-children';
  const childFolders = folder.children
    .map((childId) => schema.nodes[childId])
    .filter((node): node is FolderNode => node?.type === 'folder')
    .sort(compareTreeFolders);
  for (const child of childFolders) {
    appendFolderToTree(child.id, children);
  }
  parent.append(children);
}

function renderFolder(): void {
  const folder = getFolder(selectedFolderId);
  let nodes = showEmptyFolders
    ? listEmptyFolders()
    : searchQuery
    ? searchNodes(schema, searchQuery)
    : folder.children.map((id) => schema.nodes[id]).filter(isNode);
  if (showDuplicates) {
    nodes = findDuplicateGroups(schema).flatMap((group) => group.tabs);
  }

  if (foldersFirst.checked) {
    nodes = [
      ...nodes.filter((node) => node.type === 'folder'),
      ...nodes.filter((node) => node.type === 'tab'),
    ];
  }
  nodes = storageService.sortNodes(nodes, parseSortMode(sortMode.value));
  folderTitle.textContent = showDuplicates
    ? getMessage('duplicateResults')
    : showEmptyFolders
      ? getMessage('emptyFolderResults')
      : searchQuery ? getMessage('searchResults') : folder.title;

  const fragment = document.createDocumentFragment();
  for (const node of nodes) {
    fragment.append(createItem(node));
  }

  content.replaceChildren(fragment);
  emptyState.hidden = nodes.length > 0;
  updateSelectionControls();
}

function listEmptyFolders(): FolderNode[] {
  return Object.values(schema.nodes).filter(
    (node): node is FolderNode =>
      node.type === 'folder' &&
      node.id !== schema.rootFolderId &&
      countDescendantTabs(node.id) === 0,
  );
}

function createItem(node: BookmarkNode): HTMLElement {
  if (node.type === 'folder') {
    return createFolderItem(node);
  }

  const item = document.createElement('article');
  item.className = 'content-item';
  item.draggable = true;
  item.dataset.nodeId = node.id;
  addDragHandlers(item, node.id);
  item.addEventListener('click', () => showDetails(node));
  item.addEventListener('dblclick', () => void openTab(node).catch(reportError));
  item.addEventListener('contextmenu', (event) => {
    event.stopPropagation();
    void showContextMenu(event, node, node.parentId ?? selectedFolderId);
  });

  item.append(createSelectionCheckbox(node));

  const image = createVisual(node);
  item.append(image);
  const title = document.createElement('strong');
  title.className = 'item-title';
  title.textContent = node.title;
  title.title = `${node.title}\n${node.url}`;
  item.append(title);
  const link = document.createElement('span');
  link.className = 'item-url';
  link.textContent = node.url;
  link.title = node.url;
  item.append(link);
  return item;
}

function createFolderItem(folder: FolderNode): HTMLElement {
  const item = document.createElement('section');
  item.className = 'content-item folder-card';
  item.dataset.nodeId = folder.id;
  item.draggable = folder.id !== schema.rootFolderId;
  addDragHandlers(item, folder.id);
  item.addEventListener('contextmenu', (event) => {
    event.stopPropagation();
    void showContextMenu(event, folder, folder.id);
  });

  const header = document.createElement('div');
  header.className = 'folder-card-header';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'collapse-toggle';
  toggle.textContent = expandedFolders.has(folder.id) ? '−' : '+';
  toggle.title = getMessage('toggleFolder');
  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFolder(folder.id);
  });
  header.append(toggle);
  header.append(createSelectionCheckbox(folder));
  const title = document.createElement('strong');
  title.className = 'item-title';
  title.textContent = folder.title;
  title.title = folder.title;
  title.addEventListener('click', () => {
    selectedFolderId = folder.id;
    render();
  });
  title.addEventListener('contextmenu', (event) => {
    event.stopPropagation();
    void showContextMenu(event, folder, folder.id);
  });
  header.append(title);
  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = String(countDescendantNodes(folder.id));
  count.title = `${count.textContent} ${getMessage('nodesCount')}`;
  count.setAttribute('aria-label', count.title);
  header.append(count);
  item.append(header);

  if (expandedFolders.has(folder.id)) {
    const children = document.createElement('div');
    children.className = 'nested-items';
    for (const childId of folder.children) {
      const child = schema.nodes[childId];
      if (child) {
        children.append(createItem(child));
      }
    }
    item.append(children);
  }
  return item;
}

function createVisual(tab: TabNode): HTMLImageElement {
  const image = document.createElement('img');
  image.loading = 'lazy';
  image.alt = '';
  image.className = 'item-visual';
  image.src = tab.screenshot ?? safeFaviconUrl(tab.faviconUrl) ?? faviconForUrl(tab.url) ?? '';
  image.onerror = () => {
    image.onerror = null;
    const fallback = faviconForUrl(tab.url);
    if (fallback) {
      image.src = fallback;
    } else {
      image.removeAttribute('src');
    }

  };
  return image;
}

function createSelectionCheckbox(node: BookmarkNode): HTMLInputElement {
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'node-selection';
  checkbox.checked = selectedNodeIds.has(node.id);
  checkbox.title = getMessage('selectNode');
  checkbox.addEventListener('click', (event) => event.stopPropagation());
  checkbox.addEventListener('change', () => {
    setNodeSelected(node.id, checkbox.checked);
  });
  return checkbox;
}

function showDetails(tab: TabNode): void {
  details.hidden = false;
  required<HTMLElement>('#details-title').textContent = tab.title;
  required<HTMLElement>('#details-url').textContent = tab.url;
  required<HTMLElement>('#details-description').textContent = tab.description ?? getMessage('noDescription');
  required<HTMLElement>('#details-path').textContent = getNodePath(tab);
  required<HTMLElement>('#details-last-viewed').textContent = new Date(tab.lastViewedAt).toLocaleString();
  const image = required<HTMLImageElement>('#details-image');
  image.src = tab.screenshot ?? safeFaviconUrl(tab.faviconUrl) ?? faviconForUrl(tab.url) ?? '';
  image.hidden = false;
  image.onerror = () => {
    image.onerror = null;
    const fallback = faviconForUrl(tab.url);
    if (fallback) {
      image.src = fallback;
    } else {
      image.removeAttribute('src');
    }
  };
}

function hideDetails(): void {
  details.hidden = true;
}

async function openTab(tab: TabNode): Promise<void> {
  await chrome.tabs.create({ url: tab.url });
  await storageService.updateLastViewedAt(tab.id);
  schema = await storageService.getSchema();
  renderFolder();
  const updatedTab = schema.nodes[tab.id];
  if (!updatedTab || updatedTab.type !== 'tab') {
    throw new Error(`Tab not found after opening: ${tab.id}`);
  }
  showDetails(updatedTab);
}

function addDragHandlers(element: HTMLElement, nodeId: string): void {
  element.addEventListener('dragstart', (event) => {
    const draggedIds = selectedNodeIds.has(nodeId) ? [...selectedNodeIds] : [nodeId];
    event.dataTransfer?.setData('text/plain', JSON.stringify(draggedIds));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  });
  element.addEventListener('dragover', (event) => {
    if (isValidDrop(nodeId)) {
      event.preventDefault();
      element.classList.add('drop-target');
    }
  });
  element.addEventListener('dragleave', () => element.classList.remove('drop-target'));
  element.addEventListener('drop', (event) => {
    event.preventDefault();
    element.classList.remove('drop-target');
    const rawIds = event.dataTransfer?.getData('text/plain');
    if (!rawIds || !isValidDrop(nodeId)) {
      return;
    }
    let sourceIds: string[];
    try {
      sourceIds = JSON.parse(rawIds) as string[];
    } catch {
      return;
    }
    if (!sourceIds.length || sourceIds.includes(nodeId)) {
      return;
    }
    void moveDraggedNodes(sourceIds, nodeId).then(async () => {
      sourceIds.forEach((id) => selectedNodeIds.delete(id));
      schema = await storageService.getSchema();
      render();
    }).catch(reportError);
  });
}

async function moveDraggedNodes(sourceIds: string[], destinationId: string): Promise<void> {
  const destination = getFolder(destinationId);
  for (const sourceId of sourceIds) {
    const source = schema.nodes[sourceId];
    if (!source) {
      continue;
    }
    const matchingFolder = source.type === 'folder'
      ? (destination.title === source.title
        ? destination
        : destination.children
          .map((childId) => schema.nodes[childId])
          .find((child): child is FolderNode => child?.type === 'folder' && child.title === source.title))
      : undefined;
    if (matchingFolder && matchingFolder.id !== source.id) {
      await storageService.mergeFolders(source.id, matchingFolder.id);
    } else {
      await storageService.moveNode(source.id, destination.id);
    }
  }
}

function isValidDrop(destinationId: string): boolean {
  const destination = schema.nodes[destinationId];
  return destination?.type === 'folder';
}

function toggleFolder(folderId: string): void {
  if (expandedFolders.has(folderId)) {
    expandedFolders.delete(folderId);
  } else {
    expandedFolders.add(folderId);
  }
  render();
}

interface OpenTabItem {
  id?: number;
  title: string;
  url: string;
  favIconUrl?: string;
  groupId?: number;
}

interface OpenTabGroup {
  id: number;
  title: string;
  color?: string;
  tabs: OpenTabItem[];
}

interface OpenTabsData {
  groups: OpenTabGroup[];
  ungroupedTabs: OpenTabItem[];
  allTabs: OpenTabItem[];
}

async function getOpenTabsData(): Promise<OpenTabsData> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return { groups: [], ungroupedTabs: [], allTabs: [] };
  }
  try {
    const rawTabs = await chrome.tabs.query({});
    const validTabs: OpenTabItem[] = rawTabs
      .filter((tab) => tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:') && !tab.url.startsWith('chrome-extension://') && !tab.url.startsWith('moz-extension://'))
      .map((tab) => ({
        id: tab.id,
        title: tab.title || tab.url || getMessage('openTab'),
        url: tab.url ?? '',
        favIconUrl: tab.favIconUrl,
        groupId: tab.groupId,
      }));

    const tabGroupsMap: Map<number, { title: string; color?: string }> = new Map();
    if (typeof chrome.tabGroups !== 'undefined' && typeof chrome.tabGroups.query === 'function') {
      try {
        const groups = await chrome.tabGroups.query({});
        for (const g of groups) {
          tabGroupsMap.set(g.id, {
            title: g.title?.trim() || `${getMessage('tabGroupLabel').replace('{group}', String(g.id))}`,
            color: g.color,
          });
        }
      } catch {
        // Fallback
      }
    }

    const groups: OpenTabGroup[] = [];
    const ungroupedTabs: OpenTabItem[] = [];
    const groupedBuckets = new Map<number, OpenTabItem[]>();

    for (const tab of validTabs) {
      if (tab.groupId !== undefined && tab.groupId > -1) {
        if (!groupedBuckets.has(tab.groupId)) {
          groupedBuckets.set(tab.groupId, []);
        }
        groupedBuckets.get(tab.groupId)!.push(tab);
      } else {
        ungroupedTabs.push(tab);
      }
    }

    for (const [groupId, tabs] of groupedBuckets.entries()) {
      const info = tabGroupsMap.get(groupId);
      groups.push({
        id: groupId,
        title: info?.title || `${getMessage('tabGroupLabel').replace('{group}', String(groupId))}`,
        color: info?.color,
        tabs,
      });
    }

    return { groups, ungroupedTabs, allTabs: validTabs };
  } catch (error) {
    console.warn('Could not query open tabs', error);
    return { groups: [], ungroupedTabs: [], allTabs: [] };
  }
}

async function fetchTitleFromUrl(url: string, allOpenTabs: OpenTabItem[] = []): Promise<string> {
  const matchingTab = allOpenTabs.find((t) => t.url.trim() === url.trim() || normalizeUrl(t.url) === normalizeUrl(url));
  if (matchingTab?.title) {
    return matchingTab.title;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);
      try {
        const response = await fetch(url, { signal: controller.signal, mode: 'cors' });
        if (response.ok) {
          const html = await response.text();
          const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (match && match[1]?.trim()) {
            return match[1].trim();
          }
        }
      } catch {
        // CORS or network failure
      } finally {
        window.clearTimeout(timeoutId);
      }

      if (parsed.hostname) {
        return parsed.hostname.replace(/^www\./, '');
      }
    }
  } catch {
    // Non-URL string
  }
  return '';
}

function determineTargetFolderId(targetNode?: BookmarkNode, targetFolderId?: string): string {
  if (targetFolderId && schema.nodes[targetFolderId]?.type === 'folder') {
    return targetFolderId;
  }
  if (targetNode) {
    if (targetNode.type === 'folder') {
      return targetNode.id;
    }
    if (targetNode.parentId && schema.nodes[targetNode.parentId]?.type === 'folder') {
      return targetNode.parentId;
    }
  }
  if (selectedFolderId && schema.nodes[selectedFolderId]?.type === 'folder') {
    return selectedFolderId;
  }
  return schema.rootFolderId;
}

async function showContextMenu(
  event: MouseEvent,
  node?: BookmarkNode,
  targetFolderId?: string,
): Promise<void> {
  event.preventDefault();
  event.stopPropagation();
  contextMenu.replaceChildren();

  const folderId = determineTargetFolderId(node, targetFolderId);

  const addMenuButton = (messageName: string, action: () => void | Promise<void>) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = getMessage(messageName);
    button.addEventListener('click', () => {
      hideContextMenu();
      void Promise.resolve(action()).catch(reportError);
    });
    contextMenu.append(button);
    return button;
  };

  if (node) {
    if (node.type === 'tab') {
      addMenuButton('openTab', () => openTab(node));
    } else if (node.type === 'folder') {
      addMenuButton('openAsGroup', () => openFolderAsGroup(node));
    }
    addMenuButton('editNode', () => renameNode(node));
    addMenuButton('renameNode', () => renameNode(node));
    addMenuButton('removeNode', () => void removeNode(node));
    addMenuButton('deleteNode', () => void deleteNode(node));
    addMenuButton('copyNode', () => copyNodesToSystemClipboard(
      selectedNodeIds.has(node.id) ? [...selectedNodeIds] : [node.id],
    ));
    if (clipboardNodeIds.length) {
      addMenuButton('pasteNode', () => pasteNode(node));
    }
    if (node.type === 'tab') {
      addMenuButton('refreshThumbnail', () => refreshThumbnail(node));
    }
  }

  addMenuButton('addLink', () => {
    void promptAddLink(folderId);
  });

  const addFromOpenTabsItem = await createOpenTabsSubmenuItem(folderId);
  contextMenu.append(addFromOpenTabsItem);

  contextMenu.hidden = false;
  const menuWidth = 220;
  const menuHeight = 320;
  const posX = Math.min(event.clientX, window.innerWidth - menuWidth - 10);
  const posY = Math.min(event.clientY, window.innerHeight - menuHeight - 10);
  contextMenu.style.left = `${Math.max(10, posX)}px`;
  contextMenu.style.top = `${Math.max(10, posY)}px`;

  const submenu = contextMenu.querySelector<HTMLElement>('.context-submenu');
  if (submenu) {
    if (posX + menuWidth + 260 > window.innerWidth) {
      submenu.classList.add('align-left');
    } else {
      submenu.classList.remove('align-left');
    }
  }
}

async function createOpenTabsSubmenuItem(folderId: string): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.className = 'context-menu-item-with-submenu';

  const triggerButton = document.createElement('button');
  triggerButton.type = 'button';
  triggerButton.textContent = getMessage('addFromOpenTabs');
  triggerButton.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  container.append(triggerButton);

  const submenu = document.createElement('div');
  submenu.className = 'context-submenu';

  const tabsData = await getOpenTabsData();
  const hasTabs = tabsData.allTabs.length > 0;

  if (!hasTabs) {
    const empty = document.createElement('div');
    empty.className = 'context-submenu-empty';
    empty.textContent = getMessage('noOpenTabs');
    submenu.append(empty);
  } else {
    for (const group of tabsData.groups) {
      const header = document.createElement('div');
      header.className = 'context-submenu-header';
      header.textContent = `📁 ${group.title}`;
      if (group.color) {
        header.style.borderLeft = `3px solid ${group.color}`;
      }
      submenu.append(header);

      for (const tab of group.tabs) {
        submenu.append(createSubmenuTabButton(tab, folderId));
      }
    }

    if (tabsData.ungroupedTabs.length > 0) {
      if (tabsData.groups.length > 0) {
        const header = document.createElement('div');
        header.className = 'context-submenu-header';
        header.textContent = `🌐 ${getMessage('ungroupedTabs')}`;
        submenu.append(header);
      }
      for (const tab of tabsData.ungroupedTabs) {
        submenu.append(createSubmenuTabButton(tab, folderId));
      }
    }
  }

  container.append(submenu);
  return container;
}

function createSubmenuTabButton(tab: OpenTabItem, folderId: string): HTMLButtonElement {
  const tabButton = document.createElement('button');
  tabButton.type = 'button';
  tabButton.className = 'context-submenu-tab';
  tabButton.title = `${tab.title}\n${tab.url}`;

  if (tab.favIconUrl) {
    const icon = document.createElement('img');
    icon.src = tab.favIconUrl;
    icon.alt = '';
    icon.loading = 'lazy';
    icon.onerror = () => {
      icon.remove();
    };
    tabButton.append(icon);
  }

  const titleSpan = document.createElement('span');
  titleSpan.textContent = tab.title;
  tabButton.append(titleSpan);

  tabButton.addEventListener('click', () => {
    hideContextMenu();
    void promptAddLink(folderId, {
      url: tab.url,
      title: tab.title,
      faviconUrl: tab.favIconUrl,
    });
  });

  return tabButton;
}

function promptAddLink(
  targetFolderId: string,
  prefill?: { url?: string; title?: string; faviconUrl?: string },
): Promise<void> {
  return new Promise((resolve) => {
    const folder = (schema.nodes[targetFolderId]?.type === 'folder'
      ? schema.nodes[targetFolderId]
      : schema.nodes[schema.rootFolderId]) as FolderNode;

    linkModalFolder.textContent = getMessage('targetFolderLabel').replace('{folder}', folder.title);
    linkModalUrl.value = prefill?.url ?? '';
    linkModalTitleInput.value = prefill?.title ?? '';

    let userModifiedTitle = Boolean(prefill?.title);
    let isFetchingTitle = false;

    const onTitleInput = () => {
      userModifiedTitle = true;
    };
    linkModalTitleInput.addEventListener('input', onTitleInput);

    const autoFetchTitle = async () => {
      const rawUrl = linkModalUrl.value.trim();
      if (!rawUrl || isFetchingTitle) {
        return;
      }
      if (!userModifiedTitle || !linkModalTitleInput.value.trim()) {
        isFetchingTitle = true;
        try {
          const openTabsData = await getOpenTabsData();
          let fullUrl = rawUrl;
          if (!/^([a-z]+:)?\/\//i.test(fullUrl) && fullUrl.includes('.') && !fullUrl.includes(' ')) {
            fullUrl = `https://${fullUrl}`;
          }
          const detectedTitle = await fetchTitleFromUrl(fullUrl, openTabsData.allTabs);
          if (detectedTitle && (!userModifiedTitle || !linkModalTitleInput.value.trim())) {
            linkModalTitleInput.value = detectedTitle;
          }
        } finally {
          isFetchingTitle = false;
        }
      }
    };

    const onUrlChange = () => {
      void autoFetchTitle();
    };

    linkModalUrl.addEventListener('input', onUrlChange);
    linkModalUrl.addEventListener('blur', onUrlChange);
    linkModalUrl.addEventListener('paste', () => {
      window.setTimeout(() => void autoFetchTitle(), 50);
    });

    const cleanup = () => {
      linkModalTitleInput.removeEventListener('input', onTitleInput);
      linkModalUrl.removeEventListener('input', onUrlChange);
      linkModalUrl.removeEventListener('blur', onUrlChange);
      linkModalForm.onsubmit = null;
      linkModalCancel.onclick = null;
    };

    linkModalCancel.onclick = () => {
      cleanup();
      linkModal.close();
      resolve();
    };

    linkModalForm.onsubmit = async (event) => {
      event.preventDefault();
      let finalUrl = linkModalUrl.value.trim();
      if (!finalUrl) {
        return;
      }
      if (!/^([a-z]+:)?\/\//i.test(finalUrl)) {
        finalUrl = `https://${finalUrl}`;
      }
      try {
        new URL(finalUrl);
      } catch {
        showMessage(getMessage('invalidUrl'));
        return;
      }

      const finalTitle = linkModalTitleInput.value.trim() || finalUrl;
      const finalFavicon = prefill?.faviconUrl || (finalUrl.startsWith('http') ? faviconForUrl(finalUrl) : undefined);

      cleanup();
      linkModal.close();

      try {
        await storageService.createTab({
          title: finalTitle,
          url: finalUrl,
          parentId: folder.id,
          faviconUrl: finalFavicon,
        });
        schema = await storageService.getSchema();
        render();
        showMessage(getMessage('linkAdded'));
      } catch (err) {
        reportError(err);
      }
      resolve();
    };

    if (!linkModal.open) {
      linkModal.showModal();
    }

    if (!prefill?.url) {
      linkModalUrl.focus();
    } else if (!prefill?.title) {
      linkModalTitleInput.focus();
      void autoFetchTitle();
    } else {
      linkModalConfirm.focus();
    }
  });
}

function hideContextMenu(): void {
  contextMenu.hidden = true;
}

async function renameNode(node: BookmarkNode): Promise<void> {
  const title = await requestText(getMessage('renamePrompt'), node.title);
  if (title) {
    await storageService.renameNode(node.id, title);
    schema = await storageService.getSchema();
    render();
  }
}

async function removeNode(node: BookmarkNode): Promise<void> {
  if (!node.parentId || node.id === schema.rootFolderId) {
    return;
  }
  await storageService.moveNode(node.id, schema.rootFolderId);
  schema = await storageService.getSchema();
  render();
}

async function deleteNode(node: BookmarkNode): Promise<void> {
  if (await requestConfirmation(getMessage('deleteConfirm'))) {
    await storageService.deleteNode(node.id);
    schema = await storageService.getSchema();
    selectedFolderId = schema.nodes[selectedFolderId]?.type === 'folder' ? selectedFolderId : schema.rootFolderId;
    render();
  }
}

async function pasteNode(target: BookmarkNode): Promise<void> {
  if (!clipboardNodeIds.length) {
    return;
  }
  const destinationId = target.type === 'folder' ? target.id : target.parentId;
  if (!destinationId) {
    throw new Error('Cannot paste into the root node');
  }
  await storageService.copyNodes(clipboardNodeIds, destinationId);
  schema = await storageService.getSchema();
  render();
}

function setNodeSelected(nodeId: string, selected: boolean): void {
  if (selected) {
    selectedNodeIds.add(nodeId);
  } else {
    selectedNodeIds.delete(nodeId);
  }
  refreshRenderedCheckboxes();
  updateSelectionControls();
}

function refreshRenderedCheckboxes(): void {
  document.querySelectorAll<HTMLInputElement>('.node-selection').forEach((checkbox) => {
    const nodeId = checkbox.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    if (nodeId) {
      checkbox.checked = selectedNodeIds.has(nodeId);
    }
  });
}

function updateSelectionControls(): void {
  const hasSelection = selectedNodeIds.size > 0;
  copySelected.disabled = !hasSelection;
  deleteSelected.disabled = !hasSelection;
  const ids = visibleSelectableIds();
  selectAll.textContent = getMessage(
    ids.length > 0 && ids.every((id) => selectedNodeIds.has(id)) ? 'deselectAll' : 'selectAll',
  );
}

function visibleSelectableIds(): string[] {
  return [...new Set(
    Array.from(content.querySelectorAll<HTMLElement>('[data-node-id]'))
      .map((element) => element.dataset.nodeId)
      .filter((id): id is string => id !== undefined && schema.nodes[id] !== undefined),
  )];
}

async function deleteSelectedNodes(): Promise<void> {
  if (!(await requestConfirmation(getMessage('deleteSelectedConfirm')))) {
    return;
  }
  await storageService.deleteNodes([...selectedNodeIds]);
  selectedNodeIds.clear();
  schema = await storageService.getSchema();
  render();
}

async function refreshThumbnail(node: BookmarkNode): Promise<void> {
  if (node.type !== 'tab') {
    return;
  }
  setImportState(true, getMessage('thumbnailInProgress'), 0);
  try {
    await chrome.runtime.sendMessage({
      type: 'refresh-thumbnail',
      nodeId: node.id,
      url: node.url,
      masterPassword,
    });
    schema = await storageService.getSchema();
    render();
    const updatedNode = schema.nodes[node.id];
    if (updatedNode?.type === 'tab') {
      showDetails(updatedNode);
    }
    setImportState(false, getMessage('thumbnailCompleted'), 1);
  } catch (error) {
    setImportState(false, getMessage('thumbnailFailed'), 0);
    throw error;
  }
}

async function runImport(options: ImportOptions): Promise<void> {
  setImportState(true, getMessage('importInProgress'), 0);
  try {
    const bookmarks = await bookmarksImporter.import(options);
    setImportState(true, getMessage('groupsImportInProgress'), 0.5);
    const groups = await tabGroupsImporter.import(options);
    schema = await storageService.getSchema();
    showDuplicates = false;
    render();
    const message = `${getMessage('importCompleted')} ${bookmarks.tabs + groups.tabs} ${getMessage('tabsImported')}; ` +
      `${groups.groups} ${getMessage('groupsImported')}.`;
    setImportState(false, message, 1);
    showMessage(message);
  } catch (error) {
    setImportState(false, getMessage('operationFailed'), 0);
    throw error;
  }
}

function setImportState(active: boolean, message: string, progress: number): void {
  importStatus.hidden = false;
  importStatusText.textContent = message;
  importProgress.hidden = !active;
  importProgress.value = progress;
  spinner.hidden = !active;
  refreshImport.disabled = active;
  if (!active) {
    window.setTimeout(() => { importStatus.hidden = true; }, 3000);
  }
}

function getFolder(folderId: string): FolderNode {
  const node = schema.nodes[folderId];
  if (!node || node.type !== 'folder') {
    throw new Error(`Folder not found: ${folderId}`);
  }
  return node;
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

function safeFaviconUrl(url: string | undefined): string | undefined {
  return url && !url.startsWith('file:') ? url : undefined;
}

function isNode(node: BookmarkNode | undefined): node is BookmarkNode {
  return node !== undefined;
}

function parseSortMode(value: string): SortMode {
  if (value === 'title' || value === 'createdAt' || value === 'lastViewedAt' ||
    value === 'domain' || value === 'url') {
    return value;
  }
  throw new Error(`Unsupported sort mode: ${value}`);
}

function parseTreeSortMode(value: string): TreeSortMode {
  if (value === 'title' || value === 'tabCount' || value === 'nodeCount') {
    return value;
  }
  throw new Error(`Unsupported tree sort mode: ${value}`);
}

function compareTreeFolders(left: FolderNode, right: FolderNode): number {
  if (selectedTreeSortMode === 'title') {
    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  }
  const leftCount = selectedTreeSortMode === 'tabCount'
    ? countDescendantTabs(left.id)
    : countDescendantNodes(left.id);
  const rightCount = selectedTreeSortMode === 'tabCount'
    ? countDescendantTabs(right.id)
    : countDescendantNodes(right.id);
  return rightCount - leftCount || left.title.localeCompare(right.title);
}

function countDescendantTabs(folderId: string): number {
  return getFolder(folderId).children.reduce((count, childId) => {
    const child = schema.nodes[childId];
    return count + (child?.type === 'tab' ? 1 : child ? countDescendantTabs(child.id) : 0);
  }, 0);
}

function countDescendantNodes(folderId: string): number {
  return getFolder(folderId).children.reduce((count, childId) => {
    const child = schema.nodes[childId];
    return count + (child?.type === 'folder' ? 1 + countDescendantNodes(child.id) : 1);
  }, 0);
}

async function copyNodesToSystemClipboard(nodeIds: string[]): Promise<void> {
  clipboardNodeIds = nodeIds;
  if (!navigator.clipboard?.writeText) {
    throw new Error(getMessage('clipboardUnavailable'));
  }
  const lines = nodeIds.flatMap((nodeId) => {
    const node = schema.nodes[nodeId];
    if (!node) {
      return [];
    }
    return getPlainTextLines(node);
  });
  await navigator.clipboard.writeText(lines.join('\n'));
  showMessage(getMessage('copyCompleted'));
}

function getPlainTextLines(node: BookmarkNode): string[] {
  const path = getNodePath(node);
  if (node.type === 'tab') {
    return [`${path}\t${node.title}\t${node.url}`];
  }
  return [
    `${path}\t${node.title}`,
    ...node.children.flatMap((childId) => {
      const child = schema.nodes[childId];
      return child ? getPlainTextLines(child) : [];
    }),
  ];
}

function getNodePath(node: BookmarkNode): string {
  const path: string[] = [];
  let current: BookmarkNode | undefined = node;
  while (current?.parentId) {
    path.unshift(current.title);
    current = schema.nodes[current.parentId];
  }
  return path.join(' / ');
}

createFolder.addEventListener('click', () => {
  void requestText(getMessage('folderNamePrompt'), '').then((title) => {
    if (!title) {
      return;
    }
    return storageService.createFolder({ parentId: selectedFolderId, title })
      .then(async () => { schema = await storageService.getSchema(); render(); });
  }).catch(reportError);
});

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  showDuplicates = false;
  showEmptyFolders = false;
  hideDetails();
  renderFolder();
});
sortMode.addEventListener('change', renderFolder);
treeSortMode.addEventListener('change', () => {
  selectedTreeSortMode = parseTreeSortMode(treeSortMode.value);
  renderTree();
});
foldersFirst.addEventListener('change', renderFolder);
selectAll.addEventListener('click', () => {
  const ids = visibleSelectableIds();
  const allSelected = ids.length > 0 && ids.every((id) => selectedNodeIds.has(id));
  if (allSelected) {
    selectedNodeIds.clear();
  } else {
    ids.forEach((id) => selectedNodeIds.add(id));
  }
  refreshRenderedCheckboxes();
  updateSelectionControls();
});
copySelected.addEventListener('click', () => {
  void copyNodesToSystemClipboard([...selectedNodeIds]).catch(reportError);
});
deleteSelected.addEventListener('click', () => {
  void deleteSelectedNodes().catch(reportError);
});
refreshImport.addEventListener('click', () => {
  void runImport({ duplicateStrategy: 'ignore' }).catch(reportError);
});
importHtml.addEventListener('click', () => htmlFileInput.click());
syncBrowserBookmarks.addEventListener('click', () => {
  void syncBrowserBookmarkTree().catch(reportError);
});
htmlFileInput.addEventListener('change', () => {
  const file = htmlFileInput.files?.item(0);
  if (!file) {
    return;
  }
  void runHtmlImport(file).catch(reportError);
  htmlFileInput.value = '';
});
findDuplicates.addEventListener('click', () => {
  showEmptyFolders = false;
  void showDuplicateResults().catch(reportError);
});
findEmptyFolders.addEventListener('click', () => {
  showEmptyFolders = true;
  showDuplicates = false;
  searchQuery = '';
  searchInput.value = '';
  hideDetails();
  renderFolder();
});
exportHtml.addEventListener('click', () => downloadExport(buildNetscapeHtml(schema), 'bookmarks.html', 'text/html'));
exportCsv.addEventListener('click', () => downloadExport(buildCsv(schema), 'bookmarks.csv', 'text/csv'));
exportTxt.addEventListener('click', () => downloadExport(buildTxt(schema), 'bookmarks.txt', 'text/plain'));
exportZip.addEventListener('click', () => {
  void exportEncryptedZip().catch(reportError);
});
importZip.addEventListener('click', () => zipFileInput.click());
zipFileInput.addEventListener('change', () => {
  const file = zipFileInput.files?.item(0);
  if (!file) {
    return;
  }
  void importEncryptedZip(file).catch(reportError);
  zipFileInput.value = '';
});
undoAction.addEventListener('click', () => {
  void storageService.undo().then((updatedSchema) => {
    schema = updatedSchema;
    render();
  }).catch(reportError);
});
redoAction.addEventListener('click', () => {
  void storageService.redo().then((updatedSchema) => {
    schema = updatedSchema;
    render();
  }).catch(reportError);
});

async function showDuplicateResults(): Promise<void> {
  setImportState(true, getMessage('duplicatesInProgress'), 0);
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  try {
    const duplicateGroups = findDuplicateGroups(schema);
    showDuplicates = true;
    searchQuery = '';
    searchInput.value = '';
    hideDetails();
    renderFolder();
    const count = duplicateGroups.reduce((total, group) => total + group.tabs.length, 0);
    const message = count === 0
      ? getMessage('noDuplicatesFound')
      : `${getMessage('duplicatesFound')}: ${count}`;
    setImportState(false, message, 1);
    showMessage(message);
  } catch (error) {
    setImportState(false, getMessage('operationFailed'), 0);
    throw error;
  }

}

async function runHtmlImport(file: File): Promise<void> {
  setImportState(true, getMessage('htmlImportInProgress'), 0);
  try {
    const result = await htmlBookmarksImporter.importFile(file, { duplicateStrategy: 'ignore' });
    schema = await storageService.getSchema();
    render();
    const message = `${getMessage('importCompleted')} ${result.tabs} ${getMessage('tabsImported')}.`;
    setImportState(false, message, 1);
    showMessage(message);
  } catch (error) {
    setImportState(false, getMessage('htmlImportFailed'), 0);
    throw error;
  }
}

async function openFolderAsGroup(folder: FolderNode): Promise<void> {
  const tabs = collectFolderTabs(folder);
  if (tabs.length === 0) {
    showMessage(getMessage('folderHasNoTabs'));
    return;
  }

  const createdTabs = await Promise.all(tabs.map((tab) => chrome.tabs.create({ url: tab.url, active: false })));
  const tabIds = createdTabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]);
  if (typeof chrome.tabs.group === 'function' && typeof chrome.tabGroups !== 'undefined' &&
    typeof chrome.tabGroups.update === 'function' && tabIds.length > 0) {
    const groupTabIds = [tabIds[0], ...tabIds.slice(1)] as [number, ...number[]];
    const groupId = await chrome.tabs.group({ tabIds: groupTabIds }) as number;
    await chrome.tabGroups.update(groupId, { title: folder.title });
    return;
  }

  const bookmarkFolder = await chrome.bookmarks.create({ title: folder.title });
  await Promise.all(tabs.map((tab) => chrome.bookmarks.create({
    parentId: bookmarkFolder.id,
    title: tab.title,
    url: tab.url,
  })));
  if (tabIds.length > 0) {
    await chrome.tabs.remove(tabIds);
  }
}

function collectFolderTabs(folder: FolderNode): TabNode[] {
  const tabs: TabNode[] = [];
  for (const childId of folder.children) {
    const child = schema.nodes[childId];
    if (!child) {
      continue;
    }
    if (child.type === 'tab') {
      tabs.push(child);
    } else {
      tabs.push(...collectFolderTabs(child));
    }
  }
  return tabs;
}

function reportError(error: unknown): void {
  console.error(error);
  showMessage(error instanceof Error ? error.message : getMessage('operationFailed'));
}

async function exportEncryptedZip(): Promise<void> {
  const payload = await storageService.exportEncryptedSnapshot();
  const archive = createEncryptedArchive(
    payload,
    getMessage('zipReadme'),
  );
  const archiveBuffer = archive.buffer.slice(
    archive.byteOffset,
    archive.byteOffset + archive.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([archiveBuffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gestor-pestanas-backup.zip';
  anchor.click();
  URL.revokeObjectURL(url);
}

async function importEncryptedZip(file: File): Promise<void> {
  setImportState(true, getMessage('zipImportInProgress'), 0);
  try {
    const archive = readEncryptedArchive(new Uint8Array(await file.arrayBuffer()));
    await storageService.importEncryptedSnapshot(archive);
    schema = await storageService.getSchema();
    selectedFolderId = schema.rootFolderId;
    showDuplicates = false;
    showEmptyFolders = false;
    render();
    setImportState(false, getMessage('zipImportCompleted'), 1);
  } catch (error) {
    setImportState(false, getMessage('zipImportFailed'), 0);
    throw error;
  }
}

async function syncBrowserBookmarkTree(): Promise<void> {
  if (!(await requestConfirmation(getMessage('syncBrowserBookmarksConfirm')))) {
    return;
  }
  setImportState(true, getMessage('syncBrowserBookmarksInProgress'), 0);
  try {
    const result = await syncSchemaToBrowserBookmarks(schema, getMessage('managedBookmarksFolder'));
    setImportState(false, getMessage('syncBrowserBookmarksCompleted')
      .replace('{tabs}', String(result.tabs))
      .replace('{folders}', String(result.folders)), 1);
  } catch (error) {
    setImportState(false, getMessage('syncBrowserBookmarksFailed'), 0);
    throw error;
  }
}

function showMessage(message: string): void {
  messageModalText.textContent = message;
  if (!messageModal.open) {
    messageModal.showModal();
  }
}

function requestConfirmation(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    actionModalTitle.textContent = getMessage('extensionName');
    actionModalMessage.textContent = message;
    actionModalInput.hidden = true;
    actionModalConfirm.onclick = () => {
      actionModal.close();
      resolve(true);
    };
    actionModalCancel.onclick = () => {
      actionModal.close();
      resolve(false);
    };
    actionModal.showModal();
  });
}

function requestText(
  message: string,
  value: string,
  inputType: 'text' | 'password' = 'text',
): Promise<string | undefined> {
  return new Promise((resolve) => {
    actionModalTitle.textContent = getMessage('extensionName');
    actionModalMessage.textContent = message;
    actionModalInput.hidden = false;
    actionModalInput.type = inputType;
    actionModalInput.value = value;
    actionModalConfirm.onclick = () => {
      const result = actionModalInput.value.trim();
      actionModal.close();
      resolve(result || undefined);
    };
    actionModalCancel.onclick = () => {
      actionModal.close();
      resolve(undefined);
    };
    actionModal.showModal();
    actionModalInput.focus();
    actionModalInput.select();
  });
}

void initialize().catch(reportError);
