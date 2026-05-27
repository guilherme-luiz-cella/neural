import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../utils/api';

export interface SearchResult {
  file_id: string;
  file_name: string;
  similarity: number;
  subjects: string[];
  file_type: string | null;
}

interface Props {
  onSelect: (fileId: string) => void;
}

const typeLabel = (mime: string | null): string => {
  if (!mime) return 'file';
  if (mime.includes('document')) return 'DOC';
  if (mime.includes('spreadsheet')) return 'XLS';
  if (mime.includes('presentation')) return 'PPT';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('text/')) return 'TEXT';
  if (mime.startsWith('image/')) return 'IMG';
  return mime.split('/')[1]?.slice(0, 6) ?? 'file';
};

export const SearchBar = ({ onSelect }: Props) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [err, setErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  // Multiple shortcuts so we don't fight browser quick-find (Cmd+K can be
  // hijacked in some browsers/extensions). "/" works like GitHub / Slack
  // when not focused on an input. Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const isCmdP = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p';
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable;
      const isSlash = e.key === '/' && !inField && !e.metaKey && !e.ctrlKey;

      if (isCmdK || isCmdP || isSlash) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setHighlight(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ('');
      setResults([]);
      setErr('');
    }
  }, [open]);

  // Debounced search on q change.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setErr('');
      try {
        const res = await api.get<{ data: { results: SearchResult[] } }>(
          `/files/search?q=${encodeURIComponent(q)}&limit=15`,
        );
        setResults(res.data?.data?.results ?? []);
        setHighlight(0);
      } catch {
        setErr('Search failed');
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
  }, [q, open]);

  const choose = (r: SearchResult) => {
    onSelect(r.file_id);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && results[highlight]) {
      e.preventDefault();
      choose(results[highlight]);
    }
  };

  const trigger = (
    <button
      onClick={() => setOpen(true)}
      className="inline-flex items-center gap-2.5 w-full sm:w-80 text-sm text-gray-500 bg-gray-900 border border-gray-800 hover:border-indigo-500/50 hover:bg-gray-850 rounded-lg px-3 py-2 transition-colors text-left"
      aria-label="Search files (press / or Cmd+K)"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500"><circle cx="7" cy="7" r="5"/><path d="M14 14l-3-3"/></svg>
      <span className="flex-1 truncate">Search files…</span>
      <kbd className="text-[10px] px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400 font-mono">/</kbd>
      <kbd className="text-[10px] px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400 font-mono hidden md:inline">⌘K</kbd>
    </button>
  );

  const modal = useMemo(() => {
    if (!open) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      >
        <div
          className="w-full max-w-xl bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500"><circle cx="7" cy="7" r="5"/><path d="M14 14l-3-3"/></svg>
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search files semantically… (try: 'project deadlines', 'machine learning notes')"
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder-gray-600"
            />
            {loading && <span className="text-[10px] text-gray-500">searching…</span>}
            <button
              onClick={() => setOpen(false)}
              className="text-[10px] text-gray-500 hover:text-gray-300 border border-gray-700 px-1.5 py-0.5 rounded"
            >
              Esc
            </button>
          </div>

          <div className="max-h-[55vh] overflow-y-auto">
            {err && <div className="px-4 py-6 text-xs text-red-400">{err}</div>}
            {!err && !loading && q.trim() && results.length === 0 && (
              <div className="px-4 py-8 text-xs text-gray-600 text-center">
                No matches. Try fewer or different words.
              </div>
            )}
            {!err && !q.trim() && (
              <div className="px-4 py-8 text-xs text-gray-600 text-center">
                Type to search — finds by meaning, not just exact words.
              </div>
            )}
            {results.map((r, i) => {
              const active = i === highlight;
              return (
                <button
                  key={r.file_id}
                  onClick={() => choose(r)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full text-left px-3 py-2.5 flex items-start gap-3 transition-colors ${
                    active ? 'bg-indigo-500/15' : 'hover:bg-gray-800/60'
                  }`}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded mt-0.5 shrink-0">
                    {typeLabel(r.file_type)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-gray-100 truncate">{r.file_name}</span>
                    {r.subjects.length > 0 && (
                      <span className="block mt-0.5 text-[11px] text-gray-500 truncate">
                        {r.subjects.slice(0, 6).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-indigo-400 tabular-nums shrink-0 mt-0.5">
                    {(r.similarity * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-800 text-[10px] text-gray-600">
            <span>↑↓ navigate · ↵ open · Esc close</span>
            <span>powered by gte-small + pgvector</span>
          </div>
        </div>
      </div>
    );
  }, [open, q, results, highlight, loading, err]);

  return (
    <>
      {trigger}
      {modal}
    </>
  );
};
