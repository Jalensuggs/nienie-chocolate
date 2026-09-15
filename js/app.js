(function () {
  // ===== 可以改的地方 =====
  const CAT_NAME = '巧克力';          // 换成你家猫的名字
  const SLEEP_AFTER = 25;           // 多少秒没人理就睡着

  const LINES = {
    hello: ['戳戳我～', `我是${CAT_NAME}喵`],
    squish: ['咕叽！', '软吧～', '再捏一下嘛', '喵呜', '被捏扁啦', 'Q弹！'],
    stretch: ['要拉长啦——', '喵喵喵？！', '别拽啦'],
    pickup: ['放我下来喵！', '诶诶诶？', '飞起来啦'],
    land: ['我没事！', '再来一次！', '头好晕…'],
    pet: ['呼噜呼噜～', '好舒服喵', '还要摸～', '最喜欢你了'],
    tickle: ['哈哈哈不要挠！', '好痒好痒喵', '投降投降', '喵哈哈哈'],
    hold: ['呼噜噜噜…', '可以一直抱着吗'],
    wake: ['嗯？醒啦', '刚刚没睡着喵'],
    card: ['今天也被好好爱着呢', '软乎乎的一天', '捏完心情变好了吧', '明天也要来摸我哦', '你是我最喜欢的人类'],
  };

  const $ = (s) => document.querySelector(s);
  const stage = $('#stage'), glCanvas = $('#cat'), fx = $('#fx'), fctx = fx.getContext('2d');
  const shadowEl = $('#shadow'), bubbleEl = $('#bubble');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

  document.title = `捏捏${CAT_NAME}`;
  $('#title').textContent = `捏捏${CAT_NAME}`;

  let renderer;
  try {
    renderer = new SoftCatRenderer(glCanvas);
  } catch (err) {
    $('#loading').textContent = '这个浏览器不支持 WebGL，换个浏览器试试喵';
    return;
  }
  const sound = new CatSounds();

  // ===== 弹簧状态 =====
  const SPRING = {
    sx: [230, 9], sy: [230, 9], rot: [140, 12], lean: [150, 8],
    press: [420, 24], gx: [180, 6], gy: [180, 6], wob: [30, 9],
    earL: [260, 10], earR: [260, 10],
  };
  const S = { sx: 1, sy: 1, rot: 0, lean: 0, press: 0, gx: 0, gy: 0, wob: 0, earL: 0, earR: 0 };
  const T = { ...S };
  const V = Object.fromEntries(Object.keys(S).map((k) => [k, 0]));
  const stiff = {};   // 临时覆盖某个弹簧的参数

  const cat = {
    x: 0, y: 0, vx: 0, vy: 0, flying: false, carried: false, pivot: 0, spin: 0,
    pu: 0.5, pv: 0.5, gu: 0.5, gv: 0.5,
    blink: 0, blinkHold: 0, happy: 0, lookX: 0, lookY: 0,
    tailPhase: 0, tailAmp: 0.06, tailFreq: 1.6, wagUntil: 0,
    sleeping: false,
  };
  let W = 0, H = 0, B = 300, floorY = 0, time = 0;
  let mode = 'squish';
  let lastInput = 0, lastPointerSeen = -10, lookTarget = { x: 0, y: 0 };
  let nextBlink = 2, blinkT = -1, nextEar = 5, nextZ = 0;
  let happyUntil = 0;
  let particles = [];

  // ===== 布局 =====
  function layout() {
    const r = stage.getBoundingClientRect();
    W = r.width; H = r.height;
    renderer.resize(W, H);
    const dpr = renderer.dpr;
    fx.width = Math.round(W * dpr); fx.height = Math.round(H * dpr);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    B = Math.min(W * 0.82, H * 0.8, 520);
    floorY = Math.min(H - 16, H * (H > W * 1.3 ? 0.56 : 0.5) + B * 0.47);
    if (!cat.flying && !cat.carried) { cat.x = W / 2; cat.y = floorY; }
    cat.x = clamp(cat.x, B * 0.4, W - B * 0.4);
  }
  addEventListener('resize', layout);

  function drawState() {
    const breathAmp = cat.sleeping ? 0.022 : 0.011;
    const breath = reduced ? 0 : Math.sin(time * (cat.sleeping ? 1.35 : 2)) * breathAmp;
    return {
      cx: cat.x, cy: cat.y, b: B,
      sx: S.sx * (1 - breath * 0.5), sy: S.sy * (1 + breath),
      rot: S.rot, lean: S.lean, pivot: cat.pivot,
      press: S.press, pu: cat.pu, pv: cat.pv,
      gx: S.gx, gy: S.gy, gu: cat.gu, gv: cat.gv,
      wob: reduced ? 0 : Math.max(0, S.wob), time,
      earL: S.earL, earR: S.earR,
      tail: Math.sin(cat.tailPhase) * cat.tailAmp,
      blink: cat.blink, happy: cat.happy, lookX: cat.lookX, lookY: cat.lookY,
    };
  }

  // ===== 小工具 =====
  const vibrate = (ms) => { if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {} };

  let bubbleTimer = 0, bubbleW = 0, bubbleH = 0, lastSay = -10;
  function say(text, ms = 1600, force = false) {
    if (!force && time - lastSay < 0.9) return;
    lastSay = time;
    bubbleEl.textContent = text;
    bubbleW = bubbleEl.offsetWidth; bubbleH = bubbleEl.offsetHeight;
    bubbleEl.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), ms);
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // 今日计数，存在本地
  const todayKey = () => {
    const d = new Date();
    return `nienie-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  let stats = { squish: 0, pet: 0, tickle: 0, fly: 0 };
  try { stats = Object.assign(stats, JSON.parse(localStorage.getItem(todayKey()) || '{}')); } catch (e) {}
  const total = () => stats.squish + stats.pet + stats.tickle + stats.fly;
  function addCount(kind) {
    stats[kind]++;
    try { localStorage.setItem(todayKey(), JSON.stringify(stats)); } catch (e) {}
    const el = $('#count');
    el.textContent = total();
    el.parentElement.classList.remove('bump');
    void el.offsetWidth;
    el.parentElement.classList.add('bump');
  }
  $('#count').textContent = total();

  // ===== 粒子 =====
  function spawn(type, x, y, n = 1, opts = {}) {
    if (reduced && type !== 'z') n = Math.min(n, 1);
    for (let i = 0; i < n; i++) {
      const a = opts.angle ?? -Math.PI / 2, spread = opts.spread ?? 1.4;
      const ang = a + (Math.random() - 0.5) * spread;
      const sp = (opts.speed ?? 90) * (0.6 + Math.random() * 0.8);
      particles.push({
        type, x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: opts.life ?? 1.1, max: opts.life ?? 1.1,
        size: (opts.size ?? 12) * (0.7 + Math.random() * 0.6),
        rot: (Math.random() - 0.5) * 0.6,
        color: opts.color || pick(['#f2a0a6', '#f7b9a9', '#eb8f93']),
        grav: opts.grav ?? -20,
      });
    }
  }

  function heartPath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.35);
    ctx.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
    ctx.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
    ctx.fill();
  }

  function drawParticles(dt) {
    fctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.life -= dt;
      p.vy += p.grav * dt;
      p.vx *= 1 - dt * 1.5;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const t = p.life / p.max, alpha = Math.min(1, t * 2.2);
      fctx.save();
      fctx.globalAlpha = alpha;
      fctx.translate(p.x, p.y);
      fctx.rotate(p.rot);
      const s = p.size * (p.type === 'puff' || p.type === 'dust' ? 1 + (1 - t) * 1.2 : 0.6 + 0.4 * Math.min(1, (1 - t) * 6));
      fctx.fillStyle = p.color;
      if (p.type === 'heart') heartPath(fctx, s);
      else if (p.type === 'spark') {
        fctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? s * 0.28 : s;
          fctx.lineTo(Math.cos(i * Math.PI / 4) * r, Math.sin(i * Math.PI / 4) * r);
        }
        fctx.fill();
      } else if (p.type === 'z') {
        fctx.font = `800 ${s * 1.6}px ${getComputedStyle(document.body).fontFamily}`;
        fctx.fillStyle = '#9d8a80';
        fctx.fillText('z', 0, 0);
      } else {
        fctx.beginPath();
        fctx.arc(0, 0, s, 0, Math.PI * 2);
        fctx.fill();
      }
      fctx.restore();
    }
    particles = particles.filter((p) => p.life > 0);
  }

  // ===== 行为 =====
  function kick(key, v) { V[key] += v; }

  function setHappy(seconds) {
    happyUntil = Math.max(happyUntil, time + seconds);
    cat.wagUntil = Math.max(cat.wagUntil, time + seconds + 0.6);
  }

  function wake() {
    lastInput = time;
    if (cat.sleeping) {
      cat.sleeping = false;
      kick('earL', -6); kick('earR', -6);
      sound.play('mew');
      say(pick(LINES.wake), 1500, true);
    }
  }

  function pickUp(p) {
    cat.carried = true;
    cat.carryOffX = cat.x - p.x;
    cat.carryOffY = cat.y - p.y + S.gy * 0.5;
    T.press = 0; T.gx = 0; T.gy = 0; T.lean = 0;
    stiff.gx = stiff.gy = null;
    T.sx = 0.94; T.sy = 1.08;
    kick('earL', -5); kick('earR', -5);
    sound.play('surprised');
    say(pick(LINES.pickup), 1400, true);
    vibrate(15);
    stage.classList.add('grabbing');
  }

  function throwCat(vx, vy) {
    cat.carried = false;
    cat.flying = true;
    cat.vx = clamp(vx, -1800, 1800);
    cat.vy = clamp(vy, -2200, 1400);
    T.sx = 1; T.sy = 1;
    if (Math.hypot(vx, vy) > 700) {
      addCount('fly');
      cat.spin = Math.abs(vx) > 900 ? Math.sign(vx) * Math.PI * 2 : 0;
    }
  }

  const SURPRISES = ['meow', 'flip', 'sneeze', 'stretch'];
  let lastSurprise = '';
  function surprise(kind) {
    if (cat.carried) return;
    wake();
    if (!kind) {
      const options = SURPRISES.filter((k) => k !== lastSurprise);
      kind = pick(options);
    }
    lastSurprise = kind;
    addCount('squish');
    if (kind === 'meow') {
      sound.play('meow');
      say('喵～', 1300, true);
      kick('earL', -8); kick('earR', -8);
      if (!cat.flying) { cat.flying = true; cat.vy = -520; cat.vx = 0; kick('sy', -2.5); }
      setHappy(1.6);
      const head = renderer.project(drawState(), 0.72, 0.12);
      spawn('heart', head.x, head.y, 3, { speed: 120, size: 12 });
    } else if (kind === 'flip') {
      sound.play('jump');
      say('看我后空翻！', 1400, true);
      T.sy = 0.78; T.sx = 1.12;
      setTimeout(() => {
        T.sy = 1; T.sx = 1;
        cat.flying = true; cat.vy = -1250; cat.vx = 0;
        cat.spin = -Math.PI * 2;
        kick('sy', 3);
      }, 170);
    } else if (kind === 'sneeze') {
      T.sy = 1.12; T.sx = 0.93; T.rot = -0.08;
      cat.blinkHold = 0.6;
      sound.play('sneeze');
      setTimeout(() => {
        T.sy = 1; T.sx = 1; T.rot = 0;
        kick('sy', -5); kick('sx', 3); kick('wob', 3);
        kick('earL', 10); kick('earR', 10);
        say('阿嚏！', 1200, true);
        const nose = renderer.project(drawState(), 0.48, 0.42);
        spawn('puff', nose.x, nose.y, 7, { angle: Math.PI / 2, spread: 2.6, speed: 160, size: 7, color: 'rgba(255,255,255,.9)', grav: 30, life: 0.6 });
        vibrate(25);
      }, 420);
    } else if (kind === 'stretch') {
      sound.play('mew');
      say('伸个懒腰～', 1500, true);
      T.sy = 1.24; T.sx = 0.86;
      cat.blinkHold = 0.9;
      happyUntil = time + 0.9;
      setTimeout(() => { T.sy = 1; T.sx = 1; kick('sy', -2); kick('wob', 1.5); }, 750);
    }
  }

  // ===== 指针交互 =====
  const pointers = new Map();
  let drag = null, pinch = null, lastTap = { t: -1, x: 0, y: 0 };

  function localPoint(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() / 1000 };
  }

  stage.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sound.unlock();
    wake();
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    lookTarget = p; lastPointerSeen = time;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}

    if (pointers.size === 2 && !cat.carried) {
      const [a, b] = [...pointers.values()];
      pinch = { d0: Math.max(30, Math.hypot(a.x - b.x, a.y - b.y)), last: 0 };
      if (drag) { T.press = 0; T.gx = 0; T.gy = 0; T.lean = 0; stiff.gx = stiff.gy = null; drag = null; }
      sound.play('stretch');
      return;
    }
    if (pointers.size > 1) return;

    const ds = drawState();
    let hit = renderer.hit(ds, p.x, p.y);
    if (!hit && cat.flying) {
      // 飞在空中时判定宽松一点，方便接住
      const c = renderer.project(ds, 0.5, 0.5);
      if (Math.hypot(p.x - c.x, p.y - c.y) < B * 0.55) hit = { u: 0.5, v: 0.5 };
    }
    if (!hit) return;

    drag = { id: e.pointerId, start: p, last: p, hist: [p], hit, moved: 0, t0: time, energy: 0, stroke: 0, holdDone: false };

    if (cat.flying) {
      cat.flying = false; cat.spin = 0;
      pickUp(p);
      return;
    }

    cat.pu = hit.u; cat.pv = hit.v; cat.gu = hit.u; cat.gv = hit.v;
    stiff.gx = stiff.gy = [700, 34];
    if (mode === 'squish') {
      T.press = 1;
      T.sy = 0.93; T.sx = 1.045;       // 按下去整体也扁一点
      kick('sy', -1.2);
      kick('earL', 3); kick('earR', 3);
      sound.play('squish');
      vibrate(8);
      addCount('squish');
      if (Math.random() < 0.35) say(pick(LINES.squish));
    } else if (mode === 'pet') {
      T.press = 0.25;
      T.earL = 0.35; T.earR = 0.35;
    } else {
      T.press = 0.2;
      sound.play('giggle');
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const p = localPoint(e);
    lookTarget = p; lastPointerSeen = time;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, p);
    lastInput = time;

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = clamp(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0, 0.55, 1.9);
      const hz = Math.abs(Math.cos(Math.atan2(b.y - a.y, b.x - a.x)));
      T.sx = clamp(1 + (r - 1) * (hz * 0.9 - (1 - hz) * 0.35), 0.6, 1.7);
      T.sy = clamp(1 + (r - 1) * ((1 - hz) * 0.9 - hz * 0.35), 0.6, 1.7);
      if (Math.abs(r - pinch.last) > 0.15) { pinch.last = r; sound.play('stretch'); }
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;

    const dt = Math.max(0.001, p.t - drag.last.t);
    const step = Math.hypot(p.x - drag.last.x, p.y - drag.last.y);
    drag.moved += step;
    drag.hist.push(p);
    while (drag.hist.length > 2 && p.t - drag.hist[0].t > 0.1) drag.hist.shift();
    drag.last = p;
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y, dist = Math.hypot(dx, dy);

    if (cat.carried) return;

    if (mode === 'squish') {
      if (dist > B * 0.52) { pickUp(p); return; }
      const k = 0.95 / (1 + dist / (B * 0.55));
      const flat = Math.max(0, 1 - dist / (B * 0.15));
      T.sy = 1 - 0.07 * flat; T.sx = 1 + 0.045 * flat;
      T.gx = dx * k; T.gy = dy * k;
      T.lean = clamp(dx / B * 0.3, -0.25, 0.25);
      T.press = Math.max(0.3, 1 - dist / (B * 0.25));
      if (dist > B * 0.18 && sound.throttle('stretchLine', 1500)) say(pick(LINES.stretch));
      if (step > 3) sound.play('stretch');
    } else if (mode === 'pet') {
      const over = renderer.hit(drawState(), p.x, p.y);
      T.lean = clamp(dx / B * 0.12, -0.08, 0.08);
      T.gx = clamp(dx * 0.12, -20, 20); T.gy = clamp(dy * 0.08, -12, 12);
      if (over) {
        cat.pu = over.u; cat.pv = over.v;
        drag.stroke += step;
        if (drag.stroke > 85) {
          drag.stroke = 0;
          spawn('heart', p.x, p.y - 10, 1, { speed: 70, size: 11 });
          sound.play('heart');
          addCount('pet');
        }
        drag.energy += step / B;
        if (drag.energy > 0.6) {
          setHappy(0.8);
          sound.purr(true);
          if (sound.throttle('petLine', 2600)) say(pick(LINES.pet));
        }
      }
    } else {
      const speed = step / dt;
      if (speed > 350) {
        drag.energy = Math.min(2, drag.energy + (speed / B) * dt * 1.4);
        T.wob = Math.min(1.8, drag.energy);
        setHappy(0.6);
        if (drag.energy > 0.35) {
          sound.play('giggle');
          if (Math.random() < 0.25) spawn('spark', p.x, p.y, 1, { speed: 110, size: 9, color: pick(['#f4c46a', '#f2a0a6', '#9ccbe8']) });
          if (sound.throttle('tickleCount', 400)) addCount('tickle');
          if (sound.throttle('tickleLine', 2200)) say(pick(LINES.tickle));
        }
        if (sound.throttle('tickleEar', 160)) { kick(Math.random() < 0.5 ? 'earL' : 'earR', 5); kick('rot', (Math.random() - 0.5) * 1.6); }
      }
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.delete(e.pointerId);

    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        T.sx = 1; T.sy = 1;
        kick('sx', (1 - S.sx) * 8); kick('sy', (1 - S.sy) * 8); kick('wob', 1);
        sound.play('release');
        drag = null;
      }
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    stage.classList.remove('grabbing');
    stiff.gx = stiff.gy = null;
    sound.purr(false);

    if (cat.carried) {
      const h0 = d.hist[0], h1 = d.hist[d.hist.length - 1], span = Math.max(0.016, h1.t - h0.t);
      throwCat((h1.x - h0.x) / span, (h1.y - h0.y) / span);
      return;
    }

    const stretch = Math.hypot(S.gx, S.gy) / B;
    T.press = 0; T.gx = 0; T.gy = 0; T.lean = 0; T.earL = 0; T.earR = 0; T.wob = 0;
    T.sx = 1; T.sy = 1;

    if (mode === 'squish') {
      kick('sy', 1.5 + stretch * 10); kick('wob', 0.6 + stretch * 4);
      sound.play('release');
      if (stretch > 0.08) {
        const c = renderer.project(drawState(), 0.5, 0.4);
        spawn('spark', c.x, c.y, 4, { spread: 3, speed: 140, size: 8, color: '#f4c46a' });
      }
    } else if (mode === 'pet' && d.energy > 0.6) {
      if (sound.throttle('petEnd', 3000)) say('还要摸～', 1300);
    } else if (mode === 'tickle' && d.energy > 0.5) {
      kick('wob', 1);
    }

    // 双击 → 小惊喜
    const tap = time - d.t0 < 0.28 && d.moved < 12;
    if (tap) {
      if (time - lastTap.t < 0.34 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 50) {
        lastTap.t = -1;
        surprise();
      } else {
        lastTap = { t: time, x: p.x, y: p.y };
      }
    }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave', (e) => { if (!pointers.size) lastPointerSeen = -10; });

  // 键盘：空格捏一下，回车来个惊喜
  stage.tabIndex = 0;
  stage.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault(); sound.unlock(); wake();
      if (e.repeat) return;
      cat.pu = 0.5; cat.pv = 0.45; T.press = 1; kick('sy', -1.2);
      sound.play('squish'); addCount('squish');
    } else if (e.code === 'Enter') { sound.unlock(); surprise(); }
  });
  stage.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { T.press = 0; kick('sy', 1.5); kick('wob', 0.6); sound.play('release'); }
  });

  // ===== 按钮 =====
  const HINTS = {
    squish: '按住捏一捏 · 用力拖能抱起来扔 · 双击有惊喜',
    pet: `按住在${CAT_NAME}身上慢慢滑，摸久了会呼噜`,
    tickle: `在${CAT_NAME}身上快速来回划，挠它痒痒`,
  };
  document.querySelectorAll('.mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      sound.unlock();
      mode = btn.dataset.mode;
      document.querySelectorAll('.mode').forEach((b) => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-pressed', b === btn);
      });
      $('#hint').textContent = HINTS[mode];
      sound.play('tap');
    });
  });

  const soundBtn = $('#sound');
  try { sound.enabled = localStorage.getItem('nienie-sound') !== 'off'; } catch (e) {}
  soundBtn.setAttribute('aria-pressed', sound.enabled);
  soundBtn.addEventListener('click', () => {
    sound.unlock();
    sound.enabled = !sound.enabled;
    if (!sound.enabled) sound.purr(false);
    soundBtn.setAttribute('aria-pressed', sound.enabled);
    try { localStorage.setItem('nienie-sound', sound.enabled ? 'on' : 'off'); } catch (e) {}
    toast(sound.enabled ? '声音打开啦' : '已静音');
  });

  // ===== 今日卡片 =====
  const dialog = $('#card-dialog');
  let cardURL = null, cardBlob = null;
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  async function makeCard() {
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1440;
    const x = c.getContext('2d');
    const font = getComputedStyle(document.body).fontFamily;
    const g = x.createLinearGradient(0, 0, 0, 1440);
    g.addColorStop(0, '#f8f0e6'); g.addColorStop(1, '#f1e2d2');
    x.fillStyle = g; x.fillRect(0, 0, 1080, 1440);
    x.fillStyle = '#fffaf4';
    roundRect(x, 60, 60, 960, 1320, 56); x.fill();

    const d = new Date(), week = '日一二三四五六'[d.getDay()];
    x.fillStyle = '#8c7a70';
    x.font = `600 34px ${font}`;
    x.fillText(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}  周${week}`, 130, 170);
    x.fillStyle = '#4a3b34';
    x.font = `800 76px ${font}`;
    x.fillText(`今日摸${CAT_NAME}卡`, 130, 270);

    const glow = x.createRadialGradient(540, 760, 40, 540, 760, 420);
    glow.addColorStop(0, 'rgba(242,166,166,.22)'); glow.addColorStop(1, 'rgba(242,166,166,0)');
    x.fillStyle = glow; x.fillRect(100, 320, 880, 860);
    x.fillStyle = 'rgba(110,80,60,.14)';
    x.beginPath(); x.ellipse(540, 1112, 280, 34, 0, 0, Math.PI * 2); x.fill();
    x.drawImage(renderer.image, 190, 420, 700, 700);

    const items = [['捏捏', stats.squish + stats.fly], ['摸头', stats.pet], ['挠痒', stats.tickle]];
    items.forEach(([label, n], i) => {
      const cx = 250 + i * 290;
      x.textAlign = 'center';
      x.fillStyle = '#4a3b34'; x.font = `800 64px ${font}`;
      x.fillText(String(n), cx, 1230);
      x.fillStyle = '#8c7a70'; x.font = `600 28px ${font}`;
      x.fillText(label, cx, 1276);
    });
    x.textAlign = 'center';
    x.fillStyle = '#e98f7e'; x.font = `700 38px ${font}`;
    x.fillText(`“${pick(LINES.card)}”`, 540, 360);
    x.fillStyle = '#b3a399'; x.font = `600 24px ${font}`;
    x.fillText(`捏捏${CAT_NAME}`, 540, 1340);

    cardBlob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
    if (cardURL) URL.revokeObjectURL(cardURL);
    cardURL = URL.createObjectURL(cardBlob);
    $('#card-img').src = cardURL;
    $('#card-save').href = cardURL;
  }
  $('#card-btn').addEventListener('click', async () => {
    sound.unlock();
    await makeCard();
    sound.play('chime');
    dialog.showModal();
  });
  $('#card-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  $('#card-share').addEventListener('click', async () => {
    const file = new File([cardBlob], `今日摸${CAT_NAME}卡.jpg`, { type: 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `今日摸${CAT_NAME}卡` }); } catch (e) {}
    } else {
      toast('这个浏览器不能直接分享，先保存图片吧');
    }
  });

  // ===== 主循环 =====
  function update(dt) {
    time += dt;

    // 飞行 / 被抱着
    if (cat.carried) {
      const p = drag && pointers.get(drag.id);
      if (p) {
        const tx = clamp(p.x + cat.carryOffX, B * 0.4, W - B * 0.4);
        const ty = clamp(p.y + cat.carryOffY, B * 0.98, floorY);   // 别让头顶跑出舞台
        const nx = damp(cat.x, tx, 22, dt), ny = damp(cat.y, ty, 22, dt);
        const vx = (nx - cat.x) / dt;
        cat.x = nx; cat.y = ny;
        T.rot = clamp(-vx * 0.0005, -0.55, 0.55);
        T.wob = clamp(Math.abs(vx) * 0.001, 0, 1.2);
      }
    } else if (cat.flying) {
      cat.vy += 2600 * dt;
      cat.x += cat.vx * dt;
      cat.y += cat.vy * dt;
      const half = B * 0.42;
      if (cat.x < half) { cat.x = half; cat.vx = Math.abs(cat.vx) * 0.6; kick('sx', -2); sound.play('thud', 0.4); }
      if (cat.x > W - half) { cat.x = W - half; cat.vx = -Math.abs(cat.vx) * 0.6; kick('sx', -2); sound.play('thud', 0.4); }
      if (cat.y - B * 0.95 < 0 && cat.vy < 0) { cat.vy = Math.abs(cat.vy) * 0.4; }
      if (cat.spin) {
        const step = Math.sign(cat.spin) * Math.min(Math.abs(cat.spin), dt * 11);
        S.rot += step; cat.spin -= step; T.rot = S.rot; V.rot = 0;
        if (Math.abs(cat.spin) < 1e-3) { cat.spin = 0; S.rot = 0; T.rot = 0; }
      } else {
        T.rot = clamp(cat.vx * 0.00025, -0.35, 0.35);
      }
      T.sy = cat.vy < 0 ? 1.06 : 0.98; T.sx = cat.vy < 0 ? 0.96 : 1.01;
      if (cat.y >= floorY) {
        cat.y = floorY;
        const impact = cat.vy;
        const strength = clamp(impact / 1800, 0, 1);
        kick('sy', -impact * 0.0045); kick('sx', impact * 0.003); kick('wob', strength * 3);
        const foot = renderer.project(drawState(), 0.5, 0.96);
        if (impact > 300) {
          sound.play('thud', strength);
          vibrate(Math.round(10 + strength * 20));
          spawn('dust', foot.x - B * 0.25, floorY, 3, { angle: Math.PI, spread: 0.8, speed: 110, size: 6, color: 'rgba(160,130,110,.35)', grav: 0, life: 0.5 });
          spawn('dust', foot.x + B * 0.25, floorY, 3, { angle: 0, spread: 0.8, speed: 110, size: 6, color: 'rgba(160,130,110,.35)', grav: 0, life: 0.5 });
        }
        if (impact > 420 && !cat.spin) {
          cat.vy = -impact * 0.38;
          cat.vx *= 0.65;
        } else {
          cat.flying = false; cat.vx = 0; cat.vy = 0; cat.spin = 0;
          T.sx = 1; T.sy = 1; T.rot = 0;
          if (impact > 900 || Math.random() < 0.3) say(pick(LINES.land), 1400);
        }
      }
    } else if (!drag && !pinch) {
      T.rot = 0;
      // 慢慢走回舞台中间
      if (time - lastInput > 3) cat.x = damp(cat.x, W / 2, 0.8, dt);
    }
    cat.pivot = damp(cat.pivot, cat.flying || cat.carried ? 1 : 0, 10, dt);

    // 弹簧（分 4 步积分更稳）
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      for (const key in S) {
        if (key === 'rot' && cat.spin) continue;
        const [k, c] = stiff[key] || SPRING[key];
        V[key] += ((T[key] - S[key]) * k - V[key] * c) * h;
        S[key] += V[key] * h;
      }
    }
    S.press = Math.max(-0.25, S.press);

    // 睡觉
    if (!cat.sleeping && !drag && !cat.flying && time - lastInput > SLEEP_AFTER) {
      cat.sleeping = true;
      sound.play('sleep');
      say('困了…', 1400, true);
    }
    if (cat.sleeping && time > nextZ) {
      nextZ = time + 1.4;
      const head = renderer.project(drawState(), 0.78, 0.12);
      spawn('z', head.x, head.y, 1, { angle: -Math.PI / 3, spread: 0.3, speed: 30, size: 12, grav: -8, life: 2.2 });
    }

    // 眨眼、表情
    const happyNow = time < happyUntil;
    let lid = 0;
    if (cat.sleeping) lid = 1;
    else if (happyNow) lid = 0.92;
    if (cat.blinkHold > 0) { cat.blinkHold -= dt; lid = Math.max(lid, 1); }
    if (time > nextBlink && blinkT < 0 && lid === 0) { blinkT = 0; }
    let auto = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      auto = Math.sin(clamp(blinkT / 0.17, 0, 1) * Math.PI);
      if (blinkT > 0.17) { blinkT = -1; nextBlink = time + 2.2 + Math.random() * 4; if (Math.random() < 0.2) nextBlink = time + 0.25; }
    }
    cat.blink = Math.max(damp(cat.blink, lid, cat.sleeping ? 2.2 : 16, dt), auto);
    cat.happy = damp(cat.happy, happyNow ? 1 : 0, 12, dt);

    // 眼睛看向手指
    let lx = 0, ly = 0;
    if (time - lastPointerSeen < 2.5) {
      const eye = renderer.project(drawState(), 0.48, 0.3374);
      const dx = lookTarget.x - eye.x, dy = lookTarget.y - eye.y, len = Math.hypot(dx, dy) || 1;
      const mag = Math.min(1, len / (B * 0.7));
      lx = dx / len * mag; ly = dy / len * mag;
    } else if (!cat.sleeping) {
      lx = Math.sin(time * 0.37) * 0.35; ly = Math.sin(time * 0.23 + 1) * 0.2;
    }
    if (cat.carried) ly = 0.7;
    cat.lookX = damp(cat.lookX, lx, 10, dt);
    cat.lookY = damp(cat.lookY, ly, 10, dt);

    // 耳朵偶尔抖一下
    if (time > nextEar && !cat.sleeping) {
      nextEar = time + 4 + Math.random() * 6;
      kick(Math.random() < 0.5 ? 'earL' : 'earR', 7);
    }

    // 尾巴：平时轻轻晃，开心时快速摇
    const wag = time < cat.wagUntil;
    cat.tailAmp = damp(cat.tailAmp, cat.sleeping ? 0.02 : wag ? 0.26 : 0.07, 4, dt);
    cat.tailFreq = damp(cat.tailFreq, cat.sleeping ? 0.8 : wag ? 11 : 1.8, 4, dt);
    cat.tailPhase += cat.tailFreq * dt;

    // 长按不动：呼噜
    if (drag && mode === 'squish' && !cat.carried && !drag.holdDone && drag.moved < 14 && time - drag.t0 > 1.1) {
      drag.holdDone = true;
      sound.purr(true);
      setHappy(999);
      say(pick(LINES.hold), 1800, true);
    }
    if (drag && drag.holdDone && time > (drag.nextHeart || 0)) {
      drag.nextHeart = time + 0.45;
      const head = renderer.project(drawState(), 0.3 + Math.random() * 0.4, 0.1);
      spawn('heart', head.x, head.y, 1, { speed: 60, size: 11 });
    }
    if (!drag && happyUntil > time + 5) { happyUntil = time + 0.4; cat.wagUntil = time + 1; }
    if (!drag && mode !== 'tickle') T.wob = cat.carried ? T.wob : 0;
  }

  function place() {
    const ds = drawState();
    // 地面影子：离地越高越小越淡
    const lift = Math.max(0, floorY - cat.y);
    const k = 1 / (1 + lift / 260);
    const sw = B * 0.7 * S.sx * k;
    shadowEl.style.width = `${sw}px`;
    shadowEl.style.height = `${B * 0.09 * k}px`;
    shadowEl.style.opacity = String(0.35 + 0.65 * k);
    shadowEl.style.transform = `translate(${cat.x - sw / 2}px, ${floorY - B * 0.055 * k}px)`;
    // 气泡跟着头顶走
    if (bubbleEl.classList.contains('show')) {
      const top = renderer.project(ds, 0.52, 0.02);
      const bx = clamp(top.x - bubbleW / 2, 8, W - bubbleW - 8);
      const by = Math.max(6, top.y - bubbleH - 14);
      bubbleEl.style.transform = `translate(${bx}px, ${by}px)`;
    }
    renderer.draw(ds);
  }

  let last = 0;
  function frame(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    update(dt);
    place();
    drawParticles(dt);
    requestAnimationFrame(frame);
  }

  renderer.load(window.CAT_IMAGE_SRC, window.CAT_CLOSED_SRC, window.CAT_CLOSED_RECT).then(() => {
    layout();
    $('#loading').classList.add('hide');
    // 出场：从上面掉下来
    cat.y = floorY - H * 0.35;
    cat.flying = true;
    cat.vy = 0;
    requestAnimationFrame((t) => { last = t; frame(t); });
    setTimeout(() => say(pick(LINES.hello), 1800, true), 900);
  }).catch((err) => {
    console.error(err);
    $('#loading').textContent = `${CAT_NAME}的图片加载失败了`;
  });
})();
