import { useMemo } from 'react';
import type { FileMeta, User } from '../api';
import { Icon } from '../icons';
import { JIcon } from '../jam/icons';

interface Props { user: User; files: FileMeta[] | null; starred: FileMeta[]; onDesign: () => void; onBoard: () => void; onSystem: () => void; onImport: () => void }

const Cur = ({ c }: { c: string }) => <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l15 7-6.500 2.200L10 19z" fill={c} stroke="#fff" strokeWidth="1.600" strokeLinejoin="round" /></svg>;

/** Time-of-day icons in the banner's own palette (frosted white, lilac and cyan) with a soft glass highlight. */
function GreetIcon({ kind }: { kind: 'night' | 'morning' | 'afternoon' | 'evening' }) {
  return (
    <svg className="hh-gi" width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <radialGradient id="gSun" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#c7d2fe" /><stop offset="1" stopColor="#67e8f9" /></radialGradient>
        <radialGradient id="gMoon" cx="35%" cy="30%" r="85%"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#c7d2fe" /><stop offset="1" stopColor="#818cf8" /></radialGradient>
        <radialGradient id="gCloud" cx="35%" cy="25%" r="90%"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#a5b4fc" /></radialGradient>
        <linearGradient id="gSet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset=".5" stopColor="#a5b4fc" /><stop offset="1" stopColor="#67e8f9" /></linearGradient>
      </defs>
      {kind === 'morning' && <><g stroke="#c7d2fe" strokeWidth="2.200" strokeLinecap="round"><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.800 6.800l2.100 2.100M23.100 23.100l2.100 2.100M6.800 25.200l2.100-2.100M23.100 8.900l2.100-2.100" /></g><circle cx="16" cy="16" r="7.500" fill="url(#gSun)" /><ellipse cx="13.500" cy="12.500" rx="2.600" ry="1.800" fill="#fff" opacity=".7" /></>}
      {kind === 'afternoon' && <><circle cx="12.500" cy="12" r="7" fill="url(#gSun)" /><ellipse cx="10" cy="9" rx="2.400" ry="1.600" fill="#fff" opacity=".7" /><g stroke="#c7d2fe" strokeWidth="2" strokeLinecap="round"><path d="M12.500 1.800v2M3 12h2M5.400 4.900l1.400 1.400M19.600 4.900l-1.400 1.400" /></g><path d="M10 25a5 5 0 011-9.900 6.500 6.500 0 0112.300 1.600A4.200 4.200 0 0122.400 25z" fill="url(#gCloud)" /><path d="M13 18.200a6 6 0 019-.8" stroke="#fff" strokeWidth="1.600" strokeLinecap="round" fill="none" opacity=".9" /></>}
      {kind === 'evening' && <><path d="M22 15.500A8.500 8.500 0 1111.500 5a6.800 6.800 0 0010.500 10.500z" fill="url(#gMoon)" /><ellipse cx="10.500" cy="10.500" rx="1.900" ry="2.900" fill="#fff" opacity=".55" transform="rotate(-25 10.500 10.500)" /><path d="M8.500 27a4.300 4.300 0 01.9-8.500 5.600 5.600 0 0110.600 1.400A3.600 3.600 0 0120.200 27z" fill="url(#gCloud)" /><path d="M11.500 21.200a5 5 0 017.600-.7" stroke="#fff" strokeWidth="1.500" strokeLinecap="round" fill="none" opacity=".9" /><circle cx="25.500" cy="8" r="1.200" fill="#67e8f9" /><path d="M26 17l.7 1.600 1.600.7-1.600.7L26 21.600l-.7-1.600-1.600-.7 1.600-.7z" fill="#67e8f9" /></>}
      {kind === 'night' && <><path d="M23.500 20.500A10.500 10.500 0 1111.500 6a8.300 8.300 0 0012 14.500z" fill="url(#gMoon)" /><ellipse cx="11" cy="13" rx="2.200" ry="3.400" fill="#fff" opacity=".55" transform="rotate(-25 11 13)" /><path d="M24 5l.9 2.100 2.100.9-2.100.9L24 11l-.9-2.100L21 8l2.100-.9z" fill="#67e8f9" /><circle cx="27" cy="14" r="1.200" fill="#67e8f9" /></>}
    </svg>
  );
}

/** Greeting banner, at-a-glance numbers and four illustrated quick-start cards for the Recents view. */
export function HomeHero({ user, files, starred, onDesign, onBoard, onSystem, onImport }: Props) {
  const h = new Date().getHours(); const first = user.name.split(' ')[0];
  const greet: ['night' | 'morning' | 'afternoon' | 'evening', string] = h < 5 ? ['night', 'Working late'] : h < 12 ? ['morning', 'Good morning'] : h < 18 ? ['afternoon', 'Good afternoon'] : ['evening', 'Good evening'];
  const stats = useMemo(() => {
    const f = (files ?? []).filter(x => !x.deletedAt); const DAY = 86_400_000; const today = new Date(); today.setHours(0, 0, 0, 0);
    // files touched per day over the last 7 days (oldest → today)
    const week = (list: FileMeta[]) => Array.from({ length: 7 }, (_, i) => { const start = today.getTime() - (6 - i) * DAY; return list.filter(x => x.updatedAt >= start && x.updatedAt < start + DAY).length; });
    const designs = f.filter(x => x.type !== 'whiteboard'), boards = f.filter(x => x.type === 'whiteboard');
    return [
      { icon: <Icon n="frame" size={18} />, n: designs.length, t: 'Design files', sub: `${week(designs).reduce((a, b) => a + b, 0)} touched this week`, tone: 'blue', bars: week(designs) },
      { icon: <JIcon n="sticky" size={18} />, n: boards.length, t: 'Whiteboards', sub: `${week(boards).reduce((a, b) => a + b, 0)} touched this week`, tone: 'violet', bars: week(boards) },
      { icon: <Icon n="star" size={18} />, n: starred.length, t: 'Starred', sub: starred.length ? 'pinned in the sidebar' : 'star a file to pin it', tone: 'amber', bars: week(starred) },
      { icon: <Icon n="clock" size={18} />, n: f.filter(x => x.updatedAt >= today.getTime()).length, t: 'Edited today', sub: 'since midnight', tone: 'teal', bars: week(f) },
    ];
  }, [files, starred]);
  const empty = files !== null && files.length === 0;
  const cards: { t: string; d: string; art: React.ReactNode; run: () => void; label: string; tone: string }[] = [
    { t: 'Design file', d: 'Frames, layout and prototypes', label: 'New design file', run: onDesign, tone: 'blue', art: <div className="qs design">
      <div className="qs-frame"><span className="d1" /><span className="d2" /><span className="d3" /><i className="blk" /><i className="ln a" /><i className="ln b" /><em>Get started</em></div>
      <div className="qs-cur"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3l15 7-6.500 2.200L10 19z" fill="#0d99ff" stroke="#fff" strokeWidth="1.600" strokeLinejoin="round" /></svg><b>You</b></div></div> },
    { t: 'Whiteboard', d: 'Stickies, shapes and flows', label: 'New whiteboard', run: onBoard, tone: 'violet', art: <div className="qs board">
      <div className="qs-note n1"><i /><i /></div><div className="qs-note n2"><i /><i /></div><div className="qs-note n3"><i /><i /></div>
      <svg className="qs-arrows" viewBox="0 0 250 104" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M78 36c18 0 20 30 36 34" strokeDasharray="4 4" /><path d="M148 66c16-2 18-26 34-28" strokeDasharray="4 4" /><path d="M174 32l9 5-7 6" /></svg></div> },
    { t: 'Design system', d: 'A reusable component library', label: 'New design system', run: onSystem, tone: 'indigo', art: <div className="qs sys">
      <span className="c-btn">Button</span><span className="c-tog"><i /></span><span className="c-av">A</span><span className="c-chk"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.500" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.500l4.500 4.500L19 7.500" /></svg></span>
      <span className="c-sw"><i style={{ background: '#4f46e5' }} /><i style={{ background: '#22d3ee' }} /><i style={{ background: '#f472b6' }} /><i style={{ background: '#fbbf24' }} /></span><span className="c-card"><i /><i /></span></div> },
    { t: 'Import', d: '.fig, .xd or .layr files', label: 'Import file', run: onImport, tone: 'teal', art: <div className="qs imp">
      <div className="qs-doc"><i /><i /><i /></div><span className="qs-ext">.fig</span><span className="qs-ext x2">.xd</span>
      <svg className="qs-down" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5" /></svg><span className="qs-tray" /></div> },
  ];
  return (
    <section className="hh" aria-label="Home overview">
      <div className="hh-banner">
        <div className="hh-glow" aria-hidden="true" />
        <div className="hh-copy">
          <span className="hh-eyebrow"><GreetIcon kind={greet[0]} />{greet[1]}</span>
          <h2>{empty ? <>Welcome, <em>{first}</em></> : <>Welcome back, <em>{first}</em></>}</h2>
          <p>{empty ? 'Your workspace is empty. Start with one of the options below.' : 'Pick up a recent file or start something new below.'}</p>
        </div>
        <div className="hh-scene" aria-hidden="true">
          <div className="hh-frame"><span /><span /><span /><i /></div>
          <div className="hh-note">Ship it ✨</div>
          <div className="hh-dot"><i className="hd a" /><i className="hd b" /><i className="hd c" /><i className="hd d" /></div>
          <div className="hh-cur"><Cur c="#22d3ee" /><span>{first}</span></div>
          <div className="hh-spark s1">✦</div><div className="hh-spark s2">✦</div>
        </div>
      </div>
      <h3 className="hh-cap">Overview</h3>
      <div className="hh-stats" role="list">
        {stats.map(s => { const max = Math.max(1, ...s.bars); return (
          <div role="listitem" key={s.t} className={'hh-stat ' + s.tone}>
            <span className="ic">{s.icon}</span>
            <div className="hh-num"><b>{files === null ? '–' : s.n}</b><span>{s.t}</span><small>{s.sub}</small></div>
            <div className="hh-spark7" aria-hidden="true">{s.bars.map((v, i) => <i key={i} className={i === 6 ? 'now' : ''} style={{ height: `${Math.max(14, (v / max) * 100)}%`, opacity: v ? 1 : .35 }} />)}</div>
          </div>); })}
      </div>
      <h3 className="hh-cap">Start something new</h3>
      <div className="hh-quick">
        {cards.map(c => <button key={c.t} className={"hh-card " + c.tone} aria-label={c.label} onClick={c.run}><span className="hh-artwrap">{c.art}<span className="hh-add" aria-hidden="true"><Icon n="plus" size={14} /></span></span><span className="hh-ct"><b>{c.t}</b><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span><span className="hh-cd">{c.d}</span></button>)}
      </div>
    </section>
  );
}
