import { useAuth } from '../../hooks/useAuth';

export const Dashboard = () => {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">Neural Network</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-400 text-sm">{user?.email}</span>
          <button
            onClick={logout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="p-8">
        <h2 className="text-2xl font-semibold mb-2">Welcome, {user?.username}</h2>
        <p className="text-gray-400">Your neural network visualization will appear here.</p>
        <div className="mt-8 grid grid-cols-1 gap-4 text-sm text-gray-500">
          <div className="p-4 border border-gray-800 rounded-lg">
            Phase 2: Google Drive integration coming next
          </div>
        </div>
      </main>
    </div>
  );
};
