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
  drive_path: string | null;
  github_repo: string | null;
  color: string;
  group: string;
}

type ClusterMode = 'folder' | 'project' | 'type' | 'connected';

const CLUSTER_MODES: { id: ClusterMode; label: string }[] = [
  { id: 'folder', label: 'Folder' },
  { id: 'project', label: 'Project' },
  { id: 'type', label: 'Type' },
  { id: 'connected', label: 'Connected' },
];

const PALETTE = ['#60A5FA', '#A78BFA', '#34D399', '#FBBF24', '#F87171', '#F472B6', '#22D3EE', '#FB923C', '#A3E635', '#E879F9'];
const hashColor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffffffff;
  return PALETTE[Math.abs(h) % PALETTE.length];
};

const typeLabel = (mime: string | null): string => {
  if (!mime) return 'unknown';
  if (mime.includes('google-apps.document')) return 'Google Doc';
  if (mime.includes('google-apps.spreadsheet')) return 'Google Sheet';
  if (mime.includes('google-apps.presentation')) return 'Google Slides';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.startsWith('image/')) return 'Image';
  if (mime.startsWith('video/')) return 'Video';
  if (mime.startsWith('audio/')) return 'Audio';
  if (mime.startsWith('text/') || mime === 'application/json') return 'Text/Code';
  if (mime.includes('officedocument')) return 'Office';
  return mime.split('/')[0] || 'unknown';
};

const computeConnectedComponents = (nodes: GraphNode[], links: GraphLink[]): Map<string, string> => {
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur) as string;
    parent.set(id, cur);
    return cur;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const l of links) {
    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    union(s, t);
  }
  const result = new Map<string, string>();
  for (const n of nodes) result.set(n.id, find(n.id));
  return result;
};

const facetForMode = (
  node: GraphNode,
  mode: ClusterMode,
  componentMap: Map<string, string>,
  projectNameById: Map<string, string>,
): { id: string; label: string } | null => {
  if (mode === 'project') {
    if (!node.project_id) return null;
    const name = projectNameById.get(node.project_id) ?? node.project_id;
    return { id: `p:${node.project_id}`, label: name };
  }
  if (mode === 'type') {
    const t = typeLabel(node.file_type);
    return { id: `t:${t}`, label: t };
  }
  if (mode === 'connected') {
    const comp = componentMap.get(node.id) ?? node.id;
    return { id: `c:${comp}`, label: 'Cluster' };
  }
  // folder
  if (node.project_id) {
    const name = projectNameById.get(node.project_id) ?? node.project_id;
    return { id: `p:${node.project_id}`, label: name };
  }
  if (node.drive_path) {
    const top = node.drive_path.split('/').filter(Boolean)[0];
    if (top) return { id: `drive:${top}`, label: top };
  }
  if (node.github_repo) {
    return { id: `gh:${node.github_repo}`, label: node.github_repo };
  }
  return null;
};

const assignGroup = (
  node: GraphNode,
  modes: Set<ClusterMode>,
  componentMap: Map<string, string>,
  projectNameById: Map<string, string>,
): { id: string; label: string; color: string } => {
  if (modes.size === 0) {
    return { id: 'unassigned', label: 'Unassigned', color: '#4B5563' };
  }
  const order: ClusterMode[] = ['folder', 'project', 'type', 'connected'];
  const facets = order
    .filter((m) => modes.has(m))
    .map((m) => facetForMode(node, m, componentMap, projectNameById))
    .filter((f): f is { id: string; label: string } => f !== null);

  if (facets.length === 0) {
    return { id: 'unassigned', label: 'Unassigned', color: '#4B5563' };
  }
  const id = facets.map((f) => f.id).join('|');
  const label = facets.map((f) => f.label).join(' · ');
  return { id, label, color: hashColor(id) };
};

type LineKind = 'semantic' | 'folder' | 'project' | 'type';

