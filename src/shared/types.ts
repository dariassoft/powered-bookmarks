export interface BaseNode {
  id: string;
  parentId: string | null;
  title: string;
  type: 'folder' | 'tab';
  createdAt: number;
  lastViewedAt: number;
}

export interface FolderNode extends BaseNode {
  type: 'folder';
  children: string[];
}

export interface TabNode extends BaseNode {
  type: 'tab';
  url: string;
  screenshot?: string;
  faviconUrl?: string;
  description?: string;
}

export type BookmarkNode = FolderNode | TabNode;

export interface StorageSchema {
  rootFolderId: string;
  nodes: Record<string, BookmarkNode>;
}

export interface EncryptedArchive {
  version: 1 | 2;
  salt: string;
  iv: string;
  ciphertext: string;
  compression?: 'gzip';
}

export type NodeId = string;
export type SortMode = 'title' | 'createdAt' | 'lastViewedAt' | 'domain' | 'url';
