#!/usr/bin/env python3
"""Ворота на САМОМУ ПАКУНКУ ПК: чи не їде в AppImage майстерня замість продукту.

Дзеркало воріт телефона (`phantom-companion/scripts/release.sh`, «у пакунок не
їде майстерня», 04.09): там реліз читає APK як архів і відмовляє, побачивши
`.map`, `showcase`, `storybook`, `__mocks__` чи `.stories.`. Тут те саме
твердження, але пакунок інший — і форма дефекту теж інша, тому прилад інший.

──────────────────────────────────────────────────────────────────────────
ЩО ВИМІРЯНО 04.09.2026 на `.build/out/PHANTOM OS_0.20.0_cc10f419_amd64.AppImage`

Наївна перевірка «пройтись файлами пакунка й пошукати *.map» на ПК дає НУЛЬ
і зеленіє — при тому, що мапи в пакунку є. Заміряно:

    файлів у змонтованому AppImage      504
    з них *.map                           0   ← і це правда про файли
    ключів «/assets/…» у usr/bin/phantom-os-shell   509
    з них «….js.map»                    143   ← рівно стільки, скільки
                                               мап лежало в src/frontend/dist

Причина структурна: Tauri не кладе `dist/` у пакунок теками. `tauri-codegen`
обходить `frontendDist` і ВБУДОВУЄ кожен файл у бінарник оболонки — ключ
(шлях) лишається звичайним текстом, вміст лежить поруч стисненим. Тобто на ПК
мапи ховаються не у файловій системі пакунка, а всередині одного ELF.

Ціна помилки: 21,7 МБ із 36,1 МБ тієї теки — це мапи, тобто ВЕСЬ вихідний код
веба, з іменами файлів і текстом, читаний будь-ким, хто розпакує AppImage.

ЯК ЧИТАЄМО ПАКУНОК. `unsquashfs` на цій машині немає, ставити його заради
воріт — вимагати зайвий пакет від кожного, хто збирає. Працює власний рантайм:
`"<шлях>.AppImage" --appimage-mount` підіймає squashfuse і друкує точку
монтування першим рядком stdout. Далі це звичайна тека. Розмонтовуємо рівно
СВОЮ точку, завершенням саме нашого процесу: поруч живуть чужі `/tmp/.mount_*`,
з яких працює бекенд іншої сесії, і глоб по них вбив би чужу роботу.

КОНТРОЛЬ ПРИЛАДУ. Сканер міг би осліпнути (інша версія Tauri, стиснені ключі,
переіменована оболонка) — і тоді «мап нема» означало б «я нічого не бачу», а не
«мап нема». Тому оболонку шукаємо ЗА ПОВЕДІНКОЮ (файл під usr/, у якому є і
`index.html`, і ключі `/assets/…`), і вимагаємо побачити хоч один вбудований
`.js`/`.css`. Не побачили — це не зелене, це червоне: ворота, що не вміють
почервоніти, гірші за їх відсутність.

ЧОГО ЦЕЙ СТОРОЖ НЕ ДОВОДИТЬ:
* Він не витягує вміст мапи з бінарника — вміст там стиснений. Він доводить,
  що таблиця ресурсів пакунка ІМЕНУЄ мапи, тобто застосунок їх віддає.
* Він дивиться на вбудовану оболонку й на файли пакунка. Він нічого не
  говорить про те, що бекенд роздає з `PHANTOM_FRONTEND_DIST` при встановленні
  з джерел — то інший шлях і інші ворота.

Вжиток:  scripts/package_carries_no_sources.py <шлях до .AppImage>
Виходи:  0 — у пакунку лише продукт;  1 — відмова (або прилад осліп).
"""

from __future__ import annotations

import os
import re
import signal
import subprocess
import sys

# Ті самі імена, що й у воротах телефона: список один на два продукти.
WORKSHOP = re.compile(r"(showcase|storybook|__mocks__|\.stories\.)", re.I)
WORKSHOP_BYTES = re.compile(rb"(showcase|storybook|__mocks__|\.stories\.)", re.I)

# Ключі таблиці ресурсів Tauri лежать у .rodata ОДНИМ полотном, БЕЗ роздільників:
# `…/assets/A-hash.js/assets/B-hash.js.map…`. Кінця в ключа немає, тому будь-який
# «розумний» шаблон імені недорахує. Заміряно 04.09 на cc10f419, де мап рівно 143:
#
#     жадібний «шлях від /»                  138  ← злипає пробіги, видно останнє
#     імʼя файла з оглядом уперед            141  ← гине там, де далі йде літера
#     проста підрядкова лічба b".map"        145  ← 143 справжні + 2 випадкові
#
# Беремо третє. Недорахунок — це і є зелень, що не вміє почервоніти: одна
# проковтнута мапа, і ворота мовчать. Перебір же дає хибне ЧЕРВОНЕ, а помилятись
# тут дозволено лише в цей бік. Контроль (`.map` у бінарниках без веба):
# `/usr/bin/readelf` — 0, `AppRun.wrapped` пакунка — 0.
#
# Регулярка нижче потрібна лише щоб НАЗВАТИ приклади у звіті. Вона має право
# знайти менше, ніж лічба; вирок виносить лічба.
ASSET_FILE = re.compile(rb"[A-Za-z0-9_.\-]{1,120}\.map(?![A-Za-z0-9_.\-])")


def die(msg: str) -> None:
    print(f"[пакунок] {msg}", file=sys.stderr)
    sys.exit(1)


