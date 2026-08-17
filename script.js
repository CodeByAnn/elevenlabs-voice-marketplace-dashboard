const state = {
  voices: [],
  filtered: [],
  meta: null,
  dimension: "descriptive",
  audio: null,
  filters: {
    search: "",
    language: "all",
    use_case: "all",
    accent: "all",
    gender: "all",
    clones: 0,
  },
};

const colors = [
  "#ff5a1f", "#8d78ff", "#62b7ff", "#9db7a7", "#d38175", "#cfd3cd",
  "#2f7f66", "#e6a93a", "#7f6a5d", "#050505",
];

const timelineData = [
  ["Jun 2023", "1M+ users", "$19M Series A"],
  ["Jan 2024", "$80M Series B", "Enterprise adoption expands"],
  ["Jan 2025", "$3.3B valuation", "AI audio enters the scale-up phase"],
  ["Nov 2025", "$11M creator payouts", "Marketplace earnings become visible"],
  ["End 2025", "$350M ARR", "Revenue run-rate accelerates"],
  ["Feb 2026", "$11B valuation", "$500M Series D"],
  ["May 2026", "$500M+ ARR", "$22M+ creator payouts, 10.4K+ earning creators"],
];

const tooltip = d3.select("#tooltip");
const fmt = d3.format(",");
const compact = d3.format(".3s");
const moneyCompact = (value) => compact(value).replace("G", "B");
const pct = d3.format(".1%");

function label(value) {
  if (!value || value === "Unknown") return "Unknown";
  return String(value).replaceAll("_", " ").replaceAll("-", " ");
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function groupByDimension(rows, dimension) {
  return Array.from(
    d3.rollup(
      rows,
      (items) => ({
        key: items[0][dimension] || "Unknown",
        usage: d3.sum(items, (d) => d.usage_character_count_1y),
        weekly: d3.sum(items, (d) => d.usage_character_count_7d),
        clones: d3.sum(items, (d) => d.cloned_by_count),
        voices: items.length,
      }),
      (d) => d[dimension] || "Unknown",
    ).values(),
  ).sort((a, b) => b.usage - a.usage);
}

function aggregateCreators(rows) {
  const creators = Array.from(
    d3.rollup(
      rows,
      (items) => ({
        id: items[0].public_owner_id,
        usage: d3.sum(items, (d) => d.usage_character_count_1y),
        clones: d3.sum(items, (d) => d.cloned_by_count),
        voices: items.length,
        topVoice: items.slice().sort((a, b) => b.usage_character_count_1y - a.usage_character_count_1y)[0],
      }),
      (d) => d.public_owner_id,
    ).values(),
  ).sort((a, b) => b.usage - a.usage);

  const total = d3.sum(creators, (d) => d.usage) || 1;
  creators.forEach((creator) => {
    creator.share = creator.usage / total;
  });
  return creators;
}

function populateSelect(id, values, allLabel) {
  const select = document.getElementById(id);
  const current = select.value || "all";
  select.innerHTML = [
    `<option value="all">${allLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(label(value))}</option>`),
  ].join("");
  select.value = values.includes(current) ? current : "all";
}

function initFilters() {
  const sortedUnique = (key) => Array.from(new Set(state.voices.map((d) => d[key]).filter(Boolean))).sort();
  populateSelect("languageFilter", sortedUnique("language"), "All languages");
  populateSelect("useCaseFilter", sortedUnique("use_case"), "All use cases");
  populateSelect("accentFilter", sortedUnique("accent"), "All accents");
  populateSelect("genderFilter", sortedUnique("gender"), "All genders");

  const maxClones = d3.max(state.voices, (d) => d.cloned_by_count) || 0;
  const range = document.getElementById("cloneFilter");
  range.max = Math.ceil(maxClones / 10000) * 10000;

  document.getElementById("searchInput").addEventListener("input", (event) => {
    state.filters.search = event.target.value.trim().toLowerCase();
    updateDashboard();
  });

  ["language", "useCase", "accent", "gender"].forEach((name) => {
    document.getElementById(`${name}Filter`).addEventListener("change", (event) => {
      const key = name === "useCase" ? "use_case" : name;
      state.filters[key] = event.target.value;
      updateDashboard();
    });
  });

  range.addEventListener("input", (event) => {
    state.filters.clones = Number(event.target.value);
    document.getElementById("cloneValue").textContent = fmt(state.filters.clones);
    updateDashboard();
  });

  document.getElementById("resetFilters").addEventListener("click", () => {
    state.filters = { search: "", language: "all", use_case: "all", accent: "all", gender: "all", clones: 0 };
    document.getElementById("searchInput").value = "";
    document.getElementById("languageFilter").value = "all";
    document.getElementById("useCaseFilter").value = "all";
    document.getElementById("accentFilter").value = "all";
    document.getElementById("genderFilter").value = "all";
    document.getElementById("cloneFilter").value = 0;
    document.getElementById("cloneValue").textContent = "0";
    updateDashboard();
  });

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      state.dimension = tab.dataset.dimension;
      drawSoundChart();
    });
  });
}

