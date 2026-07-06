/**
 * IRIS Meeting Capture — content script.
 *
 * Runs on Google Meet / Zoom / Teams tabs. When it detects that you're in a
 * live call, it injects a small IRIS prompt into the meeting tab. Clicking
 * "Track in IRIS" opens (or focuses) the IRIS Meetings view with the meeting
 * pre-linked via deep-link params, so you can start recording it — even though
 * the call was never on your calendar. This is the ONLY way a web tool can see
 * an ad-hoc meeting: a web page cannot inspect other tabs, but an extension can.
 */
(() => {
  'use strict';

  const DEFAULT_IRIS_URL = 'http://localhost:5173';
  const ACCENT = '#762fcc';
  const HOST_ID = 'iris-capture-root';
  const POLL_MS = 2000;

  /** Codes the user dismissed this tab session — don't re-nag for the same call. */
  const dismissed = new Set();
  let lastCode = null;

  // ── Meeting detection ──────────────────────────────────────────────────────

  /** Cleans a document.title into a human meeting name, or null if it's just chrome. */
  function cleanTitle() {
    let t = (document.title || '').trim();
    t = t
      .replace(/\s*[-–|]\s*Google Meet\s*$/i, '')
      .replace(/^Meet\s*[-–|]\s*/i, '')
      .replace(/^Google Meet\s*[-–|]?\s*/i, '')
      .replace(/\s*[-–|]\s*Zoom.*$/i, '')
      .replace(/\s*[-–|]\s*Microsoft Teams\s*$/i, '')
      .replace(/^\(\d+\)\s*/, '') // strip unread-count prefixes like "(3) "
      .trim();
    if (!t || /^(google )?meet$/i.test(t) || /^zoom$/i.test(t) || /^microsoft teams$/i.test(t)) return null;
    return t.slice(0, 160);
  }

  /** Returns {platform, code, title} when this tab is an active meeting, else null. */
  function detectMeeting() {
    const host = location.hostname;
    const path = location.pathname;

    // Google Meet — the in-call URL is a meeting code like /abc-defg-hij.
    if (host === 'meet.google.com') {
      const m = path.match(/^\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i);
      if (!m) return null;
      return { platform: 'meet', code: m[1].toLowerCase(), title: cleanTitle() || m[1] };
    }

    // Zoom — joined calls live under /j/<id>, /wc/<id>, or /s/<id>.
    if (host.endsWith('zoom.us')) {
      const m = path.match(/\/(?:j|wc|s)\/(\d+)/);
      if (!m) return null;
      return { platform: 'zoom', code: m[1], title: cleanTitle() || `Zoom ${m[1]}` };
    }

    // Teams — meeting joins contain "meetup-join" in the path.
    if (host === 'teams.microsoft.com' || host === 'teams.live.com') {
      if (!/meetup-join|\/meet\//i.test(path)) return null;
      return { platform: 'teams', code: '', title: cleanTitle() || 'Teams meeting' };
    }

    return null;
  }

  // ── Participant names (best-effort scrape → attribution candidates) ─────────

  /** True for a plausible person name (letters incl. Hindi, spaces, dots, hyphens). */
  function looksLikeName(s) {
    const t = (s || '').trim();
    if (t.length < 2 || t.length > 40) return false;
    if (/[0-9@:/]/.test(t)) return false; // codes, emails, timestamps
    if (/^(you|presentation|meeting|calling|screen)$/i.test(t)) return false;
    return /[A-Za-zÀ-ɏऀ-ॿ]/.test(t) && /^[\p{L}\s.'-]+$/u.test(t);
  }

  /**
   * Best-effort list of the people in the call, read from the meeting UI. Meet
   * class names are obfuscated, so several signals are tried; anything unclear
   * is dropped. Empty when nothing reliable is found — never guesses.
   */
  function collectParticipants() {
    const names = new Set();
    const add = (v) => {
      const t = (v || '').replace(/\s*\(You\)\s*$/i, '').trim();
      if (looksLikeName(t)) names.add(t);
    };
    // Your own name.
    document.querySelectorAll('[data-self-name]').forEach((el) => add(el.getAttribute('data-self-name')));
    // Participant tiles / list rows — Meet stores the name in data-sort-key,
    // and also renders it as a short leaf text node inside the tile.
    document.querySelectorAll('[data-participant-id]').forEach((tile) => {
      add(tile.getAttribute('data-sort-key'));
      const leaf = [...tile.querySelectorAll('span, div')]
        .filter((e) => e.childElementCount === 0)
        .map((e) => e.textContent || '')
        .find((t) => looksLikeName(t));
      if (leaf) add(leaf);
    });
    return [...names].slice(0, 12);
  }

  // ── IRIS base URL (configurable via the extension options) ──────────────────
  function getIrisUrl() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get({ irisUrl: DEFAULT_IRIS_URL }, (v) => resolve(v.irisUrl || DEFAULT_IRIS_URL));
      } catch {
        resolve(DEFAULT_IRIS_URL);
      }
    });
  }

  async function openInIris(info) {
    const base = (await getIrisUrl()).replace(/\/+$/, '');
    const url = new URL(base + '/meetings');
    url.searchParams.set('adhoc', '1');
    url.searchParams.set('title', info.title || info.code || 'Live meeting');
    url.searchParams.set('start', new Date().toISOString());
    if (info.code) url.searchParams.set('code', info.code);
    url.searchParams.set('platform', info.platform);
    // Real participant names → IRIS feeds them to the AI as attribution
    // candidates, so the other side of the call gets a name, not "Unknown".
    const people = collectParticipants();
    if (people.length) url.searchParams.set('people', people.join('|'));
    // Named target reuses the same IRIS tab on repeat clicks.
    window.open(url.toString(), 'iris-meetings');
  }

  // ── Injected prompt (isolated in a shadow root so Meet's CSS can't touch it) ─
  let shadow = null;

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host.shadowRoot;
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .card {
          position: fixed; right: 18px; bottom: 18px; width: 300px;
          background: #ffffff; color: #16151a;
          border: 1px solid rgba(118,47,204,0.35); border-radius: 14px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.28);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 14px 15px; animation: pop .28s cubic-bezier(.16,1,.3,1);
        }
        @keyframes pop { from { opacity:0; transform: translateY(8px) scale(.98) } to { opacity:1; transform:none } }
        .row { display:flex; align-items:center; gap:8px; }
        .dot { width:9px; height:9px; border-radius:50%; background:${ACCENT}; flex:none;
               box-shadow:0 0 0 0 rgba(118,47,204,.5); animation: pulse 1.6s ease-out infinite; }
        @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(118,47,204,.45)} 100%{box-shadow:0 0 0 9px rgba(118,47,204,0)} }
        .kicker { font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:${ACCENT}; }
        .title { font-size:14px; font-weight:700; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sub { font-size:11.5px; color:#66646e; margin-top:1px; }
        .actions { display:flex; gap:8px; margin-top:11px; }
        .track { flex:1; border:none; cursor:pointer; border-radius:9px; padding:9px 12px;
                 background:${ACCENT}; color:#fff; font-size:13px; font-weight:650; }
        .track:hover { filter:brightness(1.07); }
        .x { border:1px solid #e5e3ea; background:transparent; color:#88858f; cursor:pointer;
             border-radius:9px; width:34px; font-size:15px; line-height:1; }
        .x:hover { color:#16151a; background:#f4f2f8; }
        @media (prefers-color-scheme: dark) {
          .card { background:#1c1b21; color:#f2f1f5; border-color:rgba(150,110,230,.5); }
          .sub { color:#a7a4b0; } .x { border-color:#39373f; color:#a7a4b0; } .x:hover { background:#2a2830; color:#fff; }
        }
      </style>
      <div class="card" role="dialog" aria-label="IRIS meeting capture">
        <div class="row"><span class="dot"></span><span class="kicker">Meeting detected</span></div>
        <div class="title" id="iris-title"></div>
        <div class="sub" id="iris-sub"></div>
        <div class="actions">
          <button class="track" id="iris-track">Track in IRIS</button>
          <button class="x" id="iris-dismiss" title="Dismiss" aria-label="Dismiss">×</button>
        </div>
      </div>`;
    return shadow;
  }

  function subLabel(info) {
    const platform = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams' }[info.platform] || 'Meeting';
    return info.code ? `${platform} · ${info.code}` : platform;
  }

  function render(info) {
    const root = ensureHost();
    const host = document.getElementById(HOST_ID);
    host.style.display = 'block';
    root.getElementById('iris-title').textContent = info.title;
    root.getElementById('iris-sub').textContent = subLabel(info);
    const track = root.getElementById('iris-track');
    track.onclick = () => {
      void openInIris(info);
    };
    root.getElementById('iris-dismiss').onclick = () => {
      dismissed.add(info.code || info.title);
      hide();
    };
  }

  function hide() {
    const host = document.getElementById(HOST_ID);
    if (host) host.style.display = 'none';
  }

  // ── Poll: Meet/Zoom/Teams are SPAs, so the URL changes without a reload. ─────
  function sweep() {
    const info = detectMeeting();
    if (!info) {
      lastCode = null;
      hide();
      return;
    }
    const key = info.code || info.title;
    if (key !== lastCode) lastCode = key; // new meeting → allow the prompt again
    if (dismissed.has(key)) {
      hide();
      return;
    }
    render(info);
  }

  setInterval(sweep, POLL_MS);
  sweep();
})();
