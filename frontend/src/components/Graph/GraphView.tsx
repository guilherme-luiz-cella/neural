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

const CLUSTER_ZOOM_THRESHOLD = 0.45;
const NODE_RADIUS = 6;

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
  const [showClusterLabels, setShowClusterLabels] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [showNameLinks, setShowNameLinks] = useState(false);
  const [linkStrengthFilter, setLinkStrengthFilter] = useState(0.2);
  const showLinksRef = useRef(true);
  const showNameLinksRef = useRef(false);
  const linkFilterRef = useRef(0.2);

  useEffect(() => { showLinksRef.current = showLinks; }, [showLinks]);
  useEffect(() => { showNameLinksRef.current = showNameLinks; }, [showNameLinks]);
  useEffect(() => { linkFilterRef.current = linkStrengthFilter; }, [linkStrengthFilter]);

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

  const getClusterCentroids = () => {
    const map = new Map<string, { cx: number; cy: number; count: number; color: string; name: string; files: { id: string; name: string }[] }>();

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
        existing.files.push({ id: node.id, name: node.name });
      } else {
        map.set(key, { cx: node.x ?? 0, cy: node.y ?? 0, count: 1, color, name, files: [{ id: node.id, name: node.name }] });
      }
    }

    return [...map.values()].map((c) => ({
      ...c,
      cx: c.cx / c.count,
      cy: c.cy / c.count,
      files: c.files.slice(0, 5), // Top 5 files
    }));
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
      const clusters = getClusterCentroids();
      const totalFiles = nodesRef.current.length || 1;

      const rawPcts = clusters.map((c) => (c.count / totalFiles) * 100);
      const floored = rawPcts.map(Math.floor);
      const remainder = 100 - floored.reduce((a, b) => a + b, 0);
      const diffs = rawPcts.map((r, i) => r - floored[i]);
      const sorted = [...diffs.keys()].sort((a, b) => diffs[b] - diffs[a]);
      const pcts = floored.slice();
      for (let i = 0; i < remainder; i++) pcts[sorted[i]]++;

      for (let ci = 0; ci < clusters.length; ci++) {
        const cluster = clusters[ci];
        const pct = pcts[ci];
        const r = Math.max(50, Math.sqrt(cluster.count) * 26);

        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r, 0, Math.PI * 2);
        ctx.fillStyle = cluster.color + '18';
        ctx.fill();

        const grad = ctx.createRadialGradient(cluster.cx, cluster.cy, r * 0.4, cluster.cx, cluster.cy, r);
        grad.addColorStop(0, cluster.color + '44');
        grad.addColorStop(1, cluster.color + '00');
        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = cluster.color + 'cc';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cluster.cx, cluster.cy, r + 4 / zoom, -Math.PI / 2, -Math.PI / 2 + (pct / 100) * Math.PI * 2);
        ctx.strokeStyle = cluster.color;
        ctx.lineWidth = 3 / zoom;
        ctx.stroke();

        // Cluster name
        const fontSize = Math.max(14, 20 / zoom);
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(cluster.name, cluster.cx, cluster.cy - 16 / zoom);

        // Percentage and count
        const pctFont = Math.max(13, 18 / zoom);
        ctx.font = `bold ${pctFont}px system-ui, sans-serif`;
        ctx.fillStyle = cluster.color;
        ctx.fillText(`${pct}%`, cluster.cx, cluster.cy + 2 / zoom);

        const subFont = Math.max(10, 12 / zoom);
        ctx.font = `${subFont}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(156,163,175,0.75)';
        ctx.fillText(`${cluster.count} file${cluster.count !== 1 ? 's' : ''}`, cluster.cx, cluster.cy + 18 / zoom);

        // Show top files in cluster (Wikipedia-style) when labels are enabled
        if (showClusterLabels && zoom < 0.3) {
          const topFiles = cluster.files.slice(0, 3);
          const fileListY = cluster.cy + r + 24 / zoom;
          const fileFont = Math.max(8, 10 / zoom);
          ctx.font = `${fileFont}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(209,213,219,0.65)';
          ctx.textAlign = 'center';

          // Draw label "Contains:"
          ctx.fillText('Contains:', cluster.cx, fileListY);

          // Draw top files
          for (let fi = 0; fi < topFiles.length; fi++) {
            const file = topFiles[fi];
            const fileY = fileListY + (fi + 1) * (10 / zoom);
            let displayName = file.name;
            if (displayName.length > 20) displayName = displayName.slice(0, 17) + '…';
            ctx.fillText(displayName, cluster.cx, fileY);
          }
        }
      }
    }

    if (showLinksRef.current) {
      const hoveredId = hoveredRef.current;
      const minStrength = linkFilterRef.current;
      const baseAlpha = isClustered ? 0.08 : 0.14;
      const dimAlpha = 0.04;
      const hotAlpha = 0.95;

      for (const link of linksRef.current) {
        const s = link.source as GraphNode;
        const tgt = link.target as GraphNode;
        if (s.x == null || s.y == null || tgt.x == null || tgt.y == null) continue;
        if (link.type === 'name' && !showNameLinksRef.current) continue;

        const strength = link.value ?? 0.1;
        if (strength < minStrength) continue;

        const incident = hoveredId != null && (s.id === hoveredId || tgt.id === hoveredId);
        let alpha: number;
        if (hoveredId == null) {
          alpha = Math.min(baseAlpha + strength * 0.25, 0.4);
        } else if (incident) {
          alpha = hotAlpha;
        } else {
          alpha = dimAlpha;
        }

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = link.type === 'name'
          ? `rgba(251,191,36,${alpha})`
          : `rgba(99,102,241,${alpha})`;
        ctx.lineWidth = incident
          ? Math.max(1.2, strength * 2.6)
          : Math.max(0.35, strength * 1.1);
        ctx.stroke();
      }
    }

    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue;
      const isHovered = hoveredRef.current === node.id;
      const r = isHovered ? NODE_RADIUS * 1.8 : NODE_RADIUS;

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

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      if (zoom > 0.25) {
        const fontSize = Math.max(9, Math.min(13, 11 / zoom));
        ctx.font = `${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = isHovered ? '#ffffff' : 'rgba(209,213,219,0.85)';
        const label = node.name.length > 28 ? node.name.slice(0, 25) + '…' : node.name;
        ctx.fillText(label, node.x, node.y - r - 2);

        if (node.file_type && zoom > 0.35) {
          const typeFont = Math.max(7, Math.min(10, 8 / zoom));
          ctx.font = `${typeFont}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(156,163,175,0.6)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const typeLabel = node.file_type.includes('spreadsheet') ? 'XLS' :
                           node.file_type.includes('document') ? 'DOC' :
                           node.file_type.includes('presentation') ? 'PPT' : 'FILE';
          ctx.fillText(typeLabel, node.x, node.y + r + 2);
        }
      }
    }

    ctx.restore();
  }, []);

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

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const orbitR = Math.max(360, Math.min(canvas.width, canvas.height) * 0.48);
    const groupCenters = new Map<string, { x: number; y: number }>();
    const totalGroups = graphData.projects.length || 1;
    graphData.projects.forEach((p, i) => {
      const angle = (i / totalGroups) * Math.PI * 2 - Math.PI / 2;
      groupCenters.set(p.id, {
        x: cx + Math.cos(angle) * orbitR,
        y: cy + Math.sin(angle) * orbitR,
      });
    });
    groupCenters.set('unassigned', { x: cx, y: cy });

    const isCrossCluster = (l: GraphLink) => {
      const s = l.source as GraphNode;
      const t = l.target as GraphNode;
      return s.group !== t.group;
    };

    const sim = d3Force
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3Force
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((l) => isCrossCluster(l as GraphLink) ? 420 + (1 - (l as GraphLink).value) * 120 : 60 + (1 - (l as GraphLink).value) * 40)
          .strength((l) => isCrossCluster(l as GraphLink) ? (l as GraphLink).value * 0.04 : (l as GraphLink).value * 0.6)
      )
      .force('charge', d3Force.forceManyBody().strength(-140).distanceMax(260))
      .force('collision', d3Force.forceCollide(NODE_RADIUS + 10).strength(0.9).iterations(4))
      .force('x', d3Force.forceX<GraphNode>((d) => groupCenters.get(d.group)?.x ?? cx).strength(0.22))
      .force('y', d3Force.forceY<GraphNode>((d) => groupCenters.get(d.group)?.y ?? cy).strength(0.22))
      .alphaDecay(0.022)
      .velocityDecay(0.42)
      .on('tick', draw);

    simRef.current = sim;

    const selection = d3Selection.select(canvas);
    const zoom = d3Zoom
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        draw();
      });
    selection.call(zoom);

    const getNode = (event: MouseEvent): GraphNode | null => {
      const rect = canvas.getBoundingClientRect();
      const mx = (event.clientX - rect.left - transformRef.current.x) / transformRef.current.k;
      const my = (event.clientY - rect.top - transformRef.current.y) / transformRef.current.k;
      for (const n of nodesRef.current) {
        const dx = (n.x ?? 0) - mx;
        const dy = (n.y ?? 0) - my;
        if (Math.sqrt(dx * dx + dy * dy) < 14) return n;
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
        <div className="flex items-center gap-3 ml-auto flex-wrap">
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-400">
            <input
              type="checkbox"
              checked={showClusterLabels}
              onChange={(e) => setShowClusterLabels(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer"
            />
            Show cluster composition
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-400">
            <input
              type="checkbox"
              checked={showLinks}
              onChange={(e) => { setShowLinks(e.target.checked); requestAnimationFrame(draw); }}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer"
            />
            Show links
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer hover:text-gray-400">
            <input
              type="checkbox"
              checked={showNameLinks}
              onChange={(e) => { setShowNameLinks(e.target.checked); requestAnimationFrame(draw); }}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 cursor-pointer"
            />
            Name match
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            Min link strength
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={linkStrengthFilter}
              onChange={(e) => { setLinkStrengthFilter(parseFloat(e.target.value)); requestAnimationFrame(draw); }}
              className="w-24 accent-indigo-500"
            />
            <span className="w-8 text-right tabular-nums">{linkStrengthFilter.toFixed(2)}</span>
          </label>
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
