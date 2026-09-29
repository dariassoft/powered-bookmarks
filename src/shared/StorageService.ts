import type {
  BookmarkNode,
  FolderNode,
  NodeId,
  SortMode,
  StorageSchema,
  TabNode,
  EncryptedArchive,
} from './types';
import { normalizeUrl } from './DuplicateService';

const STORAGE_KEY = 'storageSchema';
const SYNC_MANIFEST_KEY = 'storageSchemaSyncManifest';
const SYNC_CHUNK_PREFIX = 'storageSchemaSyncChunk_';
const SYNC_CHUNK_SIZE = 3500;
const SYNC_SAFE_TOTAL_BYTES = 90_000;
const ROOT_FOLDER_ID = 'root';

type StorageRecord = Partial<Record<typeof STORAGE_KEY, unknown>>;
interface SyncManifest {
  chunkCount: number;
}
type EncryptedPayload = EncryptedArchive;

export interface CreateTabInput {
  title: string;
  url: string;
  parentId?: NodeId;
  screenshot?: string;
  faviconUrl?: string;
  description?: string;
}

export interface CreateFolderInput {
  title: string;
  parentId?: NodeId;
}

export class StorageService {
  private history: StorageSchema[] = [];
  private redoHistory: StorageSchema[] = [];
  private lastSavedSchema: StorageSchema | undefined;
  private syncError = false;
  private masterPassword: string | undefined;

  async getSchema(): Promise<StorageSchema> {
    if (!this.masterPassword) {
      throw new Error('Storage is locked');
    }
    const localStored = (await chrome.storage.local.get(STORAGE_KEY)) as StorageRecord;
    const localSchema = await this.decodeSchemaValue(localStored[STORAGE_KEY]);
    const schema = localSchema;

    if (!schema) {
      return this.initialize();
    }

    this.assertValidSchema(schema);
    this.lastSavedSchema = this.cloneSchema(schema);
    if (localSchema && !this.isEncryptedPayload(localStored[STORAGE_KEY])) {
      await this.writeSchema(schema);
    }
    return schema;
  }

  async hasStoredData(): Promise<boolean> {
    const localStored = await chrome.storage.local.get(STORAGE_KEY);
    return localStored[STORAGE_KEY] !== undefined;
  }

  async unlock(password: string): Promise<void> {
    if (!password) {
      throw new Error('A master password is required');
    }
    this.masterPassword = password;
    try {
      await this.getSchema();
    } catch (error) {
      this.masterPassword = undefined;
      throw new Error('Invalid master password', { cause: error });
    }
  }

  isSyncSupported(): boolean {
    return false;
  }

  isSyncAvailable(): boolean {
    return false;
  }

  async exportEncryptedSnapshot(): Promise<EncryptedPayload> {
    return this.encryptSchema(await this.getSchema());
  }

  async importEncryptedSnapshot(payload: unknown): Promise<void> {
    if (!this.isEncryptedPayload(payload)) {
      throw new Error('Invalid encrypted archive');
    }
    const imported = await this.decryptSchema(payload);
    this.assertValidSchema(imported);
    await this.writeSchema(imported);
  }

  async initialize(): Promise<StorageSchema> {
    const now = Date.now();
    const schema: StorageSchema = {
      rootFolderId: ROOT_FOLDER_ID,
      nodes: {
        [ROOT_FOLDER_ID]: {
          id: ROOT_FOLDER_ID,
          parentId: null,
          title: 'root',
          type: 'folder',
          createdAt: now,
          lastViewedAt: now,
          children: [],
        },
      },
    };

    await this.saveSchema(schema);
    return schema;
  }

  canUndo(): boolean {
    return this.history.length > 0;
  }

  canRedo(): boolean {
    return this.redoHistory.length > 0;
  }

  async undo(): Promise<StorageSchema> {
    const previous = this.history.pop();
    if (!previous) {
      throw new Error('No action to undo');
    }
    const current = await this.getSchema();
    this.redoHistory.push(this.cloneSchema(current));
    await this.writeSchema(previous);
    return previous;
  }

  async redo(): Promise<StorageSchema> {
    const next = this.redoHistory.pop();
    if (!next) {
      throw new Error('No action to redo');
    }
    const current = await this.getSchema();
    this.history.push(this.cloneSchema(current));
    await this.writeSchema(next);
    return next;
  }

  async createFolder(input: CreateFolderInput): Promise<FolderNode> {
    const schema = await this.getSchema();
    const parentId = input.parentId ?? schema.rootFolderId;
    const parent = this.requireFolder(schema, parentId);
    const now = Date.now();
    const folder: FolderNode = {
      id: this.createId(),
      parentId,
      title: input.title,
      type: 'folder',
      createdAt: now,
      lastViewedAt: now,
      children: [],
    };

    schema.nodes[folder.id] = folder;
    parent.children.push(folder.id);
    await this.saveSchema(schema);
    return folder;
  }

