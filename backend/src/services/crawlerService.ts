import { strFromU8, unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';

const EXPORT_MIME: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/pdf': '__download__',
  'text/plain': '__download__',
  'text/csv': '__download__',
  'text/html': '__download__',
  'text/markdown': '__download__',
  'text/xml': '__download__',
  'application/json': '__download__',
  'application/xml': '__download__',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '__download__',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '__download__',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '__download__',
  'audio/mpeg': '__download__',
  'audio/mp3': '__download__',
  'audio/mp4': '__download__',
  'audio/x-m4a': '__download__',
  'video/mp4': '__download__',
  'video/quicktime': '__download__',
  'text/javascript': '__download__',
  'application/javascript': '__download__',
  'application/x-javascript': '__download__',
  'application/x-httpd-php': '__download__',
  'application/x-php': '__download__',
  'text/x-php': '__download__',
  'text/x-python': '__download__',
  'application/typescript': '__download__',
  'text/x-typescript': '__download__',
  'text/x-c': '__download__',
  'text/x-c++': '__download__',
  'text/x-java-source': '__download__',
  'text/x-ruby': '__download__',
  'text/x-go': '__download__',
  'text/x-rust': '__download__',
  'text/x-shellscript': '__download__',
  'text/yaml': '__download__',
  'application/x-yaml': '__download__',
};

const MAX_CONTENT = 60_000;
const MAX_DOWNLOAD_BYTES = 8_000_000;
const MAX_RETRIES = 2;
const RETRY_DELAY = 500;

type DriveMetadata = {
  name?: string;
  description?: string;
  mimeType?: string;
};

const metadataToContent = (metadata: DriveMetadata): string => {
  return [metadata.name, metadata.description, metadata.mimeType].filter(Boolean).join('\n');
};

const normalizeExtractedContent = (parts: Array<string | null | undefined>): string | null => {
  const content = parts
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim())
    .join('\n\n')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CONTENT);

  return content.length > 0 ? content : null;
};

const decodeEntities = (value: string): string => {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const stripMarkup = (value: string): string => {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
};

const decodeText = (buffer: ArrayBuffer): string => {
  return new TextDecoder('utf-8').decode(buffer);
};

const extractReadableStrings = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  let current = '';

  for (const byte of bytes) {
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= 4) chunks.push(current);
      current = '';
    }
  }
  if (current.length >= 4) chunks.push(current);

  return chunks
    .filter((chunk) => /[a-zA-Z]/.test(chunk))
    .join(' ')
    .replace(/\s+/g, ' ');
};

