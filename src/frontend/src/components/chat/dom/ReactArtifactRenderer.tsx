import { useState } from 'react';
import { SandpackProvider, SandpackLayout, SandpackCodeEditor, SandpackPreview } from '@codesandbox/sandpack-react';
import { Code, Eye, Columns, Maximize2, Minimize2 } from 'lucide-react';
import type { ReactArtifactSceneData } from '@shared/types';
import { FullscreenPortal } from './FullscreenPortal';

export function ReactArtifactRenderer({ data }: { data: ReactArtifactSceneData }) {
  const [viewMode, setViewMode] = useState<'split' | 'preview' | 'code'>('preview');
  const [expanded, setExpanded] = useState(false);
  const paneHeight = expanded ? 'calc(100vh - 110px)' : '420px';

  const customSetup = {
    dependencies: {
      "lucide-react": "latest",
      "recharts": "latest",
      "framer-motion": "latest",
      ...data.dependencies
    }
  };

  const files = {
    "/App.js": data.code || `export default function App() { return <div className="p-4 text-white">No code provided</div> }`
  };

  const card = (
    <div className="w-full flex flex-col rounded-xl overflow-hidden border border-white/10 bg-black/40 mt-2 mb-2 shadow-2xl">
      {/* Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-green-500/80" />
          </div>
          <span className="text-sm font-medium text-white/90 tracking-wide">{data.title || "React Artifact"}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-black/30 p-1 rounded-lg border border-white/5">
          <button 
            onClick={() => setViewMode('preview')} 
            className={`p-1.5 rounded-md transition-all ${viewMode === 'preview' ? 'bg-white/15 text-white shadow-sm' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
            title="Preview"
          >
             <Eye size={15} />
          </button>
          <button 
            onClick={() => setViewMode('code')} 
            className={`p-1.5 rounded-md transition-all ${viewMode === 'code' ? 'bg-white/15 text-white shadow-sm' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
            title="Code"
          >
             <Code size={15} />
          </button>
          <button
            onClick={() => setViewMode('split')}
            className={`p-1.5 rounded-md transition-all ${viewMode === 'split' ? 'bg-white/15 text-white shadow-sm' : 'text-white/50 hover:bg-white/5 hover:text-white/80'}`}
            title="Split View"
          >
             <Columns size={15} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1.5 rounded-md transition-all text-white/50 hover:bg-white/5 hover:text-white/80"
            title={expanded ? 'Згорнути' : 'На весь екран'}
            aria-label={expanded ? 'згорнути артефакт' : 'розгорнути артефакт'}
          >
             {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {/* Sandpack Content */}
      <SandpackProvider 
        template="react" 
        theme="dark"
        customSetup={customSetup}
        files={files}
        options={{
          externalResources: ["https://cdn.tailwindcss.com"],
        }}
      >
        <SandpackLayout style={{ border: 'none', background: 'transparent', borderRadius: 0 }}>
          {viewMode !== 'preview' && <SandpackCodeEditor showTabs={false} style={{ height: paneHeight }} />}
          {viewMode !== 'code' && <SandpackPreview showNavigator={false} style={{ height: paneHeight }} />}
        </SandpackLayout>
      </SandpackProvider>
    </div>
  );

  if (expanded) {
    return (
      <FullscreenPortal title={data.title || 'React Artifact'} onClose={() => setExpanded(false)}>
        {card}
      </FullscreenPortal>
    );
  }
  return card;
}
