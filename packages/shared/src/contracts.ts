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

export interface EncryptedVaultEnvelope {
  version: 1;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2-SHA-256';
  iterations: 250000;
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface VaultSnapshotDto {
  revision: number;
  encryptedPayload: EncryptedVaultEnvelope;
  payloadHash: string;
  createdAt: string;
  deviceId: string | null;
}

export interface PutVaultSnapshotDto {
  baseRevision: number;
  encryptedPayload: EncryptedVaultEnvelope;
  payloadHash: string;
}

export interface AuthSessionDto {
  accessToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; picture?: string };
}

export type LicenseStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface LicenseDto {
  status: LicenseStatus;
  trialEndsAt: string;
  currentPeriodEnd?: string;
  signedLicense: string;
}