  async createTab(input: CreateTabInput): Promise<TabNode> {
    const schema = await this.getSchema();
    const parentId = input.parentId ?? schema.rootFolderId;
    const parent = this.requireFolder(schema, parentId);
    const now = Date.now();
    const tab: TabNode = {
      id: this.createId(),
      parentId,
      title: input.title,
      type: 'tab',
      createdAt: now,
      lastViewedAt: now,
      url: input.url,
      ...(input.screenshot === undefined ? {} : { screenshot: input.screenshot }),
      ...(input.faviconUrl === undefined ? {} : { faviconUrl: input.faviconUrl }),
      ...(input.description === undefined ? {} : { description: input.description }),
    };

    schema.nodes[tab.id] = tab;
    parent.children.push(tab.id);
    await this.saveSchema(schema);
    return tab;
  }

  async moveNode(nodeId: NodeId, destinationId: NodeId): Promise<void> {
    const schema = await this.getSchema();
    const node = this.requireNode(schema, nodeId);
    const destination = this.requireFolder(schema, destinationId);

    if (node.id === schema.rootFolderId) {
      throw new Error('The root folder cannot be moved');
    }
    if (node.id === destination.id) {
      throw new Error('A node cannot be moved into itself');
    }
    if (node.type === 'folder' && this.containsNode(schema, node.id, destination.id)) {
      throw new Error('A folder cannot be moved into one of its descendants');
    }

    const currentParent = node.parentId ? this.requireFolder(schema, node.parentId) : null;
    if (currentParent) {
      currentParent.children = currentParent.children.filter((id) => id !== node.id);
    }
    node.parentId = destination.id;
    destination.children.push(node.id);
    await this.saveSchema(schema);
  }

  async renameNode(nodeId: NodeId, title: string): Promise<void> {
    const schema = await this.getSchema();
    const node = this.requireNode(schema, nodeId);
    node.title = title;
    await this.saveSchema(schema);
  }

  async updateLastViewedAt(nodeId: NodeId, viewedAt = Date.now()): Promise<void> {
    const schema = await this.getSchema();
    const node = this.requireNode(schema, nodeId);
    node.lastViewedAt = viewedAt;
    await this.saveSchema(schema);
  }

  async updateTabVisuals(
    nodeId: NodeId,
    visuals: Pick<TabNode, 'screenshot' | 'faviconUrl'>,
  ): Promise<TabNode> {
    const schema = await this.getSchema();
    const node = this.requireNode(schema, nodeId);
    if (node.type !== 'tab') {
      throw new Error(`Node is not a tab: ${nodeId}`);
    }

    if (visuals.screenshot !== undefined) {
      node.screenshot = visuals.screenshot;
    }
    if (visuals.faviconUrl !== undefined) {
      node.faviconUrl = visuals.faviconUrl;
    }
    await this.saveSchema(schema);
    return node;
  }

  async copyNode(nodeId: NodeId, destinationId: NodeId): Promise<BookmarkNode> {
    const schema = await this.getSchema();
    const source = this.requireNode(schema, nodeId);
    const destination = this.requireFolder(schema, destinationId);
    if (source.id === schema.rootFolderId) {
      throw new Error('The root folder cannot be copied');
    }

    if (source.id === destination.id) {
      throw new Error('A node cannot be copied into itself');
    }
    if (source.type === 'folder' && this.containsNode(schema, source.id, destination.id)) {
      throw new Error('A folder cannot be copied into one of its descendants');
    }

    const clone = this.cloneNode(schema, source, destination.id);
    schema.nodes[clone.id] = clone;
    destination.children.push(clone.id);
    await this.saveSchema(schema);
    return clone;
  }

  async moveNodes(nodeIds: NodeId[], destinationId: NodeId): Promise<void> {
    for (const nodeId of nodeIds) {
      await this.moveNode(nodeId, destinationId);
    }
  }

  async mergeFolders(sourceId: NodeId, destinationId: NodeId): Promise<void> {
    const schema = await this.getSchema();
    const source = this.requireFolder(schema, sourceId);
    const destination = this.requireFolder(schema, destinationId);
    if (source.id === schema.rootFolderId) {
      throw new Error('The root folder cannot be merged');
    }
    if (source.id === destination.id) {
      throw new Error('A folder cannot be merged into itself');
    }
    if (this.containsNode(schema, source.id, destination.id)) {
      throw new Error('A folder cannot be merged into one of its descendants');
    }

    this.mergeFolderChildren(schema, source, destination);
    const sourceParent = source.parentId ? this.requireFolder(schema, source.parentId) : null;
    sourceParent?.children.splice(sourceParent.children.indexOf(source.id), 1);
    delete schema.nodes[source.id];
    await this.saveSchema(schema);
  }

