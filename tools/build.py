#!/usr/bin/env python3
"""
Сборка автономного интерактивного листа персонажа PF2e.

Результат: frontend/sheet.html — один HTML-файл, содержащий стили, скрипт
и встроенные JSON-данные персонажей (из ../sheets/*.json). Файл работает
как по http(s), так и с file://.

Использование:
    python3 tools/build.py            # собрать frontend/sheet.html
    python3 tools/build.py --no-data  # без встроенных персонажей
"""
import argparse
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'frontend', 'src')
OUT = os.path.join(ROOT, 'frontend', 'sheet.html')
OUT_EMPTY = os.path.join(ROOT, 'frontend', 'sheet-empty.html')


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


def build_html(html, css, js, payload):
    # инлайн CSS
    html = html.replace('<link rel="stylesheet" href="style.css">',
                        '<style>\n' + css.replace('</style>', '<\\/style>') + '\n</style>')

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
    args = ap.parse_args()

    with open(os.path.join(SRC, 'index.template.html'), encoding='utf-8') as fh:
        html_tpl = fh.read()
    with open(os.path.join(SRC, 'style.css'), encoding='utf-8') as fh:
        css = fh.read()
    with open(os.path.join(SRC, 'app.js'), encoding='utf-8') as fh:
        js = fh.read()

    empty_payload = {'schema': 1, 'characters': []}
    payload = empty_payload if args.no_data else load_embedded()

    out = OUT_EMPTY if args.no_data else OUT
    html = build_html(html_tpl, css, js, payload)
    with open(out, 'w', encoding='utf-8') as fh:
        fh.write(html)
    n = len(payload['characters'])
    print(f'sheet собран: {out} ({os.path.getsize(out)} байт, персонажей встроено: {n})')

    # за --no-data также пересобираем и обычный лист, чтобы сервер мог
    # раздавать обе страницы (sheet.html и sheet-empty.html)
    if args.no_data:
        full = build_html(html_tpl, css, js, load_embedded())
        with open(OUT, 'w', encoding='utf-8') as fh:
            fh.write(full)
        print(f'sheet собран: {OUT} ({os.path.getsize(OUT)} байт)')


if __name__ == '__main__':
    main()
