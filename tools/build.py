#!/usr/bin/env python3
"""
Сборка автономного интерактивного листа персонажа PF2e.

Результат: frontend/sheet.html — один HTML-файл, содержащий стили, скрипт
и встроенные JSON-данные персонажей (из ../sheets/*.json). Файл работает
как по http(s), так и с file://.

Использование:
    python3 tools/build.py                     # собрать frontend/sheet.html (тема default)
    python3 tools/build.py --no-data           # без встроенных персонажей
    python3 tools/build.py --theme official    # вариант оформления: официальный лист Paizo
    python3 tools/build.py --theme sanych      # в стиле листа существующего персонажа (Саныч)
    python3 tools/build.py --theme dark        # тёмный «VTT»-вариант из интернета
    python3 tools/build.py --list-themes       # показать доступные темы
"""
import argparse
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'frontend', 'src')
OUT = os.path.join(ROOT, 'frontend', 'sheet.html')
OUT_EMPTY = os.path.join(ROOT, 'frontend', 'sheet-empty.html')

# id темы -> имя файла CSS-дополнения в frontend/src (default — только style.css)
THEMES = {
    'default': None,
    'official': 'theme-official.css',   # официальный Character Sheet Paizo
    'sanych': 'theme-sanych.css',       # лист существующего персонажа (Саныч.pdf)
    'dark': 'theme-dark.css',           # фанатский тёмный лист из интернета
}


def load_css():
    """Базовый style.css + дополнения всех тем: в собранном файле присутствуют
    все варианты, поэтому пользователь может переключать тему на лету."""
    with open(os.path.join(SRC, 'style.css'), encoding='utf-8') as fh:
        css = fh.read()
    for tid in sorted(THEMES):
        extra = THEMES[tid]
        if not extra:
            continue
        with open(os.path.join(SRC, extra), encoding='utf-8') as fh:
            css += '\n\n/* === тема: %s === */\n' % tid + fh.read()
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


def build_html(html, css, js, payload, theme='default', layout=None):
    # инлайн CSS: все темы присутствуют в файле — переключение возможно на лету;
    # --theme задаёт тему сборки (класс на <body> и __PF2E_BUILD_THEME__),
    # --layout — раскладку (по умолчанию совпадает с темой)
    layout = layout or theme
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        '<style>\n' + css.replace('</style>', '<\\/style>') + '\n</style>')

    # тема сборки: значение для JS и класс на <body> (для default — без класса)
    html = html.replace("'__PF2E_THEME__'", json.dumps(theme))
    html = html.replace("'__PF2E_LAYOUT__'", json.dumps(layout))
    body_cls = ' class="theme-%s"' % theme if theme != 'default' else ''
    html = html.replace('<body class="theme-__PF2E_THEME_BODY__">', '<body%s>' % body_cls)

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
                    help='вариант оформления листа: цвета + расположение блоков (по умолчанию default)')
    ap.add_argument('--layout', choices=sorted(THEMES), default=None,
                    help='раскладка (расположение блоков); по умолчанию = --theme. '
                         'Напр.: --theme dark --layout official — цвета тёмные, структура официальная')
    ap.add_argument('--list-themes', action='store_true',
                    help='показать доступные темы и выйти')
    args = ap.parse_args()

    if args.list_themes:
        for tid in sorted(THEMES):
            print(f'{tid}: {THEMES[tid] or "style.css (базовая тема)"}')
        return

    with open(os.path.join(SRC, 'index.template.html'), encoding='utf-8') as fh:
        html_tpl = fh.read()
    css = load_css()
    with open(os.path.join(SRC, 'app.js'), encoding='utf-8') as fh:
        js = fh.read()

    empty_payload = {'schema': 1, 'characters': []}
    payload = empty_payload if args.no_data else load_embedded()

    out = OUT_EMPTY if args.no_data else OUT
    html = build_html(html_tpl, css, js, payload, theme=args.theme, layout=args.layout)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    n = len(payload['characters'])
    lay = args.layout or args.theme
    print(f'sheet собран: {out} ({os.path.getsize(out)} байт, персонажей встроено: {n}, '
          f'тема: {args.theme}, раскладка: {lay})')

    # за --no-data также пересобираем и обычный лист, чтобы сервер мог
    # раздавать обе страницы (sheet.html и sheet-empty.html)
    if args.no_data:
        full = build_html(html_tpl, css, js, load_embedded(), theme=args.theme, layout=args.layout)
        with open(OUT, 'w', encoding='utf-8') as fh:
            fh.write(full)
        print(f'sheet собран: {OUT} ({os.path.getsize(OUT)} байт, тема: {args.theme}, раскладка: {lay})')


if __name__ == '__main__':
    main()
