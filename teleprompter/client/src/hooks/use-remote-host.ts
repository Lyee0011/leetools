import { useEffect, useRef, useState } from 'react';
import { remoteError, remoteRequest } from '../lib/remote-api';
import { REMOTE_COMMAND_LIFETIME, type RemoteRoom, type RemotePollResult, type RemoteAction } from '../../../shared/remote';

export function useRemoteHost(enabled: boolean, running: boolean, progress: number, apply: (action: RemoteAction) => void) {
  const [room, setRoom] = useState<RemoteRoom | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef({ enabled, running, progress, apply });
  live.current = { enabled, running, progress, apply };
  const applied = useRef('');
  const handled = useRef(new Set<string>());
  const opening = useRef(false);
  async function open() {
    if (opening.current) return;
    opening.current = true; setBusy(true); setError('');
    try {
      const next = await remoteRequest<RemoteRoom>('create');
      applied.current = ''; handled.current.clear(); setRoom(next);
    } catch (e) { setError(remoteError(e)); }
    finally { opening.current = false; setBusy(false); }
  }
  async function close() {
    if (!room) return;
    const previous = room;
    setRoom(null); setError('');
    try { await remoteRequest(`${previous.code}/close`, { token: previous.token }); } catch { /* Host stops polling immediately; pending commands expire. */ }
  }
  useEffect(() => {
    if (!room || !enabled) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, request: AbortController | undefined;
    let generation = globalThis.crypto?.randomUUID?.() || `host-${Date.now()}`;
    let fallbackUntil = 0;
    const visible = () => document.visibilityState !== 'hidden';
    const poll = async () => {
      if (stopped || !visible()) return;
      const currentRequest = new AbortController(); request = currentRequest;
      const startedAt = Date.now();
      let appliedCommand = false;
      const wait = Date.now() >= fallbackUntil;
      let nextDelay = 150;
      try {
        const result = await remoteRequest<RemotePollResult>(`${room.code}/poll`, { token: room.token, running: live.current.running, progress: live.current.progress, appliedId: applied.current, generation, wait }, currentRequest.signal);
        if (stopped || !visible() || request !== currentRequest || !live.current.enabled) return;
        setError('');
        if (wait && result.waitSupported) nextDelay = 0;
        const command = result.command;
        if (command && result.serverNow - command.createdAt + (Date.now() - startedAt) < REMOTE_COMMAND_LIFETIME && !handled.current.has(command.id)) {
          handled.current.add(command.id);
          live.current.apply(command.action);
          // React may defer a render beyond the immediate ACK. Publish the
          // explicit action now so the controller's next press uses the new state.
          live.current.running = command.action !== 'pause';
          applied.current = command.id;
          appliedCommand = true;
        }
      } catch (e) {
        if (!stopped && !currentRequest.signal.aborted) { setError(remoteError(e)); fallbackUntil = Date.now() + 15000; }
        nextDelay = 500;
      }
      // ACK on the next turn, without another idle wait.
      if (!stopped && visible() && request === currentRequest) timer = setTimeout(poll, appliedCommand ? 0 : nextDelay);
    };
    const visibility = () => {
      clearTimeout(timer); request?.abort();
      if (visible()) { generation = globalThis.crypto?.randomUUID?.() || `host-${Date.now()}`; void poll(); }
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); request?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [room, enabled]);
  return { room, error, busy, open, close };
}
