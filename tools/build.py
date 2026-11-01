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
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'frontend', 'src')
OUT = os.path.join(ROOT, 'frontend', 'sheet.html')
OUT_EMPTY = os.path.join(ROOT, 'frontend', 'sheet-empty.html')

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


def load_css():
    """Базовый style.css + дополнения всех тем и гамм: в собранном файле
    присутствуют все варианты, поэтому пользователь может переключать их на лету."""
    with open(os.path.join(SRC, 'style.css'), encoding='utf-8') as fh:
        css = fh.read()
    seen = set()
    for tid in sorted(THEMES):
        extra = THEMES[tid]
        if not extra or extra in seen:
            continue
        seen.add(extra)
        with open(os.path.join(SRC, extra), encoding='utf-8') as fh:
            css += '\n\n/* === тема: %s === */\n' % tid + fh.read()
    for pid in sorted(PALETTES):
        extra = PALETTES[pid]
        if not extra or extra in seen:
            continue
        seen.add(extra)
        with open(os.path.join(SRC, extra), encoding='utf-8') as fh:
            css += '\n\n/* === гамма: %s === */\n' % pid + fh.read()
    return css


def load_embedded():
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
    return {'schema': 1, 'characters': chars}


def build_html(html, css, js, payload, theme='default', palette='default'):
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

    # инлайн JS
    html = html.replace('<script src="app.js"></script>',
                        '<script>\n' + js.replace('</script>', '<\\/script>') + '\n</script>')
    return html


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

    with open(os.path.join(SRC, 'index.template.html'), encoding='utf-8') as fh:
        html_tpl = fh.read()
    css = load_css()
    with open(os.path.join(SRC, 'app.js'), encoding='utf-8') as fh:
        js = fh.read()

    empty_payload = {'schema': 1, 'characters': []}
    payload = empty_payload if args.no_data else load_embedded()

    out = OUT_EMPTY if args.no_data else OUT
    html = build_html(html_tpl, css, js, payload, theme=args.theme, palette=args.palette)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    n = len(payload['characters'])
    lay = args.theme
    print(f'sheet собран: {out} ({os.path.getsize(out)} байт, персонажей встроено: {n}, '
          f'тема: {args.theme}, раскладка: {lay})')

    # за --no-data также пересобираем и обычный лист, чтобы сервер мог
    # раздавать обе страницы (sheet.html и sheet-empty.html)
    if args.no_data:
        full = build_html(html_tpl, css, js, load_embedded(), theme=args.theme, palette=args.palette)
        with open(OUT, 'w', encoding='utf-8') as fh:
            fh.write(full)
        print(f'sheet собран: {OUT} ({os.path.getsize(OUT)} байт, тема: {args.theme}, раскладка: {lay})')


if __name__ == '__main__':
    main()
