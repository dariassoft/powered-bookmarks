import {
  decryptSchema,
  encryptSchema,
  hashEnvelope,
  type StorageSchema,
  type VaultSnapshotDto,
} from '../../packages/shared/src';

const REMOTE_SYNC_KEY = 'remoteSyncState';
const SYNC_API_URL = 'https://tabs.dariassoft.com.ar/api';

interface PendingDeviceLink {
  id: string;
  pollSecret: string;
  userCode: string;
  expiresAt: string;
}

export interface RemoteSyncState {
  apiUrl: string;
  accessToken?: string;
  deviceId?: string;
  revision: number;
  pendingLink?: PendingDeviceLink;
}

export interface DeviceLinkResult {
  userCode: string;
  expiresAt: string;
}

export interface RemotePullResult {
  schema: StorageSchema;
  revision: number;
}

type StoredRemoteSyncState = Partial<Record<typeof REMOTE_SYNC_KEY, RemoteSyncState>>;

export class RemoteSyncService {
  async getState(): Promise<RemoteSyncState> {
    const stored = await chrome.storage.local.get(REMOTE_SYNC_KEY) as StoredRemoteSyncState;
    const state = stored[REMOTE_SYNC_KEY];
    if (!state) {
      return {apiUrl: SYNC_API_URL, revision: 0};
    }
    if (state.apiUrl === SYNC_API_URL) {
      return state;
    }
    const migratedState: RemoteSyncState = {apiUrl: SYNC_API_URL, revision: 0};
    await this.saveState(migratedState);
    return migratedState;
  }

  async startDeviceLink(deviceName: string): Promise<DeviceLinkResult> {
    const response = await this.request<PendingDeviceLink>(SYNC_API_URL, '/device-links', {
      method: 'POST',
      body: JSON.stringify({deviceName, platform: navigator.userAgent}),
    });
    const state: RemoteSyncState = {
      apiUrl: SYNC_API_URL,
      revision: 0,
      pendingLink: response,
    };
    await this.saveState(state);
    return {userCode: response.userCode, expiresAt: response.expiresAt};
  }

  async completeDeviceLink(): Promise<boolean> {
    const state = await this.getState();
    if (!state.apiUrl || !state.pendingLink) throw new Error('No pending device link');
    const result = await this.request<{
      status: 'pending' | 'approved';
      accessToken?: string;
      deviceId?: string;
    }>(state.apiUrl, '/device-links/token', {
      method: 'POST',
      body: JSON.stringify({id: state.pendingLink.id, pollSecret: state.pendingLink.pollSecret}),
    });
    if (result.status === 'pending') return false;
    if (!result.accessToken || !result.deviceId) throw new Error('Invalid device authorization response');
    await this.saveState({
      apiUrl: state.apiUrl,
      accessToken: result.accessToken,
      deviceId: result.deviceId,
      revision: 0,
    });
    return true;
  }

  async push(schema: StorageSchema, masterPassword: string): Promise<VaultSnapshotDto> {
    const state = await this.requireConnectedState();
    const encryptedPayload = await encryptSchema(schema, masterPassword);
    const snapshot = await this.request<VaultSnapshotDto>(state.apiUrl, '/vault', {
      method: 'PUT',
      headers: {Authorization: `Bearer ${state.accessToken}`},
      body: JSON.stringify({
        baseRevision: state.revision,
        encryptedPayload,
        payloadHash: await hashEnvelope(encryptedPayload),
      }),
    });
    await this.saveState({...state, revision: snapshot.revision});
    return snapshot;
  }

  async pull(masterPassword: string): Promise<RemotePullResult> {
    const state = await this.requireConnectedState();
    const snapshot = await this.request<VaultSnapshotDto>(state.apiUrl, '/vault', {
      headers: {Authorization: `Bearer ${state.accessToken}`},
    });
    const schema = await decryptSchema(snapshot.encryptedPayload, masterPassword);
    await this.saveState({...state, revision: snapshot.revision});
    return {schema, revision: snapshot.revision};
  }

  async disconnect(): Promise<void> {
    await chrome.storage.local.remove(REMOTE_SYNC_KEY);
  }

  private async requireConnectedState(): Promise<RemoteSyncState & { accessToken: string }> {
    const state = await this.getState();
    if (!state.apiUrl || !state.accessToken) throw new Error('Extension is not linked to the server');
    return state as RemoteSyncState & { accessToken: string };
  }

  private async saveState(state: RemoteSyncState): Promise<void> {
    await chrome.storage.local.set({[REMOTE_SYNC_KEY]: state});
  }

  private async request<T>(apiUrl: string, path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Content-Type', 'application/json');
    const response = await fetch(`${apiUrl}${path}`, {...options, headers});
    if (!response.ok) {
      const detail = await response.json().catch(() => undefined) as {
        message?: string;
        code?: string
      } | undefined;
      const error = new Error(detail?.message ?? detail?.code ?? `HTTP ${response.status}`) as Error & {
        status?: number
      };
      error.status = response.status;
      throw error;
    }
    return await response.json() as T;
  }
}

export const remoteSyncService = new RemoteSyncService();