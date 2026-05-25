import { useEffect, useRef, useState, useCallback } from 'react';
import { ForceGraph2D } from 'react-force-graph';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface GraphNode {
  id: string;
  name: string;
  file_type: string | null;
  project_id: string | null;
  color: string;
  group: string;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
  type: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  projects: { id: string; name: string; color_tag: string | null }[];
}

interface Props {
  onNodeClick: (nodeId: string, nodeName: string) => void;
  crawlTrigger: number;
}

export const GraphView = ({ onNodeClick, crawlTrigger }: Props) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [crawlMsg, setCrawlMsg] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/graph');
      setGraphData(res.data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph, crawlTrigger]);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDims({ w: containerRef.current.offsetWidth, h: containerRef.current.offsetHeight });
      }
    };
    update();
    const observer = new ResizeObserver(update);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const handleCrawl = async () => {
    setCrawling(true);
    setCrawlMsg('');
    try {
      const res = await api.post('/crawler/run');
      setCrawlMsg(res.data.message);
      fetchGraph();
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setCrawlMsg(axiosErr.response?.data?.message ?? 'Crawl failed. Try again.');
    } finally {
      setCrawling(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Neural Graph ({graphData.nodes.length} nodes · {graphData.links.length} links)
          </h3>
          {crawlMsg && <span className="text-xs text-gray-500">{crawlMsg}</span>}
        </div>
        <button
          onClick={handleCrawl}
          disabled={crawling}
          className="px-3 py-1.5 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors shrink-0"
        >
          {crawling ? 'Crawling…' : 'Crawl & Connect'}
        </button>
      </div>

      {graphData.projects.length > 0 && (
        <div className="flex gap-3 mb-3 flex-wrap shrink-0">
          {graphData.projects.map((p) => (
            <div key={p.id} className="flex items-center gap-1.5 text-xs text-gray-500">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color_tag ?? '#6B7280' }} />
              {p.name}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-700" />
            Unassigned
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden"
        style={{ minHeight: 400 }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm" style={{ minHeight: 400 }}>
            Loading graph…
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-gray-600 text-sm gap-2" style={{ minHeight: 400 }}>
            <p>No files to visualize yet.</p>
            <p className="text-xs">Sync Drive files first, then click <strong className="text-gray-400">Crawl &amp; Connect</strong>.</p>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            width={dims.w}
            height={dims.h}
            graphData={{ nodes: graphData.nodes, links: graphData.links }}
            nodeLabel={(node) => (node as GraphNode).name}
            nodeColor={(node) => (node as GraphNode).color}
            nodeRelSize={5}
            nodeVal={(node) => hovered === (node as GraphNode).id ? 3 : 1}
            linkColor={() => 'rgba(99,102,241,0.3)'}
            linkWidth={(link) => ((link as GraphLink).value ?? 0.1) * 3}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={(link) => ((link as GraphLink).value ?? 0.1) * 2}
            linkDirectionalParticleColor={() => 'rgba(139,92,246,0.8)'}
            backgroundColor="#030712"
            onNodeClick={(node) => {
              const n = node as GraphNode;
              onNodeClick(n.id, n.name);
            }}
            onNodeHover={(node) => setHovered(node ? (node as GraphNode).id : null)}
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode;
              const fontSize = Math.max(10 / globalScale, 3);
              ctx.font = `${fontSize}px Sans-Serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = hovered === n.id ? '#ffffff' : 'rgba(156,163,175,0.85)';
              const label = n.name.length > 22 ? n.name.slice(0, 20) + '…' : n.name;
              ctx.fillText(label, n.x ?? 0, (n.y ?? 0) + 8 / globalScale);
            }}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        )}
      </div>
    </div>
  );
};
