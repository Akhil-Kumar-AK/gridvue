import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Select } from '../ui/Select';
import { useEditor } from '../editor/state';
import { useJam, type JamStore } from './store';
import { JIcon } from './icons';
import { voteTotal } from '@layr/core';

// ---------- state (per browser tab; not saved with the board) ----------
export const TRACKS = ['Acoustic ambient', 'Lo-fi chill', 'Focus drone', 'Rain'] as const;
interface Tmv { duration: number; startedAt: number | null; left: number; track: string; playing: boolean; volume: number; set: (p: Partial<Tmv>) => void }
export const useTmv = create<Tmv>(set => ({ duration: 240_000, startedAt: null, left: 240_000, track: TRACKS[0], playing: false, volume: 0.5, set: p => set(p) }));
const remaining = (t: Tmv, now: number) => (t.startedAt ? Math.max(0, t.left - (now - t.startedAt)) : t.left);

// ---------- synthesized music (no audio files are bundled) ----------
let ac: AudioContext | null = null, master: GainNode | null = null; let stopFns: (() => void)[] = [];
function ctx() { if (!ac) { ac = new AudioContext(); master = ac.createGain(); master.connect(ac.destination); } if (ac.state === 'suspended') void ac.resume(); return ac; }
export function setVolume(v: number) { if (master) master.gain.value = v * 0.6; }
function tone(c: AudioContext, f: number, t: number, dur: number, type: OscillatorType, vol: number, dest: AudioNode) {
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function noise(c: AudioContext) { const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } const s = c.createBufferSource(); s.buffer = b; s.loop = true; return s; }
export function stopMusic() { stopFns.forEach(f => f()); stopFns = []; }
export function playMusic(track: string, volume: number) {
  stopMusic(); const c = ctx(); setVolume(volume); const out = master!;
  const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
  if (track === 'Acoustic ambient') { const sc = [60, 62, 64, 67, 69, 72, 74, 76]; const id = setInterval(() => { const n = sc[Math.floor(Math.random() * sc.length)]; tone(c, hz(n), c.currentTime, 2.2, 'triangle', 0.22, out); if (Math.random() < 0.3) tone(c, hz(n - 12), c.currentTime, 3, 'sine', 0.18, out); }, 650); stopFns.push(() => clearInterval(id)); }
  else if (track === 'Lo-fi chill') {
    const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]; let i = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(out);
    const play = () => { for (const n of chords[i++ % chords.length]) tone(c, hz(n), c.currentTime, 3.8, 'triangle', 0.1, lp); tone(c, hz(chords[(i - 1) % 4][0] - 12), c.currentTime, 1.2, 'sine', 0.25, lp); };
    play(); const id = setInterval(play, 3600); const n = noise(c), hp = c.createBiquadFilter(), g = c.createGain(); hp.type = 'highpass'; hp.frequency.value = 3000; g.gain.value = 0.015; n.connect(hp); hp.connect(g); g.connect(out); n.start(); stopFns.push(() => { clearInterval(id); n.stop(); });
  } else if (track === 'Focus drone') {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; const g = c.createGain(); g.gain.value = 0.16; lp.connect(g); g.connect(out);
    const os = [110, 110.6, 164.8].map(f => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); return o; });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 160; lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); stopFns.push(() => { os.forEach(o => o.stop()); lfo.stop(); });
  } else { const n = noise(c), bp = c.createBiquadFilter(), g = c.createGain(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.4; g.gain.value = 0.6; n.connect(bp); bp.connect(g); g.connect(out); n.start(); stopFns.push(() => n.stop()); }
}
function beep() { try { const c = ctx(); for (let i = 0; i < 3; i++) tone(c, 880, c.currentTime + i * 0.25, 0.2, 'sine', 0.3, master!); } catch { /* audio unavailable */ } }

