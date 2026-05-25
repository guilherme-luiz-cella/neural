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

// ── File type badge ──────────────────────────────────────────────────────────

interface TypeInfo { label: string; color: string }

const MIME_MAP: { prefix: string; info: TypeInfo }[] = [
  { prefix: 'application/vnd.google-apps.document',     info: { label: 'DOC',  color: '#4285F4' } },
  { prefix: 'application/vnd.google-apps.spreadsheet',  info: { label: 'SHT',  color: '#0F9D58' } },
  { prefix: 'application/vnd.google-apps.presentation', info: { label: 'SLD',  color: '#F4B400' } },
  { prefix: 'application/pdf',                          info: { label: 'PDF',  color: '#FF4444' } },
  { prefix: 'text/typescript',   info: { label: 'TS',   color: '#3178C6' } },
  { prefix: 'text/javascript',   info: { label: 'JS',   color: '#F0DB4F' } },
  { prefix: 'text/x-python',     info: { label: 'PY',   color: '#4B8BBE' } },
  { prefix: 'text/x-go',         info: { label: 'GO',   color: '#00ACD7' } },
  { prefix: 'text/x-rust',       info: { label: 'RS',   color: '#DEA584' } },
  { prefix: 'text/html',         info: { label: 'HTML', color: '#E34F26' } },
  { prefix: 'text/css',          info: { label: 'CSS',  color: '#264DE4' } },
  { prefix: 'text/x-scss',       info: { label: 'CSS',  color: '#CF649A' } },
  { prefix: 'application/json',  info: { label: 'JSON', color: '#CBCB41' } },
  { prefix: 'text/x-yaml',       info: { label: 'YML',  color: '#CC1018' } },
  { prefix: 'text/markdown',     info: { label: 'MD',   color: '#5C9EAD' } },
  { prefix: 'application/sql',   info: { label: 'SQL',  color: '#DA2200' } },
  { prefix: 'application/x-sh',  info: { label: 'SH',   color: '#4EAA25' } },
  { prefix: 'image/',            info: { label: 'IMG',  color: '#E879F9' } },
  { prefix: 'video/',            info: { label: 'VID',  color: '#F87171' } },
  { prefix: 'audio/',            info: { label: 'AUD',  color: '#A78BFA' } },
];

const EXT_MAP: Record<string, TypeInfo> = {
  ts:    { label: 'TS',   color: '#3178C6' },
  tsx:   { label: 'TSX',  color: '#3178C6' },
  js:    { label: 'JS',   color: '#F0DB4F' },
  jsx:   { label: 'JSX',  color: '#F0DB4F' },
  py:    { label: 'PY',   color: '#4B8BBE' },
  go:    { label: 'GO',   color: '#00ACD7' },
  rs:    { label: 'RS',   color: '#DEA584' },
  java:  { label: 'JAV',  color: '#F89820' },
  cs:    { label: 'C#',   color: '#68217A' },
  cpp:   { label: 'C++',  color: '#659AD2' },
  c:     { label: 'C',    color: '#659AD2' },
  rb:    { label: 'RB',   color: '#CC342D' },
  php:   { label: 'PHP',  color: '#8892BF' },
  swift: { label: 'SW',   color: '#FA7343' },
  kt:    { label: 'KT',   color: '#F88909' },
  html:  { label: 'HTML', color: '#E34F26' },
  css:   { label: 'CSS',  color: '#264DE4' },
  scss:  { label: 'CSS',  color: '#CF649A' },
  json:  { label: 'JSON', color: '#CBCB41' },
  yaml:  { label: 'YML',  color: '#CC1018' },
  yml:   { label: 'YML',  color: '#CC1018' },
  md:    { label: 'MD',   color: '#5C9EAD' },
  txt:   { label: 'TXT',  color: '#6B7280' },
  sql:   { label: 'SQL',  color: '#DA2200' },
  sh:    { label: 'SH',   color: '#4EAA25' },
  toml:  { label: 'TOML', color: '#9C4221' },
  pdf:   { label: 'PDF',  color: '#FF4444' },
};

