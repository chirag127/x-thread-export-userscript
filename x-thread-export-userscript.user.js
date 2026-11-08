// ==UserScript==
// @name         X Thread Export
// @namespace    https://github.com/chirag127
// @version      1.0.0
// @description  Walk any X thread from a single tweet URL, preview every post, then export author/text/time/media URLs as clean Markdown and JSON using the page's own session.
// @author       chirag127
// @license      MIT
// @match        https://x.com/*
// @match        https://twitter.com/*
// @icon         https://x.com/favicon.ico
// @homepageURL  https://github.com/chirag127/x-thread-export-userscript
// @supportURL   https://github.com/chirag127/x-thread-export-userscript/issues
// @downloadURL  https://github.com/chirag127/x-thread-export-userscript/raw/main/x-thread-export-userscript.user.js
// @updateURL    https://github.com/chirag127/x-thread-export-userscript/raw/main/x-thread-export-userscript.user.js
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const ORIGIN = location.hostname.endsWith("twitter.com") ? "https://twitter.com" : "https://x.com";
  const FALLBACK_BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
  const SET_KEY = "xte.settings.v1";
  const MAX_ANCESTORS = 40;
  const MAX_PAGES = 25;

  const defaults = { ancestors: true, replies: true, media: true, maxTweets: 400 };
  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
  const settings = Object.assign({}, defaults, readJSON(SET_KEY));
  const saveSettings = () => localStorage.setItem(SET_KEY, JSON.stringify(settings));

  let bearerCache = null;
  function bearer() {
    if (bearerCache) return bearerCache;
    const s = window.__INITIAL_STATE__;
    const found = s && (s.session && (s.session.bearerToken || s.session.bearer_token));
    const scanned = (document.documentElement.innerHTML.match(/Bearer (AAAA[A-Za-z0-9%._-]{40,})/) || [])[1];
    bearerCache = found || scanned || FALLBACK_BEARER;
    return bearerCache;
  }
  const ct0 = () => (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1] || "";

  async function api(path) {
    const token = ct0();
    if (!token) throw new Error("no ct0 cookie - sign in to X first");
    const r = await fetch(ORIGIN + path, {
      credentials: "include",
      headers: {
        authorization: "Bearer " + bearer(),
        "x-csrf-token": token,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
      },
    });
    if (r.status === 429) throw new Error("rate limited (429)");
    if (!r.ok) throw new Error("GET " + path.split("?")[0] + " -> " + r.status);
    return r.json().catch(() => ({}));
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const jitter = () => sleep(150 + Math.random() * 250);
  const h = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const isTyping = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };
  const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const statusIdFrom = (u) => (String(u || "").match(/\/status(?:es)?\/(\d{1,25})/) || [])[1] || null;

  function mediaOf(t) {
    const ent = t.extended_entities || t.entities || {};
    const list = ent.media || [];
    const out = [];
    for (const m of list) {
      if (m.type === "photo") out.push({ type: "photo", url: m.media_url_https + "?name=orig" });
      else {
        const variants = ((m.video_info || {}).variants || []).filter((v) => v.content_type === "video/mp4");
        variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        out.push({ type: m.type || "video", url: (variants[0] || {}).url || m.media_url_https });
      }
    }
    return out;
  }

  function toPost(t) {
    const u = t.user || {};
    return {
      id: t.id_str,
      author: u.screen_name || "unknown",
      name: u.name || "",
      time: new Date(t.created_at).toISOString(),
      text: t.full_text || t.text || "",
      url: "https://x.com/" + (u.screen_name || "i/web") + "/status/" + t.id_str,
      replyTo: t.in_reply_to_status_id_str || null,
      media: mediaOf(t),
    };
  }

  // ---------- collection ----------
  async function ancestorsOf(id) {
    const chain = [];
    let cursor = id;
    for (let i = 0; i < MAX_ANCESTORS; i++) {
      const t = await api("/i/api/1.1/statuses/show.json?id=" + cursor + "&tweet_mode=extended&include_entities=true");
      chain.unshift(toPost(t));
      if (!t.in_reply_to_status_id_str) break;
      cursor = t.in_reply_to_status_id_str;
      await jitter();
    }
    return chain;
  }

  async function repliesOf(rootId) {
    const seen = new Map();
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = "/i/api/2/timeline/conversation/" + rootId + ".json" +
        "?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1" +
        "&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1" +
        "&include_can_media_tag=1&skip_status=1&cards_platform=Web-12&include_cards=1" +
        "&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1" +
        "&tweet_mode=extended&include_entities=true&include_user_entities=true" +
        "&include_ext_media_color=true&include_ext_media_availability=true&send_error_codes=true" +
        "&simple_quoted_tweet=true&count=20" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      const j = await api(q);
      const tweets = (j.globalObjects && j.globalObjects.tweets) || {};
      const users = (j.globalObjects && j.globalObjects.users) || {};
      let added = 0;
      for (const key of Object.keys(tweets)) {
        const t = tweets[key];
        if (!t || t.conversation_id_str !== rootId || seen.has(t.id_str)) continue;
        t.user = t.user || users[t.user_id_str];
        seen.set(t.id_str, toPost(t));
        added++;
      }
      cursor = "";
      const inst = (j.timeline && j.timeline.instructions) || [];
      for (const ins of inst) {
        for (const e of ins.addEntries || []) {
          if (/^cursor-bottom/.test(e.entryId || "") && e.content && e.content.operation) {
            cursor = e.content.operation.cursor.value;
          }
        }
      }
      if (!added || !cursor || seen.size >= settings.maxTweets) break;
      await jitter();
    }
    return [...seen.values()];
  }

  function domPosts() {
    const out = [];
    document.querySelectorAll('article[data-testid="tweet"]').forEach((a) => {
      const link = a.querySelector('a[href*="/status/"]');
      const id = link && statusIdFrom(link.getAttribute("href"));
      if (!id) return;
      const authorEl = a.querySelector('[data-testid="User-Name"] a[href^="/"]');
      const author = (authorEl && authorEl.getAttribute("href") || "").replace(/^\//, "").split("/")[0] || "unknown";
      const textEl = a.querySelector('[data-testid="tweetText"]');
      const timeEl = a.querySelector("time");
      const media = [];
      a.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach((img) => media.push({ type: "photo", url: img.src }));
      out.push({
        id: id,
        author: author,
        name: "",
        time: timeEl ? new Date(timeEl.getAttribute("datetime")).toISOString() : new Date().toISOString(),
        text: textEl ? textEl.innerText : "",
        url: "https://x.com/" + author + "/status/" + id,
        replyTo: null,
        media: media,
      });
    });
    return out;
  }

  // ---------- UI ----------
  const CSS = [
    ".xe{position:fixed;z-index:2147483000;top:70px;left:20px;width:540px;height:540px;background:#181818;color:#e8e8e8;",
    "border:1px solid #303030;border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.65);display:flex;flex-direction:column;",
    "font:13px/1.45 Roboto,'Segoe UI',system-ui,sans-serif;overflow:hidden;resize:both;min-width:380px;min-height:300px}",
    ".xe *{box-sizing:border-box}",
    ".xe-head{display:flex;align-items:center;gap:8px;padding:9px 11px;background:#202020;border-bottom:1px solid #303030;cursor:move;user-select:none}",
    ".xe-title{font-weight:600;font-size:13px;letter-spacing:.2px;flex:1}",
    ".xe-badge{font-size:10px;color:#9a9a9a;border:1px solid #3a3a3a;border-radius:4px;padding:1px 5px}",
    ".xe-btn{background:#2a2a2a;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;padding:5px 10px;font:inherit;cursor:pointer}",
    ".xe-btn:hover{background:#333}.xe-btn:disabled{opacity:.45;cursor:default}",
    ".xe-btn.primary{background:#065fd4;border-color:#065fd4}.xe-btn.primary:hover{background:#0a72f5}",
    ".xe-x{background:none;border:0;color:#9a9a9a;font-size:16px;line-height:1;cursor:pointer;padding:0 2px}",
    ".xe-body{flex:1;display:flex;flex-direction:column;min-height:0}",
    ".xe-bar{display:flex;gap:6px;padding:8px 11px;border-bottom:1px solid #262626;flex-wrap:wrap}",
    ".xe-url{width:100%;background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:6px;padding:5px 8px;font:inherit}",
    ".xe-stat{font-size:11px;color:#9a9a9a;padding:0 11px 6px}",
    ".xe-prog{height:4px;background:#262626}.xe-prog>i{display:block;height:100%;width:0;background:#065fd4;transition:width .18s}",
    ".xe-wrap{flex:1;overflow:auto;min-height:60px;border-bottom:1px solid #262626}",
    ".xe-table{width:100%;border-collapse:collapse;font-size:12px}",
    ".xe-table th{position:sticky;top:0;background:#202020;color:#9a9a9a;font-weight:500;text-align:left;padding:5px 8px;border-bottom:1px solid #303030}",
    ".xe-table td{padding:4px 8px;border-bottom:1px solid #242424;vertical-align:top}",
    ".xe-table tr.me td{background:#1c2733}",
    ".xe-auth{font-weight:600}.xe-when{color:#9a9a9a;font-size:11px;white-space:nowrap}",
    ".xe-text{word-break:break-word}.xe-media{color:#4caf7d;font-size:11px;white-space:nowrap}",
    ".xe-log{height:96px;overflow:auto;font:11px/1.5 ui-monospace,Consolas,monospace;padding:6px 11px;background:#141414;color:#9a9a9a;white-space:pre-wrap;word-break:break-word}",
    ".xe-set{padding:0 11px 9px;font-size:11px;color:#bdbdbd}.xe-set summary{cursor:pointer;padding:5px 0;color:#9a9a9a}",
    ".xe-field{display:flex;align-items:center;gap:6px;margin:5px 0}",
    ".xe-field input[type=number]{background:#101010;color:#e8e8e8;border:1px solid #3a3a3a;border-radius:5px;padding:3px 6px;font:inherit;width:74px}",
    ".xe-chip{position:fixed;z-index:2147483000;left:20px;bottom:20px;background:#065fd4;color:#fff;border:0;border-radius:18px;padding:7px 14px;font:600 12px Roboto,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.5);display:none}",
    ".xe-hide{display:none!important}",
  ].join("");

  function makeUI() {
    const style = h("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    const panel = h("div", "xe xe-panel");
    const head = h("div", "xe-head");
    const title = h("div", "xe-title", "X Thread Export");
    const badge = h("span", "xe-badge", "v1.0.0");
    const collapse = h("button", "xe-x", "\u2013");
    collapse.title = "Collapse to chip";
    const close = h("button", "xe-x", "\u00d7");
    head.append(title, badge, collapse, close);

    const bar = h("div", "xe-bar");
    const urlIn = h("input", "xe-url");
    urlIn.placeholder = "https://x.com/<user>/status/<id> - paste a tweet in the thread";
    const row2 = h("div", "xe-bar");
    row2.style.borderBottom = "0";
    const btnScan = h("button", "xe-btn primary", "Scan thread");
    const btnMd = h("button", "xe-btn", "Export Markdown");
    const btnJson = h("button", "xe-btn", "Export JSON");
    const btnCopy = h("button", "xe-btn", "Copy list");
    btnMd.disabled = btnJson.disabled = btnCopy.disabled = true;
    row2.append(btnScan, btnMd, btnJson, btnCopy);
    bar.append(urlIn, row2);

    const stat = h("div", "xe-stat", "Paste a tweet URL, scan, review the preview, then export.");
    const prog = h("div", "xe-prog");
    const progFill = h("i");
    prog.appendChild(progFill);

    const wrap = h("div", "xe-wrap");
    const table = h("table", "xe-table");
    const thead = h("thead");
    const hr = h("tr");
    ["#", "Author", "When", "Post", "Media"].forEach((label, i) => {
      const th = h("th", null, label);
      if (i === 0) th.style.width = "30px";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = h("tbody");
    table.append(thead, tbody);
    wrap.appendChild(table);

    const logBox = h("div", "xe-log");
    const setBox = h("details", "xe-set");
    setBox.appendChild(h("summary", null, "Options"));
    const ancField = h("label", "xe-field");
    const ancIn = h("input");
    ancIn.type = "checkbox";
    ancIn.checked = settings.ancestors;
    ancField.append(ancIn, h("span", null, "Include parent posts (walk to the thread root)"));
    const repField = h("label", "xe-field");
    const repIn = h("input");
    repIn.type = "checkbox";
    repIn.checked = settings.replies;
    repField.append(repIn, h("span", null, "Include replies"));
    const medField = h("label", "xe-field");
    const medIn = h("input");
    medIn.type = "checkbox";
    medIn.checked = settings.media;
    medField.append(medIn, h("span", null, "Include media URLs"));
    const maxField = h("label", "xe-field");
    maxField.append(h("span", null, "Max posts"));
    const maxIn = h("input");
    maxIn.type = "number";
    maxIn.min = "1";
    maxIn.max = "2000";
    maxIn.value = String(settings.maxTweets);
    maxField.appendChild(maxIn);
    setBox.append(ancField, repField, medField, maxField);

    const body = h("div", "xe-body");
    body.append(bar, stat, prog, wrap, setBox, logBox);
    panel.append(head, body);
    const chip = h("button", "xe-chip", "\u2191 Thread Export");
    document.body.append(panel, chip);

    head.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest("button")) return;
      const r = panel.getBoundingClientRect();
      const dx = ev.clientX - r.left;
      const dy = ev.clientY - r.top;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = r.left + "px";
      panel.style.top = r.top + "px";
      const move = (e) => {
        panel.style.left = Math.max(0, e.clientX - dx) + "px";
        panel.style.top = Math.max(0, e.clientY - dy) + "px";
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    collapse.addEventListener("click", () => {
      panel.classList.add("xe-hide");
      chip.style.display = "block";
    });
    chip.addEventListener("click", () => {
      chip.style.display = "none";
      panel.classList.remove("xe-hide");
    });
    close.addEventListener("click", () => {
      panel.remove();
      chip.remove();
    });

    const sync = () => {
      settings.ancestors = ancIn.checked;
      settings.replies = repIn.checked;
      settings.media = medIn.checked;
      settings.maxTweets = Math.max(1, Math.min(2000, Number(maxIn.value) || 400));
      saveSettings();
    };
    [ancIn, repIn, medIn, maxIn].forEach((n) => n.addEventListener("change", sync));

    const ui = {
      panel: panel,
      chip: chip,
      urlIn: urlIn,
      btnScan: btnScan,
      btnMd: btnMd,
      btnJson: btnJson,
      btnCopy: btnCopy,
      progFill: progFill,
      tbody: tbody,
      log: (msg, cls) => {
        const line = h("div", cls || null, "[" + new Date().toLocaleTimeString() + "] " + msg);
        logBox.appendChild(line);
        while (logBox.childElementCount > 300) logBox.firstChild.remove();
        logBox.scrollTop = logBox.scrollHeight;
      },
      stat: (t) => { stat.textContent = t; },
      progress: (done, total) => { progFill.style.width = (total ? (done / total) * 100 : 0) + "%"; },
      clearRows: () => { tbody.textContent = ""; },
      row: (post, i, isRoot) => {
        const tr = h("tr");
        if (isRoot) tr.className = "me";
        tr.append(
          h("td", "xe-when", String(i + 1)),
          h("td", "xe-auth", "@" + post.author),
          h("td", "xe-when", new Date(post.time).toLocaleString([], { dateStyle: "short", timeStyle: "short" })),
          h("td", "xe-text", post.text || "(no text)"),
          h("td", "xe-media", post.media.length ? post.media.length + " item(s)" : "")
        );
        tbody.appendChild(tr);
      },
    };
    return ui;
  }

  // ---------- state ----------
  let ui = null;
  let posts = [];
  let rootId = null;
  let phase = "idle";

  function refresh() {
    if (!ui) return;
    const ok = phase === "ready" && posts.length > 0;
    ui.btnMd.disabled = ui.btnJson.disabled = ui.btnCopy.disabled = !ok;
    ui.stat(ok ? posts.length + " posts previewed. Export writes a local file - nothing is posted." : "No preview yet.");
  }

  async function scan() {
    const id = statusIdFrom(ui.urlIn.value) || statusIdFrom(location.href);
    if (!id) { ui.log("No tweet id in the URL field.", "xe-st err"); return; }
    if (!ct0()) { ui.log("No ct0 cookie - sign in to X first.", "xe-st err"); return; }
    phase = "scanning";
    posts = [];
    ui.clearRows();
    ui.btnScan.disabled = true;
    refresh();
    ui.progress(0, 1);
    try {
      let list = [];
      if (settings.ancestors) {
        ui.log("Walking ancestors from " + id + "…");
        list = await ancestorsOf(id);
      } else {
        const t = await api("/i/api/1.1/statuses/show.json?id=" + id + "&tweet_mode=extended&include_entities=true");
        list = [toPost(t)];
      }
      rootId = list[0] && list[0].id;
      if (settings.replies && rootId) {
        ui.log("Fetching conversation " + rootId + "…");
        try {
          const more = await repliesOf(rootId);
          const have = new Set(list.map((p) => p.id));
          list = list.concat(more.filter((p) => !have.has(p.id)));
        } catch (e) {
          ui.log("Conversation endpoint failed (" + e.message + ") - falling back to visible DOM posts.", "xe-st err");
          const have = new Set(list.map((p) => p.id));
          list = list.concat(domPosts().filter((p) => !have.has(p.id)));
        }
      }
      list.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.id.localeCompare(b.id)));
      list = list.slice(0, settings.maxTweets);
      if (!settings.media) list.forEach((p) => { p.media = []; });
      posts = list;
      ui.clearRows();
      posts.forEach((p, i) => ui.row(p, i, p.id === rootId));
      ui.progress(1, 1);
      ui.log("Preview: " + posts.length + " posts, " + posts.reduce((n, p) => n + p.media.length, 0) + " media URLs.");
      phase = "ready";
    } catch (e) {
      ui.log("Scan failed: " + e.message, "xe-st err");
      phase = "idle";
    } finally {
      ui.btnScan.disabled = false;
      refresh();
    }
  }

  function markdown() {
    const root = posts[0] || {};
    const lines = [
      "# Thread by @" + (root.author || "unknown"),
      "",
      "- Source: " + (root.url || ""),
      "- Exported: " + new Date().toISOString(),
      "- Posts: " + posts.length,
      "",
    ];
    posts.forEach((p, i) => {
      lines.push("## " + (i + 1) + ". @" + p.author + " - " + p.time);
      lines.push("");
      lines.push(p.text || "_(no text)_");
      if (p.media.length) {
        lines.push("");
        for (const m of p.media) lines.push("- " + m.type + ": " + m.url);
      }
      lines.push("");
    });
    return lines.join("\n");
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type });
    const a = h("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }

  function stamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }

  function mount() {
    if (document.querySelector(".xe-panel") || !document.body) return;
    ui = makeUI();
    ui.urlIn.value = statusIdFrom(location.href) ? location.href : "";
    ui.btnScan.addEventListener("click", scan);
    ui.btnMd.addEventListener("click", () => {
      download("thread-" + (rootId || "export") + "-" + stamp() + ".md", markdown(), "text/markdown");
      ui.log("Markdown downloaded (" + posts.length + " posts).");
    });
    ui.btnJson.addEventListener("click", () => {
      const payload = { source: (posts[0] || {}).url || "", exported: new Date().toISOString(), posts: posts };
      download("thread-" + (rootId || "export") + "-" + stamp() + ".json", JSON.stringify(payload, null, 2), "application/json");
      ui.log("JSON downloaded (" + posts.length + " posts).");
    });
    ui.btnCopy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(markdown());
        ui.log("Markdown copied to clipboard.");
      } catch (e) {
        ui.log("Clipboard refused: " + e.message, "xe-st err");
      }
    });
    ui.log("Ready. Paste a tweet URL and scan.");
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    if (!document.querySelector(".xe-panel")) mount();
    const id = statusIdFrom(location.href);
    if (ui && id && phase !== "scanning") ui.urlIn.value = location.href;
  }, 800);

  document.addEventListener("keydown", (e) => {
    if (!e.altKey || !e.shiftKey || e.key.toLowerCase() !== "e" || isTyping()) return;
    e.preventDefault();
    if (!ui) return mount();
    if (ui.panel.classList.contains("xe-hide")) ui.chip.click(); else ui.panel.classList.toggle("xe-hide");
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
