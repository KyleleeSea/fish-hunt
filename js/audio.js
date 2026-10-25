// Tiny WebAudio synth for underwater game cues.
let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, dur, { type = 'sine', vol = 0.18, slide = null, delay = 0 } = {}) {
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t0 = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch { /* no audio */ }
}
function noise(dur, vol = 0.1, freq = 800) {
  try {
    const c = ac();
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  } catch {}
}
export const sfx = {
  unlock() { try { ac(); } catch {} },
  bubble() { tone(300, 0.12, { slide: 900, vol: 0.08 }); },
  whistle() { tone(520, 0.35, { slide: 880, vol: 0.14 }); tone(880, 0.25, { delay: 0.3, slide: 1200, vol: 0.12 }); },
  tick() { tone(1000, 0.06, { type: 'square', vol: 0.05 }); },
  found() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, { delay: i * 0.11, vol: 0.16 })); },
  win() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.3, { delay: i * 0.13, vol: 0.16 })); },
  miss() { tone(160, 0.14, { type: 'square', vol: 0.08, slide: 90 }); },
  thump() { tone(70, 0.16, { vol: 0.25, slide: 45 }); },
  shoot() { noise(0.08, 0.12, 1800); tone(900, 0.08, { type: 'triangle', slide: 300, vol: 0.1 }); },
  hit() { tone(1400, 0.07, { type: 'square', vol: 0.07, slide: 1000 }); },
  hurt() { noise(0.2, 0.2, 500); tone(120, 0.25, { type: 'sawtooth', slide: 60, vol: 0.12 }); },
  chomp() { noise(0.25, 0.3, 400); tone(90, 0.3, { slide: 40, vol: 0.3 }); },
  sharkDie() { tone(220, 0.4, { type: 'sawtooth', slide: 60, vol: 0.12 }); noise(0.3, 0.15, 600); },
  ink() { tone(240, 0.3, { slide: 120, vol: 0.12 }); noise(0.3, 0.1, 300); },
  roar() { tone(60, 0.5, { type: 'sawtooth', slide: 40, vol: 0.12 }); },
};
