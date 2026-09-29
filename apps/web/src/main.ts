import './styles.css';
import {
  decryptSchema,
  encryptSchema,
  hashEnvelope,
  isEncryptedVaultEnvelope,
  type AuthSessionDto,
  type BookmarkNode,
  type FolderNode,
  type LicenseDto,
  type StorageSchema,
  type VaultSnapshotDto,
} from '@bookmarks/shared';

declare global {
  interface Window {
    google?: {
      accounts: { id: {
        initialize(options: { client_id: string; callback(response: { credential: string }): void }): void;
        renderButton(element: HTMLElement, options: Record<string, unknown>): void;
      }};
    };
  }
}

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const get = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};

const welcome = get<HTMLElement>('#welcome');
const unlockPanel = get<HTMLElement>('#unlock-panel');
const workspace = get<HTMLElement>('#workspace');
const account = get<HTMLElement>('#account');
const status = get<HTMLElement>('#status');
const items = get<HTMLElement>('#items');
const empty = get<HTMLElement>('#empty');
const folderTree = get<HTMLElement>('#folder-tree');
const folderTitle = get<HTMLElement>('#folder-title');
const searchInput = get<HTMLInputElement>('#search');
const editor = get<HTMLDialogElement>('#editor');
const editorForm = get<HTMLFormElement>('#editor-form');
const editorTitle = get<HTMLElement>('#editor-title');
const titleInput = get<HTMLInputElement>('#item-title');
const urlInput = get<HTMLInputElement>('#item-url');
const urlField = get<HTMLElement>('#url-field');

let accessToken = sessionStorage.getItem('accessToken') ?? '';
let masterPassword = '';
let revision = 0;
let selectedFolderId = 'root';
let editorMode: 'folder' | 'tab' = 'tab';
let schema: StorageSchema = createEmptySchema();

function createEmptySchema(): StorageSchema {
  const now = Date.now();
  return {
    rootFolderId: 'root',
    nodes: { root: { id: 'root', parentId: null, title: 'Mi biblioteca', type: 'folder', children: [], createdAt: now, lastViewedAt: now } },
  };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const detail: unknown = await response.json().catch(() => undefined);
    const error = new Error(`HTTP ${response.status}`) as Error & { status: number; detail: unknown };
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return await response.json() as T;
}

function initializeGoogle(): void {
  if (accessToken) {
    showUnlock();
    return;
  }
  if (!GOOGLE_CLIENT_ID) {
    get<HTMLElement>('#google-help').hidden = false;
    return;
  }
  const attempt = (): void => {
    if (!window.google) {
      window.setTimeout(attempt, 100);
      return;
    }
    window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: ({ credential }) => void login(credential) });
    window.google.accounts.id.renderButton(get('#google-signin'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
  };
  attempt();
}

async function login(idToken: string): Promise<void> {
  try {
    const session = await api<AuthSessionDto>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) });
    accessToken = session.accessToken;
    sessionStorage.setItem('accessToken', accessToken);
    account.replaceChildren();
    if (session.user.picture) {
      const image = document.createElement('img');
      image.src = session.user.picture;
      image.alt = '';
      account.append(image);
    }
    account.append(document.createTextNode(session.user.name));
    showUnlock();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'No se pudo iniciar sesión', true);
  }
}

function showUnlock(): void {
  welcome.hidden = true;
  unlockPanel.hidden = false;
  account.textContent ||= 'Sesión iniciada';
}

get<HTMLFormElement>('#unlock-form').addEventListener('submit', (event) => {
  event.preventDefault();
  masterPassword = get<HTMLInputElement>('#master-password').value;
  void unlock();
});

async function unlock(): Promise<void> {
  try {
    try {
      const remote = await api<VaultSnapshotDto>('/vault');
      schema = await decryptSchema(remote.encryptedPayload, masterPassword);
      revision = remote.revision;
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      schema = createEmptySchema();
      revision = 0;
    }
    unlockPanel.hidden = true;
    workspace.hidden = false;
    render();
    void loadLicense();
  } catch {
    masterPassword = '';
    get<HTMLInputElement>('#master-password').setCustomValidity('La contraseña no puede descifrar esta biblioteca.');
    get<HTMLInputElement>('#master-password').reportValidity();
  }
}

function render(): void {
  renderFolders();
  renderItems();
}

function renderFolders(): void {
  folderTree.replaceChildren();
  const fragment = document.createDocumentFragment();
  const appendFolder = (folder: FolderNode, depth: number): void => {
    const button = document.createElement('button');
    button.className = `folder-button${folder.id === selectedFolderId ? ' active' : ''}`;
    button.style.paddingLeft = `${.7 + depth * 1.05}rem`;
    button.textContent = folder.title;
    button.onclick = () => { selectedFolderId = folder.id; searchInput.value = ''; render(); };
    fragment.append(button);
    for (const childId of folder.children) {
      const child = schema.nodes[childId];
      if (child?.type === 'folder') appendFolder(child, depth + 1);
    }
  };
  const root = schema.nodes[schema.rootFolderId];
  if (root?.type === 'folder') appendFolder(root, 0);
  folderTree.append(fragment);
}

function renderItems(): void {
  items.replaceChildren();
  const selected = schema.nodes[selectedFolderId];
  if (!selected || selected.type !== 'folder') return;
  folderTitle.textContent = selected.title;
  const query = searchInput.value.trim().toLocaleLowerCase();
  const candidates = query
    ? Object.values(schema.nodes).filter((node) => node.id !== schema.rootFolderId && searchable(node).includes(query))
    : selected.children.map((id) => schema.nodes[id]).filter((node): node is BookmarkNode => Boolean(node));
  const fragment = document.createDocumentFragment();
  for (const node of candidates) fragment.append(createCard(node));
  items.append(fragment);
  empty.hidden = candidates.length > 0;
}

