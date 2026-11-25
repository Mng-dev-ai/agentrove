(() => {
  const cfg = window.__BENCH__;
  if (!cfg || window.top !== window) return;
  const STATE_KEY = `bench-state-${cfg.launchId}`;
  const WAIT_TIMEOUT_MS = 90000;
  const LONG_FRAME_MS = 50;
  const SWITCH_COUNT = 10;
  const HISTORY_TARGET_MESSAGES = 300;
  const SCROLL_DOWN_MS = 15000;
  const MEM_STEP_PX = 460;
  const MEM_IDLE_S = [30, 90];
  const MEM_LOAD_WAIT_MS = 5000;
  const CELL_COUNTS = [20, 100, 320];
  const CELL_FRAMES = 150;
  const CELL_MAX_MS = 8000;
  const CELL_WINDOW_PX = 9000;
  const SPEEDS = { human: 60, fast: 460 };
  const TRAIL_PASS_PER_SPAN = 2;
  const ROW_SELECTOR_PREFIX = '[data-message-id="';
  const PROBE_POSITIONS = 24;
  const PROBE_STRIDE = 7;
  const PROBE_TOP_PX = 400;
  const PROBE_ACTIVE_FRACTION = 0.4;
  const PROBE_JUMP_OFFSET_PX = 12;
  const PROBE_TOLERANCE_PX = 4;
  const PROBE_STILL_FRAMES = 10;
  const PROBE_SETTLE_MS = 4000;
  const errors = [];
  const dom = { scroller: null, span: 0, nulled: 0, calls: {} };

  const wrapDom = (proto, name, trailOff) => {
    const orig = proto[name];
    const c = { n: 0, ms: 0 };
    dom.calls[name] = c;
    proto[name] = function (...args) {
      if (
        trailOff &&
        this === dom.scroller &&
        typeof args[0] === 'string' &&
        args[0].startsWith(ROW_SELECTOR_PREFIX)
      ) {
        if (!dom.span) queueMicrotask(() => (dom.span = 0));
        dom.span += 1;
        if (dom.span > TRAIL_PASS_PER_SPAN) {
          dom.nulled += 1;
          return null;
        }
      }
      const t = performance.now();
      const r = orig.apply(this, args);
      c.ms += performance.now() - t;
      c.n += 1;
      return r;
    };
  };

  if (cfg.variant === 'wrapped' || cfg.variant === 'trailoff') {
    wrapDom(Element.prototype, 'querySelector', cfg.variant === 'trailoff');
    wrapDom(Element.prototype, 'querySelectorAll', false);
    wrapDom(Element.prototype, 'getBoundingClientRect', false);
  }

  const domSnapshot = () => {
    const out = { nulled: dom.nulled };
    for (const [name, c] of Object.entries(dom.calls)) out[name] = { n: c.n, ms: c.ms };
    return out;
  };
  const domDelta = (a, b) => {
    const out = { nulled: b.nulled - a.nulled };
    for (const name of Object.keys(dom.calls)) {
      out[name] = { n: b[name].n - a[name].n, ms: Math.round((b[name].ms - a[name].ms) * 100) / 100 };
    }
    return out;
  };

  window.addEventListener('error', (e) => errors.push(String(e.message || e)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  const post = (msg) => {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bench) {
      window.webkit.messageHandlers.bench.postMessage(JSON.stringify(msg));
    } else {
      window.benchHost.post(JSON.stringify(msg));
    }
  };

  const loadState = () => JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
  const saveState = (s) => sessionStorage.setItem(STATE_KEY, JSON.stringify(s));

  const state = loadState() || { phase: 'cold', metrics: {}, details: {} };
  localStorage.clear();
  localStorage.setItem('auth_token', cfg.accessToken);
  localStorage.setItem('refresh_token', cfg.refreshToken);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  const painted = async () => {
    await nextFrame();
    await new Promise((r) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = r;
      ch.port2.postMessage(0);
    });
    return performance.now();
  };

  const waitFor = (label, cond, pollMs = 50) =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      let done = false;
      let observer = null;
      let timer = null;
      const finish = (ok) => {
        done = true;
        if (observer) observer.disconnect();
        clearInterval(timer);
        if (ok) resolve(performance.now());
        else reject(new Error(`timeout waiting for ${label}`));
      };
      const check = () => {
        if (done) return;
        let ok = false;
        try {
          ok = !!cond();
        } catch (e) {
          ok = false;
        }
        if (ok) finish(true);
        else if (performance.now() - started > WAIT_TIMEOUT_MS) finish(false);
      };
      const attach = () => {
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
        timer = setInterval(check, pollMs);
        check();
      };
      if (document.documentElement) attach();
      else document.addEventListener('readystatechange', attach, { once: true });
    });

  const sidebar = () => document.querySelector('aside[aria-label="Chat history"]');
  const rowButton = (title) => {
    const aside = sidebar();
    if (!aside) return null;
    return [...aside.querySelectorAll('button')].find((b) => b.textContent.trim() === title) || null;
  };
  const composerReady = () => {
    const t = document.querySelector('textarea[aria-label="Message input"]');
    return !!t && !t.disabled;
  };
  const shellReady = () => composerReady() && !!rowButton(cfg.chats.chat_1k.title);
  const chatReady = (key) => {
    const chat = cfg.chats[key];
    if (location.pathname !== `/chat/${chat.id}`) return false;
    const last = document.querySelector(`[data-message-id="${chat.last_message_id}"]`);
    if (!last || last.textContent.trim().length < 50) return false;
    return composerReady() && document.querySelectorAll('[data-message-id]').length >= Math.min(20, chat.messages);
  };
  const messageCount = () => document.querySelectorAll('[data-message-id]').length;
  const elementCount = (el) => el.getElementsByTagName('*').length;
  const diffReady = () => {
    const rows = document.querySelectorAll('[data-diff-file-path]').length;
    if (rows < cfg.diffFiles) return false;
    const containers = [...document.querySelectorAll('diffs-container')];
    return containers.some((c) => c.shadowRoot && c.shadowRoot.querySelector('[data-line]'));
  };
  const diffClosed = () => document.querySelectorAll('[data-diff-file-path]').length === 0;
  const diffToggle = () => document.querySelector('button[aria-label="Toggle Diff view"]');

  const scroller = () => {
    let el = document.querySelector('[data-message-id]');
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  };

  const frameRecorder = () => {
    const stamps = [];
    let running = true;
    const tick = (t) => {
      stamps.push(t);
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      running = false;
      return stamps;
    };
  };

  const frameStats = (stamps, refreshMs) => {
    const deltas = [];
    for (let i = 1; i < stamps.length; i += 1) deltas.push(stamps[i] - stamps[i - 1]);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : null);
    const duration = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
    return {
      frames: stamps.length,
      duration_ms: duration,
      fps: duration ? ((stamps.length - 1) * 1000) / duration : 0,
      median_ms: pct(0.5),
      p95_ms: pct(0.95),
      p99_ms: pct(0.99),
      max_ms: sorted.length ? sorted[sorted.length - 1] : null,
      long_frames: deltas.filter((d) => d > LONG_FRAME_MS).length,
      dropped_frames: deltas.reduce((n, d) => n + Math.max(0, Math.round(d / refreshMs) - 1), 0),
      deltas_ms: deltas.map((d) => Math.round(d * 100) / 100),
    };
  };

  const idleCheck = async (key) => {
    const stop = frameRecorder();
    await sleep(1000);
    const stamps = stop();
    const deltas = [];
    for (let i = 1; i < stamps.length; i += 1) deltas.push(stamps[i] - stamps[i - 1]);
    deltas.sort((a, b) => a - b);
    const refresh = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
    state.details[key] = {
      frames_in_1s: stamps.length,
      median_frame_ms: refresh,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
    };
    state.refreshMs = refresh > 0 ? refresh : 1000 / 60;
  };

  const mark = (name) =>
    new Promise((resolve) => {
      window.__benchMarkDone = resolve;
      post({ type: 'mark', name });
    });

  const pageTo = async (el, target, pages) => {
    while (messageCount() < target) {
      const before = messageCount();
      el.scrollTop = el.clientHeight;
      await nextFrame();
      await nextFrame();
      const d0 = domSnapshot();
      const t0 = performance.now();
      el.scrollTop = 0;
      await waitFor('older page', () => messageCount() > before);
      const ms = (await painted()) - t0;
      pages.push({ ms, from: before, to: messageCount(), elements: elementCount(el), dom: domDelta(d0, domSnapshot()) });
      await sleep(200);
    }
  };

  const scrollCell = async (el, speed) => {
    const step = SPEEDS[speed];
    const max = el.scrollHeight - el.clientHeight;
    const span = Math.min(CELL_WINDOW_PX, max - 2 * el.clientHeight);
    const lo = max - span;
    el.scrollTop = lo;
    await nextFrame();
    await nextFrame();
    await sleep(500);
    const stamps = [];
    const perFrame = [];
    let pos = lo;
    let dir = 1;
    let travelled = 0;
    let prev = domSnapshot();
    const tStart = await nextFrame();
    stamps.push(tStart);
    for (;;) {
      if (speed === 'human') {
        pos = Math.min(max, pos + step);
      } else {
        pos += dir * step;
        if (pos >= max) {
          pos = max;
          dir = -1;
        } else if (pos <= lo) {
          pos = lo;
          dir = 1;
        }
      }
      travelled += Math.abs(pos - el.scrollTop);
      el.scrollTop = pos;
      const now = await nextFrame();
      stamps.push(now);
      const snap = domSnapshot();
      perFrame.push(domDelta(prev, snap));
      prev = snap;
      if ((speed === 'human' && pos >= max) || stamps.length > CELL_FRAMES || now - tStart > CELL_MAX_MS) break;
    }
    const stats = frameStats(stamps, state.refreshMs);
    return {
      speed,
      step_px: step,
      window_px: span,
      travelled_px: travelled,
      messages: messageCount(),
      elements: elementCount(el),
      fps: stats.fps,
      p95_ms: stats.p95_ms,
      median_ms: stats.median_ms,
      long_frames: stats.long_frames,
      frames: stats.frames,
      duration_ms: stats.duration_ms,
      deltas_ms: stats.deltas_ms,
      dom_per_frame: dom.calls.querySelector ? perFrame : undefined,
    };
  };

  const timeClick = async (el, label, cond, pollMs) => {
    if (!el) throw new Error(`missing click target for ${label}`);
    const t0 = performance.now();
    el.click();
    const tc = await waitFor(label, cond, pollMs);
    const tp = await painted();
    return { condition_ms: tc - t0, painted_ms: tp - t0 };
  };

  const openChatWarm = async (key) => {
    await timeClick(rowButton(cfg.chats.switch_a.title), 'switch_a', () => chatReady('switch_a'));
    await sleep(500);
    return timeClick(rowButton(cfg.chats[key].title), key, () => chatReady(key));
  };

  const launchPhase = async (cond, label) => {
    const tc = await waitFor(label, cond);
    const tp = await painted();
    if (state.phase === 'cold') {
      const navToEpoch = performance.timeOrigin + tp;
      state.metrics.cold_ms = navToEpoch - cfg.t0EpochMs;
      state.details.cold_condition_from_nav_ms = tc;
      state.details.cold_painted_from_nav_ms = tp;
      await idleCheck('idle');
      state.phase = 'warm';
      saveState(state);
      location.reload();
      return false;
    }
    state.metrics.warm_ms = tp;
    state.details.warm_condition_from_nav_ms = tc;
    return true;
  };

  const trailTicks = () => [...document.querySelectorAll('button[aria-label^="Jump to message: "]')];
  const activeTick = (ticks) => ticks.findIndex((b) => b.querySelector('[class*="tick--active"]'));
  const turnRows = (el) => {
    const groups = new Set();
    const firsts = [];
    for (const row of el.querySelectorAll('[data-message-id]')) {
      if (!groups.has(row.parentElement)) {
        groups.add(row.parentElement);
        firsts.push(row);
      }
    }
    return firsts;
  };
  const expectedTurn = (el, rows) => {
    const top = el.getBoundingClientRect().top;
    const threshold = el.clientHeight * PROBE_ACTIVE_FRACTION;
    let idx = 0;
    rows.forEach((row, i) => {
      if (row.getBoundingClientRect().top - top <= threshold) idx = i;
    });
    return idx;
  };
  const settleScroll = async (el) => {
    const t0 = performance.now();
    let last = el.scrollTop;
    let still = 0;
    while (still < PROBE_STILL_FRAMES && performance.now() - t0 < PROBE_SETTLE_MS) {
      await nextFrame();
      still = el.scrollTop === last ? still + 1 : 0;
      last = el.scrollTop;
    }
  };

  const trailProbe = async (el) => {
    const out = { positions: [], clicks: [], pass: 0, fail: 0 };
    const count = messageCount();
    const ticks = trailTicks();
    const firsts = turnRows(el);
    const leading = firsts.length - ticks.length;
    out.turns = ticks.length;
    out.leading_groups = leading;
    if (ticks.length < 2 || leading < 0 || leading > 1) {
      out.fail += 1;
      out.error = `ticks ${ticks.length} vs turn groups ${firsts.length}`;
      return out;
    }
    const max = el.scrollHeight - el.clientHeight;
    for (let i = 0; i < PROBE_POSITIONS; i += 1) {
      const k = (i * PROBE_STRIDE) % PROBE_POSITIONS;
      el.scrollTop = PROBE_TOP_PX + ((max - PROBE_TOP_PX) * k) / (PROBE_POSITIONS - 1);
      await settleScroll(el);
      await sleep(50);
      const rows = turnRows(el).slice(leading);
      const expected = expectedTurn(el, rows);
      const actual = activeTick(trailTicks());
      const ok = expected === actual && messageCount() === count;
      out[ok ? 'pass' : 'fail'] += 1;
      out.positions.push({ scroll_top: el.scrollTop, expected, actual, ok });
    }
    for (const idx of [Math.floor(ticks.length / 10), Math.floor(ticks.length / 2), ticks.length - 1]) {
      el.scrollTop = idx < ticks.length / 2 ? max : PROBE_TOP_PX;
      await settleScroll(el);
      const row = turnRows(el).slice(leading)[idx];
      trailTicks()[idx].click();
      await settleScroll(el);
      const rel = row.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const limit = el.scrollHeight - el.clientHeight;
      const target = Math.min(limit, Math.max(0, el.scrollTop + rel - PROBE_JUMP_OFFSET_PX));
      const off = el.scrollTop - target;
      const ok = row.isConnected && Math.abs(off) <= PROBE_TOLERANCE_PX && messageCount() === count;
      out[ok ? 'pass' : 'fail'] += 1;
      out.clicks.push({ turn: idx, scroll_top: el.scrollTop, target, off_px: off, ok });
    }
    return out;
  };

  const timedScrollDown = async (el) => {
    const stopDown = frameRecorder();
    const setCosts = [];
    const tDown = await nextFrame();
    for (;;) {
      const now = await nextFrame();
      const f = Math.min(1, (now - tDown) / SCROLL_DOWN_MS);
      const before = performance.now();
      el.scrollTop = f * (el.scrollHeight - el.clientHeight);
      setCosts.push(performance.now() - before);
      if (f >= 1) break;
    }
    setCosts.sort((a, b) => a - b);
    return { down: frameStats(stopDown(), state.refreshMs), setCosts };
  };

  const fixedScrollDown = async (el) => {
    const stop = frameRecorder();
    let pos = el.scrollTop;
    await nextFrame();
    while (pos < el.scrollHeight - el.clientHeight) {
      pos += MEM_STEP_PX;
      el.scrollTop = pos;
      await nextFrame();
    }
    return frameStats(stop(), state.refreshMs);
  };

  const memPoint = (el) => ({ messages: messageCount(), elements: elementCount(el), t_ms: performance.now() });

  const memScroll = async (mode) => {
    await waitFor('chat_5k', () => chatReady('chat_5k'));
    await idleCheck('idle');
    await sleep(500);
    const el = scroller();
    if (!el) throw new Error('no transcript scroller');
    await pageTo(el, HISTORY_TARGET_MESSAGES, []);
    await sleep(1000);
    state.details.marks = { paged: memPoint(el) };
    await mark('paged');
    const paged = messageCount();
    el.scrollTop = 0;
    const tLoad = performance.now();
    while (messageCount() === paged && performance.now() - tLoad < MEM_LOAD_WAIT_MS) await sleep(50);
    await sleep(1000);
    const startTop = el.scrollTop;
    const countBefore = messageCount();
    const frames = mode === 'fixed' ? await fixedScrollDown(el) : (await timedScrollDown(el)).down;
    const tEnd = performance.now();
    state.details.mem_scroll = {
      mode,
      step_px: mode === 'fixed' ? MEM_STEP_PX : null,
      messages_before: countBefore,
      messages_after: messageCount(),
      start_top: startTop,
      end_top: el.scrollTop,
      travelled_px: el.scrollTop - startTop,
      frames: frames.frames,
      duration_ms: frames.duration_ms,
      fps: frames.fps,
      median_ms: frames.median_ms,
      p95_ms: frames.p95_ms,
      long_frames: frames.long_frames,
    };
    state.details.marks.scrolled = memPoint(el);
    await mark('scrolled');
    for (const s of MEM_IDLE_S) {
      await sleep(Math.max(0, tEnd + s * 1000 - performance.now()));
      state.details.marks[`idle${s}`] = memPoint(el);
      await mark(`idle${s}`);
    }
    return true;
  };

  const cells5k = async () => {
    await waitFor('chat_5k', () => chatReady('chat_5k'));
    await idleCheck('idle');
    await sleep(500);
    const el = scroller();
    if (!el) throw new Error('no transcript scroller');
    dom.scroller = el;
    const pages = [];
    const cells = [];
    const counts = cfg.variant === 'trailoff' ? [CELL_COUNTS[CELL_COUNTS.length - 1]] : CELL_COUNTS;
    for (const count of counts) {
      await pageTo(el, count, pages);
      if (scroller() !== el) throw new Error('transcript scroller replaced');
      for (const speed of Object.keys(SPEEDS)) {
        const cell = await scrollCell(el, speed);
        cell.mounted = count;
        cells.push(cell);
      }
    }
    state.details.pages = pages;
    state.details.cells = cells;
    state.details.trail_probe = await trailProbe(el);
    state.details.trail_nulled = dom.nulled;
    return true;
  };

  const scenarios = {
    async launch_shell() {
      return launchPhase(shellReady, 'shell');
    },
    async launch_chat() {
      return launchPhase(() => chatReady('chat_1k'), 'chat_1k');
    },
    async open_1k() {
      await waitFor('shell', shellReady);
      await idleCheck('idle');
      const cold = await timeClick(rowButton(cfg.chats.chat_1k.title), 'chat_1k', () => chatReady('chat_1k'));
      state.metrics.cold_ms = cold.painted_ms;
      await sleep(500);
      state.metrics.warm_ms = (await openChatWarm('chat_1k')).painted_ms;
      return true;
    },
    async open_5k() {
      await waitFor('shell', shellReady);
      await idleCheck('idle');
      const cold = await timeClick(rowButton(cfg.chats.chat_5k.title), 'chat_5k', () => chatReady('chat_5k'));
      state.metrics.cold_ms = cold.painted_ms;
      await sleep(500);
      state.metrics.warm_ms = (await openChatWarm('chat_5k')).painted_ms;
      return true;
    },
    async scroll_5k() {
      await waitFor('chat_5k', () => chatReady('chat_5k'));
      await idleCheck('idle');
      await sleep(500);
      const el = scroller();
      if (!el) throw new Error('no transcript scroller');
      state.details.marks = { open: { messages: messageCount(), elements: elementCount(el) } };
      await mark('open');
      await sleep(500);
      const startCount = messageCount();
      const stopUp = frameRecorder();
      const tUp = performance.now();
      const pages = [];
      while (messageCount() < HISTORY_TARGET_MESSAGES) {
        const before = messageCount();
        el.scrollTop = el.clientHeight;
        await nextFrame();
        await nextFrame();
        const t0 = performance.now();
        el.scrollTop = 0;
        await waitFor('older page', () => messageCount() > before);
        pages.push((await painted()) - t0);
        await sleep(200);
      }
      state.details.history_wall_ms = performance.now() - tUp;
      const sortedPages = [...pages].sort((x, y) => x - y);
      state.metrics.history_page_median_ms = sortedPages[Math.floor(sortedPages.length / 2)];
      const up = frameStats(stopUp(), state.refreshMs);
      state.details.history = { start_messages: startCount, end_messages: messageCount(), page_ms: pages, frames: up };
      await sleep(1000);
      state.details.marks.paged = { messages: messageCount(), elements: elementCount(el) };
      await mark('paged');
      el.scrollTop = 0;
      await nextFrame();
      await sleep(1000);
      const countBefore = messageCount();
      const height = el.scrollHeight - el.clientHeight;
      const { down, setCosts } = await timedScrollDown(el);
      state.metrics.scroll_p95_frame_ms = down.p95_ms;
      state.metrics.scroll_long_frames = down.long_frames;
      state.metrics.scroll_dropped_frames = down.dropped_frames;
      state.metrics.scroll_fps = down.fps;
      state.details.scroll = {
        messages_before: countBefore,
        messages_after: messageCount(),
        scroll_height_px: height,
        scroll_set_median_ms: setCosts[Math.floor(setCosts.length / 2)],
        scroll_set_max_ms: setCosts[setCosts.length - 1],
        frames: down,
      };
      await sleep(1000);
      state.details.marks.scrolled = { messages: messageCount(), elements: elementCount(el) };
      await mark('scrolled');
      return true;
    },
    async mem_fixed() {
      return memScroll('fixed');
    },
    async mem_timed() {
      return memScroll('timed');
    },
    async cells_5k_plain() {
      return cells5k();
    },
    async cells_5k_wrapped() {
      return cells5k();
    },
    async cells_5k_trailoff() {
      return cells5k();
    },
    async diff() {
      await waitFor('chat_diff', () => chatReady('chat_diff'));
      await idleCheck('idle');
      const cold = await timeClick(diffToggle(), 'diff', diffReady, 16);
      state.metrics.cold_ms = cold.painted_ms;
      state.details.diff_rows = document.querySelectorAll('[data-diff-file-path]').length;
      await sleep(1000);
      diffToggle().click();
      await waitFor('diff closed', diffClosed);
      await sleep(1000);
      state.metrics.warm_ms = (await timeClick(diffToggle(), 'diff warm', diffReady, 16)).painted_ms;
      return true;
    },
    async switch() {
      await waitFor('shell', shellReady);
      await idleCheck('idle');
      await timeClick(rowButton(cfg.chats.switch_a.title), 'switch_a', () => chatReady('switch_a'));
      const samples = [];
      for (let i = 0; i < SWITCH_COUNT; i += 1) {
        await sleep(300);
        const key = i % 2 === 0 ? 'switch_b' : 'switch_a';
        samples.push((await timeClick(rowButton(cfg.chats[key].title), key, () => chatReady(key))).painted_ms);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      state.metrics.switch_median_ms = sorted[Math.floor(sorted.length / 2)];
      state.details.switch_samples_ms = samples;
      return true;
    },
  };

  const snapshot = () =>
    new Promise((resolve) => {
      window.__benchSnapshotDone = resolve;
      post({ type: 'screenshot' });
    });

  const finish = async (error) => {
    if (!error) {
      await sleep(2000);
      await idleCheck('idle_end');
    }
    const result = {
      scenario: cfg.scenario,
      host: cfg.host,
      run: cfg.run,
      ok: !error,
      error: error ? String(error.message || error) : null,
      metrics: state.metrics,
      details: state.details,
      errors,
      user_agent: navigator.userAgent,
      url: location.href,
      message_count: messageCount(),
      variant: cfg.variant,
      overflow_anchor: CSS.supports('overflow-anchor', 'auto'),
      body_text: error ? (document.body ? document.body.innerText.slice(0, 2000) : '') : undefined,
    };
    sessionStorage.removeItem(STATE_KEY);
    if (cfg.screenshot || error) await snapshot();
    post({ type: 'result', result });
  };

  const run = async () => {
    try {
      const complete = await scenarios[cfg.scenario]();
      if (complete) await finish(null);
    } catch (e) {
      await finish(e);
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
})();
