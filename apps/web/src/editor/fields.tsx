import { useEffect, useState, type ReactNode } from 'react';
import { SwatchButton } from './ColorPicker';

/** Evaluate a simple arithmetic expression (digits, + - * / ( ) . only). */
export function evalExpr(s: string): number | null {
  const t = s.trim();
  if (!t || !/^[0-9+\-*/().\s]+$/.test(t)) return null;
  try { const v = Function(`"use strict"; return (${t})`)(); return typeof v === 'number' && Number.isFinite(v) ? v : null; } catch { return null; }
}

export function NumberField(p: { label?: ReactNode; title?: string; value: number | null; onCommit: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; disabled?: boolean; decimals?: number }) {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const dec = p.decimals ?? 2;
  const shown = p.value === null ? '' : String(Math.round(p.value * 10 ** dec) / 10 ** dec);
  useEffect(() => { if (!focus) setText(shown); }, [shown, focus]);
  const commit = (raw: string) => {
    const v = evalExpr(raw);
    if (v === null) { setText(shown); return; }
    const c = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
    if (p.value !== null && Math.abs(c - p.value) < 1e-9) { setText(shown); return; } // unchanged: no history entry
    p.onCommit(c);
  };
  return (
    <label className="nf" title={p.title}>
      {p.label && <span className="nf-label">{p.label}</span>}
      <input
        value={focus ? text : shown} placeholder={p.value === null ? 'Mixed' : ''} disabled={p.disabled}
        onFocus={e => { setFocus(true); setText(shown); e.currentTarget.select(); }}
        onChange={e => setText(e.target.value)}
        onBlur={e => { setFocus(false); if (text !== shown) commit(e.target.value); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.select(); }
          else if (e.key === 'Escape') { setText(shown); e.currentTarget.blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = evalExpr(e.currentTarget.value) ?? p.value ?? 0;
            const st = (p.step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
            const v = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, base + st));
            setText(String(Math.round(v * 100) / 100)); p.onCommit(v);
          }
        }}
      />
      {p.suffix && <span className="nf-suffix">{p.suffix}</span>}
    </label>
  );
}

export function ColorField(p: { color: string; onChange: (c: string) => void; disabled?: boolean; opacity?: number; onOpacity?: (o: number) => void }) {
  const [text, setText] = useState(p.color.toUpperCase().replace('#', ''));
  useEffect(() => setText(p.color.toUpperCase().replace('#', '')), [p.color]);
  return (
    <span className="cf">
      <SwatchButton paint={{ type: 'SOLID', color: p.color, opacity: p.opacity ?? 1 }} disabled={p.disabled} gradients={false} showOpacity={p.onOpacity !== undefined}
        onChange={n => { if (n.type === 'SOLID') { p.onChange(n.color); if (p.onOpacity && n.opacity !== (p.opacity ?? 1)) p.onOpacity(n.opacity); } }} />
      <input className="cf-hex" value={text} disabled={p.disabled} maxLength={6} aria-label="Hex colour"
        onChange={e => setText(e.target.value)}
        onBlur={() => { if (/^[0-9a-f]{6}$/i.test(text)) p.onChange('#' + text.toUpperCase()); else setText(p.color.toUpperCase().replace('#', '')); }}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    </span>
  );
}
