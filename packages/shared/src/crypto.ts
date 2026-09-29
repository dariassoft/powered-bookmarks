import type { EncryptedVaultEnvelope, StorageSchema } from './contracts.js';

const ITERATIONS = 250_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function encryptSchema(schema: StorageSchema, password: string): Promise<EncryptedVaultEnvelope> {
  if (!password) throw new Error('Master password is required');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(schema)));
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptSchema(envelope: EncryptedVaultEnvelope, password: string): Promise<StorageSchema> {
  if (!isEncryptedVaultEnvelope(envelope)) throw new Error('Unsupported encrypted vault format');
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveKey(password, salt, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(base64ToBytes(envelope.ciphertext)),
  );
  const schema: unknown = JSON.parse(decoder.decode(plaintext));
  if (!isStorageSchema(schema)) throw new Error('Invalid decrypted vault');
  return schema;
}

export async function hashEnvelope(envelope: EncryptedVaultEnvelope): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(envelope)));
  return bytesToBase64(new Uint8Array(digest));
}

export function isEncryptedVaultEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return item.version === 1 && item.algorithm === 'AES-256-GCM' && item.kdf === 'PBKDF2-SHA-256' &&
    item.iterations === ITERATIONS && typeof item.salt === 'string' && typeof item.iv === 'string' &&
    typeof item.ciphertext === 'string';
}

export function isStorageSchema(value: unknown): value is StorageSchema {
  if (!value || typeof value !== 'object') return false;
  const schema = value as Partial<StorageSchema>;
  if (typeof schema.rootFolderId !== 'string' || !schema.nodes || typeof schema.nodes !== 'object') return false;
  const root = schema.nodes[schema.rootFolderId];
  return Boolean(root && root.type === 'folder' && root.parentId === null && Array.isArray(root.children));
}
