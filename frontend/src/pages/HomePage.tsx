import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { animate, stagger } from 'animejs';

const workflow = [
  ['01', 'Connect', 'Authorize Drive and GitHub with scoped access.'],
  ['02', 'Crawl', 'Extract text and metadata from files for matching.'],
  ['03', 'Explore', 'Open files, edit code, and inspect graph clusters.'],
];

export const HomePage = () => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const animation = animate(root.querySelectorAll('[data-home-animate]'), {
      opacity: [0, 1],
      translateY: [18, 0],
      duration: 700,
      delay: stagger(80),
      ease: 'outCubic',
    });
    return () => {
      animation.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className="min-h-screen bg-gray-950 text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="text-sm font-semibold tracking-tight">Neural Network</div>
        <nav className="flex items-center gap-4 text-xs text-gray-500">
          <Link to="/login" className="hover:text-gray-300 transition-colors">Login</Link>
          <Link to="/register" className="bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500 transition-colors">
            Create account
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-16">
        <section className="grid min-h-[calc(100vh-96px)] grid-cols-1 gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <div data-home-animate className="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-blue-400">
              File intelligence workspace
            </div>
            <h1 data-home-animate className="max-w-3xl text-5xl font-semibold leading-tight tracking-tight md:text-6xl">
              Map Drive and GitHub files into a working neural graph.
            </h1>
            <p data-home-animate className="mt-6 max-w-xl text-sm leading-6 text-gray-400">
              Neural Network gives your files a VS Code-style workspace, searchable content extraction, and a graph view for discovering related documents, media, and code.
            </p>
            <div data-home-animate className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
                Start now
              </Link>
              <Link to="/login" className="border border-gray-700 px-5 py-2.5 text-sm font-medium text-gray-300 hover:border-gray-500 hover:text-white transition-colors">
                Sign in
              </Link>
            </div>
          </div>

          <div data-home-animate className="border border-gray-800 bg-[#1e1e1e] shadow-2xl shadow-black/40">
            <div className="flex h-9 items-center gap-2 border-b border-gray-800 px-3 text-[10px] text-gray-500">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="ml-3">Neural Workbench</span>
            </div>
            <div className="grid min-h-[430px] grid-cols-[44px_190px_1fr]">
              <div className="border-r border-gray-800 bg-[#181818] p-2">
                {['F', 'G', 'S', '⚙'].map((item) => (
                  <div key={item} className="mb-2 flex h-8 items-center justify-center text-xs text-gray-500">{item}</div>
                ))}
              </div>
              <div className="border-r border-gray-800 bg-[#252526] p-3">
                <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-400">Explorer</div>
                {['drive-notes.md', 'roadmap.pdf', 'src/api.ts', 'meeting.mp3', 'demo.mp4'].map((item, index) => (
                  <div key={item} className={`mb-1 h-7 truncate px-2 py-1.5 text-[11px] ${index === 2 ? 'bg-[#37373d] text-white' : 'text-gray-400'}`}>
                    {item}
                  </div>
                ))}
              </div>
              <div className="bg-gray-950 p-4">
                <div className="mb-4 flex gap-2 border-b border-gray-800 pb-2 text-[11px] text-gray-400">
                  <span className="border-t border-blue-500 bg-gray-950 px-3 py-1 text-white">src/api.ts</span>
                  <span className="bg-gray-900 px-3 py-1">Graph</span>
                </div>
                <div className="relative h-[330px] overflow-hidden">
                  <div className="absolute left-[14%] top-[22%] h-24 w-24 rounded-full border border-blue-500/70 bg-blue-500/10" />
                  <div className="absolute left-[56%] top-[18%] h-28 w-28 rounded-full border border-purple-500/70 bg-purple-500/10" />
                  <div className="absolute left-[38%] top-[58%] h-24 w-24 rounded-full border border-green-500/70 bg-green-500/10" />
                  <div className="absolute left-[25%] top-[33%] h-px w-[42%] rotate-[-10deg] bg-blue-400/50" />
                  <div className="absolute left-[48%] top-[61%] h-px w-[32%] rotate-[22deg] bg-indigo-400/50" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {workflow.map(([step, title, copy]) => (
            <div data-home-animate key={step} className="border border-gray-800 bg-gray-900/70 p-5">
              <div className="mb-5 text-xs text-blue-400">{step}</div>
              <h2 className="text-sm font-semibold text-white">{title}</h2>
              <p className="mt-2 text-xs leading-5 text-gray-500">{copy}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
};
