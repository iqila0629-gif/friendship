const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const SOURCE_LABELS = {
  song_album: "歌曲/专辑名",
  song: "歌曲",
  abbr: "缩写变种",
  lyric: "关键歌词",
  related: "相关单词",
};

const state = {
  selected: new Set(ALPHABET),
  counts: {},
  showCounts: false,
  prefMode: null,
  prefs: {},
  prefStrategy: "consume",
  mode: "normal",
  sources: new Set(["song", "song_album", "abbr", "lyric", "related"]),
  albums: new Set(),
  consumeChain: [],
  comboChosen: [],
  comboRounds: [],
  comboStale: true,
  normalPage: 1,
};

let DATA = null;
let focusedCountLetter = null;

const $ = (id) => document.getElementById(id);

function activeEntries() {
  return DATA.entries.filter(
    (e) => state.sources.has(e.source) && state.albums.has(e.album)
  );
}

function totalLetters(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function songFits(entry, inventory) {
  for (const [ch, n] of Object.entries(entry.counts)) {
    if (n > (inventory[ch] || 0)) return false;
  }
  return true;
}

function useLetters(inventory, counts) {
  const next = { ...inventory };
  for (const [ch, n] of Object.entries(counts)) next[ch] -= n;
  return next;
}

function buildInventory() {
  const inv = {};
  for (const ch of ALPHABET) {
    if (!state.selected.has(ch)) {
      inv[ch] = 0;
      continue;
    }
    const count = state.counts[ch];
    inv[ch] = count == null || count === "" ? Infinity : Number(count);
  }
  return inv;
}

function spellable(entries, inventory) {
  return entries.filter((e) => songFits(e, inventory));
}

function sortKeyFor(kind, entry, inventory) {
  if (kind === "short") return totalLetters(entry.counts);
  if (kind === "unique") return Object.keys(entry.counts).length;
  if (kind === "ratio") return totalLetters(entry.counts) + Object.keys(entry.counts).length * 0.5;
  if (kind === "rare") {
    let score = 0;
    for (const [ch, n] of Object.entries(entry.counts)) {
      const avail = inventory[ch] === Infinity ? 100 : inventory[ch] || 0;
      score += n / Math.max(avail, 1);
    }
    return score;
  }
  return 0;
}

function greedyPick(entries, inventory, kind = "short", seed = 0) {
  let inv = { ...inventory };
  const sorted = [...entries];
  if (seed) {
    let s = seed;
    sorted.sort((a, b) => {
      s = (s * 16807) % 2147483647;
      return s % 2 === 0 ? -1 : 1;
    });
  }
  sorted.sort((a, b) => {
    const ka = sortKeyFor(kind, a, inv);
    const kb = sortKeyFor(kind, b, inv);
    return ka - kb || a.display.localeCompare(b.display);
  });
  const chosen = [];
  for (const e of sorted) {
    if (songFits(e, inv)) {
      chosen.push(e);
      inv = useLetters(inv, e.counts);
    }
  }
  return chosen;
}

function improveSolution(entries, inventory, solution) {
  let best = solution.slice();
  let bestRemaining = useLetters({ ...inventory }, combinedCounts(best));
  const used = new Set(best);
  const unused = entries.filter((e) => !used.has(e));
  for (const e of unused) {
    if (songFits(e, bestRemaining)) {
      best.push(e);
      bestRemaining = useLetters(bestRemaining, e.counts);
    }
  }
  return best;
}

function combinedCounts(list) {
  const out = {};
  for (const e of list) {
    for (const [ch, n] of Object.entries(e.counts)) out[ch] = (out[ch] || 0) + n;
  }
  return out;
}

function bestSolutions(entries, inventory, count = 5) {
  const kinds = ["short", "unique", "ratio", "rare"];
  const candidates = [];
  for (const kind of kinds) {
    const sol = greedyPick(entries, inventory, kind);
    candidates.push(improveSolution(entries, inventory, sol));
  }
  for (let seed = 1; seed <= 8; seed += 1) {
    const sol = greedyPick(entries, inventory, "short", seed);
    candidates.push(improveSolution(entries, inventory, sol));
  }
  const bestCount = Math.max(...candidates.map((s) => s.length), 0);
  const best = candidates.filter((s) => s.length === bestCount);
  const seen = new Set();
  const unique = [];
  for (const sol of best) {
    const key = sol.map((e) => e.id).sort().join(",");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(sol);
    }
  }
  return unique.slice(0, count);
}

