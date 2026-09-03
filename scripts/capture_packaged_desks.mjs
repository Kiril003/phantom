#!/usr/bin/env node
/*
  Знімок ПК ззовні — засобами композитора, а не зсередини рушія.

  ЧОМУ САМЕ ТАК. Попередня версія цього файлу ходила в `chromium.connectOverCDP`
  і не могла працювати за побудовою, чотирма незалежними причинами одразу:
    1. оболонка ПК — Tauri на WebKitGTK, а WebKit не говорить протоколом CDP;
    2. релізна збірка не має фічі `devtools` (src-tauri/Cargo.toml: лише
       `custom-protocol`), тож інспектора не піднімає в принципі;
    3. `playwright-core` навіть не резолвиться з `scripts/` — пакет лежить у
       `src/frontend/node_modules`, а в корені немає package.json;
    4. теки `.build/shots` не існувало — скрипт не запускався жодного разу.

  Робочий шлях інший: вікно пакунка — звичайне вікно на композиторі. Отже
  геометрію беремо з `hyprctl clients -j`, а піксель — через `grim -g`.
  Кадр виходить із СПРАВЖНЬОГО апаратного GL, тому (на відміну від
  swiftshader-кадрів) він придатний і для суду про колір.

  МЕЖА, ЯКУ ЦЕЙ СКРИПТ НЕ ПЕРЕСТУПАЄ.
  Агент не набирає ПІН. Без входу власника з екрана можна зняти рівно дві речі:
  кадр екрана замка і доказ, що вікно продукту ОДНЕ. Столи «Театр», «Кокпіт»,
  «Компанія» лежать за входом. Більше того: у пакунку немає жодного каналу
  автоматизації в WebKitGTK, тож скрипт не вміє ані натиснути кнопку стола, ані
  дізнатися, який стіл зараз на екрані. Столи знімаються лише режимом `follow`,
  поки людина сама ними ходить, і кадри іменуються нейтрально — скрипт не
  підписує кадр назвою стола, якої не може перевірити.

  Команди:
    probe             — перелік вікон, вирок «пакунок / розробка», доказ «вікно одне»
    shoot [мітка]     — один кадр знайденого вікна
    follow [N] [сек]  — N кадрів із періодом, поки власник сам ходить столами
    launch            — запуск пакунка під systemd-run (зі сторожами)
    clean             — прибрати `_MEI*` за собою
*/
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, readlinkSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const OUT = process.env.PHANTOM_SHOTS || join(REPO, '.build/shots');
const APPIMAGE = process.env.PHANTOM_APPIMAGE || join(REPO, '.build/out/PHANTOM OS_0.20.0_amd64.AppImage');
const TMPBASE = process.env.PHANTOM_TMP || join(REPO, '.build/tmp');
const GATE = process.env.PHANTOM_GATE || '/tmp/phantom-verify/gate.lock';
const MIN_MB = Number(process.env.PHANTOM_MIN_MB || 5000);
const MATCH = new RegExp(process.env.PHANTOM_MATCH || 'phantom', 'i');
// Коли поруч із пакунком висить dev-вікно з тим самим заголовком, різати
// взірцем нічого: class і title у них однакові. Тоді пришпилюємо pid.
const ONLY_PID = Number(process.env.PHANTOM_PID || 0);

const log = (m) => console.log(`[кадр] ${m}`);
const warn = (m) => console.log(`[кадр] ⚠ ${m}`);

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.error?.message || r.stderr || '').trim() };
}
const have = (t) => run('command', ['-v', t]).code === 0 || run('sh', ['-c', `command -v ${t}`]).code === 0;

// ── Засоби. Кажемо прямо, чого немає, і не вигадуємо обхід.
function requireTools(tools) {
  const missing = tools.filter((t) => !have(t));
  if (missing.length) {
    warn(`на цій машині немає: ${missing.join(', ')}`);
    warn('без них цей шлях не працює. Обходу не вигадую.');
    process.exit(2);
  }
}

// ── Геометрія монітора в логічних координатах (у них живуть вікна).
function monitors() {
  const r = run('hyprctl', ['monitors', '-j']);
  if (r.code !== 0) { warn(`hyprctl не відповів: ${r.err}`); process.exit(2); }
  return JSON.parse(r.out).map((m) => {
    const swap = [1, 3, 5, 7].includes(m.transform);
    const w = Math.round((swap ? m.height : m.width) / m.scale);
    const h = Math.round((swap ? m.width : m.height) / m.scale);
    return { name: m.name, x: m.x, y: m.y, w, h };
  });
}

