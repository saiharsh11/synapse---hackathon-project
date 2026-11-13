/* The thread scene on the landing page.
   A pile of papers is lifted apart by a breeze and drifts in the air. Threads reach between the
   papers that relate; the Challenger runs along each one, ties off the links that hold, and lets
   the weak ones snap. Drawn in pixels to match the hero; the labels are plain HTML so they stay sharp. */
window.Threads = (() => {
  "use strict";
  let S = 5;              // one pixel of a paper sprite, in CSS px (sprite is 9×12); 4 on phones
  const PX = 3;           // one pixel of thread
  const N = 20;           // points along a thread
  const GRAV = .36;
  const INK = "#1b1f1c", ASH = "#c3c7c1", RED = "#c94848", TWINE = "#8a6a3f", SPARK = "#fff6c8";
  // a tight knot on the thread: a rounded lump with a highlight and the wrap of the thread across it
  const KNOT = [".XXXXX.", "XOHOXOX", "XOOXOOX", "XOXOOOX", ".XXXXX."];
  const nextFrame = cb => { let done = false; const go = () => { if (!done) { done = true; cb(performance.now()); } }; requestAnimationFrame(go); setTimeout(go, 34); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  function mount(root, { papers, links, fieldColor, typeColor, typeName, caption, reduced, esc }) {
    const cv = root.querySelector("canvas"), ctx = cv.getContext("2d"), tagBox = root.querySelector(".tags"), tip = root.querySelector(".tip");
    let W = 0, H = 0, T = 0, runId = 0, visible = false, looping = false;

    const P = papers.map((p, i) => ({ p, i, x: 0, y: 0, vx: 0, vy: 0, hx: 0, hy: 0, ph: i * 1.7, spin: 0, out: true }));
    const byId = Object.fromEntries(P.map(o => [o.p.id, o]));
    const L = links.filter(c => byId[c.a.paper] && byId[c.b.paper]).map(c => ({
      c, a: byId[c.a.paper], b: byId[c.b.paper], weak: c.type === "discarded",
      pts: [], prev: [], rest: 0, shown: false, head: null, endPinned: false, broken: -1, color: TWINE, glint: -1, glintBad: false, knot: 0, sparks: [],
    }));
    const streaks = [];

    // labels: a coloured tag above each paper; hover, focus or tap opens it to the paper's name
    tagBox.innerHTML = P.map(o => `<button type="button" class="ptag" style="--c:${fieldColor[o.p.field]}" aria-label="${esc(o.p.title)}, ${esc(o.p.field)}"><i></i><span class="f">${esc(o.p.field)}</span><span class="n">${esc(o.p.short || o.p.title)}</span></button>`).join("");
    const tags = [...tagBox.children];
    tags.forEach(t => t.addEventListener("click", () => { const open = !t.classList.contains("open"); tags.forEach(x => x.classList.remove("open")); t.classList.toggle("open", open); }));

    // where each paper floats: the most connected one in the middle, the rest on a ring around it
    const degree = o => L.filter(l => l.a === o || l.b === o).length;
    function layout() {
      const r = root.getBoundingClientRect(), d = devicePixelRatio || 1;
      W = r.width; H = r.height;
      cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.width = W + "px"; cv.style.height = H + "px";
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.imageSmoothingEnabled = false;
      S = W < 640 ? 4 : 5;
      const order = P.slice().sort((a, b) => degree(b) - degree(a)), hub = order[0], rest = order.slice(1);
      if (W < 640) {
        // narrow: a zig-zag down the scene, two papers to a row
        const rows = Math.ceil(P.length / 2), top = 44, gap = (H - top - 12 * S - 40) / Math.max(1, rows - 1 + .3);
        order.forEach((o, k) => { const r = k >> 1, left = (k + r) % 2 === 0; o.hx = (left ? W * .27 : W * .73) - 4.5 * S + (r % 2 ? 8 : -8); o.hy = top + r * gap + (left ? 0 : gap * .3); });
        return;
      }
      const cx = W / 2 - 4.5 * S, cy = H / 2 - 6 * S + 8, rx = W / 2 - 9 * S - 54, ry = H / 2 - 12 * S - 34;   // leaves room to drift
      hub.hx = cx; hub.hy = cy;
      rest.forEach((o, k) => { const t = -Math.PI * .82 + k / rest.length * Math.PI * 2; o.hx = cx + Math.cos(t) * rx; o.hy = cy + Math.sin(t) * ry; });
    }
    const anchor = o => [o.x + 4.5 * S, o.y + 6 * S];
    const stackAt = o => [W / 2 - 4.5 * S + (o.i % 2 ? 3 : -3), H - 12 * S - 22 - o.i * 4];

    // ---- threads (a small Verlet rope) ----
    function lay(l, a, b, slack) {
      l.pts = Array.from({ length: N }, (_, k) => [a[0] + (b[0] - a[0]) * k / (N - 1), a[1] + (b[1] - a[1]) * k / (N - 1)]);
      l.prev = l.pts.map(p => p.slice()); l.rest = dist(a, b) * slack / (N - 1);
    }
    function physics(l) {
      const a = anchor(l.a), b = anchor(l.b);
      for (let k = 1; k < N; k++) {
        const p = l.pts[k], q = l.prev[k], vx = (p[0] - q[0]) * .985, vy = (p[1] - q[1]) * .985;
        q[0] = p[0]; q[1] = p[1]; p[0] += vx; p[1] += vy + GRAV;
      }
      for (let it = 0; it < 14; it++) {
        l.pts[0][0] = a[0]; l.pts[0][1] = a[1];
        if (l.head) { l.pts[N - 1][0] = l.head[0]; l.pts[N - 1][1] = l.head[1]; }
        else if (l.endPinned) { l.pts[N - 1][0] = b[0]; l.pts[N - 1][1] = b[1]; }
        for (let k = 0; k < N - 1; k++) {
          if (k === l.broken) continue;
          const p = l.pts[k], q = l.pts[k + 1], dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy) || 1e-3, f = (d - l.rest) / d / 2;
          p[0] += dx * f; p[1] += dy * f; q[0] -= dx * f; q[1] -= dy * f;
        }
      }
    }
    const along = (l, f) => { const x = f * (N - 1), k = Math.min(N - 2, Math.floor(x)), u = x - k, p = l.pts[k], q = l.pts[k + 1]; return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]; };
    const burst = (l, col, n = 12) => { const m = l.pts[N >> 1]; for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2; l.sparks.push({ x: m[0], y: m[1], vx: Math.cos(t) * 2.2, vy: Math.sin(t) * 2.2 - 1, life: 30, c: col }); } };

    // ---- drawing ----
    const dot = (x, y, s = PX) => ctx.fillRect(Math.round(x / PX) * PX - (s >> 1), Math.round(y / PX) * PX - (s >> 1), s, s);
    const block = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    // one loose page, as in the hero: outlined sheet, folded corner, lines of text (frame 1 edge-on, 2 the back)
    function sheet(o) {
      const x = Math.round(o.x), y = Math.round(o.y), q = (cx, cy, w, h, col) => block(x + cx * S, y + cy * S, w * S, h * S, col);
      // tumbling in a gust, or now and then a slow turn over and back
      const turn = (T * .06 + o.ph * .37) % 1, frame = o.spin > 0 ? [0, 1, 2, 1][Math.floor(T * 10 + o.ph) % 4] : turn > .93 ? [1, 2, 2, 1][Math.floor((turn - .93) / .07 * 4)] : 0, edge = "#9fa9b6";
      if (frame === 1) { q(3, 0, 3, 12, edge); q(4, 1, 1, 10, "#eef1f5"); return; }
      ctx.fillStyle = "rgba(27,31,28,.12)"; ctx.fillRect(x + 3, y + 12 * S + 4, 8 * S, 3);   // a soft shadow below
      const fill = frame ? "#eef1f5" : "#ffffff";
      q(0, 0, 6, 1, edge); q(0, 1, 1, 11, edge); q(8, 3, 1, 9, edge); q(1, 11, 7, 1, edge);
      q(1, 1, 5, 2, fill); q(1, 3, 7, 8, fill);
      q(6, 0, 1, 1, edge); q(7, 1, 1, 1, edge); q(8, 2, 1, 1, edge); q(6, 1, 1, 2, "#dfe4eb"); q(7, 2, 1, 1, "#dfe4eb");
      const col = fieldColor[o.p.field];
      if (frame === 2) { for (let r = 0; r < 4; r++) q(r === 3 ? 4 : 2, 4 + r * 2, r === 3 ? 3 : 5, 1, "#d3d9e1"); return; }
      q(2, 2, 3, 1, col);                                                    // the title line, in the field's colour
      for (let r = 0; r < 4; r++) q(2, 4 + r * 2, r === 3 ? 3 : 5, 1, "#8d96a0");
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      for (const s of streaks) { ctx.globalAlpha = Math.min(1, s.life / 20) * .8; block(Math.round(s.x / PX) * PX, Math.round(s.y / PX) * PX, s.len, PX, "#ffffff"); }
      ctx.globalAlpha = 1;
      for (const l of L) {
        if (!l.shown) continue;
        ctx.fillStyle = l.color;
        for (let k = 0; k < N - 1; k++) {
          if (k === l.broken) continue;
          const p = l.pts[k], q = l.pts[k + 1], n = Math.max(1, Math.ceil(dist(p, q) / 1.5));
          for (let j = 0; j <= n; j++) dot(p[0] + (q[0] - p[0]) * j / n, p[1] + (q[1] - p[1]) * j / n);
        }
      }
      for (const o of P.slice().sort((a, b) => a.y - b.y)) sheet(o);
      for (const l of L) {
        if (!l.shown) continue;
        if (l.glint >= 0) for (let t = 0; t < 4; t++) { const g = along(l, Math.max(0, l.glint - t * .03)); ctx.fillStyle = t ? (l.glintBad ? RED : "#ffd479") : SPARK; dot(g[0], g[1], t ? 7 - t : 9); }
        if (l.knot > 0) {
          const m = l.pts[N >> 1], s = Math.max(1, Math.round(l.knot * PX));
          KNOT.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") block(Math.round(m[0] + (x - 3) * s), Math.round(m[1] + (y - 2) * s), s, s, ch === "X" ? INK : ch === "H" ? SPARK : l.color); }));
        }
        l.sparks = l.sparks.filter(sp => (sp.life -= 1) > 0);
        for (const sp of l.sparks) { sp.x += sp.vx; sp.y += sp.vy; sp.vy += .12; ctx.globalAlpha = sp.life / 30; ctx.fillStyle = sp.c; dot(sp.x, sp.y); }
        ctx.globalAlpha = 1;
      }
      // labels ride above their papers
      P.forEach((o, k) => { tags[k].style.transform = `translate(${Math.round(o.x + 4.5 * S)}px, ${Math.round(o.y - 6)}px) translate(-50%, -100%)`; });
    }

    // ---- motion: papers spring toward their spot and bob; a pointer is a small gust ----
    let pointer = null;
    function step() {
      T += 1 / 30;
      const amp = W < 640 ? .5 : 1;
      for (const o of P) {
        if (!o.out) continue;
        // each paper wanders slowly around its spot, on its own path
        const tx = o.hx + (Math.sin(T * .21 + o.ph) * 26 + Math.sin(T * .53 + o.ph * 2) * 6) * amp;
        const ty = o.hy + (Math.sin(T * .27 + o.ph * 1.3) * 18 + Math.sin(T * .71 + o.ph) * 5) * amp;
        o.vx += (tx - o.x) * .01; o.vy += (ty - o.y) * .01;
        if (pointer) { const dx = o.x + 4.5 * S - pointer[0], dy = o.y + 6 * S - pointer[1], d = Math.hypot(dx, dy); if (d < 70) { o.vx += dx / d * 1.4; o.vy += dy / d * 1.4; o.spin = Math.max(o.spin, .4); } }
        o.vx *= .93; o.vy *= .93; o.x += o.vx; o.y += o.vy; o.spin = Math.max(0, o.spin - 1 / 30);
      }
      for (const s of streaks) { s.x += s.v; s.life--; }
      for (let k = streaks.length - 1; k >= 0; k--) if (streaks[k].life <= 0 || streaks[k].x > W) streaks.splice(k, 1);
      for (const l of L) if (l.shown) physics(l);
    }
    function loop() { if (!looping) return; step(); draw(); nextFrame(loop); }
    const startLoop = () => { if (!looping && !reduced) { looping = true; nextFrame(loop); } };

    root.addEventListener("pointermove", e => {
      const r = root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      pointer = [x, y];
      // hovering a thread says which link it is
      let best = null, bd = 10;
      for (const l of L) if (l.shown && l.knot + (l.broken >= 0 ? 1 : 0) > 0) for (const p of l.pts) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = l; } }
      if (best) {
        tip.innerHTML = best.weak ? `<b style="color:${RED}">Snapped</b> ${esc(best.c.relation)}` : `<b style="color:${typeColor(best.c.type)}">${esc(typeName(best.c.type))}</b> ${esc(best.c.headline)}`;
        tip.hidden = false; tip.style.transform = `translate(${Math.min(x + 14, W - 260)}px, ${y + 14}px)`;
      } else tip.hidden = true;
    });
    root.addEventListener("pointerleave", () => { pointer = null; tip.hidden = true; });

    // ---- the finished picture (also what shows before the scene plays, and with reduced motion) ----
    const nHeld = L.filter(l => !l.weak).length, nSnap = L.length - nHeld;
    const END = `${nHeld} thread${nHeld === 1 ? "" : "s"} held and ${nSnap} snapped. Only links that hold up reach your map.`;
    function settle() {
      runId++; layout();
      P.forEach(o => { o.out = true; o.x = o.hx; o.y = o.hy; o.vx = o.vy = 0; o.spin = 0; });
      tags.forEach(t => t.classList.add("on"));
      for (const l of L) {
        Object.assign(l, { shown: true, head: null, endPinned: true, glint: -1, sparks: [], broken: l.weak ? N >> 1 : -1, color: l.weak ? ASH : typeColor(l.c.type), knot: l.weak ? 0 : 1 });
        lay(l, anchor(l.a), anchor(l.b), l.weak ? 1.15 : 1.04);
        if (l.weak) l.rest = Math.min(l.rest, 58 / (N >> 1));   // the broken ends dangle just below their papers
        for (let k = 0; k < (l.weak ? 300 : 100); k++) physics(l);
      }
      draw(); caption(END);
    }

    // ---- the scene ----
    const tween = (ms, fn) => new Promise(done => { const t0 = performance.now(); const go = now => { const t = Math.min(1, (now - t0) / ms); fn(t); t < 1 ? nextFrame(go) : done(); }; nextFrame(go); });
    async function thread(l, live) {
      const a = anchor(l.a), b = anchor(l.b), full = dist(a, b) * 1.16 / (N - 1);
      lay(l, a, [a[0] + .5, a[1] + .5], 1); l.rest = .1; l.color = TWINE; l.endPinned = false; l.shown = true; l.head = a.slice();
      const len = dist(a, b), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len, side = ny > 0 ? -1 : 1;   // arc upward
      await tween(1000, t => {
        const A = anchor(l.a), B = anchor(l.b), e = 1 - Math.pow(1 - t, 3), sway = side * (Math.sin(Math.PI * t) * 30 + Math.sin(t * Math.PI * 5) * 9 * (1 - t));
        l.head = [A[0] + (B[0] - A[0]) * e + nx * sway, A[1] + (B[1] - A[1]) * e + ny * sway];
        l.rest = full * Math.max(.05, e);
      });
      if (!live()) return;
      l.head = null; l.endPinned = true;                       // it catches on the other paper
      l.b.vx += (b[0] - a[0]) / len * 1.5; l.b.vy += (b[1] - a[1]) / len * 1.5;
      await wait(260); if (!live()) return;
      l.glintBad = false;
      await tween(700, t => { l.glint = l.weak ? Math.min(t * 1.3, .5) : t; if (l.weak && t > .5) l.glintBad = true; });
      if (!live()) return;
      l.glint = -1;
      if (l.weak) {
        l.color = RED; l.broken = N >> 1; burst(l, RED, 8);
        const r0 = l.rest, stub = Math.min(r0, 58 / (N >> 1));
        tween(600, t => { l.rest = r0 + (stub - r0) * t; });   // the frayed ends spring back
        caption(`One thread snaps: ${l.c.relation.charAt(0).toLowerCase() + l.c.relation.slice(1)}.`);
        await wait(700); l.color = ASH;
      } else {
        await tween(260, t => { l.rest = full / 1.16 * (1.16 - .12 * t); });
        l.color = typeColor(l.c.type); burst(l, l.color);
        await tween(240, t => { l.knot = Math.round(t * 3) / 3; });
      }
    }
    async function play() {
      const id = ++runId, live = () => id === runId;
      layout(); startLoop();
      P.forEach(o => { [o.x, o.y] = stackAt(o); o.vx = o.vy = 0; o.out = false; o.spin = 0; });
      tags.forEach(t => t.classList.remove("on", "open"));
      L.forEach(l => Object.assign(l, { shown: false, knot: 0, glint: -1, sparks: [], broken: -1 }));
      caption(`${P.length} papers from ${new Set(papers.map(p => p.field)).size} fields, in one pile.`);
      await wait(1100); if (!live()) return;
      caption("A breeze lifts them apart…");
      for (let k = 0; k < 26; k++) streaks.push({ x: -Math.random() * W * .6, y: H * (.15 + Math.random() * .75), v: 6 + Math.random() * 6, len: PX * (3 + (Math.random() * 6 | 0)), life: 70 + Math.random() * 40 });
      for (const o of P) {
        if (!live()) return;
        o.out = true; o.spin = 1.1; o.vx = (o.hx - o.x) * .05 + 3; o.vy = -7 - Math.random() * 3;
        tags[o.i].classList.add("on");
        await wait(140);
      }
      await wait(1500); if (!live()) return;
      caption("Threads reach between papers that share something. The Challenger runs along each one.");
      // weak links go in the middle of the sequence, so the snap lands while others are being tied
      const order = L.filter(l => !l.weak), weak = L.filter(l => l.weak);
      order.splice(Math.min(2, order.length), 0, ...weak);
      const all = order.map((l, k) => wait(k * 850).then(() => live() && thread(l, live)));
      await Promise.all(all);
      if (live()) caption(END);
    }

    settle();
    let played = false;
    new IntersectionObserver(es => {
      visible = es[0].isIntersecting;
      if (visible) startLoop(); else looping = false;
      if (visible && !played && !reduced && es[0].intersectionRatio >= .4) { played = true; play(); }
    }, { threshold: [0, .4] }).observe(root);
    let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(settle, 150); });
    return { replay: () => { played = true; reduced ? settle() : play(); } };
  }
  return { mount };
})();
