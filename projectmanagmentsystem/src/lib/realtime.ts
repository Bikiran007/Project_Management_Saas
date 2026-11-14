import { subscribe } from './db';
import { useApp } from '@/store/app';
import { randomToken } from './crypto';

/**
 * Wires the in-browser "socket" into the UI store:
 *  - every DB change (local or from another tab) bumps the store version → live re-render
 *  - remote events for the current workspace show a "live" toast
 *  - a presence heartbeat shows who is online right now
 */
export function startRealtime() {
  subscribe((e) => {
    const st = useApp.getState();
    st.bump();
    const session = useApp.getState().session;
    if (e.remote && e.message && session && e.workspaceId === session.ctx.workspaceId && e.actorId !== session.ctx.userId) {
      st.toast(e.message, 'live');
    }
  });

  if (typeof BroadcastChannel === 'undefined') return;
  const tabId = randomToken(6);
  const ch = new BroadcastChannel('taskforge-presence');
  const seen = new Map<string, { userId: string; workspaceId: string; at: number }>();

  const beat = () => {
    const s = useApp.getState().session;
    if (s) {
      const msg = { tabId, userId: s.ctx.userId, workspaceId: s.ctx.workspaceId, at: Date.now() };
      seen.set(tabId, msg);
      ch.postMessage(msg);
    } else seen.delete(tabId);
    recompute();
  };

  const recompute = () => {
    const s = useApp.getState().session;
    const now = Date.now();
    for (const [k, v] of seen) if (now - v.at > 9000) seen.delete(k);
    const ids = s ? [...new Set([...seen.values()].filter((v) => v.workspaceId === s.ctx.workspaceId).map((v) => v.userId))] : [];
    const prev = useApp.getState().online;
    if (ids.length !== prev.length || ids.some((x) => !prev.includes(x))) useApp.getState().setOnline(ids);
  };

  ch.onmessage = (m) => {
    seen.set(m.data.tabId, m.data);
    recompute();
  };
  beat();
  setInterval(beat, 3000);
  useApp.subscribe((s, p) => {
    if (s.session?.ctx.workspaceId !== p.session?.ctx.workspaceId || s.session?.ctx.userId !== p.session?.ctx.userId) beat();
  });
}
