import { useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface Props {
  email: string;
  mismatch?: boolean;
  onDisconnected: () => void;
}

export const DriveAccountChip = ({ email, mismatch, onDisconnected }: Props) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initial = email.trim().charAt(0).toUpperCase() || '?';

  const startConnect = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await api.get('/drive/auth-url');
      window.location.href = res.data.data.url;
    } catch (e) {
      const ae = e as AxiosError<{ message: string }>;
      setErr(ae.response?.data?.message ?? 'Failed to start Drive auth');
      setBusy(false);
    }
  };

  const handleSwitch = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/drive/disconnect');
      await startConnect();
    } catch (e) {
      const ae = e as AxiosError<{ message: string }>;
      setErr(ae.response?.data?.message ?? 'Failed to switch account');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/drive/disconnect');
      onDisconnected();
      setOpen(false);
    } catch (e) {
      const ae = e as AxiosError<{ message: string }>;
      setErr(ae.response?.data?.message ?? 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-800 transition-colors"
        title={mismatch ? 'Account mismatch — click to switch' : email}
      >
        <span
          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
            mismatch ? 'bg-amber-500' : 'bg-blue-500'
          }`}
        >
          {initial}
        </span>
        <span className="text-xs text-gray-400 max-w-[140px] truncate hidden sm:inline">{email}</span>
        <svg className="w-3 h-3 text-gray-500" viewBox="0 0 12 12" fill="currentColor">
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-30 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">Google Drive</p>
            <p className="text-xs text-gray-200 truncate" title={email}>{email}</p>
            {mismatch && (
              <p className="text-[10px] text-amber-400 mt-1">
                Logged-in Google account differs. Switch to sync correct Drive.
              </p>
            )}
          </div>
          <button
            onClick={handleSwitch}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 8a6 6 0 0 1 10.24-4.24M14 8a6 6 0 0 1-10.24 4.24" />
              <path d="M12 2v3h-3M4 14v-3h3" />
            </svg>
            Switch account
          </button>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M10 4V2H2v12h8v-2M14 8H6m8 0l-2.5-2.5M14 8l-2.5 2.5" />
            </svg>
            Disconnect Drive
          </button>
          {err && <p className="px-3 py-2 text-[10px] text-red-400 border-t border-gray-800">{err}</p>}
        </div>
      )}
    </div>
  );
};
