import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { EncryptedArchive } from './types';

const ARCHIVE_FILE = 'gestor-pestanas.enc.json';

export function createEncryptedArchive(payload: EncryptedArchive, readme: string): Uint8Array {
  return zipSync({
    [ARCHIVE_FILE]: strToU8(JSON.stringify(payload)),
    'README.txt': strToU8(readme),
  });
}

export function readEncryptedArchive(data: Uint8Array): EncryptedArchive {
  const files = unzipSync(data);
  const content = files[ARCHIVE_FILE];
  if (!content) {
    throw new Error('Encrypted archive payload not found');
  }
  return JSON.parse(strFromU8(content)) as EncryptedArchive;
}
