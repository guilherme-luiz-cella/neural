const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'text/plain': '__download__',
  'text/html': '__download__',
  'text/markdown': '__download__',
  'application/json': '__download__',
};

const MAX_CONTENT = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 500;

// Retry logic with exponential backoff
const fetchWithRetry = async (
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> => {
  try {
    const res = await fetch(url, options);
    if (!res.ok && retries > 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY * (MAX_RETRIES - retries + 1)));
      return fetchWithRetry(url, options, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
};

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

  try {
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;

    const text = await res.text();
    return text.slice(0, MAX_CONTENT).trim();
  } catch {
    return null;
  }
};

// Enhanced keyword extraction with better stemming and filtering
export const extractKeywords = (content: string): Set<string> => {
  if (!content || content.length === 0) return new Set();

  // Common stop words
  const stopWords = new Set([
    'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'about', 'which', 'would', 'could', 'should', 'there', 'these', 'other', 'more', 'into', 'than', 'also',
    'the', 'and', 'for', 'are', 'you', 'all', 'but', 'can', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'old', 'see', 'she', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'too', 'use',
  ]);

  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  return new Set(words);
};

// Name-based similarity (for file names and titles)
export const extractNameTokens = (name: string): Set<string> => {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
};

// Improved similarity computation with geometric mean
export const computeSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const w of a) {
    if (b.has(w)) overlap++;
  }

  // Jaccard similarity for better normalized scoring
  const union = new Set([...a, ...b]);
  return overlap / union.size;
};

// Name-based similarity (case-insensitive substring matching)
export const computeNameSimilarity = (name1: string, name2: string): number => {
  const n1 = name1.toLowerCase();
  const n2 = name2.toLowerCase();

  // Exact match
  if (n1 === n2) return 1.0;

  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) {
    const shorter = Math.min(n1.length, n2.length);
    const longer = Math.max(n1.length, n2.length);
    return shorter / longer;
  }

  // Token overlap
  const tokens1 = extractNameTokens(n1);
  const tokens2 = extractNameTokens(n2);
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let overlap = 0;
  for (const t of tokens1) {
    if (tokens2.has(t)) overlap++;
  }

  return overlap / Math.max(tokens1.size, tokens2.size);
};

type ConnectionRow = {
  file_1_id: string;
  file_2_id: string;
  similarity_score: number;
  created_by: string;
  connection_type: 'semantic' | 'name';
};

type BuildConnectionsParams = {
  ids: string[];
  contentMap: Map<string, string>;
  namesMap: Map<string, string>;
  enableSemantic: boolean;
  enableName: boolean;
  semanticThreshold?: number;
  nameThreshold?: number;
};

export const buildConnections = (params: BuildConnectionsParams): ConnectionRow[] => {
  const {
    ids,
    contentMap,
    namesMap,
    enableSemantic,
    enableName,
    semanticThreshold = 0.08,
    nameThreshold = 0.6,
  } = params;

  if (!enableSemantic && !enableName) return [];

  const kwMap = enableSemantic
    ? new Map(ids.map((id) => [id, extractKeywords(contentMap.get(id) ?? '')]))
    : new Map<string, Set<string>>();

  const toUpsert: ConnectionRow[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];

      const semanticScore = enableSemantic
        ? computeSimilarity(kwMap.get(a) ?? new Set(), kwMap.get(b) ?? new Set())
        : 0;

      const nameScore = enableName
        ? computeNameSimilarity(namesMap.get(a) ?? '', namesMap.get(b) ?? '')
        : 0;

      if (enableSemantic && semanticScore >= semanticThreshold) {
        toUpsert.push({
          file_1_id: a,
          file_2_id: b,
          similarity_score: Math.round(semanticScore * 1000) / 1000,
          created_by: 'crawler',
          connection_type: 'semantic',
        });
      } else if (enableName && nameScore >= nameThreshold) {
        toUpsert.push({
          file_1_id: a,
          file_2_id: b,
          similarity_score: Math.round(nameScore * 1000) / 1000,
          created_by: 'crawler',
          connection_type: 'name',
        });
      }
    }
  }

  return toUpsert;
};
