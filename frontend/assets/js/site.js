/* Landing page: pixel-art hero plus sections rendered from the same run data the app uses. */
(async function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const esc = SynapseCharts.esc;
  Garden.mount($("#garden"));
  Sky.mount($("#sky"));

  // the latest run on this server, made from papers someone added; no run means nothing is shown
  const getJson = u => fetch(u, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
  const run = await getJson("/api/runs/latest");
  // without a model key this copy can't read papers: say why (the sponsors' API access ended with the hackathon)
  getJson("/api/status").then(st => { if (!st || !st.meta) $("#spNote").hidden = false; });

  /* ---------- sponsor line: what each one does in Synapse, on hover or focus ---------- */
  const SPONSOR = {
    meta: "<b>Meta</b><i>AI lab · makes the Muse models</i>Muse Spark reads the papers, finds the links and plans new papers. Muse Spark Open challenges every link.",
    baseten: "<b>Baseten</b><i>GPU inference platform</i>Runs Muse Spark Open for Synapse: the Challenger, a second model that tries to break each link before you see it.",
    modal: "<b>Modal</b><i>Serverless cloud for AI apps</i>Hosts the live Synapse site, so anyone can try it in a browser.",
    fireworks: "<b>Fireworks</b><i>Inference and fine-tuning for open models</i>A hackathon sponsor that runs and customises open models like Muse Glimmer.",
  };
  const spSay = $("#spSay"), spIdle = spSay.innerHTML, spLine = $(".sponsors .marquee");
  const spShow = li => { spSay.innerHTML = li ? SPONSOR[li.dataset.k] : spIdle; spSay.classList.toggle("on", !!li); spLine.classList.toggle("held", !!li); };
  $(".sponsors").addEventListener("mouseover", e => { const li = e.target.closest("li[data-k]"); if (li) spShow(li); });
  $(".sponsors .marquee").addEventListener("mouseleave", () => spShow(null));
  $(".sponsors").addEventListener("focusin", e => { const li = e.target.closest("li[data-k]"); if (li) spShow(li); });
  $(".sponsors").addEventListener("focusout", () => spShow(null));

  /* ---------- fireflies at dusk ---------- */
  let lastPct = -1;
  const flies = Fireflies.mount($("#flies"), { onOrder: r => {
    const pct = Math.round(r * 100); if (pct === lastPct) return; lastPct = pct;
    $("#syncPct").textContent = pct + "%"; $("#syncBar").style.width = pct + "%";
  } });
  $("#scatter").addEventListener("click", () => flies.scatter());

  /* ---------- no run yet: only the parts that don't show results ---------- */
  if (!run) {
    [".fields", "#example", "#rosetta", ".strings", "#pvNovel"].forEach(sel => { const el = $(sel); if (el) el.hidden = true; });
    $("#mini").closest("section").hidden = true;
    document.querySelectorAll('a[href="#example"]').forEach(a => { a.hidden = true; });
    return;
  }

  const paper = id => run.papers.find(p => p.id === id);

  // field colours tuned for a light page
  const LIGHT = ["#3f9a64", "#d65a7f", "#8aa43a", "#6d62d6", "#2f86c9", "#b558c9", "#2fa3a3", "#c98a2f"];
  const fieldColor = {}; let fi = 0;
  run.papers.forEach(p => { if (!fieldColor[p.field]) fieldColor[p.field] = LIGHT[fi++ % LIGHT.length]; });
  const STATUS = { proven: "var(--proven)", testing: "var(--testing)", rejected: "var(--rejected)" };

  /* ---------- fields strip ---------- */
  $("#fieldRow").innerHTML = [...new Map(run.papers.map(p => [p.field, p])).values()].map(p => `<div class="field"><i style="background:${fieldColor[p.field]}"></i>${esc(p.field)} <span>${esc(p.category)}</span></div>`).join("");
  $("#runTitle").textContent = run.run.title;
  $("#fieldNote").textContent = `Works with papers from any field. These ${run.papers.length} are on the current map, read by Synapse's agents.`;

  /* ---------- mini map: a paper you could write, in the middle, the papers it draws on around it ---------- */
  const svg = $("#mini"), T = PixelMap.TYPES, still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sheetW = p => Math.max((p.short || p.title).length * 6.9, p.field.length * 6 + 40) + 30;
  const live = run.connections.filter(c => c.type !== "discarded");
  let idea = run.next_papers[0];
  function drawMini() {
    const M = PixelMap.mindmap(run, idea, { w: 640, h: 540, sheet: p => [sheetW(p), 54], allTags: false, pad: 30 });
    svg.setAttribute("viewBox", `0 0 ${M.w} ${M.h}`);
    svg.innerHTML = live.map(c => `<g class="lk${M.inIdea.has(c.id) ? "" : " faint"}" data-c="${c.id}" tabindex="0" role="button" aria-label="${esc(T[c.type].name)}: ${esc(c.headline)}">${PixelMap.typedLink(M, c, !still)}</g>`).join("")
      + idea.parts.map(pt => `<g class="br">${PixelMap.branch(M, pt)}</g>`).join("")
      + run.papers.map(p => `<g class="pp${M.uses.has(p.id) ? "" : " faint"}" transform="translate(${M.pos[p.id]})">${PixelMap.sheet({ w: sheetW(p), h: 54, field: p.field, color: fieldColor[p.field], title: p.short || p.title })}</g>`).join("")
      + `<g class="idea" transform="translate(${M.cx},${M.cy})">${PixelMap.ideaNode(M)}</g>`;
    $("#ideaSw").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.n === idea.id));
    sayIdea();
  }
  const mv = svg.closest(".mapview");
  mv.insertAdjacentHTML("afterbegin", `<div class="ideasw" id="ideaSw" role="group" aria-label="Choose an idea">${run.next_papers.map((n, i) => `<button data-n="${n.id}">Idea ${i + 1}</button>`).join("")}</div>`);
  $("#ideaSw").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { idea = run.next_papers.find(n => n.id === b.dataset.n); drawMini(); } });
  const kinds = [...new Set(live.map(c => c.type))];
  mv.querySelector(".legend").innerHTML = kinds.map(k => `<span><i style="border-color:${T[k].color}"></i>${esc(T[k].name)}</span>`).join("");

  /* ---------- agent feed ---------- */
  const f = run.run.funnel, proven = run.connections.filter(c => c.status === "proven"), rej = run.connections.filter(c => c.type === "discarded"), testing = run.connections.filter(c => c.status === "testing");
  const rows = [
    ["Reader", `Read ${f.papers} papers, every page and figure`, "done", "Done"],
    ["Translator", `Rewrote ${f.ideas} ideas in plain words`, "done", "Done"],
    ["Connector", `Found ${live.length} relationships of ${kinds.length} kinds`, "done", "Done"],
    ["Challenger", rej.length ? `Threw out ${rej.length} that only share a word` : "Every link held up", "done", "Done"],
    ["Planner", `Suggested ${run.next_papers.length} ideas for papers you could write`, "done", "Done"],
  ];
  $("#agents").innerHTML = rows.map(([who, what, cls, b]) => `<div class="agent"><b>${who}</b><span class="badge ${cls}">${b}</span><small>${esc(what)}</small></div>`).join("");
  // the strongest link that held up, to show start to finish
  // the link to show: across two fields if there is one, then confirmed by the final check, then strongest
  const crossField = c => paper(c.a.paper).field !== paper(c.b.paper).field, confirmed = c => c.challenge && c.challenge.final && c.challenge.final.verdict !== "reject";
  const best = live.filter(c => c.challenge && (c.evidence || []).length)
    .sort((a, b) => crossField(b) - crossField(a) || confirmed(b) - confirmed(a) || b.strength - a.strength)[0];
  function sayIdea() {
    $("#msg").innerHTML = `<b>A paper you could write:</b> ${esc(idea.title)}. ${esc(idea.pitch)}<br><a href="map.html#${idea.id}">Open it in the map →</a>`;
    svg.querySelectorAll(".lk").forEach(g => g.classList.remove("on"));
  }
  function say(c) {
    const a = paper(c.a.paper).short, b = paper(c.b.paper).short;
    $("#msg").innerHTML = `<b>${esc(T[c.type].name)}:</b> ${esc(a)} and ${esc(b)}. ${esc(c.for_you)}<br><a href="map.html#${c.id}">See the evidence →</a>`;
    svg.querySelectorAll(".lk").forEach(g => g.classList.toggle("on", g.dataset.c === c.id));
  }
  svg.addEventListener("click", e => { const g = e.target.closest(".lk"); if (g) say(run.connections.find(c => c.id === g.dataset.c)); else if (e.target.closest(".idea")) sayIdea(); });
  svg.addEventListener("keydown", e => { const g = e.target.closest(".lk"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); say(run.connections.find(c => c.id === g.dataset.c)); } });
  // a real run may have no paper ideas, close pairs or checked links yet: those sections then stay hidden
  const hideSec = sel => { const el = $(sel); if (el && el.closest("section")) el.closest("section").hidden = true; };
  if (idea) drawMini(); else hideSec("#mini");

  /* ---------- same idea, different words ---------- */
  const shown = run.connections.filter(c => c.type === "same_mechanism" || c.type === "borrow_method");
  $("#rTabs").innerHTML = shown.map((c, i) => `<button role="tab" id="rt-${c.id}" aria-selected="${i === 0}" data-c="${c.id}">${esc(c.pattern)}</button>`).join("");
  function rosetta(c, animate) {
    const A = paper(c.a.paper), B = paper(c.b.paper), fx = animate ? " fade" : "";
    $("#rBody").innerHTML = `
      <div class="side glow${fx}"><div class="lab"><i style="background:${fieldColor[A.field]}"></i>In ${esc(A.field)}</div><p>${esc(c.in_a)}</p><small>${esc(A.title)}</small></div>
      <div class="bridge"><span>same<br>mechanism</span></div>
      <div class="side glow${fx}"><div class="lab"><i style="background:${fieldColor[B.field]}"></i>In ${esc(B.field)}</div><p>${esc(c.in_b)}</p><small>${esc(B.title)}</small></div>
      <div class="shared${fx}"><b>${esc(c.pattern)}.</b> ${esc(c.shared)}</div>`;
    document.querySelectorAll("#rTabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.c === c.id));
  }
  $("#rTabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) rosetta(shown.find(c => c.id === b.dataset.c), true); });
  if (shown.length) rosetta(shown[0]); else hideSec("#rTabs");

  /* ---------- the thread scene: papers drift apart, threads reach between the ones that relate ---------- */
  const scene = Threads.mount($("#scene"), {
    papers: run.papers, links: run.connections, fieldColor, esc,
    typeColor: t => T[t].color, typeName: t => T[t].name,
    caption: t => { $("#strSay").textContent = t; },
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  // the same story as text, for screen readers
  $("#sceneList").innerHTML = run.connections.map(c => `<li>${esc(paper(c.a.paper).short)} and ${esc(paper(c.b.paper).short)}: ${c.type === "discarded" ? `thrown out, ${esc(c.relation)}` : `${esc(T[c.type].name)}, held`}.</li>`).join("");
  $("#strReplay").addEventListener("click", () => scene.replay());

  /* ---------- one finding, start to finish ---------- */
  if (!best) { hideSec("#exTitle"); }
  const A = best ? paper(best.a.paper) : run.papers[0], B = best ? paper(best.b.paper) : run.papers[1];
  if (best) {
  $("#exHead").innerHTML = best && crossField(best) ? `One finding <span>from two papers in different fields</span>` : `One finding <span>start to finish</span>`;
  $("#exTitle").textContent = best.headline;
  $("#exSides").hidden = true; $("#exShared").hidden = true;   // the headline says it: the two quotes show it
  // one quote per paper: the full evidence is a click away in the app
  const oneEach = [best.a.paper, best.b.paper].map(pid => best.evidence.find(e => e.paper === pid)).filter(Boolean);
  $("#exQuotes").innerHTML = oneEach.map(e => { const P = paper(e.paper); return `<blockquote class="exQ" style="--c:${fieldColor[P.field]}"><span class="exF">${esc(P.field)}</span><span class="exT">“${esc(e.text)}”</span><cite>${esc(P.short || P.title)}, p. ${e.page} · checked word for word</cite></blockquote>`; }).join("")
    + `<a class="exMore" href="map.html#${encodeURIComponent(best.id)}">See the full evidence →</a>`;
  const ch = best.challenge || { passed: 0, total: 0, attacks: [] };
  $("#exHyp").textContent = `${ch.passed} of ${ch.total} checks passed`;
  // the five questions at a glance; each answer opens on hover or tap
  $("#exAtt").innerHTML = ch.attacks.map(a => `<li class="${a.verdict}"><details><summary><span class="v">${a.verdict === "pass" ? "✓" : a.verdict === "caveat" ? "!" : "✕"}</span>${esc(a.question)}</summary><p>${esc(a.answer)}</p></details></li>`).join("");
  // with a mouse, an answer opens while the pointer is on its question; a tap opens it too
  $("#exAtt").addEventListener("mouseover", e => { const d = e.target.closest("details"); if (d && matchMedia("(hover: hover)").matches) d.open = true; });
  $("#exAtt").addEventListener("mouseout", e => { const d = e.target.closest("details"); if (d && !d.contains(e.relatedTarget) && matchMedia("(hover: hover)").matches) d.open = false; });
  const FINAL = { confirm: "confirmed", caveat: "kept, with a caveat", reject: "rejected" };
  $("#exVerdict").innerHTML = `Challenged by ${/wonder/i.test(ch.model || "") ? "Muse Wonder" : "Muse Spark Open"}${ch.final ? ` · final check by Muse Wonder: ${FINAL[ch.final.verdict]}` : ""}<small>From the current map, read by Synapse's agents.</small>`;
  }

  /* ---------- next up: small previews of what's being built ---------- */
  const novel = $("#pvNovel");
  // the idea from the run on this page, and whether it has been searched: nothing here is made up
  const nn = run.next_papers[0], nv = nn && nn.novelty;
  if (nn) novel.innerHTML = `<div class="q">Idea from this run: <b>${esc(nn.title)}</b></div>
    <div class="ok">${nv && nv.state !== "unchecked" ? esc(nv.note) : "Not searched yet. The search runs only when you ask for it."}</div>`;


})();