const LINE_KINDS: { id: LineKind; label: string; color: string }[] = [
  { id: 'semantic', label: 'Semantic',     color: '#6366F1' }, // indigo
  { id: 'folder',   label: 'Same folder',  color: '#34D399' }, // emerald
  { id: 'project',  label: 'Same project', color: '#F59E0B' }, // amber
  { id: 'type',     label: 'Same type',    color: '#EC4899' }, // pink
];

// Perpendicular offset (in canvas pixels) per kind. Lets multiple kinds of
// links between the same pair render as visually distinct arcs instead of
// stacking on top of each other (cheap edge-bundling-style deconfliction).
const LINE_KIND_OFFSET: Record<LineKind, number> = {
  semantic: 0,
  folder: 9,
  project: -9,
  type: 18,
};

const LINE_KIND_COLOR: Record<LineKind, string> = Object.fromEntries(
  LINE_KINDS.map((k) => [k.id, k.color])
) as Record<LineKind, string>;

interface GraphLink extends d3Force.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
  type: string;
  kind: LineKind;
}

const folderKey = (n: GraphNode): string | null => {
  if (n.drive_path) {
    const top = n.drive_path.split('/').filter(Boolean)[0];
    return top ? `drive:${top}` : null;
  }
  if (n.github_repo) return `gh:${n.github_repo}`;
  return null;
};