function applyFilters() {
  const term = state.filters.search;
  state.filtered = state.voices.filter((voice) => {
    const searchable = [
      voice.name, voice.accent, voice.use_case, voice.descriptive, voice.language,
      voice.gender, voice.age, voice.description,
    ].join(" ").toLowerCase();
    return (!term || searchable.includes(term))
      && (state.filters.language === "all" || voice.language === state.filters.language)
      && (state.filters.use_case === "all" || voice.use_case === state.filters.use_case)
      && (state.filters.accent === "all" || voice.accent === state.filters.accent)
      && (state.filters.gender === "all" || voice.gender === state.filters.gender)
      && voice.cloned_by_count >= state.filters.clones;
  });
}

function updateHero() {
  const rows = state.filtered;
  document.getElementById("snapshotVoices").textContent = fmt(rows.length);
  document.getElementById("snapshotUsage").textContent = moneyCompact(d3.sum(rows, (d) => d.usage_character_count_1y));
  document.getElementById("snapshotClones").textContent = moneyCompact(d3.sum(rows, (d) => d.cloned_by_count));
  document.getElementById("sourceNote").textContent =
    `SOURCE: ELEVENLABS PUBLIC VOICE LIBRARY API, ${fmt(state.meta?.voice_count || rows.length)}-VOICE DISCOVERY SNAPSHOT FROM ${state.meta?.snapshot_date || "2026-08-15"}.`;
}

function renderTopVoices() {
  const rows = state.filtered.slice().sort((a, b) => b.usage_character_count_1y - a.usage_character_count_1y).slice(0, 10);
  const top = rows[0];
  document.getElementById("topInsight").textContent = top
    ? `${top.name} leads the filtered view with ${moneyCompact(top.usage_character_count_1y)} annual characters and ${fmt(top.cloned_by_count)} clones.`
    : "No voices match the current filters.";

  document.getElementById("topVoices").innerHTML = rows.map((voice, index) => `
    <article>
      <div class="rank">${String(index + 1).padStart(2, "0")}</div>
      <div class="voice-main">
        <h3 title="${escapeHtml(voice.name)}">${escapeHtml(voice.name)}</h3>
        <div class="voice-meta">${escapeHtml(label(voice.accent))} / ${escapeHtml(label(voice.use_case))} / ${escapeHtml(label(voice.descriptive))}</div>
      </div>
      <div class="voice-stats">
        <span><strong>${moneyCompact(voice.usage_character_count_1y)}</strong> chars</span>
        <span><strong>${fmt(voice.cloned_by_count)}</strong> clones</span>
      </div>
      <button class="play-btn" type="button" aria-label="Play preview for ${escapeHtml(voice.name)}" data-preview="${escapeHtml(voice.preview_url)}" ${voice.preview_url === "Unknown" ? "disabled" : ""}></button>
    </article>
  `).join("");

  document.querySelectorAll(".play-btn").forEach((button) => {
    button.addEventListener("click", () => playPreview(button.dataset.preview, button));
  });
}

function playPreview(url, button) {
  if (!url || url === "Unknown") return;
  if (state.audio) state.audio.pause();
  document.querySelectorAll(".play-btn").forEach((item) => item.classList.remove("playing"));
  state.audio = new Audio(url);
  button.classList.add("playing");
  state.audio.addEventListener("ended", () => button.classList.remove("playing"));
  state.audio.play().catch(() => button.classList.remove("playing"));
}

