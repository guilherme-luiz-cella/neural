import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFileContentIfMissing } from '../routes/files';
import { getValidAccessToken } from '../routes/driveHelpers';
import { fetchFileContent } from '../services/crawlerService';

vi.mock('../routes/driveHelpers', () => ({
  getValidAccessToken: vi.fn(),
}));

vi.mock('../services/crawlerService', () => ({
  fetchFileContent: vi.fn(),
}));

type MockSupabase = {
  from: ReturnType<typeof vi.fn>;
  _chain: { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> };
};

const makeSupabase = (): MockSupabase => {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  return { from: vi.fn(() => chain), _chain: chain };
};

const baseFile = {
  id: 'file-1',
  file_name: 'notes.txt',
  file_type: 'text/plain',
  google_drive_id: 'drive-1',
  content: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadFileContentIfMissing', () => {
  it('fetches Drive content and updates when content is missing', async () => {
    const supabase = makeSupabase();
    vi.mocked(getValidAccessToken).mockResolvedValue('token-123');
    vi.mocked(fetchFileContent).mockResolvedValue('hello world');

    const result = await loadFileContentIfMissing({
      supabase: supabase as never,
      userId: 'user-1',
      env: {} as never,
      file: { ...baseFile },
    });

    expect(fetchFileContent).toHaveBeenCalledWith('drive-1', 'text/plain', 'token-123');
    expect(supabase.from).toHaveBeenCalledWith('files');
    expect(supabase._chain.update).toHaveBeenCalledWith({ content: 'hello world' });
    expect(result.content).toBe('hello world');
  });

  it('skips Drive fetch when content already exists', async () => {
    const supabase = makeSupabase();
    const result = await loadFileContentIfMissing({
      supabase: supabase as never,
      userId: 'user-1',
      env: {} as never,
      file: { ...baseFile, content: 'cached' },
    });

    expect(fetchFileContent).not.toHaveBeenCalled();
    expect(supabase._chain.update).not.toHaveBeenCalled();
    expect(result.content).toBe('cached');
  });

  it('returns original file when Drive returns no content', async () => {
    const supabase = makeSupabase();
    vi.mocked(getValidAccessToken).mockResolvedValue('token-123');
    vi.mocked(fetchFileContent).mockResolvedValue(null);

    const result = await loadFileContentIfMissing({
      supabase: supabase as never,
      userId: 'user-1',
      env: {} as never,
      file: { ...baseFile },
    });

    expect(fetchFileContent).toHaveBeenCalled();
    expect(supabase._chain.update).not.toHaveBeenCalled();
    expect(result.content).toBeNull();
  });
});
