import { create } from 'zustand';
import type { Camera, Rect } from '@layr/core';

export type Tool = 'select' | 'hand' | 'frame' | 'section' | 'rect' | 'ellipse' | 'line' | 'text' | 'pen' | 'pencil' | 'brush' | 'star' | 'polygon' | 'arrow' | 'textpath';
export type VecTool = 'move' | 'lasso' | 'paint' | 'bend' | 'cut' | 'erase';
export type DrawStyle = 'basic' | 'flat' | 'dashed' | 'dotted';
export interface DrawOpts { color: string; size: number; style: DrawStyle }
export interface Guide { x1: number; y1: number; x2: number; y2: number }
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error' | 'readonly';
export interface Toast { id: number; text: string; kind: 'info' | 'error' }
export interface MenuState { x: number; y: number; items: MenuItem[] }
export interface MenuItem { label: string; icon?: string; shortcut?: string; disabled?: boolean; run?: () => void; separator?: boolean; /** shows a check slot; true highlights the row as the current choice */ checked?: boolean }

interface EditorUI {
  tool: Tool; selection: string[]; camera: Camera; pageId: string; hoverId: string | null; hoverFrom: 'canvas' | 'panel' | null;
  editingTextId: string | null; guides: Guide[]; marquee: Rect | null; leftTab: 'file' | 'assets' | 'variables'; userName: string; varsOpen: boolean; vectorEdit: string | null; vecSel: number[]; renaming: string | null; /** true while the pointer focus is inside a live whiteboard card (the board then owns the keyboard) */ embedFocus: boolean; leftCollapsed: boolean; mode: 'design' | 'prototype'; playing: string | null;
  saveStatus: SaveStatus; saveMessage: string; theme: 'light' | 'dark';
  leftWidth: number; rightWidth: number;
  toasts: Toast[]; menu: MenuState | null; paletteOpen: boolean; shareOpen: boolean; exportOpen: boolean;
  /** while set, the next canvas click chooses a layer (used by pattern fills) */
  pickSource: ((id: string) => void) | null;
  drawOpts: Record<'brush' | 'pencil', DrawOpts>;
  vecTool: VecTool;
  set: (p: Partial<EditorUI>) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
}

const ls = {
  get(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
export const storage = ls;
let toastId = 1;

export const useEditor = create<EditorUI>((set, get) => ({
  tool: 'select', selection: [], camera: { x: -100, y: -100, zoom: 1 }, pageId: '', hoverId: null, hoverFrom: null,
  editingTextId: null, guides: [], marquee: null, leftTab: 'file', userName: '', varsOpen: false, vectorEdit: null, vecSel: [], renaming: null, embedFocus: false, leftCollapsed: ls.get('layr:leftCollapsed', '0') === '1', mode: 'design', playing: null,
  saveStatus: 'saved', saveMessage: '', theme: (ls.get('layr:theme', 'dark') === 'light' ? 'light' : 'dark'), // dark is the default
  leftWidth: Number(ls.get('layr:left2', '290')), rightWidth: Number(ls.get('layr:right5', '241')),
  toasts: [], menu: null, paletteOpen: false, shareOpen: false, exportOpen: false,
  pickSource: null,
  drawOpts: { brush: { color: '#000000', size: 16, style: 'basic' }, pencil: { color: '#000000', size: 2, style: 'basic' } },
  vecTool: 'move',
  set: p => set(p),
  toast: (text, kind = 'info') => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter(t => t.id !== id) }), kind === 'error' ? 6000 : 2600);
  },
}));
