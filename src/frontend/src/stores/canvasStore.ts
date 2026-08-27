import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CanvasShape {
  id: string;
  type: 'rectangle' | 'circle' | 'arrow' | 'note' | 'text' | 'drawing';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  color: string;
  fillColor?: string;
  text?: string;
  authorName?: string;
  updatedAt: string;
}

export interface MediaAnnotationItem {
  id: string;
  mediaUrl: string;
  xPercent: number;
  yPercent: number;
  comment: string;
  authorName: string;
  createdAt: string;
  resolved?: boolean;
}

interface CanvasState {
  shapes: CanvasShape[];
  selectedShapeId: string | null;
  annotations: MediaAnnotationItem[];
  currentColor: string;
  currentTool: 'select' | 'rectangle' | 'circle' | 'arrow' | 'note' | 'pen';

  addShape: (shape: Omit<CanvasShape, 'id' | 'updatedAt'>) => CanvasShape;
  updateShape: (id: string, updates: Partial<CanvasShape>) => void;
  deleteShape: (id: string) => void;
  clearCanvas: () => void;
  setSelectedShapeId: (id: string | null) => void;
  setCurrentColor: (color: string) => void;
  setCurrentTool: (tool: CanvasState['currentTool']) => void;

  addAnnotation: (annot: Omit<MediaAnnotationItem, 'id' | 'createdAt'>) => MediaAnnotationItem;
  resolveAnnotation: (id: string) => void;
}

const INITIAL_SHAPES: CanvasShape[] = [
  {
    id: 'shape_1',
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 220,
    height: 120,
    color: '#D96C35',
    fillColor: '#FDF6EC',
    text: 'PHANTOM Mesh Gateway',
    authorName: 'Kiril',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'shape_2',
    type: 'arrow',
    x: 320,
    y: 160,
    points: [{ x: 320, y: 160 }, { x: 440, y: 160 }],
    color: '#21261F',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'shape_3',
    type: 'note',
    x: 450,
    y: 110,
    width: 200,
    height: 100,
    color: '#EBD9BE',
    fillColor: '#FEF9EE',
    text: 'Zero-Latency WebRTC DataChannel',
    authorName: 'Antigravity AI',
    updatedAt: new Date().toISOString(),
  },
];

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set) => ({
      shapes: INITIAL_SHAPES,
      selectedShapeId: null,
      annotations: [],
      currentColor: '#D96C35',
      currentTool: 'select',

      addShape: (shape) => {
        const newShape: CanvasShape = {
          ...shape,
          id: `shape_${Date.now()}`,
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ shapes: [...s.shapes, newShape] }));
        return newShape;
      },

      updateShape: (id, updates) => {
        set((s) => ({
          shapes: s.shapes.map((shape) =>
            shape.id === id ? { ...shape, ...updates, updatedAt: new Date().toISOString() } : shape
          ),
        }));
      },

      deleteShape: (id) => {
        set((s) => ({
          shapes: s.shapes.filter((s2) => s2.id !== id),
          selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
        }));
      },

      clearCanvas: () => set({ shapes: [], selectedShapeId: null }),

      setSelectedShapeId: (id) => set({ selectedShapeId: id }),
      setCurrentColor: (color) => set({ currentColor: color }),
      setCurrentTool: (tool) => set({ currentTool: tool }),

      addAnnotation: (annot) => {
        const newAnnot: MediaAnnotationItem = {
          ...annot,
          id: `annot_${Date.now()}`,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ annotations: [...s.annotations, newAnnot] }));
        return newAnnot;
      },

      resolveAnnotation: (id) => {
        set((s) => ({
          annotations: s.annotations.map((a) => (a.id === id ? { ...a, resolved: true } : a)),
        }));
      },
    }),
    {
      name: 'phantom_canvas_store',
    }
  )
);
