import { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface Props {
  fileId: string;
  fileName: string;
  onClose: () => void;
  onSaved?: () => void;
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

export const FileEditor = ({ fileId, fileName, onClose: _onClose, onSaved }: Props) => {
  const [content, setContent] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);
  const [githubPath, setGithubPath] = useState<string | null>(null);
  const [githubSha, setGithubSha] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [error, setError] = useState('');

  const saveRef = useRef<() => void>(() => {});

  useEffect(() => {
    setLoading(true);
    setError('');
    setDirty(false);
    api.get(`/files/${fileId}`)
      .then((res) => {
        const file = res.data.data.file;
        setContent(file.content ?? '');
        setFileType(file.file_type);
        setGithubRepo(file.github_repo ?? null);
        setGithubPath(file.github_path ?? null);
        setGithubSha(file.github_sha ?? null);
      })
      .catch(() => setError('Failed to load file content.'))
      .finally(() => setLoading(false));
  }, [fileId]);

  const handleSave = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    setSaved(false);
    try {
      await api.put(`/files/${fileId}`, { content });
      setDirty(false);
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [dirty, content, fileId, onSaved]);

  useEffect(() => { saveRef.current = handleSave; }, [handleSave]);

  const handlePush = async () => {
    if (!githubRepo || !githubPath) return;
    setPushing(true);
    setPushMsg('');
    try {
      const res = await api.put(`/github/push/${fileId}`, {
        commit_message: `Update ${githubPath} via Neural Network`,
      });
      setGithubSha(res.data.data.sha);
      setPushMsg('Pushed!');
      setTimeout(() => setPushMsg(''), 2500);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setPushMsg(axiosErr.response?.data?.message ?? 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const handleEditorMount: OnMount = useCallback((editorInstance, monacoInstance) => {
    editorInstance.addCommand(
      monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
      () => saveRef.current()
    );
  }, []);

  const lang = detectLanguage(fileName, fileType);
  const isReadOnly = !!fileType?.includes('google-apps');

  return (
    <div className="flex flex-col h-full bg-gray-950 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3">
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes" />}
          {saved && <span className="text-xs text-green-400">Saved</span>}
          {error && <span className="text-xs text-red-400">{error}</span>}
          <span className="text-xs text-gray-500">{lang}</span>
          {githubRepo && (
            <span className="text-xs text-gray-600 truncate max-w-[160px]" title={githubPath ?? ''}>
              ⚡ {githubRepo}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {githubRepo && !isReadOnly && (
            <button
              onClick={handlePush}
              disabled={pushing || dirty}
              title={dirty ? 'Save first, then push' : 'Push to GitHub'}
              className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-gray-300 rounded-md transition-colors"
            >
              {pushing ? 'Pushing…' : pushMsg || '⚡ Push'}
            </button>
          )}
          {!isReadOnly && (
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
            >
              {saving ? 'Saving…' : 'Save  ⌘S'}
            </button>
          )}
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
            onMount={handleEditorMount}
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
              readOnly: isReadOnly,
            }}
          />
        </div>
      )}

      {/* Hidden sha tracker — updated after push so next push uses fresh sha */}
      <input type="hidden" value={githubSha ?? ''} />
    </div>
  );
};
