// Peer-to-peer transport over WebRTC using PeerJS (signaling via the public PeerJS cloud).
// The host runs GameHost locally; the guest sends to the host over a data channel.
import { GameHost } from './host.js';

const PREFIX = 'fish-hunt-v1-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

function makePeer(id) {
  // eslint-disable-next-line no-undef
  return new Peer(id, { debug: 1 });
}

export class P2P {
  /**
   * @param {{ onMessage:(msg:object)=>void, onStatus:(text:string, kind?:string)=>void }} h
   */
  constructor(h) {
    this.h = h;
    this.peer = null;
    this.conn = null;      // guest: connection to host
    this.gameHost = null;  // host only
    this.isHost = false;
    this.code = null;
  }

  /** Become the host of room `code`. Resolves when the room is registered. */
  host(code, hostOpts = {}) {
    this.isHost = true;
    this.code = code;
    return new Promise((resolve, reject) => {
      this.peer = makePeer(PREFIX + code);
      this.peer.on('open', () => {
        this.gameHost = new GameHost((key, msg) => this.deliver(key, msg), hostOpts);
        this.conns = new Map();
        this.gameHost.addPlayer('local');
        resolve(code);
      });
      this.peer.on('connection', (conn) => {
        const key = conn.peer;
        conn.on('open', () => {
          this.conns.set(key, conn);
          const p = this.gameHost.addPlayer(key);
          if (!p) setTimeout(() => conn.close(), 500);
        });
        conn.on('data', (data) => this.gameHost.handle(key, data));
        const gone = () => {
          if (!this.conns.has(key)) return;
          this.conns.delete(key);
          this.gameHost.removePlayer(key);
          this.h.onStatus('The other squirrel left. Waiting for a new one…');
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      this.peer.on('error', (err) => {
        if (err.type === 'unavailable-id') reject(new Error('That room code is taken — try again.'));
        else reject(new Error(describe(err)));
      });
      this.peer.on('disconnected', () => { try { this.peer.reconnect(); } catch {} });
    });
  }

  /** Join the room `code` as a guest. Resolves once the data channel is open. */
  join(code) {
    this.isHost = false;
    this.code = code;
    return new Promise((resolve, reject) => {
      this.peer = makePeer(undefined);
      let settled = false;
      this.peer.on('open', () => {
        const conn = this.peer.connect(PREFIX + code, { reliable: true });
        this.conn = conn;
        const timeout = setTimeout(() => { if (!settled) { settled = true; reject(new Error('No host found for that code. Check it and try again.')); } }, 12000);
        conn.on('open', () => { clearTimeout(timeout); settled = true; resolve(); });
        conn.on('data', (data) => this.h.onMessage(data));
        conn.on('close', () => this.h.onStatus('The host left the yard. Refresh to start a new game.', 'closed'));
        conn.on('error', () => this.h.onStatus('Connection lost.', 'closed'));
      });
      this.peer.on('error', (err) => {
        if (settled) { this.h.onStatus(describe(err), 'closed'); return; }
        settled = true;
        if (err.type === 'peer-unavailable') reject(new Error('No game with that code. Is the host still in the lobby?'));
        else reject(new Error(describe(err)));
      });
    });
  }

  /** Player -> host. */
  send(msg) {
    if (this.isHost) this.gameHost?.handle('local', msg);
    else if (this.conn?.open) this.conn.send(msg);
  }

  /** Host -> a player (local loopback or guest channel). */
  deliver(key, msg) {
    if (key === 'local') this.h.onMessage(msg);
    else {
      const c = this.conns.get(key);
      if (c?.open) c.send(msg);
    }
  }
}

function describe(err) {
  switch (err?.type) {
    case 'network': return 'Could not reach the signaling server. Check your connection.';
    case 'browser-incompatible': return 'This browser does not support WebRTC.';
    default: return `Connection error: ${err?.type || err?.message || err}`;
  }
}