function showTooltip(event, html) {
  tooltip
    .style("left", `${event.clientX}px`)
    .style("top", `${event.clientY}px`)
    .style("opacity", 1)
    .html(html);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}

function chartBox(selector, minHeight = 420) {
  const node = document.querySelector(selector);
  node.innerHTML = "";
  const width = Math.max(320, node.getBoundingClientRect().width);
  const height = Math.max(minHeight, node.getBoundingClientRect().height || minHeight);
  return { node, width, height };
}

function drawScatter() {
  const { node, width, height } = chartBox("#scatterChart", 470);
  const rows = state.filtered.filter((d) => d.usage_character_count_1y > 0 || d.usage_character_count_7d > 0);
  const margin = { top: width < 620 ? 34 : 48, right: 18, bottom: width < 620 ? 68 : 76, left: width < 620 ? 58 : 78 };
  const svg = d3.select(node).append("svg").attr("viewBox", `0 0 ${width} ${height}`);

  if (!rows.length) return;

  const positiveX = rows.map((d) => d.usage_character_count_1y).filter((d) => d > 0);
  const positiveY = rows.map((d) => d.usage_character_count_7d).filter((d) => d > 0);
  const x = d3.scaleLog()
    .domain([Math.max(1, d3.min(positiveX) * 0.75), d3.max(positiveX) * 1.15])
    .range([margin.left, width - margin.right]);
  const y = d3.scaleLog()
    .domain([Math.max(1, d3.min(positiveY) * 0.75), d3.max(positiveY) * 1.25])
    .range([height - margin.bottom, margin.top]);
  const r = d3.scaleSqrt()
    .domain([0, d3.max(rows, (d) => d.cloned_by_count) || 1])
    .range([4, width < 620 ? 22 : 34]);
  const useCases = Array.from(new Set(rows.map((d) => d.use_case))).slice(0, colors.length);
  const color = d3.scaleOrdinal(useCases, colors);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(width < 620 ? 4 : 6, "~s"))
    .call((g) => g.select(".domain").remove());

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5, "~s"))
    .call((g) => g.select(".domain").remove())
    .call((g) => g.selectAll(".tick line").clone().attr("x2", width - margin.left - margin.right).attr("class", "grid-line"));

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .attr("class", "bar-value")
    .text("annual usage");

  svg.append("text")
    .attr("x", 14)
    .attr("y", width < 620 ? 20 : 24)
    .attr("class", "bar-value")
    .text("7-day usage");

  svg.append("g")
    .selectAll("circle")
    .data(rows)
    .join("circle")
    .attr("class", "bubble")
    .attr("cx", (d) => x(Math.max(1, d.usage_character_count_1y)))
    .attr("cy", (d) => y(Math.max(1, d.usage_character_count_7d)))
    .attr("r", 0)
    .attr("fill", (d) => color(d.use_case))
    .attr("fill-opacity", 0.72)
    .on("mouseenter touchstart", (event, d) => {
      const momentum = d.usage_character_count_1y ? d.usage_character_count_7d / d.usage_character_count_1y : 0;
      showTooltip(event, `
        <strong>${escapeHtml(d.name)}</strong>
        <small>${escapeHtml(label(d.use_case))} / ${escapeHtml(label(d.accent))}</small>
        <small>1Y usage: ${fmt(d.usage_character_count_1y)}</small>
        <small>7D usage: ${fmt(d.usage_character_count_7d)}</small>
        <small>7-day usage momentum: ${pct(momentum)}</small>
        <small>Clones: ${fmt(d.cloned_by_count)}</small>
      `);
    })
    .on("mouseleave", hideTooltip)
    .transition()
    .duration(700)
    .attr("r", (d) => r(d.cloned_by_count));

  document.getElementById("scatterLegend").innerHTML = useCases.slice(0, 7).map((item) => (
    `<span><i style="background:${color(item)}"></i>${escapeHtml(label(item))}</span>`
  )).join("");
}

