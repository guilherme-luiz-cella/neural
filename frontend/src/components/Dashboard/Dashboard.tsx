import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ConnectDrive } from '../Drive/ConnectDrive';
import { FileExplorer } from '../Explorer/FileExplorer';
import { GitHubPanel } from '../GitHub/GitHubPanel';
import { api } from '../../utils/api';
import { DBFile, Project } from '../../types';

const FileEditor = lazy(() =>
  import('../Editor/FileEditor').then((m) => ({ default: m.FileEditor }))
);
const MediaViewer = lazy(() =>
  import('../Editor/MediaViewer').then((m) => ({ default: m.MediaViewer }))
);
const GraphView = lazy(() =>
  import('../Graph/GraphView').then((m) => ({ default: m.GraphView }))
);

interface OpenTab {
  id: string;
  name: string;
}

type View = 'editor' | 'graph';

const isMediaFile = (fileType: string | null) =>
  !!fileType && (
    fileType.startsWith('image/') ||
    fileType.startsWith('video/') ||
    fileType.startsWith('audio/')
  );

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<DBFile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [banner, setBanner] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [showGithubPanel, setShowGithubPanel] = useState(false);

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [view, setView] = useState<View>('editor');

  const fetchDriveStatus = useCallback(async () => {
    try {
      const res = await api.get('/drive/status');
      setDriveConnected(res.data.data.connected);
    } catch {
      setDriveConnected(false);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    try {
      const res = await api.get('/files');
      setFiles(res.data.data.files ?? []);
    } catch {
      setFiles([]);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get('/projects');
      setProjects(res.data.data.projects ?? []);
    } catch {
      setProjects([]);
    }
  }, []);

  const fetchGithubStatus = useCallback(async () => {
    try {
      const res = await api.get('/github/status');
      setGithubConnected(res.data.data.connected);
      setGithubUsername(res.data.data.username ?? null);
    } catch {
      setGithubConnected(false);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchFiles();
    fetchProjects();
  }, [fetchFiles, fetchProjects]);

  useEffect(() => {
    fetchDriveStatus();
    fetchFiles();
    fetchProjects();
    fetchGithubStatus();
  }, [fetchDriveStatus, fetchFiles, fetchProjects, fetchGithubStatus]);

  useEffect(() => {
    if (searchParams.get('drive_connected') === 'true') {
      setBanner('Google Drive connected.');
      setDriveConnected(true);
      setSearchParams({}, { replace: true });
      fetchFiles();
    }
    if (searchParams.get('drive_error')) {
      setBanner('Failed to connect Google Drive. Try again.');
      setSearchParams({}, { replace: true });
    }
    if (searchParams.get('github_connected') === 'true') {
      setBanner('GitHub connected.');
      setSearchParams({}, { replace: true });
      fetchGithubStatus();
    }
    if (searchParams.get('github_error')) {
      setBanner(`GitHub error: ${searchParams.get('github_error')}`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, fetchFiles, fetchGithubStatus]);

  const handleFileOpen = (file: DBFile) => {
    setView('editor');
    setActiveTabId(file.id);
    setTabs((prev) => {
      if (prev.some((t) => t.id === file.id)) return prev;
      return [...prev, { id: file.id, name: file.file_name }];
    });
  };

  const handleTabClose = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        setActiveTabId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
  };

  const handleSyncDrive = async () => {
    setSyncing(true);
    setSyncMsg('');
    try {
      const res = await api.post('/drive/sync');
      setSyncMsg(res.data.message);
      fetchFiles();
    } catch {
      setSyncMsg('Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleConnectGitHub = async () => {
    try {
      const res = await api.get('/github');
      window.location.href = res.data.data.url;
    } catch {
      setBanner('Failed to start GitHub OAuth');
    }
  };

  const handleNodeClick = (nodeId: string, nodeName: string) => {
    handleFileOpen({ id: nodeId, file_name: nodeName } as DBFile);
    setView('editor');
  };

  const activeFile = files.find((f) => f.id === activeTabId);
  const activeIsMedia = isMediaFile(activeFile?.file_type ?? null);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white overflow-hidden">
      {/* Title bar */}
      <header className="border-b border-gray-800 px-4 py-2 flex items-center justify-between shrink-0 bg-gray-900">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold tracking-tight">Neural Network</span>
          {/* View toggles */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-md p-0.5">
            <button
              onClick={() => setView('editor')}
              className={`px-3 py-1 text-xs rounded transition-colors ${view === 'editor' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Editor
            </button>
            <button
              onClick={() => setView('graph')}
              className={`px-3 py-1 text-xs rounded transition-colors ${view === 'graph' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Graph
            </button>
          </div>
          {syncMsg && <span className="text-xs text-gray-500">{syncMsg}</span>}
          {banner && <span className="text-xs text-blue-400">{banner}</span>}
        </div>
        <div className="flex items-center gap-3">
          {githubConnected && (
            <button
              onClick={() => setShowGithubPanel(true)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-white transition-colors"
              title="Browse GitHub repos"
            >
              <span>⚡</span>
              <span className="text-green-400 hidden sm:inline">{githubUsername}</span>
              <span className="text-gray-600 hidden sm:inline">· Repos</span>
            </button>
          )}
          <span className="text-gray-500 text-xs hidden sm:block">{user?.email}</span>
          <button onClick={logout} className="text-xs text-gray-500 hover:text-white transition-colors">
            Logout
          </button>
        </div>
      </header>

      {driveConnected === null ? (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">Loading…</div>
      ) : !driveConnected ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <ConnectDrive onConnected={() => { setDriveConnected(true); fetchFiles(); }} />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar — File Explorer */}
          <aside className="w-56 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
            <FileExplorer
              files={files}
              projects={projects}
              openFileIds={tabs.map((t) => t.id)}
              activeFileId={activeTabId}
              onFileOpen={handleFileOpen}
              onRefresh={refresh}
              onSyncDrive={handleSyncDrive}
              onConnectGitHub={handleConnectGitHub}
              syncing={syncing}
              githubConnected={githubConnected}
              githubUsername={githubUsername}
            />
          </aside>

          {/* Main area */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {view === 'editor' ? (
              <>
                {/* Tab bar */}
                <div className="flex items-center border-b border-gray-800 bg-gray-900 shrink-0 overflow-x-auto">
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      onClick={() => setActiveTabId(tab.id)}
                      className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-gray-800 shrink-0 group transition-colors ${
                        activeTabId === tab.id
                          ? 'bg-gray-950 text-white border-t border-t-blue-500'
                          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                      }`}
                    >
                      <span className="max-w-[120px] truncate">{tab.name}</span>
                      <button
                        onClick={(e) => handleTabClose(tab.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition-all ml-0.5 leading-none"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {tabs.length === 0 && (
                    <span className="text-xs text-gray-700 px-4 py-2">
                      Select a file from the explorer →
                    </span>
                  )}
                </div>

                {/* Editor / Viewer */}
                <div className="flex-1 overflow-hidden">
                  {activeTabId ? (
                    <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading…</div>}>
                      {activeIsMedia ? (
                        <MediaViewer
                          key={activeTabId}
                          fileId={activeTabId}
                          fileName={activeFile?.file_name ?? ''}
                          fileType={activeFile?.file_type ?? null}
                        />
                      ) : (
                        <FileEditor
                          key={activeTabId}
                          fileId={activeTabId}
                          fileName={activeFile?.file_name ?? tabs.find((t) => t.id === activeTabId)?.name ?? ''}
                          onClose={() => {
                            setTabs((prev) => {
                              const next = prev.filter((t) => t.id !== activeTabId);
                              setActiveTabId(next[next.length - 1]?.id ?? null);
                              return next;
                            });
                          }}
                          onSaved={fetchFiles}
                        />
                      )}
                    </Suspense>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-700 text-sm gap-2">
                      <p className="text-4xl">📁</p>
                      <p>Open a file from the explorer</p>
                      <p className="text-xs text-gray-600">or click <strong className="text-gray-500">+ New file</strong> to create one</p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Graph view */
              <div className="flex-1 overflow-hidden p-4">
                <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-600 text-sm">Loading graph…</div>}>
                  <GraphView onNodeClick={handleNodeClick} crawlTrigger={0} />
                </Suspense>
              </div>
            )}
          </main>
        </div>
      )}

      {/* GitHub repo browser modal */}
      {showGithubPanel && (
        <GitHubPanel
          onClose={() => setShowGithubPanel(false)}
          onImported={() => { refresh(); setShowGithubPanel(false); }}
          projects={projects}
        />
      )}
    </div>
  );
};
