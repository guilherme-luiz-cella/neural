import { useState } from 'react';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface Props {
  onConnected?: () => void;
}

export const ConnectDrive = ({ onConnected: _onConnected }: Props) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/drive/auth-url');
      window.location.href = res.data.data.url;
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setError(axiosErr.response?.data?.message ?? 'Failed to start Google Drive auth');
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-12 border border-dashed border-gray-700 rounded-xl text-center">
      <div className="w-16 h-16 mb-4 bg-gray-800 rounded-full flex items-center justify-center">
        <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
        </svg>
      </div>

      <h3 className="text-lg font-semibold text-white mb-1">Connect Google Drive</h3>
      <p className="text-gray-400 text-sm mb-6 max-w-xs">
        Link your Google Drive to visualize files as an interconnected neural network.
      </p>

      {error && (
        <p className="text-red-400 text-sm mb-4">{error}</p>
      )}

      <button
        onClick={handleConnect}
        disabled={loading}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? 'Redirecting…' : 'Connect Google Drive'}
      </button>
    </div>
  );
};
