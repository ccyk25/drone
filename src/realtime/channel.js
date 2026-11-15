// Realtime room channel. Owner: P1.
// Uses Supabase Realtime Broadcast when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
// (works across phones and laptops). Otherwise falls back to BroadcastChannel, which only
// works between tabs of the same browser on one machine, which is enough for solo testing.
import { createClient } from '@supabase/supabase-js';
import { channelName, validate } from '../shared/protocol.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const QUEUE_LIMIT = 20;

let client = null;
function getClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { params: { eventsPerSecond: 30 } } });
  }
  return client;
}

export const hasSupabase = () => Boolean(SUPABASE_URL && SUPABASE_KEY);

/**
 * joinRoom(room, { onMessage, onStatus }) → { send(msg), close(), status }
 * status: 'connecting' | 'live' | 'local' | 'error'
 */
export function joinRoom(room, { onMessage, onStatus } = {}) {
  const name = channelName(room);
  let status = 'connecting';
  const setStatus = (s) => { status = s; onStatus?.(s); };
  const deliver = (msg) => { if (validate(msg)) onMessage?.(msg); };

  const sb = getClient();
  if (!sb) {
    const bc = new BroadcastChannel(name);
    bc.onmessage = (e) => deliver(e.data);
    queueMicrotask(() => setStatus('local'));
    return {
      send(msg) { if (validate(msg)) bc.postMessage(msg); },
      close() { bc.close(); },
      get status() { return status; }
    };
  }

  const queue = [];
  const ch = sb.channel(name, { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => deliver(payload));
  ch.subscribe((s) => {
    if (s === 'SUBSCRIBED') {
      setStatus('live');
      while (queue.length) ch.send({ type: 'broadcast', event: 'msg', payload: queue.shift() });
    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
      setStatus('error');
    }
  });

  return {
    send(msg) {
      if (!validate(msg)) return;
      if (status === 'live') ch.send({ type: 'broadcast', event: 'msg', payload: msg });
      else if (queue.length < QUEUE_LIMIT) queue.push(msg);
    },
    close() { sb.removeChannel(ch); },
    get status() { return status; }
  };
}
