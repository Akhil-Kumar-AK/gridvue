import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';

interface Opt { value: string; label: string; disabled?: boolean; group?: string }
const textOf = (n: ReactNode): string => Children.toArray(n).map(c => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf((c.props as { children?: ReactNode }).children) : '')).join('');
function collect(children: ReactNode, group?: string): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, c => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>;
    if (el.type === 'option') out.push({ value: String(el.props.value ?? textOf(el.props.children)), label: textOf(el.props.children), disabled: el.props.disabled, group });
    else if (el.type === 'optgroup') out.push(...collect(el.props.children, el.props.label));
    else if (el.type === Fragment) out.push(...collect(el.props.children, group));
  });
  return out;
}

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & { value?: string | number; onChange?: (e: ChangeEvent<HTMLSelectElement>) => void; /** optional icon per option (shown in the menu and, with className `icononly`, alone on the button) */ iconFor?: (value: string) => ReactNode };

/** Drop-in replacement for a native `<select>` (same children and `onChange(e.target.value)` contract) with our own menu. */
export function Select({ value, onChange, children, className, disabled, title, 'aria-label': ariaLabel, style, iconFor }: Props) {
  const opts = useMemo(() => collect(children), [children]);
  const cur = opts.find(o => o.value === String(value ?? ''));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 180 && above > below;
    setPos({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8), top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 160), maxH: Math.max(120, Math.min(320, up ? above : below)), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', down, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('resize', close); };
  }, [open]);
  useEffect(() => { if (open) menu.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const pick = (o: Opt) => { if (o.disabled) return; setOpen(false); btn.current?.focus(); if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } } as unknown as ChangeEvent<HTMLSelectElement>); };
  const openMenu = () => { setActive(Math.max(0, opts.findIndex(o => o.value === String(value ?? '')))); setOpen(true); };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openMenu(); } return; }
    const step = (d: number) => { let i = active; for (let k = 0; k < opts.length; k++) { i = (i + d + opts.length) % opts.length; if (!opts[i].disabled) break; } setActive(i); };
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (opts[active]) pick(opts[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button ref={btn} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} title={title} disabled={disabled} className={'sel ' + (className ?? '')} style={style}
        onClick={() => (open ? setOpen(false) : openMenu())} onKeyDown={onKey}>
        {iconFor && cur && <span className="sel-icon">{iconFor(cur.value)}</span>}<span className="sel-label">{cur?.label ?? ''}</span><Icon n="chevD" size={12} />
      </button>
      {open && pos && createPortal(
        <div ref={menu} className="menu sel-menu" role="listbox" aria-label={ariaLabel} style={{ position: 'fixed', left: pos.left, minWidth: pos.width, maxHeight: pos.maxH, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }} onKeyDown={onKey}>
          {opts.map((o, i) => {
            const changed = o.group !== lastGroup && o.group !== undefined; const head = changed ? <Fragment key={'g' + i}>{i > 0 && <div className="sel-sep" />}{o.group!.trim() && <div className="sel-group">{o.group}</div>}</Fragment> : null; lastGroup = o.group;
            return <Fragment key={i}>{head}<button type="button" role="option" data-value={o.value} aria-selected={o.value === String(value ?? '')} data-active={i === active} disabled={o.disabled} className={'sel-opt' + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span className="sel-check">{o.value === String(value ?? '') ? '✓' : ''}</span>{iconFor && <span className="sel-icon">{iconFor(o.value)}</span>}<span className="sel-optlabel">{o.label}</span></button></Fragment>;
          })}
        </div>, document.body)}
    </>
  );
}