const getTypeInfo = (fileName: string, mimeType: string | null): TypeInfo => {
  if (mimeType) {
    for (const { prefix, info } of MIME_MAP) {
      if (mimeType.startsWith(prefix)) return info;
    }
  }
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MAP[ext] ?? { label: ext.toUpperCase().slice(0, 4) || 'FILE', color: '#6B7280' };
};

const FileTypeBadge = ({ fileName, fileType }: { fileName: string; fileType: string | null }) => {
  const { label, color } = getTypeInfo(fileName, fileType);
  return (
    <span
      style={{ color, borderColor: color + '50', fontSize: 8, lineHeight: '12px' }}
      className="inline-flex items-center border rounded px-[3px] font-mono font-bold shrink-0 leading-none"
    >
      {label}
    </span>
  );
};

// ── Component ────────────────────────────────────────────────────────────────

type ContextMenu = { x: number; y: number; file: DBFile } | null;

const COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'];

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
    const token = localStorage.getItem('access_token');
    const url = `${import.meta.env.VITE_API_URL}/files/${file.id}/download`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = file.file_name;
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

  return (
    <div
      className="flex flex-col h-full bg-[#252526] select-none text-xs"
      onClick={() => setContextMenu(null)}
    >
      {/* Header */}
      <div className="px-3 pt-2.5 pb-1 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold text-[#bbbcbd] uppercase tracking-[0.08em]">Explorer</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onSyncDrive}
              disabled={syncing}
              className="text-[#bbbcbd] hover:text-white disabled:opacity-40 transition-colors text-[10px]"
            >
              {syncing ? 'Syncing...' : 'Sync'}
            </button>
            <button
              onClick={() => handleDownloadZip()}
              title="Download all as ZIP"
              className="text-[#bbbcbd] hover:text-white transition-colors text-[10px]"
            >
              ZIP
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 mb-1.5">
          <button
            onClick={() => startCreateFile(null)}
            className="flex-1 flex items-center justify-center gap-1 py-0.5 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] hover:text-white rounded-sm transition-colors text-[10px]"
          >
            + File
          </button>
          <button
            onClick={() => {
              setCreatingFolder(true);
              setNewFolderName('');
              setCreateErr('');
              setTimeout(() => folderInputRef.current?.focus(), 50);
            }}
            className="flex-1 flex items-center justify-center gap-1 py-0.5 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] hover:text-white rounded-sm transition-colors text-[10px]"
          >
            + Folder
          </button>
        </div>
      </div>

      {/* New folder form */}
      {creatingFolder && (
        <div className="px-3 py-2 bg-[#2d2d2d] border-y border-[#3c3c3c] space-y-1.5 shrink-0">
          <input
            ref={folderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreateFolder();
              if (e.key === 'Escape') setCreatingFolder(false);
            }}
            placeholder="Folder name"
            className="w-full bg-[#3c3c3c] border border-[#007acc] text-white px-2 py-1 rounded-sm outline-none text-xs"
          />
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewFolderColor(c)}
                className={`w-3.5 h-3.5 rounded-sm transition-transform ${newFolderColor === c ? 'scale-125 ring-1 ring-white/60' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          {createErr && <p className="text-red-400 text-[10px]">{createErr}</p>}
          <div className="flex gap-1">
            <button
              onClick={commitCreateFolder}
              className="flex-1 py-0.5 bg-[#007acc] hover:bg-[#0088e0] text-white rounded-sm transition-colors text-[10px]"
            >
              Create
            </button>
            <button
              onClick={() => setCreatingFolder(false)}
              className="px-2 py-0.5 text-[#888] hover:text-white text-[10px]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* GitHub status */}
      <div className="px-3 py-1 border-b border-[#3c3c3c] shrink-0">
        {githubConnected ? (
          <div className="flex items-center gap-1.5 text-[10px] text-[#888]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
            <span className="text-green-400">{githubUsername}</span>
            <span>— GitHub</span>
          </div>
        ) : (
          <button
            onClick={onConnectGitHub}
            className="w-full flex items-center justify-center gap-1.5 py-0.5 bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] hover:text-white rounded-sm transition-colors text-[10px]"
          >
            Connect GitHub
          </button>
        )}
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto mt-0.5">
        {groups.map(({ label, project, files: gFiles }) => {
          const key = project?.id ?? 'unassigned';
          const isOpen = !collapsed[key];

          return (
            <div key={key}>
              {/* Folder row */}
              <div
                className="flex items-center gap-1 px-2 py-[3px] hover:bg-[#2a2d2e] cursor-pointer group"
                onClick={() => toggle(key)}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Caret */}
                <span className="text-[#c5c5c5] w-3 shrink-0 text-[9px]">
                  {isOpen ? '▾' : '▸'}
                </span>
                {/* Color dot for project */}
                {project?.color_tag && (
                  <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: project.color_tag }} />
                )}
                <span className="text-[#cccccc] font-semibold flex-1 truncate tracking-wide text-[10px] uppercase">
                  {label}
                </span>
                <span className="text-[#555] text-[9px] opacity-0 group-hover:opacity-100 mr-1">
                  {gFiles.length}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); startCreateFile(project?.id ?? null); }}
                  title="New file"
                  className="opacity-0 group-hover:opacity-100 text-[#bbbcbd] hover:text-white px-0.5 transition-all text-[10px]"
                >
                  +
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownloadZip(project?.id); }}
                  title="Download as ZIP"
                  className="opacity-0 group-hover:opacity-100 text-[#bbbcbd] hover:text-white px-0.5 transition-all text-[10px]"
                >
                  ↓
                </button>
              </div>

              {isOpen && (
                <div>
                  {gFiles.map((file) => {
                    const isActive = activeFileId === file.id;
                    const isOpen_ = openFileIds.includes(file.id);
                    return (
                      <div
                        key={file.id}
                        onClick={() => onFileOpen(file)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({ x: e.clientX, y: e.clientY, file });
                        }}
                        className={`flex items-center gap-1.5 pl-5 pr-2 py-[3px] cursor-pointer transition-colors ${
                          isActive
                            ? 'bg-[#37373d] text-[#cccccc] border-l-2 border-[#007acc]'
                            : isOpen_
                            ? 'text-[#cccccc] hover:bg-[#2a2d2e]'
                            : 'text-[#999] hover:bg-[#2a2d2e] hover:text-[#cccccc]'
                        }`}
                      >
                        <FileTypeBadge fileName={file.file_name} fileType={file.file_type} />
                        <span className="truncate flex-1 text-[11px]">{file.file_name}</span>
                        {file.github_repo && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-[#4ec9b0] shrink-0"
                            title={`GitHub: ${file.github_repo}`}
                          />
                        )}
                        {isOpen_ && !isActive && (
                          <span className="w-1 h-1 rounded-full bg-[#555] shrink-0" />
                        )}
                      </div>
                    );
                  })}

                  {creatingFile === (project?.id ?? 'unassigned') && (
                    <div className="pl-5 pr-2 py-0.5">
                      <input
                        ref={fileInputRef}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitCreateFile();
                          if (e.key === 'Escape') setCreatingFile(null);
                        }}
                        onBlur={commitCreateFile}
                        placeholder="filename.ts"
                        className="w-full bg-[#3c3c3c] border border-[#007acc] text-white px-1.5 py-0.5 rounded-sm outline-none text-[11px]"
                      />
                      {createErr && <p className="text-red-400 mt-0.5 text-[10px]">{createErr}</p>}
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
          className="fixed z-50 bg-[#252526] border border-[#3c3c3c] rounded shadow-xl py-1 w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { onFileOpen(contextMenu.file); setContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#094771] text-[#cccccc] text-xs"
          >
            Open
          </button>
          <button
            onClick={() => handleDownload(contextMenu.file)}
            className="w-full text-left px-3 py-1.5 hover:bg-[#094771] text-[#cccccc] text-xs"
          >
            Download
          </button>
          <div className="border-t border-[#3c3c3c] my-0.5" />
          <button
            onClick={() => handleDelete(contextMenu.file.id)}
            className="w-full text-left px-3 py-1.5 hover:bg-[#8b1a1a] text-red-400 text-xs"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};