function computeRounds(entries, inventory) {
  const rounds = [];
  let inv = { ...inventory };
  for (let i = 0; i < 5; i += 1) {
    const solutions = bestSolutions(entries, inv, 1);
    if (!solutions.length) break;
    const spellableNow = spellable(entries, inv);
    const options = spellableNow
      .map((e) => {
        let limitedCost = 0;
        for (const [ch, n] of Object.entries(e.counts)) {
          if (Number.isFinite(inv[ch])) limitedCost += n * (inv[ch] > 0 ? 1 : 0);
        }
        return {
          e,
          cost: totalLetters(e.counts) + limitedCost * 2,
        };
      })
      .sort((a, b) => a.cost - b.cost || a.e.display.localeCompare(b.e.display))
      .slice(0, 12)
      .map((o) => o.e);
    rounds.push({ count: solutions[0].length, options, chosen: null });
    const pick = options[0];
    inv = useLetters(inv, pick.counts);
  }
  return rounds;
}

function letterSummary(counts) {
  return Object.entries(counts)
    .map(([ch, n]) => (n === 1 ? ch : `${n}${ch}`))
    .join(" ");
}

function albumById(id) {
  return DATA.albums.find((a) => a.id === id) || DATA.albums[DATA.albums.length - 1];
}

function pillStyle(album) {
  return `background:${album.color};color:${album.text};`;
}