  async copyNodes(nodeIds: NodeId[], destinationId: NodeId): Promise<BookmarkNode[]> {
    const copied: BookmarkNode[] = [];
    for (const nodeId of nodeIds) {
      copied.push(await this.copyNode(nodeId, destinationId));
    }
    return copied;
  }

  async deleteNodes(nodeIds: NodeId[]): Promise<void> {
    for (const nodeId of nodeIds) {
      const schema = await this.getSchema();
      if (schema.nodes[nodeId]) {
        await this.deleteNode(nodeId);
      }
    }
  }

  async findTabsByUrl(url: string): Promise<TabNode[]> {
    const schema = await this.getSchema();
    const normalizedUrl = normalizeUrl(url);
    return Object.values(schema.nodes).filter(
      (node): node is TabNode => node.type === 'tab' && normalizeUrl(node.url) === normalizedUrl,
    );
  }

  async deleteNode(nodeId: NodeId): Promise<void> {
    const schema = await this.getSchema();
    if (nodeId === schema.rootFolderId) {
      throw new Error('The root folder cannot be deleted');
    }

    const node = this.requireNode(schema, nodeId);
    const parent = node.parentId ? this.requireFolder(schema, node.parentId) : null;
    if (parent) {
      parent.children = parent.children.filter((id) => id !== nodeId);
    }

    const idsToDelete = this.collectDescendants(schema, node);
    idsToDelete.forEach((id) => {
      delete schema.nodes[id];
    });
    await this.saveSchema(schema);
  }

  sortChildren(schema: StorageSchema, folderId: NodeId, sortMode: SortMode): BookmarkNode[] {
    const folder = this.requireFolder(schema, folderId);
    return this.sortNodes(folder.children
      .map((id) => this.requireNode(schema, id))
      , sortMode);
  }

  sortNodes(nodes: BookmarkNode[], sortMode: SortMode): BookmarkNode[] {
    return [...nodes].sort((left, right) => this.compareNodes(left, right, sortMode));
  }

  private async saveSchema(schema: StorageSchema): Promise<void> {
    if (this.lastSavedSchema) {
      this.history.push(this.cloneSchema(this.lastSavedSchema));
      this.redoHistory = [];
    }
    await this.writeSchema(schema);
  }

  async replaceSchema(schema: StorageSchema): Promise<void> {
    this.assertValidSchema(schema);
    await this.saveSchema(this.cloneSchema(schema));
  }

