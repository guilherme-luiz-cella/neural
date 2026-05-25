import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { ConnectDrive } from '../Drive/ConnectDrive';
import { FileList } from '../Files/FileList';
import { ProjectPanel } from '../Projects/ProjectPanel';
import { GraphView } from '../Graph/GraphView';
import { FileEditor } from '../Editor/FileEditor';
import { api } from '../../utils/api';
import { DBFile, Project } from '../../types';

type Tab = 'files' | 'projects' | 'graph';

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [files, setFiles] = useState<DBFile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [banner, setBanner] = useState('');
  const [tab, setTab] = useState<Tab>('files');

  // Editor state — opens when a node is clicked in graph or file is selected
  const [editorFile, setEditorFile] = useState<{ id: string; name: string } | null>(null);
  const [crawlTrigger] = useState(0);

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

  const refresh = useCallback(() => {
    fetchFiles();
    fetchProjects();
  }, [fetchFiles, fetchProjects]);

  useEffect(() => {
    fetchDriveStatus();
    fetchFiles();
    fetchProjects();
  }, [fetchDriveStatus, fetchFiles, fetchProjects]);

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
  }, [searchParams, setSearchParams, fetchFiles]);

  const handleNodeClick = (nodeId: string, nodeName: string) => {
    setEditorFile({ id: nodeId, name: nodeName });
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold tracking-tight">Neural Network</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm hidden sm:block">{user?.email}</span>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-6 py-6 min-h-0">
        {banner && (
          <div className="mb-4 p-3 bg-blue-900/40 border border-blue-700 text-blue-300 rounded-lg text-sm shrink-0">
            {banner}
          </div>
        )}

        {!driveConnected && (
          <div className="mb-4 shrink-0">
            <h2 className="text-2xl font-semibold mb-1">Welcome, {user?.username}</h2>
            <p className="text-gray-500 text-sm">Your file neural network</p>
          </div>
        )}

        {driveConnected === null ? (
          <div className="text-gray-600 text-sm">Loading…</div>
        ) : !driveConnected ? (
          <ConnectDrive onConnected={() => { setDriveConnected(true); fetchFiles(); }} />
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex gap-1 mb-4 border-b border-gray-800 shrink-0">
              {(['files', 'projects', 'graph'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                    tab === t
                      ? 'border-blue-500 text-white'
                      : 'border-transparent text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t}
                  {t === 'files' && <span className="ml-1.5 text-xs text-gray-600">({files.length})</span>}
                  {t === 'projects' && <span className="ml-1.5 text-xs text-gray-600">({projects.length})</span>}
                </button>
              ))}
            </div>

            <div className={`flex gap-4 flex-1 min-h-0 ${tab === 'graph' ? 'flex-row' : 'flex-col'}`}>
              <div className={tab === 'graph' ? 'flex-1 min-w-0 min-h-0' : ''}>
                {tab === 'files' && (
                  <FileList files={files} onSynced={refresh} onFileClick={(id, name) => setEditorFile({ id, name })} />
                )}
                {tab === 'projects' && (
                  <ProjectPanel projects={projects} files={files} onChanged={refresh} />
                )}
                {tab === 'graph' && (
                  <GraphView
                    onNodeClick={handleNodeClick}
                    crawlTrigger={crawlTrigger}
                  />
                )}
              </div>

              {editorFile && (
                <div className={tab === 'graph' ? 'w-[480px] shrink-0 min-h-0' : 'h-96 mt-2'}>
                  <FileEditor
                    fileId={editorFile.id}
                    fileName={editorFile.name}
                    onClose={() => setEditorFile(null)}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
