# ПК-версія — стан на 1 серпня 2026, 21:00

Тижневий ліміт обірвав трьох робітників. Це знімок, щоб наступна сесія не
переоткривала те саме.

## Як запустити зараз

```
cd src/backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
cd src/frontend && npx vite preview --port 5180 --strictPort --host 127.0.0.1
```

Вхід: `phantom` / PIN з `.phantom-data/identity/bootstrap_pin`.
Тільки `vite preview` — `npm run dev` білий, див. нижче.

## Три застосунки в одному репозиторії

| шлях | що це | стан |
|---|---|---|
| `src/frontend` | PHANTOM Cloud — справжній продукт | працює через preview |
| `src/desktop` | «Film» — прозорий оверлей поверх екрана | не застосунок за задумом |
| `src/frontend/src-tauri` | нативне вікно 1024×600, `productName: PHANTOM OS` | не збирається |

`src/desktop` навмисно клікопрозорий: `main.rs:127` викликає
`set_ignore_cursor_events(true)`, вікно `focus: false`, `transparent: true`.
Це шар світла над робочим столом, не вікно для роботи.

## Відкриті дефекти

**Нативна збірка падає.** `npx tauri build --no-bundle` →
`resource path binaries/phantom-backend-x86_64-unknown-linux-gnu doesn't exist`.
Tauri хоче вкласти бекенд усередину як sidecar. Або зібрати той бінарник
(PyInstaller з `src/backend`), або прибрати його з `resources` у
`tauri.conf.json` і лишити бекенд окремим процесом.

**Dev-режим білий.** `optimizeDeps.exclude` у `vite.config.ts` містить
`@ricky0123/vad-web`, а пакет — CommonJS без `module`/`exports`. Vite віддає
браузеру сирий CJS, і `import { MicVAD }` не зв'язується — React не монтується
взагалі. Продакшн-збірка ціла, бо Rollup із CJS справляється. Робітник дійшов
висновку: виключати треба лише `onnxruntime-web` заради його WASM-ресурсів,
а `vad-web` замело під ту саму гребінку помилково.

**Дашборд вигадує дані.** `pages/Dashboard/AnalyticsOverview.tsx` — 1.2M
токенів, 42 агенти, 8400 сесій, і троє неіснуючих людей у «Top Operators»
(рядки 148-150) при одному користувачі в базі.

**Каркас станів осиротів.** `app/App.tsx` досі має банер
`/* State → Layout routing */`, а роутить лише за URL. З десяти макетів у
`src/layouts/` живі три; `FocusLayout`, `DialogueLayout`, `SentinelLayout`,
`GhostLayout`, `DreamLayout`, `OperatorLayout` не рендеряться ніколи. При
цьому `CLAUDE.md` називає стани головним каркасом UI.

**Мертва смуга знизу.** Старі макети прибиті до `w-[1024px] h-[600px]`
(`OperatorLayout.tsx:132`, `DreamLayout.tsx:30`, `ProfileSelector.tsx:145,171`),
новий `DashboardLayout` — full-bleed. Разом дають порожнечу під згином.

**Оболонка англійською** в українському продукті.

## Незлиті гілки робітників

`worktree-agent-a4e1dd3c2bba86d8a` — телеметрія, 29 файлів, неперевірено
`worktree-agent-ae48d1699aa06f892` — dev-режим, діагноз доведений до фіксу
`worktree-agent-abdae9a5fff27c2fe` — каркас станів, тільки розвідка
`worktree-agent-af0779844bf4625df` — Film: вхід, токен, композер; ворота зелені

## Перевірка справжнім браузером

Playwright має chromium, але шлях за замовчуванням застарілий:

```js
chromium.launch({
  executablePath: '/home/kyrylo/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  args: ['--no-sandbox'],
})
```

Застосунок білішає на будь-якій непійманій помилці модуля, тож знімок екрана
сам по собі нічого не доводить — завжди збирай `pageerror` і HTTP ≥ 400.
