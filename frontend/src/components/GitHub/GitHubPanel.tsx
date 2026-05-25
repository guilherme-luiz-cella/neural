import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';
import { Project } from '../../types';

interface Repo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  private: boolean;
  default_branch: string;
}

interface TreeFile {
  path: string;
  sha: string;
  size: number;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
  projects: Project[];
}

export const GitHubPanel = ({ onClose, onImported, projects }: Props) => {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [reposErr, setReposErr] = useState('');

  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [branch, setBranch] = useState('main');
  const [treeFiles, setTreeFiles] = useState<TreeFile[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeErr, setTreeErr] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [projectId, setProjectId] = useState<string>('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  useEffect(() => {
    api.get('/github/repos')
      .then((res) => setRepos(res.data.data.repos ?? []))
      .catch((err: AxiosError<{ message: string }>) => {
        setReposErr(err.response?.data?.message ?? 'Failed to load repos');
      })
      .finally(() => setLoadingRepos(false));
  }, []);

  const loadTree = useCallback(async (repo: Repo, br: string) => {
    setLoadingTree(true);
    setTreeErr('');
    setTreeFiles([]);
    setSelected(new Set());
    try {
      const res = await api.get(`/github/repos/${repo.owner.login}/${repo.name}/tree?branch=${br}`);
      setTreeFiles(res.data.data.files ?? []);
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setTreeErr(e.response?.data?.message ?? 'Failed to load tree');
    } finally {
      setLoadingTree(false);
    }
  }, []);

  const selectRepo = (repo: Repo) => {
    setSelectedRepo(repo);
    const br = repo.default_branch;
    setBranch(br);
    loadTree(repo, br);
  };

  const handleBranchChange = (br: string) => {
    setBranch(br);
    if (selectedRepo) loadTree(selectedRepo, br);
  };

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    const visible = filtered.map((f) => f.path);
    const allSelected = visible.every((p) => selected.has(p));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visible.forEach((p) => next.delete(p));
      else visible.forEach((p) => next.add(p));
      return next;
    });
  };

  const handleImport = async () => {
    if (!selectedRepo || selected.size === 0) return;
    setImporting(true);
    setImportMsg('');
    try {
      const res = await api.post(
        `/github/repos/${selectedRepo.owner.login}/${selectedRepo.name}/import`,
        { paths: [...selected], project_id: projectId || undefined }
      );
      setImportMsg(res.data.message);
      onImported();
      setSelected(new Set());
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setImportMsg(e.response?.data?.message ?? 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const filtered = treeFiles.filter((f) =>
    !filter || f.path.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[700px] max-w-[95vw] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold text-sm">⚡ GitHub Repository Browser</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left — repo list */}
          <div className="w-52 shrink-0 border-r border-gray-800 overflow-y-auto">
            <div className="p-2 text-xs text-gray-500 uppercase tracking-wider font-semibold px-3 pt-3">
              Repositories
            </div>
            {loadingRepos && <p className="text-gray-600 text-xs px-3">Loading…</p>}
            {reposErr && <p className="text-red-400 text-xs px-3">{reposErr}</p>}
            {repos.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => selectRepo(repo)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-gray-800 ${
                  selectedRepo?.full_name === repo.full_name
                    ? 'bg-gray-800 text-white border-l-2 border-blue-500'
                    : 'text-gray-400'
                }`}
              >
                <div className="font-medium truncate">{repo.name}</div>
                <div className="text-gray-600 text-[10px] truncate">{repo.owner.login} · {repo.private ? '🔒' : '🌐'}</div>
              </button>
            ))}
          </div>

          {/* Right — file tree */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedRepo ? (
              <div className="flex-1 flex items-center justify-center text-gray-700 text-sm">
                Select a repository
              </div>
            ) : (
              <>
                {/* Tree toolbar */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0 flex-wrap gap-y-1.5">
                  <input
                    value={branch}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    placeholder="branch"
                    className="bg-gray-800 text-white text-xs px-2 py-1 rounded w-24 border border-gray-700 outline-none focus:border-blue-500"
                  />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter files…"
                    className="flex-1 bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-700 outline-none focus:border-blue-500"
                  />
                  {selected.size > 0 && (
                    <span className="text-xs text-blue-400">{selected.size} selected</span>
                  )}
                </div>

                {/* File list */}
                <div className="flex-1 overflow-y-auto">
                  {loadingTree && (
                    <div className="flex items-center justify-center py-8 text-gray-600 text-sm">Loading tree…</div>
                  )}
                  {treeErr && <p className="text-red-400 text-xs px-3 py-2">{treeErr}</p>}
                  {!loadingTree && filtered.length === 0 && !treeErr && (
                    <p className="text-gray-700 text-xs px-3 py-4">No text files found</p>
                  )}
                  {!loadingTree && filtered.length > 0 && (
                    <>
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                        onClick={toggleAll}
                      >
                        <input
                          type="checkbox"
                          readOnly
                          checked={filtered.every((f) => selected.has(f.path))}
                          className="accent-blue-500"
                        />
                        <span>Select all ({filtered.length})</span>
                      </div>
                      {filtered.map((file) => (
                        <div
                          key={file.path}
                          onClick={() => toggleFile(file.path)}
                          className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-gray-800/40 transition-colors ${
                            selected.has(file.path) ? 'text-white' : 'text-gray-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            readOnly
                            checked={selected.has(file.path)}
                            className="accent-blue-500 shrink-0"
                          />
                          <span className="truncate flex-1">{file.path}</span>
                          <span className="text-gray-700 shrink-0">
                            {file.size > 1000 ? `${(file.size / 1000).toFixed(1)}k` : `${file.size}b`}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Import bar */}
                <div className="border-t border-gray-800 px-3 py-2 flex items-center gap-2 shrink-0 flex-wrap gap-y-1.5">
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="bg-gray-800 text-gray-300 text-xs px-2 py-1 rounded border border-gray-700 outline-none"
                  >
                    <option value="">No folder</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {importMsg && (
                    <span className={`text-xs ${importMsg.includes('failed') || importMsg.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>
                      {importMsg}
                    </span>
                  )}
                  <button
                    onClick={handleImport}
                    disabled={importing || selected.size === 0}
                    className="ml-auto px-4 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-md transition-colors"
                  >
                    {importing ? 'Importing…' : `Import ${selected.size > 0 ? selected.size : ''} file${selected.size !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
