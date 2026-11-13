/* Pixel pieces for the paper maps (landing mini map and the app).
   Papers are pixel sheets with a folded corner and a hard shadow, links are lines of
   square pixels, and tags name each relationship. Two layouts: one paper in focus with
   the papers it relates to around it, or a paper the researcher could write in the middle.
   Everything snaps to a 3-unit grid. */
(function () {
  "use strict";
  const G = 3, INK = "#2b3a33";
  const snap = v => Math.round(v / G) * G;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // a rectangle with stepped pixel corners
  function stepped(x, y, w, h, s) {
    return `M${x + 2 * s} ${y}H${x + w - 2 * s}v${s}h${s}v${s}h${s}V${y + h - 2 * s}h${-s}v${s}h${-s}v${s}H${x + 2 * s}v${-s}h${-s}v${-s}h${-s}V${y + 2 * s}h${s}v${-s}h${s}Z`;
  }
  // a sheet of paper: stepped corners, with the top-right corner folded down
  function sheetPath(x, y, w, h, f) {
    let d = `M${x + 2 * G} ${y}H${x + w - f}`;
    for (let i = 0; i < f / G; i++) d += `h${G}v${G}`;
    return d + `V${y + h - 2 * G}h${-G}v${G}h${-G}v${G}H${x + 2 * G}v${-G}h${-G}v${-G}h${-G}V${y + 2 * G}h${G}v${-G}h${G}Z`;
  }
  function foldPath(x, y, w, f) {
    let d = `M${x + w - f} ${y}`;
    for (let i = 0; i < f / G; i++) d += `h${G}v${G}`;
    return d + `H${x + w - f}Z`;
  }

  /* one paper, centred on 0,0 */
  function sheet({ w, h, field, color, title, note = "", size = 12.5 }) {
    w = snap(w); h = snap(h);
    const x = -snap(w / 2), y = -snap(h / 2), f = 4 * G, tx = x + 10;
    return `<path d="${sheetPath(x + 4, y + 4, w, h, f)}" fill="rgba(27,31,28,.16)"/>
      <g class="sheet">
        <path class="pg" d="${sheetPath(x, y, w, h, f)}" fill="#fffdf8" stroke="${INK}" stroke-width="2"/>
        <path d="${foldPath(x, y, w, f)}" fill="#e2e7ee" stroke="${INK}" stroke-width="2" stroke-linejoin="miter"/>
        <rect x="${tx}" y="${y + 9}" width="6" height="6" fill="${color}"/>
        <text x="${tx + 11}" y="${y + 15}" font-family="Geist Mono, monospace" font-size="${size * .76}" letter-spacing=".05em" fill="#7d857f">${esc(field.toUpperCase())}</text>
        <text x="${tx}" y="${y + 18 + size * 1.2}" font-family="Geist, sans-serif" font-size="${size}" font-weight="500" fill="var(--ink)">${esc(title)}</text>
        <rect x="${tx}" y="${y + h - 13}" width="${snap((w - 20) * .5)}" height="2" fill="#dde2e8"/>
        <rect x="${tx}" y="${y + h - 8}" width="${snap((w - 20) * .3)}" height="2" fill="#dde2e8"/>
        ${note ? `<text x="${x + w - 10}" y="${y + h - 7}" text-anchor="end" font-family="Geist Mono, monospace" font-size="${size * .72}" fill="#9aa19c">${esc(note)}</text>` : ""}
      </g>`;
  }

  /* a label tag, centred on 0,0. lines: [{ text, size, color, mono }] */
  function tagSize(lines, pad = 12) {
    const lh = lines.map(l => l.size * 1.35);
    return { lh, w: snap(Math.max(...lines.map(l => l.text.length * l.size * (l.mono ? .66 : .53))) + pad * 2), h: snap(lh.reduce((a, b) => a + b, 0) + 10) };
  }
  function tag(lines, color, pad = 12) {
    const { lh, w, h } = tagSize(lines, pad), x = -snap(w / 2), y = -snap(h / 2);
    let ty = y + 5, t = "";
    lines.forEach((l, i) => { ty += lh[i]; t += `<text y="${ty - l.size * .32}" text-anchor="middle" font-family="${l.mono ? "Geist Mono, monospace" : "Geist, sans-serif"}" font-size="${l.size}"${l.mono ? ' letter-spacing=".06em"' : ""} fill="${l.color}">${esc(l.text)}</text>`; });
    return `<path d="${stepped(x + 3, y + 3, w, h, 2)}" fill="${color}" opacity=".22"/>
      <g class="tagb"><path class="tg" d="${stepped(x, y, w, h, 2)}" fill="#fff" stroke="${color}" stroke-width="2"/>${t}</g>`;
  }

  /* a line of square pixels along a quadratic curve A→Q→B (or a straight line if Q is null) */
  function line(A, Q, B, color, style = "solid", size = G) {
    Q = Q || [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const len = Math.hypot(Q[0] - A[0], Q[1] - A[1]) + Math.hypot(B[0] - Q[0], B[1] - Q[1]), n = Math.ceil(len / G);
    const seen = new Set(); let out = "", k = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = snap(u * u * A[0] + 2 * u * t * Q[0] + t * t * B[0]), y = snap(u * u * A[1] + 2 * u * t * Q[1] + t * t * B[1]), key = x + "," + y;
      if (seen.has(key)) continue; seen.add(key); k++;
      if (style === "dashed" && k % 4 > 1) continue;
      if (style === "dotted" && k % 3) continue;
      out += `<rect x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="${color}"/>`;
    }
    return out;
  }

  /* a small pixel lightbulb, centred on 0,0: lit for proven, blue while being tested */
  const BULB = ["...oooo...", "..oyyyyo..", ".oywwyyyo.", "oyywyyyyyo", "oyyyyyyyyo", "oyyyyyyyyo", ".oyyyyyyo.", "..oyyyyo..", "...okko...", "...ossso..", "...okkko..", "....oo...."];
  const LIT = { proven: ["#f6c463", "#fff4d6"], testing: ["#a9c6f2", "#e6f0fd"], proposed: ["#e2e5df", "#f4f5f2"] };
  function bulb(state, scale = 2) {
    const [y, w] = LIT[state] || LIT.proposed, pal = { o: INK, y, w, k: "#5b625d", s: "#c7ccc4" };
    const ox = -BULB[0].length * scale / 2, oy = -BULB.length * scale / 2;
    let r = "";
    BULB.forEach((row, ry) => [...row].forEach((ch, rx) => { if (pal[ch]) r += `<rect x="${ox + rx * scale}" y="${oy + ry * scale}" width="${scale}" height="${scale}" fill="${pal[ch]}"/>`; }));
    if (state === "proven") [[-1, -1], [1, -1], [-1.25, .1], [1.25, .1], [0, -1.4]].forEach(([dx, dy]) => {
      r += `<rect class="ray" x="${dx * 15 - scale / 2}" y="${-4 + dy * 13 - scale / 2}" width="${scale}" height="${scale}" fill="#f2b45c"/>`;
    });
    return r;
  }

  /* ---------- the research mind map ----------
     "A paper you could write" sits in the middle. Papers sit around it, ordered so related papers
     are neighbours. Branches run from the idea to the papers it draws on, labelled with
     the part each one plays. Paper-to-paper links are coloured by relationship type. */
  const TYPES = {
    same_mechanism: { name: "Same mechanism", color: "#d9822b", short: "Same mechanism" },
    borrow_method: { name: "Borrow a method", color: "#3d7fd9", short: "Method" },
    answers_gap: { name: "Answers an open question", color: "#16907f", short: "Open question" },
    disagree: { name: "Disagree", color: "#c94848", short: "Disagree" },
    builds_on: { name: "Builds on", color: "#7a5cc9", short: "Builds on" },
    discarded: { name: "Only shares words", color: "#9aa19c", short: "Thrown out" },
  };
  const wrap = (t, n) => t.split(" ").reduce((ls, w) => { const l = ls[ls.length - 1]; if (l && (l + " " + w).length <= n) ls[ls.length - 1] = l + " " + w; else ls.push(w); return ls; }, []);

  // a link's tag: the relationship type, then how the two papers relate in a few plain words
  const linkLines = (c, size) => [{ text: TYPES[c.type].name.toUpperCase(), size: size * .74, color: TYPES[c.type].color, mono: true }, { text: c.relation, size: size * .9, color: "var(--ink)" }];

  function ring(run) {
    // greedy walk so linked papers end up next to each other
    const ids = run.papers.map(p => p.id), live = run.connections.filter(c => c.type !== "discarded"), nb = {};
    ids.forEach(i => { nb[i] = []; });
    live.forEach(c => { nb[c.a.paper].push(c.b.paper); nb[c.b.paper].push(c.a.paper); });
    const order = [], left = new Set(ids);
    let cur = ids.slice().sort((a, b) => nb[a].length - nb[b].length)[0];
    while (left.size) {
      order.push(cur); left.delete(cur);
      cur = nb[cur].filter(u => left.has(u)).sort((a, b) => nb[a].filter(x => left.has(x)).length - nb[b].filter(x => left.has(x)).length)[0] || [...left][0];
    }
    return order;
  }

  function mindmap(run, idea, { w, h, sheet, size = 10.5, pad = 8, allTags = true }) {
    // the page lists the papers the idea is built from, each with the part it plays
    const built = idea.parts.map(pt => { const p = run.papers.find(q => q.id === pt.paper); return [pt.role.toUpperCase(), p.short || p.title]; });
    const deg = id => run.connections.filter(c => c.type !== "discarded" && (c.a.paper === id || c.b.paper === id)).length;
    const rowsMax = Math.max(built.length, Math.min(5, Math.max(...run.papers.map(p => deg(p.id)))));
    const roleW = Math.max(13, ...built.map(b => b[0].length)) * size * .72 * .66 + 10;
    const cw = snap(Math.min(w * .44, Math.max(size * 24, roleW + Math.max(...built.map(b => b[1].length)) * size * .86 * .55 + 30)));
    const title = wrap(idea.title, Math.floor(cw / (size * .62)));
    const listY = size * 3.2 + title.length * size * 1.45 + size * .6;
    const chH = snap(listY + size * 1.3 + rowsMax * size * 1.45 + size * 2.4);
    // papers fill the first ring up to what it can hold, then spill onto bigger rings outside it,
    // so any number of papers fits without sheets overlapping; w and h are the minimum size
    const order = ring(run), n = order.length;
    const maxW = Math.max(...run.papers.map(p => sheet(p)[0])), sh = sheet(run.papers[0])[1], gx = 24, gy = 20;
    let rx0 = w / 2 - maxW / 2 - pad, ry0 = h / 2 - sh / 2 - pad;
    const angle = (c, k) => i => (i + k * .5) / c * Math.PI * 2 - Math.PI / 2;
    const fits = (rx, ry, c, k) => {
      if (c < 2) return true;
      const a = angle(c, k), P = i => [Math.cos(a(i)) * rx, Math.sin(a(i)) * ry];
      for (let i = 0; i < c; i++) { const A = P(i), B = P((i + 1) % c); if (Math.abs(A[0] - B[0]) < maxW + gx && Math.abs(A[1] - B[1]) < sh + gy) return false; }
      return true;
    };
    // grow the inner ring until no paper sits on the idea page in the middle
    let rings;
    for (let tries = 0; tries < 30; tries++) {
      rings = []; let left = n;
      for (let k = 0; left > 0; k++) {
        const rx = rx0 + k * (maxW + gx), ry = ry0 + k * (sh + 44);
        let c = left; while (c > 1 && !fits(rx, ry, c, k)) c--;
        rings.push({ rx, ry, c, k }); left -= c;
      }
      const r = rings[0], a = angle(r.c, 0);
      const clash = [...Array(r.c)].some((_, i) => Math.abs(Math.cos(a(i)) * r.rx) < (cw + maxW) / 2 + 10 && Math.abs(Math.sin(a(i)) * r.ry) < (chH + sh) / 2 + 10);
      if (!clash) break;
      rx0 *= 1.06; ry0 *= 1.06;
    }
    const outer = rings[rings.length - 1];
    w = snap(Math.max(w, 2 * (outer.rx + maxW / 2 + pad))); h = snap(Math.max(h, 2 * (outer.ry + sh / 2 + pad)));
    const cx = w / 2, cy = h / 2, pos = {};
    let idx = 0;
    for (const r of rings) { const a = angle(r.c, r.k); for (let i = 0; i < r.c; i++, idx++) pos[order[idx]] = [snap(cx + Math.cos(a(i)) * r.rx), snap(cy + Math.sin(a(i)) * r.ry)]; }
    // the idea in the middle
    const boxes = run.papers.map(p => { const [sw, shh] = sheet(p); return { x: pos[p.id][0], y: pos[p.id][1], w: sw, h: shh }; }).concat({ x: cx, y: cy, w: cw, h: chH });
    const uses = new Set(idea.parts.map(x => x.paper)), inIdea = new Set(idea.links);
    // role tags sit on the branches, type tags on the links
    const want = [];
    idea.parts.forEach(pt => {
      const P = pos[pt.paper], dx = P[0] - cx, dy = P[1] - cy, l = Math.hypot(dx, dy) || 1;
      want.push({ id: "r:" + pt.paper, x: cx + dx * .5, y: cy + dy * .5, dir: [-dy / l, dx / l], ...tagSize([{ text: pt.role.toUpperCase(), size: size * .78, mono: true }], 8) });
    });
    const curve = {};
    run.connections.filter(c => c.type !== "discarded").forEach(c => {
      const A = pos[c.a.paper], B = pos[c.b.paper], mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = mx - cx, dy = my - cy, l = Math.hypot(dx, dy) || 1;
      const Q = [mx + dx / l * 40, my + dy / l * 40];
      curve[c.id] = { A, B, Q };
      if (allTags || inIdea.has(c.id)) want.push({ id: "c:" + c.id, x: .25 * A[0] + .5 * Q[0] + .25 * B[0], y: .25 * A[1] + .5 * Q[1] + .25 * B[1], dir: [dx / l, dy / l], ...tagSize(linkLines(c, size), 9) });
    });
    const at = {};
    placeTags(want, boxes, { x: 2, y: 2, w: w - 4, h: h - 4 }).forEach(t => { at[t.id] = t; });
    return { pos, cx, cy, cw, chH, title, built, roleW, listY, uses, inIdea, curve, at, size, idea, w, h };
  }

  /* ---------- one paper in focus ----------
     The selected paper sits in the middle. The papers it relates to sit on a ring around it,
     each joined by a straight line that says how. Papers with no direct link are left off
     the map (the app lists them beside it), so the map only shows what connects to what. */
  function focusmap(run, id, { w, h, sheet, size = 12.5, pad = 16 }) {
    const order = Object.keys(TYPES);
    const mine = run.connections.filter(c => c.a.paper === id || c.b.paper === id);
    const liveMine = mine.filter(c => c.type !== "discarded").sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    const other = c => (c.a.paper === id ? c.b.paper : c.a.paper);
    const nearIds = [...new Set(liveMine.map(other))];
    const farIds = run.papers.map(p => p.id).filter(x => x !== id && !nearIds.includes(x));
    // the middle page: sized for its list of connections, like the idea page
    const rows = Math.max(1, Math.min(5, liveMine.length));
    const roleW = Math.max(...Object.values(TYPES).map(t => t.short.length)) * size * .72 * .66 + 14;
    const names = liveMine.map(c => { const p = run.papers.find(q => q.id === other(c)); return (p.short || p.title).length; });
    const self = run.papers.find(p => p.id === id);
    const cw = snap(Math.max(size * 24, roleW + Math.max(10, ...names) * size * .86 * .55 + 30));
    const title = wrap(self.short || self.title, Math.floor(cw / (size * .62)));
    const listY = size * 3.2 + title.length * size * 1.45 + size * .6;
    const chH = snap(listY + size * 1.3 + rows * size * 1.45 + size * 2.4);
    const maxW = Math.max(...run.papers.map(p => sheet(p)[0])), sh = sheet(run.papers[0])[1], gx = 30, gy = 26;
    // rings: grow each one until its sheets stop touching each other (and the page in the middle)
    const place = (count, rx, ry, start) => [...Array(count)].map((_, i) => { const a = start + i / count * Math.PI * 2; return [Math.cos(a) * rx, Math.sin(a) * ry]; });
    const clear = (pts, minX, minY) => pts.every((A, i) => pts.every((B, j) => i === j || Math.abs(A[0] - B[0]) >= maxW + gx || Math.abs(A[1] - B[1]) >= sh + gy))
      && pts.every(P => Math.abs(P[0]) >= minX || Math.abs(P[1]) >= minY);
    const start1 = nearIds.length === 2 ? 0 : -Math.PI / 2;
    let rx = cw / 2 + maxW / 2 + 190, ry = chH / 2 + sh / 2 + 120, near = [];
    for (let t = 0; t < 40; t++) { near = place(nearIds.length, rx, ry, start1); if (clear(near, (cw + maxW) / 2 + 40, (chH + sh) / 2 + 40)) break; rx *= 1.07; ry *= 1.07; }
    const ext = near.length ? near : [[0, 0]];
    w = snap(Math.max(w, 2 * (Math.max(...ext.map(P => Math.abs(P[0]))) + maxW / 2 + pad), cw + 2 * pad));
    h = snap(Math.max(h, 2 * (Math.max(...ext.map(P => Math.abs(P[1]))) + sh / 2 + pad), chH + 2 * pad));
    const cx = w / 2, cy = h / 2, pos = { [id]: [cx, cy] };
    nearIds.forEach((x, i) => { pos[x] = [snap(cx + near[i][0]), snap(cy + near[i][1])]; });
    // straight lines from the middle, each with its tag about halfway out
    const boxes = run.papers.filter(p => nearIds.includes(p.id)).map(p => { const [sw, shh] = sheet(p); return { x: pos[p.id][0], y: pos[p.id][1], w: sw, h: shh }; }).concat({ x: cx, y: cy, w: cw, h: chH });
    const curve = {}, want = [];
    mine.forEach(c => {
      const A = pos[c.a.paper], B = pos[c.b.paper];
      if (!A || !B) return;
      curve[c.id] = { A, B, Q: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] };
      if (c.type === "discarded") return;
      const O = pos[other(c)], dx = O[0] - cx, dy = O[1] - cy, l = Math.hypot(dx, dy) || 1;
      want.push({ id: "c:" + c.id, x: cx + dx * .52, y: cy + dy * .52, dir: [-dy / l, dx / l], ...tagSize(linkLines(c, size), 9) });
    });
    const at = {};
    placeTags(want, boxes, { x: 2, y: 2, w: w - 4, h: h - 4 }).forEach(t => { at[t.id] = t; });
    return { mode: "paper", center: id, pos, cx, cy, cw, chH, roleW, size, curve, at, near: new Set(nearIds), far: new Set(farIds), w, h };
  }

  // the page in the middle of the map: a label, a title, a short list, and a footer line
  function centerPage(M, { label, labelColor, title, head, rows, foot, footColor, fill, fold, shadow, icon }) {
    const { cw, size, roleW } = M, f = 4 * G;
    const lines = wrap(title, Math.floor(cw / (size * .62)));
    const listY = size * 3.2 + lines.length * size * 1.45 + size * .6;
    const h = snap(Math.max(M.chH, listY + size * 1.3 + rows.length * size * 1.45 + size * 2.4)), x = -cw / 2, y = -snap(h / 2);
    let t = `<text x="${x + (icon ? 30 : 12)}" y="${y + size * 1.7}" font-family="Geist Mono, monospace" font-size="${size * .76}" letter-spacing=".08em" fill="${labelColor}">${esc(label)}</text>`;
    lines.forEach((l, i) => { t += `<text x="${x + 12}" y="${y + size * 3.5 + i * size * 1.45}" font-family="Geist, sans-serif" font-size="${size * 1.12}" font-weight="600" fill="var(--ink)">${esc(l)}</text>`; });
    t += `<rect x="${x + 12}" y="${y + listY - size * .2}" width="${cw - 24}" height="1" fill="${fold}"/>
      <text x="${x + 12}" y="${y + listY + size * .95}" font-family="Geist Mono, monospace" font-size="${size * .7}" letter-spacing=".08em" fill="${labelColor}">${esc(head)}</text>`;
    rows.forEach(([left, name, color], i) => {
      const ry = y + listY + size * 1.3 + (i + 1) * size * 1.45 - size * .3;
      t += `<text x="${x + 12}" y="${ry}" font-family="Geist Mono, monospace" font-size="${size * .72}" letter-spacing=".04em" fill="${color || "#7d857f"}">${esc(left)}</text>
        <text x="${x + 12 + roleW}" y="${ry}" font-family="Geist, sans-serif" font-size="${size * .86}" fill="var(--ink)">${esc(name)}</text>`;
    });
    t += `<rect x="${x + 12}" y="${y + h - size * 1.55}" width="6" height="6" fill="${footColor}"/><text x="${x + 22}" y="${y + h - size * .95}" font-family="Geist, sans-serif" font-size="${size * .82}" fill="${footColor}">${esc(foot)}</text>`;
    return `<path d="${sheetPath(x + 5, y + 5, cw, h, f)}" fill="${shadow}"/>
      <g class="sheet"><path class="pg" d="${sheetPath(x, y, cw, h, f)}" fill="${fill}" stroke="${INK}" stroke-width="2"/>
      <path d="${foldPath(x, y, cw, f)}" fill="${fold}" stroke="${INK}" stroke-width="2"/>
      ${icon ? `<g transform="translate(${x + 18},${y + size * 1.25}) scale(.7)">${bulb("proven")}</g>` : ""}${t}</g>`;
  }
  // the idea: a yellow draft page listing the papers it is built from
  function ideaNode(M) {
    const novel = { new: ["Nothing close found", "#2f7a4c"], partly: ["Close work exists", "#9a5a17"], checking: ["Searching published work", "#3d7fd9"], known: ["Already published", "#c94848"] }[M.idea.novelty.state] || ["Not searched yet", "#7d857f"];
    return centerPage(M, { label: "A PAPER YOU COULD WRITE", labelColor: "#9a5a17", title: M.idea.title, head: "BUILT FROM", rows: M.built,
      foot: novel[0], footColor: novel[1], fill: "#fff4d6", fold: "#f2d9a6", shadow: "rgba(217,130,43,.28)", icon: true });
  }
  // a selected paper: a blue page listing every paper it connects to, and how
  function focusNode(M, run, id) {
    const p = run.papers.find(q => q.id === id);
    const links = run.connections.filter(c => c.type !== "discarded" && (c.a.paper === id || c.b.paper === id));
    const rows = links.slice(0, 5).map(c => { const o = run.papers.find(q => q.id === (c.a.paper === id ? c.b.paper : c.a.paper)); return [TYPES[c.type].short.toUpperCase(), o.short || o.title, TYPES[c.type].color]; });
    if (links.length > 5) rows[4] = ["", `and ${links.length - 4} more`, "#7d857f"];
    return centerPage(M, { label: `SELECTED PAPER · ${p.field.toUpperCase()}`, labelColor: "#2d68b8", title: p.short || p.title,
      head: links.length ? `CONNECTED TO ${links.length} PAPER${links.length === 1 ? "" : "S"}` : "NO CONNECTIONS YET", rows,
      foot: "Click a line to read how they relate", footColor: "#5b625d", fill: "#e9f1fd", fold: "#c4d8f4", shadow: "rgba(61,127,217,.25)" });
  }
  function branch(M, pt) {
    const P = M.pos[pt.paper], t = M.at["r:" + pt.paper];
    return `<g class="dots">${line([M.cx, M.cy], null, P, "#7d857f", "dotted")}</g>
      <g transform="translate(${t.x},${t.y})">${tag([{ text: pt.role.toUpperCase(), size: M.size * .78, color: "#5b625d", mono: true }], "#7d857f", 8)}</g>`;
  }
  function typedLink(M, c, motion = true) {
    const T = TYPES[c.type], k = M.curve[c.id], t = M.at["c:" + c.id], d = `M${k.A[0]} ${k.A[1]} Q${k.Q[0]} ${k.Q[1]} ${k.B[0]} ${k.B[1]}`;
    const spark = motion && c.status === "proven" ? `<rect class="spark" x="-2" y="-2" width="4" height="4" fill="#fff" stroke="${T.color}"><animateMotion dur="3s" repeatCount="indefinite" path="${d}"/></rect>` : "";
    return `<g class="dots">${line(k.A, k.Q, k.B, T.color, c.status === "testing" ? "dashed" : "solid")}</g><path class="hit" d="${d}"/>${spark}
      ${t ? `<g transform="translate(${t.x},${t.y})">${tag(linkLines(c, M.size), T.color, 9)}</g>` : ""}`;
  }

  /* move each tag the shortest distance (trying 8 directions, further each ring) until it
     clears the sheets, the tags already placed, and stays inside the map. Boxes are centred. */
  function placeTags(tags, sheets, bounds) {
    const gap = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w + 10 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 8;
    const inside = c => !bounds || (c.x - c.w / 2 >= bounds.x && c.x + c.w / 2 <= bounds.x + bounds.w && c.y - c.h / 2 >= bounds.y && c.y + c.h / 2 <= bounds.y + bounds.h);
    const placed = [];
    for (const t of tags) {
      const [nx, ny] = t.dir, dirs = [[nx, ny], [-nx, -ny], [-ny, nx], [ny, -nx], [nx - ny, ny + nx], [nx + ny, ny - nx], [-nx - ny, nx - ny], [ny - nx, -nx - ny]];
      // first spot that is completely clear; failing that, the spot that overlaps least
      const over = (a, b) => Math.max(0, Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2) + 10) * Math.max(0, Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2) + 8);
      let best = null, least = null, leastCost = Infinity;
      search: for (let r = 0; r <= 34; r++) for (const [dx, dy] of r ? dirs : [[0, 0]]) {
        const l = Math.hypot(dx, dy) || 1, c = { ...t, x: t.x + dx / l * r * 9, y: t.y + dy / l * r * 9 };
        if (!inside(c)) continue;
        if (!sheets.some(s => gap(c, s)) && !placed.some(p => gap(c, p))) { best = c; break search; }
        const cost = sheets.reduce((a, s) => a + over(c, s), 0) + placed.reduce((a, p) => a + over(c, p) * 2, 0) + r;
        if (cost < leastCost) { leastCost = cost; least = c; }
      }
      best = best || least || { ...t };
      best.x = snap(best.x); best.y = snap(best.y); placed.push(best);
    }
    return placed;
  }

  window.PixelMap = { G, snap, sheet, tag, tagSize, placeTags, line, bulb, stepped, TYPES, ring, mindmap, focusmap, ideaNode, focusNode, branch, typedLink };
})();
