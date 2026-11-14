import { useEffect, useMemo, useRef, useState } from 'react';
import { useJam } from './store';
import { storage } from '../editor/state';
import { EMOJI_FONT } from './render';

// ---------- emoji data (emoji + searchable name) ----------
const parse = (s: string) => s.trim().split('\n').map(l => { const [e, ...n] = l.trim().split(' '); return { e, n: n.join(' ') }; });
export const CATS: { id: string; label: string; icon: string; items: { e: string; n: string }[] }[] = [
  { id: 'smileys', label: 'Smileys & People', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8.500 14a4.500 4.500 0 007 0M9 9.500h.01M15 9.500h.01', items: parse(`
😀 grinning happy
😃 smile open
😄 smile eyes
😁 beaming grin
😆 laughing squint
😅 sweat smile
🤣 rofl rolling laughing
😂 joy tears laughing
🙂 slight smile
🙃 upside down
😉 wink
😊 blush smiling
😇 angel halo
🥰 love hearts face
😍 heart eyes love
🤩 star struck wow
😘 kiss blow
😋 yum tasty
😛 tongue
😜 wink tongue
🤪 zany crazy
🤑 money mouth
🤗 hug
🤭 giggle hand over mouth
🤫 shush quiet
🤔 thinking hmm
😐 neutral
😑 expressionless
😶 no mouth
😏 smirk
😒 unamused
🙄 eye roll
😬 grimace
😌 relieved
😔 pensive sad
😴 sleeping zzz
😷 mask sick
🤒 thermometer sick
🤯 mind blown exploding
🥳 party celebrate
😎 cool sunglasses
🤓 nerd
😕 confused
😟 worried
😮 surprised open mouth
😲 astonished
😳 flushed
🥺 pleading
😢 cry sad tear
😭 sob crying
😱 scream fear
😖 confounded
😞 disappointed
😓 downcast sweat
😩 weary
😡 angry rage
🤬 cursing swearing
💀 skull dead
💩 poop
👻 ghost
👽 alien
🤖 robot
👍 thumbs up like yes
👎 thumbs down dislike no
👌 ok hand perfect
✌️ victory peace
🤞 crossed fingers luck
🤟 love you gesture
🤘 rock on horns
👈 point left
👉 point right
👆 point up
👇 point down
☝️ index up
✋ raised hand stop
👋 wave hello
🤙 call me
💪 muscle strong flex
🙏 pray thanks please
👏 clap applause
🙌 raised hands celebrate
🤝 handshake deal
✍️ writing
👀 eyes look
🧠 brain
`) },
  { id: 'nature', label: 'Animals & Nature', icon: 'M5 19c0-8 5-14 14-14 0 9-6 14-14 14zM5 19l7-7', items: parse(`
🐶 dog
🐱 cat
🐭 mouse
🐹 hamster
🐰 rabbit
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger
🦁 lion
🐮 cow
🐷 pig
🐸 frog
🐵 monkey
🐔 chicken
🐧 penguin
🐦 bird
🦆 duck
🦉 owl
🦄 unicorn
🐝 bee
🐛 bug caterpillar
🦋 butterfly
🐢 turtle
🐍 snake
🐙 octopus
🐬 dolphin
🐳 whale
🦈 shark
🌸 cherry blossom
🌹 rose
🌻 sunflower
🌲 tree evergreen
🌴 palm tree
🌿 herb leaf
🍀 clover luck
🌈 rainbow
☀️ sun
🌙 moon
⭐ star
⚡ lightning bolt
🔥 fire hot
💧 droplet water
❄️ snowflake
`) },
  { id: 'food', label: 'Food & Drink', icon: 'M12 8c-4-2-7 1-6 6s3 7 6 6c3 1 5-1 6-6s-2-8-6-6zM12 8c0-2 1-3 3-4', items: parse(`
🍎 apple
🍐 pear
🍊 orange
🍋 lemon
🍌 banana
🍉 watermelon
🍇 grapes
🍓 strawberry
🍒 cherries
🍑 peach
🥭 mango
🍍 pineapple
🥑 avocado
🍅 tomato
🥕 carrot
🌽 corn
🍞 bread
🧀 cheese
🥚 egg
🥓 bacon
🍔 burger
🍟 fries
🍕 pizza
🌭 hot dog
🌮 taco
🍣 sushi
🍜 ramen noodles
🍩 donut
🍪 cookie
🎂 birthday cake
🍫 chocolate
🍿 popcorn
☕ coffee
🍵 tea
🍺 beer
🍷 wine
🥂 cheers champagne
`) },
  { id: 'activity', label: 'Activities', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18', items: parse(`
⚽ soccer football
🏀 basketball
🏈 american football
⚾ baseball
🎾 tennis
🏐 volleyball
🏓 ping pong
🥊 boxing
🎯 target bullseye
🎳 bowling
🎮 video game
🎲 dice
🧩 puzzle
🎨 art palette
🎬 clapper movie
🎤 microphone
🎧 headphones
🎸 guitar
🎹 piano
🥁 drum
🏆 trophy winner
🥇 gold medal first
🎉 party popper tada
🎊 confetti
🎁 gift present
`) },
  { id: 'travel', label: 'Travel & Places', icon: 'M3 13l2-5h14l2 5v5H3zM7 18v2M17 18v2M6 13h12', items: parse(`
🚗 car
🚕 taxi
🚌 bus
🚓 police car
🚑 ambulance
🚒 fire truck
🚲 bike bicycle
🛵 scooter
🚂 train
✈️ airplane plane
🚀 rocket launch
🛸 ufo
🚢 ship
⚓ anchor
🏠 house home
🏢 office building
🏥 hospital
🏫 school
🏰 castle
🗽 statue of liberty
🗼 tower
🌍 earth globe
🏖️ beach
🏔️ mountain
🌋 volcano
⛺ camping tent
🌃 night city
`) },
  { id: 'objects', label: 'Objects', icon: 'M9 5l6 6-9 9H3v-3zM15 11l3-3', items: parse(`
⌚ watch
📱 phone mobile
💻 laptop computer
⌨️ keyboard
🖥️ desktop
🖨️ printer
📷 camera
🔋 battery
💡 light bulb idea
🔦 flashlight
💰 money bag
💳 credit card
💎 gem diamond
🔧 wrench tool
🔨 hammer
⚙️ gear settings
🔒 lock
🔑 key
📌 pushpin
📎 paperclip
✂️ scissors
📏 ruler
📝 memo note
📚 books
📖 open book
📅 calendar
📈 chart up growth
📉 chart down
📊 bar chart
📧 email
📦 package box
🏷️ label tag
🔔 bell
📣 megaphone
🔍 magnifier search
`) },
  { id: 'symbols', label: 'Symbols', icon: 'M12 20s-7-4.500-7-10a4 4 0 017-2.500A4 4 0 0119 10c0 5.500-7 10-7 10z', items: parse(`
❤️ red heart love
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
💔 broken heart
💯 hundred
✅ check mark done
❌ cross wrong
❓ question
❗ exclamation
➕ plus add
➖ minus
➡️ right arrow
⬅️ left arrow
⬆️ up arrow
⬇️ down arrow
🔄 refresh
⚠️ warning
🚫 prohibited
🆗 ok
🆕 new
💬 speech bubble
💭 thought bubble
🔴 red circle
🟠 orange circle
🟡 yellow circle
🟢 green circle
🔵 blue circle
🟣 purple circle
`) },
  { id: 'flags', label: 'Flags', icon: 'M5 21V4M5 5h13l-2 4 2 4H5', items: parse(`
🏁 chequered flag finish
🚩 red flag
🏳️ white flag
🏴 black flag
🏳️‍🌈 rainbow flag pride
🇺🇸 united states
🇬🇧 united kingdom
🇨🇦 canada
🇮🇳 india
🇩🇪 germany
🇫🇷 france
🇯🇵 japan
🇧🇷 brazil
🇦🇺 australia
`) },
];
const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const TONE_DOT = ['#f6c244', '#f7d7b5', '#e8b78c', '#c68b5e', '#9a6a45', '#5c3d2a'];
const TONEABLE = new Set(['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👈', '👉', '👆', '👇', '☝️', '✋', '👋', '🤙', '💪', '🙏', '👏', '🙌', '✍️']);
export const withTone = (e: string, tone: number) => (tone && TONEABLE.has(e) ? e.replace(/️/g, '') + TONES[tone] : e);

export function recentStamps(): string[] { try { const r = JSON.parse(storage.get('layr:jam:recent', '[]')); return Array.isArray(r) ? r.filter((x: unknown) => typeof x === 'string').slice(0, 12) : []; } catch { return []; } }
function remember(e: string) { storage.set('layr:jam:recent', JSON.stringify([e, ...recentStamps().filter(x => x !== e)].slice(0, 12))); }

// ---------- the wheel ----------
const SECTORS: { id: string; label: string; stamp: string }[] = [
  { id: 'heart', label: 'heart', stamp: '❤️' }, { id: 'up', label: 'thumbs up', stamp: '👍' }, { id: 'plus1', label: 'plus one', stamp: '+1' }, { id: 'star', label: 'star', stamp: '⭐' },
  { id: 'q', label: 'question', stamp: '?' }, { id: 'down', label: 'thumbs down', stamp: '👎' }, { id: 'dot', label: 'red sticker', stamp: '●' }, { id: 'me', label: 'me', stamp: '@' },
];
const R_IN = 60, R_OUT = 112, C = 120;
const pt = (r: number, a: number) => [C + r * Math.cos((a * Math.PI) / 180), C + r * Math.sin((a * Math.PI) / 180)];
function sectorPath(center: number) {
  const g = 2.2, a0 = center - 22.5 + g, a1 = center + 22.5 - g; const [x0, y0] = pt(R_OUT, a0), [x1, y1] = pt(R_OUT, a1), [x2, y2] = pt(R_IN, a1), [x3, y3] = pt(R_IN, a0);
  return `M${x0} ${y0} A${R_OUT} ${R_OUT} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${R_IN} ${R_IN} 0 0 0 ${x3} ${y3}Z`;
}
export function Sticker({ stamp, name, size = 40 }: { stamp: string; name?: string; size?: number }) {
  const o = 'drop-shadow(1.5px 0 0 #fff) drop-shadow(-1.5px 0 0 #fff) drop-shadow(0 1.5px 0 #fff) drop-shadow(0 -1.5px 0 #fff) drop-shadow(0 2px 3px rgba(0,0,0,.25))';
  if (stamp === '+1') return <span style={{ fontWeight: 900, fontSize: size * 0.9, fontStyle: 'italic', color: '#7c4dff', filter: o, transform: 'rotate(-6deg)', display: 'block', lineHeight: 1 }}>+1</span>;
  if (stamp === '?') return <span style={{ fontWeight: 900, fontSize: size * 1.1, color: '#e5502d', filter: o, display: 'block', lineHeight: 1 }}>?</span>;
  if (stamp === '●') return <svg width={size} height={size} viewBox="0 0 40 40" style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.25))' }}><circle cx="20" cy="20" r="17" fill="#e5502d" stroke="#fff" strokeWidth="3" /><path d="M26 4c0 8 4 12 11 12-4 6-10 6-14 2s-1-10 3-14z" fill="#fff" opacity=".9" /></svg>;
  if (stamp.startsWith('@')) return <span style={{ width: size, height: size, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size * 0.5, border: '3px solid #fff', boxShadow: '0 2px 5px rgba(0,0,0,.3)', boxSizing: 'border-box' }}>{name?.[0]?.toUpperCase() ?? stamp.slice(1)}</span>;
  return <span style={{ fontSize: size * 0.9, lineHeight: 1, filter: o, display: 'block', fontFamily: EMOJI_FONT }}>{stamp}</span>;
}

export function StampWheel({ onPick }: { onPick: () => void }) {
  const ui = useJam(); const [picker, setPicker] = useState(false); const [recent, setRecent] = useState(recentStamps());
  const choose = (stamp: string) => { if (stamp !== '+1' && stamp !== '?' && stamp !== '●' && !stamp.startsWith('@')) { remember(stamp); setRecent(recentStamps()); } ui.set({ stamp: stamp === '@' ? '@' + (ui.me.name[0]?.toUpperCase() ?? '?') : stamp, tool: 'stamp' }); onPick(); };
  const hub = (recent.length ? recent : ['😂', '🙏', '👌', '🔥', '👀']).slice(0, 5);
  const hubPos = [[-20, -20], [14, -26], [-30, 8], [22, 6], [-4, 26]];
  return (
    <div className="stamp-wheel" onPointerDown={e => e.stopPropagation()} role="toolbar" aria-label="Stamps">
      <svg viewBox="0 0 240 240" width="240" height="240" aria-hidden="true"><circle cx={C} cy={C} r="118" className="sw-disc" />{SECTORS.map((s, i) => <path key={s.id} d={sectorPath(-135 + i * 45)} className={'sw-sec' + (ui.stamp === s.stamp || (s.id === 'me' && ui.stamp.startsWith('@')) ? ' on' : '')} />)}<circle cx={C} cy={C} r="54" className="sw-hubring" /><circle cx={C} cy={C} r="48" className="sw-hub" /></svg>
      {SECTORS.map((s, i) => { const [x, y] = pt(86, -135 + i * 45); return <button key={s.id} className="sw-btn" style={{ left: x - 24, top: y - 24 }} aria-label={`Stamp ${s.label}`} title={s.label} onClick={() => choose(s.stamp)}><Sticker stamp={s.stamp} name={ui.me.name} size={38} /></button>; })}
      <div className="sw-hubwrap">{hub.map((e, i) => <span key={e + i} className="sw-rec" style={{ left: 48 + hubPos[i][0] - 12, top: 48 + hubPos[i][1] - 12, fontFamily: EMOJI_FONT }}>{e}</span>)}</div>
      <button className="sw-plus" aria-label="More emoji" title="More emoji" onClick={() => setPicker(p => !p)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></button>
      {picker && <EmojiPicker onPick={e => { choose(e); setPicker(false); }} recent={recent} />}
    </div>
  );
}

export function EmojiPicker({ onPick, recent }: { onPick: (e: string) => void; recent: string[] }) {
  const [q, setQ] = useState(''); const [tone, setTone] = useState(0); const [toneMenu, setToneMenu] = useState(false); const [cat, setCat] = useState('recent'); const body = useRef<HTMLDivElement>(null);
  const tabs = [{ id: 'recent', label: 'Frequently used', icon: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z' }, ...CATS];
  const sections = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t) { const hits = CATS.flatMap(c => c.items).filter(i => i.n.includes(t) || i.e === t); return [{ id: 'search', label: hits.length ? 'Results' : 'No emoji found', items: hits }]; }
    return [{ id: 'recent', label: 'Frequently used', items: (recent.length ? recent : ['➕', '👍', '👎', '👀', '😍', '😂', '🔥', '😀', '😅']).map(e => ({ e, n: '' })) }, ...CATS];
  }, [q, recent]);
  useEffect(() => { if (!q) body.current?.querySelector(`[data-sec="${cat}"]`)?.scrollIntoView({ block: 'start' }); }, [cat]);
  return (
    <div className="emoji-pop" role="dialog" aria-label="Emoji picker">
      <div className="ep-tabs">{tabs.map(t => <button key={t.id} className={'ep-tab' + (cat === t.id && !q ? ' on' : '')} aria-label={t.label} title={t.label} onClick={() => { setQ(''); setCat(t.id); }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.500" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg></button>)}</div>
      <label className="ep-search"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round"><circle cx="11" cy="11" r="6.500" /><path d="M16 16l4 4" /></svg><input autoFocus placeholder="Search" aria-label="Search emoji" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.stopPropagation()} /></label>
      <div className="ep-body" ref={body}>{sections.map(s => <section key={s.id} data-sec={s.id}><h5>{s.label}</h5><div className="ep-grid">{s.items.map((i, k) => { const e = withTone(i.e, tone); return <button key={s.id + k} className="ep-e" aria-label={`Emoji ${i.n || i.e}`} title={i.n} onClick={() => onPick(e)}>{e}</button>; })}</div></section>)}</div>
      <div className="ep-foot"><span className="ep-hand">{withTone('☝️', tone)}</span><span className="spacer" /><button className="ep-tone" aria-label="Skin tone" title="Skin tone" style={{ background: TONE_DOT[tone] }} onClick={() => setToneMenu(m => !m)} />
        {toneMenu && <div className="ep-tones">{TONE_DOT.map((c, i) => <button key={c} aria-label={`Skin tone ${i + 1}`} style={{ background: c }} className={i === tone ? 'on' : ''} onClick={() => { setTone(i); setToneMenu(false); }} />)}</div>}</div>
    </div>
  );
}
