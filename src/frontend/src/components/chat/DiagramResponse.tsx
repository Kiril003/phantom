import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export interface DiagramNode {
  id: string;
  label?: string;
  group?: string | number;
  value?: number;
}

export interface DiagramLink {
  source: string;
  target: string;
  value?: number;
  label?: string;
}

export type DiagramKind = 'force' | 'tree' | 'flow';

export interface DiagramData {
  kind?: DiagramKind;
  title?: string;
  nodes: DiagramNode[];
  links: DiagramLink[];
}

interface DiagramResponseProps {
  data: DiagramData;
}

interface SimNode extends DiagramNode, d3.SimulationNodeDatum {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  value?: number;
  label?: string;
}

function resolveColor(varName: string, fallback = '#7aa2f7'): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return val || fallback;
}

export function DiagramResponse({ data }: DiagramResponseProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const kind: DiagramKind = data.kind ?? 'force';

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const width = 480;
    const height = 260;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const accent = resolveColor('--accent');
    const ink = resolveColor('--ink-primary', '#e8e9ec');
    const muted = resolveColor('--ink-muted', '#4a4d54');
    const line = resolveColor('--line-default', 'rgba(255,255,255,.12)');

    // Defs: arrow marker
    const defs = svg.append('defs');
    defs.append('marker')
      .attr('id', 'phantom-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L8,0L0,4')
      .attr('fill', muted);

    if (data.nodes.length === 0) {
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', muted)
        .attr('font-size', 11)
        .attr('font-family', 'JetBrains Mono, monospace')
        .text('NO DIAGRAM DATA');
      return;
    }

    if (kind === 'tree') {
      // Build hierarchy: root = first node, children via links
      const rootId = data.nodes[0].id;
      type TreeDatum = { id: string; label?: string; children: TreeDatum[] };
      const buildTree = (id: string, visited: Set<string>): TreeDatum => {
        if (visited.has(id)) return { id, children: [] };
        visited.add(id);
        const node = data.nodes.find((n) => n.id === id);
        const children = data.links
          .filter((l) => l.source === id)
          .map((l) => buildTree(l.target, visited));
        return { id, label: node?.label ?? id, children };
      };

      const rootData = buildTree(rootId, new Set());
      const root = d3.hierarchy<TreeDatum>(rootData);
      d3.tree<TreeDatum>().size([width - 80, height - 60])(root);

      const g = svg.append('g').attr('transform', 'translate(40, 30)');

      const linkPath = d3.linkVertical<d3.HierarchyPointLink<TreeDatum>, d3.HierarchyPointNode<TreeDatum>>()
        .x((d) => (d as d3.HierarchyPointNode<TreeDatum>).x)
        .y((d) => (d as d3.HierarchyPointNode<TreeDatum>).y);

      g.selectAll<SVGPathElement, d3.HierarchyPointLink<TreeDatum>>('path.link')
        .data(root.links() as d3.HierarchyPointLink<TreeDatum>[])
        .join('path')
        .attr('class', 'link')
        .attr('fill', 'none')
        .attr('stroke', line)
        .attr('stroke-width', 1.5)
        .attr('d', (d) => linkPath(d) ?? '');

      const nodeG = g.selectAll('g.node')
        .data(root.descendants())
        .join('g')
        .attr('class', 'node')
        .attr('transform', (d) => `translate(${(d as d3.HierarchyPointNode<TreeDatum>).x}, ${(d as d3.HierarchyPointNode<TreeDatum>).y})`);

      nodeG.append('circle')
        .attr('r', 6)
        .attr('fill', accent)
        .attr('stroke', 'var(--surface-deep)')
        .attr('stroke-width', 2);

      nodeG.append('text')
        .attr('dy', -10)
        .attr('text-anchor', 'middle')
        .attr('fill', ink)
        .attr('font-size', 11)
        .attr('font-family', 'Inter, sans-serif')
        .text((d) => d.data.label ?? d.data.id);
      return;
    }

    // Force-directed (default / flow)
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const links: SimLink[] = data.links.map((l) => ({
      source: l.source,
      target: l.target,
      value: l.value,
      label: l.label,
    }));

    const sim = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(80).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-180))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(22));

    const linkSel = svg.append('g')
      .attr('stroke', line)
      .attr('stroke-width', 1.5)
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('marker-end', kind === 'flow' ? 'url(#phantom-arrow)' : null);

    const nodeG = svg.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .join('g');

    nodeG.append('circle')
      .attr('r', (d) => 8 + Math.min(6, (d.value ?? 1)))
      .attr('fill', accent)
      .attr('fill-opacity', 0.85)
      .attr('stroke', 'var(--surface-deep)')
      .attr('stroke-width', 2);

    nodeG.append('text')
      .attr('dy', -14)
      .attr('text-anchor', 'middle')
      .attr('fill', ink)
      .attr('font-size', 10)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text((d) => d.label ?? d.id);

    sim.on('tick', () => {
      linkSel
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      nodeG.attr('transform', (d) => `translate(${d.x ?? 0}, ${d.y ?? 0})`);
    });

    // Stop simulation shortly so CPU usage is bounded
    const stopTimer = window.setTimeout(() => sim.stop(), 4000);

    return () => {
      window.clearTimeout(stopTimer);
      sim.stop();
    };
  }, [data, kind]);

  return (
    <div
      className="rounded-md p-3"
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--line-subtle)',
      }}
    >
      {data.title && (
        <div
          className="mb-2 font-mono tracking-wider uppercase"
          style={{ color: 'var(--ink-secondary)', fontSize: 'var(--fs-micro)' }}
        >
          {data.title}
        </div>
      )}
      <svg
        ref={svgRef}
        width="100%"
        height={260}
        style={{ display: 'block' }}
        role="img"
        aria-label="diagram"
      />
    </div>
  );
}
