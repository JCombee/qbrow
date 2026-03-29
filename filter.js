/**
 * Recursively flattens the bookmark tree into an array of bookmark nodes.
 * Folders (nodes without a url) are excluded from the result.
 * @param {chrome.bookmarks.BookmarkTreeNode[]} nodes
 * @returns {{ id: string, title: string, url: string }[]}
 */
function flattenBookmarkTree(nodes) {
  const result = [];
  for (const node of nodes) {
    if (node.url) {
      result.push({ id: node.id, title: node.title || '', url: node.url });
    }
    if (node.children) {
      result.push(...flattenBookmarkTree(node.children));
    }
  }
  return result;
}

/**
 * Filters a flat list of bookmarks by a query string.
 * Matches case-insensitively against title and url.
 * Returns up to 10 results.
 * @param {{ id: string, title: string, url: string }[]} bookmarks
 * @param {string} query
 * @returns {{ id: string, title: string, url: string }[]}
 */
function filterBookmarks(bookmarks, query) {
  if (!query || !query.trim()) return [];
  const q = query.trim().toLowerCase();
  const results = [];
  for (const bookmark of bookmarks) {
    if (
      bookmark.title.toLowerCase().includes(q) ||
      bookmark.url.toLowerCase().includes(q) ||
      bookmark.tags?.some((t) => t.toLowerCase().includes(q))
    ) {
      results.push(bookmark);
      if (results.length === 10) break;
    }
  }
  return results;
}

// Export for unit tests (Node/Vitest environment)
if (typeof module !== 'undefined') {
  module.exports = { flattenBookmarkTree, filterBookmarks };
}