function sourceName(source) {
  return SOURCE_LABELS[source] || source;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function renderInventorySummary() {
  const inv = buildInventory();
  const have = ALPHABET.filter((ch) => inv[ch] > 0 || inv[ch] === Infinity);
  const total = ALPHABET.reduce((sum, ch) => (inv[ch] === Infinity ? sum : sum + (inv[ch] || 0)), 0);
  $("inventorySummary").innerHTML =
    `可用字母 <strong>${have.length}</strong> / 26 · 定量珠子 <strong>${total}</strong>`;
}

function renderBeadGrid() {
  const grid = $("beadGrid");
  grid.innerHTML = "";
  grid.classList.toggle("with-counts", state.showCounts);
  for (const ch of ALPHABET) {
    const bead = document.createElement("div");
    const on = state.selected.has(ch);
    bead.className = "bead";
    bead.classList.toggle("on", on);
    bead.classList.toggle("pref", state.prefs[ch] === "pref");
    bead.classList.toggle("no", state.prefs[ch] === "no");
    bead.textContent = ch;
    bead.title = `点击选择 ${ch}`;
    if (state.prefs[ch] === "pref" || state.prefs[ch] === "no") {
      const flag = document.createElement("span");
      flag.className = "bead-flag" + (state.prefs[ch] === "no" ? " no" : "");
      flag.textContent = state.prefs[ch] === "pref" ? "✓" : "×";
      bead.appendChild(flag);
    }
    bead.addEventListener("click", () => {
      state.comboStale = true;
      state.consumeChain = [];
      state.normalPage = 1;
      if (state.prefMode) {
        if (state.prefs[ch] === state.prefMode) delete state.prefs[ch];
        else state.prefs[ch] = state.prefMode;
        render();
        return;
      }
      if (state.selected.has(ch)) state.selected.delete(ch);
      else state.selected.add(ch);
      render();
    });
    if (state.showCounts) {
      const input = document.createElement("input");
      input.className = "count-input";
      input.type = "number";
      input.min = "0";
      input.autocomplete = "off";
      input.inputMode = "numeric";
      input.value = state.counts[ch] == null ? "" : state.counts[ch];
      input.placeholder = "∞";
      input.dataset.letter = ch;
      input.title = `${ch} 的数量，留空为不限量`;
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("focus", () => { focusedCountLetter = ch; });
      input.addEventListener("blur", () => {
        focusedCountLetter = null;
        state.comboStale = true;
        state.consumeChain = [];
        state.normalPage = 1;
        render();
      });
      input.addEventListener("input", () => {
        const v = input.value.trim();
        if (v === "") delete state.counts[ch];
        else state.counts[ch] = Math.max(0, Number(v));
      });
      bead.appendChild(input);
    }
    grid.appendChild(bead);
  }
}

function renderFilters() {
  renderSourceChips();
  $("albumFilter").innerHTML = "";
  for (const album of DATA.albums) {
    const chip = document.createElement("button");
    chip.className = "chip" + (state.albums.has(album.id) ? " active" : "");
    chip.textContent = album.id === "other" ? "其他" : album.name;
    chip.addEventListener("click", () => {
      if (state.albums.has(album.id)) state.albums.delete(album.id);
      else state.albums.add(album.id);
      state.comboStale = true;
      state.consumeChain = [];
      state.normalPage = 1;
      render();
    });
    $("albumFilter").appendChild(chip);
  }
}

function renderSourceChips() {
  document.querySelectorAll("#sourceFilter .chip").forEach((chip) => {
    const s = chip.dataset.source;
    if (s === "song_album") {
      chip.classList.toggle("active", state.sources.has("song") && state.sources.has("song_album"));
    } else {
      chip.classList.toggle("active", state.sources.has(s));
    }
  });
}

function renderResults() {
  const entries = activeEntries();
  const inventory = buildInventory();
  const title = $("resultsTitle");
  const meta = $("resultsMeta");
  const body = $("resultsBody");
  if (state.mode === "normal") {
    title.textContent = "可拼内容";
    const found = spellable(entries, inventory).sort(
      (a, b) => totalLetters(a.counts) - totalLetters(b.counts) || a.display.localeCompare(b.display)
    );
    const pageSize = 24;
    const pageCount = Math.max(1, Math.ceil(found.length / pageSize));
    if (state.normalPage > pageCount) state.normalPage = pageCount;
    const page = state.normalPage;
    const pageItems = found.slice((page - 1) * pageSize, page * pageSize);
    meta.textContent = `${found.length} 条 · 第 ${page} / ${pageCount} 页`;
    if (!found.length) {
      body.innerHTML = `<div class="empty">这些珠子暂时拼不出任何内容。<br>试试点亮更多字母，或放宽匹配条件。</div>`;
      return;
    }
    body.innerHTML = `<div class="song-grid">${pageItems
      .map((e) => {
        const album = albumById(e.album);
        return `<div class="song-card" style="${pillStyle(album)}">
          <div>
            <div class="name">${esc(e.display)}${e.original ? `<span class="sub"> · ${esc(e.original)}</span>` : ""}</div>
            <div class="sub">${sourceName(e.source)} · ${esc(album.name)}</div>
          </div>
          <div class="counts">${esc(letterSummary(e.counts))}</div>
        </div>`;
      })
      .join("")}</div>
      <div class="pager">
        <button class="reset-btn" id="pagePrev" ${page <= 1 ? "disabled" : ""}>上一页</button>
        <span class="results-meta">${page} / ${pageCount}</span>
        <button class="reset-btn" id="pageNext" ${page >= pageCount ? "disabled" : ""}>下一页</button>
      </div>`;
    $("pagePrev").addEventListener("click", () => {
      if (state.normalPage > 1) {
        state.normalPage -= 1;
        render();
      }
    });
    $("pageNext").addEventListener("click", () => {
      if (state.normalPage < pageCount) {
        state.normalPage += 1;
        render();
      }
    });
    return;
  }

  if (state.mode === "max") {
    renderMax(entries, inventory, title, meta, body);
    return;
  }

  title.textContent = "消耗珠子";
  const found = spellable(entries, inventory)
    .map((e) => {
      let pref = 0;
      let no = 0;
      for (const [ch, n] of Object.entries(e.counts)) {
        if (state.prefs[ch] === "pref") pref += n;
        if (state.prefs[ch] === "no") no += n;
      }
      const score =
        state.prefStrategy === "consume"
          ? pref * 2 - no * 1 + totalLetters(e.counts) * 0.01
          : -no * 2 + pref * 1 + totalLetters(e.counts) * 0.01;
      return { e, pref, no, score };
    })
    .sort((a, b) => b.score - a.score || totalLetters(b.e.counts) - totalLetters(a.e.counts));
  meta.textContent = `${found.length} 条`;
  if (!found.length) {
    body.innerHTML = `<div class="empty">没有可拼的歌曲。先点亮珠子或标记主要消耗/不想消耗。</div>`;
    return;
  }
  const chain = state.consumeChain;
  const chainCounts = combinedCounts(chain);
  const remainingAfterChain = useLetters({ ...inventory }, chainCounts);
  const rankable = found.filter((item) => songFits(item.e, remainingAfterChain));
  body.innerHTML = `
    <div class="combo-block">
      <h3>贪心搭配（按当前偏好连续消耗）</h3>
      <div class="chosen-list">
        <span class="chosen-label">已拼：</span>
        <div class="alt-pills">${chain
          .map((e) => `<span class="alt-pill" style="${pillStyle(albumById(e.album))}">${esc(e.display)}</span>`)
          .join("") || `<span class="alt-pill" style="background:#f2ede2;color:#888;">还没有选择</span>`}</div>
        <button class="reset-btn" id="undoPick">撤销</button>
      </div>
    </div>
    <div class="combo-block">
      <h3>分数排行（优先消耗主要珠子，避开不想消耗）</h3>
      ${rankable.length
        ? rankable
            .slice(0, 40)
            .map(
              (item) => `<div class="consume-card" style="${pillStyle(albumById(item.e.album))}">
              <div class="consume-main">
              <div class="consume-name">${esc(item.e.display)}${item.e.original ? ` <span class="consume-sub">(${esc(item.e.original)})</span>` : ""}</div>
              <div class="consume-sub">${sourceName(item.e.source)} · ${esc(albumById(item.e.album).name)}</div>
            </div>
            <button class="score-badge" data-add="${item.e.id}">+ 拼</button>
          </div>`
            )
            .join("")
        : `<div class="empty">当前剩余珠子已拼不出任何歌曲，撤销后再试。</div>`}
    </div>`;
  body.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const entry = DATA.entries.find((e) => e.id === btn.dataset.add);
      const rem = useLetters({ ...inventory }, combinedCounts(state.consumeChain));
      if (songFits(entry, rem)) {
        state.consumeChain.push(entry);
        render();
      }
    });
  });
  $("undoPick").addEventListener("click", () => {
    state.consumeChain.pop();
    render();
  });
}