function searchable(node: BookmarkNode): string {
  return node.type === 'tab'
    ? `${node.title} ${node.url} ${node.description ?? ''}`.toLocaleLowerCase()
    : node.title.toLocaleLowerCase();
}

function createCard(node: BookmarkNode): HTMLElement {
  const card = document.createElement('article');
  card.className = `item ${node.type}`;
  const heading = document.createElement('h3');
  heading.textContent = node.title;
  card.append(heading);
  if (node.type === 'folder') {
    const count = document.createElement('p');
    count.textContent = `${node.children.length} elementos`;
    card.append(count);
    card.onclick = () => { selectedFolderId = node.id; searchInput.value = ''; render(); };
  } else {
    const link = document.createElement('a');
    link.href = node.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = node.url;
    card.append(link);
  }
  const remove = document.createElement('button');
  remove.className = 'delete';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Eliminar';
  remove.onclick = (event) => { event.stopPropagation(); deleteNode(node.id); };
  card.append(remove);
  return card;
}

function deleteNode(id: string): void {
  const node = schema.nodes[id];
  if (!node || id === schema.rootFolderId) return;
  if (node.type === 'folder') for (const childId of [...node.children]) deleteNode(childId);
  const parent = node.parentId ? schema.nodes[node.parentId] : undefined;
  if (parent?.type === 'folder') parent.children = parent.children.filter((childId) => childId !== id);
  delete schema.nodes[id];
  render();
}

function openEditor(mode: 'folder' | 'tab'): void {
  editorMode = mode;
  editorTitle.textContent = mode === 'folder' ? 'Nueva carpeta' : 'Agregar enlace';
  urlField.hidden = mode === 'folder';
  urlInput.required = mode === 'tab';
  titleInput.value = '';
  urlInput.value = '';
  editor.showModal();
  titleInput.focus();
}

editorForm.addEventListener('submit', () => {
  const parent = schema.nodes[selectedFolderId];
  if (!parent || parent.type !== 'folder') return;
  const now = Date.now();
  const id = crypto.randomUUID();
  const base = { id, parentId: parent.id, title: titleInput.value.trim(), createdAt: now, lastViewedAt: now };
  schema.nodes[id] = editorMode === 'folder'
    ? { ...base, type: 'folder', children: [] }
    : { ...base, type: 'tab', url: urlInput.value.trim() };
  parent.children.push(id);
  render();
});

get('#editor-cancel').addEventListener('click', () => editor.close());
get('#new-folder').addEventListener('click', () => openEditor('folder'));
get('#new-link').addEventListener('click', () => openEditor('tab'));
searchInput.addEventListener('input', renderItems);
get('#sync-now').addEventListener('click', () => void sync());

async function sync(): Promise<void> {
  showStatus('Cifrando y sincronizando…');
  try {
    const envelope = await encryptSchema(schema, masterPassword);
    const remote = await api<VaultSnapshotDto>('/vault', {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: revision, encryptedPayload: envelope, payloadHash: await hashEnvelope(envelope) }),
    });
    revision = remote.revision;
    showStatus(`Sincronización completa · revisión ${revision}`);
  } catch (error) {
    if ((error as { status?: number }).status === 409) showStatus('Existe una versión más reciente. Exporta tus cambios antes de volver a cargar.', true);
    else showStatus(error instanceof Error ? error.message : 'Error de sincronización', true);
  }
}

get('#export-vault').addEventListener('click', () => void exportVault());
async function exportVault(): Promise<void> {
  const envelope = await encryptSchema(schema, masterPassword);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `tab-vault-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

get<HTMLInputElement>('#import-vault').addEventListener('change', (event) => void importVault(event));
async function importVault(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const value: unknown = JSON.parse(await file.text());
    if (!isEncryptedVaultEnvelope(value)) throw new Error('Formato de archivo inválido');
    schema = await decryptSchema(value, masterPassword);
    selectedFolderId = schema.rootFolderId;
    render();
    showStatus('Archivo importado. Sincroniza para guardarlo en el servidor.');
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'No se pudo importar', true);
  }
}

async function loadLicense(): Promise<void> {
  try {
    const license = await api<LicenseDto>('/billing/license');
    get('#license-status').textContent = license.status === 'active' ? 'Plan activo' : license.status === 'trialing' ? 'Prueba gratuita' : 'Plan vencido';
    get('#license-detail').textContent = license.status === 'trialing' ? `Hasta ${new Date(license.trialEndsAt).toLocaleDateString()}` : '';
  } catch { /* The vault remains usable offline. */ }
}

get('#upgrade').addEventListener('click', () => void checkout());
async function checkout(): Promise<void> {
  try {
    const result = await api<{ url: string | null }>('/billing/checkout', { method: 'POST' });
    if (result.url) window.location.assign(result.url);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'No se pudo abrir Stripe Checkout', true);
  }
}

get('#approve-device').addEventListener('click', () => void approveDevice());
async function approveDevice(): Promise<void> {
  const userCode = get<HTMLInputElement>('#device-code').value.trim();
  if (!userCode) return;
  try {
    const result = await api<{ approved: boolean; deviceName: string }>('/device-links/approve', {
      method: 'POST',
      body: JSON.stringify({ userCode }),
    });
    get<HTMLInputElement>('#device-code').value = '';
    showStatus(`Dispositivo “${result.deviceName}” vinculado correctamente.`);
  } catch {
    showStatus('El código de vinculación es inválido o ya venció.', true);
  }
}

function showStatus(message: string, isError = false): void {
  status.textContent = message;
  status.style.color = isError ? '#a43b52' : '';
}

initializeGoogle();
