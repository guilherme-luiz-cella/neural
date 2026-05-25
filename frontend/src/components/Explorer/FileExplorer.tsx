import { useState, useRef, useCallback } from 'react';
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
  onConnectGitHub: () => void;
  syncing: boolean;
  githubConnected: boolean;
  githubUsername: string | null;
}

const ICON: Record<string, string> = {
  'application/vnd.google-apps.document': '📄',
  'application/vnd.google-apps.spreadsheet': '📊',
  'application/vnd.google-apps.presentation': '📑',
  'application/pdf': '📕',
  'text/': '📝',
  'image/': '🖼️',
  'video/': '🎬',
  'audio/': '🎵',
  'text/typescript': '🟦',
  'text/javascript': '🟨',
  'text/x-python': '🐍',
};

const fileIcon = (mimeType: string | null) => {
  if (!mimeType) return '📄';
  for (const [k, v] of Object.entries(ICON)) {
    if (mimeType.startsWith(k)) return v;
  }
  return '📄';
};

type ContextMenu = { x: number; y: number; file: DBFile } | null;

export const FileExplorer = ({
  files,
  projects,
  openFileIds,
  activeFileId,
  onFileOpen,
  onRefresh,
  onSyncDrive,
  onConnectGitHub,
  syncing,
  githubConnected,
  githubUsername,
}: Props) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creatingFile, setCreatingFile] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderColor, setNewFolderColor] = useState('#3B82F6');
  const [createErr, setCreateErr] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => setCollapsed((p) => ({ ...p, [id]: !p[id] }));

  const startCreateFile = (projectId: string | null) => {
    setCreatingFile(projectId ?? 'unassigned');
    setNewName('');
    setCreateErr('');
    setTimeout(() => fileInputRef.current?.focus(), 50);
  };

  const commitCreateFile = useCallback(async () => {
    if (!newName.trim()) { setCreatingFile(null); return; }
    try {
      const projectId = creatingFile === 'unassigned' ? undefined : creatingFile ?? undefined;
      const res = await api.post('/files', { file_name: newName.trim(), project_id: projectId, content: '' });
      onRefresh();
      onFileOpen(res.data.data.file as DBFile);
      setCreatingFile(null);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setCreateErr(e.response?.data?.message ?? 'Failed');
    }
  }, [newName, creatingFile, onRefresh, onFileOpen]);

  const commitCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) { setCreatingFolder(false); return; }
    try {
      await api.post('/projects', { name: newFolderName.trim(), color_tag: newFolderColor });
      onRefresh();
      setCreatingFolder(false);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setCreateErr(e.response?.data?.message ?? 'Failed');
    }
  }, [newFolderName, newFolderColor, onRefresh]);

  const handleDelete = async (fileId: string) => {
    await api.delete(`/files/${fileId}`);
    onRefresh();
    setContextMenu(null);
  };

  const handleDownload = (file: DBFile) => {
    const url = `${import.meta.env.VITE_API_URL}/files/${file.id}/download`;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.file_name;
    // Pass auth token via URL — simpler than fetch+blob for large files
    // Use fetch+blob approach for auth
    const token = localStorage.getItem('access_token');
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        a.href = blobUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      });
    setContextMenu(null);
  };

  const handleDownloadZip = async (projectId?: string) => {
    const body = projectId ? { project_id: projectId } : { file_ids: files.map((f) => f.id) };
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${import.meta.env.VITE_API_URL}/files/download-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neural-export.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const groups = [
    ...projects.map((p) => ({ label: p.name, project: p, files: files.filter((f) => f.project_id === p.id) })),
    { label: 'Unassigned', project: null, files: files.filter((f) => !f.project_id) },
  ];

  const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];

  return (
    <div
      className="flex flex-col h-full bg-gray-900 select-none text-xs"
      onClick={() => setContextMenu(null)}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-gray-400 uppercase tracking-wider">Explorer</span>
          <button onClick={onSyncDrive} disabled={syncing} className="text-gray-500 hover:text-gray-200 disabled:opacity-40 transition-colors">
            {syncing ? '⟳ …' : '⟳ Sync'}
          </button>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => startCreateFile(null)}
            title="New file"
            className="flex-1 flex items-center justify-center gap-1 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors"
          >
            📄 New File
          </button>
          <button
            onClick={() => { setCreatingFolder(true); setNewFolderName(''); setCreateErr(''); setTimeout(() => folderInputRef.current?.focus(), 50); }}
            title="New folder"
            className="flex-1 flex items-center justify-center gap-1 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors"
          >
            📁 New Folder
          </button>
          <button
            onClick={() => handleDownloadZip()}
            title="Download all as ZIP"
            className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors"
          >
            ⬇
          </button>
        </div>
      </div>

      {/* New folder form */}
      {creatingFolder && (
        <div className="px-3 py-2 bg-gray-800/60 border-b border-gray-700 space-y-1.5">
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitCreateFolder(); if (e.key === 'Escape') setCreatingFolder(false); }}
            placeholder="Folder name…"
            className="w-full bg-gray-900 border border-blue-500 text-white px-2 py-1 rounded outline-none"
          />
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setNewFolderColor(c)}
                className={`w-4 h-4 rounded-full transition-transform ${newFolderColor === c ? 'scale-125 ring-1 ring-white' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {createErr && <p className="text-red-400">{createErr}</p>}
          <div className="flex gap-1">
            <button onClick={commitCreateFolder} className="flex-1 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors">Create</button>
            <button onClick={() => setCreatingFolder(false)} className="px-2 py-0.5 text-gray-500 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {/* GitHub banner */}
      <div className="px-3 py-1.5 border-b border-gray-800 shrink-0">
        {githubConnected ? (
          <div className="flex items-center gap-1.5 text-gray-500">
            <span>⚡</span>
            <span className="text-green-400">{githubUsername}</span>
            <span className="text-gray-600">connected</span>
          </div>
        ) : (
          <button onClick={onConnectGitHub} className="w-full flex items-center justify-center gap-1.5 py-1 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded transition-colors">
            <span>⚡</span> Connect GitHub
          </button>
        )}
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {groups.map(({ label, project, files: gFiles }) => {
          const key = project?.id ?? 'unassigned';
          const isOpen = !collapsed[key];

          return (
            <div key={key}>
              {/* Folder header */}
              <div
                className="flex items-center gap-1 px-2 py-0.5 hover:bg-gray-800/60 cursor-pointer group"
                onClick={() => toggle(key)}
                onContextMenu={(e) => { e.preventDefault(); /* folder menu TODO */ }}
              >
                <span className="text-gray-500 w-3">{isOpen ? '▾' : '▸'}</span>
                {project?.color_tag && (
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: project.color_tag }} />
                )}
                <span className="text-gray-300 font-medium flex-1 truncate">{label}</span>
                <span className="text-gray-700 opacity-0 group-hover:opacity-100">{gFiles.length}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); startCreateFile(project?.id ?? null); }}
                  title="New file here"
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white px-0.5 ml-0.5 transition-all"
                >+</button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownloadZip(project?.id); }}
                  title="Download folder as ZIP"
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white px-0.5 transition-all"
                >⬇</button>
              </div>

              {isOpen && (
                <div>
                  {gFiles.map((file) => (
                    <div
                      key={file.id}
                      onClick={() => onFileOpen(file)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file }); }}
                      className={`flex items-center gap-1.5 pl-6 pr-2 py-0.5 cursor-pointer hover:bg-gray-800/60 transition-colors ${
                        activeFileId === file.id ? 'bg-gray-700/70 text-white' : openFileIds.includes(file.id) ? 'text-gray-300' : 'text-gray-400'
                      }`}
                    >
                      <span className="shrink-0">{fileIcon(file.file_type)}</span>
                      <span className="truncate flex-1">{file.file_name}</span>
                      {(file as DBFile & { github_repo?: string }).github_repo && (
                        <span className="text-gray-600 shrink-0">⚡</span>
                      )}
                    </div>
                  ))}

                  {creatingFile === (project?.id ?? 'unassigned') && (
                    <div className="pl-6 pr-2 py-0.5">
                      <input
                        ref={fileInputRef}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitCreateFile(); if (e.key === 'Escape') setCreatingFile(null); }}
                        onBlur={commitCreateFile}
                        placeholder="filename.ts"
                        className="w-full bg-gray-800 border border-blue-500 text-white px-1.5 py-0.5 rounded outline-none"
                      />
                      {createErr && <p className="text-red-400 mt-0.5">{createErr}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 w-44"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { onFileOpen(contextMenu.file); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-300">
            Open
          </button>
          <button onClick={() => handleDownload(contextMenu.file)}
            className="w-full text-left px-3 py-1.5 hover:bg-gray-700 text-gray-300">
            Download
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button onClick={() => handleDelete(contextMenu.file.id)}
            className="w-full text-left px-3 py-1.5 hover:bg-red-900/60 text-red-400">
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
