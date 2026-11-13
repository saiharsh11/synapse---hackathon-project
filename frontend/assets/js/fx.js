/* Small touches: our own pixel icon set, pixel garden dividers,
   and pointer effects (pollen trail, card spotlight, magnetic buttons).
   Pointer effects run only on mouse/trackpad devices and never with reduced motion. */
(function () {
  "use strict";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* ---------- pixel icons (12×12, drawn square by square) ---------- */
  const PAL = { k: "#1b1f1c", p: "#ffffff", s: "#c7ccc4", g: "#3f9a64", l: "#9fd3b2", a: "#d9822b", y: "#f2b45c", b: "#3d7fd9", c: "#b9d0f5", r: "#c94848", w: "#d65a7f" };
  const ICONS = {
    read: ["............", ".kkkk..kkkk.", "kppppkkppppk", "kpsspkkpsspk", "kppppkkppppk", "kpsspkkpsspk", "kppppkkppppk", "kpsspkkppppk", "kppppkkppppk", "kkkkkkkkkkkk", ".....kk.....", "............"],
    translate: ["kkkkkk......", "kllllk......", "kllllk......", "kkkkkk......", ".k..........", "....kkkkkkkk", "....kyyyyyyk", "....kyyyyyyk", "....kyyyyyyk", "....kkkkkkkk", "..........k.", "............"],
    match: ["............", "...kkkk.....", "..kcccck....", ".kccpccck...", ".kcpcccck...", ".kcccccck...", "..kcccck....", "...kkkkk....", ".......kk...", "........kk..", ".........kk.", "............"],
    connect: ["............", ".aaaaaa.....", ".a....a.....", ".a..bbbbbb..", ".a..b.a..b..", ".aaaaaa..b..", "....b....b..", "....bbbbbb..", "............", "............", "............", "............"],
    challenge: ["............", "..kkkkkkkk..", "..kllllllk..", "..klllllgk..", "..kllllggk..", "..kglggllk..", "...kggllk...", "...kllllk...", "....kllk....", ".....kk.....", "............", "............"],
    test: ["....kkkk....", ".....kk.....", ".....kk.....", "....kppk....", "...kppppk...", "..kppppppk..", ".kyyyyyyyyk.", "kyyayyyyayyk", "kyyyyayyyyyk", "kyyyyyyyyyyk", ".kkkkkkkkkk.", "............"],
    bird: ["............", "............", "kk........kk", ".kk......kk.", "..kk....kk..", "...kk..kk...", "....kkkk....", ".....kk.....", "............", "............", "............", "............"],
    sprout: ["............", "......ll....", ".....lggl...", "..ll..gl....", ".lggl.g.....", "..lgggg.....", "....g.......", "....g.......", "..aaaaaa....", "..ayyyya....", "...ayya.....", "............"],
    frame: ["kkk......kkk", "k..........k", "k..........k", "....yy......", "....yy......", "......b.....", ".....bbb....", "..b.bbbbb...", ".bbbbbbbbb..", "k..........k", "k..........k", "kkk......kkk"],
    plus: ["............", ".kkkkkkkk...", ".kppppppkk..", ".kppppppkpk.", ".kppggpppkk.", ".kppggpppk..", ".kggggggpk..", ".kggggggpk..", ".kppggpppk..", ".kppggpppk..", ".kkkkkkkkk..", "............"],
    bulb: ["....kkkk....", "...kyyyyk...", "..kyypyyyk..", "..kypyyyyk..", "..kyyyyyyk..", "..kyyyyyyk..", "...kyyyyk...", "....kaak....", "....kssk....", "....kssk....", ".....kk.....", "............"],
    page: ["............", ".kkkkkkk....", ".kppppppkk..", ".kpsssspkpk.", ".kppppppkkk.", ".kpssssspk..", ".kppppppppk.", ".kpsssssspk.", ".kppppppppk.", ".kpssssppppk", ".kkkkkkkkkkk", "............"],
    lock: ["............", "....kkkk....", "...k....k...", "...k....k...", "..kkkkkkkk..", "..kyyyyyyk..", "..kyykkyyk..", "..kyykkyyk..", "..kyyyyyyk..", "..kkkkkkkk..", "............", "............"],
  };
  function iconSVG(name, size = 36) {
    const rows = ICONS[name]; if (!rows) return "";
    let r = "";
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (PAL[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[ch]}"/>`; }));
    return `<svg class="px-icon" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  // draws each icon once; pages that add icons later call PixelIcons.paint on the new part
  const paint = (root = document) => root.querySelectorAll("[data-icon]:not([data-painted])").forEach(el => { el.dataset.painted = ""; el.insertAdjacentHTML("afterbegin", iconSVG(el.dataset.icon, +el.dataset.size || 36)); });
  paint();
  window.PixelIcons = { paint };

  /* ---------- pixel garden dividers ---------- */
  document.querySelectorAll(".sprig").forEach((el, i) => {
    const R = rng(31 + i * 7), W = 280, H = 8;
    let r = "";
    for (let x = 0; x < W; x++) {
      const h = R() < .55 ? 1 + ((R() * 3) | 0) : 0;
      for (let y = 0; y < h; y++) r += `<rect x="${x}" y="${H - 1 - y}" width="1" height="1" fill="${y === h - 1 && R() < .4 ? "#9fd3b2" : "#5fb37f"}"/>`;
      if (R() < .035) { const col = ["#ffffff", "#f2b45c", "#d65a7f", "#b9d0f5"][(R() * 4) | 0]; r += `<rect x="${x}" y="${H - 5}" width="1" height="3" fill="#3f9a64"/><rect x="${x - 1}" y="${H - 7}" width="3" height="2" fill="${col}"/><rect x="${x}" y="${H - 7}" width="1" height="1" fill="#f2b45c"/>`; }
      if (R() < .006) r += `<rect x="${x}" y="${H - 4}" width="4" height="3" fill="#ffffff"/><rect x="${x + 1}" y="${H - 3}" width="2" height="1" fill="#c7ccc4"/>`;
      if (R() < .004) r += `<rect x="${x}" y="${H - 3}" width="2" height="2" fill="#c94848"/><rect x="${x}" y="${H - 3}" width="1" height="1" fill="#1b1f1c"/>`;
    }
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  });

  if (reduced || !finePointer) return;

  /* ---------- card spotlight: a warm glow follows the pointer ---------- */
  document.addEventListener("pointermove", e => {
    const card = e.target.closest(".glow");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`); card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });

  /* ---------- magnetic buttons ---------- */
  document.querySelectorAll(".btn").forEach(b => {
    b.addEventListener("pointermove", e => {
      const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      b.style.transform = `translate(${dx * .15}px, ${dy * .25}px)`;
    });
    b.addEventListener("pointerleave", () => { b.style.transform = ""; });
  });

  /* ---------- pollen trail: tiny pixel squares drift up from the cursor ---------- */
  if (!document.body.classList.contains("trail")) return;
  const cv = document.createElement("canvas"); cv.className = "pollen"; cv.setAttribute("aria-hidden", "true");
  document.body.appendChild(cv);
  const g = cv.getContext("2d"), bits = [], COLORS = ["#9fd3b2", "#f2b45c", "#d65a7f", "#b9d0f5", "#ffffff"];
  let W = 0, H = 0, lastSpawn = 0, running = false;
  const size = () => { const d = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * d; cv.height = H * d; g.setTransform(d, 0, 0, d, 0, 0); };
  size(); addEventListener("resize", size);
  addEventListener("pointermove", e => {
    const now = performance.now(); if (now - lastSpawn < 28) return; lastSpawn = now;
    bits.push({ x: e.clientX + (Math.random() - .5) * 8, y: e.clientY + (Math.random() - .5) * 8, vx: (Math.random() - .5) * 18, vy: -14 - Math.random() * 22, life: 1, s: Math.random() < .3 ? 4 : 3, c: COLORS[(Math.random() * COLORS.length) | 0] });
    if (bits.length > 70) bits.shift();
    if (!running) { running = true; requestAnimationFrame(tick); }
  });
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, W, H);
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i]; b.life -= dt * 1.4; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= .98;
      if (b.life <= 0) { bits.splice(i, 1); continue; }
      g.globalAlpha = b.life; g.fillStyle = b.c; g.fillRect(Math.round(b.x), Math.round(b.y), b.s, b.s);
      g.globalAlpha = b.life * .5; g.fillStyle = "#1b1f1c"; g.fillRect(Math.round(b.x) + b.s, Math.round(b.y) + b.s, 1, 1);
    }
    g.globalAlpha = 1;
    if (bits.length) requestAnimationFrame(tick); else { running = false; g.clearRect(0, 0, W, H); }
  }
})();
