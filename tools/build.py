#!/usr/bin/env python3
"""
Сборка автономного интерактивного листа персонажа PF2e.

Результат: frontend/sheet.html — один HTML-файл, содержащий стили, скрипт
и встроенные JSON-данные персонажей (из ../sheets/*.json). Файл работает
как по http(s), так и с file://.

Использование:
    python3 tools/build.py                     # собрать frontend/sheet.html (тема default)
    python3 tools/build.py --no-data           # без встроенных персонажей
    python3 tools/build.py --theme official    # раскладка: официальный лист Paizo
    python3 tools/build.py --theme sanych      # раскладка: лист существующего персонажа (Саныч)
    python3 tools/build.py --theme dark        # раскладка: тёмный «VTT»-вариант из интернета
    python3 tools/build.py --palette dark      # цветовая гамма (независимо от раскладки)
    python3 tools/build.py --theme default --palette sanych   # сетка классическая, цвета Саныча
    python3 tools/build.py --list-themes       # показать доступные темы и гаммы
"""
import argparse
import collections
import json
import os
import re
import subprocess
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'frontend', 'src')
OUT = os.path.join(ROOT, 'frontend', 'sheet.html')
OUT_EMPTY = os.path.join(ROOT, 'frontend', 'sheet-empty.html')
BLOCKS_JSON = os.path.join(ROOT, 'frontend', 'blocks.json')