function renderMax(entries, inventory, title, meta, body) {
  title.textContent = "拼最多歌曲";
  meta.textContent = `${entries.length} 个候选条目`;
  const all = spellable(entries, inventory);
  if (!all.length) {
    body.innerHTML = `<div class="empty">这些珠子暂时拼不出任何歌曲，试试扩大库存。</div>`;
    return;
  }

  if (state.comboStale) {
    state.comboStale = false;
  }

  const remaining = state.comboChosen.reduce(
    (inv, e) => useLetters(inv, e.counts),
    { ...inventory }
  );
  const maxMore = bestSolutions(all, remaining, 1)[0]?.length || 0;
  const unlimitedSongs = all.filter((e) =>
    Object.entries(e.counts).every(([ch]) => remaining[ch] === Infinity)
  );
  const limitedAll = all.filter((e) => !unlimitedSongs.includes(e));
  const sols = bestSolutions(limitedAll, remaining, 5);
  const remainingText = ALPHABET
    .filter((ch) => Number.isFinite(remaining[ch]) && remaining[ch] > 0)
    .map((ch) => `${remaining[ch]}${ch}`)
    .join("、");
  const chainHtml = state.comboChosen
    .map((e) => `<span class="pill" style="${pillStyle(albumById(e.album))}">${esc(e.display)}</span>`)
    .join("");

  body.innerHTML = `
    <div class="combo-block">
      <h3>按组合挑歌（已选 ${state.comboChosen.length} 首 · 剩余最多还可拼 ${maxMore} 首）</h3>
      <p class="remaining-beads">剩余珠子：${remainingText || "全部不限量"}</p>
      <div class="hint">每个组合选 1 首；选完该组合即消失，后续组合顺移补位。</div>
      <div class="chosen-list">
        <span class="chosen-label">已选：</span>
        <div class="alt-pills">${chainHtml || `<span class="alt-pill" style="background:#f2ede2;color:#888;">还没有选择</span>`}</div>
        <button class="reset-btn" id="comboUndo">撤销</button>
        <button class="reset-btn" id="comboClear">清空</button>
      </div>
      <div id="roundsBox"></div>
    </div>
    <div class="alt-block">
      <h3>最优组合备选（${sols.length} 套）</h3>
      <div class="hint">每套都是当前库存下的完整最大组合，可整行照抄。</div>
      ${unlimitedSongs.length
        ? `<div class="alt-row"><span class="alt-label">可无限拼</span><div class="alt-pills">${unlimitedSongs
            .map((e) => `<span class="alt-pill" style="${pillStyle(albumById(e.album))}" title="${esc(e.display)}">${esc(e.display)}</span>`)
            .join("")}</div></div>`
        : ""}
      ${!limitedAll.length
        ? `<div class="hint">其余歌曲均需要消耗珠子，当前没有更多可拼组合。</div>`
        : ""}
      ${sols
        .map(
          (sol, i) => `<div class="alt-row">
            <span class="alt-label">备选 ${i + 1}</span>
            <div class="alt-pills">${sol
              .map((e) => `<span class="alt-pill" style="${pillStyle(albumById(e.album))}" title="${esc(e.display)}">${esc(e.display)}</span>`)
              .join("")}</div>
          </div>`
        )
        .join("")}
    </div>`;

  state.comboRounds = computeRounds(all, remaining);
  $("comboUndo").addEventListener("click", () => {
    if (state.comboChosen.length) {
      state.comboChosen.pop();
      render();
    }
  });
  $("comboClear").addEventListener("click", () => {
    if (state.comboChosen.length) {
      state.comboChosen = [];
      render();
    }
  });

  const roundsBox = $("roundsBox");
  roundsBox.innerHTML = "";
  state.comboRounds.forEach((round, ri) => {
    const absIndex = state.comboChosen.length + ri + 1;
    const block = document.createElement("div");
    block.className = "combo-block";
    block.innerHTML = `<h3>组合 ${absIndex} · 最多 ${round.count} 首</h3><div class="pill-row"></div>`;
    const row = block.querySelector(".pill-row");
    round.options.slice(0, 12).forEach((e) => {
      const pill = document.createElement("span");
      pill.className = "pill clickable";
      pill.style.cssText = pillStyle(albumById(e.album));
      pill.textContent = e.display;
      pill.title = e.original ? `${e.original}（${sourceName(e.source)}）` : sourceName(e.source);
      pill.addEventListener("click", () => {
        state.comboChosen.push(e);
        render();
      });
      row.appendChild(pill);
    });
    roundsBox.appendChild(block);
  });

}

