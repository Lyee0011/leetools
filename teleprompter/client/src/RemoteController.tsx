import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { remoteRequest, remoteError } from './lib/remote-api';
import type { RemoteAction, RemoteRoom, RemoteState, RemoteCommandResult } from '../../shared/remote';

export default function RemoteController({ onExit }: { onExit: () => void }) {
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<RemoteRoom | null>(null);
  const [state, setState] = useState<RemoteState | null>(null);
  const [message, setMessage] = useState('请在另一台手机进入提词，开启双机遥控');
  const [joining, setJoining] = useState(false);
  const [pressed, setPressed] = useState<RemoteAction | null>(null);
  const [pending, setPending] = useState(false);
  const stateRef = useRef<RemoteState | null>(null);
  const roomRef = useRef<RemoteRoom | null>(null);
  roomRef.current = room;
  const pendingRef = useRef<{ id: string; action: RemoteAction; sentAt: number } | null>(null);
  const lastSeen = useRef(0);
  const [fresh, setFresh] = useState(false);
  const [awake, setAwake] = useState(false);
  const [layout, setLayout] = useState<'vertical' | 'horizontal'>(() => {
    try { return localStorage.getItem('tici-remote-layout-v1') === 'horizontal' ? 'horizontal' : 'vertical'; } catch { return 'vertical'; }
  });
  const changeLayout = () => {
    const next = layout === 'vertical' ? 'horizontal' : 'vertical';
    setLayout(next);
    try { localStorage.setItem('tici-remote-layout-v1', next); } catch { /* Layout still works without storage. */ }
  };
  useEffect(() => () => { roomRef.current = null; }, []);
  const acceptState = (next: RemoteState) => {
    // A state poll started before the direct ACK must not undo its newer state.
    const confirmsPending = !!pendingRef.current && next.appliedId === pendingRef.current.id;
    if (!confirmsPending && stateRef.current && next.seenAt < stateRef.current.seenAt) return;
    stateRef.current = next;
    setState(next); setFresh(next.connected); lastSeen.current = Date.now();
    const current = pendingRef.current;
    if (current && next.appliedId === current.id) {
      setMessage(current.action === 'back' ? '已回退 5 秒 · 正在播放' : current.action === 'pause' ? '已暂停' : '已继续');
      pendingRef.current = null; setPending(false);
    } else if (current && Date.now() - current.sentAt > 5500) {
      pendingRef.current = null; setPending(false); setMessage('操作未确认，请查看提词手机状态后再按');
    } else if (!next.connected) setMessage('提词手机未连接 · 请保持提词页面在前台');
    else if (!current) setMessage(previous => previous.includes('已') ? previous : next.running ? '已连接 · 正在提词' : '已连接 · 已暂停');
  };

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (joining) return;
    setJoining(true);
    try {
      const next = await remoteRequest<RemoteRoom>(`${code.replace(/[\s-]/g, '').toUpperCase()}/join`);
      stateRef.current = null;
      setRoom(next); setState(null); setFresh(false); pendingRef.current = null; setPending(false); setMessage('正在连接提词手机…');
    } catch (e) { setMessage(remoteError(e)); }
    finally { setJoining(false); }
  }
  useEffect(() => {
    if (!room) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    const visible = () => document.visibilityState !== 'hidden';
    const poll = async () => {
      if (stopped || !visible()) return;
      const currentRequest = new AbortController(); request = currentRequest;
      const startedAt = Date.now();
      try {
        const next = await remoteRequest<RemoteState>(`${room.code}/state`, { token: room.token }, currentRequest.signal);
        if (stopped || !visible() || request !== currentRequest) return;
        acceptState(next);
      } catch (e) {
        if (!stopped && !currentRequest.signal.aborted && lastSeen.current <= startedAt) { setFresh(false); setMessage(remoteError(e)); }
        if (pendingRef.current && Date.now() - pendingRef.current.sentAt > 5500) { pendingRef.current = null; setPending(false); }
      }
      if (!stopped && visible() && request === currentRequest) timer = setTimeout(poll, pendingRef.current ? 80 : 200);
    };
    const visibility = () => {
      clearTimeout(timer); request?.abort(); setFresh(false);
      if (document.visibilityState !== 'hidden') void poll();
    };
    document.addEventListener('visibilitychange', visibility); void poll();
    const stale = setInterval(() => { if (Date.now() - lastSeen.current > 2200) setFresh(false); }, 300);
    return () => { stopped = true; clearTimeout(timer); clearInterval(stale); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [room]);
  useEffect(() => {
    if (!room) return;
    let stopped = false;
    let lock: { release(): Promise<void> } | undefined;
    const request = async () => {
      try {
        const wake = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(type: string, fn: () => void): void }> } }).wakeLock;
        if (!wake || document.visibilityState === 'hidden') return;
        const next = await wake.request('screen');
        if (stopped) { await next.release(); return; }
        lock = next; setAwake(true); next.addEventListener('release', () => setAwake(false));
      } catch { setAwake(false); }
    };
    const visibility = () => { if (document.visibilityState !== 'hidden') void request(); };
    document.addEventListener('visibilitychange', visibility); void request();
    return () => { stopped = true; document.removeEventListener('visibilitychange', visibility); void lock?.release(); };
  }, [room]);
  async function send(action: RemoteAction) {
    if (!room || !fresh || !state?.connected || pendingRef.current || Date.now() - lastSeen.current > 2200) return;
    const id = globalThis.crypto?.randomUUID?.() || `press-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingRef.current = { id, action, sentAt: Date.now() }; setPending(true); setPressed(action); setMessage('等待提词手机确认…');
    window.setTimeout(() => setPressed(null), 220);
    try {
      const result = await remoteRequest<RemoteCommandResult>(`${room.code}/command`, { token: room.token, id, action, waitForAck: true });
      if (roomRef.current === room && document.visibilityState !== 'hidden' && pendingRef.current?.id === id && result.id === id && result.state?.appliedId === id) acceptState(result.state);
    } catch (e) {
      // A background state poll may already have confirmed this very request.
      if (roomRef.current === room && pendingRef.current?.id === id) setMessage(`${remoteError(e)}；正在核对操作结果`);
      /* Do not retry a possibly delivered press. Poll for its ACK. */
    }
  }
  const press = (event: PointerEvent<HTMLButtonElement>, action: RemoteAction) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); void send(action);
  };
  const active = fresh && !!state?.connected && !pending;
  const playAction = () => stateRef.current?.running ? 'pause' : 'resume';
  return (
    <main className={`remote-screen${room ? ' is-paired' : ''}`}>
      <header className="remote-header"><button onClick={onExit}>‹ 回到文稿</button><span>双机遥控</span>{room && <button onClick={() => { setRoom(null); setFresh(false); }}>重新配对</button>}</header>
      {!room ? <form className="remote-pair-card" onSubmit={join}>
        <h1>让这台手机当遥控器</h1><p>另一台手机：开始提词 → 开启双机遥控。<br />输入那台手机显示的 2 位数字。</p>
        <label htmlFor="remote-code">配对码</label><input id="remote-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" pattern="[0-9]{2}" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={2} placeholder="例如 08" />
        <button type="submit" disabled={joining || code.length !== 2}>{joining ? '连接中…' : '连接提词手机'}</button>
        <p role="status">{message}</p>
      </form> : <>
        <div className="remote-connection"><span>{fresh && state?.connected ? '● 已连接' : '○ 未连接'} · {Math.round(state?.progress || 0)}%</span><button className="remote-layout" onClick={changeLayout} aria-label="切换按钮布局">{layout === 'vertical' ? '上下分块 ⇅' : '左右分块 ⇄'}</button><span>{awake ? '屏幕常亮中' : '请保持屏幕亮着'}</span>
        </div>
        <div className={`remote-pads ${layout}`}>
          <button className={`remote-pad back${pressed === 'back' ? ' is-pressed' : ''}`} disabled={!active} onPointerDown={e => press(e, 'back')} onClick={e => { if (e.detail === 0) void send('back'); }} onContextMenu={e => e.preventDefault()}><b>↶</b><strong>回退 5 秒</strong><span>回退后直接播放</span></button>
          <button className={`remote-pad play${pressed === 'pause' || pressed === 'resume' ? ' is-pressed' : ''}`} disabled={!active} onPointerDown={e => press(e, playAction())} onClick={e => { if (e.detail === 0) void send(playAction()); }} onContextMenu={e => e.preventDefault()}><b>{state?.running ? 'Ⅱ' : '▶'}</b><strong>{state?.running ? '暂停' : '继续'}</strong><span>{layout === 'vertical' ? '下方' : '右边'} · 暂停 / 继续</span></button>
        </div>
        <div className="remote-result" role="status" aria-live="polite">{message}</div>
      </>}
    </main>
  );
}
