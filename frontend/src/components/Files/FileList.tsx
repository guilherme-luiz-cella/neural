import { useState } from 'react';
import { DBFile } from '../../types';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

const MIME_LABEL: Record<string, string> = {
  'application/vnd.google-apps.document': 'DOC',
  'application/vnd.google-apps.spreadsheet': 'XLS',
  'application/vnd.google-apps.presentation': 'PPT',
  'application/pdf': 'PDF',
  'text/plain': 'TXT',
  'image/': 'IMG',
  'video/': 'VID',
  'audio/': 'AUD',
};

const fileIcon = (mimeType: string | null) => {
  if (!mimeType) return 'FILE';
  for (const [key, label] of Object.entries(MIME_LABEL)) {
    if (mimeType.startsWith(key)) return label;
  }
  return 'FILE';
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

interface Props {
  files: DBFile[];
  onSynced: () => void;
  onFileClick?: (id: string, name: string) => void;
}

export const FileList = ({ files, onSynced, onFileClick }: Props) => {
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await api.post('/drive/sync');
      setSyncMsg(res.data.message);
      onSynced();
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setSyncMsg(axiosErr.response?.data?.message ?? 'Sync failed. Try again.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
          Files ({files.length})
        </h3>
        <div className="flex items-center gap-3">
          {syncMsg && <span className="text-xs text-gray-500">{syncMsg}</span>}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 rounded-lg border border-gray-700 transition-colors"
          >
            {syncing ? 'Syncing…' : 'Sync Drive'}
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="text-center py-8 text-gray-600 text-sm">
          No files yet — click "Sync Drive" to import from Google Drive.
        </div>
      ) : (
        <div className="divide-y divide-gray-800">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 py-3 hover:bg-gray-900/50 px-2 rounded-lg transition-colors cursor-pointer"
              onClick={() => onFileClick?.(file.id, file.file_name)}
            >
              <span className="text-[10px] font-semibold text-gray-500 w-9 shrink-0">{fileIcon(file.file_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{file.file_name}</p>
                <p className="text-xs text-gray-500">{file.file_type ?? 'Unknown type'}</p>
              </div>
              <span className="text-xs text-gray-600 shrink-0">{fmt(file.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
