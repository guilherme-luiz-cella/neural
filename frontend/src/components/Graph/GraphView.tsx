import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3Force from 'd3-force';
import * as d3Zoom from 'd3-zoom';
import * as d3Selection from 'd3-selection';
import { api } from '../../utils/api';
import { AxiosError } from 'axios';

interface GraphNode extends d3Force.SimulationNodeDatum {
  id: string;
  name: string;
  file_type: string | null;
  project_id: string | null;
  color: string;
}

interface GraphLink extends d3Force.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3Force.Simulation<GraphNode, GraphLink> | null>(null);
  const transformRef = useRef(d3Zoom.zoomIdentity);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const animFrameRef = useRef<number>(0);

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [crawling, setCrawling] = useState(false);
  const [crawlMsg, setCrawlMsg] = useState('');

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

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const t = transformRef.current;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    // Draw links
    for (const link of linksRef.current) {
      const s = link.source as GraphNode;
      const t2 = link.target as GraphNode;
      if (s.x == null || s.y == null || t2.x == null || t2.y == null) continue;

      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.strokeStyle = `rgba(99,102,241,${Math.min(0.6, (link.value ?? 0.1) * 2)})`;
      ctx.lineWidth = Math.max(0.5, (link.value ?? 0.1) * 2);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const isHovered = hoveredRef.current === node.id;
      const r = isHovered ? 8 : 5;

      // Glow
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = node.color + '33';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Label
      const fontSize = Math.max(9, 11 / t.k);
      ctx.font = `${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isHovered ? '#fff' : 'rgba(209,213,219,0.9)';
      const label = node.name.length > 24 ? node.name.slice(0, 22) + '…' : node.name;
      ctx.fillText(label, node.x, node.y + r + fontSize);
    }

    ctx.restore();
  }, []);

  const tick = useCallback(() => {
    draw();
    animFrameRef.current = requestAnimationFrame(tick);
  }, [draw]);

  // Build simulation when graph data changes
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const nodes: GraphNode[] = graphData.nodes.map((n) => ({ ...n }));
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: GraphLink[] = graphData.links
      .map((l) => ({
        ...l,
        source: nodeById.get(l.source as string) ?? l.source,
        target: nodeById.get(l.target as string) ?? l.target,
      }))
      .filter((l) => l.source && l.target);

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();

    const sim = d3Force
      .forceSimulation<GraphNode>(nodes)
      .force('link', d3Force.forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(80).strength(0.4))
      .force('charge', d3Force.forceManyBody().strength(-200))
      .force('center', d3Force.forceCenter(canvas.width / 2, canvas.height / 2))
      .force('collision', d3Force.forceCollide(14))
      .alphaDecay(0.02)
      .on('tick', draw);

    simRef.current = sim;

    // Zoom + pan
    const selection = d3Selection.select(canvas);
    const zoom = d3Zoom
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });
    selection.call(zoom);

    // Click + hover
    const getNode = (event: MouseEvent): GraphNode | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = (event.clientX - rect.left - transformRef.current.x) / transformRef.current.k;
      const my = (event.clientY - rect.top - transformRef.current.y) / transformRef.current.k;
      for (const n of nodesRef.current) {
        const dx = (n.x ?? 0) - mx;
        const dy = (n.y ?? 0) - my;
        if (Math.sqrt(dx * dx + dy * dy) < 10) return n;
      }
      return null;
    };

    canvas.onclick = (e) => {
      const n = getNode(e);
      if (n) onNodeClick(n.id, n.name);
    };
    canvas.onmousemove = (e) => {
      const n = getNode(e);
      hoveredRef.current = n?.id ?? null;
      canvas.style.cursor = n ? 'pointer' : 'default';
      draw();
    };

    return () => {
      sim.stop();
      canvas.onclick = null;
      canvas.onmousemove = null;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [graphData, draw, onNodeClick]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      if (simRef.current) {
        simRef.current.force('center', d3Force.forceCenter(canvas.width / 2, canvas.height / 2));
        simRef.current.alpha(0.3).restart();
      }
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const handleCrawl = async () => {
    setCrawling(true);
    setCrawlMsg('');
    try {
      const res = await api.post('/crawler/run');
      setCrawlMsg(res.data.message);
      fetchGraph();
    } catch (err) {
      const axiosErr = err as AxiosError<{ message: string }>;
      setCrawlMsg(axiosErr.response?.data?.message ?? 'Crawl failed');
    } finally {
      setCrawling(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-4 flex-wrap">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Neural Graph · {graphData.nodes.length} nodes · {graphData.links.length} links
          </h3>
          {crawlMsg && <span className="text-xs text-gray-500">{crawlMsg}</span>}
        </div>
        <button
          onClick={handleCrawl}
          disabled={crawling}
          className="px-3 py-1.5 text-xs bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white rounded-lg transition-colors"
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
        className="flex-1 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden relative"
        style={{ minHeight: 400 }}
      >
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm">
            Loading graph…
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
            <p>No files yet.</p>
            <p className="text-xs">Sync Drive, then click <strong className="text-gray-400">Crawl &amp; Connect</strong>.</p>
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="w-full h-full"
          style={{ display: graphData.nodes.length > 0 && !loading ? 'block' : 'none' }}
        />
      </div>
      <p className="text-xs text-gray-700 mt-1.5 shrink-0">Scroll to zoom · drag to pan · click node to open</p>
    </div>
  );
};
