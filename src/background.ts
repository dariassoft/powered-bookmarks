import { storageService } from './shared/StorageService';
import type { TabNode } from './shared/types';

const SCREENSHOT_WIDTH = 400;
const SCREENSHOT_HEIGHT = 250;
const SCREENSHOT_QUALITY = 0.65;

export interface SaveTabMessage {
  type: 'save-tab';
  tabId: number;
  parentId?: string;
  masterPassword?: string;
}

interface RefreshThumbnailMessage {
  type: 'refresh-thumbnail';
  nodeId: string;
  url: string;
  masterPassword: string;
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isSaveTabMessage(message)) {
    return saveTab(message);
  }
  if (isRefreshThumbnailMessage(message)) {
    return refreshThumbnail(message);
  }
});

async function saveTab(message: SaveTabMessage): Promise<TabNode> {
  if (message.masterPassword) {
    await storageService.unlock(message.masterPassword);
  }
  const tab = await chrome.tabs.get(message.tabId);
  if (!tab.url) {
    throw new Error(`Cannot save tab without URL: ${message.tabId}`);
  }

  const screenshot = await captureScreenshot(tab);
  return storageService.createTab({
    parentId: message.parentId,
    title: tab.title || tab.url,
    url: tab.url,
    screenshot,
    faviconUrl: screenshot ? undefined : tab.favIconUrl,
  });
}

async function refreshThumbnail(message: RefreshThumbnailMessage): Promise<TabNode> {
  await storageService.unlock(message.masterPassword);
  const [matchingTab] = await chrome.tabs.query({ url: message.url });
  let screenshot = matchingTab?.active && matchingTab.windowId !== undefined
    ? await captureScreenshot(matchingTab)
    : undefined;

  if (!screenshot && !message.url.startsWith('chrome://') && !message.url.startsWith('about:')) {
    screenshot = await captureUrlInTemporaryTab(message.url);
  }

  return storageService.updateTabVisuals(message.nodeId, {
    screenshot,
    faviconUrl: faviconForUrl(message.url),
  });
}

async function captureUrlInTemporaryTab(url: string): Promise<string | undefined> {
  if (typeof chrome.tabs.captureVisibleTab !== 'function') {
    return undefined;
  }

  const [previousTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const temporaryTab = await chrome.tabs.create({ url, active: true });
  if (temporaryTab.id === undefined || temporaryTab.windowId === undefined) {
    return undefined;
  }

  try {
    await chrome.tabs.update(temporaryTab.id, { active: true });
    await waitForTabLoaded(temporaryTab.id);
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    const currentTab = await chrome.tabs.get(temporaryTab.id);
    return await captureScreenshot({ ...currentTab, active: true });
  } finally {
    if (previousTab?.id !== undefined) {
      await chrome.tabs.update(previousTab.id, { active: true });
    }
    await chrome.tabs.remove(temporaryTab.id);
  }
}

async function waitForTabLoaded(tabId: number): Promise<void> {
  const currentTab = await chrome.tabs.get(tabId);
  if (currentTab.status === 'complete') {
    return;
  }

  const loaded = new Promise<void>((resolve) => {
    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
  await Promise.race([
    loaded,
    new Promise<void>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function captureScreenshot(tab: chrome.tabs.Tab): Promise<string | undefined> {
  if (typeof chrome.tabs.captureVisibleTab !== 'function' || tab.windowId === undefined) {
    return undefined;
  }

  try {
    const source = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return await resizeScreenshot(source);
  } catch (error) {
    console.warn('Visible tab capture unavailable; using favicon fallback', error);
    return undefined;
  }
}

async function resizeScreenshot(dataUrl: string): Promise<string> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(SCREENSHOT_WIDTH, SCREENSHOT_HEIGHT);
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('Unable to create screenshot canvas context');
  }

  context.drawImage(bitmap, 0, 0, SCREENSHOT_WIDTH, SCREENSHOT_HEIGHT);
  bitmap.close();
  const compressed = await canvas.convertToBlob({
    type: 'image/webp',
    quality: SCREENSHOT_QUALITY,
  });
  return `data:image/webp;base64,${await blobToBase64(compressed)}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isSaveTabMessage(message: unknown): message is SaveTabMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<SaveTabMessage>;
  return candidate.type === 'save-tab' && typeof candidate.tabId === 'number';
}

function isRefreshThumbnailMessage(message: unknown): message is RefreshThumbnailMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<RefreshThumbnailMessage>;
  return candidate.type === 'refresh-thumbnail' &&
    typeof candidate.nodeId === 'string' &&
    typeof candidate.url === 'string' &&
    typeof candidate.masterPassword === 'string' &&
    candidate.masterPassword.length > 0;
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
