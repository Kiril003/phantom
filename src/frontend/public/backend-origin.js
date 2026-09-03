/*
  PHANTOM OS — ОДНЕ місце, яке знає, де живе бекенд.

  Навіщо це існує. 29.08.2026, перший запуск запакованого AppImage з живим
  вікном: смуга організму показала «канал обрив», «ядро мовчить», «ресурси
  мовчить» при цілком живому HTTP, а в пейні діалогу вилізла англійська
  картка «The string did not match the expected pattern.» — сирий
  DOMException, якого в наших рядках немає взагалі.

  Причина: адреси до бекенда будувались від `window.location`:

      services/messengerNetworkEngine.ts:179  `${protocol}//${location.host}/ws`
      services/websocket.ts:244               new URL('/ws', location.href)

  У розробці це працює, бо vite проксує `/ws` і `/api` на бекенд. У пакунку
  фронт віддається asset-протоколом Tauri, і `location.host` — це НЕ
  127.0.0.1:8000. Сокет іде в нікуди (звідси три «мовчить»), а невалідний
  хост у конструкторі WebSocket дає рівно ту англійську фразу на екрані.

  Заставка при цьому працювала — бо вона єдина в дереві мала абсолютну
  адресу зашитою. Тобто правильний шаблон існував, але в одному файлі з
  трьох, і два інші про нього не знали.

  Цей файл — plain JS у `public/` навмисно: його вантажать ОБИДВА входи,
  і заставка (де немає збірки й діє CSP `script-src 'self'`), і застосунок.
  Так адреса бекенда лишається одним визначенням, а не трьома, що
  розійдуться. Заразом закривається борг «порт 8000, зашитий у заставці».
*/
(function () {
  // Порт бекенда. Rust спавнить sidecar без PORT, тож той бере свій
  // дефолт — 8000 (`config.port`). Міняти треба в обох місцях одночасно;
  // тримаємо число тут, щоб «обидва місця» було видно як одне.
  var PORT = 8000;
  var HOST = '127.0.0.1';

  // Чи ми всередині оболонки Tauri. Перевіряємо наявність її глобалів, а не
  // протокол: у Tauri v2 на Linux asset-протокол теж віддається як http,
  // тож `location.protocol` тут нічого не розрізняє.
  function isPackaged() {
    return (
      typeof window.__TAURI_INTERNALS__ !== 'undefined' ||
      typeof window.__TAURI__ !== 'undefined' ||
      // Запасний слід на випадок, якщо Tauri перестане інжектити глобали:
      // asset-протокол віддає застосунок саме з цього хоста.
      window.location.hostname === 'tauri.localhost'
    );
  }

  // У пакунку — абсолютна адреса до sidecar. У розробці — порожній рядок,
  // тобто той самий origin, який vite і проксує. Ніякого третього варіанта:
  // якщо тут колись з'явиться `location.host`, ми повернемось рівно до
  // дефекту, заради якого цей файл написаний.
  function origin() {
    return isPackaged() ? 'http://' + HOST + ':' + PORT : '';
  }

  function ws(path) {
    var p = path.charAt(0) === '/' ? path : '/' + path;
    if (!isPackaged()) {
      var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + window.location.host + p;
    }
    return 'ws://' + HOST + ':' + PORT + p;
  }

  function http(path) {
    var p = path.charAt(0) === '/' ? path : '/' + path;
    return origin() + p;
  }

  // Завжди абсолютна, без жодних припущень про оточення. Для заставки:
  // вона живе тільки в зібраному пакунку і мусить достукатись до sidecar
  // навіть якщо Tauri раптом не інжектить своїх глобалів. Саме ця
  // безумовність робила її єдиною справною частиною пакунка — не
  // забираємо її, лише переносимо число сюди.
  function absolute(path) {
    var p = path.charAt(0) === '/' ? path : '/' + path;
    return 'http://' + HOST + ':' + PORT + p;
  }

  window.__PHANTOM_BACKEND__ = {
    host: HOST,
    port: PORT,
    isPackaged: isPackaged,
    origin: origin,
    ws: ws,
    http: http,
    absolute: absolute,
  };
})();
