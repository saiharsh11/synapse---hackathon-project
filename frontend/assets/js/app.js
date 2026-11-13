/* The map app: findings and papers, a labelled map of links, and a context panel
   (agents at work / a finding's story / a paper). Reads the run format the backend produces. */
(async function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = SynapseCharts.esc;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // The latest run on this server, made from papers someone added. Before the first run the map is empty:
  // nothing is shown that no one asked Synapse to read.
  const getJson = u => fetch(u, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const EMPTY = { run: { title: "No papers yet", empty: true, cost_usd: 0, seconds: 0, funnel: { papers: 0, ideas: 0, pairs: 0, shortlisted: 0 } },
                  papers: [], connections: [], candidates: [], next_papers: [] };
  const run = await getJson("/api/runs/latest") || EMPTY;
  // links that came from a model or a search open only as ordinary web addresses
  const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? esc(x.href) : "#"; } catch { return "#"; } };
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const paper = id => run.papers.find(p => p.id === id);
  const conn = id => run.connections.find(c => c.id === id);

  const LIGHT = ["#3f9a64", "#d65a7f", "#8aa43a", "#6d62d6", "#2f86c9", "#b558c9", "#2fa3a3", "#c98a2f"];
  const fieldColor = {}; let fi = 0;
  run.papers.forEach(p => { if (!fieldColor[p.field]) fieldColor[p.field] = LIGHT[fi++ % LIGHT.length]; });
  const T = PixelMap.TYPES, idea = id => (run.next_papers || []).find(n => n.id === id);
  const SIM = false;   // simulations aren't built: nothing about them is shown
  const WORD = { proven: "Checked against both papers", verified: "Checked against both papers", testing: "Checked against both papers", rejected: "Thrown out" };
  const f = run.run.funnel;
  const byStatus = s => run.connections.filter(c => c.status === s);
  const live = run.connections.filter(c => c.type !== "discarded");
  const degree = id => live.filter(c => c.a.paper === id || c.b.paper === id).length;

  Sky.mount($("#sky"), { mode: "stage" });
  $("#runTitle").textContent = run.run.title;
  $("#replay").hidden = !!run.run.empty;

  /* ---------- the map ----------
     By default one paper is in focus: it sits in the middle and every paper it relates to sits
     around it, joined by a line that says how. Opening a paper you could write switches to the
     idea view: the idea in the middle, the papers it draws on around it. */
  const svg = $("#map"), n = run.papers.length, W = 900, H = 740;
  const sheetW = p => Math.max((p.short || p.title).length * 8, p.field.length * 7 + 50) + 34;
  // a run may have no paper ideas yet: an empty one keeps every view working
  let current = run.next_papers[0] || { id: "", title: "", parts: [], links: [] }, M = null, pos = {};
  // start on the paper with the most connections: it shows the most at a glance
  let mapMode = "paper", focus = (run.papers.slice().sort((a, b) => degree(b.id) - degree(a.id))[0] || {}).id;
  function cardInner(p, far) {
    const k = degree(p.id);
    return PixelMap.sheet({ w: sheetW(p), h: 63, field: p.field, color: fieldColor[p.field], title: p.short || p.title, note: far ? "no direct link" : `${k} link${k === 1 ? "" : "s"}`, size: 14.5 });
  }
  const shortName = id => { const p = paper(id); return p.short || p.title; };
  // a thrown-out link: a grey dotted line, only shown when asked for
  function discardInner(c) {
    const A = pos[c.a.paper], B = pos[c.b.paper], mx = PixelMap.snap((A[0] + B[0]) / 2), my = PixelMap.snap((A[1] + B[1]) / 2);
    return `<g class="dots">${PixelMap.line(A, null, B, T.discarded.color, "dotted")}</g><path class="hit" d="M${A[0]} ${A[1]}L${B[0]} ${B[1]}"/>
      <g transform="translate(${mx},${my})">${PixelMap.tag([{ text: "THROWN OUT", size: 9.5, color: T.discarded.color, mono: true }, { text: c.relation, size: 12.5, color: "var(--ink2)" }], T.discarded.color)}</g>`;
  }
  function renderMap() {
    if (run.run.empty) {
      svg.innerHTML = "";
      $("#mapNote").innerHTML = `<span class="mnK">No papers yet</span><b>Add PDFs or links on the Add page.</b> The map fills in when Synapse has read them.`;
      return;
    }
    if (mapMode === "idea" && !current.id) mapMode = "paper";   // no ideas yet: show papers instead
    mapNote(); syncViewSw();
    $("#farBox").innerHTML = "";
    if (mapMode === "paper") return renderFocus();
    if (mapMode === "field") return renderFields();
    svg.dataset.mode = "idea";
    $("#phoneList").innerHTML = `<h2 class="lab">What each paper gives this idea</h2><ul class="parts">${current.parts.map(pt => `<li><button data-p="${pt.paper}"><span class="role">${esc(pt.role)}</span><span><b>${esc(shortName(pt.paper))}</b><span class="pdet">${esc(pt.detail)}</span></span></button></li>`).join("")}</ul>`;
    $(".howto").innerHTML = `<b>Idea view:</b> the yellow page is a paper you could write. Grey dotted branches show what each paper gives it. Coloured lines show how two papers relate. Click a paper to go back to seeing its connections.`;
    M = PixelMap.mindmap(run, current, { w: W, h: H, sheet: p => [sheetW(p), 63], size: 12.5, pad: 16 });
    pos = M.pos; fit();
    svg.innerHTML = `<g id="cands"></g>
      <g id="links">${run.connections.map(c => `<g class="link${c.type === "discarded" ? " discard" : ""}" data-c="${c.id}" tabindex="0" role="button" aria-label="${esc(T[c.type].name)}: ${esc(c.headline)}"><title>${esc(T[c.type].name)}: ${esc(c.headline)}. Click to read how they relate.</title>${c.type === "discarded" ? discardInner(c) : PixelMap.typedLink(M, c, !reduced)}</g>`).join("")}</g>
      <g id="branches">${current.parts.map(pt => `<g class="br" data-p="${pt.paper}">${PixelMap.branch(M, pt)}</g>`).join("")}</g>
      <g id="cards">${run.papers.map(p => `<g class="card" data-p="${p.id}" transform="translate(${pos[p.id]})" tabindex="0" role="button" aria-label="${esc(p.title)}">${cardInner(p)}</g>`).join("")}</g>
      <g class="idea" data-n="${current.id}" transform="translate(${M.cx},${M.cy})" tabindex="0" role="button" aria-label="A paper you could write: ${esc(current.title)}">${PixelMap.ideaNode(M)}</g>`;
  }

  function renderFocus() {
    svg.dataset.mode = "paper";
    M = PixelMap.focusmap(run, focus, { w: W, h: H, sheet: p => [sheetW(p), 63], size: 12.5, pad: 16 });
    pos = M.pos; fit();
    const mine = run.connections.filter(c => (c.a.paper === focus || c.b.paper === focus) && M.curve[c.id]);
    svg.innerHTML = `<g id="cands"></g>
      <g id="links">${mine.map(c => `<g class="link${c.type === "discarded" ? " discard" : ""}" data-c="${c.id}" tabindex="0" role="button" aria-label="${esc(T[c.type].name)}: ${esc(c.headline)}"><title>${esc(T[c.type].name)}: ${esc(c.headline)}. Click to read how they relate.</title>${c.type === "discarded" ? discardInner(c) : PixelMap.typedLink(M, c, !reduced)}</g>`).join("")}</g>
      <g id="cards">${run.papers.filter(p => M.near.has(p.id)).map(p => `<g class="card" data-p="${p.id}" transform="translate(${pos[p.id]})" tabindex="0" role="button" aria-label="${esc(p.title)}">${cardInner(p)}</g>`).join("")}</g>
      <g class="center" data-p="${focus}" transform="translate(${M.cx},${M.cy})" tabindex="0" role="button" aria-label="Selected paper: ${esc(paper(focus).title)}">${PixelMap.focusNode(M, run, focus)}</g>`;
    const k = M.near.size;
    $(".howto").innerHTML = `<b>${esc(shortName(focus))}</b> is in the middle. ${k ? `The ${k} paper${k === 1 ? "" : "s"} around it relate to it, and each line says how. Click a line for the full explanation.` : "None of your other papers link to it yet."} Click any other paper to move it to the middle.`;
    // on phones the map is a preview; this list says the same thing in readable cards
    const rels = live.filter(c => (c.a.paper === focus || c.b.paper === focus) && (filter === "all" || filter === c.type));
    $("#phoneList").innerHTML = `<h2 class="lab">How ${esc(shortName(focus))} relates to the others</h2>
      <ul class="connList rels">${rels.map(c => relRow(c, focus)).join("") || '<li class="meta">No relationships yet.</li>'}</ul>`;
    // papers with no direct link are listed beside the map, one click from the middle
    $("#farBox").innerHTML = M.far.size ? `<span class="mnK">No direct link to ${esc(shortName(focus))}</span><div>${[...M.far].map(id => `<button data-p="${id}"><i style="background:${fieldColor[paper(id).field]}"></i>${esc(shortName(id))}</button>`).join("")}</div>` : "";
  }
  /* ---------- whole map: one box per field, its papers inside, lines between fields ----------
     A line between two boxes means papers in those fields relate; its label says how many. */
  function renderFields() {
    svg.dataset.mode = "field";
    const { snap, sheet, tag, line, stepped, placeTags } = PixelMap;
    const shown = c => c.type !== "discarded" && (filter === "all" || filter === c.type);
    const fields = [...new Set(run.papers.map(p => p.field))];
    const inField = f => run.papers.filter(p => p.field === f);
    // order fields so ones that share relationships sit next to each other
    const ord = PixelMap.ring({ papers: fields.map(f => ({ id: f })), connections: run.connections.filter(shown).map(c => ({ type: c.type, a: { paper: paper(c.a.paper).field }, b: { paper: paper(c.b.paper).field } })).filter(c => c.a.paper !== c.b.paper) });
    const SW = Math.max(...run.papers.map(sheetW)), SH = 63, PADB = 14, HEAD = 34;
    const box = f => ({ w: SW + PADB * 2, h: HEAD + inField(f).length * (SH + 10) + 6 });
    const maxW = Math.max(...fields.map(f => box(f).w)), maxH = Math.max(...fields.map(f => box(f).h));
    let rx = Math.max(260, maxW * .9), ry = Math.max(200, maxH * .9), at = {};
    const n = ord.length, ang = i => i / n * Math.PI * 2 - Math.PI / 2;
    for (let t = 0; t < 40; t++) {
      at = {}; ord.forEach((f, i) => { at[f] = [Math.cos(ang(i)) * rx, Math.sin(ang(i)) * ry]; });
      const ok = ord.every((f, i) => ord.every((g, j) => i === j || Math.abs(at[f][0] - at[g][0]) >= (box(f).w + box(g).w) / 2 + 40 || Math.abs(at[f][1] - at[g][1]) >= (box(f).h + box(g).h) / 2 + 34));
      if (ok || n < 2) break; rx *= 1.08; ry *= 1.08;
    }
    const w = snap(2 * (Math.max(...ord.map(f => Math.abs(at[f][0]) + box(f).w / 2)) + 30)), h = snap(2 * (Math.max(...ord.map(f => Math.abs(at[f][1]) + box(f).h / 2)) + 30));
    const cx = w / 2, cy = h / 2;
    ord.forEach(f => { at[f] = [snap(cx + at[f][0]), snap(cy + at[f][1])]; });
    // bridges: every pair of fields with at least one relationship between their papers
    const pairs = {};
    run.connections.filter(shown).forEach(c => {
      const fa = paper(c.a.paper).field, fb = paper(c.b.paper).field; if (fa === fb) return;
      const k = [fa, fb].sort().join("|"); (pairs[k] = pairs[k] || []).push(c);
    });
    const boxes = ord.map(f => ({ x: at[f][0], y: at[f][1], w: box(f).w, h: box(f).h }));
    const want = Object.entries(pairs).map(([k, cs]) => { const [fa, fb] = k.split("|"), A = at[fa], B = at[fb];
      return { id: k, x: (A[0] + B[0]) / 2, y: (A[1] + B[1]) / 2, dir: [0, 1], ...PixelMap.tagSize([{ text: `${cs.length} RELATIONSHIP${cs.length === 1 ? "" : "S"}`, size: 10, mono: true }], 10) }; });
    const tags = {}; placeTags(want, boxes, { x: 2, y: 2, w: w - 4, h: h - 4 }).forEach(t => { tags[t.id] = t; });
    const bridges = Object.entries(pairs).map(([k, cs]) => {
      const [fa, fb] = k.split("|"), A = at[fa], B = at[fb], t = tags[k], types = [...new Set(cs.map(c => c.type))], col = types.length === 1 ? T[types[0]].color : "#5b625d";
      const thick = cs.length > 1 ? 6 : 3;
      return `<g class="bridge" data-fa="${esc(fa)}" data-fb="${esc(fb)}" tabindex="0" role="button" aria-label="${esc(fa)} and ${esc(fb)}: ${cs.length} relationship${cs.length === 1 ? "" : "s"}"><title>${esc(fa)} and ${esc(fb)}: ${cs.length} relationship${cs.length === 1 ? "" : "s"}. Click to see them.</title>
        <g class="dots">${line(A, null, B, col, "solid", thick)}</g><path class="hit" d="M${A[0]} ${A[1]}L${B[0]} ${B[1]}"/>
        <g transform="translate(${t.x},${t.y})">${tag([{ text: `${cs.length} RELATIONSHIP${cs.length === 1 ? "" : "S"}`, size: 10, color: "var(--ink)", mono: true }], col, 10)}<g transform="translate(0,${snap(t.h / 2) + 7})">${types.map((ty, i) => `<rect x="${i * 10 - types.length * 5}" y="0" width="7" height="7" fill="${T[ty].color}"/>`).join("")}</g></g></g>`;
    }).join("");
    const groups = ord.map(f => { const b = box(f), [x, y] = at[f], x0 = x - b.w / 2, y0 = y - b.h / 2, col = fieldColor[f];
      return `<g class="field"><path d="${stepped(x0, y0, b.w, b.h, 3)}" fill="#f6f7f4"/><path d="${stepped(x0, y0, b.w, b.h, 3)}" fill="${col}" fill-opacity=".1" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>
        <rect x="${x0 + 10}" y="${y0 + 12}" width="8" height="8" fill="${col}"/><text x="${x0 + 24}" y="${y0 + 21}" font-family="Geist Mono, monospace" font-size="11" letter-spacing=".08em" fill="${col}">${esc(f.toUpperCase())} · ${inField(f).length}</text>
        ${inField(f).map((p, i) => `<g class="card" data-p="${p.id}" transform="translate(${x},${y0 + HEAD + i * (SH + 10) + SH / 2})" tabindex="0" role="button" aria-label="${esc(p.title)}"><title>${esc(p.title)}. Click to see what it connects to.</title>${cardInner(p)}</g>`).join("")}</g>`; }).join("");
    M = { w, h, curve: {}, pos: {} }; pos = {}; fit();
    svg.innerHTML = `<g id="cands"></g><g id="bridges">${bridges}</g><g id="cards">${groups}</g>`;
    const nb = Object.keys(pairs).length;
    $("#phoneList").innerHTML = `<h2 class="lab">Fields that connect</h2><ul class="connList">${Object.entries(pairs).map(([k, cs]) => { const [fa, fb] = k.split("|");
      return `<li><button class="bridgeRow" data-fa="${esc(fa)}" data-fb="${esc(fb)}"><i style="background:${fieldColor[fa]}"></i><span><b>${esc(fa)} and ${esc(fb)}</b><small>${cs.length} relationship${cs.length === 1 ? "" : "s"}: ${esc([...new Set(cs.map(c => T[c.type].name))].join(", "))}</small></span></button></li>`; }).join("") || '<li class="meta">No relationships cross fields yet.</li>'}</ul>`;
    $(".howto").innerHTML = `<b>Whole map:</b> each dashed box is a field, with its papers inside. A line between two boxes means papers in those fields relate, and the label says how many. ${nb ? "Click a line to see the relationships, or a paper to see its own connections." : "No relationships cross fields yet."}`;
  }
  // the papers behind one line on the whole map
  function bridgeView(fa, fb) {
    const cs = run.connections.filter(c => c.type !== "discarded" && (filter === "all" || filter === c.type) && [paper(c.a.paper).field, paper(c.b.paper).field].sort().join("|") === [fa, fb].sort().join("|"));
    $("#panel").innerHTML = `<button class="back" id="back">← Overview</button>
      <div class="lab" style="margin-top:14px">Between two fields</div>
      <h1>${esc(fa)} and ${esc(fb)}</h1>
      <p class="meta">${cs.length} relationship${cs.length === 1 ? "" : "s"} between papers in these fields.</p>
      <ul class="connList rels">${cs.map(c => relRow(c, paper(c.a.paper).field === fa ? c.a.paper : c.b.paper)).join("")}</ul>`;
    $("#back").onclick = () => select(null);
    if (sideOff) setSide(false);
    $("#panel").scrollTop = 0;
  }

  // the card on the map that offers the next step: papers you could write with this one, or the way back
  function mapNote() {
    const box = $("#mapNote");
    if (mapMode === "field") { box.innerHTML = ""; return; }
    if (mapMode === "idea") {
      box.innerHTML = `<span class="mnK">Idea view</span><b>${esc(current.title)}</b><button class="mnBack" data-focus="${focus}">← Back to ${esc(shortName(focus))}</button>`;
      return;
    }
    const ideas = run.next_papers.filter(nn => nn.parts.some(x => x.paper === focus));
    box.innerHTML = ideas.length
      ? `<span class="mnK"><span data-icon="bulb" data-size="14"></span>Papers you could write with this one</span>${ideas.map(nn => `<button class="mnIdea" data-n="${nn.id}"><b>${esc(nn.title)}</b><small>Uses it as: ${esc(nn.parts.find(x => x.paper === focus).role.toLowerCase())} · ${nn.parts.length} papers</small></button>`).join("")}`
      : `<span class="mnK">Papers you could write with this one</span><p>None yet. Add more papers, or start from your own idea.</p>`;
    if (window.PixelIcons) PixelIcons.paint(box);
  }

  // One paper or the whole map
  function switchView(v) {
    if (replaying) return;
    if (v === "field") { mapMode = "field"; renderMap(); apply(); select(null); }
    else select({ type: "paper", id: focus });
    syncViewSw();
  }
  function syncViewSw() { document.querySelectorAll("#viewSw [data-v]").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === mapMode)); }
  $("#viewSw").addEventListener("click", e => { const b = e.target.closest("[data-v]"); if (b) switchView(b.dataset.v); });
  $("#phoneList").addEventListener("click", e => {
    if (replaying) return;
    const br = e.target.closest(".bridgeRow"); if (br) { bridgeView(br.dataset.fa, br.dataset.fb); $("#panel").scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); return; }
    const c = e.target.closest("[data-c]"); if (c) { select({ type: "conn", id: c.dataset.c }); return; }
    const p = e.target.closest("[data-p]"); if (p) select({ type: "paper", id: p.dataset.p });
  });
  $("#farBox").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b && !replaying) select({ type: "paper", id: b.dataset.p }); });
  $("#mapNote").addEventListener("click", e => {
    if (replaying) return;
    const nn = e.target.closest("[data-n]"), back = e.target.closest("[data-focus]");
    if (nn) select({ type: "idea", id: nn.dataset.n }); else if (back) select({ type: "paper", id: back.dataset.focus });
  });

  /* ---------- find a paper: a dropdown of every paper; typing narrows it ---------- */
  const findIn = $("#findIn"), findList = $("#findList"), findBtn = $("#findBtn");
  let hits = [], hi = 0;
  const openList = open => { findList.hidden = !open; findIn.setAttribute("aria-expanded", open); findBtn.setAttribute("aria-expanded", open); };
  function showHits() {
    const t = findIn.value.trim().toLowerCase();
    // empty box: every paper, most connected first, so newcomers can just browse
    hits = (t ? run.papers.filter(p => [p.title, p.short, p.field, p.authors].some(x => x && x.toLowerCase().includes(t)))
              : run.papers.slice().sort((a, b) => degree(b.id) - degree(a.id) || (a.short || a.title).localeCompare(b.short || b.title)));
    hi = 0; openList(true);
    findList.innerHTML = (t ? "" : `<li class="head">All ${run.papers.length} papers</li>`) + (hits.length ? hits.map((p, i) => `<li><button data-p="${p.id}" class="${i === hi ? "on" : ""}" tabindex="-1"><i style="background:${fieldColor[p.field]}"></i><span>${esc(p.short || p.title)}<small>${esc(p.field)} · ${degree(p.id)} link${degree(p.id) === 1 ? "" : "s"}</small></span></button></li>`).join("") : `<li class="none">No paper matches “${esc(findIn.value.trim())}”.</li>`);
  }
  const pick = id => { findIn.value = ""; openList(false); findIn.blur(); select({ type: "paper", id }); };
  findIn.addEventListener("input", showHits);
  findIn.addEventListener("focus", showHits);
  findBtn.addEventListener("mousedown", e => e.preventDefault());   // keep focus in the box
  findBtn.addEventListener("click", () => { if (findList.hidden) { findIn.focus(); showHits(); } else openList(false); });
  findIn.addEventListener("keydown", e => {
    if (e.key === "Escape") { findIn.value = ""; openList(false); e.stopPropagation(); return; }
    if (findList.hidden && e.key === "ArrowDown") { showHits(); return; }
    if (!hits.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); hi = (hi + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      findList.querySelectorAll("button").forEach((b, i) => { b.classList.toggle("on", i === hi); if (i === hi) b.scrollIntoView({ block: "nearest" }); });
    }
    if (e.key === "Enter") { e.preventDefault(); pick(hits[hi].id); }
  });
  findList.addEventListener("mousedown", e => e.preventDefault());
  findList.addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b && !replaying) pick(b.dataset.p); });
  findIn.addEventListener("blur", () => setTimeout(() => openList(false), 150));

  /* ---------- compare any number of papers ---------- */
  // Tick two or more papers: Synapse shows every relationship among them (a grid and a list)
  // and the pairs with none yet. Unchecked pairs, and what the whole group has in common, are
  // asked of the Connector on demand (POST /api/compare once the backend exists).
  let picked = new Set();
  function readCompare(a) {
    picked = new Set([a || focus]);
    openReader(`
      <div class="rd-top"><button class="rd-back">← Back to the map</button><span class="typeChip" style="--c:#3d7fd9">Compare papers</span></div>
      <h1 class="rd-title">How do these papers relate?</h1>
      <p class="rd-what">Tick two or more papers, even ones with no line between them on the map. Synapse shows every relationship among them, what they have in common, and the pairs with no real connection.</p>
      <form class="cmpForm" id="cmpForm">
        <fieldset><legend>Papers to compare <span id="cmpN"></span></legend>
          <div class="cmpPick">${run.papers.map(p => `<label class="cmpOpt"><input type="checkbox" name="cmp" value="${p.id}"${picked.has(p.id) ? " checked" : ""}><i style="background:${fieldColor[p.field]}"></i><span>${esc(p.short || p.title)}<small>${esc(p.field)}</small></span></label>`).join("")}</div>
        </fieldset>
        <div class="cmpGo"><button class="btn dark" type="submit">Compare</button><button class="btn line" type="button" id="cmpAll">Pick all</button></div>
      </form>
      <div id="cmpOut"></div>
      <div class="rd-foot"><span>Read by Muse Spark 1.3 · every answer is checked like the rest: quotes matched word for word, then challenged</span></div>`);
    cmpCount();
  }
  const cmpCount = () => { const n = $("#reader").querySelectorAll("[name=cmp]:checked").length; $("#cmpN").textContent = n ? `· ${n} picked` : ""; };
  $("#compareBtn").addEventListener("click", () => { if (!replaying) readCompare(); });
  $("#reader").addEventListener("change", e => { if (e.target.name === "cmp") cmpCount(); });
  $("#reader").addEventListener("click", e => {
    if (e.target.id !== "cmpAll") return;
    const boxes = [...$("#reader").querySelectorAll("[name=cmp]")], all = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !all; }); e.target.textContent = all ? "Pick all" : "Clear"; cmpCount();
  });
  $("#reader").addEventListener("submit", e => {
    if (e.target.id !== "cmpForm") return; e.preventDefault();
    const ids = [...$("#reader").querySelectorAll("[name=cmp]:checked")].map(b => b.value), out = $("#cmpOut");
    if (ids.length < 2) { out.innerHTML = `<p class="mineErr">Pick at least two papers.</p>`; return; }
    const among = run.connections.filter(c => ids.includes(c.a.paper) && ids.includes(c.b.paper));
    const liveAmong = among.filter(c => c.type !== "discarded");
    const between = (x, y) => among.find(c => (c.a.paper === x && c.b.paper === y) || (c.a.paper === y && c.b.paper === x));
    const pairs = ids.flatMap((x, i) => ids.slice(i + 1).map(y => [x, y])), open = pairs.filter(([x, y]) => !between(x, y));
    // the grid: one row and column per paper, each cell coloured by how that pair relates
    const grid = `<div class="cmpGridWrap"><table class="cmpGrid"><thead><tr><th></th>${ids.map(id => `<th scope="col"><span>${esc(shortName(id))}</span></th>`).join("")}</tr></thead><tbody>
      ${ids.map(r => `<tr><th scope="row">${esc(shortName(r))}</th>${ids.map(col => { if (r === col) return `<td class="self"></td>`; const c = between(r, col);
        return c ? `<td><button data-c="${c.id}" style="--c:${T[c.type].color}" title="${esc(T[c.type].name)}: ${esc(c.headline)}">${esc(T[c.type].short)}</button></td>` : `<td class="none">no link yet</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>`;
    out.innerHTML = `
      <section class="rd-sec"><h2>${ids.length} papers, ${pairs.length} pairs</h2><div>
        <p class="cmpSum"><b>${liveAmong.length}</b> relationship${liveAmong.length === 1 ? "" : "s"} found among them${among.length > liveAmong.length ? `, and ${among.length - liveAmong.length} thrown out` : ""}. <b>${open.length}</b> pair${open.length === 1 ? " has" : "s have"} no relationship on this map yet.</p>
        ${grid}
      </div></section>
      ${liveAmong.length ? `<section class="rd-sec"><h2>The relationships</h2><div class="rd-rels">${liveAmong.map(c => { const t = T[c.type]; return `<button class="rd-rel" data-c="${c.id}" style="--c:${t.color}"><span class="typeChip" style="--c:${t.color}">${esc(t.name)}</span><b>${esc(c.headline)}</b><span>${esc(shortName(c.a.paper))} and ${esc(shortName(c.b.paper))}</span><p>${esc(c.for_you)}</p><em>Read the full relationship →</em></button>`; }).join("")}</div></section>` : ""}
      <section class="rd-sec"><h2>What they have in common${open.length ? ", and the open pairs" : ""}</h2><div class="simBox">
        <p class="simLead">Reading the papers together…</p>
        ${open.length ? `<ul class="nvQ">${open.map(([x, y]) => `<li>${esc(shortName(x))} · ${esc(shortName(y))}</li>`).join("")}</ul>` : ""}
      </div></section>`;
    out.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  });

  /* ---------- zoom and pan, so a map of any size stays readable ---------- */
  let view = null, drag = null, moved = false;
  const setView = () => svg.setAttribute("viewBox", view.join(" "));
  // on phones the map starts a little zoomed in on the middle, so the selected paper is readable
  function fit() { const k = matchMedia("(max-width:900px)").matches && mapMode === "paper" ? .62 : 1; view = [M.w * (1 - k) / 2, M.h * (1 - k) / 2, M.w * k, M.h * k]; setView(); }
  function zoom(f, px = .5, py = .5) {
    const [x, y, w, h] = view, nw = Math.min(M.w * 1.5, Math.max(M.w / 6, w * f)), nh = nw * h / w;
    view = [x + (w - nw) * px, y + (h - nh) * py, nw, nh]; setView();
  }
  svg.addEventListener("wheel", e => {
    e.preventDefault(); const r = svg.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  }, { passive: false });
  svg.addEventListener("pointerdown", e => { drag = [e.clientX, e.clientY, view[0], view[1]]; moved = false; });
  addEventListener("pointermove", e => {
    if (!drag) return;
    const r = svg.getBoundingClientRect(), s = Math.max(view[2] / r.width, view[3] / r.height), dx = e.clientX - drag[0], dy = e.clientY - drag[1];
    if (Math.hypot(dx, dy) > 4) moved = true;
    if (moved) { view[0] = drag[2] - dx * s; view[1] = drag[3] - dy * s; setView(); svg.classList.add("panning"); }
  });
  addEventListener("pointerup", () => { drag = null; svg.classList.remove("panning"); });
  $("#zoom").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; b.dataset.z === "fit" ? fit() : zoom(b.dataset.z === "in" ? 1 / 1.25 : 1.25); });

  /* ---------- selection + filters ---------- */
  let sel = null, filter = "all", replaying = false;
  function apply() {
    svg.querySelectorAll(".link").forEach(g => {
      const c = conn(g.dataset.c), passes = filter === "all" ? c.type !== "discarded" : c.type === filter;
      g.classList.toggle("off", !passes);
      const related = !sel || (sel.type === "conn" && sel.id === c.id) || (sel.type === "paper" && (c.a.paper === sel.id || c.b.paper === sel.id)) || (sel.type === "idea" && current.links.includes(c.id));
      g.classList.toggle("dim", !passes || !related); g.classList.toggle("on", !!sel && sel.type === "conn" && sel.id === c.id);
      g.classList.toggle("soft", mapMode === "idea" && !sel && !current.links.includes(c.id));
    });
    // a selected paper points to every paper it is linked to
    const near = new Set(sel && sel.type === "paper" ? live.filter(c => c.a.paper === sel.id || c.b.paper === sel.id).map(c => c.a.paper === sel.id ? c.b.paper : c.a.paper) : []);
    svg.querySelectorAll(".link").forEach(g => { const c = conn(g.dataset.c); g.classList.toggle("hl", c.type !== "discarded" && (mapMode === "paper" || (!!sel && sel.type === "paper" && (c.a.paper === sel.id || c.b.paper === sel.id)))); });
    pulses();
    // the page in the middle follows the selection: a selected paper, or the idea
    svg.querySelectorAll(".card").forEach(g => {
      const id = g.dataset.p;
      g.classList.toggle("near", near.has(id));
      const inIdea = current.parts.some(x => x.paper === id);
      // with nothing selected, the papers outside the current idea fade a little
      g.classList.toggle("soft", mapMode === "idea" && !sel && !inIdea);
      const related = !sel || mapMode === "paper" && sel.type === "paper" || (sel.type === "paper" && (sel.id === id || near.has(id))) || (sel.type === "conn" && [conn(sel.id).a.paper, conn(sel.id).b.paper].includes(id)) || (sel.type === "idea" && inIdea);
      g.classList.toggle("dim", !related); g.classList.toggle("on", !!sel && sel.type === "paper" && sel.id === id);
    });
    svg.querySelectorAll(".br").forEach(g => g.classList.toggle("dim", !!sel && sel.type !== "idea" && !(sel.type === "paper" && sel.id === g.dataset.p)));
    document.querySelectorAll("#findings button").forEach(b => b.setAttribute("aria-current", !!sel && sel.type === "conn" && sel.id === b.dataset.c));
    document.querySelectorAll("#ideas button").forEach(b => b.setAttribute("aria-current", !!sel && sel.type === "idea" && sel.id === b.dataset.n));
    document.querySelectorAll("#papers button").forEach(b => b.setAttribute("aria-current", !!sel && sel.type === "paper" && sel.id === b.dataset.p));
  }
  // sparks that travel from the selected paper along each of its links
  function pulses() {
    let g = svg.querySelector("#pulse");
    if (!g) { g = document.createElementNS("http://www.w3.org/2000/svg", "g"); g.id = "pulse"; svg.insertBefore(g, svg.querySelector("#cards")); }
    const from = mapMode === "paper" ? focus : sel && sel.type === "paper" ? sel.id : null;
    if (!from || reduced) { g.innerHTML = ""; return; }
    g.innerHTML = live.filter(c => (c.a.paper === from || c.b.paper === from) && M.curve[c.id] && (filter === "all" || filter === c.type)).map(c => {
      const k = M.curve[c.id], [A, B] = c.a.paper === from ? [k.A, k.B] : [k.B, k.A], col = T[c.type].color;
      const d = `M${A[0]} ${A[1]} Q${k.Q[0]} ${k.Q[1]} ${B[0]} ${B[1]}`;
      return [0, .6, 1.2].map(b => `<rect x="-3" y="-3" width="6" height="6" fill="${col}" stroke="#fff" stroke-width="1"><animateMotion dur="1.8s" begin="${b}s" repeatCount="indefinite" path="${d}"/></rect>`).join("");
    }).join("");
  }
  // "back" is the paper you came from: reading one of its links, Back returns to that paper
  let back = null;
  function select(s, from) {
    const prev = sel;
    if (from !== undefined) back = from;
    else if (!s || s.type === "paper") back = null;
    else if (prev && prev.type === "paper") back = prev;
    else if (back && s.type === "conn" && ![conn(s.id).a.paper, conn(s.id).b.paper].includes(back.id)) back = null;
    // a paper moves to the middle; an idea switches to the idea view; a link keeps one of its papers in focus
    if (s && s.type === "paper" && (mapMode !== "paper" || focus !== s.id)) { mapMode = "paper"; focus = s.id; renderMap(); }
    if (s && s.type === "idea" && (mapMode !== "idea" || current.id !== s.id)) { mapMode = "idea"; current = idea(s.id); renderMap(); }
    if (s && s.type === "conn" && mapMode === "paper" && ![conn(s.id).a.paper, conn(s.id).b.paper].includes(focus)) { focus = conn(s.id).a.paper; renderMap(); }
    sel = s; apply();
    if (s && s.type === "paper" && page !== "map") showPage("map");
    const state = { back }, url = s ? "#" + s.id : location.pathname;
    if (from === undefined && (location.hash || "#") !== (s ? "#" + s.id : "#")) history.pushState(state, "", url); else history.replaceState(state, "", url);
    if (!s) { closeReader(); feed(); return; }
    if (s.type === "conn") { finding(conn(s.id)); readRel(conn(s.id)); }
    else if (s.type === "idea") { ideaView(current); readIdea(current); }
    else { closeReader(); paperView(paper(s.id)); }
    $("#panel").scrollTop = 0;
  }
  const parse = id => conn(id) ? { type: "conn", id } : idea(id) ? { type: "idea", id } : paper(id) ? { type: "paper", id } : null;
  // the browser's own Back and Forward walk the same path
  addEventListener("popstate", e => { if (!replaying) select(parse(location.hash.slice(1)), (e.state && e.state.back) || null); });
  function goBack() { if (back) select(back); else { closeReader(); } }
  svg.addEventListener("click", e => {
    if (replaying || moved) return;
    const br = e.target.closest(".bridge"); if (br) { bridgeView(br.dataset.fa, br.dataset.fb); return; }
    const l = e.target.closest(".link"), c = e.target.closest(".card, .center"), i = e.target.closest(".idea");
    if (l) select({ type: "conn", id: l.dataset.c }); else if (c) select({ type: "paper", id: c.dataset.p }); else if (i) select({ type: "idea", id: i.dataset.n }); else select(null);
  });
  svg.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const br = e.target.closest(".bridge"); if (br) { e.preventDefault(); bridgeView(br.dataset.fa, br.dataset.fb); return; }
    const l = e.target.closest(".link"), c = e.target.closest(".card, .center"), i = e.target.closest(".idea"); e.preventDefault();
    if (l) select({ type: "conn", id: l.dataset.c }); else if (c) select({ type: "paper", id: c.dataset.p }); else if (i) select({ type: "idea", id: i.dataset.n });
  });
  addEventListener("keydown", e => { if (e.key !== "Escape") return; if (!reader.hidden) goBack(); else select(null); });
  const kinds = Object.keys(T).filter(k => run.connections.some(c => c.type === k));
  // Each filter opens on hover or keyboard focus to say what its colour means; "All" explains the line styles.
  const MEANS = {
    same_mechanism: "Both papers describe the same cause and effect, in different words.",
    borrow_method: "One paper has a tool or technique the other could use.",
    answers_gap: "One paper asks a question the other can help answer.",
    disagree: "Their claims conflict, so a paper using both has to deal with it.",
    builds_on: "One paper extends the other's work.",
    discarded: "Looked related, but the challenger showed they only share a word. Hidden unless you pick it.",
  };
  const pxLine = (col, dash) => `<svg viewBox="0 0 36 6" width="36" height="6" aria-hidden="true">${[0, 6, 12, 18, 24, 30].map((x, i) => dash && i % 2 ? "" : `<rect x="${x}" y="1" width="${dash === "dotted" ? 3 : 6}" height="3" fill="${col}"/>`).join("")}</svg>`;
  const count = k => run.connections.filter(c => c.type === k).length;
  $("#filters").innerHTML = `<button aria-pressed="true" data-f="all" aria-describedby="tip-all">All<span class="tip" id="tip-all" role="tooltip">
      <span class="tipH">Every relationship</span>Shows all ${live.length} relationships, without the thrown-out ones. The line tells you how far each was checked:
      <span class="tipRow">${pxLine("#5b625d")}Checked against quotes from both papers</span>
${SIM ? `<span class="tipRow">${pxLine("#5b625d", "dashed")}Being tested in a simulation</span>
      <span class="tipRow"><svg viewBox="0 0 36 6" width="36" height="6" aria-hidden="true"><rect x="0" y="1" width="36" height="3" fill="#5b625d"/><rect x="14" y="0" width="6" height="5" fill="#fff" stroke="#5b625d"/></svg>Tested, and the test supported it</span>` : ""}</span></button>`
    + kinds.map(k => `<button aria-pressed="false" data-f="${k}" aria-describedby="tip-${k}"><i style="background:${T[k].color}"></i>${esc(T[k].short)}<span class="tip" id="tip-${k}" role="tooltip" style="--c:${T[k].color}">
      <span class="tipH">${pxLine(T[k].color, k === "discarded" ? "dotted" : "")}${esc(T[k].name)}</span>${esc(MEANS[k])}<em>${count(k)} on this map · click to show only these</em></span></button>`).join("");
  $("#filters").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    filter = b.dataset.f; $("#filters").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    if (mapMode !== "idea") renderMap(); apply();
  });

  /* ---------- left column ---------- */
  const short = id => { const p = paper(id); return p.short || p.title; };
  const ORDER = Object.keys(T);
  const sorted = [...run.connections].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || b.strength - a.strength);
  // An idea is only called new after a search of published work found nothing close.
  const NOVEL = { new: "Nothing close found", partly: "Close work exists", known: "Already published", checking: "Searching…", unchecked: "Not searched yet" };
  // left-column cards: the same pixel paper as the map, with enough detail to choose from
  const dotsFor = ids => ids.map(id => `<i style="background:${fieldColor[paper(id).field]}" title="${esc(paper(id).field)}"></i>`).join("");
  $("#ideas").innerHTML = run.next_papers.map(n => `<li><button class="lc idea-card" data-n="${n.id}">
      <span class="lc-k">A paper you could write</span><b>${esc(n.title)}</b>
      <span class="lc-q">${esc(n.question)}</span>
      <span class="lc-f"><span class="dots">${dotsFor(n.parts.map(x => x.paper))}</span>${n.parts.length} papers<span class="nov ${n.novelty.state}">${NOVEL[n.novelty.state]}</span></span></button></li>`).join("");
  $("#ideaQuick").addEventListener("submit", e => { e.preventDefault(); if (replaying) return; const t = $("#ideaIn").value.trim(); if (t) { mine.text = t; remember(); } readMine(); });
  $("#ideas").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !replaying) select({ type: "idea", id: b.dataset.n }); });
  $("#findings").innerHTML = sorted.map(c => `<li><button class="lc link-card${c.type === "discarded" ? " gone" : ""}" data-c="${c.id}" style="--c:${T[c.type].color}">
      <span class="lc-k">${esc(T[c.type].name)}</span><b>${esc(c.headline)}</b>
      <span class="lc-pair"><span><i style="background:${fieldColor[paper(c.a.paper).field]}"></i>${esc(short(c.a.paper))}</span><em>${c.type === "discarded" ? "✕" : "↔"}</em><span><i style="background:${fieldColor[paper(c.b.paper).field]}"></i>${esc(short(c.b.paper))}</span></span></button></li>`).join("");
  $("#findings").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !replaying) select({ type: "conn", id: b.dataset.c }); });
  function renderPapers() {
    $("#paperCount").textContent = run.papers.length; $("#nIdeas").textContent = run.next_papers.length; $("#nLinks").textContent = live.length;
    $("#papers").innerHTML = run.papers.map(p => { const ls = live.filter(c => c.a.paper === p.id || c.b.paper === p.id);
      return `<li><button class="lc paper-card" data-p="${p.id}" style="--c:${fieldColor[p.field]}">
      <span class="lc-k">${esc(p.field)}</span><b>${esc(p.short || p.title)}</b>
      <span class="lc-f"><span class="dots sq">${ls.map(c => `<i style="background:${T[c.type].color}" title="${esc(T[c.type].name)}"></i>`).join("")}</span>${ls.length} ${ls.length === 1 ? "link" : "links"}</span></button></li>`; }).join("");
  }
  $("#papers").addEventListener("click", e => { const b = e.target.closest("button[data-p]"); if (b && !replaying) select({ type: "paper", id: b.dataset.p }); });

  /* ---------- left column: one section open at a time ---------- */
  // Memory lives in this browser only, so switching screens, reloading or coming back later
  // keeps what was added: settings, links and the reader's own idea in localStorage, PDF files
  // in IndexedDB. Nothing here is sent anywhere; "Clear" wipes both.
  const KEY = "synapse.v1";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const saved = load();
  const made = saved.made || {};   // ideas whose one-time blueprint has been made
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify({ page, mode, sideOff, made, queue: queue.map(q => ({ id: q.id, kind: q.kind, name: q.name })), mine })); } catch {} };
  // PDF files themselves, kept by id; if the browser blocks storage, files just last for this visit
  const files = (() => {
    let db = null;
    const open = () => db || (db = new Promise((ok, no) => { const r = indexedDB.open("synapse", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }));
    const run = (mode, fn) => open().then(d => new Promise((ok, no) => { const t = d.transaction("files", mode), q = fn(t.objectStore("files")); t.oncomplete = () => ok(q && q.result); t.onerror = () => no(t.error); })).catch(() => null);
    return { put: (id, f) => run("readwrite", st => st.put(f, id)), get: id => run("readonly", st => st.get(id)), del: id => run("readwrite", st => st.delete(id)), clear: () => run("readwrite", st => st.clear()) };
  })();
  let page = run.run.empty && (!saved.page || saved.page === "map") ? "add" : saved.page || "map", mode = saved.mode || "pdf", sideOff = !!saved.sideOff;
  // the Add section shows one option at a time: PDF, link or idea
  const TALKS = false;   // talks come back once transcription is built
  function setMode(m, focus) {
    if (!TALKS && m === "talk") m = "pdf";
    mode = m;
    document.querySelectorAll(".addPick [data-mode]").forEach(b => { const on = b.dataset.mode === m; b.setAttribute("aria-checked", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    document.querySelectorAll(".addPane").forEach(x => { x.hidden = x.dataset.pane !== m; });
    remember();
  }
  $(".addPick").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
  $(".addPick").addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; e.preventDefault();
    const order = TALKS ? ["pdf", "link", "talk", "idea"] : ["pdf", "link", "idea"], n = order.length, i = order.indexOf(mode);
    setMode(order[(i + (e.key === "ArrowRight" ? 1 : n - 1)) % n], true);
  });
  // One view fills the screen at a time: the map, or a full page of ideas, links, papers or adding.
  const layout = $(".layout");
  function showPage(p, focus) {
    page = p; layout.dataset.page = p; document.body.dataset.page = p;
    document.querySelectorAll(".views [data-page]").forEach(b => { const on = b.dataset.page === p; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    document.querySelectorAll(".pages .sec").forEach(x => { x.hidden = x.id !== "s-" + p; });
    if (!reader.hidden) closeReader();
    $(".pages").scrollTop = 0; remember();
  }
  $(".views").addEventListener("click", e => { const b = e.target.closest("[data-page]"); if (b && !replaying) showPage(b.dataset.page); });
  $(".views").addEventListener("keydown", e => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; e.preventDefault();
    const order = [...document.querySelectorAll(".views [data-page]")].map(b => b.dataset.page), i = order.indexOf(page);
    showPage(order[(i + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length], true);
  });
  // the map's side panel (agents and details) can be hidden to give the map the whole width
  function setSide(off) { sideOff = off; layout.classList.toggle("side-off", off); $("#sideOpen").hidden = !off; remember(); }
  $("#sideHide").addEventListener("click", () => setSide(true));
  $("#sideOpen").addEventListener("click", () => setSide(false));

  /* ---------- adding: PDFs and links wait here until the models read them ---------- */
  /* Safety check: nothing reaches an AI model until it passes every check below.
     The browser runs the checks it can (address, file type and size). The rest run on the
     server before anything is fetched or read: POST /api/check returns the same list with
     each state filled in. Until the server exists those stay "waiting". */
  const MAX_MB = 20, MAX_AUDIO_MB = 50;
  // the checker model screens every source for these two before anything else reads it
  const RESEARCH = ["Research material", "A paper, preprint, technical write-up or talk about research. Anything off-topic is turned away."];
  const SAFE = ["Suitable for academic use", "Checked against Synapse's content standards for research material."];
  const INJECT = ["No instructions aimed at the AI", "A checker model reads it first and flags text that tries to give the AI orders."];
  const CHECKS = {
    link: [
      ["addr", "Public web address", "Not a private or local network address."],
      ["open", "Opens as a normal page or PDF", `Under ${MAX_MB} MB, loads within 15 seconds, no downloads or scripts run.`],
      ["hidden", "Hidden text removed", "Invisible or white-on-white text is stripped, so the AI only sees what you would see."],
      ["research", ...RESEARCH],
      ["safe", ...SAFE],
      ["inject", ...INJECT],
      ["source", "Source labelled", "Marked as peer-reviewed, preprint or blog, so you know how much weight it deserves."],
    ],
    pdf: [
      ["file", "A real PDF, under 20 MB", "Checked from the file itself, not just its name."],
      ["hidden", "Hidden text removed", "Invisible or white-on-white text is stripped, so the AI only sees what you would see."],
      ["research", ...RESEARCH],
      ["safe", ...SAFE],
      ["inject", ...INJECT],
    ],
    talk: [
      ["addr", "Public web address", "Not a private or local network address."],
      ["open", "Audio or a transcript found", "The page has to share the recording or a written transcript. Nothing is downloaded from video sites."],
      ["transcribe", "Turned into text", "Muse Voice Transcribe writes out what is said, so it can be checked and read like a paper."],
      ["research", ...RESEARCH],
      ["safe", ...SAFE],
      ["inject", ...INJECT],
    ],
    audio: [
      ["file", `A real audio file, under ${MAX_AUDIO_MB} MB`, "Checked from the file itself, not just its name."],
      ["transcribe", "Turned into text", "Muse Voice Transcribe writes out what is said, so it can be checked and read like a paper."],
      ["research", ...RESEARCH],
      ["safe", ...SAFE],
      ["inject", ...INJECT],
    ],
  };
  /* ---------- the server ---------- */
  // Same address as the page. Opened without it (a plain file, or the static preview), every check
  // simply stays "waiting" and nothing is sent anywhere.
  const api = {
    status: null,
    async call(path, opts = {}) {
      const r = await fetch(path, { cache: "no-store", ...opts });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.detail || body.error || "Synapse's server didn't answer.");
      return body;
    },
    post(path, data) { return this.call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); },
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const newItem = (kind, name, file, id = uid()) => ({ id, kind, name, file, open: false, checks: CHECKS[kind].map(([k]) => ({ k, state: "wait", note: "" })) });
  const verdict = q => q.checks.some(c => c.state === "no") ? ["no", "Blocked"] : q.checks.every(c => c.state === "ok") ? ["ok", "Safe to read"] : q.checks.some(c => c.state === "run") ? ["run", "Checking"] : ["wait", "Safety check pending"];
  const ICON = { ok: "✓", no: "✕", run: "…", wait: "○" };
  // the waiting list comes back as it was left (older saves only kept links)
  const queue = (saved.queue || (saved.links || []).map(name => ({ kind: "link", name }))).filter(q => q.kind === "link" || (TALKS && q.kind === "talk")).map(q => newItem(q.kind, q.name, null, q.id));
  (async () => {
    await null;
    const kept = (saved.queue || []).filter(q => q.kind === "pdf" || (TALKS && q.kind === "audio"));
    for (const q of kept) { const f = await files.get(q.id); if (f) { const it = newItem(q.kind, q.name, f, q.id); queue.splice((saved.queue || []).indexOf(q), 0, it); localChecks(it); } }
    renderQueue(); remember();
  })();
  function renderQueue() {
    $("#queueBox").hidden = !queue.length;
    updateStart();
    $("#qCount").textContent = queue.length; $("#nAdd").textContent = queue.length || "";
    $("#queue").innerHTML = queue.map((q, i) => {
      const [v, word] = verdict(q), done = q.checks.filter(c => c.state === "ok").length;
      return `<li class="qi ${v}"><div class="qrow"><span class="qk">${{ pdf: "PDF", link: "Link", talk: "Talk", audio: "Talk" }[q.kind]}</span><span class="qn" title="${esc(q.name)}">${esc(q.file ? q.name : q.name.replace(/^https?:\/\//, ""))}</span><button class="qx" data-rm="${i}" aria-label="Remove ${esc(q.name)}">Remove</button></div>
        <button class="qv" data-open="${i}" aria-expanded="${q.open}"><i></i>${word}<small>${done} of ${q.checks.length} checks passed</small></button>
        ${q.open ? `<ul class="qchecks">${CHECKS[q.kind].map(([k, label, how], j) => { const c = q.checks[j]; return `<li class="${c.state}"><span>${ICON[c.state]}</span><b>${label}</b><small>${esc(c.note || (c.state === "wait" ? "Runs on the server before any AI reads it." : how))}</small></li>`; }).join("")}</ul>` : ""}</li>`;
    }).join("");
  }
  const setCheck = (q, k, state, note = "") => { const c = q.checks.find(x => x.k === k); c.state = state; c.note = note; };
  // the checks the browser can do on its own
  async function localChecks(q) {
    if (q.kind === "link" || q.kind === "talk") setCheck(q, "addr", "ok", "Public address. The server checks again after looking up where it really points.");
    else if (q.kind === "audio") {
      // recognise the common audio formats from their first bytes
      const h = new Uint8Array(await q.file.slice(0, 12).arrayBuffer()), str = (a, b) => String.fromCharCode(...h.slice(a, b));
      const isAudio = str(0, 3) === "ID3" || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || (str(0, 4) === "RIFF" && str(8, 12) === "WAVE") || str(0, 4) === "OggS" || str(0, 4) === "fLaC" || str(4, 8) === "ftyp";
      if (!isAudio) setCheck(q, "file", "no", "This file is not a recording Synapse can read.");
      else if (q.file.size > MAX_AUDIO_MB * 1048576) setCheck(q, "file", "no", `This file is ${(q.file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_AUDIO_MB} MB.`);
      else setCheck(q, "file", "ok", `A real recording, ${(q.file.size / 1048576).toFixed(1)} MB.`);
    } else {
      const head = new Uint8Array(await q.file.slice(0, 5).arrayBuffer());
      const isPdf = String.fromCharCode(...head) === "%PDF-";
      if (!isPdf) setCheck(q, "file", "no", "This file is not really a PDF, so it won't be read.");
      else if (q.file.size > MAX_MB * 1048576) setCheck(q, "file", "no", `This file is ${(q.file.size / 1048576).toFixed(0)} MB. The limit is ${MAX_MB} MB.`);
      else setCheck(q, "file", "ok", `A real PDF, ${(q.file.size / 1048576).toFixed(1)} MB.`);
    }
    renderQueue();
    if (!q.checks.some(c => c.state === "no")) serverChecks(q);
  }

  async function serverChecks(q) {
    if (!api.status) return;
    if (q.kind === "talk" || q.kind === "audio") {
      setCheck(q, "transcribe", "wait", "Talks are coming in a later version. Nothing has been sent.");
      renderQueue(); return;
    }
    q.checks.forEach(c => { if (c.state === "wait") c.state = "run"; }); renderQueue();
    try {
      let res;
      if (q.kind === "pdf") { const f = new FormData(); f.append("file", q.file, "paper.pdf"); res = await api.call("/api/check/pdf", { method: "POST", body: f }); }
      else res = await api.post("/api/check/link", { url: q.name });
      for (const c of res.checks) if (q.checks.some(x => x.k === c.k)) setCheck(q, c.k, c.state, c.note);
      q.reason = (res.checks.find(c => c.k === "reason") || {}).note;
      q.paper = res.paper && res.paper.id;
      q.checks.forEach(c => { if (c.state === "run") { c.state = "no"; c.note = "Not reached: an earlier check stopped it."; } });
    } catch (e) {
      q.checks.forEach(c => { if (c.state === "run") { c.state = "wait"; c.note = e.message; } });
    }
    renderQueue();
  }
  function forgetOnServer(q) { if (api.status && q.paper) api.call(`/api/added/${q.paper}`, { method: "DELETE" }).catch(() => {}); }
  function updateStart() {
    const ready = queue.filter(q => q.checks.every(c => c.state === "ok")).length, btn = $("#startRun"), note = $("#startNote");
    if (!btn) return;
    btn.disabled = !api.status || !ready;
    btn.textContent = ready ? `Start reading ${ready} source${ready > 1 ? "s" : ""}` : "Start reading";
    note.textContent = !api.status ? "Reading needs Synapse's server, which isn't running."
      : !api.status.meta ? "Reading needs the Meta model key, which isn't set yet. The safety checks that use it are waiting too."
      : ready ? `Synapse reads only what passed every check. A run stops before it spends more than $${api.status.cap_usd.toFixed(2)}.`
      : "Synapse reads only what passed every check.";
  }
  async function startRun(body, btn, note) {
    btn.disabled = true; note.textContent = "Starting…";
    try {
      const { id } = await api.post("/api/run", body);
      try { sessionStorage.setItem("synapse.run", id); } catch {}
      showPage("map"); setSide(false); followRun(id);
    } catch (e) { note.textContent = e.message; btn.disabled = false; }
  }
  const STATE = { run: ["run", "Working"], done: ["done", "Done"], no: ["no", "Done"] };
  async function followRun(id) {
    let st;
    try { st = await api.call(`/api/run/${id}`); } catch { try { sessionStorage.removeItem("synapse.run"); } catch {} return; }
    const rows = st.steps.map(s => [s.agent, s.text, ...(STATE[s.state] || STATE.run)]), sig = JSON.stringify(rows);
    if (sig !== followRun.last) { followRun.last = sig; feed(rows, true); }   // redraw only when something changed
    if (st.state === "running") { setTimeout(() => followRun(id), 1500); return; }
    try { sessionStorage.removeItem("synapse.run"); } catch {}
    if (st.state === "done") { flash("Finished. Loading your map…"); setTimeout(() => location.reload(), 900); }
    else $("#panel").insertAdjacentHTML("afterbegin", `<p class="runErr">${esc(st.error || "The run stopped.")}</p>`);
  }
  $("#startRun").addEventListener("click", () => startRun({ papers: queue.filter(q => q.paper && q.checks.every(c => c.state === "ok")).map(q => q.paper) }, $("#startRun"), $("#startNote")));
  $("#startLib").addEventListener("click", () => startRun({ library: true }, $("#startLib"), $("#libBox p")));
  try { const rid = sessionStorage.getItem("synapse.run"); if (rid) followRun(rid); } catch {}
  api.call("/api/status").then(st => {
    api.status = st;
    const dot = (on, t) => `<span class="${on ? "on" : "off"}"><i></i>${t}</span>`;
    $("#srv").innerHTML = dot(true, st.papers ? `Connected · ${st.papers} papers in the library` : "Connected") + dot(st.meta, st.meta ? "Meta models ready" : "Live runs off: no model key set. The sponsors' API access ended with the hackathon")
      + (st.meta ? dot(st.baseten, st.baseten ? "Challenger ready" : "Challenger key not set") : "");
    $("#srv").hidden = false;
    if (st.meta && st.papers >= 2) { $("#libN").textContent = st.papers; $("#libBox").hidden = false; }
    if (st.uploads === false) {
      // the online version keeps no one's own files: PDFs can be added only when Synapse runs locally
      $('[data-pane="pdf"]').innerHTML = `<h3>Upload PDFs</h3><p>Uploading your own PDFs only works when Synapse runs on your own computer, so no one's files are kept on a server. Paste a link to a public paper instead.</p>`;
    }
    queue.forEach(q => { if (!q.checks.some(c => c.state === "no")) serverChecks(q); });
    updateStart();
  }).catch(() => {
    // no server behind this copy (a static host): nothing can be checked or read here, and nothing is sent
    api.offline = true;
    $("#srv").innerHTML = `<span class="off"><i></i>Live runs off: the sponsors' API access ended with the hackathon. To read papers, run Synapse on your own computer with your own Meta API key.</span>`;
    $("#srv").hidden = false;
    $('[data-pane="pdf"]').innerHTML = `<h3>Upload PDFs</h3><p>This copy of Synapse can't read papers. Run it on your own computer with your own Meta API key.</p>`;
    updateStart();
  });
  $("#queue").addEventListener("click", e => {
    const o = e.target.closest("[data-open]"); if (o) { const q = queue[+o.dataset.open]; q.open = !q.open; renderQueue(); return; }
  });
  queue.forEach(localChecks);
  // removing is one click, with an Undo in case it was the wrong one
  function removeItems(items) {
    const at = items.map(q => [queue.indexOf(q), q]);
    items.forEach(q => { queue.splice(queue.indexOf(q), 1); if (q.file) files.del(q.id); forgetOnServer(q); });
    renderQueue(); remember();
    flash(items.length === 1 ? `Removed ${items[0].file ? items[0].name : items[0].name.replace(/^https?:\/\//, "")}.` : `Removed all ${items.length}.`, () => {
      at.sort((a, b) => a[0] - b[0]).forEach(([i, q]) => { queue.splice(i, 0, q); if (q.file) files.put(q.id, q.file); q.paper = null; q.checks.forEach(c => { c.state = "wait"; c.note = ""; }); localChecks(q); });
      renderQueue(); remember();
    });
  }
  $("#queue").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) removeItems([queue[+b.dataset.rm]]); });
  $("#qClear").addEventListener("click", () => { if (queue.length) removeItems(queue.slice()); });
  // A first check in the browser. The server checks every link again before fetching it.
  function checkLink(raw) {
    let u; try { u = new URL(raw.trim()); } catch { return "That doesn't look like a web address. It should start with https://"; }
    if (!/^https?:$/.test(u.protocol)) return "Only web links (https://) can be added.";
    if (!u.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) return "Only public web pages can be added.";
    if (queue.some(q => q.name === u.href)) return "That link is already in the list.";
    return u.href;
  }
  const VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|dailymotion\.com|twitch\.tv|instagram\.com|facebook\.com)$/i;
  $("#talkForm").addEventListener("submit", e => {
    e.preventDefault();
    const r = checkLink($("#talkIn").value), err = $("#talkErr");
    if (!/^https?:\/\//.test(r)) { err.hidden = false; err.textContent = r; return; }
    if (VIDEO_SITES.test(new URL(r).hostname)) { err.hidden = false; err.textContent = "Video sites like YouTube can't be used: their terms don't allow downloading. Try the talk's page on the conference or university site, or a podcast link."; return; }
    err.hidden = true; const q = newItem("talk", r); q.open = true; queue.push(q); localChecks(q); $("#talkIn").value = ""; renderQueue(); remember();
    flash("Talk added. It gets a safety check before any AI reads it.");
  });
  $("#linkForm").addEventListener("submit", e => {
    e.preventDefault();
    const r = checkLink($("#linkIn").value), err = $("#linkErr");
    if (api.offline) { err.hidden = false; err.textContent = "This copy of Synapse can't read papers. Run it on your own computer with your own Meta API key."; return; }
    if (!/^https?:\/\//.test(r)) { err.hidden = false; err.textContent = r; return; }
    err.hidden = true; const q = newItem("link", r); q.open = true; queue.push(q); localChecks(q); $("#linkIn").value = ""; renderQueue(); remember();
    flash("Link added. It gets a safety check before any AI reads it.");
  });
  $("#forget").addEventListener("click", () => {
    try { localStorage.removeItem(KEY); } catch {}
    Object.keys(made).forEach(k => delete made[k]);
    queue.forEach(forgetOnServer); files.clear(); queue.length = 0; renderQueue(); mine = { text: "", field: "", wants: WANTS.map(w => w[0]) }; $("#ideaIn").value = ""; setMode("pdf"); showPage("map");
    flash("Cleared everything saved in this browser.");
  });

  /* ---------- start from your own idea ---------- */
  // A form, not a chat: the idea, the field it sits in, and what kind of help is wanted.
  // Every idea goes to the models (POST /api/idea); there are no ready-made answers.
  const WANTS = [["support", "Papers that back it up", true], ["method", "Methods I could borrow", true], ["challenge", "Papers that push back", true], ["done", "Whether it's already been done (sends a short search query through Meta's web search)", true]];
  let mine = saved.mine || { text: "", field: "", wants: WANTS.filter(w => w[2]).map(w => w[0]) };
  /* ---------- each agent's work: what it looked at, what it decided, and why ---------- */
  // Only the agents' written steps are shown, after the content check; raw model notes are never kept.
  const ideaName = id => { const pid = String(id).split(".")[0], p = paper(pid), i = p && (p.ideas || []).find(x => x.id === id); return p ? `${p.short || p.title}: ${i ? i.label : id}` : id; };
  const yesNo = (ok, yes, no) => `<span class="wk-chip ${ok ? "ok" : "no"}">${ok ? yes : no}</span>`;
  const steps = list => list && list.length ? `<ol class="wk-steps">${list.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : "";
  const WORK = {
    Checker: w => w.items.map(x => `<div class="wk-item"><h3>${esc(x.paper)}</h3><p>${yesNo(x.research, "Research", "Not research")} ${yesNo(x.suitable, "Suitable", "Outside the standards")} ${yesNo(!x.instructions_for_ai, "No instructions for the AI", "Instructions for the AI found")} <span class="wk-chip">${esc(x.kind)}</span> <span class="wk-chip">${esc(x.field)}</span></p><p class="wk-note">${x.result === "passed" ? "Passed. Other agents may read it." : esc(x.result)}</p></div>`).join(""),
    Reader: w => w.items.map(x => `<div class="wk-item"><h3>${esc(x.title)}</h3><p class="wk-note">${esc(x.field)} · ${esc(x.summary)}</p>
      <ul class="wk-list">${x.ideas.map(i => `<li><b>${esc(i.label)}</b> ${esc(i.says)}<blockquote>“${esc(i.quote)}”<cite>p. ${i.page} · found word for word</cite></blockquote></li>`).join("")}</ul>
      ${x.quotes_dropped ? `<p class="wk-note">${x.quotes_dropped} idea${x.quotes_dropped > 1 ? "s were" : " was"} dropped because the quote couldn't be found word for word.</p>` : ""}</div>`).join(""),
    Translator: w => `<ul class="wk-list">${w.items.map(x => `<li><span class="wk-from">${esc(ideaName(x.id))}</span><span class="wk-arrow">→</span><span>${esc(x.plain)} <span class="wk-chip">${esc(x.pattern)}</span></span></li>`).join("")}</ul>`,
    Filter: w => `<h3>How it chose</h3>${steps(w.approach)}<h3>Kept ${w.items.length} of ${w.considered} possible pairings</h3>
      <ul class="wk-list">${w.items.map(x => `<li><b>${esc(ideaName(x.a))}</b> + <b>${esc(ideaName(x.b))}</b><span class="wk-note">${esc(x.why)}</span></li>`).join("")}</ul>`,
    Connector: w => `<ul class="wk-list">${w.items.map(x => `<li>${yesNo(x.outcome === "link", "Link found", x.outcome === "error" ? "Skipped" : "No link")} <b>${esc(ideaName(x.a))}</b> + <b>${esc(ideaName(x.b))}</b>${x.headline ? `<span class="wk-head">${esc(x.headline)}</span>` : ""}<span class="wk-note">${esc(x.why || "")}</span></li>`).join("")}</ul>`,
    Challenger: w => `<ul class="wk-list">${w.items.map(x => `<li>${yesNo(x.status === "verified", "Held up", "Thrown out")} <button class="plink" data-c="${esc(x.link)}">${esc(x.headline)}</button> <span class="wk-chip">${x.passed} of ${x.total} passed</span><span class="wk-note">${esc(x.summary)}</span></li>`).join("")}</ul><p class="wk-note">Open a link to see each of the five questions and the challenger's reasoning steps.</p>`,
    Figures: w => `<ul class="wk-list">${w.items.map(x => `<li><button class="plink" data-c="${esc(x.link)}">${esc(x.headline)}</button><span class="wk-note">Page ${x.page}: ${esc(x.caption)}</span><span class="wk-note">${x.outlines ? `Muse Spark named “${esc(x.thing)}”, and SAM 3.1 outlined ${x.outlines}.` : x.thing ? `Muse Spark named “${esc(x.thing)}”, but SAM 3.1 found none, so the figure is shown as it is.` : "A chart, so it's shown as it is."}</span></li>`).join("")}</ul>`,
    Judge: w => w.items.map(x => `<div class="wk-item"><h3><button class="plink" data-c="${esc(x.link)}">${esc(x.headline)}</button></h3><p><span class="wk-chip ${x.verdict === "reject" ? "no" : "ok"}">${{ confirm: "Confirmed", caveat: "Kept, with a caveat", reject: "Rejected" }[x.verdict]}</span> ${esc(x.word)}</p>${steps(x.reasoning)}</div>`).join(""),
    Planner: w => (w.note ? `<p class="wk-note">${esc(w.note)}</p>` : "") + (!w.items.length && !w.note ? `<p class="wk-note">No paper ideas this run.</p>` : "") + w.items.map(x => `<div class="wk-item"><h3><button class="plink" data-n="${esc(x.idea)}">${esc(x.title)}</button></h3><h4>How it built the idea</h4>${steps(x.reasoning)}
      <h4>What it searched for</h4><ul class="wk-list">${x.searched.map(q => `<li>${esc(q)}</li>`).join("")}</ul><p class="wk-note">${x.results_kept} scholarly result${x.results_kept === 1 ? "" : "s"} kept to compare against.</p>
      <h4>How it judged novelty</h4>${steps(x.judging)}<p>${{ new: yesNo(true, "Nothing close found", ""), partly: '<span class="wk-chip">Parts already published</span>', known: yesNo(false, "", "Already done"), unchecked: '<span class="wk-chip">Search found nothing to compare</span>' }[x.state] || ""}</p></div>`).join(""),
  };
  function readWork(agent) {
    const w = run.work && run.work[agent]; if (!w) return;
    openReader(`
      <div class="rd-top"><button class="rd-back">← Back to the map</button><span class="typeChip" style="--c:#5b625d">${esc(agent)}</span></div>
      <h1 class="rd-title">What the ${esc(agent)} did</h1>
      <p class="rd-what">${esc(HOW[agent] ? HOW[agent][1] : "")}</p>
      <section class="rd-sec wide"><h2>Its work</h2><div class="wk">${w.held ? `<p>${esc(w.why || "This agent's notes were held back by Synapse's content check, so they aren't shown.")}</p>` : (WORK[agent] ? WORK[agent](w) : "")}</div></section>
      <div class="rd-foot"><span>${esc(w.model || "")} · its written steps, checked by Synapse's content check before they're shown</span></div>`);
  }

  // "Has it been done?": the web search runs only when the person asks
  $("#reader").addEventListener("click", e => {
    if (e.target.id !== "nvRun") return;
    const nn = idea(e.target.dataset.idea), m = $("#nvMsg"); if (!nn) return;
    e.target.disabled = true; m.hidden = false; m.textContent = "Searching flagship journals and top conferences…";
    api.post("/api/novelty", { idea: nn.id }).then(d => { Object.assign(nn, d); readIdea(nn); })
      .catch(err => { m.textContent = err.message; e.target.disabled = false; });
  });

  function readMine() {
    openReader(`
      <div class="rd-top"><button class="rd-back">← Back to the map</button><span class="typeChip" style="--c:#7a5cc9">Your idea</span></div>
      <h1 class="rd-title">What do you want to write about?</h1>
      <p class="rd-what">Describe the paper you have in mind in a sentence or two, in your own words. Synapse reads it against the ${run.papers.length} papers on your map and shows which ones help, how, and what is missing.</p>
      <form class="mineForm" id="mineForm">
        <label for="mineText">Your idea</label>
        <textarea id="mineText" rows="4" maxlength="1200" placeholder="For example: I want to test whether a method from one field explains a pattern in another, by learning it from data.">${esc(mine.text)}</textarea>
        <label for="mineField">Your field <small>optional</small></label>
        <input id="mineField" maxlength="80" placeholder="For example: ecology, economics, robotics" value="${esc(mine.field)}">
        <fieldset><legend>What should Synapse look for?</legend>
          ${WANTS.map(w => `<label class="tick"><input type="checkbox" name="want" value="${w[0]}"${mine.wants.includes(w[0]) ? " checked" : ""}> ${w[1]}</label>`).join("")}
        </fieldset>
        <div class="mineGo"><button type="submit" class="mineSubmit">Map my idea</button><span>Nothing is sent until you press this.</span></div>
        <p class="mineErr" id="mineErr" hidden></p>
      </form>
      <section class="rd-sec"><h2>What you get back</h2><div class="rd-checks two">
        <div class="rd-check"><b>A clear research question</b><p>Muse Spark rewrites your idea as one question a paper can answer.</p></div>
        <div class="rd-check"><b>What each paper gives you</b><p>For every paper that helps: a method, data, a claim to build on, or an argument you must answer, with quotes checked word for word.</p></div>
        <div class="rd-check"><b>What's missing</b><p>Parts of your idea that none of your papers cover, so you know what to read next.</p></div>
        <div class="rd-check"><b>Has it been done?</b><p>A search for published work that already answers your question.</p></div>
      </div></section>
      <div class="rd-foot"><span>Your idea is only used for this map. It is read by Muse Spark 1.3, the same model that reads your papers.</span></div>`);
  }
  function mapMine(form) {
    mine = { text: form.mineText.value.trim(), field: form.mineField.value.trim(), wants: [...form.querySelectorAll("[name=want]:checked")].map(x => x.value) }; remember(); $("#ideaIn").value = mine.text;
    const err = $("#mineErr");
    if (mine.text.split(/\s+/).filter(Boolean).length < 6) { err.hidden = false; err.textContent = "Write at least one full sentence, so Synapse knows what the paper is about."; return; }
    if (!mine.wants.length) { err.hidden = false; err.textContent = "Tick at least one thing for Synapse to look for."; return; }
    err.hidden = false;
    if (run.run.illustrative || !api.status || !api.status.meta) {
      err.textContent = "Mapping your own idea needs the Meta model key, and it isn't set here. This copy of Synapse shows a finished run only.";
      return;
    }
    err.textContent = "Screening your idea, then mapping it onto your papers and searching published work…";
    const btn = form.querySelector("[type=submit]"); if (btn) btn.disabled = true;
    api.post("/api/idea", { text: mine.text, field: mine.field, search: mine.wants.includes("done") }).then(d => {
      run.next_papers = run.next_papers.filter(n => n.id !== "M1").concat(d);
      err.hidden = true; readIdea(d, mine.text);
    }).catch(e => { err.textContent = e.message; }).finally(() => { if (btn) btn.disabled = false; });
  }

  /* ---------- research blueprint: the study, drawn as an animated diagram ----------
     Muse Spark designs the study as structured data (stages, which paper feeds each one, and
     the part that is new, taken from the novelty search); this code draws and animates it, so
     every label is real text, never guessed by an image model. Made once per idea, then kept. */
  function blueprintPanel(nn) {
    const bp = nn.blueprint;
    if (!made[nn.id]) return `<p class="simLead">A one-page diagram of the study this idea leads to: the data each paper gives you, the method, the tests, the result, and the part that makes it yours. It plays like a short clip.</p>
      <div class="simGo"><button class="btn dark" id="bpMake">Make the blueprint</button><span>Made once for this idea, then kept. You can replay it as often as you like.</span></div><p class="simMsg" id="bpMsg" hidden></p>`;
    return `<div class="bpTop"><span class="meta">Made by Muse Spark 1.3 from your papers.</span><button class="btn line" id="bpPlay">▶ Play again</button></div>
      <div class="bpWrap" id="bpWrap">${blueprintSVG(bp)}</div>
      <div class="bpNew"><b>What makes it yours</b><p>${esc(bp.unique)}</p></div>`;
  }
  function blueprintSVG(bp) {
    const K = ["data", "method", "test", "result"], HEAD = { data: "DATA", method: "METHOD", test: "TESTS", result: "RESULT" };
    const COL = { data: "#2f86c9", method: "#3d7fd9", test: "#16907f", result: "#9a5a17" };
    const CW = 196, GAP = 44, NH = 126, VG = 20, top = 42;
    const cols = K.map(k => bp.stages.filter(st => st.kind === k));
    const H = Math.max(...cols.map(c => c.length * NH + (c.length - 1) * VG)) + top + 12, W = K.length * CW + (K.length - 1) * GAP + 16;
    const at = {};
    cols.forEach((c, ci) => { const tot = c.length * NH + (c.length - 1) * VG, y0 = top + (H - top - 12 - tot) / 2; c.forEach((st, i) => { at[st.id] = { x: 8 + ci * (CW + GAP), y: y0 + i * (NH + VG), ci }; }); });
    const wrapT = (t, n, max) => { const ls = t.split(" ").reduce((a, w) => { const l = a[a.length - 1]; if (l && (l + " " + w).length <= n) a[a.length - 1] = l + " " + w; else a.push(w); return a; }, []); return ls.length > max ? ls.slice(0, max - 1).concat(ls.slice(max - 1).join(" ").slice(0, n - 1) + "…") : ls; };
    const heads = K.map((k, ci) => `<text x="${8 + ci * (CW + GAP)}" y="20" font-family="Geist Mono, monospace" font-size="11" letter-spacing=".08em" fill="${COL[k]}">${HEAD[k]}</text>`).join("");
    const edges = bp.flows.map(([a, b], i) => {
      const A = at[a], B = at[b], x1 = A.x + CW, y1 = A.y + NH / 2, x2 = B.x, y2 = B.y + NH / 2, mx = PixelMap.snap((x1 + x2) / 2);
      const px = PixelMap.line([x1, y1], null, [mx, y1], "#7d857f") + PixelMap.line([mx, y1], null, [mx, y2], "#7d857f") + PixelMap.line([mx, y2], null, [x2, y2], "#7d857f");
      const d = `M${x1} ${y1}H${mx}V${y2}H${x2}`, t0 = A.ci * .7 + .45;
      return `<g class="bpE" style="--d:${t0}s">${px}${reduced ? "" : `<rect x="-3" y="-3" width="6" height="6" fill="#f2b45c" stroke="#2b3a33" stroke-width="1"><animateMotion dur="1.6s" begin="${t0 + .4}s" repeatCount="indefinite" path="${d}"/></rect>`}</g>`;
    }).join("");
    const nodes = bp.stages.map(st => {
      const { x, y, ci } = at[st.id], fill = st.new ? "#fff4d6" : "#fffdf8";
      const title = wrapT(st.title, 23, 2), note = wrapT(st.note, 31, title.length > 1 ? 3 : 4);
      let t = `<rect x="${x}" y="${y}" width="${CW}" height="5" fill="${COL[st.kind]}"/>`;
      title.forEach((l, i) => { t += `<text x="${x + 12}" y="${y + 26 + i * 16}" font-family="Geist, sans-serif" font-size="13.5" font-weight="600" fill="var(--ink)">${esc(l)}</text>`; });
      note.forEach((l, i) => { t += `<text x="${x + 12}" y="${y + 30 + title.length * 16 + i * 14}" font-family="Geist, sans-serif" font-size="11.5" fill="#5b625d">${esc(l)}</text>`; });
      const ps = (st.papers || []).map(id => `${shortName(id)}`).join(" · ");
      if (ps) t += `<rect x="${x + 12}" y="${y + NH - 17}" width="6" height="6" fill="${fieldColor[paper(st.papers[0]).field]}"/><text x="${x + 22}" y="${y + NH - 11}" font-family="Geist, sans-serif" font-size="10.5" fill="#7d857f">${esc(ps.length > 32 ? ps.slice(0, 31) + "…" : ps)}</text>`;
      const badge = st.new ? `<g transform="translate(${x + CW - 50},${y - 9})"><rect width="44" height="18" fill="#2b3a33"/><text x="22" y="13" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10" font-weight="600" fill="#f6c463">NEW</text></g>` : "";
      return `<g class="bpN${st.new ? " new" : ""}" style="--d:${ci * .7}s"><path d="${PixelMap.stepped(x + 4, y + 4, CW, NH, 2)}" fill="${st.new ? "rgba(217,130,43,.35)" : "rgba(27,31,28,.14)"}"/>
        <path class="pg" d="${PixelMap.stepped(x, y, CW, NH, 2)}" fill="${fill}" stroke="#2b3a33" stroke-width="2"/>${t}${badge}</g>`;
    }).join("");
    return `<svg class="bpSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Research blueprint: ${esc(bp.stages.map(st => st.title).join(", then "))}" shape-rendering="crispEdges">${heads}${edges}${nodes}</svg>`;
  }
  $("#reader").addEventListener("click", e => {
    const box = e.target.closest("#bpBox"); if (!box) return;
    const nn = idea(box.dataset.n);
    if (e.target.id === "bpMake") {
      const m = $("#bpMsg"), show = () => { made[nn.id] = true; remember(); box.innerHTML = blueprintPanel(nn); };
      if (nn.blueprint) { show(); return; }
      if (run.run.illustrative || !api.status || !api.status.meta) { m.hidden = false; m.textContent = "Making a blueprint needs the models connected."; return; }
      e.target.disabled = true; m.hidden = false; m.textContent = "Muse Spark is designing the study…";
      api.post("/api/blueprint", { idea: nn.id }).then(bp => { nn.blueprint = bp; show(); })
        .catch(err => { m.textContent = err.message; e.target.disabled = false; });
    }
    if (e.target.id === "bpPlay") $("#bpWrap").innerHTML = blueprintSVG(nn.blueprint);
  });

  /* ---------- right panel: agents at work ---------- */
  const rej = run.connections.filter(c => c.type === "discarded"), proven = byStatus("proven"), testing = byStatus("testing");
  const judged = run.connections.filter(c => c.challenge && c.challenge.final);
  const AGENTS = [
    ...(run.work && run.work.Checker ? [["Checker", `Checked ${run.work.Checker.items.length} sources before anyone read them`, "done", "Done"]] : []),
    ["Reader", `Read ${f.papers} papers, every page and figure`, "done", "Done"],
    ["Translator", `Rewrote ${f.ideas} ideas in plain words`, "done", "Done"],
    ["Filter", `Kept ${f.shortlisted} of ${f.pairs} possible pairings`, "done", "Done"],
    ["Connector", `Found ${live.length} relationships of ${kinds.filter(k => k !== "discarded").length} kinds, with quotes from both papers`, "done", "Done"],
    ["Challenger", rej.length ? `Threw out ${rej.length}: ${rej[0].relation.toLowerCase()}` : "Every link held up", rej.length ? "no" : "done", rej.length ? `${rej.length} thrown out` : "Done"],
    ...(run.work && run.work.Figures ? [["Figures", `Showed ${run.work.Figures.items.length} figure${run.work.Figures.items.length === 1 ? "" : "s"} behind the quotes`, "done", "Done"]] : []),
    ...(judged.length ? [["Judge", `Gave the ${judged.length} strongest link${judged.length === 1 ? "" : "s"} a final check`, "done", "Done"]] : []),
    ["Planner", `Suggested ${run.next_papers.length} ideas for papers you could write`, "done", "Done"],
  ];
  const agentRow = (r, isNew) => `<div class="agentRow${isNew ? " new" : ""}"><b>${r[0]}</b><span class="badge ${r[2]}">${r[3]}</span><small>${esc(r[1])}</small></div>`;
  // what each agent does and which model does it, for the "how it works" line under each step
  const HOW = {
    Figures: ["PDF layout · Muse Spark 1.3 · SAM 3.1", "Where a paper's licence allows, code cuts the figure behind a quote out of the page. Muse Spark names the real object the quote is about, and SAM 3.1 outlines every one it finds. Charts are shown as they are."],
    Checker: ["Muse Spark 1.3", "Reads the start of every source before any other agent does: is it research, is it suitable, and does any of it try to give the AI orders? A fixed code check runs first."],
    Reader: ["Muse Spark 1.3", "Reads every page of each paper and picks out its key ideas. Each idea comes with a quote that code checks word for word."],
    Translator: ["Muse Spark 1.3", "Rewrites each paper's key ideas in plain words, so ideas from different fields can be compared without the jargon."],
    Filter: ["Muse Spark 1.3", "Looks at every idea from every paper, in plain words, and keeps the pairs from different papers worth a closer look."],
    Connector: ["Muse Spark 1.3", "Works out how each pair relates and explains it with quotes from both papers. Code then checks every quote word for word."],
    Challenger: ["Muse Spark Open · Baseten", "A second, different model tries to break every link with the same five questions. Links that only share a word are thrown out. Links involving your own PDFs are challenged by Muse Wonder instead."],
    Judge: ["Muse Wonder", "Takes a last, careful look at the strongest links, with both papers and every verdict the Challenger gave, and has the final word: confirm, keep with a caveat, or reject."],
    Planner: ["Muse Spark 1.3 · web search", "Turns the links that held up into papers you could write, then searches published work to check each one is new."],
  };
  function feed(rows = AGENTS, live = false) {
    if (run.run.empty && !live) rows = AGENTS.map(r => [r[0], "Waiting for papers", "wait", "Waiting"]);
    const done = rows.filter(r => r[2] === "done").length, work = (!live && run.work) || {};
    // keep open whatever "How it works" the reader had open when the panel redraws
    const opened = new Set([...$("#panel").querySelectorAll(".ag[data-agent] details[open]")].map(d => d.closest(".ag").dataset.agent));
    $("#panel").innerHTML = `<div class="sideH"><span class="lab">Agents at work</span><span class="meta">${done} of ${rows.length} steps done</span></div>
      <p class="sideIntro">${["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"][rows.length] || rows.length} AI agents work through your papers in turn. Each one checks the work of the one before it.</p>
      <ol class="pipe">${rows.map((r, i) => `<li class="ag ${r[2]}" data-agent="${esc(r[0])}"><span class="agN">${i + 1}</span>
        <div class="agB"><div class="agT"><b>${r[0]}</b><span class="badge ${r[2]}">${r[3]}</span></div>
          <p>${esc(r[1])}</p>
          <details${opened.has(r[0]) ? " open" : ""}><summary>How it works</summary><p>${esc(HOW[r[0]][1])}</p></details>
          <span class="model">${esc(HOW[r[0]][0])}</span>${work[r[0]] ? `<button class="seeWork" data-work="${r[0]}">See its work →</button>` : ""}</div></li>`).join("")}</ol>
      <p class="note">${live ? "Reading now. This page updates as each agent finishes." : run.run.empty ? "Nothing has been read yet." : `Cost of this run: $${run.run.cost_usd.toFixed(2)} · ${Math.round(run.run.seconds / 60)} min${run.run.illustrative ? " · illustrative" : ""}`}</p>
      <div class="tipBox"><b>Tip</b> Click a paper or a coloured line on the map to see the details here.</div>`;
  }
  $("#panel").addEventListener("click", e => {
    const go = e.target.closest("[data-go]"); if (go) { showPage(go.dataset.go); return; }
    const wk = e.target.closest("[data-work]"); if (wk && !replaying) { readWork(wk.dataset.work); return; }
    const ni = e.target.closest("[data-n]"); if (ni && !replaying) { select({ type: "idea", id: ni.dataset.n }); return; }
    const b = e.target.closest("[data-c]"); if (b && !replaying) { select({ type: "conn", id: b.dataset.c }); return; }
    const p = e.target.closest("[data-p]"); if (p && !replaying) select({ type: "paper", id: p.dataset.p });
  });

  /* ---------- right panel helpers ---------- */
  // "[Bird flocking]" in a draft sentence becomes a highlighted citation
  const cites = t => esc(t).replace(/\[([^\]]+)\]/g, '<span class="cite">$1</span>');
  const copyBtn = (id, text) => `<button class="copy" data-copy="${id}">Copy</button><textarea hidden id="${id}">${esc(text)}</textarea>`;
  $("#panel").addEventListener("click", async e => {
    const b = e.target.closest("[data-copy]"); if (!b) return;
    const t = $("#" + b.dataset.copy).value.replace(/\[([^\]]+)\]/g, "($1)");
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
  });
  const relRow = (c, from) => {
    const other = c.a.paper === from ? c.b.paper : c.a.paper;
    return `<li class="rel"><button data-c="${c.id}">
      <span class="relHead"><span class="typeChip" style="--c:${T[c.type].color}">${esc(T[c.type].name)}</span><b>${esc(short(other))}</b> <span class="meta">${esc(paper(other).field)}</span></span>
      <span class="relWhy">${esc(c.shared)}</span>
      ${c.type !== "discarded" ? `<span class="relUse"><b>For your paper:</b> ${esc(c.for_you)}</span>` : ""}
      <span class="more">Read the full relationship →</span></button></li>`;
  };

  /* ---------- the reading page: a full explanation over the map ---------- */
  const reader = $("#reader");
  function openReader(html) {
    reader.innerHTML = `<div class="rd">${html}</div>`; reader.hidden = false; reader.scrollTop = 0;
    const b = reader.querySelector(".rd-back");
    if (back && !b.hasAttribute("data-mine")) b.textContent = "← Back to " + short(back.id);
    b.focus({ preventScroll: true });
  }
  function closeReader() { reader.hidden = true; reader.innerHTML = ""; }
  reader.addEventListener("submit", e => { if (e.target.id === "mineForm") { e.preventDefault(); mapMine(e.target); } });
  reader.addEventListener("click", e => {
    if (e.target.closest(".rd-back[data-mine]")) { readMine(); return; }
    if (e.target.closest(".rd-back")) { goBack(); return; }
    const cp = e.target.closest("[data-copy]");
    if (cp) { const t = $("#" + cp.dataset.copy).value.replace(/\[([^\]]+)\]/g, "($1)"); navigator.clipboard.writeText(t).then(() => { cp.textContent = "Copied"; }, () => { cp.textContent = "Select and copy"; }); return; }
    const c = e.target.closest("[data-c]"), nn = e.target.closest("[data-n]"), pp = e.target.closest("[data-p]");
    if (c) select({ type: "conn", id: c.dataset.c }); else if (nn) select({ type: "idea", id: nn.dataset.n }); else if (pp) { closeReader(); select({ type: "paper", id: pp.dataset.p }); }
  });
  const pageCard = (p, says, quotes) => `<article class="rd-paper" style="--c:${fieldColor[p.field]}">
      <div class="rd-ph"><i></i>${esc(p.field)}<span>${p.real ? `${esc(p.authors)} · ${p.year}` : ""}</span></div>
      <button class="rd-pt" data-p="${p.id}">${esc(p.title)}</button>
      <p class="rd-says">${esc(says)}</p>
      ${quotes.map(e => `<figure class="rd-quote"><blockquote>${esc(e.text)}</blockquote><figcaption>p. ${e.page} · ${e.real || e.verified ? "exact quote, checked word for word" : "illustrative quote"}</figcaption></figure>
        ${e.figure ? `<figure class="rd-fig"><div class="figWrap"><img src="${esc(e.figure.src)}" alt="${esc(e.figure.alt || e.figure.caption)}" loading="lazy">${e.figure.boxes && e.figure.boxes.length ? `<svg class="figBoxes" viewBox="0 0 ${+e.figure.w} ${+e.figure.h}" preserveAspectRatio="none" aria-hidden="true">${e.figure.boxes.map(b => `<rect x="${+b[0]}" y="${+b[1]}" width="${b[2] - b[0]}" height="${b[3] - b[1]}"/>`).join("")}</svg>` : ""}</div><figcaption>${esc(e.figure.caption)} · p. ${e.figure.page} · ${e.figure.boxes && e.figure.boxes.length ? `${e.figure.boxes.length} ${esc(e.figure.thing)}${e.figure.boxes.length > 1 ? "s" : ""} outlined by SAM 3.1` : "from the paper"}</figcaption></figure>` : ""}`).join("")}
    </article>`;

  /* ---------- how two papers relate, drawn: parts of each, the shared mechanism, and new components ---------- */
  // Muse Spark lays the link out as parts (see backend/agents/diagram.py); this draws it. Solid boxes come from
  // the papers; dashed ones are suggestions for a new study, never presented as existing work.
  const wrapT = (t, n) => String(t).split(" ").reduce((ls, w) => { const l = ls[ls.length - 1]; if (l !== undefined && (l + " " + w).length <= n) ls[ls.length - 1] = l + " " + w; else ls.push(w); return ls; }, []);
  function diagramSVG(d, c) {
    const A = paper(c.a.paper), B = paper(c.b.paper), W = 940, BW = 214, BH = 72, GY = 22, top = 52;
    const col = { a: 18, shared: 363, b: 708 }, by = s => d.nodes.filter(n => n.side === s), h = s => by(s).length * BH + Math.max(0, by(s).length - 1) * GY;
    const H0 = top + Math.max(h("a"), h("b"), h("shared")), pos = {};
    ["a", "shared", "b"].forEach(s => { const y0 = top + (H0 - top - h(s)) / 2; by(s).forEach((n, i) => { pos[n.id] = { x: col[s], y: y0 + i * (BH + GY), n }; }); });
    const news = by("new"), rowY = H0 + 96, rowW = news.length * BW + Math.max(0, news.length - 1) * 30;
    news.forEach((n, i) => { pos[n.id] = { x: (W - rowW) / 2 + i * (BW + 30), y: rowY, n }; });
    const H = news.length ? rowY + BH + 18 : H0 + 18;
    const tint = { a: fieldColor[A.field], b: fieldColor[B.field], shared: T[c.type].color, new: "#7a5cc9" };
    let k = 0;
    const edges = d.edges.map(e => {
      const P = pos[e.from], Q = pos[e.to]; if (!P || !Q) return "";
      let path, lx, ly;
      if (P.x === Q.x) { const [u, v] = P.y < Q.y ? [P, Q] : [Q, P]; path = `M${u.x + BW / 2} ${u.y + BH}V${v.y}`; lx = u.x + BW / 2 + 6; ly = (u.y + BH + v.y) / 2 + 4; }
      else if (Math.abs(P.y - Q.y) > BH * 2 && (P.n.side === "new" || Q.n.side === "new")) {
        const [u, v] = P.y < Q.y ? [P, Q] : [Q, P], my = v.y - 18 - (k % 3) * 6;
        path = `M${u.x + BW / 2} ${u.y + BH}V${my}H${v.x + BW / 2}V${v.y}`; lx = null;
      } else {
        const x1 = P.x < Q.x ? P.x + BW : P.x, x2 = P.x < Q.x ? Q.x : Q.x + BW, y1 = P.y + BH / 2, y2 = Q.y + BH / 2, mx = Math.round((x1 + x2) / 2);
        path = `M${x1} ${y1}H${mx}V${y2}H${x2}`; lx = mx; ly = Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 6;
      }
      const dashed = P.n.side === "new" || Q.n.side === "new";
      return `<g class="dg-el dg-edge" style="--i:${k++}"><path d="${path}" class="${dashed ? "dash" : ""}"/>${e.label && lx !== null && !dashed ? `<text x="${lx}" y="${ly}" text-anchor="middle" class="dg-lbl">${esc(e.label)}</text>` : ""}</g>`;
    }).join("");
    const nodes = d.nodes.filter(n => pos[n.id]).map((n, i) => {
      const { x, y } = pos[n.id], lines = wrapT(n.label, 26).slice(0, 2), note = n.note ? wrapT(n.note, 33).slice(0, 3 - lines.length) : [], t0 = n.side === "new" ? 30 : 24;
      return `<g class="dg-el dg-node ${n.side}" style="--i:${i};--c:${tint[n.side]}" transform="translate(${x},${y})">
        <rect width="${BW}" height="${BH}"/><rect class="bar" width="6" height="${BH}"/>
        ${n.side === "new" ? `<text x="${BW - 8}" y="14" text-anchor="end" class="dg-new">NEW · SUGGESTED</text>` : ""}
        ${lines.map((l, j) => `<text x="16" y="${t0 + j * 16}" class="dg-t">${esc(l)}</text>`).join("")}
        ${note.map((l, j) => `<text x="16" y="${t0 + lines.length * 16 + j * 14}" class="dg-n">${esc(l)}</text>`).join("")}</g>`;
    }).join("");
    const head = (x, t, sub, color) => `<text x="${x + BW / 2}" y="18" text-anchor="middle" class="dg-h" fill="${color}">${esc(t)}</text><text x="${x + BW / 2}" y="34" text-anchor="middle" class="dg-hs">${esc(sub)}</text>`;
    return `<svg class="dgSvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="How ${esc(A.short || A.title)} and ${esc(B.short || B.title)} relate: ${esc(d.nodes.map(n => n.label).join(", "))}">
      ${head(col.a, A.short || A.title, A.field, tint.a)}${head(col.shared, "What they share", T[c.type].name, tint.shared)}${head(col.b, B.short || B.title, B.field, tint.b)}
      ${news.length ? `<text x="${W / 2}" y="${H0 + 30}" text-anchor="middle" class="dg-hs">What a new study could add (suggestions, not from the papers)</text>` : ""}
      ${edges}${nodes}</svg>`;
  }
  function diagramPanel(c) {
    if (c.diagram) return `<div class="bpTop"><span class="meta">Laid out by Muse Spark 1.3 from this link's checked text. Solid parts come from the papers; dashed ones are suggestions.</span><button class="btn line" id="dgPlay">▶ Play again</button></div><div class="dgWrap" id="dgWrap">${diagramSVG(c.diagram, c)}</div>`;
    return `<p class="simLead">See this relationship as a diagram: the parts of each paper's system, the mechanism they share, and new components a study could add, such as a newer method or a further field.</p>
      <div class="simGo"><button class="btn dark" id="dgMake">Draw how they relate</button><span>Made once for this link, then kept.</span></div><p class="simMsg" id="dgMsg" hidden></p>`;
  }
  reader.addEventListener("click", e => {
    const box = e.target.closest("#dgBox"); if (!box) return;
    const c = conn(box.dataset.link);
    if (e.target.id === "dgPlay") { $("#dgWrap").innerHTML = diagramSVG(c.diagram, c); return; }
    if (e.target.id !== "dgMake") return;
    const m = $("#dgMsg"); m.hidden = false;
    if (run.run.illustrative || !api.status || !api.status.meta) { m.textContent = "Drawing a diagram needs the models connected. Read some papers first."; return; }
    e.target.disabled = true; m.textContent = "Muse Spark is laying out the parts…";
    api.post("/api/diagram", { link: c.id }).then(d => { c.diagram = d; box.innerHTML = diagramPanel(c); })
      .catch(err => { m.textContent = err.message; e.target.disabled = false; });
  });

  function readRel(c) {
    const A = paper(c.a.paper), B = paper(c.b.paper), rej = c.type === "discarded", x = c.experiment, ch = c.challenge, t = T[c.type];
    const usedIn = run.next_papers.filter(n => n.links.includes(c.id));
    const lc = s => s.charAt(0).toLowerCase() + s.slice(1);
    const LEVELS = [["New to both", c.shared],
      [`I know ${A.field.toLowerCase()}`, `You already know this side: ${lc(c.in_a)} In ${B.field.toLowerCase()}, ${lc(c.in_b)}`],
      [`I know ${B.field.toLowerCase()}`, `You already know this side: ${lc(c.in_b)} In ${A.field.toLowerCase()}, ${lc(c.in_a)}`]];
    const checks = [
      ["Quotes", c.evidence.length ? "ok" : "no", c.evidence.length ? `${c.evidence.length} quotes matched word for word against the papers.` : "No real evidence was found."],
      ["Challenge", rej ? "no" : "ok", rej ? "A second AI showed the link doesn't hold." : `A second AI attacked it ${ch.total} times. It held up ${ch.passed} times.`],
      ...(ch.final ? [["Final check", ch.final.verdict === "reject" ? "no" : "ok", `Muse Wonder: ${ch.final.word}`]] : []),
      ...(SIM && c.hypothesis ? [["Prediction", "ok", c.hypothesis]] : []),
      ...(SIM && x ? [["Simulation", x.status === "done" ? "ok" : "wait", x.status === "done" ? (c.verdict || "Ran in a sealed-off sandbox.") : "Running in a sealed-off sandbox now."]] : []),
    ];
    openReader(`
      <div class="rd-top"><button class="rd-back">← Back to the map</button>
        <span class="typeChip" style="--c:${t.color}">${esc(t.name)}</span><span class="chipS ${c.status}">${WORD[c.status]}</span></div>
      <h1 class="rd-title">${esc(c.headline)}</h1>
      <p class="rd-lead" id="rdLead">${esc(c.shared)}</p>
      ${rej ? "" : `<div class="rd-lvl"><span>Explain it for</span><div class="lvl" id="rdLvl">${LEVELS.map(([l], i) => `<button data-i="${i}" aria-selected="${!i}">${esc(l)}</button>`).join("")}</div></div>`}

      <div class="rd-pair">
        ${pageCard(A, c.in_a, c.evidence.filter(e => e.paper === A.id))}
        <div class="rd-bridge" style="--c:${t.color}"><span>${esc(t.name)}</span></div>
        ${pageCard(B, c.in_b, c.evidence.filter(e => e.paper === B.id))}
      </div>

      <section class="rd-sec"><h2>How they connect</h2><div><p class="rd-body">${esc(c.why)}</p></div></section>

      <section class="rd-sec"><h2>Side by side</h2><div>
        <div class="rd-map" style="--a:${fieldColor[A.field]};--b:${fieldColor[B.field]}">
          <b class="ha">${esc(A.field)}</b><span></span><b class="hb">${esc(B.field)}</b>
          ${c.mapping.map(([l, r]) => `<div>${esc(l)}</div><i style="--c:${t.color}">${rej ? "≠" : ""}</i><div>${esc(r)}</div>`).join("")}
        </div>
        <p class="rd-note">Read across each row: the left idea plays the same part in ${esc(A.field.toLowerCase())} as the right one does in ${esc(B.field.toLowerCase())}.</p></div></section>

      ${c.limits.length ? `<section class="rd-sec"><h2>Where the comparison breaks</h2><div><ol class="rd-limits">${c.limits.map(l => `<li>${esc(l)}</li>`).join("")}</ol></div></section>` : ""}

      ${rej ? "" : `<section class="rd-use"><h2>Using it in your paper</h2>
        <p class="rd-body" style="color:var(--ink)">${esc(c.for_you)}</p>
        <div class="rd-use2">
          <ol class="rd-moves">${c.use.map(u => `<li>${esc(u)}</li>`).join("")}</ol>
          <div class="rd-cards">
            ${c.question ? `<div class="q"><span>Research question it raises</span>${esc(c.question)}</div>` : ""}
            ${c.cite_as ? `<div class="draft"><span>Draft sentence for your related work ${copyBtn("cs-" + c.id, c.cite_as)}</span><p>${cites(c.cite_as)}</p></div>` : ""}
          </div>
        </div>
        ${usedIn.map(n => `<button class="usedIn" data-n="${n.id}">This link is part of a paper you could write: ${esc(n.title)} →</button>`).join("")}
      </section>`}

      ${!rej ? `<section class="rd-sec wide"><h2>How they relate, drawn<small class="opt">made once per link</small></h2><div class="bpBox" id="dgBox" data-link="${c.id}">${diagramPanel(c)}</div></section>` : ""}

      <section class="rd-sec"><h2>How Synapse checked it</h2><div>
        <div class="rd-checks">${checks.map(([h, k, p]) => `<div class="rd-check ${k}"><b>${h}</b><p>${esc(p)}</p></div>`).join("")}</div>
        <details class="rd-att"><summary>See every attack the challenger tried, and its reasoning</summary>
          ${ch.summary ? `<p class="attSum">${esc(ch.summary)}</p>` : ""}
          ${ch.attacks.map(a => `<div class="att"><span style="color:${a.verdict === "pass" ? "#2f7a4c" : a.verdict === "caveat" ? "var(--proven)" : "var(--rejected)"}">${a.verdict === "pass" ? "✓" : a.verdict === "caveat" ? "!" : "✕"}</span><span><b>${esc(a.question)}</b> ${esc(a.answer)}
            ${a.reasoning && a.reasoning.length ? `<details class="attWhy"><summary>How it reasoned</summary><ol>${a.reasoning.map(s => `<li>${esc(s.replace(/^\s*step\s*\d+\s*[:.)-]\s*/i, ""))}</li>`).join("")}</ol>
              ${(a.quotes || []).map(q => `<blockquote>“${esc(q.text)}”<cite>${esc(shortName(q.paper === "A" ? c.a.paper : c.b.paper))}, p. ${q.page} · found word for word</cite></blockquote>`).join("")}</details>` : ""}</span></div>`).join("")}
          ${ch.quotes_dropped ? `<p class="attNote">${ch.quotes_dropped} quote${ch.quotes_dropped > 1 ? "s" : ""} the challenger offered couldn't be found word for word in the paper, so ${ch.quotes_dropped > 1 ? "they were" : "it was"} left out.</p>` : ""}</details>
        ${SIM && x && x.chart ? `<div class="chart rd-chart"><svg id="rdChart" role="img" aria-label="Simulation result"></svg></div>${x.code ? `<details class="rd-att"><summary>Show the simulation code</summary><pre>${esc(x.code)}</pre></details>` : ""}` : ""}
      </div></section>

      ${SIM && !rej && !x ? `<section class="rd-sec"><h2>Test it in a simulation<small class="opt">optional</small></h2><div class="simBox" id="simBox">
        <p class="simLead">Synapse can test the relationship between these two papers: it turns what they have in common into a prediction, then checks that prediction in a small computer simulation.</p>
        ${c.testable === false ? `<div class="simNo"><b>Not testable by simulation</b><p>${esc(c.untestable_reason || "This relationship can't be turned into a maths model, so it rests on the quotes and the challenger.")}</p></div>` : `
        <ol class="simSteps">
          <li><b>A prediction.</b> Muse Spark turns what the two papers have in common into something a simulation can check.</li>
          <li><b>Its own code.</b> It writes a small simulation from scratch. It never runs code from either paper.</li>
          <li><b>A safety check.</b> A checker reads the code first and rejects anything that uses the internet, starts other programs or touches files.</li>
          <li><b>Sealed off.</b> The code runs in a Modal sandbox with no internet and no access to your files, for a few minutes at most.</li>
          <li><b>The result.</b> You get the outcome and a chart, and you can read every line of the code.</li>
        </ol>
        <div class="simGo"><button class="btn dark" id="simRun">Test this relationship</button><span>Nothing runs until you press this.</span></div>
        <p class="simMsg" id="simMsg" hidden></p>`}
      </div></section>` : ""}

      <div class="rd-foot"><span>Read by Muse Spark 1.3 · challenged by ${/wonder/i.test(ch.model || "") ? "Muse Wonder" : "Muse Spark Open on Baseten"}${ch.final ? " · final check by Muse Wonder" : ""}</span></div>`);
    if ($("#simRun")) $("#simRun").onclick = () => {
      const m = $("#simMsg"); m.hidden = false;
      m.innerHTML = "Starting the test…";
    };
    if (!rej) $("#rdLvl").onclick = e => { const b = e.target.closest("button"); if (!b) return;
      $("#rdLvl").querySelectorAll("button").forEach(z => z.setAttribute("aria-selected", z === b)); $("#rdLead").textContent = LEVELS[+b.dataset.i][1]; };
    if (SIM && x && x.chart) SynapseCharts.draw($("#rdChart"), x.chart, { a: fieldColor[A.field], b: fieldColor[B.field], accent: "var(--proven)" }, 640, 220);
  }

  function readIdea(nn, mine) {
    const nv = nn.novelty, novel = NOVEL[nv.state] || NOVEL.unchecked;
    const VERDICT = { new: "Not found in published work", partly: "Parts are already published", known: "Already published", checking: "Search still running", unchecked: "Not searched yet" };
    openReader(`
      <div class="rd-top"><button class="rd-back"${mine ? " data-mine" : ""}>${mine ? "← Edit your idea" : "← Back to the map"}</button>
        <span class="typeChip" style="--c:${mine ? "#7a5cc9" : "#d9822b"}">${mine ? "Your idea" : "A paper you could write"}</span><span class="chipS nv-${nv.state}">${novel}</span></div>
      <h1 class="rd-title">${esc(nn.title)}</h1>
      ${mine ? `<blockquote class="mineSaid"><span>You wrote</span>${esc(mine)}</blockquote>
      <p class="rd-what">Synapse turned your idea into a research question, then went through every relationship between your papers to find what supports it, what gives you a method, and what you will have to answer.${run.run.illustrative ? " This is an example result." : ""}</p>`
      : `<p class="rd-what">An idea for a new paper, built from how your papers relate. ${nv.state === "new" ? "A search of published work found nothing that already does it." : nv.state === "partly" ? "A search of published work found close studies, listed below, so the plan focuses on the part that is still open." : nv.state === "known" ? "A search found this has already been published, so treat it as background, not a new paper." : "It has not been checked against published work yet, so don't treat it as new."}</p>`}
      <div class="q big"><span>Research question</span>${esc(nn.question)}</div>
      <p class="rd-lead">${esc(nn.pitch)}</p>
      <div class="newbox"><b>What's new.</b> ${esc(nn.contribution)}</div>

      <section class="rd-sec"><h2>What each paper gives you</h2><div class="rd-parts">
        ${nn.parts.map(pt => { const pp = paper(pt.paper); return `<article class="rd-part" style="--c:${fieldColor[pp.field]}"><span class="role">${esc(pt.role)}</span>
          <button class="rd-pt" data-p="${pp.id}">${esc(pp.short || pp.title)}</button><small>${esc(pp.field)}</small><p>${esc(pt.detail)}</p></article>`; }).join("")}
      </div></section>

      <section class="rd-sec wide"><h2>Research blueprint<small class="opt">made once per idea</small></h2><div class="bpBox" id="bpBox" data-n="${nn.id}">${blueprintPanel(nn)}</div></section>

      <section class="rd-sec"><h2>A first outline</h2><div><ol class="outline">${nn.outline.map(o => `<li><b>${esc(o.section)}</b><p>${esc(o.text)}</p><span class="cl">${o.cites.map(id => `<button class="cite" data-p="${id}">${esc(short(id))}</button>`).join("")}</span></li>`).join("")}</ol></div></section>

      <section class="rd-sec"><h2>The relationships behind it</h2><div class="rd-rels">
        ${nn.links.map(id => { const c = conn(id), t = T[c.type]; return `<button class="rd-rel" data-c="${c.id}" style="--c:${t.color}"><span class="typeChip" style="--c:${t.color}">${esc(t.name)}</span><b>${esc(c.headline)}</b><span>${esc(short(c.a.paper))} and ${esc(short(c.b.paper))}</span><p>${esc(c.for_you)}</p><em>Read the full relationship →</em></button>`; }).join("")}
      </div></section>

      <section class="rd-sec"><h2>Has it been done?</h2><div class="nvBox nv-${nv.state}">
        <div class="nvHead"><b>${VERDICT[nv.state] || VERDICT.unchecked}</b>${nv.checked ? `<small>${esc(nv.checked)}</small>` : ""}</div>
        <p>${esc(nv.note)}</p>
        ${nv.searched && nv.searched.length ? `<h3>What was searched</h3><ul class="nvQ">${nv.searched.map(q => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}
        ${nv.closest && nv.closest.length ? `<h3>Closest published work</h3><ol class="nvList">${nv.closest.map(c => `<li>${c.url ? `<a href="${safeUrl(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a>` : `<b>${esc(c.title)}</b>`}<span>${esc(c.covers)}</span></li>`).join("")}</ol>` : ""}
        ${nv.state === "unchecked" && !(nv.searched || []).length && nn.searchable !== false && !run.run.illustrative ? `<div class="simGo"><button class="btn dark" id="nvRun" data-idea="${esc(nn.id)}">Check if it's been done</button><span>Searches flagship journals and top conferences through Meta's web search. Costs about $0.30, so it runs only when you ask.</span></div><p class="simMsg" id="nvMsg" hidden></p>` : ""}
        <p class="nvFine">A search can miss papers. Read the closest work yourself before you call your paper new.</p>
      </div></section>

      ${nn.read_next && nn.read_next.length ? `<section class="rd-sec"><h2>What to read next</h2><div>
        <ol class="readNext">${nn.read_next.map(r => `<li>${r.url ? `<a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>` : `<b>${esc(r.title)}</b>`}<span>${esc(r.why)}</span><small>${esc(hostOf(r.url).replace(/^www\./, ""))}</small></li>`).join("")}</ol>
        <p class="nvFine">Suggestions come only from scholarly sources such as arXiv, journals and university pages, and are screened like everything else Synapse shows you.</p>
      </div></section>` : ""}

      <section class="rd-sec"><h2>Before you start</h2><div class="rd-checks">
        <div class="rd-check ${/testing|Being tested/i.test(nn.next_step) ? "wait" : "ok"}"><b>First step</b><p>${esc(nn.next_step)}</p></div>
        ${nn.risks.map(r => `<div class="rd-check no"><b>Risk</b><p>${esc(r)}</p></div>`).join("")}
      </div></section>
      <div class="rd-foot"><span>Idea by Muse Spark 1.3 · searched with Muse Spark 1.3 web search</span></div>`);
  }

  /* ---------- right panel: short summaries; the full story opens in the reading page ---------- */
  function finding(c) {
    const A = paper(c.a.paper), B = paper(c.b.paper), t = T[c.type];
    $("#panel").innerHTML = `
      <button class="back" id="back">← Overview</button>
      <div class="chips2"><span class="typeChip" style="--c:${t.color}">${esc(t.name)}</span><span class="chipS ${c.status}">${WORD[c.status]}</span></div>
      <h1>${esc(c.headline)}</h1>
      <div class="meta"><button class="plink" data-p="${A.id}">${esc(short(A.id))}</button> (${esc(A.field)}) and <button class="plink" data-p="${B.id}">${esc(short(B.id))}</button> (${esc(B.field)})</div>
      <p class="lead">${esc(c.shared)}</p>
      ${c.type !== "discarded" ? `<div class="forYou"><b>For your paper.</b> ${esc(c.for_you)}</div>` : ""}
      <button class="btn dark readmore" data-read="${c.id}">Read the full explanation</button>`;
    $("#back").onclick = () => select(null);
  }
  function ideaView(nn) {
    $("#panel").innerHTML = `
      <button class="back" id="back">← Overview</button>
      <div class="chips2"><span class="typeChip" style="--c:#d9822b">A paper you could write</span></div>
      <h1>${esc(nn.title)}</h1>
      <div class="q big"><span>Research question</span>${esc(nn.question)}</div>
      <p class="body" style="margin-top:12px">${esc(nn.pitch)}</p>
      <button class="btn dark readmore" data-read="${nn.id}">Read the full plan</button>`;
    $("#back").onclick = () => select(null);
  }
  $("#panel").addEventListener("click", e => {
    const r = e.target.closest("[data-read]"); if (!r) return;
    e.stopPropagation(); conn(r.dataset.read) ? readRel(conn(r.dataset.read)) : readIdea(idea(r.dataset.read));
  }, true);

  /* ---------- right panel: a paper ---------- */
  function paperView(p) {
    const links = run.connections.filter(c => (c.a.paper === p.id || c.b.paper === p.id) && c.type !== "discarded");
    const roles = run.next_papers.flatMap(nn => nn.parts.filter(pt => pt.paper === p.id).map(pt => [nn, pt]));
    $("#panel").innerHTML = `
      <button class="back" id="back">← Overview</button>
      <div style="margin-top:14px" class="meta"><span style="display:inline-block;width:8px;height:8px;background:${fieldColor[p.field]};margin-right:6px"></span>${esc(p.field)} · <span class="mono">${esc(p.category)}</span></div>
      <h1>${esc(p.title)}</h1>
      <div class="meta">${p.real ? `${esc(p.authors)} · ${p.year}` : ""}${p.url ? ` · <a href="${safeUrl(p.url)}" rel="noopener" target="_blank">Source</a>` : ""}</div>
      <div class="lab" style="margin-top:18px">Its key ideas, in plain words</div>
      <ul class="ideas">${p.ideas.map(i => `<li>${esc(i.label)}</li>`).join("")}</ul>
      ${roles.length ? `<h2 class="h2">Its part in papers you could write</h2><ul class="parts">${roles.map(([nn, pt]) => `<li><button data-n="${nn.id}"><span class="role">${esc(pt.role)}</span><span><b>${esc(nn.title)}</b><span class="pdet">${esc(pt.detail)}</span></span></button></li>`).join("")}</ul>` : ""}
      <h2 class="h2">How it relates to the other papers</h2>
      <ul class="connList rels">${links.map(c => relRow(c, p.id)).join("") || '<li class="meta">No links yet.</li>'}</ul>
      <button class="btn line cmpBtn" id="cmpThis">Compare it with other papers</button>`;
    $("#back").onclick = () => select(null);
    $("#cmpThis").onclick = () => readCompare(p.id);
  }

  /* ---------- replay: the discovery, step by step ---------- */
  const reveal = async (g, ms) => {
    g.style.opacity = 1;
    const px = [...g.querySelectorAll(".dots rect")];
    px.forEach(r => r.style.opacity = 0); g.getBoundingClientRect();
    px.forEach((r, i) => { r.style.transition = `opacity .05s ${i * ms / px.length}ms`; r.style.opacity = 1; });
    await sleep(ms * .5);
  };
  async function replay() {
    if (replaying) return;
    // the replay tells the whole story, so it plays in the idea view
    if (mapMode !== "idea" && current.id) { mapMode = "idea"; renderMap(); }
    replaying = true; select(null);
    const cap = $("#caption"), say = t => { cap.textContent = t; cap.classList.add("on"); };
    const cards = [...svg.querySelectorAll(".card")], links = [...svg.querySelectorAll(".link")], brs = [...svg.querySelectorAll(".br")], ideaG = svg.querySelector(".idea");
    [...cards, ...links, ...brs, ideaG].forEach(g => g.style.opacity = 0);
    $("#panel").innerHTML = `<div class="lab">Agents at work</div><div id="rows"></div>`;
    const push = r => $("#rows").insertAdjacentHTML("beforeend", agentRow(r, true));
    say(`Reading ${n} papers`);
    for (const c of cards) { c.style.opacity = 1; await sleep(300); }
    push(AGENTS[0]); await sleep(500); push(AGENTS[1]);
    say(`Comparing ${f.pairs} possible pairings`);
    const ids = run.papers.map(p => p.id), cand = $("#cands"); let h = "";
    for (let i = 0; i < 26; i++) { const a = ids[(Math.random() * n) | 0], b = ids[(Math.random() * n) | 0]; if (a !== b) h += `<path class="cand" d="M${pos[a][0]} ${pos[a][1]} L${pos[b][0]} ${pos[b][1]}"/>`; }
    cand.innerHTML = h; await sleep(1600);
    cand.querySelectorAll("path").forEach((p, i) => { if (i % 4) p.style.opacity = 0; }); push(AGENTS[2]); await sleep(900);
    cand.innerHTML = "";
    say("Naming how each pair relates, with quotes from both papers");
    for (const l of links) { l.classList.remove("off"); await reveal(l, 800); }
    push(AGENTS[3]); await sleep(700);
    say("A second AI throws out links that only share a word");
    await sleep(1100);
    links.filter(l => l.classList.contains("discard")).forEach(l => { l.style.transition = "opacity .6s"; l.style.opacity = 0; });
    push(AGENTS[4]); await sleep(900);
    AGENTS.slice(5, -1).forEach(push); await sleep(700);
    say("Turning the relationships into ideas for new papers, then searching published work for each");
    for (const b of brs) await reveal(b, 500);
    ideaG.style.opacity = 1; push(AGENTS[AGENTS.length - 1]); await sleep(1400);
    [...cards, ...links, ...brs, ideaG].forEach(g => { g.style.opacity = ""; g.style.transition = ""; });
    cap.classList.remove("on"); replaying = false; apply();
    apply(); feed();
  }
  $("#replay").addEventListener("click", () => reduced ? null : replay());

  /* ---------- adding papers (analysis arrives with the backend) ---------- */
  function addFiles(list) {
    if (api.offline) { flash("This copy of Synapse can't read papers. Run it on your own computer with your own Meta API key."); return; }
    if (api.status && api.status.uploads === false) { flash("Uploading PDFs only works when Synapse runs on your own computer. Paste a link instead."); return; }
    const kindOf = x => x.type === "application/pdf" || /\.pdf$/i.test(x.name) ? "pdf" : TALKS && (/^audio\//.test(x.type) || /\.(mp3|m4a|wav|ogg|flac)$/i.test(x.name)) ? "audio" : null;
    const pdfs = [...list].filter(kindOf);
    if (!pdfs.length) { flash(TALKS ? "Only PDFs and talk recordings can be added." : "Only PDFs can be added."); return; }
    const fresh = pdfs.filter(x => !queue.some(q => q.file && q.name === x.name && q.file.size === x.size));
    fresh.forEach(x => { const q = newItem(kindOf(x), x.name, x); queue.push(q); files.put(q.id, x); localChecks(q); }); renderQueue(); remember(); showPage("add");
    const skipped = pdfs.length - fresh.length;
    flash(fresh.length ? `${fresh.length} item${fresh.length > 1 ? "s" : ""} added${skipped ? `, ${skipped} already in the list` : ""}. Each gets a safety check before any AI reads it.` : "Already in the list.");
  }
  // a short message at the bottom of the screen, with an optional Undo
  function flash(t, undo) {
    const el = $("#toast"); clearTimeout(flash.t);
    el.innerHTML = `<span>${esc(t)}</span>${undo ? '<button>Undo</button>' : ""}`; el.hidden = false;
    if (undo) el.querySelector("button").onclick = () => { undo(); el.hidden = true; };
    flash.t = setTimeout(() => { el.hidden = true; }, undo ? 6000 : 3500);
  }
  $("#file").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  $("#audio").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  let depth = 0;
  addEventListener("dragenter", e => { e.preventDefault(); depth++; $("#drop").hidden = false; });
  // the drop box in the Add section highlights when a file is held over it
  $("#dropZone").addEventListener("dragover", () => $("#dropZone").classList.add("over"));
  $("#dropZone").addEventListener("dragleave", () => $("#dropZone").classList.remove("over"));
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; $("#drop").hidden = true; } });
  addEventListener("dragover", e => e.preventDefault());
  addEventListener("drop", e => { e.preventDefault(); depth = 0; $("#drop").hidden = true; addFiles(e.dataTransfer.files); });

  /* ---------- start ---------- */
  renderMap(); renderPapers(); renderQueue(); setMode(mode); setSide(sideOff); showPage(page); $("#ideaIn").value = mine.text || "";
  const start = parse(location.hash.slice(1));
  if (start) select(start, (history.state && history.state.back) || null); else { apply(); feed(); }
})();