def human_size(n):
    """Человекочитаемый размер: 256 КБ / 1.5 МБ."""
    if n >= 1024 * 1024:
        return '%.2f МБ' % (n / 1024.0 / 1024.0)
    if n >= 1024:
        return '%d КБ' % (n // 1024)
    return '%d Б' % n


class Stats:
    """Сбор статистики по этапам сборки."""

    def __init__(self):
        self.t0 = time.time()
        self.stages = []          # [(имя, длительность_сек)]
        self.components = {}      # имя -> (байт, доп.описание)
        self.block_stats = None   # (кол-во блоков, поля, списки, вкладки)
        self.char_names = []

    def stage(self, name, dur):
        self.stages.append((name, dur))

    def component(self, name, nbytes, note=''):
        self.components[name] = (nbytes, note)

    def report(self, out_path, theme, palette, with_data):
        total = time.time() - self.t0
        size = os.path.getsize(out_path)
        print('\n=== Статистика сборки ===')
        print('Результат : %s (%s)' % (os.path.relpath(out_path, ROOT), human_size(size)))
        print('Конфигурация: раскладка=%s, гамма=%s, данные персонажей: %s'
              % (theme, palette, 'встроены' if with_data else 'нет (--no-data)'))
        print('-- Компоненты встроенного файла --')
        for name in sorted(self.components, key=lambda k: -self.components[k][0]):
            b, note = self.components[name]
            print('  %-22s %8s  %s' % (name, human_size(b), note))
        if self.block_stats:
            nb, nf, nl, tabs = self.block_stats
            print('-- Блоки (blocks.json) --')
            print('  блоков: %d | полей с data-bind: %d | динамических списков: %d'
                  % (nb, nf, nl))
            print('  вкладки: ' + ', '.join('%s(%d)' % (t, c) for t, c in sorted(tabs.items())))
        if self.char_names:
            print('  персонажи встроены: ' + ', '.join(self.char_names))
        print('-- Этапы --')
        for nm, dur in self.stages:
            print('  %-22s %6.3f с' % (nm, dur))
        print('Итого времени: %.3f с' % total)

# id темы -> имя файла CSS-дополнения в frontend/src (default — только style.css).
# ТЕМА отвечает ТОЛЬКО за расположение блоков (раскладку).
THEMES = {
    'default': None,
    'official': 'theme-official.css',   # официальный Character Sheet Paizo
    'sanych': 'theme-sanych.css',       # лист существующего персонажа (Саныч.pdf)
    'dark': 'theme-dark.css',           # фанатский тёмный лист из интернета
}

# id гаммы -> файл CSS с цветами/шрифтами (гамма независима от темы-раскладки).
PALETTES = {
    'default': None,                    # пергамент из style.css
    'official': 'palette-official.css',
    'sanych': 'palette-sanych.css',     # ночная зелёная (Саныч.pdf)
    'dark': 'palette-dark.css',         # почти чёрный с янтарём
}


def load_css(stats=None):
    """Базовый style.css + дополнения всех тем и гамм: в собранном файле
    присутствуют все варианты, поэтому пользователь может переключать их на лету."""
    with open(os.path.join(SRC, 'style.css'), encoding='utf-8') as fh:
        css = fh.read()
    if stats:
        stats.component('CSS (базовый)', len(css.encode()), 'style.css')
    seen = set()
    extras = []
    for tid in sorted(THEMES):
        extra = THEMES[tid]
        if not extra or extra in seen:
            continue
        seen.add(extra)
        with open(os.path.join(SRC, extra), encoding='utf-8') as fh:
            css += '\n\n/* === тема: %s === */\n' % tid + fh.read()
        extras.append(extra)
    pal_extras = []
    for pid in sorted(PALETTES):
        extra = PALETTES[pid]
        if not extra or extra in seen:
            continue
        seen.add(extra)
        with open(os.path.join(SRC, extra), encoding='utf-8') as fh:
            css += '\n\n/* === гамма: %s === */\n' % pid + fh.read()
        pal_extras.append(extra)
    if stats:
        stats.component('CSS (всего)', len(css.encode()),
                        'базовый + %d тем(-ы) + %d гамм(-ы)' % (len(extras), len(pal_extras)))
    return css


def load_embedded(stats=None):
    sheets_dir = os.path.join(ROOT, 'sheets')
    chars = []
    if os.path.isdir(sheets_dir):
        for fn in sorted(os.listdir(sheets_dir)):
            if fn.endswith('.json'):
                with open(os.path.join(sheets_dir, fn), encoding='utf-8') as fh:
                    data = json.load(fh)
                if isinstance(data, dict) and data.get('name'):
                    chars.append(data)
                elif isinstance(data, list):
                    chars.extend(data)
    if stats:
        stats.char_names = [c.get('name', '?') for c in chars]
    return {'schema': 1, 'characters': chars}


def analyze_blocks(stats):
    """Статистика по blocks.json: блоки, поля, списки, вкладки."""
    if not os.path.exists(BLOCKS_JSON):
        return None
    with open(BLOCKS_JSON, encoding='utf-8') as fh:
        raw = fh.read()
    try:
        doc = json.loads(raw)
    except ValueError:
        print('ВНИМАНИЕ: blocks.json повреждён (невалидный JSON)!')
        return None
    blocks = doc.get('blocks', []) if isinstance(doc, dict) else doc

    n_fields = n_lists = 0
    tabs = collections.Counter()

    def walk(node):
        nonlocal n_fields, n_lists
        if isinstance(node, dict):
            if node.get('bind') or node.get('dataBind'):
                n_fields += 1
            # динамические списки: узел с list (chip-list / item-list) или kind
            if 'list' in node or node.get('kind') in ('chip-list', 'item-list') \
               or node.get('type') in ('chip-list', 'item-list'):
                n_lists += 1
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for b in blocks:
        tabs[b.get('tab', '?')] += 1
        walk(b)
    stats.component('blocks.json', len(raw.encode()), '%d блоков' % len(blocks))
    stats.block_stats = (len(blocks), n_fields, n_lists, tabs)
    return blocks


def load_fields_js(stats=None):
    """Web-компоненты полей из frontend/src/fields/*.js (алфавитном порядке).
    Возвращает склеенный JS и список имён файлов."""
    fdir = os.path.join(SRC, 'fields')
    parts, names = [], []
    if os.path.isdir(fdir):
        for fn in sorted(os.listdir(fdir)):
            if fn.endswith('.js'):
                with open(os.path.join(fdir, fn), encoding='utf-8') as fh:
                    parts.append(fh.read().strip())
                names.append(fn)
    js = '\n'.join(parts)
    if stats and names:
        stats.component('Web-компоненты (fields/)', len(js.encode()),
                        '%d шт: %s' % (len(names), ', '.join(names)))
    return js, names


def check_js_all(stats, tmp_path):
    """Синтаксическая проверка объединённого JS (fields + app.js)."""
    if not shutil_which('node'):
        print('node не найден — синтаксис JS не проверен')
        return True
    t = time.time()
    r = subprocess.run(['node', '--check', tmp_path], capture_output=True, text=True)
    stats.stage('Проверка JS', time.time() - t)
    if r.returncode != 0:
        print('ОШИБКА синтаксиса JS:\n' + r.stderr)
        return False
    print('JS синтаксис (fields + app.js): ОК')
    return True


def check_js(stats):
    """Синтаксическая проверка app.js через node --check (если node доступен)."""
    js_path = os.path.join(SRC, 'app.js')
    if not shutil_which('node'):
        print('node не найден — синтаксис app.js не проверен')
        return True
    t = time.time()
    r = subprocess.run(['node', '--check', js_path], capture_output=True, text=True)
    stats.stage('Проверка JS', time.time() - t)
    if r.returncode != 0:
        print('ОШИБКА синтаксиса app.js:\n' + r.stderr)
        return False
    print('JS синтаксис app.js: ОК')
    return True


def shutil_which(name):
    from shutil import which
    return which(name)


def build_html(html, css, js, payload, theme='default', palette='default', stats=None):
    # инлайн CSS: все темы/гаммы присутствуют в файле — переключение на лету;
    # --theme — раскладка сборки (класс theme-* на <body>),
    # --palette — цветовая гамма (класс pal-*)
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        '<style>\n' + css.replace('</style>', '<\\/style>') + '\n</style>')

    # значения для JS: BUILD_THEME = раскладка (LAY_OUT больше не отдельный параметр)
    html = html.replace("'__PF2E_THEME__'", json.dumps(theme))
    html = html.replace("'__PF2E_PALETTE__'", json.dumps(palette))
    body_cls = ('%s %s' % (
        'theme-' + theme if theme != 'default' else '',
        'pal-' + palette if palette != 'default' else '')).strip()
    html = html.replace('<body class="theme-__PF2E_THEME_BODY__ pal-__PF2E_PALETTE_BODY__">',
                        '<body%s>' % (' class="%s"' % body_cls if body_cls else ''))

    # встроенные данные
    payload_txt = json.dumps(payload, ensure_ascii=False, indent=1).replace('</', '<\\/')
    block = ('<!-- PF2E-SHEET-DATA:START -->\n'
             '<script id="pf2e-embedded-data" type="application/json">\n'
             + payload_txt +
             '\n</script>\n<!-- PF2E-SHEET-DATA:END -->')
    html = re.sub(r'<!-- PF2E-SHEET-DATA:START -->[\s\S]*?<!-- PF2E-SHEET-DATA:END -->',
                  lambda m: block, html)

    # описание блоков (blocks.json) инлайном — работает и при file://
    blocks_path = os.path.join(ROOT, 'frontend', 'blocks.json')
    if os.path.exists(blocks_path):
        with open(blocks_path, encoding='utf-8') as fh:
            blocks_txt = fh.read().strip().replace('</', '<\\/')
        blocks_script = ('<script id="pf2e-blocks-json" type="application/json">\n'
                         + blocks_txt + '\n</script>')
        html = re.sub(r'<script id="pf2e-blocks-json"[^>]*>[\s\S]*?</script>',
                      lambda m: blocks_script, html)
        if 'pf2e-blocks-json' not in html:
            html = html.replace('<script src="app.js"></script>',
                                blocks_script + '\n<script src="app.js"></script>')

    # инлайн JS
    html = html.replace('<script src="app.js"></script>',
                        '<script>\n' + js.replace('</script>', '<\\/script>') + '\n</script>')

    if stats is not None:
        stats.component('Данные персонажей', len(payload_txt.encode()),
                        '%d персонаж(ей)' % len(payload.get('characters', [])))
        stats.component('JS (app.js)', len(js.encode()),
                        '%d строк' % js.count('\n'))
        stats.component('HTML-каркас', len(html_tpl_size[0].encode()) if html_tpl_size else 0,
                        'index.template.html')
    return html