// ── Пакунок чи dev-сервер? Питаємо процес, а не заголовок вікна:
// заголовок «PHANTOM OS» однаковий і в пакунку, і в MiniBrowser на Vite.
function classify(pid) {
  let exe = '', cmd = '';
  try { exe = readlinkSync(`/proc/${pid}/exe`); } catch { /* чужий або мертвий процес */ }
  try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch { /* те саме */ }
  let kind = 'невідомо';
  if (/\/\.mount_/.test(exe) || /\.AppImage/i.test(cmd)) kind = 'пакунок';
  else if (/MiniBrowser$/.test(exe) || /https?:\/\/(127\.0\.0\.1|localhost):\d+/.test(cmd)) kind = 'розробка';
  return { kind, exe, cmd };
}

// ── Яка частка вікна взагалі лежить на екрані. Нижче побачимо, що grim
// мовчки добиває решту прозорістю — кадр правильного розміру й порожній.
function visibleFraction(win, mons) {
  const [wx, wy] = win.at, [ww, wh] = win.size;
  const area = ww * wh;
  if (area <= 0) return 0;
  let seen = 0;
  for (const m of mons) {
    const ix = Math.max(0, Math.min(wx + ww, m.x + m.w) - Math.max(wx, m.x));
    const iy = Math.max(0, Math.min(wy + wh, m.y + m.h) - Math.max(wy, m.y));
    seen += ix * iy;
  }
  return Math.min(1, seen / area);
}

function allClients() {
  const r = run('hyprctl', ['clients', '-j']);
  if (r.code !== 0) { warn(`hyprctl не відповів: ${r.err}`); process.exit(2); }
  const mons = monitors();
  return JSON.parse(r.out)
    .filter((c) => c.mapped && !c.hidden)
    .map((c) => ({ ...c, visible: visibleFraction(c, mons) }));
}

function windows() {
  return allClients()
    .filter((c) => (ONLY_PID ? c.pid === ONLY_PID : MATCH.test(c.class || '') || MATCH.test(c.title || '')))
    .map((c) => ({ ...c, ...classify(c.pid) }));
}

// ── ЧУЖІ ПІКСЕЛІ. grim знімає ПРЯМОКУТНИК ЕКРАНА, а не буфер вікна: усе, що
// лежить зверху, потрапляє в «кадр вікна». Перевірка альфи цього НЕ ловить —
// пікселі справжні, просто чужі. Виміряно 03.09: кадр екрана замка пакунка
// вийшов на 35% закритий чужим dev-вікном і мав 100% цілості.
function occluders(win, all) {
  const [wx, wy] = win.at, [ww, wh] = win.size;
  const area = ww * wh;
  return all
    .filter((o) => o.address !== win.address && o.monitor === win.monitor
      && o.workspace?.id === win.workspace?.id)
    .map((o) => {
      const [ox, oy] = o.at, [ow, oh] = o.size;
      const ix = Math.max(0, Math.min(wx + ww, ox + ow) - Math.max(wx, ox));
      const iy = Math.max(0, Math.min(wy + wh, oy + oh) - Math.max(wy, oy));
      return { win: o, frac: area > 0 ? (ix * iy) / area : 0 };
    })
    .filter((x) => x.frac > 0)
    .sort((a, b) => b.frac - a.frac);
}

// ── Цілість кадру. Порожній піксель у grim прозорий, тож середня альфа
// дорівнює частці справжнього зображення. Виміряно: вікно 1024 шириною,
// видно 544 → альфа рівно 0,53125. Якщо magick немає — кажемо «не виміряв»,
// а не мовчазне «добре».
function integrity(file) {
  if (!have('magick')) return null;
  const r = run('magick', [file, '-alpha', 'extract', '-format', '%[fx:mean]', 'info:']);
  return r.code === 0 ? Number(r.out) : null;
}

