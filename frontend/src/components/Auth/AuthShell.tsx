import { ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { animate, stagger } from 'animejs';

interface AuthShellProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

const features = [
  'Drive and GitHub files in one workspace',
  'VS Code-style editor and explorer',
  'Neural graph for content relationships',
];

export const AuthShell = ({ eyebrow, title, subtitle, children, footer }: AuthShellProps) => {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const animation = animate(root.querySelectorAll('[data-auth-animate]'), {
      opacity: [0, 1],
      translateY: [14, 0],
      duration: 650,
      delay: stagger(70),
      ease: 'outCubic',
    });

    return () => {
      animation.revert();
    };
  }, []);

  return (
    <div ref={rootRef} className="min-h-screen bg-gray-950 text-white overflow-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="text-sm font-semibold tracking-tight text-white">
          Neural Network
        </Link>
        <nav className="flex items-center gap-4 text-xs text-gray-500">
          <Link to="/privacy" className="hover:text-gray-300 transition-colors">Privacy</Link>
          <Link to="/terms" className="hover:text-gray-300 transition-colors">Terms</Link>
        </nav>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-76px)] w-full max-w-6xl grid-cols-1 gap-10 px-6 pb-10 lg:grid-cols-[1fr_430px] lg:items-center">
        <section className="hidden lg:block">
          <div data-auth-animate className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-blue-400">
            {eyebrow}
          </div>
          <h1 data-auth-animate className="max-w-2xl text-5xl font-semibold leading-tight tracking-tight text-white">
            Your files, code, and relationships in one neural workspace.
          </h1>
          <p data-auth-animate className="mt-5 max-w-xl text-sm leading-6 text-gray-400">
            Connect Drive and GitHub, edit content with a familiar workbench, and crawl files into a graph that makes related work easier to find.
          </p>

          <div data-auth-animate className="mt-8 grid max-w-xl grid-cols-3 gap-3">
            {features.map((feature) => (
              <div key={feature} className="border border-gray-800 bg-gray-900/60 p-4">
                <div className="mb-3 h-1 w-8 rounded-full bg-blue-500" />
                <p className="text-xs leading-5 text-gray-400">{feature}</p>
              </div>
            ))}
          </div>

          <div data-auth-animate className="mt-8 h-56 border border-gray-800 bg-[#1e1e1e] p-3 shadow-2xl shadow-black/30">
            <div className="mb-3 flex items-center gap-2 border-b border-gray-800 pb-2 text-[10px] text-gray-500">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <span className="h-2 w-2 rounded-full bg-yellow-500" />
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="ml-3">workspace.graph</span>
            </div>
            <div className="grid h-[176px] grid-cols-[130px_1fr] gap-3">
              <div className="space-y-2 border-r border-gray-800 pr-3">
                {['Drive', 'GitHub', 'Projects', 'Graph'].map((item, index) => (
                  <div key={item} className={`h-6 rounded-sm ${index === 1 ? 'bg-gray-700' : 'bg-gray-800/70'}`} />
                ))}
              </div>
              <div className="relative overflow-hidden bg-gray-950">
                <div className="absolute left-[18%] top-[28%] h-3 w-3 rounded-full bg-blue-500" />
                <div className="absolute left-[58%] top-[22%] h-4 w-4 rounded-full bg-purple-500" />
                <div className="absolute left-[46%] top-[62%] h-3 w-3 rounded-full bg-green-500" />
                <div className="absolute left-[74%] top-[70%] h-2.5 w-2.5 rounded-full bg-yellow-500" />
                <div className="absolute left-[21%] top-[31%] h-px w-[44%] rotate-[-8deg] bg-blue-400/50" />
                <div className="absolute left-[49%] top-[63%] h-px w-[30%] rotate-[12deg] bg-indigo-400/50" />
              </div>
            </div>
          </div>
        </section>

        <section data-auth-animate className="mx-auto w-full max-w-[430px] border border-gray-800 bg-gray-900 p-7 shadow-2xl shadow-black/30">
          <div className="mb-7">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">{eyebrow}</div>
            <h2 className="text-2xl font-semibold text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">{subtitle}</p>
          </div>
          {children}
          <div className="mt-6 text-center text-sm text-gray-500">{footer}</div>
        </section>
      </main>
    </div>
  );
};
