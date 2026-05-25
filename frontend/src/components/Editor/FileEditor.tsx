import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface Props {
  fileId: string;
  fileName: string;
  onClose: () => void;
}

const detectLanguage = (fileName: string, fileType: string | null): string => {
  if (fileType?.includes('json')) return 'json';
  if (fileType?.includes('html')) return 'html';
  if (fileType?.includes('css')) return 'css';
  if (fileType?.includes('spreadsheet') || fileType?.includes('csv')) return 'plaintext';
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
    cpp: 'cpp', c: 'c', rb: 'ruby', php: 'php', swift: 'swift',
    kt: 'kotlin', html: 'html', css: 'css', scss: 'scss',
    json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
    sql: 'sql', sh: 'shell', bash: 'shell', txt: 'plaintext',
  };
  return map[ext ?? ''] ?? 'plaintext';
};

export const FileEditor = ({ fileId, fileName, onClose }: Props) => {
  const [content, setContent] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    setDirty(false);
    api.get(`/files/${fileId}`)
      .then((res) => {
        const file = res.data.data.file;
        setContent(file.content ?? '');
        setFileType(file.file_type);
      })
      .catch(() => setError('Failed to load file content.'))
      .finally(() => setLoading(false));
  }, [fileId]);

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.put(`/files/${fileId}`, { content });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const lang = detectLanguage(fileName, fileType);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700 bg-gray-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm text-white font-medium truncate max-w-xs">{fileName}</span>
          {dirty && <span className="w-2 h-2 rounded-full bg-amber-400" title="Unsaved changes" />}
          {saved && <span className="text-xs text-green-400">Saved</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-sm px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            language={lang}
            value={content ?? ''}
            onChange={(val) => {
              setContent(val ?? '');
              setDirty(true);
            }}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 20,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
              renderLineHighlight: 'gutter',
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              fontFamily: 'JetBrains Mono, Fira Code, Cascadia Code, monospace',
              readOnly: fileType?.includes('google-apps') ?? false,
            }}
          />
        </div>
      )}
    </div>
  );
};
