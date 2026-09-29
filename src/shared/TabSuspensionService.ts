const RECOVERY_POINTS_KEY = 'tabSuspensionRecoveryPoints';
const MAX_RECOVERY_POINTS = 20;
const ESTIMATED_MB_PER_TAB = 50;

export interface SuspensionCandidate {
  tabId: number;
  title: string;
  url: string;
  faviconUrl?: string;
  groupId: number;
  groupTitle?: string;
  inactiveMinutes: number;
  estimatedMemoryMb: number;
}

interface RecoveryTab {
  tabId: number;
  url: string;
  active: boolean;
  pinned: boolean;
  windowId: number;
  index: number;
}

export interface RecoveryPoint {
  id: string;
  createdAt: number;
  estimatedMemoryMb: number;
  tabs: RecoveryTab[];
}

type RecoveryStorage = Partial<Record<typeof RECOVERY_POINTS_KEY, RecoveryPoint[]>>;

export class TabSuspensionService {
  async analyze(inactiveMinutes: number, excludedDomains: string[]): Promise<SuspensionCandidate[]> {
    const threshold = Date.now() - Math.max(1, inactiveMinutes) * 60_000;
    const excluded = excludedDomains.map((domain) => domain.trim().toLowerCase()).filter(Boolean);
    const tabs = await chrome.tabs.query({});
    const groups = typeof chrome.tabGroups !== 'undefined' && typeof chrome.tabGroups.query === 'function'
      ? await chrome.tabGroups.query({}).catch(() => [])
      : [];
    const groupNames = new Map(groups.map((group) => [group.id, group.title?.trim() || undefined]));

    return tabs.flatMap((tab) => {
      if (tab.id === undefined || !tab.url || tab.active || tab.pinned || tab.audible || tab.discarded) return [];
      if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) return [];
      const hostname = new URL(tab.url).hostname.toLowerCase();
      if (excluded.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return [];
      const lastAccessed = tab.lastAccessed ?? Date.now();
      if (lastAccessed > threshold) return [];
      return [{
        tabId: tab.id,
        title: tab.title || tab.url,
        url: tab.url,
        faviconUrl: tab.favIconUrl,
        groupId: tab.groupId ?? -1,
        groupTitle: groupNames.get(tab.groupId ?? -1),
        inactiveMinutes: Math.max(1, Math.floor((Date.now() - lastAccessed) / 60_000)),
        estimatedMemoryMb: ESTIMATED_MB_PER_TAB,
      }];
    });
  }

  async suspend(tabIds: number[]): Promise<RecoveryPoint> {
    if (typeof chrome.tabs.discard !== 'function') throw new Error('Tab suspension is not supported by this browser');
    const uniqueTabIds = [...new Set(tabIds)];
    const tabs = await Promise.all(uniqueTabIds.map((tabId) => chrome.tabs.get(tabId)));
    const recoverable = tabs.filter((tab) => tab.id !== undefined && tab.url && !tab.active && !tab.pinned && !tab.discarded);
    if (recoverable.length === 0) throw new Error('There are no eligible tabs to suspend');
    const point: RecoveryPoint = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      estimatedMemoryMb: recoverable.length * ESTIMATED_MB_PER_TAB,
      tabs: recoverable.map((tab) => ({
        tabId: tab.id!,
        url: tab.url!,
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        windowId: tab.windowId,
        index: tab.index,
      })),
    };
    await this.storeRecoveryPoint(point);
    for (const tab of recoverable) await chrome.tabs.discard(tab.id!);
    return point;
  }

  async restoreLatest(): Promise<RecoveryPoint | undefined> {
    const points = await this.getRecoveryPoints();
    const point = points.shift();
    if (!point) return undefined;
    const existingTabs = await chrome.tabs.query({});
    const existingIds = new Set(existingTabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
    for (const tab of point.tabs) {
      if (existingIds.has(tab.tabId)) {
        await chrome.tabs.reload(tab.tabId);
      } else {
        await chrome.tabs.create({
          url: tab.url,
          active: false,
          pinned: tab.pinned,
          windowId: tab.windowId,
          index: tab.index
        });
      }
    }
    await chrome.storage.local.set({[RECOVERY_POINTS_KEY]: points});
    return point;
  }

  async getRecoveryPoints(): Promise<RecoveryPoint[]> {
    const stored = await chrome.storage.local.get(RECOVERY_POINTS_KEY) as RecoveryStorage;
    return stored[RECOVERY_POINTS_KEY] ?? [];
  }

  private async storeRecoveryPoint(point: RecoveryPoint): Promise<void> {
    const points = await this.getRecoveryPoints();
    points.unshift(point);
    await chrome.storage.local.set({[RECOVERY_POINTS_KEY]: points.slice(0, MAX_RECOVERY_POINTS)});
  }
}

export const tabSuspensionService = new TabSuspensionService();