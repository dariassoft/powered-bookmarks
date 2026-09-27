import type { BookmarkNode, StorageSchema } from './types';

export function searchNodes(schema: StorageSchema, query: string): BookmarkNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return Object.values(schema.nodes).filter((node) => {
    const searchableText = node.type === 'tab'
      ? [node.title, node.url, node.description ?? '']
      : [node.title];
    return searchableText.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  });
}
