/* Fireflies at dusk: a live Kuramoto synchronization model in pixel art.
   Each firefly has its own rhythm and nudges its timing toward the group's.
   As the coupling grows they fall into step. */
(function () {
  "use strict";
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(6.283 * r());

  function mount(canvas, opt = {}) {
    const W = 320, g = canvas.getContext("2d"), N = opt.count || 48;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let H = 120, scene = null, T = 0, last = 0, K = 0, Kgoal = 0, visible = false, started = false;
    const R = rng(5);
    const flies = Array.from({ length: N }, () => ({
      x: R(), y: R(), vx: 0, vy: 0, th: R() * 6.283, w: 6.283 * (.62 + .1 * gauss(R)), flash: 0,
    }));

    const rect = (k, x, y, w, h, c) => { k.fillStyle = c; k.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    function disc(k, cx, cy, r, c) { k.fillStyle = c; for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); k.fillRect(Math.round(cx - w), Math.round(cy + y), 2 * w + 1, 1); } }

    function build() {
      const r = canvas.getBoundingClientRect(); if (!r.width) return;
      H = Math.max(90, Math.round(W * r.height / r.width)); canvas.width = W; canvas.height = H;
      scene = document.createElement("canvas"); scene.width = W; scene.height = H;
      const k = scene.getContext("2d"), cols = ["#1d1b3d", "#2c2552", "#4a3466", "#7a4669", "#b25f63", "#e08a5c"];
      const hz = Math.round(H * .66);
      for (let y = 0; y < hz; y++) {
        const t = y / (hz - 1) * (cols.length - 1), i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
        for (let x = 0; x < W; x++) rect(k, x, y, 1, 1, f > (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16 ? cols[i + 1] : cols[i]);
      }
      const S = rng(9);
      for (let i = 0; i < 70; i++) { const x = S() * W, y = S() * hz * .55; rect(k, x, y, 1, 1, S() < .3 ? "#fff6d8" : "#cfc6ee"); }
      // distant campus silhouette and treeline
      let x = W * .55;
      while (x < W * .85) { const w = 5 + S() * 9, h = 5 + S() * 12; rect(k, x, hz - h, w, h + 2, "#3a2d52"); if (S() < .5) rect(k, x + 2, hz - h + 3, 1, 1, "#ffcf7a"); x += w; }
      disc(k, W * .62, hz - 10, 5, "#3a2d52");
      for (let i = 0; i < 60; i++) disc(k, S() * W, hz - 1, 2 + Math.round(S() * 5), "#241d3b");
      // lawn in shadow
      for (let y = hz; y < H; y++) { const t = (y - hz) / (H - hz); for (let xx = 0; xx < W; xx++) rect(k, xx, y, 1, 1, (t * 16) > BAYER[(y & 3) * 4 + (xx & 3)] ? "#14251c" : "#1c3326"); }
      for (let i = 0; i < W * 1.4; i++) rect(k, S() * W, hz + S() * (H - hz), 1, 2, S() < .5 ? "#0f1d16" : "#26422f");
      // big tree silhouette on the left
      for (let y = 0; y < H; y++) rect(k, W * .08 - 4 - (y > H * .8 ? (y - H * .8) * .8 : 0), y, 9 + (y > H * .8 ? (y - H * .8) * 1.6 : 0), 1, "#120f1f");
      for (let i = 0; i < 26; i++) disc(k, W * (.0 + S() * .22), -6 + S() * H * .4, 8 + Math.round(S() * 12), "#16122a");
    }

    function step(dt) {
      // mean field: how in step the group is (0 = random, 1 = perfect)
      let c = 0, s = 0; for (const f of flies) { c += Math.cos(f.th); s += Math.sin(f.th); }
      const r = Math.hypot(c, s) / N, psi = Math.atan2(s, c);
      K += (Kgoal - K) * (1 - Math.exp(-dt * .25));
      for (const f of flies) {
        const prev = f.th;
        f.th += (f.w + K * r * Math.sin(psi - f.th)) * dt;
        if (Math.floor(f.th / 6.283) > Math.floor(prev / 6.283)) f.flash = 1;
        f.flash *= Math.exp(-dt * 5);
        f.vx += (R() - .5) * dt * .02; f.vy += (R() - .5) * dt * .02; f.vx *= .98; f.vy *= .98;
        f.x = (f.x + f.vx * dt + 1) % 1; f.y = Math.min(1, Math.max(0, f.y + f.vy * dt));
      }
      opt.onOrder && opt.onOrder(r);
    }

    function draw() {
      if (!scene) return;
      g.imageSmoothingEnabled = false; g.drawImage(scene, 0, 0);
      const top = H * .3, span = H * .66;
      for (const f of flies) {
        const x = Math.round(f.x * W), y = Math.round(top + f.y * span), b = f.flash;
        if (b > .05) { g.globalAlpha = b * .35; rect(g, x - 2, y - 2, 5, 5, "#d9ff7a"); g.globalAlpha = b * .7; rect(g, x - 1, y - 1, 3, 3, "#e8ff9a"); }
        g.globalAlpha = .25 + b * .75; rect(g, x, y, 1, 1, b > .3 ? "#fbffd9" : "#a8c95c");
        g.globalAlpha = 1;
      }
    }

    function loop(now) {
      const dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now; T += dt;
      if (visible) { step(dt); draw(); }
      requestAnimationFrame(loop);
    }

    function scatter() { for (const f of flies) { f.th = R() * 6.283; f.flash = 0; } K = 0; Kgoal = 3.2; }
    new ResizeObserver(() => { build(); draw(); }).observe(canvas);
    new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible && !started) { started = true; Kgoal = 3.2; }
    }, { threshold: .25 }).observe(canvas);
    build();
    if (reduced) { for (const f of flies) f.th = 0; step(0); draw(); } else requestAnimationFrame(loop);
    return { scatter };
  }

  window.Fireflies = { mount };
})();
