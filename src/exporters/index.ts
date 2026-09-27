import type { FolderNode, StorageSchema, TabNode } from '../shared/types';

interface TabExportRow {
  id: string;
  path: string;
  title: string;
  url: string;
  lastViewedAt: number;
}

export function buildNetscapeHtml(schema: StorageSchema): string {
  const root = requireFolder(schema, schema.rootFolderId);
  const body = renderFolder(schema, root, 0);
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    body,
    '</DL><p>',
  ].join('\n');
}

export function buildCsv(schema: StorageSchema): string {
  const rows = flattenTabs(schema);
  return [
    ['ID', 'Ruta de Carpetas', 'Título', 'URL', 'Última Vez Visto'].map(escapeCsv).join(','),
    ...rows.map((row) =>
      [row.id, row.path, row.title, row.url, new Date(row.lastViewedAt).toISOString()]
        .map(escapeCsv)
        .join(','),
    ),
  ].join('\n');
}

export function buildTxt(schema: StorageSchema): string {
  return flattenTabs(schema)
    .map((row) => `${row.path}\t${row.title}\t${row.url}\t${new Date(row.lastViewedAt).toISOString()}`)
    .join('\n');
}

export function downloadExport(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function renderFolder(schema: StorageSchema, folder: FolderNode, depth: number): string {
  const indentation = '  '.repeat(depth);
  const lines = [`${indentation}<DT><H3>${escapeHtml(folder.title)}</H3>`, `${indentation}<DL><p>`];

  for (const childId of folder.children) {
    const child = schema.nodes[childId];
    if (!child) {
      continue;
    }
    if (child.type === 'folder') {
      lines.push(renderFolder(schema, child, depth + 1));
    } else {
      lines.push(
        `${indentation}  <DT><A HREF="${escapeHtml(child.url)}" ADD_DATE="${Math.floor(child.createdAt / 1000)}">${escapeHtml(child.title)}</A>`,
      );
    }
  }

  lines.push(`${indentation}</DL><p>`);
  return lines.join('\n');
}

function flattenTabs(schema: StorageSchema): TabExportRow[] {
  const root = requireFolder(schema, schema.rootFolderId);
  const rows: TabExportRow[] = [];

  function visit(folder: FolderNode, path: string): void {
    for (const childId of folder.children) {
      const child = schema.nodes[childId];
      if (!child) {
        continue;
      }
      if (child.type === 'folder') {
        visit(child, path ? `${path}/${child.title}` : child.title);
      } else {
        rows.push({
          id: child.id,
          path,
          title: child.title,
          url: child.url,
          lastViewedAt: child.lastViewedAt,
        });
      }
    }
  }

  visit(root, '');
  return rows;
}

function requireFolder(schema: StorageSchema, id: string): FolderNode {
  const node = schema.nodes[id];
  if (!node || node.type !== 'folder') {
    throw new Error(`Folder not found: ${id}`);
  }
  return node;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}

function escapeCsv(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
