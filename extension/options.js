'use strict';

const DEFAULT_IRIS_URL = 'http://localhost:5173';
const input = document.getElementById('iris-url');
const saved = document.getElementById('saved');

chrome.storage.sync.get({ irisUrl: DEFAULT_IRIS_URL }, (v) => {
  input.value = v.irisUrl || DEFAULT_IRIS_URL;
});

document.getElementById('save').addEventListener('click', () => {
  let url = input.value.trim() || DEFAULT_IRIS_URL;
  try {
    // Normalize and validate — keep only origin + path, drop trailing slash.
    const u = new URL(url);
    url = (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    saved.style.color = '#d14343';
    saved.textContent = 'Enter a valid URL, e.g. http://localhost:5173';
    return;
  }
  chrome.storage.sync.set({ irisUrl: url }, () => {
    input.value = url;
    saved.style.color = '#1f9d57';
    saved.textContent = 'Saved';
    setTimeout(() => (saved.textContent = ''), 1600);
  });
});
