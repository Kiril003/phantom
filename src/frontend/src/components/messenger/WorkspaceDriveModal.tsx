import React, { useState } from 'react';
import {
  FolderTree,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  Upload,
  Download,
  X,
  Search,
} from 'lucide-react';
import { WorkspaceDriveFile } from '../../types/messenger';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';

interface WorkspaceDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceTitle: string;
}

export const WorkspaceDriveModal: React.FC<WorkspaceDriveModalProps> = ({
  isOpen,
  onClose,
  workspaceTitle,
}) => {
  useEscapeClose(isOpen, onClose);

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedFile, setSelectedFile] = useState<WorkspaceDriveFile | null>(null);

  const [files] = useState<WorkspaceDriveFile[]>([
    {
      id: 'f_1',
      name: 'phantom_os_architecture_spec.md',
      category: 'document',
      sizeBytes: 48200,
      updatedAt: 'Сьогодні, 14:20',
      updatedBy: 'Кирило',
      currentVersion: 'v2.1',
      url: '#',
      tags: ['Arch', 'Spec', 'Work OS'],
      versions: [
        {
          version: 'v2.1',
          updatedAt: 'Сьогодні, 14:20',
          updatedBy: 'Кирило',
          sizeBytes: 48200,
          changeNote: 'Оновлено специфікацію гібридних Canvas сплітів',
          url: '#',
        },
        {
          version: 'v2.0',
          updatedAt: '24 сер, 11:00',
          updatedBy: 'Саня',
          sizeBytes: 42100,
          changeNote: 'Додано протокол P2P ретранслятора',
          url: '#',
        },
        {
          version: 'v1.0',
          updatedAt: '20 сер, 09:30',
          updatedBy: 'Кирило',
          sizeBytes: 31000,
          changeNote: 'Початковий драфт архітектури',
          url: '#',
        },
      ],
    },
    {
      id: 'f_2',
      name: 'mesh_network_diagram.svg',
      category: 'image',
      sizeBytes: 124000,
      updatedAt: 'Вчора, 18:30',
      updatedBy: 'Марина',
      currentVersion: 'v1.2',
      url: '#',
      tags: ['Diagram', 'UI', 'Mesh'],
      versions: [
        {
          version: 'v1.2',
          updatedAt: 'Вчора, 18:30',
          updatedBy: 'Марина',
          sizeBytes: 124000,
          changeNote: 'Підігнано теплу палітру Sunrise',
          url: '#',
        },
        {
          version: 'v1.0',
          updatedAt: '22 сер, 16:00',
          updatedBy: 'Марина',
          sizeBytes: 118000,
          changeNote: 'Базовий векторний макет',
          url: '#',
        },
      ],
    },
    {
      id: 'f_3',
      name: 'call_engine_webrtc_v2.ts',
      category: 'code',
      sizeBytes: 52700,
      updatedAt: '24 сер, 20:15',
      updatedBy: 'Саня',
      currentVersion: 'v3.0',
      url: '#',
      tags: ['WebRTC', 'iOS', 'Engine'],
      versions: [
        {
          version: 'v3.0',
          updatedAt: '24 сер, 20:15',
          updatedBy: 'Саня',
          sizeBytes: 52700,
          changeNote: 'Підтримка iOS Safari WebKit та playsinline',
          url: '#',
        },
      ],
    },
    {
      id: 'f_4',
      name: 'release_build_companion_arm64.apk',
      category: 'archive',
      sizeBytes: 16200000,
      updatedAt: '26 сер, 16:45',
      updatedBy: 'CI/CD Bot',
      currentVersion: 'v1.0.4',
      url: '#',
      tags: ['Release', 'Android', 'Build'],
      versions: [
        {
          version: 'v1.0.4',
          updatedAt: '26 сер, 16:45',
          updatedBy: 'CI/CD Bot',
          sizeBytes: 16200000,
          changeNote: 'Атомарна збірка Sprint A',
          url: '#',
        },
      ],
    },
  ]);

  if (!isOpen) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (cat: WorkspaceDriveFile['category']) => {
    switch (cat) {
      case 'code':
        return <FileCode className="w-5 h-5 text-amber-700" />;
      case 'document':
        return <FileText className="w-5 h-5 text-blue-600" />;
      case 'image':
        return <ImageIcon className="w-5 h-5 text-emerald-600" />;
      default:
        return <File className="w-5 h-5 text-[#6E7568]" />;
    }
  };

  const filteredFiles = files.filter((f) => {
    const matchesCat = selectedCategory === 'all' || f.category === selectedCategory;
    if (!matchesCat) return false;
    if (!search.trim()) return true;
    return (
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.tags?.some((t) => t.toLowerCase().includes(search.toLowerCase()))
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#FDFCF9] border border-[#E5DEC9] rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-[#21261F] flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 bg-[#F7F4EC] border-b border-[#E5DEC9] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center text-[#D96C35] shadow-sm">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#21261F]">
                Спільне сховище простору (Workspace Drive)
              </h3>
              <p className="text-xs text-[#6E7568] mt-0.5">
                Простір: <b>{workspaceTitle}</b> • Локальне версіонування та P2P реплікація
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => soundFx.playTap()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Завантажити файл</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-[#E5DEC9] bg-[#FAF7F0] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-sm bg-white border border-[#E5DEC9] rounded-xl px-3 py-1.5 focus-within:border-[#D96C35]">
            <Search className="w-3.5 h-3.5 text-[#8A9186]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Пошук файлів у сховищі..."
              className="w-full text-xs text-[#21261F] placeholder-[#8A9186] bg-transparent focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Всі файли' },
                { id: 'document', label: 'Документи' },
                { id: 'code', label: 'Код' },
                { id: 'image', label: 'Медіа / SVG' },
                { id: 'archive', label: 'Бінарники' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-[#FDF5ED] text-[#D96C35] border border-[#EADCC8]'
                    : 'text-[#6E7568] hover:text-[#21261F]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
          <div className="flex-1 p-5 overflow-y-auto space-y-3 custom-scrollbar">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                onClick={() => {
                  soundFx.playTap();
                  setSelectedFile(file);
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedFile?.id === file.id
                    ? 'bg-[#FDF9F3] border-[#D96C35] shadow-sm'
                    : 'bg-[#FAF7F0] border-[#E5DEC9] hover:bg-[#FDFCF9] hover:border-[#D96C35]/40'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#FDF5ED] border border-[#EADCC8] flex items-center justify-center shrink-0">
                    {getFileIcon(file.category)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[13.5px] font-bold text-[#21261F] truncate">{file.name}</h4>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#EAE4D7] text-[#6E7568]">
                        {file.currentVersion}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#6E7568] mt-0.5">
                      {formatSize(file.sizeBytes)} • Змінено: {file.updatedAt} ({file.updatedBy})
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      soundFx.playTap();
                    }}
                    title="Завантажити копію"
                    className="p-2 hover:bg-[#EAE4D7] rounded-xl text-[#6E7568]"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {selectedFile && (
            <div className="w-80 border-l border-[#E5DEC9] bg-[#F7F4EC] p-5 flex flex-col justify-between overflow-y-auto custom-scrollbar">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#D96C35]">
                    Історія версій
                  </span>
                  <button
                    onClick={() => setSelectedFile(null)}
                    className="p-1 hover:bg-[#EAE4D7] rounded text-[#6E7568]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[#21261F] break-all">{selectedFile.name}</h4>
                  <p className="text-[11px] text-[#6E7568] mt-0.5">
                    Поточна версія: <b>{selectedFile.currentVersion}</b> • {selectedFile.versions.length} ревізій
                  </p>
                </div>

                <div className="space-y-2.5 pt-2">
                  {selectedFile.versions.map((ver, i) => (
                    <div
                      key={ver.version}
                      className={`p-3 rounded-xl border text-xs space-y-1 ${
                        i === 0
                          ? 'bg-[#FDF9F3] border-[#EADCC8]'
                          : 'bg-white border-[#E5DEC9] opacity-80'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-[#D96C35] font-mono">{ver.version}</span>
                        <span className="text-[10px] text-[#8A9186]">{ver.updatedAt}</span>
                      </div>
                      <p className="text-[11.5px] text-[#21261F] leading-tight font-medium">
                        {ver.changeNote || 'Оновлення файлу'}
                      </p>
                      <div className="flex items-center justify-between pt-1 text-[10px] text-[#8A9186]">
                        <span>{ver.updatedBy}</span>
                        <span>{formatSize(ver.sizeBytes)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-[#E5DEC9] space-y-2">
                <button
                  onClick={() => soundFx.playTap()}
                  className="w-full py-2 rounded-xl bg-[#D96C35] hover:bg-[#B85425] text-white text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Завантажити нову ревізію</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 bg-[#F7F4EC] border-t border-[#E5DEC9] flex items-center justify-between text-xs text-[#6E7568]">
          <span>Локальне дзеркало Workspace Drive синхронізовано з вузлом</span>
          <span>Використано 16.4 MB із 50 GB локального сховища</span>
        </div>
      </div>
    </div>
  );
};
