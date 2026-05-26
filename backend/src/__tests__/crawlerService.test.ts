import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { buildConnections, fetchFileContent } from '../services/crawlerService';

const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const mockFetch = (responses: Response[]) => {
  const fetchMock = vi.fn();
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

const docxResponse = (text: string) => {
  const zipped = zipSync({
    'word/document.xml': strToU8(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`),
  });
  return new Response(zipped, {
    headers: { 'Content-Type': docxMime },
  });
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFileContent', () => {
  it('combines Drive metadata with extracted Office document text', async () => {
    const fetchMock = mockFetch([
      jsonResponse({ name: 'Strategy.docx', description: 'Planning document', mimeType: docxMime }),
      docxResponse('Quarterly neural matching roadmap'),
    ]);

    const content = await fetchFileContent('drive-1', docxMime, 'token-123');

    expect(content).toContain('Strategy.docx');
    expect(content).toContain('Planning document');
    expect(content).toContain('Quarterly neural matching roadmap');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: {
        Authorization: 'Bearer token-123',
        Range: 'bytes=0-1999999',
      },
    });
  });

  it('uses metadata as searchable content for unsupported file types', async () => {
    const fetchMock = mockFetch([
      jsonResponse({ name: 'Archive.bin', description: 'Reference dataset', mimeType: 'application/octet-stream' }),
    ]);

    const content = await fetchFileContent('drive-2', 'application/octet-stream', 'token-123');

    expect(content).toBe('Archive.bin\nReference dataset\napplication/octet-stream');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to metadata when a supported Drive download fails', async () => {
    mockFetch([
      jsonResponse({ name: 'Broken.pdf', description: 'Still searchable', mimeType: 'application/pdf' }),
      new Response('failed', { status: 503 }),
    ]);

    const content = await fetchFileContent('drive-3', 'application/pdf', 'token-123');

    expect(content).toBe('Broken.pdf\nStill searchable\napplication/pdf');
  });
});

describe('buildConnections', () => {
  it('creates semantic connections for matching extracted content', () => {
    const connections = buildConnections({
      ids: ['a', 'b'],
      contentMap: new Map([
        ['a', 'neural matching document crawler roadmap'],
        ['b', 'document crawler roadmap semantic matching'],
      ]),
      namesMap: new Map([
        ['a', 'alpha.txt'],
        ['b', 'beta.txt'],
      ]),
      enableSemantic: true,
      enableName: true,
    });

    expect(connections).toEqual([
      expect.objectContaining({
        file_1_id: 'a',
        file_2_id: 'b',
        connection_type: 'semantic',
      }),
    ]);
  });

  it('returns no connections when semantic and name matching are disabled', () => {
    const connections = buildConnections({
      ids: ['a', 'b'],
      contentMap: new Map([
        ['a', 'same words'],
        ['b', 'same words'],
      ]),
      namesMap: new Map([
        ['a', 'same.txt'],
        ['b', 'same.txt'],
      ]),
      enableSemantic: false,
      enableName: false,
    });

    expect(connections).toEqual([]);
  });
});
