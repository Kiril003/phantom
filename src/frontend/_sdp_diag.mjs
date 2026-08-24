// Чому ptime не доїхав: дивимось у самі описи, а не в здогади.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SCRATCH = process.argv[2];
const TOK_A = readFileSync(`${SCRATCH}/tok_a`, 'utf8').trim();
const TOK_B = readFileSync(`${SCRATCH}/tok_b2`, 'utf8').trim();
const CHAT_ON_A = 'f575c904-943e-487f-a4d0-e310b6c1e9d0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
         '--autoplay-policy=no-user-gesture-required'],
});

const open = async (origin, token) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.grantPermissions(['microphone'], { origin });
  await ctx.addInitScript((t) => {
    localStorage.setItem('phantom_token', t);
    localStorage.setItem('phantom_token_expires', String(Date.now() + 3600_000));
  }, token);
  const page = await ctx.newPage();
  // Перехоплюємо кожен опис, який реально ліг у зʼєднання.
  await page.addInitScript(() => {
    window.__sdpLog = [];
    const RealPC = window.RTCPeerConnection;
    const wrap = (pc) => {
      for (const m of ['setLocalDescription', 'setRemoteDescription']) {
        const orig = pc[m].bind(pc);
        pc[m] = async (desc) => {
          const sdp = desc?.sdp ?? '';
          const audio = sdp.split(/m=/).find((s) => s.startsWith('audio')) ?? '';
          window.__sdpLog.push({
            m, type: desc?.type,
            ptime: (audio.match(/a=ptime:(\d+)/) || [])[1] ?? null,
            maxptime: (audio.match(/a=maxptime:(\d+)/) || [])[1] ?? null,
            fmtp: (audio.match(/a=fmtp:111 ([^\r\n]*)/) || [])[1] ?? null,
            at: Date.now(),
          });
          return orig(desc);
        };
      }
      return pc;
    };
    window.RTCPeerConnection = function (...args) { return wrap(new RealPC(...args)); };
    window.RTCPeerConnection.prototype = RealPC.prototype;
  });
  await page.goto(`${origin}/messenger`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(7000);
  return page;
};

const [pageA, pageB] = await Promise.all([
  open('http://127.0.0.1:5173', TOK_A),
  open('http://127.0.0.1:5174', TOK_B),
]);

await pageA.click(`#chat-item-${CHAT_ON_A}`);
await pageA.waitForTimeout(1200);
await pageA.click('[data-call-start="audio"]');
await pageB.waitForSelector('[data-call-state="ringing"]', { timeout: 20000 });
await pageB.click('button[aria-label="Прийняти"]');
await pageA.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
await pageB.waitForSelector('[data-call-state="active"]', { timeout: 25000 });
await sleep(2000);

const dump = (p) => p.evaluate(() => window.__sdpLog);
console.log('=== ПІСЛЯ ЗʼЄДНАННЯ ===');
console.log('A:', JSON.stringify(await dump(pageA), null, 1));
console.log('B:', JSON.stringify(await dump(pageB), null, 1));

console.log('\n=== ФОРСУЄМО NARROW НА ОБОХ ===');
const forced = await Promise.all([
  pageA.evaluate(() => window.__phantomCallLadder('narrow')),
  pageB.evaluate(() => window.__phantomCallLadder('narrow')),
]);
console.log('forceLadder вернув:', forced);
await sleep(5000);

console.log('A після:', JSON.stringify(await dump(pageA), null, 1));
console.log('B після:', JSON.stringify(await dump(pageB), null, 1));
console.log('A signalingState:', await pageA.evaluate(() => window.__phantomCallState()?.state));

await browser.close();
