import { useState, useRef } from 'react';
import { DBFile, Project } from '../../types';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface Props {
  files: DBFile[];
  projects: Project[];
  openFileIds: string[];
  activeFileId: string | null;
  onFileOpen: (file: DBFile) => void;
  onRefresh: () => void;
  onSyncDrive: () => void;
  syncing: boolean;
}

const MIME_ICON: Record<string, string> = {
  'application/vnd.google-apps.document': '📄',
  'application/vnd.google-apps.spreadsheet': '📊',
  'application/vnd.google-apps.presentation': '📑',
  'application/pdf': '📕',
  'text/': '📝',
  'image/': '🖼',
  'video/': '🎬',
  'audio/': '🎵',
};

const fileIcon = (mimeType: string | null) => {
  if (!mimeType) return '📄';
  for (const [k, v] of Object.entries(MIME_ICON)) {
    if (mimeType.startsWith(k)) return v;
  }
  return '📄';
};

export const FileExplorer = ({
  files,
  projects,
  openFileIds,
  activeFileId,
  onFileOpen,
  onRefresh,
  onSyncDrive,
  syncing,
}: Props) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState<string | null>(null); // project id or 'unassigned'
  const [newName, setNewName] = useState('');
  const [creating_err, setCreatingErr] = useState('');
  const newFileRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const startCreate = (projectId: string | null) => {
    setCreating(projectId ?? 'unassigned');
    setNewName('');
    setCreatingErr('');
    setTimeout(() => newFileRef.current?.focus(), 50);
  };

  const commitCreate = async () => {
    if (!newName.trim()) { setCreating(null); return; }
    try {
      const projectId = creating === 'unassigned' ? undefined : creating ?? undefined;
      const res = await api.post('/files', {
        file_name: newName.trim(),
        project_id: projectId,
        content: '',
      });
      const created: DBFile = res.data.data.file;
      onRefresh();
      onFileOpen(created);
      setCreating(null);
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setCreatingErr(axiosErr.response?.data?.message ?? 'Failed');
    }
  };

  const groups: { label: string; project: Project | null; files: DBFile[] }[] = [
    ...projects.map((p) => ({
      label: p.name,
      project: p,
      files: files.filter((f) => f.project_id === p.id),
    })),
    {
      label: 'Unassigned',
      project: null,
      files: files.filter((f) => !f.project_id),
    },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900 select-none">
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Explorer</span>
        <button
          onClick={onSyncDrive}
          disabled={syncing}
          title="Sync Drive files"
          className="text-gray-500 hover:text-gray-200 disabled:opacity-40 transition-colors text-xs px-1.5 py-0.5 rounded"
        >
          {syncing ? '⟳ Syncing…' : '⟳ Sync'}
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map(({ label, project, files: groupFiles }) => {
          const groupKey = project?.id ?? 'unassigned';
          const isOpen = !collapsed[groupKey];

          return (
            <div key={groupKey}>
              {/* Folder row */}
              <div
                className="flex items-center gap-1 px-2 py-0.5 hover:bg-gray-800/60 cursor-pointer group"
                onClick={() => toggle(groupKey)}
              >
                <span className="text-gray-500 text-xs w-3">{isOpen ? '▾' : '▸'}</span>
                {project?.color_tag && (
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: project.color_tag }}
                  />
                )}
                <span className="text-xs text-gray-300 font-medium flex-1 truncate">{label}</span>
                <span className="text-gray-600 text-xs opacity-0 group-hover:opacity-100 ml-1">
                  {groupFiles.length}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); startCreate(project?.id ?? null); }}
                  title="New file"
                  className="text-gray-600 hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity ml-1 text-xs px-0.5"
                >
                  +
                </button>
              </div>

              {/* Files */}
              {isOpen && (
                <div>
                  {groupFiles.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => onFileOpen(file)}
                      className={`flex items-center gap-1.5 pl-6 pr-2 py-0.5 cursor-pointer hover:bg-gray-800/60 transition-colors ${
                        activeFileId === file.id
                          ? 'bg-gray-700/60 text-white'
                          : openFileIds.includes(file.id)
                          ? 'text-gray-300'
                          : 'text-gray-400'
                      }`}
                    >
                      <span className="text-xs shrink-0">{fileIcon(file.file_type)}</span>
                      <span className="text-xs truncate">{file.file_name}</span>
                    </div>
                  ))}

                  {/* New file inline input */}
                  {creating === (project?.id ?? 'unassigned') && (
                    <div className="pl-6 pr-2 py-0.5">
                      <input
                        ref={newFileRef}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitCreate();
                          if (e.key === 'Escape') setCreating(null);
                        }}
                        onBlur={commitCreate}
                        placeholder="filename.ts"
                        className="w-full text-xs bg-gray-800 border border-blue-500 text-white px-1.5 py-0.5 rounded outline-none"
                      />
                      {creating_err && <p className="text-red-400 text-xs mt-0.5">{creating_err}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="border-t border-gray-800 px-3 py-2 shrink-0 flex gap-2">
        <button
          onClick={() => startCreate(null)}
          className="flex-1 text-xs text-gray-500 hover:text-gray-200 transition-colors text-left"
        >
          + New file
        </button>
      </div>
    </div>
  );
};
