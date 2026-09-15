// 音效全部用 Web Audio 实时合成，不需要音频文件
(function () {
  class CatSounds {
    constructor() {
      this.enabled = true;
      this.ctx = null;
      this.master = null;
      this.purrNode = null;
      this.lastAt = {};
    }

    unlock() {
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.55;
          this.master.connect(this.ctx.destination);
          const len = this.ctx.sampleRate;
          this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const d = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state !== 'running') this.ctx.resume();
      } catch (e) { /* 没有声音也能玩 */ }
    }

    get ok() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

    throttle(name, ms) {
      const now = performance.now();
      if (now - (this.lastAt[name] || 0) < ms) return false;
      this.lastAt[name] = now;
      return true;
    }

    env(g, t, peak, attack, dur) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    }

    tone(f0, f1, dur, { type = 'sine', vol = 0.3, delay = 0, attack = 0.01 } = {}) {
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      this.env(g, t, vol, attack, dur);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.03);
    }

    noise(dur, { freq = 800, type = 'lowpass', vol = 0.12, delay = 0, q = 0.7 } = {}) {
      const c = this.ctx, t = c.currentTime + delay;
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = this.noiseBuf;
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      this.env(g, t, vol, 0.008, dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.03);
    }

    // 锯齿波 + 两个共振峰滤波器，模拟"喵～"
    meow({ pitch = 1, dur = 0.55, delay = 0, vol = 0.22 } = {}) {
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain();
      o.type = 'sawtooth';
      const p = 520 * pitch;
      o.frequency.setValueAtTime(p * 0.9, t);
      o.frequency.linearRampToValueAtTime(p * 1.45, t + dur * 0.35);
      o.frequency.linearRampToValueAtTime(p * 0.85, t + dur);
      f1.type = 'bandpass'; f1.Q.value = 5;
      f1.frequency.setValueAtTime(700, t);
      f1.frequency.linearRampToValueAtTime(1300, t + dur * 0.35);
      f1.frequency.linearRampToValueAtTime(650, t + dur);
      f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 2400;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
      g.gain.setValueAtTime(vol, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      mix.gain.value = 0.5;
      o.connect(f1).connect(g);
      o.connect(f2).connect(mix).connect(g);
      g.connect(this.master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    purr(on) {
      if (!this.ctx) return;
      const c = this.ctx, t = c.currentTime;
      if (on && this.enabled && !this.purrNode && c.state === 'running') {
        const src = c.createBufferSource(), lp = c.createBiquadFilter(), amp = c.createGain(), out = c.createGain();
        const lfo = c.createOscillator(), lfoGain = c.createGain();
        src.buffer = this.noiseBuf; src.loop = true;
        lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 1.4;
        amp.gain.value = 0.5;
        lfo.frequency.value = 24; lfoGain.gain.value = 0.5;   // 每秒约 24 次的"咕噜"起伏
        lfo.connect(lfoGain).connect(amp.gain);
        out.gain.setValueAtTime(0.0001, t);
        out.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
        src.connect(lp).connect(amp).connect(out).connect(this.master);
        src.start(); lfo.start();
        this.purrNode = { src, lfo, out };
      } else if (!on && this.purrNode) {
        const { src, lfo, out } = this.purrNode;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        src.stop(t + 0.45); lfo.stop(t + 0.45);
        this.purrNode = null;
      }
    }

    play(name, strength = 1) {
      if (!this.ok) return;
      switch (name) {
        case 'squish':
          if (!this.throttle(name, 80)) return;
          this.tone(330, 130, 0.16, { vol: 0.32 });
          this.noise(0.09, { freq: 500, vol: 0.08 });
          break;
        case 'stretch':
          if (!this.throttle(name, 260)) return;
          this.tone(200, 520, 0.24, { vol: 0.14, type: 'triangle' });
          break;
        case 'release':
          this.tone(520, 190, 0.2, { vol: 0.28 });
          this.tone(260, 560, 0.12, { vol: 0.08, delay: 0.09 });
          break;
        case 'thud':
          if (!this.throttle(name, 90)) return;
          this.tone(150 + strength * 80, 55, 0.14, { vol: Math.min(0.45, 0.15 + strength * 0.3) });
          this.noise(0.07, { freq: 420, vol: 0.06 * strength });
          break;
        case 'meow': this.meow({ pitch: 0.95 + Math.random() * 0.2 }); break;
        case 'mew': this.meow({ pitch: 1.35, dur: 0.28, vol: 0.14 }); break;
        case 'surprised': this.meow({ pitch: 1.5, dur: 0.32, vol: 0.2 }); break;
        case 'giggle':
          if (!this.throttle(name, 320)) return;
          [0, 0.07, 0.14].forEach((d, i) => this.tone(900 + i * 140, 1250 - i * 60, 0.06, { vol: 0.08, delay: d }));
          break;
        case 'sneeze':
          this.noise(0.35, { freq: 1800, type: 'bandpass', vol: 0.05, q: 0.6 });
          this.tone(380, 900, 0.32, { vol: 0.06, type: 'triangle' });
          this.noise(0.14, { freq: 3200, type: 'highpass', vol: 0.3, delay: 0.38 });
          this.tone(900, 200, 0.12, { vol: 0.12, delay: 0.38 });
          break;
        case 'sleep':
          this.tone(260, 220, 0.6, { vol: 0.07, attack: 0.2 });
          this.tone(330, 260, 0.6, { vol: 0.05, attack: 0.2, delay: 0.45 });
          break;
        case 'heart':
          if (!this.throttle(name, 180)) return;
          this.tone(1320, 1320, 0.14, { vol: 0.04 });
          break;
        case 'jump': this.tone(300, 900, 0.18, { vol: 0.12 }); break;
        case 'chime':
          [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, f, 0.35, { vol: 0.08, delay: i * 0.09 }));
          break;
        case 'tap': this.tone(900, 700, 0.06, { vol: 0.06 }); break;
      }
    }
  }
  window.CatSounds = CatSounds;
})();
