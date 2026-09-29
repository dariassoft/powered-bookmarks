import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptSchema, encryptSchema, hashEnvelope, isEncryptedVaultEnvelope, isStorageSchema } from '../dist/index.js';

const schema = {
  rootFolderId: 'root',
  nodes: {
    root: { id: 'root', parentId: null, title: 'Biblioteca', type: 'folder', children: ['tab-1'], createdAt: 1, lastViewedAt: 1 },
    'tab-1': { id: 'tab-1', parentId: 'root', title: 'Ejemplo', type: 'tab', url: 'https://example.com', createdAt: 2, lastViewedAt: 2 },
  },
};

test('cifra y descifra un árbol sin perder información', async () => {
  const envelope = await encryptSchema(schema, 'contraseña suficientemente larga');
  assert.equal(isEncryptedVaultEnvelope(envelope), true);
  assert.deepEqual(await decryptSchema(envelope, 'contraseña suficientemente larga'), schema);
  assert.ok((await hashEnvelope(envelope)).length >= 40);
});

test('rechaza una contraseña incorrecta y esquemas malformados', async () => {
  const envelope = await encryptSchema(schema, 'clave correcta');
  await assert.rejects(decryptSchema(envelope, 'clave incorrecta'));
  assert.equal(isStorageSchema({ rootFolderId: 'root', nodes: {} }), false);
  assert.equal(isEncryptedVaultEnvelope({ version: 1 }), false);
});
