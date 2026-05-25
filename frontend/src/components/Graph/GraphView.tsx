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
  group: string;
}

interface GraphLink extends d3Force.SimulationLinkDatum<GraphNode> {
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

const CLUSTER_ZOOM_THRESHOLD = 0.45; // below this → cluster view
const NODE_RADIUS = 5;

export const GraphView = ({ onNodeClick, crawlTrigger }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<d3Force.Simulation<GraphNode, GraphLink> | null>(null);
  const transformRef = useRef(d3Zoom.zoomIdentity);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const projectsRef = useRef<GraphData['projects']>([]);
  const hoveredRef = useRef<string | null>(null);

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

  // Compute cluster centroids for zoomed-out view
  const getClusterCentroids = () => {
    const map = new Map<string, { cx: number; cy: number; count: number; color: string; name: string }>();

    for (const node of nodesRef.current) {
      const key = node.group;
      const project = projectsRef.current.find((p) => p.id === key);
      const name = project?.name ?? 'Unassigned';
      const color = project?.color_tag ?? '#4B5563';
      const existing = map.get(key);
      if (existing) {
        existing.cx += node.x ?? 0;
        existing.cy += node.y ?? 0;
        existing.count++;
      } else {
        map.set(key, { cx: node.x ?? 0, cy: node.y ?? 0, count: 1, color, name });
      }
    }

    return [...map.values()].map((c) => ({ ...c, cx: c.cx / c.count, cy: c.cy / c.count }));
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    const t = transformRef.current;
    const zoom = t.k;
    const isClustered = zoom < CLUSTER_ZOOM_THRESHOLD;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(zoom, zoom);

    if (isClustered) {
      // ── CLUSTER VIEW ──────────────────────────────────────
      const clusters = getClusterCentroids();

      // Draw inter-cluster links (faint)
      const clusterMap = new Map(clusters.map((c) => [c.name, c]));
      // Just draw cluster bubbles, no inter-links at this zoom
      for (const cluster of clusters) {
        const r = Math.max(40, Math.sqrt(cluster.count) * 22);

        // Glow ring
        const grad = ctx.createRadialGradient(cluster.cx, cluster.cy, r * 0.5, cluster.cx, cluster.cy, r);
        grad.addColorStop(0, cluster.color + '55');
        grad.addColorStop(1, cluster.color + '00');
        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = cluster.color + 'aa';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Category label
        const fontSize = Math.max(14, 20 / zoom);
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(cluster.name, cluster.cx, cluster.cy - 6 / zoom);

        // Count
        const subFont = Math.max(10, 13 / zoom);
        ctx.font = `${subFont}px system-ui, sans-serif`;
        ctx.fillStyle = cluster.color + 'cc';
        ctx.fillText(`${cluster.count} file${cluster.count !== 1 ? 's' : ''}`, cluster.cx, cluster.cy + 16 / zoom);
      }
      void clusterMap; // suppress lint
    } else {
      // ── NODE VIEW ─────────────────────────────────────────
      // Draw links (only rendered in node view)
      for (const link of linksRef.current) {
        const s = link.source as GraphNode;
        const tgt = link.target as GraphNode;
        if (s.x == null || s.y == null || tgt.x == null || tgt.y == null) continue;

        const strength = link.value ?? 0.1;
        const alpha = Math.min(0.8, strength * 1.5);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = link.type === 'name'
          ? `rgba(251,191,36,${alpha})`   // amber for name links
          : `rgba(99,102,241,${alpha})`;   // indigo for semantic links
        ctx.lineWidth = Math.max(0.5, strength * 2.5);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue;
        const isHovered = hoveredRef.current === node.id;
        const r = isHovered ? NODE_RADIUS * 1.6 : NODE_RADIUS;

        // Glow
        if (isHovered) {
          const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
          grad.addColorStop(0, node.color + '66');
          grad.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Label — only render when zoom is reasonable
        if (zoom > 0.25) {
          const fontSize = Math.max(9, Math.min(13, 11 / zoom));
          ctx.font = `${fontSize}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(209,213,219,0.9)';
          const label = node.name.length > 26 ? node.name.slice(0, 24) + '…' : node.name;
          ctx.fillText(label, node.x, node.y + r + 2);
        }
      }
    }

    ctx.restore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    projectsRef.current = graphData.projects;

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

    // Group nodes by project for cluster force
    const groupCenters = new Map<string, { x: number; y: number }>();
    graphData.projects.forEach((p, i) => {
      const angle = (i / graphData.projects.length) * Math.PI * 2;
      groupCenters.set(p.id, {
        x: canvas.width / 2 + Math.cos(angle) * 200,
        y: canvas.height / 2 + Math.sin(angle) * 200,
      });
    });

    const sim = d3Force
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3Force
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((l) => 60 + (1 - (l as GraphLink).value) * 80)
          .strength((l) => (l as GraphLink).value * 0.8)
      )
      .force('charge', d3Force.forceManyBody().strength(-180).distanceMax(300))
      .force('center', d3Force.forceCenter(canvas.width / 2, canvas.height / 2).strength(0.05))
      .force('collision', d3Force.forceCollide(NODE_RADIUS + 4))
      // Cluster force: pull nodes toward their project center
      .force('cluster', () => {
        const alpha = sim.alpha();
        for (const node of nodesRef.current) {
          const center = groupCenters.get(node.group ?? '');
          if (!center) continue;
          node.vx = (node.vx ?? 0) + (center.x - (node.x ?? 0)) * 0.015 * alpha;
          node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * 0.015 * alpha;
        }
      })
      .alphaDecay(0.015)
      .on('tick', draw);

    simRef.current = sim;

    // Zoom + pan
    const selection = d3Selection.select(canvas);
    const zoom = d3Zoom
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });
    selection.call(zoom);

    // Interaction
    const getNode = (event: MouseEvent): GraphNode | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = (event.clientX - rect.left - transformRef.current.x) / transformRef.current.k;
      const my = (event.clientY - rect.top - transformRef.current.y) / transformRef.current.k;
      for (const n of nodesRef.current) {
        const dx = (n.x ?? 0) - mx;
        const dy = (n.y ?? 0) - my;
        if (Math.sqrt(dx * dx + dy * dy) < 12) return n;
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
    };
  }, [graphData, draw, onNodeClick]);

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

      {/* Legend */}
      <div className="flex gap-4 mb-3 flex-wrap shrink-0">
        {graphData.projects.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color_tag ?? '#6B7280' }} />
            {p.name}
          </div>
        ))}
        {graphData.nodes.some((n) => n.group === 'unassigned') && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-600" />
            Unassigned
          </div>
        )}
        <div className="flex items-center gap-3 ml-auto">
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-4 h-0.5 bg-yellow-400/70 rounded" />
            name match
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600">
            <div className="w-4 h-0.5 bg-indigo-400/70 rounded" />
            content match
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 bg-gray-950 rounded-xl border border-gray-800 overflow-hidden relative"
        style={{ minHeight: 400 }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm z-10">
            Loading graph…
          </div>
        )}
        {!loading && graphData.nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 text-sm gap-2">
            <p>No files yet.</p>
            <p className="text-xs">Sync Drive files to see the graph.</p>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          style={{ opacity: loading || graphData.nodes.length === 0 ? 0 : 1 }}
        />
      </div>
      <p className="text-xs text-gray-700 mt-1.5 shrink-0">
        Scroll out → cluster view · scroll in → nodes · click node to open
      </p>
    </div>
  );
};
