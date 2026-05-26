import { useState, FormEvent } from 'react';
import { Project, DBFile } from '../../types';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

const PRESET_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#F97316'];

interface Props {
  projects: Project[];
  files: DBFile[];
  onChanged: () => void;
}

export const ProjectPanel = ({ projects, files, onChanged }: Props) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [assigningFile, setAssigningFile] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/projects', { name: name.trim(), description: description.trim() || undefined, color_tag: color });
      setName('');
      setDescription('');
      setColor(PRESET_COLORS[0]);
      setCreating(false);
      onChanged();
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/projects/${id}`);
      if (selectedProject === id) setSelectedProject(null);
      onChanged();
    } catch {
      // ignore
    }
  };

  const handleAssignFile = async (fileId: string, projectId: string | null) => {
    setAssigningFile(fileId);
    try {
      if (projectId) {
        await api.put(`/projects/${projectId}/files/${fileId}`);
      } else {
        const file = files.find((f) => f.id === fileId);
        if (file?.project_id) {
          await api.delete(`/projects/${file.project_id}/files/${fileId}`);
        }
      }
      onChanged();
    } catch {
      // ignore
    } finally {
      setAssigningFile(null);
    }
  };

  const projectFiles = selectedProject ? files.filter((f) => f.project_id === selectedProject) : [];
  const unassigned = files.filter((f) => !f.project_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
          Projects ({projects.length})
        </h3>
        <button
          onClick={() => { setCreating(!creating); setError(''); }}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          {creating ? 'Cancel' : '+ New Project'}
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="p-4 bg-gray-900 border border-gray-700 rounded-xl space-y-3">
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Project name"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Short description"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? 'Creating…' : 'Create Project'}
          </button>
        </form>
      )}

      {projects.length === 0 ? (
        <p className="text-center text-gray-600 text-sm py-4">No projects yet — create one above.</p>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedProject === p.id
                  ? 'border-gray-600 bg-gray-800/80'
                  : 'border-gray-800 bg-gray-900/40 hover:bg-gray-900/80'
              }`}
              onClick={() => setSelectedProject(selectedProject === p.id ? null : p.id)}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: p.color_tag ?? '#6B7280' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{p.name}</p>
                {p.description && <p className="text-xs text-gray-500 truncate">{p.description}</p>}
              </div>
              <span className="text-xs text-gray-600 shrink-0">
                {files.filter((f) => f.project_id === p.id).length} files
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}
                className="text-gray-600 hover:text-red-400 transition-colors text-xs px-1"
                title="Delete project"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedProject && (
        <div className="border-t border-gray-800 pt-4">
          <p className="text-xs text-gray-500 mb-3">
            Files in <strong className="text-gray-300">{projects.find((p) => p.id === selectedProject)?.name}</strong>
          </p>
          {projectFiles.length === 0 ? (
            <p className="text-xs text-gray-600 mb-3">No files assigned.</p>
          ) : (
            <div className="space-y-1 mb-3">
              {projectFiles.map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="flex-1 truncate">{f.file_name}</span>
                  <button
                    onClick={() => handleAssignFile(f.id, null)}
                    disabled={assigningFile === f.id}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                    title="Remove from project"
                  >
                    {assigningFile === f.id ? '…' : '−'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {unassigned.length > 0 && (
            <>
              <p className="text-xs text-gray-600 mb-2">Add unassigned files:</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {unassigned.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="flex-1 truncate">{f.file_name}</span>
                    <button
                      onClick={() => handleAssignFile(f.id, selectedProject)}
                      disabled={assigningFile === f.id}
                      className="text-blue-500 hover:text-blue-400 transition-colors"
                      title="Add to project"
                    >
                      {assigningFile === f.id ? '…' : '+'}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
