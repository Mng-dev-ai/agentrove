(() => {
  const cfg = window.__BENCH__;
  if (!cfg || window.top !== window) return;
  const STATE_KEY = `bench-state-${cfg.launchId}`;
  const WAIT_TIMEOUT_MS = 90000;
  const LONG_FRAME_MS = 50;
  const SWITCH_COUNT = 10;
  const HISTORY_TARGET_MESSAGES = 300;
  const SCROLL_DOWN_MS = 15000;
  const errors = [];

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

  const idleCheck = async () => {
    const stop = frameRecorder();
    await sleep(1000);
    const stamps = stop();
    const deltas = [];
    for (let i = 1; i < stamps.length; i += 1) deltas.push(stamps[i] - stamps[i - 1]);
    deltas.sort((a, b) => a - b);
    const refresh = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
    state.details.idle = {
      frames_in_1s: stamps.length,
      median_frame_ms: refresh,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
    };
    state.refreshMs = refresh > 0 ? refresh : 1000 / 60;
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
      await idleCheck();
      state.phase = 'warm';
      saveState(state);
      location.reload();
      return false;
    }
    state.metrics.warm_ms = tp;
    state.details.warm_condition_from_nav_ms = tc;
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
      await idleCheck();
      const cold = await timeClick(rowButton(cfg.chats.chat_1k.title), 'chat_1k', () => chatReady('chat_1k'));
      state.metrics.cold_ms = cold.painted_ms;
      await sleep(500);
      state.metrics.warm_ms = (await openChatWarm('chat_1k')).painted_ms;
      return true;
    },
    async open_5k() {
      await waitFor('shell', shellReady);
      await idleCheck();
      const cold = await timeClick(rowButton(cfg.chats.chat_5k.title), 'chat_5k', () => chatReady('chat_5k'));
      state.metrics.cold_ms = cold.painted_ms;
      await sleep(500);
      state.metrics.warm_ms = (await openChatWarm('chat_5k')).painted_ms;
      return true;
    },
    async scroll_5k() {
      await waitFor('chat_5k', () => chatReady('chat_5k'));
      await idleCheck();
      await sleep(500);
      const el = scroller();
      if (!el) throw new Error('no transcript scroller');
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
      el.scrollTop = 0;
      await nextFrame();
      await sleep(1000);
      const countBefore = messageCount();
      const height = el.scrollHeight - el.clientHeight;
      const stopDown = frameRecorder();
      const tDown = await nextFrame();
      for (;;) {
        const now = await nextFrame();
        const f = Math.min(1, (now - tDown) / SCROLL_DOWN_MS);
        el.scrollTop = f * (el.scrollHeight - el.clientHeight);
        if (f >= 1) break;
      }
      const down = frameStats(stopDown(), state.refreshMs);
      state.metrics.scroll_p95_frame_ms = down.p95_ms;
      state.metrics.scroll_long_frames = down.long_frames;
      state.metrics.scroll_dropped_frames = down.dropped_frames;
      state.metrics.scroll_fps = down.fps;
      state.details.scroll = {
        messages_before: countBefore,
        messages_after: messageCount(),
        scroll_height_px: height,
        frames: down,
      };
      return true;
    },
    async diff() {
      await waitFor('chat_diff', () => chatReady('chat_diff'));
      await idleCheck();
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
      await idleCheck();
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
