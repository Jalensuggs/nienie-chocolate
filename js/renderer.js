// WebGL 软体渲染器：把一张猫猫图贴在 56×56 的网格上，每帧在 CPU 上移动顶点来做"捏、拉、晃、摇尾巴"，
// 眨眼、眼睛跟随、按压阴影在片元着色器里做。
(function () {
  const N = 56;

  // 素材上的关键位置（UV，0~1，以 assets/cat.png 为准）
  const RIG = {
    feetV: 0.965,                       // 脚底，缩放/站立的锚点
    eyeL: [0.3461, 0.3335],
    eyeR: [0.6136, 0.3335],
    eyeR_: 0.062,                       // 眼睛半径
    earL: { base: [0.30, 0.19], tip: [0.20, 0.05] },
    earR: { base: [0.67, 0.18], tip: [0.77, 0.05] },
    tail: { base: [0.872, 0.61], tip: [0.915, 0.475] },
  };

  const VS = `
    attribute vec2 aPos; attribute vec2 aUv;
    uniform vec2 uRes; varying vec2 vUv;
    void main(){ vUv=aUv; vec2 p=aPos/uRes*2.0-1.0; gl_Position=vec4(p.x,-p.y,0.,1.); }`;

  const FS = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uTex;
    uniform vec2 uLook;       // 眼睛看向，-1~1
    uniform float uBlink;     // 0 睁眼 1 闭眼
    uniform float uHappy;     // 闭眼时眼线的弯曲方向：0 为 ︶ 睡眼，1 为 ^ 笑眼
    uniform vec2 uPress; uniform float uPressAmt;
    uniform vec2 uLight; uniform float uGloss;
    uniform float uPx;        // 一个屏幕像素对应的 UV 长度，用来抗锯齿
    const vec2 EYE_L=vec2(${RIG.eyeL[0]},${RIG.eyeL[1]});
    const vec2 EYE_R=vec2(${RIG.eyeR[0]},${RIG.eyeR[1]});
    const float ER=${RIG.eyeR_};
    const vec3 LASH=vec3(.30,.24,.23);

    vec4 eyeShade(vec2 uv, vec2 c, vec4 base){
      vec2 d=uv-c; float dist=length(d);
      if(dist>ER*1.36) return base;
      // 1) 眼珠跟随：只挪眼眶内部，边缘保持不动
      float inner=1.-smoothstep(ER*.5,ER*.93,dist);
      vec2 s=uv-uLook*ER*.2*inner;
      vec4 eye=texture2D(uTex,s);
      if(uBlink<.002) return eye;
      // 2) 眨眼：上下眼皮合拢，把眼睛压成一条缝
      float open=1.-uBlink;
      float nx=clamp(d.x/ER,-1.,1.);
      float halfH=sqrt(max(0.,1.-nx*nx))*ER;
      float curve=ER*.28*(1.-nx*nx)*uBlink*(1.-2.*uHappy);   // 闭眼时的弧度
      float mid=curve*(1.-open);
      float band=halfH*open;
      float dy=d.y-mid;
      vec4 squashed=texture2D(uTex,vec2(s.x,c.y+dy/max(open,.04)));
      float soft=uPx*1.5;
      float inside=1.-smoothstep(band-soft,band+soft,abs(dy));
      float lidMask=1.-smoothstep(ER*1.0,ER*1.34,dist);       // 眼皮盖住的范围
      // 眼皮的毛：从眼眶正上方借一段真实毛发纹理，越靠眼睛中间借得越远
      float R2=ER*1.3;
      float qx=clamp(d.x,-R2*.97,R2*.97);
      vec2 q=vec2(c.x+qx, c.y-sqrt(max(0.,R2*R2-qx*qx))-(halfH-abs(d.y))*.45);
      vec3 fur=texture2D(uTex,q).rgb*(1.-.05*smoothstep(ER*.2,-ER*.6,d.y));
      vec3 col=mix(fur,squashed.rgb,inside);
      float lash=(1.-smoothstep(uPx*1.2,uPx*2.8+ER*.05*uBlink,abs(abs(dy)-band)))*step(abs(nx),.98)*smoothstep(.15,.6,uBlink);
      col=mix(col,LASH,lash*.85*(1.-smoothstep(.85,1.,abs(nx))));
      return vec4(mix(eye.rgb,col,lidMask),eye.a);
    }

    void main(){
      vec2 uv=vUv;
      vec4 col=texture2D(uTex,uv);
      if(col.a<.003) discard;
      col=eyeShade(uv, uv.x<.48?EYE_L:EYE_R, col);
      // 按压处的凹陷阴影
      vec2 pd=uv-uPress;
      col.rgb*=1.-uPressAmt*.16*exp(-dot(pd,pd)*55.);
      // 随倾斜移动的柔光
      vec2 ld=(uv-uLight)*vec2(1.2,1.);
      col.rgb+=vec3(1.,.98,.95)*uGloss*.09*exp(-dot(ld,ld)*22.)*col.a;
      gl_FragColor=col;   // 贴图是预乘 alpha 的
    }`;

  function smooth01(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  class SoftCatRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('这个浏览器不支持 WebGL');
      this.gl = gl;
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      this.prog = prog;

      this.verts = new Float32Array((N + 1) * (N + 1) * 4);
      const idx = [];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const a = y * (N + 1) + x;
        idx.push(a, a + 1, a + N + 1, a + 1, a + N + 2, a + N + 1);
      }
      this.count = idx.length;
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, this.verts, gl.DYNAMIC_DRAW);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      [['aPos', 0], ['aUv', 8]].forEach(([name, off]) => {
        const loc = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, off);
      });
      this.u = {};
      ['uRes', 'uTex', 'uLook', 'uBlink', 'uHappy', 'uPress', 'uPressAmt', 'uLight', 'uGloss', 'uPx']
        .forEach((k) => (this.u[k] = gl.getUniformLocation(prog, k)));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      this.ready = false;
    }

    async load(src) {
      const img = new Image();
      img.src = src;
      await img.decode();
      this.image = img;
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(this.u.uTex, 0);

      // 低分辨率 alpha 蒙版，用来判断手指有没有点在猫身上
      const m = 128, c = document.createElement('canvas');
      c.width = c.height = m;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, m, m);
      const data = ctx.getImageData(0, 0, m, m).data;
      this.mask = new Uint8Array(m * m);
      for (let i = 0; i < m * m; i++) this.mask[i] = data[i * 4 + 3];
      this.maskSize = m;
      this.ready = true;
    }

    resize(w, h) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    // 局部坐标里的旋转中心：站着时绕脚底，飞在空中时绕身体中心
    pivotY(s) { return -s.b * 0.47 * s.pivot; }

    // 屏幕坐标 → 贴图 UV（忽略局部形变的近似反变换）
    toUV(s, px, py) {
      let x = px - s.cx, y = py - s.cy;
      const py0 = this.pivotY(s);
      y -= py0;
      const c = Math.cos(-s.rot), si = Math.sin(-s.rot);
      const rx = x * c - y * si, ry = x * si + y * c;
      x = rx / s.sx;
      y = (ry + py0) / s.sy;
      const v = y / s.b + RIG.feetV;
      const u = (x - s.lean * (RIG.feetV - v) * s.b) / s.b + 0.5;
      return { u, v };
    }

    hit(s, px, py) {
      if (!this.ready) return null;
      const { u, v } = this.toUV(s, px, py);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const m = this.maskSize;
      const a = this.mask[Math.min(m - 1, (v * m) | 0) * m + Math.min(m - 1, (u * m) | 0)];
      return a > 40 ? { u, v } : null;
    }

    // 身体中心、头顶的屏幕坐标，用于摆放气泡和粒子
    project(s, u, v) {
      let x = (u - 0.5) * s.b + s.lean * (RIG.feetV - v) * s.b, y = (v - RIG.feetV) * s.b;
      x *= s.sx; y *= s.sy;
      const py0 = this.pivotY(s);
      y -= py0;
      const c = Math.cos(s.rot), si = Math.sin(s.rot);
      return { x: s.cx + x * c - y * si, y: s.cy + x * si + y * c + py0 };
    }

    draw(s) {
      if (!this.ready) return;
      const gl = this.gl, V = this.verts, b = s.b;
      const cos = Math.cos(s.rot), sin = Math.sin(s.rot), py0 = this.pivotY(s);
      const ears = [[RIG.earL, -s.earL], [RIG.earR, s.earR]];   // 正值 = 耳朵向外压平
      const tb = RIG.tail.base, tt = RIG.tail.tip;
      const tdx = tt[0] - tb[0], tdy = tt[1] - tb[1], tlen2 = tdx * tdx + tdy * tdy;
      let k = 0;
      for (let iy = 0; iy <= N; iy++) {
        const v = iy / N;
        for (let ix = 0; ix <= N; ix++) {
          const u = ix / N;
          let x = (u - 0.5) * b, y = (v - RIG.feetV) * b;

          // 耳朵抖动：绕耳根旋转，越靠近耳尖转得越多
          for (const [ear, ang] of ears) {
            if (Math.abs(ang) < 1e-4 || v > 0.24) continue;
            const ex = ear.tip[0] - ear.base[0], ey = ear.tip[1] - ear.base[1];
            const t = ((u - ear.base[0]) * ex + (v - ear.base[1]) * ey) / (ex * ex + ey * ey);
            if (t <= 0) continue;
            const w = smooth01(0, 0.9, t) * smooth01(0.24, 0.17, v);
            const a = ang * w, bx = (ear.base[0] - 0.5) * b, by = (ear.base[1] - RIG.feetV) * b;
            const dx = x - bx, dy = y - by, ca = Math.cos(a), sa = Math.sin(a);
            x = bx + dx * ca - dy * sa;
            y = by + dx * sa + dy * ca;
          }

          // 尾巴摇摆：沿尾巴方向的投影决定权重
          if (Math.abs(s.tail) > 1e-4 && u > 0.8 && v > 0.4 && v < 0.68) {
            const t = ((u - tb[0]) * tdx + (v - tb[1]) * tdy) / tlen2;
            const px = u - (tb[0] + tdx * t), pyy = v - (tb[1] + tdy * t);
            const w = smooth01(-0.05, 0.6, t) * Math.exp(-(px * px + pyy * pyy) / 0.0028);
            if (w > 0.002) {
              const a = s.tail * w, bx = (tb[0] - 0.5) * b, by = (tb[1] - RIG.feetV) * b;
              const dx = x - bx, dy = y - by, ca = Math.cos(a), sa = Math.sin(a);
              x = bx + dx * ca - dy * sa;
              y = by + dx * sa + dy * ca;
            }
          }

          // 按压：手指下方的局部凹陷，而不是整体缩放
          if (Math.abs(s.press) > 0.001) {
            const dx = u - s.pu, dy = v - s.pv, f = Math.exp(-(dx * dx + dy * dy) * 16);
            x += dx * b * s.press * 0.2 * f;
            y += (dy * b * 0.12 + b * 0.035) * s.press * f;
          }

          // 拉扯：抓住的点跟着手指走，远处慢慢衰减，脚底被"粘"在地上
          if (s.gx !== 0 || s.gy !== 0) {
            const dx = u - s.gu, dy = v - s.gv, f = Math.exp(-(dx * dx + dy * dy) * 4.2);
            const stick = 0.35 + 0.65 * smooth01(1.0, 0.55, v);
            x += s.gx * f * stick;
            y += s.gy * f * stick;
          }

          // 果冻晃动
          if (s.wob > 0.001) {
            const hgt = RIG.feetV - v;
            x += Math.sin(v * 9 - s.time * 19) * s.wob * b * 0.018 * hgt;
            y += Math.sin(u * 8 + s.time * 16) * s.wob * b * 0.009 * hgt;
          }

          // 整体前倾（上半身比下半身甩得更多）
          const h = Math.max(0, RIG.feetV - v);
          x += s.lean * h * b * (0.6 + 0.4 * h);

          x *= s.sx;
          y *= s.sy;
          y -= py0;
          V[k++] = s.cx + x * cos - y * sin;
          V[k++] = s.cy + x * sin + y * cos + py0;
          V[k++] = u;
          V[k++] = v;
        }
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, V);
      gl.uniform2f(this.u.uRes, this.w, this.h);
      gl.uniform2f(this.u.uLook, s.lookX, s.lookY);
      gl.uniform1f(this.u.uBlink, s.blink);
      gl.uniform1f(this.u.uHappy, s.happy);
      gl.uniform2f(this.u.uPress, s.pu, s.pv);
      gl.uniform1f(this.u.uPressAmt, Math.max(0, s.press));
      gl.uniform2f(this.u.uLight, 0.36 - s.lean * 0.6 - s.rot * 0.3, 0.2);
      gl.uniform1f(this.u.uGloss, 0.6 + Math.max(0, s.press) * 0.5);
      gl.uniform1f(this.u.uPx, 1 / (b * Math.max(0.5, s.sx) * this.dpr));
      gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    }
  }

  window.SoftCatRenderer = SoftCatRenderer;
  window.CAT_RIG = RIG;
})();