  private async writeSchema(schema: StorageSchema): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEY]: await this.encryptSchema(schema),
    });
    this.lastSavedSchema = this.cloneSchema(schema);
  }

  private async getSyncSchema(): Promise<StorageSchema | undefined> {
    if (!this.isSyncSupported()) {
      return undefined;
    }
    try {
      const stored = (await chrome.storage.sync.get([
        SYNC_MANIFEST_KEY,
        STORAGE_KEY,
      ])) as Record<string, unknown>;
      const manifest = stored[SYNC_MANIFEST_KEY] as SyncManifest | undefined;
      if (manifest && Number.isInteger(manifest.chunkCount) && manifest.chunkCount > 0) {
        const chunkKeys = Array.from(
          { length: manifest.chunkCount },
          (_, index) => `${SYNC_CHUNK_PREFIX}${index}`,
        );
        const chunks = await chrome.storage.sync.get(chunkKeys) as Record<string, unknown>;
        const serialized = chunkKeys.map((key) => chunks[key]).join('');
        return this.decodeSchemaValue(JSON.parse(serialized));
      }
      return this.decodeSchemaValue(stored[STORAGE_KEY]);
    } catch (error) {
      this.syncError = true;
      console.error('Browser sync read failed', error);
      throw new Error('Browser sync read failed', { cause: error });
    }
  }

  private async writeSyncSchema(schema: StorageSchema): Promise<void> {
    if (!this.isSyncSupported()) {
      return;
    }
    try {
      const serialized = JSON.stringify(await this.encryptSchema(this.toSyncSchema(schema)));
      const chunks = Array.from(
        { length: Math.ceil(serialized.length / SYNC_CHUNK_SIZE) },
        (_, index) => serialized.slice(index * SYNC_CHUNK_SIZE, (index + 1) * SYNC_CHUNK_SIZE),
      );
      const serializedBytes = new TextEncoder().encode(serialized).byteLength;
      if (serializedBytes > SYNC_SAFE_TOTAL_BYTES) {
        this.syncError = true;
        console.warn('Browser sync skipped: encrypted data exceeds the available quota');
        return;
      }
      const allStored = await chrome.storage.sync.get(null);
      const oldKeys = Object.keys(allStored)
        .filter((key) => key.startsWith(SYNC_CHUNK_PREFIX));
      await chrome.storage.sync.remove([SYNC_MANIFEST_KEY, STORAGE_KEY, ...oldKeys]);
      await chrome.storage.sync.set({
        [SYNC_MANIFEST_KEY]: { chunkCount: chunks.length } satisfies SyncManifest,
        ...Object.fromEntries(chunks.map((chunk, index) => [`${SYNC_CHUNK_PREFIX}${index}`, chunk])),
      });
    } catch (error) {
      this.syncError = true;
      console.error('Browser sync write failed', error);
    }
  }

  private toSyncSchema(schema: StorageSchema): StorageSchema {
    const syncSchema = this.cloneSchema(schema);
    Object.values(syncSchema.nodes).forEach((node) => {
      if (node.type === 'tab') {
        delete node.screenshot;
        delete node.faviconUrl;
        delete node.description;
      }
    });
    return syncSchema;
  }

  private async decodeSchemaValue(value: unknown): Promise<StorageSchema | undefined> {
    if (!value) {
      return undefined;
    }
    if (this.isEncryptedPayload(value)) {
      if (!this.masterPassword) {
        throw new Error('Storage is locked');
      }
      return this.decryptSchema(value);
    }
    return value as StorageSchema;
  }

  private isEncryptedPayload(value: unknown): value is EncryptedPayload {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const candidate = value as Partial<EncryptedPayload>;
    return (candidate.version === 1 || candidate.version === 2) &&
      typeof candidate.salt === 'string' &&
      typeof candidate.iv === 'string' &&
      typeof candidate.ciphertext === 'string';
  }

  private async encryptSchema(schema: StorageSchema): Promise<EncryptedPayload> {
    if (!this.masterPassword) {
      throw new Error('Storage is locked');
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(this.masterPassword, salt);
    const rawData = new TextEncoder().encode(JSON.stringify(schema));
    const compressed = await this.compress(rawData);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(compressed.data),
    );
    return {
      version: 2,
      salt: this.toBase64(salt),
      iv: this.toBase64(iv),
      ciphertext: this.toBase64(new Uint8Array(encrypted)),
      ...(compressed.compression ? { compression: compressed.compression } : {}),
    };
  }

  private async decryptSchema(payload: EncryptedPayload): Promise<StorageSchema> {
    if (!this.masterPassword) {
      throw new Error('Storage is locked');
    }
    const salt = this.fromBase64(payload.salt);
    const iv = this.fromBase64(payload.iv);
    const key = await this.deriveKey(this.masterPassword, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: this.toArrayBuffer(iv) },
      key,
      this.toArrayBuffer(this.fromBase64(payload.ciphertext)),
    );
    const decompressed = payload.compression === 'gzip'
      ? await this.decompress(new Uint8Array(decrypted))
      : new Uint8Array(decrypted);
    return JSON.parse(new TextDecoder().decode(decompressed)) as StorageSchema;
  }

  private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: this.toArrayBuffer(salt), iterations: 250000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private toBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  private fromBase64(value: string): Uint8Array {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  }

  private toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  private async compress(data: Uint8Array): Promise<{ data: Uint8Array; compression?: 'gzip' }> {
    if (typeof CompressionStream === 'undefined') {
      return { data };
    }
    const stream = new Blob([this.toArrayBuffer(data)]).stream()
      .pipeThrough(new CompressionStream('gzip'));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), compression: 'gzip' };
  }

  private async decompress(data: Uint8Array): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress synchronized data');
    }
    const stream = new Blob([this.toArrayBuffer(data)]).stream()
      .pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  private mergeLocalVisuals(syncSchema: StorageSchema, localSchema: StorageSchema | undefined): StorageSchema {
    if (!localSchema) {
      return syncSchema;
    }
    const merged = this.cloneSchema(syncSchema);
    Object.values(merged.nodes).forEach((node) => {
      const localNode = localSchema.nodes[node.id];
      if (node.type === 'tab' && localNode?.type === 'tab') {
        if (localNode.screenshot !== undefined) {
          node.screenshot = localNode.screenshot;
        }
        if (localNode.faviconUrl !== undefined) {
          node.faviconUrl = localNode.faviconUrl;
        }
      }
    });
    return merged;
  }

  private cloneSchema(schema: StorageSchema): StorageSchema {
    return structuredClone(schema);
  }

  private requireNode(schema: StorageSchema, nodeId: NodeId): BookmarkNode {
    const node = schema.nodes[nodeId];
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    return node;
  }

  private requireFolder(schema: StorageSchema, folderId: NodeId): FolderNode {
    const node = this.requireNode(schema, folderId);
    if (node.type !== 'folder') {
      throw new Error(`Node is not a folder: ${folderId}`);
    }
    return node;
  }

  private collectDescendants(schema: StorageSchema, node: BookmarkNode): NodeId[] {
    if (node.type === 'tab') {
      return [node.id];
    }

    return [node.id, ...node.children.flatMap((childId) => {
      const child = this.requireNode(schema, childId);
      return this.collectDescendants(schema, child);
    })];
  }

  private cloneNode(
    schema: StorageSchema,
    source: BookmarkNode,
    parentId: NodeId,
  ): BookmarkNode {
    const id = this.createId();
    if (source.type === 'tab') {
      return { ...source, id, parentId };
    }

    const folder: FolderNode = { ...source, id, parentId, children: [] };
    for (const childId of source.children) {
      const child = this.requireNode(schema, childId);
      const childClone = this.cloneNode(schema, child, folder.id);
      schema.nodes[childClone.id] = childClone;
      folder.children.push(childClone.id);
    }
    return folder;
  }

  private mergeFolderChildren(schema: StorageSchema, source: FolderNode, destination: FolderNode): void {
    const destinationTabs = new Set<string>();
    for (const childId of [...destination.children]) {
      const child = schema.nodes[childId];
      if (child?.type !== 'tab') {
        continue;
      }
      const normalizedUrl = normalizeUrl(child.url);
      if (destinationTabs.has(normalizedUrl)) {
        destination.children.splice(destination.children.indexOf(child.id), 1);
        delete schema.nodes[child.id];
      } else {
        destinationTabs.add(normalizedUrl);
      }
    }
    for (const childId of [...source.children]) {
      const child = this.requireNode(schema, childId);
      if (child.type === 'folder') {
        const matchingFolder = destination.children
          .map((id) => schema.nodes[id])
          .find((node): node is FolderNode => node?.type === 'folder' && node.title === child.title);
        if (matchingFolder) {
          this.mergeFolderChildren(schema, child, matchingFolder);
          delete schema.nodes[child.id];
          continue;
        }
        child.parentId = destination.id;
        destination.children.push(child.id);
        continue;
      }
      const normalizedUrl = normalizeUrl(child.url);
      if (destinationTabs.has(normalizedUrl)) {
        delete schema.nodes[child.id];
        continue;
      }
      child.parentId = destination.id;
      destination.children.push(child.id);
      destinationTabs.add(normalizedUrl);
    }
    source.children = [];
  }

  private containsNode(schema: StorageSchema, ancestorId: NodeId, candidateId: NodeId): boolean {
    const ancestor = this.requireFolder(schema, ancestorId);
    return ancestor.children.some(
      (childId) =>
        childId === candidateId ||
        (schema.nodes[childId]?.type === 'folder' &&
          this.containsNode(schema, childId, candidateId)),
    );
  }

  private compareNodes(left: BookmarkNode, right: BookmarkNode, sortMode: SortMode): number {
    if (sortMode === 'title') {
      return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    }

    if (sortMode === 'domain' || sortMode === 'url') {
      const leftValue = sortMode === 'domain' ? this.getDomain(left) : this.getUrl(left);
      const rightValue = sortMode === 'domain' ? this.getDomain(right) : this.getUrl(right);
      return leftValue.localeCompare(rightValue) || left.title.localeCompare(right.title);
    }

    return right[sortMode] - left[sortMode] || left.title.localeCompare(right.title);
  }

  private getDomain(node: BookmarkNode): string {
    return node.type === 'tab' ? this.parseDomain(node.url) : '';
  }

  private getUrl(node: BookmarkNode): string {
    return node.type === 'tab' ? node.url : '';
  }

  private parseDomain(url: string): string {
    try {
      return new URL(url).hostname.toLocaleLowerCase();
    } catch {
      return '';
    }
  }

  private assertValidSchema(schema: StorageSchema): void {
    const root = schema.nodes[schema.rootFolderId];
    if (!root || root.type !== 'folder' || root.parentId !== null) {
      throw new Error('Invalid storage schema: root folder is missing or malformed');
    }
  }

  private createId(): NodeId {
    return typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export const storageService = new StorageService();