function drawHorizontalBars(selector, rows, options = {}) {
  const { node, width } = chartBox(selector, options.height || 440);
  const itemCount = Math.min(rows.length, options.limit || 10);
  const rowHeight = width < 620 ? 34 : 42;
  const height = itemCount * rowHeight + 42;
  const margin = { top: 8, right: width < 620 ? 82 : 120, bottom: 14, left: width < 620 ? 112 : 178 };
  const svg = d3.select(node).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const data = rows.slice(0, itemCount);
  if (!data.length) return;
  const valueKey = options.valueKey || "usage";
  const max = d3.max(data, (d) => d[valueKey]) || 1;
  const x = d3.scaleLinear().domain([0, max]).range([margin.left, width - margin.right]);

  const row = svg.selectAll("g.row")
    .data(data)
    .join("g")
    .attr("transform", (d, i) => `translate(0,${margin.top + i * rowHeight})`);

  row.append("text")
    .attr("class", "bar-label")
    .attr("x", 0)
    .attr("y", rowHeight * 0.62)
    .attr("font-size", width < 620 ? 11 : 14)
    .text((d) => label(d.key).slice(0, width < 620 ? 18 : 28));

  row.append("rect")
    .attr("class", "bar-bg")
    .attr("x", margin.left)
    .attr("y", 7)
    .attr("width", width - margin.left - margin.right)
    .attr("height", rowHeight - 14);

  row.append("rect")
    .attr("class", "bar")
    .attr("x", margin.left)
    .attr("y", 7)
    .attr("height", rowHeight - 14)
    .attr("width", 0)
    .attr("fill", (_, i) => colors[i % colors.length])
    .on("mouseenter touchstart", (event, d) => showTooltip(event, options.tooltip(d)))
    .on("mouseleave", hideTooltip)
    .transition()
    .duration(750)
    .attr("width", (d) => Math.max(2, x(d[valueKey]) - margin.left));

  row.append("text")
    .attr("class", "bar-value")
    .attr("x", (d) => Math.min(width - 6, x(d[valueKey]) + 8))
    .attr("y", rowHeight * 0.62)
    .attr("font-size", width < 620 ? 11 : 13)
    .text((d) => options.valueFormat ? options.valueFormat(d[valueKey]) : moneyCompact(d[valueKey]));
}

function drawSoundChart() {
  const rows = groupByDimension(state.filtered, state.dimension);
  const leader = rows[0];
  if (leader) {
    document.getElementById("soundInsight").textContent = `${label(leader.key)} captures the largest usage pool in this view: ${moneyCompact(leader.usage)} annual characters across ${fmt(leader.voices)} voices.`;
  }
  drawHorizontalBars("#soundChart", rows, {
    limit: 10,
    tooltip: (d) => `
      <strong>${escapeHtml(label(d.key))}</strong>
      <small>Annual usage: ${fmt(d.usage)}</small>
      <small>7D usage: ${fmt(d.weekly)}</small>
      <small>Voices: ${fmt(d.voices)}</small>
      <small>Clones: ${fmt(d.clones)}</small>
    `,
  });
}

function drawAccentChart() {
  const accents = groupByDimension(state.filtered, "accent")
    .map((d) => ({ ...d, density: d.voices ? d.usage / d.voices : 0 }))
    .sort((a, b) => b.density - a.density);
  const leader = accents[0];
  document.getElementById("accentInsight").textContent = leader
    ? `${label(leader.key)} has the highest demand density in view: ${moneyCompact(leader.density)} annual characters per available voice.`
    : "No accent data matches the current filters.";
  drawHorizontalBars("#accentChart", accents, {
    limit: 12,
    valueKey: "density",
    valueFormat: moneyCompact,
    tooltip: (d) => `
      <strong>${escapeHtml(label(d.key))}</strong>
      <small>Demand density: ${fmt(Math.round(d.density))}</small>
      <small>Total annual usage: ${fmt(d.usage)}</small>
      <small>Available voices: ${fmt(d.voices)}</small>
      <small>Total clones: ${fmt(d.clones)}</small>
    `,
  });
}