html_tpl_size = [None]  # размер шаблона для статистики (заполняется в main)


def emit(out, html, stats, theme, palette, with_data):
    t = time.time()
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    stats.stage('Запись файла', time.time() - t)
    print('Собрано: %s (%s, %d КБ)' % (os.path.relpath(out, ROOT),
                                        os.path.basename(out),
                                        os.path.getsize(out) // 1024))
    stats.report(out, theme, palette, with_data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-data', action='store_true')
    ap.add_argument('--theme', choices=sorted(THEMES), default='default',
                    help='тема = РАСКЛАДКА (расположение блоков); по умолчанию default')
    ap.add_argument('--palette', choices=sorted(PALETTES), default='default',
                    help='цветовая гамма (цвета/шрифты), независима от темы. '
                         'Напр.: --theme official --palette dark — структура Paizo, тёмные цвета')
    ap.add_argument('--list-themes', action='store_true',
                    help='показать доступные темы-раскладки и гаммы и выйти')
    args = ap.parse_args()

    if args.list_themes:
        print('Темы (расположение блоков):')
        for tid in sorted(THEMES):
            print(f'  {tid}: {THEMES[tid] or "style.css (базовая раскладка)"}')
        print('Гаммы (цвета/шрифты):')
        for pid in sorted(PALETTES):
            print(f'  {pid}: {PALETTES[pid] or "style.css (классический пергамент)"}')
        return

    stats = Stats()

    # --- Чтение исходников ---
    t = time.time()
    with open(os.path.join(SRC, 'index.template.html'), encoding='utf-8') as fh:
        html_tpl = fh.read()
    html_tpl_size[0] = html_tpl
    js = open(os.path.join(SRC, 'app.js'), encoding='utf-8').read()
    stats.stage('Чтение исходников', time.time() - t)
    print('[1/5] Исходники прочитаны: шаблон %s строк, app.js %s строк'
          % (html_tpl.count('\n'), js.count('\n')))

    # --- Web-компоненты полей (frontend/src/fields/*.js) ---
    fields_js, field_names = load_fields_js(stats)

    # --- Проверка синтаксиса JS (fields + app.js единым куском) ---
    print('[2/5] Проверка синтаксиса...')
    if field_names:
        print('      web-компоненты полей: %d файл(ов): %s'
              % (len(field_names), ', '.join(field_names)))
    tmp_js = os.path.join(ROOT, 'frontend', '.build-check.js')
    with open(tmp_js, 'w', encoding='utf-8') as fh:
        fh.write(fields_js + '\n' + js)
    ok = check_js_all(stats, tmp_js)
    try:
        os.remove(tmp_js)
    except OSError:
        pass
    if not ok:
        raise SystemExit(1)
    js = fields_js + '\n' + js   # компоненты регистрируются до запуска приложения
    analyze_blocks(stats)
    if stats.block_stats:
        nb, nf, nl, tabs = stats.block_stats
        print('      blocks.json: %d блоков, %d полей, %d динамических списков' % (nb, nf, nl))

    # --- CSS ---
    t = time.time()
    css = load_css(stats)
    stats.stage('Сборка CSS', time.time() - t)
    print('[3/5] CSS собран: %s (%d тем + %d гамм встроено)'
          % (human_size(len(css.encode())), len(THEMES), len(PALETTES)))

    # --- Данные персонажей ---
    empty_payload = {'schema': 1, 'characters': []}
    payload = empty_payload if args.no_data else load_embedded(stats)
    n = len(payload['characters'])
    print('[4/5] Данные: %s' % ('без персонажей (--no-data)' if args.no_data
                                else 'встроено персонажей: %d (%s)'
                                     % (n, ', '.join(stats.char_names) or '—')))

    # --- Сборка и запись ---
    print('[5/5] Сборка HTML...')
    out = OUT_EMPTY if args.no_data else OUT
    t = time.time()
    html = build_html(html_tpl, css, js, payload, theme=args.theme,
                      palette=args.palette, stats=stats)
    stats.stage('Подстановка компонентов', time.time() - t)
    emit(out, html, stats, args.theme, args.palette, not args.no_data)

    # за --no-data также пересобираем и обычный лист, чтобы сервер мог
    # раздавать обе страницы (sheet.html и sheet-empty.html)
    if args.no_data:
        full = build_html(html_tpl, css, js, load_embedded(), theme=args.theme,
                          palette=args.palette)
        with open(OUT, 'w', encoding='utf-8') as fh:
            fh.write(full)
        print('Дополнительно пересобран: %s (%s)'
              % (os.path.relpath(OUT, ROOT), human_size(os.path.getsize(OUT))))


if __name__ == '__main__':
    main()
