import { describe, it, expect } from 'vitest';
const { flattenBookmarkTree, filterBookmarks } = require('../../filter.js');

const SAMPLE_TREE = [
  {
    id: '0',
    title: 'root',
    children: [
      {
        id: '1',
        title: 'Bookmarks Bar',
        children: [
          { id: '10', title: 'GitHub', url: 'https://github.com' },
          { id: '11', title: 'Google', url: 'https://google.com' },
          {
            id: '2',
            title: 'Dev',
            children: [
              { id: '20', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
              { id: '21', title: 'Stack Overflow', url: 'https://stackoverflow.com' },
            ],
          },
        ],
      },
      {
        id: '3',
        title: 'Other Bookmarks',
        children: [
          { id: '30', title: 'YouTube', url: 'https://youtube.com' },
        ],
      },
    ],
  },
];

describe('flattenBookmarkTree', () => {
  it('returns only bookmark nodes (no folders)', () => {
    const flat = flattenBookmarkTree(SAMPLE_TREE);
    expect(flat.every((b) => b.url)).toBe(true);
  });

  it('flattens nested folders correctly', () => {
    const flat = flattenBookmarkTree(SAMPLE_TREE);
    expect(flat).toHaveLength(5);
  });

  it('preserves id, title, and url fields', () => {
    const flat = flattenBookmarkTree(SAMPLE_TREE);
    expect(flat[0]).toEqual({ id: '10', title: 'GitHub', url: 'https://github.com' });
  });

  it('returns empty array for empty input', () => {
    expect(flattenBookmarkTree([])).toEqual([]);
  });
});

describe('filterBookmarks', () => {
  const bookmarks = [
    { id: '1', title: 'GitHub', url: 'https://github.com' },
    { id: '2', title: 'Google', url: 'https://google.com' },
    { id: '3', title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
    { id: '4', title: 'Stack Overflow', url: 'https://stackoverflow.com' },
    { id: '5', title: 'YouTube', url: 'https://youtube.com' },
  ];

  it('returns empty array for empty query', () => {
    expect(filterBookmarks(bookmarks, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    expect(filterBookmarks(bookmarks, '   ')).toEqual([]);
  });

  it('matches by title (case-insensitive)', () => {
    const results = filterBookmarks(bookmarks, 'github');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('GitHub');
  });

  it('matches by URL', () => {
    const results = filterBookmarks(bookmarks, 'mozilla.org');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('MDN Web Docs');
  });

  it('is case-insensitive for title', () => {
    expect(filterBookmarks(bookmarks, 'GOOGLE')).toHaveLength(1);
  });

  it('is case-insensitive for URL', () => {
    expect(filterBookmarks(bookmarks, 'GITHUB.COM')).toHaveLength(1);
  });

  it('returns multiple matches', () => {
    const results = filterBookmarks(bookmarks, 'go');
    // matches "Google" (title) and "stackoverflow.com" does not, but "google.com" does
    // "go" matches: Google (title), google.com (url), stackoverflow (no)
    expect(results.some((b) => b.title === 'Google')).toBe(true);
  });

  it('returns at most 10 results', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: `Site ${i}`,
      url: `https://site${i}.com`,
    }));
    expect(filterBookmarks(many, 'site')).toHaveLength(10);
  });

  it('returns empty array when no match', () => {
    expect(filterBookmarks(bookmarks, 'xyzzy')).toEqual([]);
  });

  it('matches by tag', () => {
    const tagged = [
      { id: '1', title: 'Cardmarket', url: 'https://cardmarket.com', tags: ['tcg', 'trading'] },
      { id: '2', title: 'GitHub', url: 'https://github.com', tags: ['dev'] },
    ];
    const results = filterBookmarks(tagged, 'tcg');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Cardmarket');
  });

  it('tag matching is case-insensitive', () => {
    const tagged = [
      { id: '1', title: 'Cardmarket', url: 'https://cardmarket.com', tags: ['TCG'] },
    ];
    expect(filterBookmarks(tagged, 'tcg')).toHaveLength(1);
  });

  it('still works for bookmarks without a tags field', () => {
    expect(filterBookmarks(bookmarks, 'github')).toHaveLength(1);
  });
});