const extractPdfTextRegex = (buffer: ArrayBuffer): string => {
  const raw = decodeText(buffer);

  // PDF text operators: Tj (show), ' (next line + show), " (next line + show with spacing), TJ (array of strings/spacing)
  const singleStrings = [...raw.matchAll(/\(((?:\\.|[^()\\])*)\)\s*(?:Tj|TJ|'|")/g)].map((m) => m[1]);
  const arrayStrings  = [...raw.matchAll(/\[((?:\\.|[^\]])+)\]\s*TJ/g)]
    .flatMap((m) => [...m[1].matchAll(/\(((?:\\.|[^()\\])*)\)/g)].map((s) => s[1]));

  const unescape = (s: string): string =>
    s.replace(/\\n/g, ' ').replace(/\\r/g, ' ').replace(/\\t/g, ' ').replace(/\\\\/g, '\\').replace(/\\([()])/g, '$1');

  const fromOperators = [...singleStrings, ...arrayStrings].map(unescape).join(' ');

  return normalizeExtractedContent([
    fromOperators,
    extractReadableStrings(buffer),
  ]) ?? '';
};

const extractOpenXmlText = (buffer: ArrayBuffer, mimeType: string): string => {
  try {
    const zip = unzipSync(new Uint8Array(buffer));
    const entries = Object.entries(zip).filter(([path]) => {
      if (mimeType.includes('wordprocessingml')) return path === 'word/document.xml';
      if (mimeType.includes('presentationml')) return /^ppt\/slides\/slide\d+\.xml$/.test(path);
      if (mimeType.includes('spreadsheetml')) return path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(path);
      return false;
    });

    return entries
      .map(([, data]) => stripMarkup(strFromU8(data)))
      .join('\n');
  } catch {
    return '';
  }
};

const readSynchsafeInt = (bytes: Uint8Array, offset: number): number => {
  return ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f);
};

const decodeId3Text = (bytes: Uint8Array): string => {
  if (bytes.length === 0) return '';
  const encoding = bytes[0];
  const textBytes = bytes.slice(1);
  if (encoding === 1 || encoding === 2) {
    return new TextDecoder('utf-16').decode(textBytes);
  }
  return new TextDecoder('utf-8').decode(textBytes);
};

const extractMp3Tags = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || strFromU8(bytes.slice(0, 3)) !== 'ID3') return '';

  const wantedFrames = new Set(['TIT2', 'TPE1', 'TALB', 'TCON', 'TDRC', 'TYER', 'COMM']);
  const tagSize = readSynchsafeInt(bytes, 6);
  const values: string[] = [];
  let offset = 10;

  while (offset + 10 <= Math.min(bytes.length, tagSize + 10)) {
    const frameId = strFromU8(bytes.slice(offset, offset + 4));
    const frameSize = bytes[offset + 4] * 0x1000000
      + bytes[offset + 5] * 0x10000
      + bytes[offset + 6] * 0x100
      + bytes[offset + 7];
    if (!frameId.trim() || frameSize <= 0) break;

    if (wantedFrames.has(frameId)) {
      values.push(decodeId3Text(bytes.slice(offset + 10, offset + 10 + frameSize)));
    }
    offset += 10 + frameSize;
  }

  return values.join('\n');
};

const extractPdfTextUnpdf = async (buffer: ArrayBuffer): Promise<string> => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    const text = typeof result.text === 'string'
      ? result.text
      : Array.isArray(result.text) ? result.text.join('\n') : '';
    return text;
  } catch {
    // unpdf failed (encrypted/corrupt) — fall back to regex extractor
    return extractPdfTextRegex(buffer);
  }
};

const extractByMimeType = async (buffer: ArrayBuffer, mimeType: string): Promise<string> => {
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') {
    const text = decodeText(buffer);
    return mimeType.includes('html') || mimeType.includes('xml') ? stripMarkup(text) : text;
  }

  if (mimeType === 'application/pdf') return extractPdfTextUnpdf(buffer);
  if (mimeType.includes('officedocument')) return extractOpenXmlText(buffer, mimeType);
  if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') return extractMp3Tags(buffer);
  if (mimeType.startsWith('audio/') || mimeType.startsWith('video/')) return extractReadableStrings(buffer);

  return extractReadableStrings(buffer);
};

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