function render() {
  if (!DATA) return;
  $("prefPanel").classList.toggle("hidden", state.mode !== "consume");
  renderInventorySummary();
  renderBeadGrid();
  renderFilters();
  renderResults();
  if (focusedCountLetter) {
    const input = document.querySelector(`.count-input[data-letter="${focusedCountLetter}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
}

function bindStaticControls() {
  $("selectAll").addEventListener("click", () => {
    state.selected = new Set(ALPHABET);
    state.comboStale = true;
    state.consumeChain = [];
    state.normalPage = 1;
    render();
  });
  $("clearAll").addEventListener("click", () => {
    state.selected.clear();
    state.comboStale = true;
    state.consumeChain = [];
    state.normalPage = 1;
    render();
  });
  $("countToggle").addEventListener("click", () => {
    state.showCounts = !state.showCounts;
    state.comboStale = true;
    render();
  });
  $("resetAll").addEventListener("click", () => {
    state.selected = new Set(ALPHABET);
    state.counts = {};
    state.showCounts = false;
    state.prefMode = null;
    state.prefs = {};
    state.prefStrategy = "consume";
    state.mode = "normal";
    state.sources = new Set(["song", "song_album", "abbr", "lyric", "related"]);
    state.albums = new Set(DATA.albums.map((a) => a.id));
    state.consumeChain = [];
    state.comboStale = true;
    state.normalPage = 1;
    document.querySelectorAll("#modeToggle .mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === "normal");
    });
    document.querySelectorAll("#prefControls .chip").forEach((c) => c.classList.remove("active"));
    document.querySelectorAll("#prefStrategy .mode-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.strategy === "consume");
    });
    render();
  });
  $("albumSelectAll").addEventListener("click", () => {
    state.albums = new Set(DATA.albums.map((a) => a.id));
    state.comboStale = true;
    state.consumeChain = [];
    state.normalPage = 1;
    render();
  });
  $("albumClearAll").addEventListener("click", () => {
    state.albums.clear();
    state.comboStale = true;
    state.consumeChain = [];
    state.normalPage = 1;
    render();
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      if (state.mode !== "consume") {
        state.prefs = {};
        state.prefMode = null;
        state.prefStrategy = "consume";
        document.querySelectorAll("#prefControls .chip").forEach((c) => c.classList.remove("active"));
        document.querySelectorAll("#prefStrategy .mode-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.strategy === "consume");
        });
      }
      state.comboStale = true;
      state.consumeChain = [];
      state.normalPage = 1;
      document.querySelectorAll("#modeToggle .mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  });
  document.querySelectorAll("#sourceFilter .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const s = chip.dataset.source;
      if (s === "song_album") {
        const both = state.sources.has("song") && state.sources.has("song_album");
        if (both) {
          state.sources.delete("song");
          state.sources.delete("song_album");
        } else {
          state.sources.add("song");
          state.sources.add("song_album");
        }
      } else if (state.sources.has(s)) {
        state.sources.delete(s);
      } else {
        state.sources.add(s);
      }
      state.comboStale = true;
      state.consumeChain = [];
      state.normalPage = 1;
      render();
    });
  });
  document.querySelectorAll("#prefControls .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = chip.dataset.pref;
      state.prefMode = state.prefMode === p ? null : p;
      state.comboStale = true;
      state.consumeChain = [];
      state.normalPage = 1;
      document.querySelectorAll("#prefControls .chip").forEach((c) => c.classList.toggle("active", c === chip && state.prefMode === p));
      render();
    });
  });
  document.querySelectorAll("#prefStrategy .mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.prefStrategy = btn.dataset.strategy;
      document.querySelectorAll("#prefStrategy .mode-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      state.consumeChain = [];
      render();
    });
  });
}

async function boot() {
  bindStaticControls();
  const res = await fetch("data/songs.json?v=20260813.10");
  DATA = await res.json();
  state.albums = new Set(DATA.albums.map((a) => a.id));
  render();
}

boot().catch((err) => {
  document.getElementById("resultsBody").innerHTML =
    `<div class="empty">数据加载失败：${esc(err.message)}</div>`;
});
