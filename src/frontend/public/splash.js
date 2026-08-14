const STATUS_EL = document.getElementById('status');
const READYZ = 'http://127.0.0.1:8000/readyz';
// Resolved against the asset-protocol root the splash itself is served from.
const TARGET = 'index.html';
const POLL_MS = 250;
const MAX_WAIT_MS = 30000;
const t0 = performance.now();

async function pollOnce() {
  try {
    const r = await fetch(READYZ, { cache: 'no-store' });
    if (r.ok) {
      STATUS_EL.textContent = 'online';
      window.location.replace(TARGET);
      return true;
    }
  } catch (_) {
    /* sidecar still booting; ignore */
  }
  return false;
}

async function loop() {
  while (performance.now() - t0 < MAX_WAIT_MS) {
    if (await pollOnce()) return;
    STATUS_EL.textContent = `warming  ${Math.floor(
      (performance.now() - t0) / 1000,
    )}s`;
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
  STATUS_EL.textContent = 'backend did not become ready within 30s — see logs';
}

loop();
