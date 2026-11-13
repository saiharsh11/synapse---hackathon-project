/* The sky over the whole site, in two layers drawn at 1/3 scale with crisp pixels.
   Behind the page: a dithered sky that warms from morning to late afternoon as you
   scroll, with clouds drifting at three depths. The pointer nudges a cloud like a breeze.
   Now and then a small flock of birds crosses the sky behind the content, and a few
   butterflies wait in the page margins. Both belong to a spot on the page, so they scroll
   away with it, and both keep their distance from the pointer.

   Sky.mount(canvas, { mode: "page" })   fixed behind the page, follows scroll
   Sky.mount(canvas, { mode: "stage" })  fills its parent, no scroll, calmer */
(function () {
  "use strict";
  const P = 3, FPS = 24;
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]].map(r => r.map(v => (v + .5) / 16));
  // sky colours: [scroll position, top colour, bottom colour]
  const KEYS = [[0, [214, 232, 251], [238, 243, 244]], [.55, [226, 237, 250], [245, 243, 236]], [1, [246, 227, 211], [244, 236, 228]]];
  const BIRD = [["k...k", ".k.k.", "..k.."], [".....", "kk.kk", "..k.."], [".....", ".kkk.", "k...k"]];
  const FLAP = [0, 1, 2, 1];
  const FLY = [["cc.cc", "cckcc", ".ckc."], [".c.c.", ".ckc.", "..k.."]];
  const WINGS = ["#f2a03c", "#d65a7f", "#5f8fe0", "#e8c234", "#8a6fd6"];
  const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

  function skyAt(t) {
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const [t0, a0, b0] = KEYS[i], [t1, a1, b1] = KEYS[i + 1], k = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    return [mix(a0, a1, k), mix(b0, b1, k)];
  }

  function cloudSprite(R, W, H) {
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), puffs = [];
    for (let k = 0; k < 6; k++) puffs.push([5 + R() * (W - 10), H * .45 + R() * H * .25, 2.5 + R() * H * .28]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const inside = y < H - 2 && puffs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r);
      const shade = y < H - 1 && puffs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy - 1.5) ** 2 <= r * r);
      if (inside) { g.fillStyle = "#ffffff"; g.fillRect(x, y, 1, 1); }
      else if (shade) { g.fillStyle = "#d4e1f2"; g.fillRect(x, y, 1, 1); }
    }
    return c;
  }

  function sprite(g, rows, x, y, flip, colors) {
    rows.forEach((row, ry) => [...row].forEach((ch, rx) => {
      if (ch === ".") return;
      g.fillStyle = colors[ch]; g.fillRect(x + (flip ? row.length - 1 - rx : rx), y + ry, 1, 1);
    }));
  }

  function mount(canvas, opts = {}) {
    const stage = opts.mode === "stage";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const g = canvas.getContext("2d");
    // the layer that flies over the content
    const over = document.createElement("canvas");
    over.className = stage ? "critters in-stage" : "critters"; over.setAttribute("aria-hidden", "true");
    (stage ? canvas.parentElement : document.body).appendChild(over);
    const o = over.getContext("2d");
    let W = 0, H = 0, vw = 0, vh = 0, maxScroll = 0, bg = null, bgT = -1, clouds = [], birds = [], flies = [];
    let nextFlock = 1.5 + Math.random() * 2, time = 0, px = -999, py = -999;

    function size() {
      const box = stage ? canvas.parentElement.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
      vw = box.width; vh = box.height;
      W = Math.ceil(vw / P); H = Math.ceil(vh / P);
      canvas.width = over.width = W; canvas.height = over.height = H; bgT = -1;
      maxScroll = stage ? 0 : Math.max(0, document.documentElement.scrollHeight - vh);
      // clouds live in "sky space": a taller strip that slides past slower than the page
      const R = rng(7), depths = stage ? [.0, .0] : [.16, .3, .48];
      clouds = [];
      depths.forEach((d, li) => {
        const range = (maxScroll * d + vh) / P + 40, n = Math.max(2, Math.round(range / (stage ? 95 : 52)));
        for (let i = 0; i < n; i++) {
          const w = Math.round((stage ? 26 : 22 + li * 10) + R() * 18), h = Math.round(w * .38);
          clouds.push({ d, x0: R() * (W + w), y0: R() * range - 20, w, h, sp: cloudSprite(R, w, h), alpha: stage ? .4 : .55 + li * .2, speed: 1 + li * 1.4 + R(), push: 0 });
        }
      });
      const want = stage ? 1 : Math.min(6, Math.max(2, Math.round((maxScroll + vh) / vh / 1.3)));
      flies = []; for (let i = 0; i < want; i++) flies.push(newFly(i / want));
    }

    function paintSky(t) {
      const [top, bot] = skyAt(t), L = 7, levels = [];
      for (let i = 0; i < L; i++) levels.push(mix(top, bot, i / (L - 1)).map(Math.round));
      bg = g.createImageData(W, H);
      const d = bg.data;
      for (let y = 0; y < H; y++) {
        const v = y / Math.max(1, H - 1) * (L - 1), base = Math.floor(v), frac = v - base;
        for (let x = 0; x < W; x++) {
          const c = levels[Math.min(L - 1, base + (BAYER[y & 3][x & 3] < frac ? 1 : 0))], i = (y * W + x) * 4;
          d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        }
      }
      bgT = t;
    }

    /* butterflies prefer the page margins on wide screens, so they rarely sit on text */
    // y values are in page space (art pixels from the top of the page), not screen space
    const pageH = () => (maxScroll + vh) / P;
    function spot(near) {
      const wide = W > 330, m = W * .13;
      const x = wide ? (Math.random() < .5 ? Math.random() * m : W - Math.random() * m) : Math.random() * W;
      const y = Math.min(pageH() - 12, Math.max(12, near + (Math.random() - .5) * H * .8));
      return [x, y];
    }
    function newFly(at) {
      const home = 12 + at * (pageH() - 24) + Math.random() * H * .5, [x, y] = spot(home), [tx, ty] = spot(home);
      return { x, y, tx, ty, home, vx: 0, vy: 0, ph: Math.random() * 6, col: WINGS[(Math.random() * WINGS.length) | 0], wait: Math.random() * 3, scared: 0 };
    }

    function spawnFlock(top) {
      const left = Math.random() < .5, n = 2 + ((Math.random() * 2) | 0), y = top + 10 + Math.random() * H * (stage ? .4 : .6);
      const v = (left ? 1 : -1) * (10 + Math.random() * 7);
      for (let k = 0; k < n; k++) {
        const rank = (k + 1) >> 1, side = k % 2 ? 1 : -1;
        birds.push({ x: (left ? -8 : W + 8) - Math.sign(v) * rank * 7, y: y + side * rank * 3.5, vx: v, vy: 0, cruise: v, ph: Math.random() * 4, scared: 0 });
      }
    }

    function step(dt) {
      time += dt;
      const top = stage ? 0 : scrollY / P, qy = py + top; // pointer in page space
      if ((nextFlock -= dt) <= 0 && !birds.length) { spawnFlock(top); nextFlock = (stage ? 22 : 14) + Math.random() * 12; }
      // birds: flee the pointer, climb, flap hard; then ease back into level flight
      for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i], dx = b.x - px, dy = b.y - qy, dist = Math.hypot(dx, dy), R = 34;
        if (dist < R) {
          const f = (R - dist) / R * 420 * dt, ux = dx / (dist || 1), uy = dy / (dist || 1);
          b.vx += ux * f; b.vy += (uy - .7) * f; b.scared = 1;
        }
        const sp = Math.hypot(b.vx, b.vy); if (sp > 60) { b.vx *= 60 / sp; b.vy *= 60 / sp; }
        b.vy *= 1 - 1.4 * dt; b.vx += (b.cruise - b.vx) * .3 * dt * (b.scared ? 0 : 1);
        b.scared = Math.max(0, b.scared - dt * .6);
        b.x += b.vx * dt; b.y += b.vy * dt + Math.sin(time * 2 + b.ph) * .05;
        b.ph += dt * (b.scared ? 24 : 9);
        if (b.x < -30 || b.x > W + 30 || b.y < top - H || b.y > top + 2 * H) birds.splice(i, 1);
      }
      // butterflies: wander between resting spots, dart away when the pointer comes near
      for (const f of flies) {
        const dx = f.x - px, dy = f.y - qy, dist = Math.hypot(dx, dy);
        if (dist < 26) {
          const k = (26 - dist) / 26 * 300 * dt;
          f.vx += dx / (dist || 1) * k; f.vy += dy / (dist || 1) * k;
          if (!f.scared) { const s = spot(f.home); f.tx = s[0]; f.ty = s[1]; f.wait = 0; }
          f.scared = 1;
        }
        f.scared = Math.max(0, f.scared - dt);
        const tx = f.tx - f.x, ty = f.ty - f.y, td = Math.hypot(tx, ty);
        if (td < 3) { if ((f.wait -= dt) <= 0) { const s = spot(f.home); f.tx = s[0]; f.ty = s[1]; f.wait = 1 + Math.random() * 4; } }
        else { f.vx += tx / td * 30 * dt; f.vy += ty / td * 30 * dt; }
        f.vx += Math.sin(time * 3 + f.ph) * 20 * dt; f.vy += Math.cos(time * 4.3 + f.ph) * 26 * dt;
        f.vx *= 1 - 1.6 * dt; f.vy *= 1 - 1.6 * dt;
        const sp = Math.hypot(f.vx, f.vy), max = f.scared ? 50 : 16; if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
        f.x = Math.min(W - 3, Math.max(2, f.x + f.vx * dt)); f.y = Math.min(pageH() - 3, Math.max(2, f.y + f.vy * dt));
        f.ph += dt * (td < 3 && !f.scared ? 2 : 14);
      }
    }

    function drawSky() {
      if (!W || !H) return;   // hidden (another page is showing): nothing to paint until it's shown
      const sy = stage ? 0 : scrollY, t = maxScroll ? Math.min(1, sy / maxScroll) : .35;
      if (!bg || Math.abs(t - bgT) > .004) paintSky(t);
      g.putImageData(bg, 0, 0);
      for (const c of clouds) {
        const span = W + c.w + 20;
        const x = ((c.x0 + time * c.speed + c.push) % span + span) % span - c.w - 10;
        const y = Math.round(c.y0 - sy * c.d / P);
        if (y < -c.h || y > H) continue;
        // a breeze: the pointer nudges the cloud it is over
        if (px > x && px < x + c.w && py > y && py < y + c.h) c.push += (px < x + c.w / 2 ? 1 : -1) * .6;
        c.push *= .995;
        g.globalAlpha = c.alpha; g.drawImage(c.sp, Math.round(x), y);
      }
      // birds fly behind the content, so they never cover text
      g.globalAlpha = .8;
      const top = sy / P;
      for (const b of birds) sprite(g, BIRD[FLAP[(b.ph | 0) % 4]], Math.round(b.x) - 2, Math.round(b.y - top) - 1, b.vx < 0, { k: "#2b3a33" });
      g.globalAlpha = 1;
    }

    function drawCritters() {
      o.clearRect(0, 0, W, H);
      const top = stage ? 0 : scrollY / P;
      for (const f of flies) {
        const y = Math.round(f.y - top);
        if (y < -4 || y > H + 4) continue;
        sprite(o, FLY[Math.sin(f.ph) > -.2 ? 0 : 1], Math.round(f.x) - 2, y - 1, false, { c: f.col, k: "#2b3a33" });
      }
    }

    const draw = () => { drawSky(); drawCritters(); };
    size(); draw();
    addEventListener("resize", () => { size(); draw(); });
    const track = (x, y) => {
      const r = stage ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
      px = (x - r.left) / P; py = (y - r.top) / P;
    };
    addEventListener("pointermove", e => track(e.clientX, e.clientY), { passive: true });
    addEventListener("pointerdown", e => track(e.clientX, e.clientY), { passive: true });
    document.addEventListener("pointerleave", () => { px = py = -999; });

    if (reduced) { over.remove(); addEventListener("scroll", drawSky, { passive: true }); return { size }; }
    addEventListener("scroll", draw, { passive: true });
    // page height changes as content loads, so re-measure now and then
    if (!stage) new ResizeObserver(() => { const m = Math.max(0, document.documentElement.scrollHeight - vh); if (Math.abs(m - maxScroll) > 40) size(); }).observe(document.body);
    let last = performance.now(), acc = 0;
    (function loop(now) {
      requestAnimationFrame(loop);
      if (document.hidden) { last = now; return; }
      acc += now - last; last = now;
      if (acc < 1000 / FPS) return;
      step(Math.min(.1, acc / 1000)); acc = 0; draw();
    })(last);
    return { size };
  }

  window.Sky = { mount };
})();