const fetchDriveMetadata = async (fileId: string, accessToken: string): Promise<DriveMetadata> => {
  const params = new URLSearchParams({
    fields: 'name,description,mimeType',
  });

  const res = await fetchWithRetry(`https://www.googleapis.com/drive/v3/files/${fileId}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) return {};
  return res.json();
};

// Drive can export native Google Apps formats. Anything else is downloaded raw
// and parsed locally. We always attempt a download for files Google can't
// export, so the crawler covers every file type the user uploaded.
const isBinaryReadable = (mimeType: string): boolean =>
  mimeType.startsWith('text/')
  || mimeType.startsWith('application/')
  || mimeType.startsWith('audio/')
  || mimeType.startsWith('video/')
  || mimeType.startsWith('font/')
  || mimeType.startsWith('message/');

export const fetchFileContent = async (
  fileId: string,
  mimeType: string,
  accessToken: string
): Promise<string | null> => {
  const explicit = EXPORT_MIME[mimeType];
  const exportMime = explicit
    ?? (mimeType.startsWith('text/') ? '__download__'
      : isBinaryReadable(mimeType) ? '__download__' : undefined);
  const metadata = await fetchDriveMetadata(fileId, accessToken);
  if (!exportMime) return normalizeExtractedContent([metadataToContent(metadata)]);

  const url =
    exportMime === '__download__'
      ? `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
      : `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (exportMime === '__download__') {
      headers.Range = `bytes=0-${MAX_DOWNLOAD_BYTES - 1}`;
    }

    const res = await fetchWithRetry(url, { headers });
    if (!res.ok) return normalizeExtractedContent([metadataToContent(metadata)]);

    const content = exportMime === '__download__'
      ? await extractByMimeType(await res.arrayBuffer(), mimeType)
      : await res.text();

    return normalizeExtractedContent([metadataToContent(metadata), content]);
  } catch {
    return normalizeExtractedContent([metadataToContent(metadata)]);
  }
};

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'been', 'were', 'they', 'their', 'about', 'which', 'would', 'could', 'should', 'there', 'these', 'other', 'more', 'into', 'than', 'also', 'after', 'before', 'because', 'while', 'such', 'where', 'when', 'each', 'just', 'over', 'very', 'most', 'some', 'many', 'much', 'thus', 'them',
  'the', 'and', 'for', 'are', 'you', 'all', 'but', 'can', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'old', 'see', 'she', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'too', 'use', 'any', 'now', 'new', 'his', 'her', 'why', 'not', 'yes', 'off', 'per', 'via', 'yet',
]);

const tokenize = (content: string): string[] =>
  content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

export const extractTokens = (content: string): string[] => {
  if (!content) return [];
  return tokenize(content);
};

// Bigrams highlight subject phrases (e.g. "machine learning", "climate change")
export const extractBigrams = (tokens: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].length >= 4 && tokens[i + 1].length >= 4) {
      out.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return out;
};

// Backward-compatible: returns a Set of unique tokens (legacy callers).
export const extractKeywords = (content: string): Set<string> => new Set(tokenize(content));

// TF-IDF: down-weight common tokens, surface document-specific subjects.
type TermFreq = Map<string, number>;

export const computeTfIdf = (
  docTokens: Map<string, string[]>,
): Map<string, Map<string, number>> => {
  const docCount = docTokens.size;
  if (docCount === 0) return new Map();

  const docFreq = new Map<string, number>();
  const termFreqs = new Map<string, TermFreq>();

  for (const [id, tokens] of docTokens) {
    const tf: TermFreq = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    termFreqs.set(id, tf);
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }

  const result = new Map<string, Map<string, number>>();
  for (const [id, tf] of termFreqs) {
    const scored = new Map<string, number>();
    const docLen = docTokens.get(id)?.length || 1;
    for (const [term, count] of tf) {
      const df = docFreq.get(term) ?? 1;
      if (df === docCount && docCount > 2) continue; // term appears everywhere → no signal
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      scored.set(term, (count / docLen) * idf);
    }
    result.set(id, scored);
  }
  return result;
};

export const topSubjects = (scored: Map<string, number>, limit = 20): Set<string> => {
  return new Set(
    [...scored.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term]) => term)
  );
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

  let subjectMap = new Map<string, Set<string>>();
  if (enableSemantic) {
    const docTokens = new Map<string, string[]>();
    for (const id of ids) {
      const tokens = extractTokens(contentMap.get(id) ?? '');
      const bigrams = extractBigrams(tokens);
      docTokens.set(id, [...tokens, ...bigrams]);
    }
    const tfidf = computeTfIdf(docTokens);
    subjectMap = new Map([...tfidf.entries()].map(([id, scored]) => [id, topSubjects(scored, 24)]));
  }

  const toUpsert: ConnectionRow[] = [];

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];

      const semanticScore = enableSemantic
        ? computeSimilarity(subjectMap.get(a) ?? new Set(), subjectMap.get(b) ?? new Set())
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

export default {
  fetchFileContent,
  extractKeywords,
  extractTokens,
  extractBigrams,
  extractNameTokens,
  computeSimilarity,
  computeNameSimilarity,
  computeTfIdf,
  topSubjects,
  buildConnections,
};
