/* The reading garden: a pixel-art hero scene drawn in code.
   Rendered at a low internal resolution and scaled up with crisp pixels.
   A campus lawn on a clear day: observatory and library on the horizon, a big tree,
   a picnic blanket with a laptop running Synapse, journals, and loose pages in the breeze.
   Sparrows peck on the lawn and butterflies visit the flowers; both shy away from the pointer. */
(function () {
  "use strict";

  const C = {
    sky: ["#3f7fdc", "#5590e4", "#6fa5ec", "#8fbcf2", "#b6d4f7", "#d6e8fa"],
    cloud: "#ffffff", cloudMid: "#eef4fc", cloudShade: "#d3e0f1", cloudDeep: "#b4c6de",
    city: ["#a9bcd8", "#9bb0d0", "#b9c9e0"], cityWin: "#dce6f3", cityTree: "#9cbf8a",
    hillFar: "#8dc06c", hillFar2: "#7db35f",
    lawn: ["#8cc55e", "#79b64f", "#67a645", "#559540"], tuftDark: "#468333", tuftLight: "#a3d46e",
    path: "#e6dcb4", pathEdge: "#cdbf92",
    trunk: ["#2f2119", "#4a3426", "#5e4330", "#7a5a40"],
    leaf: ["#173f22", "#22552b", "#2d6e34", "#3f8a3e", "#58a548", "#7cc25a", "#a6d872"],
    blanket: "#f3ead6", check: "#cf5446", checkDark: "#a83d33", fringe: "#e6d9bd",
    lapBody: ["#8d95a1", "#b4bbc6", "#d5dbe3"], bezel: "#2a2e35", screen: "#f2f7fd",
    books: ["#2f4a7a", "#8a2f3b", "#2f6b4f", "#c99a3a"], pages: "#f7f3e6", ink: "#9aa3ad",
    flower: ["#ffffff", "#ffd85c", "#ff9eb5", "#f06a84"], ladybug: "#d63a2f",
    amber: "#f0a03a", blueLink: "#4a86e0", dot: ["#4fb37a", "#e0628a", "#3d8fd9", "#a46be0", "#d9a032"],
    page: "#f3f4f1",
  };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  function mount(canvas, opt = {}) {
    const W = opt.width || 384;
    const g = canvas.getContext("2d");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let H = 216, hz = 130, gy = 180, sky, ground, clouds = [], T = 0, last = 0, visible = true;

    const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d")]; };
    const rect = (x, y, w, h, col, k = g) => { k.fillStyle = col; k.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const pix = (x, y, col, k = g) => rect(x, y, 1, 1, col, k);
    function disc(k, cx, cy, r, col) { k.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y)); k.fillRect(Math.round(cx - w), Math.round(cy + y), 2 * w + 1, 1); } }
    function dither(k, x0, y0, w, h, cols) {
      for (let y = 0; y < h; y++) {
        const t = h > 1 ? y / (h - 1) * (cols.length - 1) : 0, i = Math.min(cols.length - 2, Math.floor(t)), f = t - i;
        for (let x = 0; x < w; x++) { k.fillStyle = f > (BAYER[((y0 + y) & 3) * 4 + ((x0 + x) & 3)] + .5) / 16 ? cols[i + 1] : cols[i]; k.fillRect(x0 + x, y0 + y, 1, 1); }
      }
    }

    function resize() {
      const r = canvas.getBoundingClientRect(); if (!r.width) return;
      H = Math.max(150, Math.round(W * r.height / r.width));
      canvas.width = W; canvas.height = H;
      hz = Math.round(H * .6); gy = Math.round(H * .84);
      build();
      // the scene's proportions changed, so put everyone back somewhere sensible
      for (const b of sparrows) { [b.x, b.y] = perch(); b.mode = "perch"; }
      for (const f of flies) { [f.x, f.y] = flowerSpot(); f.tx = f.x; f.ty = f.y; }
    }

    // ---------- static layers ----------
    function build() {
      const R = rng(7);
      // sky with a sun haze in the upper right
      let k; [sky, k] = mk(W, H);
      dither(k, 0, 0, W, hz + 4, C.sky);

      // clouds as sprites that drift
      clouds = [];
      const makeCloud = (w, h, seed) => {
        const r2 = rng(seed), [c, ck] = mk(w, h), puffs = [];
        const base = h - 4;
        for (let x = 10; x < w - 10; x += 7 + r2() * 6) puffs.push([x, base - 6, 6 + r2() * 5]);
        const n = Math.round(w / 22);
        for (let i = 0; i < n; i++) { const x = w * (.2 + .6 * (i + r2() * .6) / n); puffs.push([x, base - 12 - r2() * (h * .45), 9 + r2() * (h * .32)]); }
        for (const [x, y, r] of puffs) disc(ck, x + 1, y + 3, Math.round(r), C.cloudDeep);
        for (const [x, y, r] of puffs) disc(ck, x, y + 1, Math.round(r), C.cloudShade);
        for (const [x, y, r] of puffs) disc(ck, x - 1, y - 1, Math.round(r) - 1, C.cloudMid);
        for (const [x, y, r] of puffs) disc(ck, x - 2, y - 2, Math.max(1, Math.round(r * .72)), C.cloud);
        ck.clearRect(0, base + 2, w, h);
        return c;
      };
      // clouds stay right of the headline (the left of the sky is kept clear for text)
      clouds.push({ img: makeCloud(150, 84, 3), x: W * .47, y: hz - 92 });
      clouds.push({ img: makeCloud(70, 32, 19), x: W * .58, y: hz - 118 });
      clouds.push({ img: makeCloud(100, 44, 23), x: W * .74, y: hz - 50 });

      // ground layer: skyline, hills, lawn, path, tree, blanket and objects
      [ground, k] = mk(W, H);
      // campus skyline on the left horizon
      let x = Math.round(W * .38);
      while (x < W * .68) {
        const w = 6 + Math.round(R() * 12), h = 8 + Math.round(R() * 20), col = C.city[(R() * 3) | 0];
        rect(x, hz - h, w, h + 2, col, k);
        for (let wy = hz - h + 3; wy < hz - 2; wy += 4) for (let wx = x + 2; wx < x + w - 2; wx += 3) if (R() < .5) pix(wx, wy, C.cityWin, k);
        x += w + (R() < .3 ? 6 : 0);
      }
      // observatory dome and clock tower
      const ox = Math.round(W * .47); rect(ox - 9, hz - 16, 18, 18, C.city[1], k); disc(k, ox, hz - 16, 9, C.city[2]); rect(ox - 1, hz - 26, 2, 4, C.city[0], k);
      rect(ox - 1, hz - 22, 2, 6, C.cityWin, k);
      const tx = Math.round(W * .6); rect(tx - 3, hz - 40, 6, 42, C.city[0], k); for (let i = 0; i < 6; i++) rect(tx - 3 + i * .5, hz - 46 + i, 6 - i, 1, C.city[0], k);
      disc(k, tx, hz - 34, 2, C.cityWin);
      for (let i = 0; i < 30; i++) disc(k, R() * W * .75, hz - 2, 2 + Math.round(R() * 4), C.cityTree);
      // far hills
      for (let xx = 0; xx < W; xx++) {
        const yy = hz - 2 + Math.round(Math.sin(xx * .03) * 2 + Math.sin(xx * .011 + 1) * 3);
        rect(xx, yy, 1, 10, xx % 2 ? C.hillFar : C.hillFar2, k);
      }
      // lawn
      dither(k, 0, hz + 5, W, H - hz - 5, C.lawn);
      for (let i = 0; i < W * H * .012; i++) {
        const tx2 = R() * W, ty2 = hz + 8 + R() * (H - hz - 8);
        rect(tx2, ty2, 1, ty2 > gy ? 2 : 1, R() < .6 ? C.tuftDark : C.tuftLight, k);
      }
      // winding path
      for (let y = hz + 6; y < H; y++) {
        const t = (y - hz) / (H - hz), cx = W * (.4 - .42 * Math.pow(t, 1.25)), w = 2 + t * 38;
        rect(cx - w / 2, y, w, 1, C.path, k); pix(cx - w / 2, y, C.pathEdge, k); pix(cx + w / 2, y, C.pathEdge, k);
      }
      // tree shadow
      for (let y = gy - 6; y < gy + 10; y++) for (let xx = W * .7; xx < W; xx++) {
        const d = Math.hypot((xx - W * .9) / (W * .2), (y - gy) / 9);
        if (d < 1 && BAYER[(y & 3) * 4 + (xx & 3)] < 8) pix(xx, y, C.lawn[3], k);
      }
      // trunk with root flare and bark
      const trunkX = Math.round(W * .9);
      for (let y = -10; y < gy + 4; y++) {
        const flare = y > gy - 22 ? (y - (gy - 22)) * .9 : 0, w = 16 + flare + Math.max(0, (hz - y) * -.0), cx = trunkX + Math.sin(y * .05) * 2;
        rect(cx - w / 2, y, w, 1, C.trunk[2], k);
        rect(cx - w / 2, y, 3, 1, C.trunk[3], k); rect(cx + w / 2 - 4, y, 4, 1, C.trunk[1], k);
        if (R() < .25) pix(cx - w / 2 + 4 + R() * (w - 8), y, C.trunk[1], k);
      }
      // branches into the canopy
      const branch = (x0, y0, x1, y1) => { const n = Math.hypot(x1 - x0, y1 - y0); for (let i = 0; i < n; i++) { const t = i / n; rect(x0 + (x1 - x0) * t - 1, y0 + (y1 - y0) * t, 3 - t * 1.5, 2, C.trunk[1], k); } };
      branch(trunkX - 6, H * .3, W * .7, H * .12); branch(trunkX - 4, H * .2, W * .78, -4);
      // canopy: dark base, mid, light from the upper left
      const leaves = [];
      for (let i = 0; i < 46; i++) leaves.push([W * (.6 + R() * .45), -10 + R() * H * .42, 9 + R() * 16]);
      for (let i = 0; i < 10; i++) leaves.push([W * (.55 + R() * .2), H * (.25 + R() * .15), 6 + R() * 8]);
      for (const [lx, ly, r] of leaves) disc(k, lx + 2, ly + 3, Math.round(r), C.leaf[1]);
      for (const [lx, ly, r] of leaves) disc(k, lx, ly, Math.round(r), C.leaf[3]);
      for (const [lx, ly, r] of leaves) disc(k, lx - 2, ly - 2, Math.round(r * .62), C.leaf[4]);
      for (const [lx, ly, r] of leaves) disc(k, lx - 3, ly - 4, Math.round(r * .28), C.leaf[5]);
      for (let i = 0; i < 450; i++) { const [lx, ly, r] = leaves[(R() * leaves.length) | 0], a = R() * 6.28, d = R() * r; pix(lx + Math.cos(a) * d, ly + Math.sin(a) * d, R() < .5 ? C.leaf[2] : C.leaf[6], k); }
      // hanging leaves along the canopy edge
      for (let i = 0; i < 40; i++) { const lx = W * (.58 + R() * .42), ly = H * (.2 + R() * .22); rect(lx, ly, 1, 2 + R() * 4, C.leaf[2], k); pix(lx, ly + 5, C.leaf[4], k); }

      // picnic blanket (a skewed checked quad)
      const bx = Math.round(W * .52), bw = Math.round(W * .28), bh = 18, by = gy - 14, sk = 10;
      for (let v = 0; v < bh; v++) for (let u = 0; u < bw; u++) {
        const px2 = bx + u - (v / bh) * sk, py = by + v, cu = Math.floor(u / 6) % 3 === 0, cv = Math.floor(v / 4) % 3 === 0;
        pix(px2, py, cu && cv ? C.checkDark : cu || cv ? C.check : C.blanket, k);
      }
      for (let u = 0; u < bw; u += 2) pix(bx + u - sk, by + bh, C.fringe, k);
      rect(bx - sk, by + bh + 1, bw, 1, "rgba(40,80,30,.35)", k);

      // stack of journals
      const sx = Math.round(W * .73), sy = gy - 13;
      C.books.forEach((col, i) => { rect(sx - i, sy - i * 4, 22, 4, col, k); rect(sx - i + 1, sy - i * 4 + 1, 20, 1, C.pages, k); rect(sx - i + 21, sy - i * 4, 1, 4, "rgba(0,0,0,.25)", k); });
      // open notebook with handwriting
      const nx = Math.round(W * .54), ny = gy - 6;
      rect(nx, ny, 26, 9, C.pages, k); rect(nx + 13, ny, 1, 9, "#d9d2bf", k);
      for (let l = 0; l < 3; l++) { rect(nx + 2, ny + 2 + l * 2, 9 - (l === 2 ? 4 : 0), 1, C.ink, k); rect(nx + 15, ny + 2 + l * 2, 8 - (l === 1 ? 3 : 0), 1, C.ink, k); }
      rect(nx + 22, ny + 6, 7, 1, "#2f4a7a", k);
      // coffee mug
      const mx = Math.round(W * .82), my = gy - 4; rect(mx, my, 5, 6, "#ffffff", k); rect(mx + 5, my + 1, 2, 3, "#ffffff", k); rect(mx + 1, my, 3, 1, "#6b4a32", k);

      // laptop body (screen content is drawn per frame)
      const lx = Math.round(W * .62), ly = gy - 12;
      for (let i = 0; i < 6; i++) rect(lx - i, ly + i, 36, 1, i < 2 ? C.lapBody[2] : C.lapBody[1], k);
      rect(lx - 6, ly + 6, 36, 1, C.lapBody[0], k);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 9; j++) if ((i + j) % 2 === 0) pix(lx + 2 + j * 3 - i, ly + 1 + i, C.lapBody[0], k);
      rect(lx + 1, ly - 30, 34, 30, C.bezel, k);

      // foreground bushes and flowers, bottom left
      for (let i = 0; i < 26; i++) { const fx = R() * W * .26 - 8, fy = H - 4 - R() * 26; disc(k, fx, fy, 5 + Math.round(R() * 8), i % 3 ? C.leaf[3] : C.leaf[2]); }
      for (let i = 0; i < 26; i++) { const fx = R() * W * .26 - 8, fy = H - 6 - R() * 24; disc(k, fx - 1, fy - 1, 3 + Math.round(R() * 4), C.leaf[4]); }
      for (let i = 0; i < 40; i++) { const fx = R() * W * .3, fy = H - 4 - R() * 30; const col = C.flower[(R() * 4) | 0]; pix(fx, fy, col, k); pix(fx + 1, fy, col, k); pix(fx, fy + 1, col, k); pix(fx + 1, fy + 1, C.flower[1], k); }
      // daisies across the lawn
      for (let i = 0; i < 70; i++) { const fx = R() * W, fy = hz + 14 + R() * (H - hz - 20); if (fx > W * .5 && fx < W * .86 && fy > gy - 18 && fy < gy + 8) continue; pix(fx, fy, C.flower[(R() < .7 ? 0 : 2)], k); }
      // a ladybug on a leaf
      disc(k, W * .18, H - 18, 3, C.leaf[4]); rect(W * .18 - 1, H - 20, 3, 2, C.ladybug, k); pix(W * .18 - 1, H - 20, "#1b1b1b", k); pix(W * .18 + 1, H - 19, "#1b1b1b", k);

      // ragged grass edge melting into the page colour
      for (let xx = 0; xx < W; xx++) {
        const e = H - 3 - Math.round(Math.abs(Math.sin(xx * .9) * 2 + Math.sin(xx * .23) * 2));
        rect(xx, e, 1, H - e, C.page, k);
        if (R() < .35) rect(xx, e - 2, 1, 3, R() < .5 ? C.lawn[3] : C.tuftDark, k);
      }
    }

    // ---------- pointer parallax: clouds and pages drift a little against the mouse ----------
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    if (!reduced && matchMedia("(hover: hover) and (pointer: fine)").matches) {
      (canvas.parentElement || canvas).addEventListener("pointermove", e => {
        const r = canvas.getBoundingClientRect(); tmx = (e.clientX - r.left) / r.width - .5; tmy = (e.clientY - r.top) / r.height - .5;
      });
      (canvas.parentElement || canvas).addEventListener("pointerleave", () => { tmx = 0; tmy = 0; });
    }

    // ---------- per-frame layer ----------
    const sheets = Array.from({ length: 6 }, (_, i) => ({ x: (i * 67) % 384, y: 0, s: .7 + (i % 3) * .25, ph: i * 1.3, ox: 0, oy: 0, vx: 0, vy: 0, spin: 0 }));

    // ---------- garden life: sparrows that perch and peck, butterflies on the flowers ----------
    // Both keep away from the pointer: sparrows burst into the air and land somewhere else,
    // butterflies dart off to another flower.
    let gx = -999, gyp = -999;
    const host = canvas.parentElement || canvas;
    const aim = e => { const r = canvas.getBoundingClientRect(); gx = (e.clientX - r.left) / r.width * W; gyp = (e.clientY - r.top) / r.height * H; };
    host.addEventListener("pointermove", aim); host.addEventListener("pointerdown", aim);
    host.addEventListener("pointerleave", () => { gx = gyp = -999; });
    const SPARROW = [["...bb.", "..bbeo", "bbbww.", ".k.k.."], ["......", "...bb.", "bbbweo", ".k.k.."]];
    const FLAPS = [["k...k", ".k.k.", "..k.."], [".....", "kk.kk", "..k.."], [".....", ".kkk.", "k...k"]];
    const WING = ["#f2a03c", "#e0628a", "#5f8fe0", "#f0d04a", "#ffffff"];
    const SPR = { b: "#6b4a32", w: "#efe3cb", e: "#1b1b1b", o: "#f0a03a", k: "#3a2a20" };
    function sprite(rows, x, y, flip, cols) {
      rows.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch !== ".") pix(Math.round(x) + (flip ? row.length - 1 - rx : rx), Math.round(y) + ry, cols[ch]); }));
    }
    // places a sparrow can land: open lawn, the book stack, the top of the laptop
    function perch() {
      const r = Math.random();
      if (r < .2) return [W * .73 - 2 + Math.random() * 16, gy - 13 - 16];
      if (r < .32) return [W * .62 + 4 + Math.random() * 22, gy - 46];
      return [W * (.08 + Math.random() * .4), hz + 14 + Math.random() * (gy - hz - 18)];
    }
    const sparrows = Array.from({ length: 5 }, () => { const [x, y] = perch(); return { x, y, tx: x, ty: y, vx: 0, vy: 0, mode: "perch", t: Math.random() * 3, peck: 0, flip: Math.random() < .5, ph: 0 }; });
    const flowerSpot = () => Math.random() < .5 ? [Math.random() * W * .28, H - 10 - Math.random() * 26] : [W * (.05 + Math.random() * .45), hz + 12 + Math.random() * (H - hz - 20)];
    const flies = Array.from({ length: 4 }, (_, i) => { const [x, y] = flowerSpot(); return { x, y, tx: x, ty: y, vx: 0, vy: 0, wait: Math.random() * 2, ph: i * 1.7, col: WING[i % WING.length], scared: 0 }; });
    const flock = [];
    let nextFlock = 3;

    function life(dt) {
      for (const s of sparrows) {
        const d = Math.hypot(s.x - gx, s.y - gyp);
        if (d < 30 && s.mode !== "fly") {
          s.mode = "fly"; s.t = 2 + Math.random() * 3;
          const ux = (s.x - gx) / (d || 1); s.vx = (ux || (Math.random() - .5)) * 70 + (Math.random() - .5) * 30; s.vy = -55 - Math.random() * 30;
        }
        if (s.mode === "perch") {
          if ((s.t -= dt) <= 0) {
            s.t = .6 + Math.random() * 2.4;
            const r = Math.random();
            if (r < .45) s.peck = .35; else if (r < .75 && s.y > hz + 8) { s.x += (s.flip ? -1 : 1) * (2 + Math.random() * 3); s.x = Math.max(4, Math.min(W * .5, s.x)); } else s.flip = !s.flip;
          }
          s.peck = Math.max(0, s.peck - dt);
        } else if (s.mode === "fly") {
          s.vy += 12 * dt; s.vx *= 1 - .4 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.ph += dt * 22;
          if (d < 30) { s.vx += (s.x - gx) / (d || 1) * 200 * dt; s.vy -= 120 * dt; }
          if ((s.t -= dt) <= 0) {
            let p = perch(); for (let k = 0; k < 6 && Math.hypot(p[0] - gx, p[1] - gyp) < 60; k++) p = perch();
            s.tx = p[0]; s.ty = p[1]; s.mode = "land";
          }
        } else {
          const dx = s.tx - s.x, dy = s.ty - s.y, dl = Math.hypot(dx, dy);
          if (dl < 2) { s.mode = "perch"; s.x = s.tx; s.y = s.ty; s.vx = s.vy = 0; s.t = 1 + Math.random() * 2; }
          else { const sp = Math.min(45, 12 + dl); s.vx += (dx / dl * sp - s.vx) * 3 * dt; s.vy += (dy / dl * sp - s.vy) * 3 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.ph += dt * 16; }
        }
        if (s.mode !== "perch") s.flip = s.vx < 0;
      }
      for (const f of flies) {
        const dx = f.x - gx, dy = f.y - gyp, d = Math.hypot(dx, dy);
        if (d < 24) {
          f.vx += dx / (d || 1) * 320 * dt; f.vy += dy / (d || 1) * 320 * dt;
          if (!f.scared) { let p = flowerSpot(); for (let k = 0; k < 6 && Math.hypot(p[0] - gx, p[1] - gyp) < 50; k++) p = flowerSpot(); f.tx = p[0]; f.ty = p[1]; }
          f.scared = 1;
        }
        f.scared = Math.max(0, f.scared - dt);
        const tx = f.tx - f.x, ty = f.ty - f.y, td = Math.hypot(tx, ty);
        if (td < 2.5) { if ((f.wait -= dt) <= 0) { const p = flowerSpot(); f.tx = p[0]; f.ty = p[1]; f.wait = 1 + Math.random() * 3; } }
        else { f.vx += tx / td * 34 * dt; f.vy += ty / td * 34 * dt; }
        f.vx += Math.sin(T * 3 + f.ph) * 22 * dt; f.vy += Math.cos(T * 4.4 + f.ph) * 28 * dt;
        f.vx *= 1 - 1.8 * dt; f.vy *= 1 - 1.8 * dt;
        const sp = Math.hypot(f.vx, f.vy), max = f.scared ? 60 : 18; if (sp > max) { f.vx *= max / sp; f.vy *= max / sp; }
        f.x = Math.max(2, Math.min(W - 6, f.x + f.vx * dt)); f.y = Math.max(4, Math.min(H - 6, f.y + f.vy * dt));
        f.ph += dt * (td < 2.5 && !f.scared ? 2.5 : 15);
      }
      // a flock crossing the sky now and then; it swerves around the pointer
      if ((nextFlock -= dt) <= 0) {
        nextFlock = 8 + Math.random() * 8;
        const left = Math.random() < .5, y0 = 14 + Math.random() * (hz * .45), v = (left ? 1 : -1) * (18 + Math.random() * 8);
        for (let k = 0; k < 5; k++) { const rank = (k + 1) >> 1; flock.push({ x: (left ? -10 : W + 10) - Math.sign(v) * rank * 8, y: y0 + (k % 2 ? 1 : -1) * rank * 4, vx: v, vy: 0, cruise: v, ph: Math.random() * 4 }); }
      }
      for (let i = flock.length - 1; i >= 0; i--) {
        const b = flock[i], dx = b.x - gx, dy = b.y - gyp, d = Math.hypot(dx, dy);
        if (d < 34) { const k = (34 - d) / 34 * 380 * dt; b.vx += dx / (d || 1) * k; b.vy += (dy / (d || 1) - .6) * k; b.ph += dt * 12; }
        b.vy *= 1 - 1.5 * dt; b.vx += (b.cruise - b.vx) * .4 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.ph += dt * 9;
        if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H) flock.splice(i, 1);
      }
    }
    function drawLife() {
      for (const b of flock) sprite(FLAPS[[0, 1, 2, 1][(b.ph | 0) % 4]], b.x - 2, b.y - 1, b.vx < 0, { k: "#2b3a55" });
      for (const s of sparrows) {
        if (s.mode === "perch") sprite(SPARROW[s.peck > 0 ? 1 : 0], s.x - 3, s.y - 4, s.flip, SPR);
        else sprite(FLAPS[[0, 1, 2, 1][(s.ph | 0) % 4]], s.x - 2, s.y - 2, s.flip, { k: SPR.b });
      }
      for (const f of flies) {
        const open = Math.sin(f.ph) > -.2;
        sprite(open ? ["cc.cc", "cckcc", ".ckc."] : [".c.c.", ".ckc.", "..k.."], f.x - 2, f.y - 1, false, { c: f.col, k: "#2b2b2b" });
      }
    }
    // one loose page, 9×12: an outlined sheet with a folded top-right corner and lines of text
    function paper(x, y, frame) {
      const edge = "#b9c2cf", fill = frame ? "#eef1f5" : "#ffffff", fold = "#dfe4eb";
      if (frame === 1) { rect(x + 3, y, 3, 12, edge); rect(x + 4, y + 1, 1, 10, "#eef1f5"); return; }
      rect(x, y, 6, 1, edge); rect(x, y + 1, 1, 11, edge); rect(x + 8, y + 3, 1, 9, edge); rect(x + 1, y + 11, 7, 1, edge);
      rect(x + 1, y + 1, 5, 2, fill); rect(x + 1, y + 3, 7, 8, fill);
      pix(x + 6, y, edge); pix(x + 7, y + 1, edge); pix(x + 8, y + 2, edge);
      pix(x + 6, y + 1, fold); pix(x + 6, y + 2, fold); pix(x + 7, y + 2, fold);
      // the back shows the text faintly through the paper, mirrored
      const ink = frame ? "#d3d9e1" : C.ink;
      rect(frame ? x + 4 : x + 2, y + 2, 3, 1, frame ? ink : "#5b6672");
      for (let r = 0; r < 4; r++) { const w = r === 3 ? 3 : 5; rect(frame ? x + 7 - w : x + 2, y + 4 + r * 2, w, 1, ink); }
    }
    function draw() {
      g.imageSmoothingEnabled = false;
      g.drawImage(sky, 0, 0);
      mx += (tmx - mx) * .12; my += (tmy - my) * .12;
      clouds.forEach((c, i) => g.drawImage(c.img, Math.round(c.x + Math.sin(T * .06 + i * 2) * 5 - mx * (6 + i * 3)), Math.round(c.y - my * 3)));
      g.drawImage(ground, 0, 0);

      // laptop screen: a tiny Synapse map; one link lights up and fires
      const lx = Math.round(W * .62) + 3, ly = gy - 40, sw = 30, sh = 26;
      rect(lx, ly, sw, sh, C.screen);
      rect(lx, ly, sw, 3, "#dfe8f3"); pix(lx + 1, ly + 1, "#e0628a"); pix(lx + 3, ly + 1, "#d9a032"); pix(lx + 5, ly + 1, "#4fb37a");
      const cx = lx + sw / 2, cy = ly + 15, pts = C.dot.map((col, i) => [cx + Math.cos(i / 5 * 6.283 - 1.57) * 9, cy + Math.sin(i / 5 * 6.283 - 1.57) * 8, col]);
      const line = (a, b, col) => { const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); for (let i = 0; i <= n; i++) pix(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, col); };
      line(pts[1], pts[3], "#c8d3e0"); line(pts[2], pts[4], "#c8d3e0"); line(pts[0], pts[2], C.blueLink);
      const on = Math.floor(T * 1.2) % 3 !== 2;
      line(pts[0], pts[1], on ? C.amber : "#e9c690");
      for (const [x, y, col] of pts) { rect(x - 1, y - 1, 3, 3, col); pix(x, y, "#ffffff"); }

      // steam from the mug
      const steamX = Math.round(W * .82) + 2, steamY = gy - 6;
      for (let i = 0; i < 3; i++) { const yy = steamY - i * 3 - (T * 6 % 3); pix(steamX + Math.round(Math.sin(T * 2 + i) * 1), yy, "rgba(255,255,255,.75)"); }

      // loose pages drifting on the breeze; the pointer is a gust that sends them tumbling
      for (const s of sheets) {
        const bx = ((s.x + T * 7 * s.s) % (W + 30)) - 15 - mx * 16 * s.s, by = hz - 30 + Math.sin(T * .6 * s.s + s.ph) * 14 + s.ph * 8 - my * 8;
        const dx = bx + s.ox + 4 - gx, dy = by + s.oy + 6 - gyp, d = Math.hypot(dx, dy);
        if (d < 22) { const k = (22 - d) / 22 * 9; s.vx += dx / (d || 1) * k; s.vy += (dy / (d || 1) - .5) * k; s.spin = 1.5; }
        s.vx -= s.ox * .02; s.vy -= s.oy * .02; s.vx *= .9; s.vy *= .9; s.ox += s.vx * .5; s.oy += s.vy * .5;
        s.spin = Math.max(0, s.spin - .05);
        const x = Math.round(bx + s.ox), y = Math.round(by + s.oy);
        // mostly face-up with an occasional slow turn; a gust makes it tumble fast
        const frame = s.spin ? [0, 1, 2, 1][Math.floor(T * 10 + s.ph) % 4] : [0, 0, 0, 0, 0, 1, 2, 1][Math.floor(T * .5 + s.ph) % 8];
        paper(x, y, frame);
      }
      drawLife();
    }

    function loop(now) {
      if (!last) last = now;
      const dt = Math.min(.1, (now - last) / 1000);
      if (dt >= 1 / 20) { last = now; T += dt; if (visible && sky) { life(dt); draw(); } }
      requestAnimationFrame(loop);
    }
    new ResizeObserver(() => { resize(); if (sky) draw(); }).observe(canvas);
    new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(canvas);
    resize();
    if (reduced) { if (sky) draw(); } else requestAnimationFrame(loop);
    return { scene: () => ({ W, H, hz, gy }) };
  }

  window.Garden = { mount };
})();