def scan_shell(path: str) -> tuple[int, int, int, list[str]]:
    """Ключі ресурсів усередині бінарника оболонки.

    Повертає (скільки мап, скільки майстерні, скільки взагалі ключів `/assets/`,
    приклади імен для звіту). Третє число — контроль зору, а не окраса: нуль
    там означає, що прилад нічого не бачить, і зеленіти йому не можна.
    """
    with open(path, "rb") as fh:
        blob = fh.read()
    maps = blob.count(b".map")
    shop = len(WORKSHOP_BYTES.findall(blob))
    seen = blob.count(b"/assets/")
    names = sorted({m.group(0).decode("ascii", "replace") for m in ASSET_FILE.finditer(blob)})
    return maps, shop, seen, names


def self_test() -> None:
    """Чи вміє прилад ОБИДВА кольори.

    Червоний бік доведено на справжньому артефакті (cc10f419, 145 мап). Зелений
    бік доводити нема на чому: пакунка без мап ще не існує, а перезбирати
    AppImage заради кольору — пів години машини. Тому зелений бік перевіряємо
    тут, на двох полотнах, зроблених як у бінарнику: ключі без роздільників.
    """
    import tempfile

    green = b"index.html" + b"".join(f"/assets/i-{i}.js".encode() for i in range(20))
    red = green + b"/assets/i-0.js.map" + b"/assets/Foo.stories.tsx"
    for blob, want_maps, want_shop, want_keys in ((green, 0, 0, 20), (red, 1, 1, 22)):
        with tempfile.NamedTemporaryFile(delete=False) as fh:
            fh.write(blob)
            path = fh.name
        try:
            maps, shop, keys, _ = scan_shell(path)
        finally:
            os.unlink(path)
        colour = "зелене" if not (maps or shop) else "червоне"
        print(f"[самоперевірка] {colour}: мап {maps} (чекав {want_maps}) · "
              f"майстерні {shop} (чекав {want_shop}) · ключів {keys}")
        if (maps, shop, keys) != (want_maps, want_shop, want_keys):
            die("самоперевірка не зійшлась — приладу вірити не можна")
    print("[самоперевірка] прилад уміє і зеленіти, і червоніти")


def main() -> None:
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        self_test()
        return
    if len(sys.argv) != 2:
        die("вжиток: package_carries_no_sources.py <шлях до .AppImage> | --self-test")
    img = os.path.abspath(sys.argv[1])
    if not os.path.isfile(img):
        die(f"немає артефакта {img} — перевіряти нічого")
    if not os.access(img, os.X_OK):
        die(f"{os.path.basename(img)} не виконуваний — рантайм не змонтує пакунок")

    proc = subprocess.Popen(
        [img, "--appimage-mount"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True
    )
    try:
        line = proc.stdout.readline() if proc.stdout else ""
        mount = line.strip()
        if not mount or not os.path.isdir(mount):
            die("рантайм AppImage не змонтував пакунок (FUSE недоступний?) — "
                "вирок не винесено, тому реліз не пускаю")

        # ── 1. Файли пакунка ────────────────────────────────────────────
        loose_maps: list[str] = []
        loose_shop: list[str] = []
        files = 0
        for root, _dirs, names in os.walk(mount):
            for name in names:
                files += 1
                rel = os.path.join(root, name)[len(mount):]
                if name.endswith(".map"):
                    loose_maps.append(rel)
                elif WORKSHOP.search(name):
                    loose_shop.append(rel)

        # ── 2. Оболонка з вбудованим вебом — шукаємо за поведінкою ──────
        shell = None
        for root, _dirs, names in os.walk(os.path.join(mount, "usr")):
            for name in names:
                cand = os.path.join(root, name)
                try:
                    if os.path.getsize(cand) > 256 * 1024 * 1024:
                        continue  # сайдкар на 570 МБ веба не везе
                    with open(cand, "rb") as fh:
                        head = fh.read()
                except OSError:
                    continue
                if b"index.html" in head and b"/assets/" in head:
                    shell = cand
                    break
            if shell:
                break
        if shell is None:
            die("не знайшов у пакунку бінарника з вбудованим вебом — прилад "
                "осліп, а сліпий прилад не має права зеленіти")

        emb_maps, emb_shop, keys, samples = scan_shell(shell)
        rel_shell = shell[len(mount):]
        if keys == 0:
            die(f"у {rel_shell} нуль ключів «/assets/» — веб або не вбудовано, "
                "або прилад осліп; зеленіти на цьому не можна")

        print(f"[пакунок] {os.path.basename(img)}")
        print(f"[пакунок] файлів: {files} · оболонка: {rel_shell} · "
              f"ключів ресурсів: {keys}")

        maps = len(loose_maps) + emb_maps
        shop = len(loose_shop) + emb_shop
        if maps or shop:
            print("[пакунок] у пакунку є майстерня, а не лише продукт:", file=sys.stderr)
            print(f"  мап джерел: {maps} · показових/мокових: {shop}", file=sys.stderr)
            for item in (loose_maps + loose_shop)[:3]:
                print(f"    файлом: {item}", file=sys.stderr)
            for item in samples[:3]:
                print(f"    в оболонці: {item}", file=sys.stderr)
            die("мапи джерел віддають увесь код веба тому, хто розпакує AppImage")

        print("[пакунок] мап джерел і показових вікон немає — їде лише продукт")
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    main()
