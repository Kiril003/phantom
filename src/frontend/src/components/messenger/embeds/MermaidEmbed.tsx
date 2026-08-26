import React, { useState } from 'react';
import { MermaidData } from '../../../types/messenger';
import { Network, Copy, Check, Code, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface MermaidEmbedProps {
  data: MermaidData;
}

export const MermaidEmbed: React.FC<MermaidEmbedProps> = ({ data }) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoom, setZoom] = useState(1);

  const handleCopy = () => {
    navigator.clipboard.writeText(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Safe client-side parser/renderer for common Mermaid diagram types
  const renderVisualNodes = () => {
    const lines = data.code.split('\n').map((l) => l.trim()).filter(Boolean);
    const diagramType = lines[0] || 'graph';

    // Parse simple node relations e.g. A --> B or A[Label] --> B[Label]
    const edges: { from: string; to: string; label?: string }[] = [];
    const nodeLabels: Record<string, string> = {};

    lines.slice(1).forEach((line) => {
      const match = line.match(/([a-zA-Z0-9_-]+)(?:\[(.*?)\])?\s*-->\s*(?:\|(.*?)\|)?\s*([a-zA-Z0-9_-]+)(?:\[(.*?)\])?/);
      if (match) {
        const [, fromId, fromLabel, edgeLabel, toId, toLabel] = match;
        if (fromLabel) nodeLabels[fromId] = fromLabel;
        if (toLabel) nodeLabels[toId] = toLabel;
        edges.push({ from: fromId, to: toId, label: edgeLabel });
      }
    });

    if (edges.length === 0) {
      // Fallback simple graph
      return (
        <div className="p-4 flex flex-col items-center justify-center text-center space-y-2">
          <Network className="w-8 h-8 text-amber-400/80 animate-pulse" />
          <p className="text-xs font-mono text-white/80">{diagramType}</p>
          <div className="flex flex-wrap gap-2 justify-center max-w-md">
            {lines.slice(1, 6).map((l, i) => (
              <span key={i} className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-lg text-[11px] font-mono text-amber-200/90">
                {l}
              </span>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div
        className="p-6 flex flex-col items-center justify-center gap-4 transition-transform duration-200 overflow-x-auto"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
      >
        <div className="flex flex-wrap items-center justify-center gap-6">
          {edges.map((edge, idx) => (
            <div key={idx} className="flex items-center gap-3 bg-black/40 border border-white/10 p-3 rounded-xl shadow-md">
              <div className="px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-200 text-xs font-semibold">
                {nodeLabels[edge.from] || edge.from}
              </div>
              <div className="flex flex-col items-center">
                {edge.label && <span className="text-[10px] text-amber-300 font-mono mb-0.5">{edge.label}</span>}
                <div className="w-8 h-0.5 bg-gradient-to-r from-indigo-500 to-amber-500 relative">
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-t-2 border-t-transparent border-b-2 border-b-transparent border-l-4 border-l-amber-400" />
                </div>
              </div>
              <div className="px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-xs font-semibold">
                {nodeLabels[edge.to] || edge.to}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-2xl bg-black/50 border border-white/15 rounded-2xl overflow-hidden backdrop-blur-md shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-white tracking-tight">{data.title || 'Mermaid Діаграма'}</span>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
            Diagram
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            title="Збільшити"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.7, z - 0.1))}
            title="Зменшити"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom(1)}
            title="Скинути масштаб"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowCode(!showCode)}
            title="Перемкнути код"
            className={`p-1.5 rounded transition-colors ${
              showCode ? 'bg-amber-500/20 text-amber-300' : 'hover:bg-white/10 text-white/50 hover:text-white'
            }`}
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCopy}
            title="Копіювати код Mermaid"
            className="p-1.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      {showCode ? (
        <pre className="p-4 bg-[#0B0D11] font-mono text-xs text-amber-200/90 overflow-x-auto leading-relaxed border-b border-white/5">
          {data.code}
        </pre>
      ) : (
        <div className="bg-[#0D0F14] min-h-[140px] flex items-center justify-center">
          {renderVisualNodes()}
        </div>
      )}

      {data.caption && (
        <div className="px-4 py-2 bg-white/[0.01] border-t border-white/5 text-[11px] text-white/50 italic">
          {data.caption}
        </div>
      )}
    </div>
  );
};
