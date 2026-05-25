const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'text/plain': '__download__',
  'text/html': '__download__',
  'text/markdown': '__download__',
  'application/json': '__download__',
};

const MAX_CONTENT = 20_000;

export const fetchFileContent = async (
  fileId: string,
  mimeType: string,
  accessToken: string
): Promise<string | null> => {
  const exportMime = EXPORT_MIME[mimeType];
  if (!exportMime) return null;

  const url =
    exportMime === '__download__'
      ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
      : `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;

  const text = await res.text();
  return text.slice(0, MAX_CONTENT);
};

export const extractKeywords = (content: string): Set<string> => {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4);

  const stopWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'about', 'which', 'would', 'could', 'should', 'there', 'these', 'other', 'more', 'into', 'than', 'also']);
  return new Set(words.filter((w) => !stopWords.has(w)));
};

export const computeSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const w of a) if (b.has(w)) overlap++;
  return overlap / Math.sqrt(a.size * b.size);
};
