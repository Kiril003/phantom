import React, { useState } from 'react';
import { Code, Copy, Check, ZoomIn, ZoomOut, Image as ImageIcon } from 'lucide-react';
import { SvgPreviewData } from '../../../types/messenger';
import { soundFx } from '../../../utils/messengerSound';

interface SvgPreviewEmbedProps {
  data: SvgPreviewData;
}

export const SvgPreviewEmbed: React.FC<SvgPreviewEmbedProps> = ({ data }) => {
  const [showCode, setShowCode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    soundFx.playTap();
    navigator.clipboard.writeText(data.svgContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-[480px] rounded-2xl bg-[#FAF7F0] border border-[#E5DEC9] overflow-hidden shadow-sm hover:shadow-md transition-all text-[#21261F]">
      <div className="p-3 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-[#D96C35]" />
          <h4 className="text-[13px] font-bold text-[#21261F]">{data.title || 'Векторний SVG макет'}</h4>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="p-1 hover:bg-[#EAE4D7] rounded text-[#6E7568]"
            title="Зменшити"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
            className="p-1 hover:bg-[#EAE4D7] rounded text-[#6E7568]"
            title="Збільшити"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowCode(!showCode)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border transition-all ${
              showCode
                ? 'bg-[#D96C35] text-white border-[#D96C35]'
                : 'bg-white text-[#6E7568] border-[#E5DEC9] hover:bg-[#FDF5ED]'
            }`}
          >
            <Code className="w-3 h-3" />
            <span>{showCode ? 'Макет' : 'Код'}</span>
          </button>
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-[#EAE4D7] rounded text-[#6E7568]"
            title="Копіювати SVG"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="p-4 flex items-center justify-center min-h-[160px] bg-[#FDFCF9] overflow-auto">
        {showCode ? (
          <pre className="w-full p-3 font-mono text-[11.5px] text-[#21261F] bg-[#FAF7F0] rounded-xl border border-[#E5DEC9] overflow-x-auto leading-relaxed max-h-[260px]">
            {data.svgContent}
          </pre>
        ) : (
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            className="transition-transform duration-150 flex items-center justify-center"
            dangerouslySetInnerHTML={{ __html: data.svgContent }}
          />
        )}
      </div>
    </div>
  );
};
