/* Draws experiment charts from run data into an <svg>. One scale per axis; ticks only at real values. */
(function () {
  "use strict";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function niceTicks(lo, hi, count = 4) {
    const span = hi - lo || 1, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
    return out;
  }
  const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : (+v.toFixed(2)).toString();

  /** chart: {kind:"lines"|"bars", x_label, y_label, series, categories?, marker?}; roles: {a:rgb, b:rgb, accent:css} */
  function draw(svg, chart, roles, width = 420, height = 190) {
    const L = 38, R = 10, T = 30, B = 34, W = width, H = height;
    const colorOf = r => roles[r] || "var(--flare)";
    let h = "", xs, ys;
    if (chart.kind === "lines") {
      const all = chart.series.flatMap(s => s.points);
      const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
      let y0 = Math.min(...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
      const pad = (y1 - y0) * .08; y0 -= pad; y1 += pad;
      xs = v => L + (v - x0) / (x1 - x0) * (W - L - R); ys = v => H - B - (v - y0) / (y1 - y0) * (H - B - T);
      niceTicks(y0, y1).forEach(v => { h += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 3.5}" text-anchor="end">${fmt(v)}</text>`; });
      niceTicks(x0, x1, 5).forEach(v => { h += `<text x="${xs(v)}" y="${H - B + 15}" text-anchor="middle">${fmt(v)}</text>`; });
      if (chart.marker) h += `<g class="mk"><line x1="${xs(chart.marker.x)}" x2="${xs(chart.marker.x)}" y1="${T}" y2="${H - B}" stroke="var(--flare)" stroke-dasharray="3 4" opacity=".7"/><text x="${xs(chart.marker.x) + 6}" y="${T + 12}">${esc(chart.marker.label)}</text></g>`;
      chart.series.forEach(s => {
        const d = s.points.map(p => `${xs(p[0]).toFixed(1)},${ys(p[1]).toFixed(1)}`).join(" ");
        h += `<polyline points="${d}" fill="none" stroke="${colorOf(s.role)}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linejoin="round"/>`;
        const e = s.points[s.points.length - 1]; h += `<circle cx="${xs(e[0])}" cy="${ys(e[1])}" r="2.6" fill="${colorOf(s.role)}"/>`;
      });
    } else {
      const cats = chart.categories, ymax = Math.max(...chart.series.flatMap(s => s.values)) * 1.08;
      const band = (W - L - R) / cats.length, bw = Math.min(18, band / (chart.series.length + 1.2));
      ys = v => H - B - v / ymax * (H - B - T);
      niceTicks(0, ymax).forEach(v => { h += `<line class="grid" x1="${L}" x2="${W - R}" y1="${ys(v)}" y2="${ys(v)}"/><text x="${L - 6}" y="${ys(v) + 3.5}" text-anchor="end">${fmt(v)}×</text>`; });
      cats.forEach((c, i) => {
        const cx = L + band * (i + .5);
        chart.series.forEach((s, j) => {
          const x = cx + (j - (chart.series.length - 1) / 2) * (bw + 3) - bw / 2;
          h += `<rect x="${x.toFixed(1)}" y="${ys(s.values[i]).toFixed(1)}" width="${bw}" height="${(H - B - ys(s.values[i])).toFixed(1)}" fill="${colorOf(s.role)}" rx="1.5"/>`;
        });
        h += `<text x="${cx}" y="${H - B + 15}" text-anchor="middle">${esc(c)}</text>`;
      });
    }
    h = `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>` + h;
    h += `<text x="${W - R}" y="${H - 4}" text-anchor="end">${esc(chart.x_label)}</text>`;
    let kx = L; h += `<g class="key">`;
    chart.series.forEach(s => {
      h += `<line x1="${kx}" x2="${kx + 18}" y1="11" y2="11" stroke="${colorOf(s.role)}" stroke-width="2.4" ${s.dashed ? 'stroke-dasharray="5 4"' : ""}/><text x="${kx + 24}" y="15">${esc(s.name)}</text>`;
      kx += 34 + s.name.length * 6.1;
    });
    h += `</g>`;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = h;
  }
  window.SynapseCharts = { draw, esc };
})();