function drawLorenz() {
  const { node, width, height } = chartBox("#lorenzChart", 360);
  const creators = aggregateCreators(state.filtered);
  const totalUsage = d3.sum(creators, (d) => d.usage) || 1;
  const topCount = Math.max(1, Math.ceil(creators.length * 0.01));
  const topShare = d3.sum(creators.slice(0, topCount), (d) => d.usage) / totalUsage;
  document.getElementById("topOneShare").textContent = pct(topShare);
  document.getElementById("creatorCount").textContent = `${fmt(creators.length)} creators in view`;
  document.getElementById("creatorInsight").textContent = creators.length
    ? `The top ${topCount} creator${topCount > 1 ? "s" : ""} account for ${pct(topShare)} of filtered marketplace usage.`
    : "No creator data matches the current filters.";

  const sorted = creators.slice().sort((a, b) => a.usage - b.usage);
  const points = [{ x: 0, y: 0 }];
  let cumulative = 0;
  sorted.forEach((creator, index) => {
    cumulative += creator.usage;
    points.push({ x: (index + 1) / sorted.length, y: cumulative / totalUsage });
  });

  const margin = { top: 62, right: 18, bottom: 44, left: 48 };
  const svg = d3.select(node).append("svg").attr("viewBox", `0 0 ${width} ${height}`);
  const x = d3.scaleLinear().domain([0, 1]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);
  const line = d3.line().x((d) => x(d.x)).y((d) => y(d.y)).curve(d3.curveMonotoneX);

  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .call((g) => g.selectAll(".tick line").clone().attr("x2", width - margin.left - margin.right).attr("class", "grid-line"));

  svg.append("path")
    .datum([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    .attr("d", line)
    .attr("fill", "none")
    .attr("stroke", "rgba(255,255,255,0.28)")
    .attr("stroke-dasharray", "4 6");

  svg.append("path")
    .datum(points)
    .attr("d", line)
    .attr("fill", "none")
    .attr("stroke", "#ff5a1f")
    .attr("stroke-width", 4);

  svg.append("text")
    .attr("x", width / 2)
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .attr("class", "bar-value")
    .text("share of creators");

  svg.append("text")
    .attr("x", 8)
    .attr("y", 28)
    .attr("class", "bar-value")
    .text("share of usage");

  document.getElementById("topCreators").innerHTML = creators.slice(0, 6).map((creator, index) => `
    <article>
      <div class="rank">${String(index + 1).padStart(2, "0")}</div>
      <h3 title="${escapeHtml(creator.id)}">${escapeHtml(creator.topVoice?.name || creator.id)}</h3>
      <div class="creator-row">${moneyCompact(creator.usage)} chars / ${fmt(creator.clones)} clones / ${fmt(creator.voices)} voices / ${pct(creator.share)} share</div>
    </article>
  `).join("");
}

function renderTimeline() {
  document.getElementById("timeline").innerHTML = timelineData.map(([date, title, detail]) => `
    <article>
      <strong>${date}</strong>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(detail)}</p>
      </div>
    </article>
  `).join("");
}

function updateDashboard() {
  applyFilters();
  updateHero();
  renderTopVoices();
  drawScatter();
  drawSoundChart();
  drawAccentChart();
  drawLorenz();
}

async function loadData() {
  const [voices, meta] = await Promise.all([
    fetch("data/latest.json").then((response) => response.json()),
    fetch("data/snapshot-meta.json").then((response) => response.json()).catch(() => null),
  ]);

  state.voices = voices.map((voice) => ({
    ...voice,
    usage_character_count_1y: safeNumber(voice.usage_character_count_1y),
    usage_character_count_7d: safeNumber(voice.usage_character_count_7d),
    cloned_by_count: safeNumber(voice.cloned_by_count),
    usage_momentum: safeNumber(voice.usage_character_count_1y)
      ? safeNumber(voice.usage_character_count_7d) / safeNumber(voice.usage_character_count_1y)
      : 0,
  }));
  state.meta = meta;
  initFilters();
  renderTimeline();
  updateDashboard();
}

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(updateDashboard, 180);
});

loadData().catch((error) => {
  document.body.innerHTML = `<main class="page-shell"><section class="hero"><h1>Data failed to load</h1><p class="lede">${escapeHtml(error.message)}</p></section></main>`;
});
