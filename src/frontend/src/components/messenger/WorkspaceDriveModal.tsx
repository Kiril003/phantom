import React, { useState } from 'react';
import {
  FolderTree,
  File,
  FileText,
  Plus,
  Trash2,
  X,
  Search,
} from 'lucide-react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { soundFx } from '../../utils/messengerSound';
import { useWorkOsStore, DriveItem } from '../../stores/workOsStore';

interface WorkspaceDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceTitle?: string;
}

export const WorkspaceDriveModal: React.FC<WorkspaceDriveModalProps> = ({
  isOpen,
  onClose,
  workspaceTitle = 'Workspace Drive',
}) => {
  useEscapeClose(isOpen, onClose);

  const [search, setSearch] = useState('');
  const [selectedFile, setSelectedFile] = useState<DriveItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState<DriveItem['type']>('doc');
  const [newFileContent, setNewFileContent] = useState('');

  const { driveItems, addDriveItem, deleteDriveItem, updateDriveItem } = useWorkOsStore();

  if (!isOpen) return null;

  const filteredFiles = driveItems.filter(
    (f) =>
      !search ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  const handleCreateFile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    soundFx.playSend();
    const created = addDriveItem({
      name: newFileName.trim(),
      type: newFileType,
      sizeBytes: newFileContent.length,
      mimeType: newFileType === 'doc' ? 'text/markdown' : 'text/plain',
      parentId: null,
      content: newFileContent,
      tags: ['workspace', newFileType],
    });
    setSelectedFile(created);
    setNewFileName('');
    setNewFileContent('');
    setIsCreating(false);
  };

  return (
    <div
      className="fixed inset-0 phantom-scrim z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#E5DEC9] text-[#21261F] rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150 select-text"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#FAF8F5] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FDF5ED] text-[#D96C35] border border-[#E5DEC9]">
              <FolderTree className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#21261F]">
                Workspace Drive (Хмарне & Локальне сховище)
              </h3>
              <p className="text-[11px] text-[#6E7568]">
                {workspaceTitle} · Документи, файли та артефакти проєкту
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                soundFx.playTap();
                setIsCreating(!isCreating);
              }}
              className="px-3 py-1.5 bg-[#D96C35] text-white rounded-lg text-xs font-bold hover:bg-[#C25B27] transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> Створити файл
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#6E7568] hover:text-[#21261F] hover:bg-[#F1EBDD] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Toolbar */}
        <div className="px-5 py-2.5 bg-[#FDFCF9] border-b border-[#E8E1D3] flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="w-3.5 h-3.5 text-[#8A8577] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Пошук файлів у Drive..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-[#F7F5EE] border border-[#E8E1D3] rounded-lg text-xs outline-none focus:border-[#D96C35]"
            />
          </div>
          <span className="text-xs text-[#8A8577]">{driveItems.length} файлів</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          <div className="flex-1 p-5 overflow-y-auto space-y-3 bg-[#FAF8F5]">
            {isCreating && (
              <form onSubmit={handleCreateFile} className="p-4 bg-white border border-[#D96C35] rounded-xl space-y-3">
                <h4 className="font-bold text-xs text-[#D96C35]">Створення нового файлу</h4>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Назва файлу (напр. notes.md)..."
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                  />
                  <select
                    value={newFileType}
                    onChange={(e) => setNewFileType(e.target.value as any)}
                    className="px-2 py-1.5 border border-[#E8E1D3] rounded-lg text-xs"
                  >
                    <option value="doc">Markdown Doc</option>
                    <option value="sheet">Sheet / Data</option>
                    <option value="file">Plain Text</option>
                  </select>
                </div>
                <textarea
                  placeholder="Вміст файлу..."
                  rows={4}
                  value={newFileContent}
                  onChange={(e) => setNewFileContent(e.target.value)}
                  className="w-full px-3 py-1.5 border border-[#E8E1D3] rounded-lg text-xs font-mono"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreating(false)}
                    className="px-2.5 py-1 text-xs text-[#6E7568]"
                  >
                    Скасувати
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 bg-[#D96C35] text-white font-bold text-xs rounded-lg"
                  >
                    Зберегти у Drive
                  </button>
                </div>
              </form>
            )}

            <div className="space-y-2">
              {filteredFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={() => setSelectedFile(file)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                    selectedFile?.id === file.id
                      ? 'bg-white border-[#D96C35] shadow-sm ring-1 ring-[#D96C35]'
                      : 'bg-white border-[#E8E1D3] hover:border-[#D96C35]/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[#FAF8F5] border border-[#E8E1D3] text-[#D96C35]">
                      {file.type === 'folder' ? <FolderTree className="w-4 h-4" /> :
                       file.type === 'doc' ? <FileText className="w-4 h-4" /> :
                       <File className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-xs text-[#21261F]">{file.name}</h4>
                      <p className="text-[10px] text-[#8A8577]">
                        {new Date(file.updatedAt).toLocaleDateString()} · {(file.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {file.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 bg-[#F7F5EE] border border-[#E8E1D3] rounded text-[10px] text-[#6E7568]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details / Editor */}
          {selectedFile && (
            <div className="w-full md:w-96 p-5 bg-white border-t md:border-t-0 md:border-l border-[#E8E1D3] flex flex-col justify-between">
              <div className="space-y-3 flex-1 flex flex-col">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#21261F] truncate">{selectedFile.name}</span>
                  <button
                    onClick={() => {
                      soundFx.playTap();
                      deleteDriveItem(selectedFile.id);
                      setSelectedFile(null);
                    }}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Видалити"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 flex flex-col">
                  <label className="text-[10px] font-bold text-[#8A8577] uppercase mb-1">Редактор вмісту</label>
                  <textarea
                    value={selectedFile.content || ''}
                    onChange={(e) => {
                      const newContent = e.target.value;
                      updateDriveItem(selectedFile.id, {
                        content: newContent,
                        sizeBytes: newContent.length,
                      });
                      setSelectedFile({ ...selectedFile, content: newContent, sizeBytes: newContent.length });
                    }}
                    rows={12}
                    className="w-full flex-1 p-3 border border-[#E8E1D3] rounded-xl text-xs font-mono outline-none focus:border-[#D96C35] resize-none"
                    placeholder="Почніть писати..."
                  />
                </div>
              </div>
              <div className="pt-3 border-t border-[#E8E1D3] text-[10px] text-[#8A8577] flex justify-between">
                <span>Автозбереження у Local Vault</span>
                <span>{(selectedFile.sizeBytes / 1024).toFixed(1)} KB</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