function describe(w, i) {
  const mark = w.kind === 'пакунок' ? '✔ ПАКУНОК' : w.kind === 'розробка' ? '✘ розробка (не пакунок)' : '? невідомо';
  log(`  [${i}] ${mark}  class=${w.class}  title=${w.title}`);
  log(`      pid=${w.pid} геометрія=${w.at.join(',')} ${w.size.join('x')} видно=${(w.visible * 100).toFixed(1)}%`);
  log(`      exe=${w.exe || '(не прочитав)'}`);
}

// ── Що лишається за власником. Друкуємо завжди, щоб ніхто не подумав,
// ніби кадр екрана замка — це кадр стола.
function ownerBoundary() {
  log('');
  log('ЗА ВЛАСНИКОМ (агент цього не робить):');
  log('  1. ввести ПІН — без цього видно лише екран замка;');
  log('  2. самому натиснути «Театр» / «Кокпіт» / «Компанія» — у пакунку немає');
  log('     каналу автоматизації в WebKitGTK, скрипт не тисне кнопок;');
  log('  3. поки власник ходить столами — тримати запущеним `follow`.');
  log('  Скрипт не знає, який стіл на екрані, і кадрів назвами столів не підписує.');
}

function pick({ requirePackaged = true } = {}) {
  const all = windows();
  if (all.length === 0) {
    warn(ONLY_PID ? `вікна з pid=${ONLY_PID} немає — нічого не знімаю.`
                  : `вікон за взірцем /${MATCH.source}/i не знайшов — нічого не знімаю.`);
    warn('Пакунок не запущений? Дивись `launch`.');
    process.exit(3);
  }
  all.forEach(describe);
  if (all.length > 1) {
    warn(`вікон ${all.length}, а не одне — не знаю, котре з них продукт.`);
    warn('Доказ «вікно ОДНЕ» НЕ отримано. Закрий зайві, або пришпиль PHANTOM_PID=<pid>');
    warn('— але пришпилений pid доводить лише кадр, а не те, що вікно одне.');
    process.exit(4);
  }
  const w = all[0];
  log(`вікно ОДНЕ — доказ отримано (pid=${w.pid}).`);
  if (requirePackaged && w.kind !== 'пакунок') {
    warn(`але це «${w.kind}», а не пакунок: кадр з нього НЕ є доказом про пакунок.`);
  }
  return w;
}

function capture(w, file, others = null) {
  mkdirSync(OUT, { recursive: true });
  const over = occluders(w, others || allClients());
  if (over.length) {
    const total = Math.min(1, over.reduce((a, x) => a + x.frac, 0));
    warn(`прямокутник вікна перекривають ЧУЖІ вікна (до ${(total * 100).toFixed(1)}%):`);
    for (const { win: o, frac } of over) warn(`   ${(frac * 100).toFixed(1)}%  ${o.class} «${o.title}» pid=${o.pid}`);
    warn('grim знімає екран, не буфер вікна — ці пікселі впадуть у кадр.');
    warn('Інакше кадр не є доказом про продукт. Ліки, перевірені 03.09 — віднести');
    warn('вікно продукту на порожній стіл композитора й зняти його там самого:');
    warn(`   hyprctl dispatch movetoworkspace 9,address:${w.address}`);
  }
  const geom = `${w.at[0]},${w.at[1]} ${w.size[0]}x${w.size[1]}`;
  const r = run('grim', ['-g', geom, file]);
  if (r.code !== 0) { warn(`grim не зняв: ${r.err}`); return null; }
  const alpha = integrity(file);
  const kb = Math.round((existsSync(file) ? readFileSync(file).length : 0) / 1024);
  log(`знято → ${file} (${kb} КБ, ${w.size.join('x')})`);
  if (alpha === null) warn('цілість кадру не виміряв (немає magick) — не вважай її доведеною.');
  else if (alpha < 0.999) {
    warn(`кадр ЧАСТКОВИЙ: справжніх пікселів ${(alpha * 100).toFixed(1)}%, решта — прозора добивка.`);
    warn('Вікно частиною за межами екрана. Як доказ такий кадр не годиться.');
  } else if (!over.length) log('кадр цілий: 100% справжніх пікселів, чужих вікон зверху немає.');
  else log('кадр цілий за альфою — але з чужими вікнами всередині (вище).');
  return { file, alpha };
}

// ── Сторожі запуску. Пакунок onefile розпаковує ~1,7 ГБ у TMPDIR, а /tmp тут
// tmpfs, тобто та сама памʼять машини — тому TMPDIR кладемо на диск.
function memAvailableMb() {
  const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+) kB/);
  return m ? Math.round(Number(m[1]) / 1024) : 0;
}