// ---------- seven-segment display ----------
const SEG: Record<string, string> = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
const RECT: Record<string, [number, number, number, number]> = { a: [6, 0, 28, 6], b: [34, 6, 6, 28], c: [34, 38, 6, 28], d: [6, 66, 28, 6], e: [0, 38, 6, 28], f: [0, 6, 6, 28], g: [6, 33, 28, 6] };
export function SegDisplay({ text, big = true }: { text: string; big?: boolean }) {
  const w = 50; const h = 72;
  return (
    <svg viewBox={`-4 0 ${text.length * w + 4} ${h}`} height={big ? 78 : 22} role="img" aria-label={text} style={{ transform: 'skewX(-6deg)' }}>
      {[...text].map((ch, i) => ch === ':' ? <g key={i} transform={`translate(${i * w + 14} 0)`}><rect x="0" y="20" width="7" height="7" rx="1" fill="currentColor" /><rect x="0" y="46" width="7" height="7" rx="1" fill="currentColor" /></g> :
        <g key={i} transform={`translate(${i * w} 0)`}>{Object.entries(RECT).map(([k, [x, y, rw, rh]]) => <rect key={k} x={x} y={y} width={rw} height={rh} rx="2" fill="currentColor" opacity={SEG[ch]?.includes(k) ? 1 : 0.1} />)}</g>)}
    </svg>
  );
}
export const fmt = (ms: number) => { const s = Math.ceil(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

// ---------- top-bar chip + panel ----------
function useNow(active: boolean) { const [n, setN] = useState(Date.now()); useEffect(() => { if (!active) return; const t = setInterval(() => setN(Date.now()), 200); return () => clearInterval(t); }, [active]); return n; }
export function useTimerTick() {
  const t = useTmv(); const now = useNow(!!t.startedAt);
  useEffect(() => { if (t.startedAt && remaining(t, now) <= 0) { useTmv.setState({ startedAt: null, left: 0 }); beep(); useEditor.getState().toast('Time is up'); } }, [now, t.startedAt]);
  return remaining(t, now);
}
export function TmvChip({ open, onClick }: { open: boolean; onClick: () => void }) {
  const t = useTmv(); const left = useTimerTick(); 
  return (
    <button className={'jm-tmv' + (open ? ' on' : '')} aria-label="Timer, music and voting" title="Timer, music and voting" onClick={onClick}>
      <span className="jm-tmv-i" aria-hidden><svg width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#161616" /><circle cx="12" cy="12" r="4.500" fill="#a259ff" /><circle cx="12" cy="12" r="1" fill="#fff" /></svg><b>⭐</b></span><span className="jm-tmv-t"><SegDisplay text={fmt(left)} big={false} /></span>{t.playing && <span className="jm-eq" aria-hidden><i /><i /><i /></span>}
    </button>
  );
}
export function TmvPanel({ store, onClose }: { store: JamStore; onClose: () => void }) {
  const t = useTmv(); const left = useTimerTick(); const ui = useJam(); const v = store.board.voting;
  const total = Object.values(store.board.items).reduce((a, i) => a + voteTotal(i), 0);
  const running = !!t.startedAt;
  const toggleTimer = () => { if (running) useTmv.setState({ startedAt: null, left }); else useTmv.setState({ startedAt: Date.now(), left: left > 0 ? left : t.duration }); };
  const toggleMusic = () => { if (t.playing) { stopMusic(); useTmv.setState({ playing: false }); } else { playMusic(t.track, t.volume); useTmv.setState({ playing: true }); } };
  return (
    <div className="jam-panel right tmv" role="dialog" aria-label="Timer, music and voting" onPointerDown={e => e.stopPropagation()}>
      <div className="tmv-head"><h3>Timer, music, and voting</h3><button className="jm-b" aria-label="Close panel" onClick={onClose}><JIcon n="plus" size={18} /></button></div>
      <div className="tmv-sec vol"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.500v5h3.500L12 19V5L7.500 9.500z" /><path d="M15.500 9a4 4 0 010 6" /></svg><input type="range" min={0} max={1} step={0.01} value={t.volume} aria-label="Volume" onChange={e => { const x = Number(e.target.value); useTmv.setState({ volume: x }); setVolume(x); }} /></div>
      <div className="tmv-sec">
        <div className="tmv-card clock"><SegDisplay text={fmt(left)} /></div>
        <div className="tmv-row"><button className="btn" aria-label="Add one minute" onClick={() => useTmv.setState({ duration: t.duration + 60_000, left: running ? t.left + 60_000 : left + 60_000 })}>+ 1 min</button>
          <button className="btn" aria-label="Reset timer" onClick={() => useTmv.setState({ startedAt: null, left: t.duration })}>Reset</button><span className="spacer" />
          <button className="tmv-go" aria-label={running ? 'Pause timer' : 'Start timer'} onClick={toggleTimer}>{running ? <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> : <JIcon n="play" size={22} />}</button></div>
      </div>
      <div className="tmv-sec">
        <div className="tmv-card deck"><svg viewBox="0 0 220 110" width="100%" aria-hidden><g className={t.playing ? 'spin' : ''} style={{ transformOrigin: '62px 55px' }}><circle cx="62" cy="55" r="50" fill="#111" />{[44, 38, 32].map(r => <circle key={r} cx="62" cy="55" r={r} fill="none" stroke="#2c2c2c" strokeWidth="1" />)}<circle cx="62" cy="55" r="22" fill="#8a8a8a" /><path d="M56 62v-12l12-3v12" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><circle cx="54" cy="62" r="3" fill="#fff" /><circle cx="66" cy="59" r="3" fill="#fff" /></g>
          <path d={t.playing ? 'M128 8v48l-12 22' : 'M128 8v48l-6 30'} fill="none" stroke="#bbb" strokeWidth="5" strokeLinecap="round" style={{ transition: 'd .4s' }} /><g fill="#777">{Array.from({ length: 25 }).map((_, i) => <circle key={i} cx={165 + (i % 5) * 9} cy={32 + Math.floor(i / 5) * 9} r="2" />)}</g></svg></div>
        <div className="tmv-row"><Select className="jm-sel grow" aria-label="Music track" value={t.track} onChange={e => { useTmv.setState({ track: e.target.value }); if (t.playing) playMusic(e.target.value, t.volume); }}>{TRACKS.map(x => <option key={x}>{x}</option>)}</Select>
          <button className="tmv-go" aria-label={t.playing ? 'Pause music' : 'Play music'} onClick={toggleMusic}>{t.playing ? <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg> : <JIcon n="play" size={22} />}</button></div>
      </div>
      <div className="tmv-sec">
        <div className="tmv-card votes"><span className="note" /><span className="em e1">❤️</span><span className="em e2">+1</span><span className="em e3">👍</span></div>
        {v?.active ? <div className="tmv-row col"><span className="muted small">{v.perUser} votes each · {total} cast · Alt-click removes a vote</span><div className="tmv-row"><button className="btn" onClick={() => ui.set({ tool: 'vote', panel: null })}>Vote</button><button className="btn" onClick={() => store.change(b => { b.voting!.active = false; b.voting!.hidden = false; })}>End vote</button></div></div>
          : <div className="tmv-row center"><button className="btn primary" onClick={() => { store.change(b => { b.voting = { active: true, perUser: 3, hidden: b.voting?.hidden ?? false }; }); ui.set({ tool: 'vote', panel: null }); }}>New vote</button></div>}
      </div>
    </div>
  );
}