// Build structural links by grouping nodes on a key. Capped per node to avoid
// dense hairballs on large groups: each node connects to at most `capPerNode`
// random peers in its group.
const deriveGroupLinks = (
  nodes: GraphNode[],
  keyFn: (n: GraphNode) => string | null,
  kind: LineKind,
  capPerNode = 6,
  weight = 0.35,
): GraphLink[] => {
  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const k = keyFn(n);
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(n);
    else groups.set(k, [n]);
  }
  const out: GraphLink[] = [];
  const seen = new Set<string>();
  for (const peers of groups.values()) {
    if (peers.length < 2) continue;
    for (const a of peers) {
      const pool = peers.filter((p) => p.id !== a.id);
      const take = Math.min(capPerNode, pool.length);
      for (let i = 0; i < take; i++) {
        const b = pool[i];
        const pair = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seen.has(pair)) continue;
        seen.add(pair);
        out.push({ source: a.id, target: b.id, value: weight, type: kind, kind });
      }
    }
  }
  return out;
};

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
  const [linkStrengthFilter, setLinkStrengthFilter] = useState(0.05);
  const [clusterModes, setClusterModes] = useState<Set<ClusterMode>>(() => new Set(['folder']));
  const [clusterMenuOpen, setClusterMenuOpen] = useState(false);
  const [activeLineKinds, setActiveLineKinds] = useState<Set<LineKind>>(() => new Set(['semantic']));
  const [lineMenuOpen, setLineMenuOpen] = useState(false);
  const showLinksRef = useRef(true);
  const linkFilterRef = useRef(0.05);
  const activeLineKindsRef = useRef<Set<LineKind>>(activeLineKinds);

  useEffect(() => { showLinksRef.current = showLinks; }, [showLinks]);
  useEffect(() => { linkFilterRef.current = linkStrengthFilter; }, [linkStrengthFilter]);
  useEffect(() => { activeLineKindsRef.current = activeLineKinds; }, [activeLineKinds]);

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

        // Cluster name — truncate to keep within bubble, cap font so labels
        // don't blow up to canvas-spanning sizes at very low zoom.
        const truncName = cluster.name.length > 22 ? cluster.name.slice(0, 21) + '…' : cluster.name;
        const fontSize = Math.min(28, Math.max(14, 16 / zoom));
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(truncName, cluster.cx, cluster.cy - 14 / zoom);

        const pctFont = Math.min(24, Math.max(12, 14 / zoom));
        ctx.font = `bold ${pctFont}px system-ui, sans-serif`;
        ctx.fillStyle = cluster.color;
        ctx.fillText(`${pct}%`, cluster.cx, cluster.cy + 2 / zoom);

        const subFont = Math.min(16, Math.max(10, 10 / zoom));
        ctx.font = `${subFont}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(156,163,175,0.75)';
        ctx.fillText(`${cluster.count} file${cluster.count !== 1 ? 's' : ''}`, cluster.cx, cluster.cy + 16 / zoom);

        // Top files only at mid-zoom — at very low zoom they pile into a smear.
        if (showClusterLabels && zoom >= 0.18 && zoom < 0.32) {
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
      const active = activeLineKindsRef.current;

      for (const link of linksRef.current) {
        if (!active.has(link.kind)) continue;
        const s = link.source as GraphNode;
        const tgt = link.target as GraphNode;
        if (s.x == null || s.y == null || tgt.x == null || tgt.y == null) continue;

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

        const hex = LINE_KIND_COLOR[link.kind] ?? '#6366F1';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        // Perpendicular-offset arc so multiple kinds of edges between the
        // same pair don't stack on top of each other.
        const offset = LINE_KIND_OFFSET[link.kind] ?? 0;
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        if (offset === 0) {
          ctx.lineTo(tgt.x, tgt.y);
        } else {
          const dx = tgt.x - s.x;
          const dy = tgt.y - s.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const mx = (s.x + tgt.x) / 2 + nx * offset;
          const my = (s.y + tgt.y) / 2 + ny * offset;
          ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
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
    const semanticLinks: GraphLink[] = graphData.links
      .map((l) => ({
        ...l,
        kind: 'semantic' as LineKind,
        source: nodeById.get(l.source as string) ?? l.source,
        target: nodeById.get(l.target as string) ?? l.target,
      }))
      .filter((l) => l.source && l.target);

    // Derived structural layers — toggleable independently of semantic.
    const folderLinks  = deriveGroupLinks(nodes, folderKey, 'folder',  6, 0.35);
    const projectLinks = deriveGroupLinks(nodes, (n) => n.project_id ? `p:${n.project_id}` : null, 'project', 6, 0.40);
    const typeLinks    = deriveGroupLinks(nodes, (n) => n.file_type ? `t:${typeLabel(n.file_type)}` : null, 'type', 4, 0.25);

    const links: GraphLink[] = [
      ...semanticLinks,
      ...folderLinks.map((l) => ({ ...l, source: nodeById.get(l.source as string) ?? l.source, target: nodeById.get(l.target as string) ?? l.target })),
      ...projectLinks.map((l) => ({ ...l, source: nodeById.get(l.source as string) ?? l.source, target: nodeById.get(l.target as string) ?? l.target })),
      ...typeLinks.map((l) => ({ ...l, source: nodeById.get(l.source as string) ?? l.source, target: nodeById.get(l.target as string) ?? l.target })),
    ].filter((l) => l.source && l.target);

    // Reassign groups based on active cluster modes.
    const projectNameById = new Map(graphData.projects.map((p) => [p.id, p.name]));
    const componentMap = clusterModes.has('connected') ? computeConnectedComponents(nodes, links) : new Map<string, string>();
    for (const n of nodes) {
      const g = assignGroup(n, clusterModes, componentMap, projectNameById);
      n.group = g.id;
      n.color = g.color;
    }

    nodesRef.current = nodes;
    linksRef.current = links;

    simRef.current?.stop();

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Distinct cluster keys — depends on the cluster mode.
    const clusterKeys = new Set<string>();
    for (const n of nodes) clusterKeys.add(n.group);
    const clusterList = [...clusterKeys];

    // Spread cluster centers far enough apart that bubbles + labels don't
    // pile on top of each other. Radius grows with both canvas size and the
    // SQUARE ROOT of (clusters * avg cluster size) so denser graphs get more
    // breathing room.
    const minDim = Math.min(canvas.width, canvas.height);
    const k = clusterList.length;
    const avgPerCluster = k > 0 ? nodes.length / k : 0;
    const densityFactor = Math.sqrt(Math.max(1, avgPerCluster));
    const spreadR = k === 1
      ? minDim * 0.08
      : Math.max(
          900,
          minDim * (0.7 + Math.min(k, 16) * 0.04) + densityFactor * 28,
        );

    const groupCenters = new Map<string, { x: number; y: number }>();
    clusterList.forEach((key, i) => {
      const angle = (i / clusterList.length) * Math.PI * 2 - Math.PI / 2;
      groupCenters.set(key, {
        x: cx + Math.cos(angle) * spreadR,
        y: cy + Math.sin(angle) * spreadR,
      });
    });

    // Seed each node near its cluster center with a jitter so the simulation
    // doesn't start from (0,0) and collapse to the canvas middle.
    for (const n of nodes) {
      const c = groupCenters.get(n.group) ?? { x: cx, y: cy };
      if (n.x == null) n.x = c.x + (Math.random() - 0.5) * 240;
      if (n.y == null) n.y = c.y + (Math.random() - 0.5) * 240;
    }

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
      .force('charge', d3Force.forceManyBody().strength(-380).distanceMax(440))
      .force('collision', d3Force.forceCollide(NODE_RADIUS + 22).strength(0.95).iterations(4))
      .force('x', d3Force.forceX<GraphNode>((d) => groupCenters.get(d.group)?.x ?? cx).strength(0.2))
      .force('y', d3Force.forceY<GraphNode>((d) => groupCenters.get(d.group)?.y ?? cy).strength(0.2))
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
  }, [graphData, draw, onNodeClick, clusterModes]);

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
    setCrawlMsg('Starting crawl…');

    // ETA computed from a sliding rolling rate window (samples over time).
    const formatEta = (seconds: number): string => {
      if (!isFinite(seconds) || seconds <= 0) return '';
      if (seconds < 90) return `~${Math.ceil(seconds)}s`;
      if (seconds < 60 * 90) return `~${Math.ceil(seconds / 60)}m`;
      const h = Math.floor(seconds / 3600);
      const m = Math.round((seconds % 3600) / 60);
      return m === 0 ? `~${h}h` : `~${h}h ${m}m`;
    };

    type Sample = { t: number; indexed: number };
    const samples: Sample[] = [];

    try {
      const kick = await api.post('/crawler/run-all');
      setCrawlMsg(kick.data?.message ?? 'Crawl queued');

      const t0 = Date.now();
      while (Date.now() - t0 < 5 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 4000));
        try {
          const sRes = await api.get('/crawler/status');
          const s = sRes.data?.data ?? {};
          const indexed = s.indexed ?? 0;
          const remaining = s.remaining ?? 0;
          const conns = s.connections ?? 0;

          samples.push({ t: Date.now(), indexed });
          // Keep last 6 samples (~24s window) for rate calc.
          while (samples.length > 6) samples.shift();

          let etaText = ' · ETA calculating…';
          if (samples.length >= 2 && remaining > 0) {
            const first = samples[0];
            const last = samples[samples.length - 1];
            const dtSec = (last.t - first.t) / 1000;
            const dIdx = last.indexed - first.indexed;
            if (dtSec > 0 && dIdx > 0) {
              const ratePerSec = dIdx / dtSec;
              etaText = ` · ETA ${formatEta(remaining / ratePerSec)}`;
            }
          }
          if (remaining === 0) etaText = '';

          setCrawlMsg(
            remaining === 0
              ? `Done · ${indexed} indexed · ${conns} connections`
              : `Crawling… ${indexed} indexed · ${remaining} pending · ${conns} connections${etaText}`,
          );
          fetchGraph();
          if (remaining === 0) break;
        } catch {
          break;
        }
      }
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
        <div className="relative shrink-0">
          <button
            onClick={() => setClusterMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-300 text-[11px] rounded-md px-3 py-1.5 transition-colors"
          >
            <span>
              Cluster:{' '}
              <span className="text-gray-500">
                {clusterModes.size === 0
                  ? 'none'
                  : CLUSTER_MODES.filter((m) => clusterModes.has(m.id)).map((m) => m.label).join(' · ')}
              </span>
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-500"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {clusterMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setClusterMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 bg-gray-900 border border-gray-800 rounded-md shadow-xl py-1 min-w-[160px]">
                {CLUSTER_MODES.map((m) => {
                  const active = clusterModes.has(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() =>
                        setClusterModes((prev) => {
                          const next = new Set(prev);
                          if (next.has(m.id)) next.delete(m.id);
                          else next.add(m.id);
                          return next;
                        })
                      }
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          active ? 'bg-indigo-500 border-indigo-500' : 'border-gray-600 bg-gray-800'
                        }`}
                      >
                        {active && (
                          <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </span>
                      {m.label}
                    </button>
                  );
                })}
                <div className="border-t border-gray-800 mt-1 pt-1 flex gap-1 px-2 pb-1">
                  <button
                    onClick={() => setClusterModes(new Set(CLUSTER_MODES.map((m) => m.id)))}
                    className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setClusterModes(new Set())}
                    className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1"
                  >
                    None
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            onClick={() => setLineMenuOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 bg-gray-900 border border-gray-800 hover:border-gray-700 text-gray-300 text-[11px] rounded-md px-3 py-1.5 transition-colors"
          >
            <span>
              Lines:{' '}
              <span className="text-gray-500">
                {activeLineKinds.size === 0
                  ? 'off'
                  : LINE_KINDS.filter((k) => activeLineKinds.has(k.id)).map((k) => k.label).join(' · ')}
              </span>
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" className="text-gray-500"><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {lineMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setLineMenuOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 bg-gray-900 border border-gray-800 rounded-md shadow-xl py-1 min-w-[180px]">
                {LINE_KINDS.map((k) => {
                  const active = activeLineKinds.has(k.id);
                  return (
                    <button
                      key={k.id}
                      onClick={() => {
                        setActiveLineKinds((prev) => {
                          const next = new Set(prev);
                          if (next.has(k.id)) next.delete(k.id);
                          else next.add(k.id);
                          return next;
                        });
                        requestAnimationFrame(draw);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
                    >
                      <span
                        className="w-3.5 h-3.5 rounded border flex items-center justify-center"
                        style={{
                          backgroundColor: active ? k.color : 'transparent',
                          borderColor: active ? k.color : '#4B5563',
                        }}
                      >
                        {active && (
                          <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </span>
                      <span className="flex-1 text-left">{k.label}</span>
                      <span className="w-5 h-0.5 rounded" style={{ backgroundColor: k.color }} />
                    </button>
                  );
                })}
                <div className="border-t border-gray-800 mt-1 pt-1 flex gap-1 px-2 pb-1">
                  <button
                    onClick={() => { setActiveLineKinds(new Set(LINE_KINDS.map((k) => k.id))); requestAnimationFrame(draw); }}
                    className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1"
                  >
                    All
                  </button>
                  <button
                    onClick={() => { setActiveLineKinds(new Set()); requestAnimationFrame(draw); }}
                    className="flex-1 text-[10px] text-gray-500 hover:text-gray-300 py-1"
                  >
                    None
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

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
          <label className="flex items-center gap-2 text-xs text-gray-600">
            Min link strength
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.01}
              value={linkStrengthFilter}
              onChange={(e) => { setLinkStrengthFilter(parseFloat(e.target.value)); requestAnimationFrame(draw); }}
              className="w-24 accent-indigo-500"
            />
            <span className="w-8 text-right tabular-nums">{linkStrengthFilter.toFixed(2)}</span>
          </label>
          {[...activeLineKinds].length > 0 && (
            <div className="flex items-center gap-2 text-xs text-gray-600 flex-wrap">
              {LINE_KINDS.filter((k) => activeLineKinds.has(k.id)).map((k) => (
                <span key={k.id} className="inline-flex items-center gap-1.5">
                  <span className="w-4 h-0.5 rounded" style={{ backgroundColor: k.color }} />
                  {k.label}
                </span>
              ))}
            </div>
          )}
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