function launch() {
  requireTools(['systemd-run']);
  if (run('flock', ['-n', GATE, 'true']).code !== 0) {
    warn(`ворота зайняті (${GATE}) — хтось інший вантажить машину. Не лізу.`);
    process.exit(5);
  }
  const mb = memAvailableMb();
  if (mb < MIN_MB) {
    warn(`вільної памʼяті ${mb} МБ < ${MIN_MB} МБ — не запускаю.`);
    warn('Пакунок розпаковує ~1,7 ГБ; запуск на такій машині вбʼє щось інше.');
    process.exit(5);
  }
  if (!existsSync(APPIMAGE)) { warn(`пакунка немає: ${APPIMAGE}`); process.exit(3); }
  mkdirSync(TMPBASE, { recursive: true });
  const unit = process.env.PHANTOM_UNIT || 'phantom-desk';
  log(`запускаю ${APPIMAGE}`);
  log(`  TMPDIR=${TMPBASE} (на диску, не в tmpfs), unit=${unit}`);
  const r = run('systemd-run', [
    '--user', `--unit=${unit}`, '--collect',
    `--setenv=TMPDIR=${TMPBASE}`,
    APPIMAGE,
  ]);
  if (r.code !== 0) { warn(`systemd-run не запустив: ${r.err || r.out}`); process.exit(5); }
  log(r.out || `запущено як ${unit}.service`);
  log(`журнал: journalctl --user -u ${unit} -f`);
  log(`зупинити: systemctl --user stop ${unit}`);
  log('через кілька секунд: `probe`, далі `shoot`.');
}

function clean() {
  let n = 0;
  for (const dir of ['/tmp', TMPBASE]) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir)) {
      if (!e.startsWith('_MEI')) continue;
      try { rmSync(join(dir, e), { recursive: true, force: true }); n++; } catch { /* чуже — не наше */ }
    }
  }
  log(`прибрано _MEI*: ${n}`);
}

// ── Вхід
const [cmd = 'probe', a1, a2] = process.argv.slice(2);
// Час МІСЦЕВИЙ, не UTC: кадри доводиться звіряти з тим, що власник робив
// о цій годині на своєму годиннику.
const stamp = () => new Date().toLocaleTimeString('uk-UA', { hour12: false }).replace(/:/g, '-');

if (cmd === 'probe') {
  requireTools(['hyprctl']);
  const all = windows();
  log(ONLY_PID ? `вікон із pid=${ONLY_PID}: ${all.length}` : `вікон за взірцем /${MATCH.source}/i: ${all.length}`);
  const every = allClients();
  all.forEach((w, i) => {
    describe(w, i);
    const over = occluders(w, every);
    if (over.length) log(`      ⚠ зверху лежить чуже: ${over.map((x) => `${x.win.class}(${(x.frac * 100).toFixed(1)}%)`).join(', ')}`);
  });
  if (all.length === 1) log('вікно ОДНЕ — доказ отримано.');
  else if (all.length > 1) warn('вікон більше одного — доказ «вікно ОДНЕ» НЕ отримано.');
  ownerBoundary();
} else if (cmd === 'shoot') {
  requireTools(['hyprctl', 'grim']);
  const w = pick();
  capture(w, join(OUT, `${stamp()}-${a1 || 'кадр'}.png`));
  ownerBoundary();
} else if (cmd === 'follow') {
  requireTools(['hyprctl', 'grim']);
  const n = Number(a1 || 6), every = Number(a2 || 10);
  const w = pick();
  log(`знімаю ${n} кадрів кожні ${every} с. Веди столи сам — я лише знімаю.`);
  for (let i = 1; i <= n; i++) {
    const cur = windows().find((x) => x.pid === w.pid) || w;
    capture(cur, join(OUT, `${stamp()}-${String(i).padStart(2, '0')}.png`));
    if (i < n) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, every * 1000);
  }
  log('кадри пронумеровані, не підписані столами: який стіл на якому — скажи ти.');
  ownerBoundary();
} else if (cmd === 'launch') launch();
else if (cmd === 'clean') clean();
else { warn(`не знаю команди «${cmd}». Є: probe, shoot, follow, launch, clean.`); process.exit(64); }
