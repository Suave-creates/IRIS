# IRIS Meeting Capture (browser extension)

Detects live meetings in **Google Meet, Zoom, and Microsoft Teams** — including
**ad-hoc calls that were never on your calendar** — and hands them off to IRIS.

## Why an extension?

A web page (the IRIS app in one tab) physically cannot see or inject into another
tab — that's a browser security boundary, not an IRIS limitation. An extension's
content script *can* run inside the meeting tab. This is exactly how Fireflies,
Otter, Fathom, etc. work.

## What it does

1. When you're in a call, it injects a small IRIS prompt into the meeting tab.
2. It reads the **participant names** visible in the meeting UI (best-effort).
3. **Track in IRIS** opens (or focuses) the IRIS Meetings view with the meeting
   pre-linked via URL params: `/meetings?adhoc=1&title=…&start=…&code=…&platform=…&people=…`.
4. IRIS treats it as a live meeting — the in-panel prompt appears, the recorder is
   pre-linked, and those participant names are handed to the AI as attribution
   candidates so the other side of the call gets a real name instead of
   "Unknown Speaker". One tap starts capturing (mic + optional call-tab audio).

No Google Calendar or OAuth needed — this path is entirely independent of calendar sync.

## Install (Chrome / Edge, unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Click the extension's toolbar icon and set the **IRIS base URL**
   (default `http://localhost:5173`; use `http://<your-lan-ip>:5173` if you open
   IRIS from another device).

Make sure you're signed in to IRIS in the same browser so the opened tab is authenticated.

## Notes & limits

- Meet detection keys off the in-call URL (`meet.google.com/abc-defg-hij`); the
  meeting name comes from the tab title. Zoom keys off `/j|wc|s/<id>`; Teams off
  `meetup-join` (best-effort — Teams URLs vary).
- The prompt is dismissable per call (won't re-nag for the same meeting in that tab).
- It does **not** read audio or meeting content — capture happens only inside IRIS,
  after you click Track and press record. The extension only reads the tab URL/title.
- To add more platforms, extend `host_permissions` + `content_scripts.matches` in
  `manifest.json` and add a branch in `detectMeeting()` in `content.js`.
