// Синтез звуков на WebAudio: без файлов. Выстрелы у каждого оружия свои, есть эхо арены,
// перезарядка по фазам, шаги, свист пуль, звуки попаданий и серий убийств.
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

// параметры выстрела: [lowpass Гц, длина шума, громкость шума, частота баса от→до, длина баса, громкость баса, треск, эхо]
const SHOT = [
  { lp: 3400, nd: 0.20, ng: 0.55, f0: 150, f1: 45, bd: 0.14, bg: 0.50, crack: 0.25, echo: 0.30 },  // автомат
  { lp: 4300, nd: 0.12, ng: 0.50, f0: 210, f1: 70, bd: 0.09, bg: 0.40, crack: 0.30, echo: 0.22 },  // пистолет
  { lp: 1900, nd: 0.46, ng: 0.95, f0: 115, f1: 32, bd: 0.28, bg: 0.75, crack: 0.12, echo: 0.42 },  // дробовик
  { lp: 5200, nd: 0.09, ng: 0.42, f0: 240, f1: 90, bd: 0.07, bg: 0.32, crack: 0.30, echo: 0.20 },  // ПП
  { lp: 2500, nd: 0.70, ng: 0.90, f0: 95, f1: 26, bd: 0.40, bg: 0.80, crack: 0.45, echo: 0.62 },   // снайперка
  { lp: 4000, nd: 0.16, ng: 0.50, f0: 170, f1: 55, bd: 0.11, bg: 0.45, crack: 0.30, echo: 0.26 },  // карабин
  { lp: 2800, nd: 0.26, ng: 0.65, f0: 130, f1: 38, bd: 0.18, bg: 0.62, crack: 0.22, echo: 0.36 },  // пулемёт
  { lp: 3000, nd: 0.30, ng: 0.80, f0: 120, f1: 40, bd: 0.22, bg: 0.70, crack: 0.40, echo: 0.45 },  // револьвер
  { lp: 3000, nd: 0.45, ng: 0.80, f0: 105, f1: 32, bd: 0.28, bg: 0.70, crack: 0.40, echo: 0.50 },  // марксманка
  { lp: 2000, nd: 0.36, ng: 0.85, f0: 120, f1: 34, bd: 0.22, bg: 0.70, crack: 0.14, echo: 0.38 },  // боевой дробовик
];

