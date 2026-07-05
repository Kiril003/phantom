# PHANTOM Commerce — сайт, оплата, активація

**Статус:** shipped 2026-07-05 (сайт `platform-site/`, ліцензійний сервер `platform-site/server/`, пристроєвий модуль `src/backend/licensing/`).

## Компоненти

```
Покупець ──> platform-site (маркетинг, React+Vite)
         ──> LemonSqueezy checkout (merchant-of-record: картки/VAT/KYC)
                 │ webhook (HMAC-SHA256, X-Signature)
                 ▼
         license server (platform-site/server, FastAPI+SQLite)
                 │ Ed25519-підписаний сертифікат
                 ▼
         PHANTOM пристрій (src/backend/licensing/) — офлайн-верифікація
```

## Модель довіри

- **Ліцензійний ключ** `PHTM-XXXXX-XXXXX-XXXXX-XXXXX` (Crockford base32 + checksum-група). У базі — тільки SHA-256 хеш. LemonSqueezy-ключі теж приймаються (хеш-порівняння не залежить від формату).
- **Сертифікат активації** — JSON, підписаний Ed25519 приватним ключем сервера. Прив'язаний до `device_fingerprint` = SHA-256(machine-id + SoC serial). Пристрій довіряє ТІЛЬКИ вшитому публічному ключу (`PHANTOM_LICENSE_PUBKEY` / `DEV_PUBLIC_KEY_HEX` у `verifier.py`) — ключ, що приходить із сертифікатом, ігнорується.
- **Офлайн-first:** після активації інтернет не потрібен. `revalidate` — best-effort: якщо сервер недоступний, ліцензія лишається чинною (perpetual); знімається лише коли сервер явно каже `revoked` (chargeback).
- **Ліміт активацій:** image=3, device=5, atelier=10; повторна активація того ж пристрою ідемпотентна (той самий serial). Deactivate звільняє слот.

## Сервер (env)

`LICENSE_DB`, `LICENSE_SIGNING_KEY` (PEM, автогенерується), `ADMIN_TOKEN` (обов'язково для /admin/*), `LS_WEBHOOK_SECRET`, `LS_VARIANT_TIERS="variant_id:tier,..."`, `TIER_ACTIVATIONS`. Rate-limit 20 req/хв/IP на /api/*. Аудит-лог у таблиці `events`.

Ендпоінти: `POST /api/activate|validate|deactivate`, `POST /webhooks/lemonsqueezy` (дедуп по order_ref), `POST /admin/issue|revoke`, `GET /healthz`.

## Пристрій (env)

`PHANTOM_LICENSE_PUBKEY` (прод-ключ; без нього діє dev-ключ), `PHANTOM_LICENSE_FILE` (`~/.phantom/license.json`, chmod 600), `PHANTOM_LICENSE_SERVER`. API: `GET/POST /api/v1/license/{status,activate,deactivate,revalidate}` — ROOT-only.

Свідоме відхилення від правила «всі конфіги з UI»: ключі довіри й enforcement — параметри дистрибуції, не користувацькі налаштування.

## Що ЩЕ не зроблено (наступні кроки)

1. **Enforcement** — зараз ліцензія тільки перевіряється і показується; жоден маршрут не блокується. Рішення на майбутнє: middleware-гейт на /api/* (allowlist: auth, license, healthz) за `PHANTOM_LICENSE_ENFORCE=1` + grace-банер в UI. Вмикати лише у прод-образі.
2. **Settings UI** — екран «Ліцензія» (статус, активація ключем, deactivate) у settings.
3. **Образ/інсталер** — збірка flashable-образу для Radxa + `get.phantom-os.io/install.sh` (перевірка підпису образу → активація → перший запуск). Потребує release-інфраструктури.
4. **Кабінет покупця** — керування активаціями самостійно (зараз — через support/admin API).

## Чеклист запуску (операторські дії — потрібні акаунти)

1. Домен (`phantom-os.io` або інший) + Cloudflare DNS.
2. Хостинг сервера: Fly.io/Hetzner (1 маленька VM вистачить). `uvicorn main:app` + volume для SQLite і keys/. Бекап бази щодня.
3. **Прод-ключі**: на сервері згенерується `keys/signing.pem` при першому старті; його public hex → `PHANTOM_LICENSE_PUBKEY` у прод-образ пристрою. Приватний ключ НІКОЛИ не покидає сервер; офлайн-копія — у сейф.
4. LemonSqueezy: акаунт → продукт з 2 variants (Образ/Пристрій) → увімкнути License Keys → webhook на `https://license.../webhooks/lemonsqueezy` (події order_created, license_key_created, order_refunded) → секрет у `LS_WEBHOOK_SECRET`, variant-ids у `LS_VARIANT_TIERS`.
5. Сайт: `platform-site/` → Cloudflare Pages/Vercel (`npm run build`, static). Кнопки Pricing → LemonSqueezy checkout-URLs.
6. Правове: Terms/Privacy/Оферта (Termly або юрист), угода LS покриває платіжну сторону.
7. Chargeback-процедура: refund у LS → `POST /admin/revoke` (пізніше автоматизувати через webhook `order_refunded`).

## Тести

- `platform-site/server/tests/test_license_server.py` — 7 (крипто, активації/ліміт/ідемпотентність, revoke, webhook HMAC+dedup).
- `src/backend/tests/test_licensing.py` — 8 (fingerprint, roundtrip, tamper/чужий підписант/чужий пристрій/corrupt, chmod 600).