export function createAudio() {
  let ctx = null, noise = null, master = null, wet = null;
  const A = { ready: false };

  A.init = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.9;
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 6;
        master.connect(comp); comp.connect(ctx.destination);
        // шумовой буфер
        noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        // эхо арены: затухающий шумовой импульс
        if (ctx.createConvolver) {
          const len = Math.floor(ctx.sampleRate * 1.1);
          const imp = ctx.createBuffer(2, len, ctx.sampleRate);
          for (let ch = 0; ch < 2; ch++) {
            const dd = imp.getChannelData(ch);
            for (let i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
          }
          const conv = ctx.createConvolver();
          conv.buffer = imp;
          wet = ctx.createGain();
          wet.gain.value = 1;
          wet.connect(conv); conv.connect(master);
        }
      }
      if (ctx.state === 'suspended') ctx.resume();
      A.ready = true;
    } catch { ctx = null; A.ready = false; }
  };

  function bus(pan, echo = 0) {
    const g = ctx.createGain();
    let head = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clampN(pan, -1, 1);
      g.connect(p); head = p;
    }
    head.connect(master);
    if (echo > 0 && wet) {
      const e = ctx.createGain();
      e.gain.value = echo;
      g.connect(e); e.connect(wet);
    }
    return g;
  }

  // шумовой всплеск через фильтр с огибающей
  function burst(out, t, dur, type, f0, f1, q, gain) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.02);
  }
  function tone(out, t, dur, f0, f1, type, gain, delay = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t + delay);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + delay + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + delay);
    g.gain.linearRampToValueAtTime(gain, t + delay + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + delay + dur);
    o.connect(g); g.connect(out);
    o.start(t + delay); o.stop(t + delay + dur + 0.03);
  }

  // w — индекс оружия; vol 0..1; pan -1..1; dist — расстояние до источника (м)
  A.shot = (w, vol = 1, pan = 0, dist = 0) => {
    if (!ctx || !noise) return;
    const P = SHOT[w] || SHOT[0];
    const far = clampN(1 / (1 + dist / 30), 0.25, 1);
    const t = ctx.currentTime;
    const out = bus(pan, P.echo * (dist > 0 ? 0.8 + (1 - far) * 0.8 : 1));
    out.gain.value = vol;
    burst(out, t, P.nd, 'lowpass', P.lp * far, P.lp * 0.25, 0.7, P.ng);
    burst(out, t, P.nd * 0.25, 'highpass', 2500, 5000, 0.5, P.crack * far);
    tone(out, t, P.bd, P.f0, P.f1, 'sine', P.bg);
    if (w === 2 || w === 9) burst(out, t + 0.02, 0.3, 'bandpass', 600, 250, 1.1, 0.35);
    if (w === 4) { tone(out, t, 0.5, 60, 28, 'triangle', 0.5); burst(out, t + 0.05, 0.6, 'bandpass', 900, 200, 0.9, 0.18); }
    if (w === 8 || w === 7) { tone(out, t, 0.3, 70, 32, 'triangle', 0.32); burst(out, t + 0.04, 0.4, 'bandpass', 1100, 300, 0.9, 0.12); }
  };

  A.click = (f = 300, vol = 0.12) => {
    if (!ctx) return;
    const out = bus(0); out.gain.value = 1;
    tone(out, ctx.currentTime, 0.04, f, f * 0.8, 'square', vol);
  };

  // металлический щелчок механизма
  function mech(t, pitch = 1, vol = 0.25, out) {
    burst(out, t, 0.04, 'bandpass', 3200 * pitch, 1800 * pitch, 3, vol);
    tone(out, t, 0.05, 900 * pitch, 400 * pitch, 'square', vol * 0.25);
  }
  // перезарядка: магазин вынут → вставлен → затвор. dur — полное время (с)
  A.reload = (w, dur) => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    if (w === 2) { // дробовик: патроны по одному и помпа
      for (let i = 0; i < 3; i++) mech(t + dur * (0.16 + i * 0.18), 0.8, 0.22, out);
      mech(t + dur * 0.82, 0.6, 0.35, out); mech(t + dur * 0.9, 0.9, 0.35, out);
    } else if (w === 4 || w === 7) {
      mech(t + dur * 0.3, 0.8, 0.22, out); mech(t + dur * 0.62, 1.0, 0.26, out);
      mech(t + dur * 0.82, 0.6, 0.35, out); mech(t + dur * 0.9, 1.0, 0.3, out);
    } else {
      mech(t + dur * 0.3, 0.7, 0.28, out);                 // магазин вынут
      burst(out, t + dur * 0.36, 0.06, 'lowpass', 500, 200, 1, 0.12); // выпал
      mech(t + dur * 0.7, 1.0, 0.3, out);                  // вставлен
      mech(t + dur * 0.86, 0.65, 0.34, out);               // затвор назад
      mech(t + dur * 0.92, 1.0, 0.3, out);                 // затвор вперёд
    }
  };
  A.swap = () => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    burst(out, t, 0.08, 'lowpass', 900, 400, 1, 0.12);
    mech(t + 0.12, 0.8, 0.18, out);
  };

  A.step = (vol = 0.25, pan = 0, dist = 0) => {
    if (!ctx || !noise) return;
    const v = vol / (1 + dist / 6);
    if (v < 0.01) return;
    const t = ctx.currentTime;
    const out = bus(pan); out.gain.value = 1;
    burst(out, t, 0.07, 'lowpass', 380 + Math.random() * 120, 140, 0.8, v);
    tone(out, t, 0.06, 90, 50, 'sine', v * 0.5);
  };
  A.land = (vol = 0.4) => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    burst(out, t, 0.14, 'lowpass', 300, 100, 0.8, vol);
    tone(out, t, 0.12, 80, 40, 'sine', vol * 0.6);
  };

  A.casing = (pan = 0, dist = 0) => {
    if (!ctx) return;
    const v = 0.07 / (1 + dist / 4);
    const t = ctx.currentTime + 0.02;
    const out = bus(pan); out.gain.value = 1;
    tone(out, t, 0.05, 4200, 3600, 'triangle', v);
    tone(out, t, 0.04, 6100, 5400, 'triangle', v * 0.6, 0.05);
  };

  // свист пули рядом с игроком
  A.whiz = (pan = 0, vol = 0.5) => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(pan); out.gain.value = vol;
    burst(out, t, 0.22, 'bandpass', 3800, 900, 2.2, 0.55);
  };

  A.impactNear = (pan = 0, vol = 0.3) => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(pan); out.gain.value = vol;
    burst(out, t, 0.09, 'bandpass', 2800, 1200, 1.4, 0.5);
  };

  // zone: 0 — ноги (глухо), 1 — туловище, 2 — голова (звонко)
  A.hit = (zone = 1) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    if (zone === 2) {
      tone(out, t, 0.14, 2600, 2400, 'sine', 0.22);
      tone(out, t, 0.16, 3900, 3700, 'sine', 0.12);
      tone(out, t, 0.05, 1400, 900, 'square', 0.1);
    } else if (zone === 0) {
      tone(out, t, 0.06, 760, 600, 'square', 0.14);
      tone(out, t, 0.05, 420, 300, 'sine', 0.14);
    } else {
      tone(out, t, 0.05, 1300, 1000, 'square', 0.16);
      tone(out, t, 0.03, 2000, 1500, 'sine', 0.1);
    }
  };
  A.kill = (streak = 1) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    const base = 520 * Math.pow(1.06, Math.min(streak, 8));
    tone(out, t, 0.1, base, base, 'triangle', 0.22, 0.04);
    tone(out, t, 0.14, base * 1.5, base * 1.5, 'triangle', 0.2, 0.12);
    tone(out, t, 0.2, base * 2, base * 2, 'sine', 0.16, 0.22);
    tone(out, t, 0.18, 110, 50, 'sine', 0.35);
  };
  A.hurt = () => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    burst(out, t, 0.2, 'lowpass', 420, 120, 0.8, 0.55);
    tone(out, t, 0.2, 110, 45, 'sine', 0.4);
  };
  A.die = () => {
    if (!ctx || !noise) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    tone(out, t, 0.7, 180, 40, 'sawtooth', 0.18);
    burst(out, t, 0.5, 'lowpass', 700, 100, 0.8, 0.4);
  };
  A.empty = () => A.click(260, 0.14);
  A.ads = () => {
    if (!ctx || !noise) return;
    const out = bus(0); out.gain.value = 1;
    burst(out, ctx.currentTime, 0.1, 'bandpass', 1400, 900, 1.5, 0.08);
  };
  A.streak = (n) => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = bus(0); out.gain.value = 1;
    const notes = [523, 659, 784, 1047];
    for (let i = 0; i < Math.min(4, n); i++) tone(out, t, 0.18, notes[i], notes[i], 'triangle', 0.16, 0.08 * i);
  };
  A.beep = (f, dur = 0.06, vol = 0.15) => {
    if (!ctx) return;
    const out = bus(0); out.gain.value = 1;
    tone(out, ctx.currentTime, dur, f, f, 'square', vol);
  };

  return A;
}
