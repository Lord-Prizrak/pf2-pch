#!/usr/bin/env python3
"""Экспорт всех блоков листа персонажа в frontend/blocks.json.

Берёт разметку из frontend/src/index.template.html (единый источник HTML для
сборок sheet.html / sheet-empty.html) и описывает каждый редактируемый блок
(<fieldset>, у которого есть <legend>) в виде JSON-определения:

    { "version": 1, "blocks": [ {
        "id", "name", "tab", "column",
        "elements": [                # плоский список элементов блока
          {"kind":"section","role":"row|half|grow|grid|bigstats|stat|...","children":[...]},
          {"kind":"text","role":"caption|value","ref":"#hp-bar","dynamic":true,"html":"..."},
          {"kind":"label","text":"Имя персонажа","control":{...}},
          {"kind":"input","bind":"core.name","type":"number","size":"xs","dynamic":true},
          {"kind":"textarea","bind":"biography.backstory","rows":6},
          {"kind":"select","bind":"...","options":[{"value","label"}],"dynamic":true},
          {"kind":"button","action":"hp:-1","text":"−1"},
          {"kind":"container","ref":"languages-list","list":"chips","dynamic":true},
          {"kind":"list","ref":"skills-block","list":"items"},
          {"kind":"static","tag":"table","ref":"abilities-body","dynamic":true}
        ] } ] }

Типы kind/role/list — «словарь» системы; при нехватке типа он доказывается
здесь (rule-of-three: повторения превращаются в role/list).

Использование: python3 tools/export_blocks_json.py
"""
import json
import os
import re
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, 'frontend', 'src', 'index.template.html')
OUT = os.path.join(ROOT, 'frontend', 'blocks.json')


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []      # Node | ('text', str)
        self.parent = parent

    def cls(self):
        return self.attrs.get('class', '').split()

    def has_cls(self, *names):
        c = self.cls()
        return any(n in c for n in names)

    def text(self):
        parts = []
        for ch in self.children:
            if isinstance(ch, tuple):
                parts.append(ch[1])
            else:
                parts.append(ch.text())
        return ''.join(parts).strip()

    def find_all(self, pred):
        res = []
        for ch in self.children:
            if isinstance(ch, tuple):
                continue
            if pred(ch):
                res.append(ch)
            res.extend(ch.find_all(pred))
        return res


VOID = {'input', 'br', 'img', 'hr'}


class SheetParser(HTMLParser):
    """Парсит шаблон; сохраняет только содержимое <main id="main">."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root', {}, None)
        self.stack = [self.root]
        self.in_main = False
        self.depth_after_main = 0

    def handle_starttag(self, tag, attrs):
        if not self.in_main:
            a = dict(attrs)
            if tag == 'main' and a.get('id') == 'main':
                self.in_main = True
                node = Node(tag, attrs, self.stack[-1])
                self.stack[-1].children.append(node)
                self.stack.append(node)
            return
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        if self.in_main:
            self.stack[-1].children.append(Node(tag, attrs, self.stack[-1]))

    def handle_endtag(self, tag):
        if not self.in_main:
            return
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        if self.in_main and self.stack:
            txt = data
            if txt.strip():
                self.stack[-1].children.append(('text', txt))


def get_bind(inp):
    return inp.attrs.get('data-bind') or ''


def size_class(node):
    for c in node.cls():
        if c in ('xs', 's', 'm'):
            return c
    return None


def is_dynamic(node):
    """True, если содержимое элемента вычисляется JS (данные персонажа),
    т.е. в режиме «только дизайн» элемент пустой/обнулённый."""
    if 'data-dkey' in node.attrs:
        return True
    nid = node.attrs.get('id', '')
    if re.match(r'^(inv-|srv-)', nid):
        return True
    return nid in DYNAMIC_IDS


DYNAMIC_IDS = {
    'languages-list', 'hero-points', 'abilities-body', 'ability-cards',
    'ac-total', 'classdc-total', 'perc-total', 'armor-block', 'saves-block',
    'skills-block', 'perception-prof', 'strikes-block', 'weapon-prof-block',
    'hp-bar-wrap', 'hp-text', 'dying-val', 'wounded-val', 'hp-big-cur',
    'hp-big-max', 'shield-big', 'shield-big-max', 'hps-quick',
    'combat-summary', 'spellcasting-block', 'feats-block', 'actions-block',
    'server-list', 'srv-auth', 'srv-chars', 'json-editor', 'block-vis-list',
}

DIV_ROLES = {'row', 'hp-controls', 'bigstats', 'stat', 'hps-row', 'hp-stat',
             'shield-stat', 'abil-table', 'lang-list', 'lang-items', 'lang-add',
             'grid3', 'bio-grid', 'srv-layout', 'srv-left', 'srv-right'}

LIST_KINDS = {
    'languages-list': 'chips',
    'skills-block': 'items',
    'strikes-block': 'items',
    'spellcasting-block': 'items',
    'feats-block': 'items',
    'actions-block': 'items',
    'weapon-prof-block': 'checkbox-grid',
    'armor-block': 'armor',
    'saves-block': 'saves',
    'abilities-body': 'table-rows',
    'ability-cards': 'cards',
    'inv-worn': 'inventory', 'inv-held': 'inventory',
    'inv-consumables': 'inventory', 'inv-other': 'inventory',
    'server-list': 'servers', 'srv-auth': 'auth-form', 'srv-chars': 'chars',
    'hp-bar-wrap': 'bar', 'hps-quick': 'buttons', 'combat-summary': 'summary',
    'perception-prof': 'badge', 'hero-points': 'chips',
}


ACTIONS = {
    'srv-add': 'server:add', 'exp-json-clipboard': 'export:json-clipboard',
    'exp-json-file': 'export:json-file', 'exp-html': 'export:html',
    'exp-all-json': 'export:all-json', 'exp-all-html': 'export:all-html',
    'imp-json-clipboard': 'import:json-clipboard',
    'imp-json-file-btn': 'import:json-file', 'imp-html-btn': 'import:html',
    'imp-pdf-btn': 'import:pdf', 'push-server': 'server:push',
    'pull-server': 'server:pull', 'json-apply': 'json:apply',
    'json-refresh': 'json:refresh', 'btn-new-char': 'char:new',
    'btn-del-char': 'char:delete',
}


def control_of(node):
    tag = node.tag
    if tag == 'input':
        t = node.attrs.get('type', 'text')
        ctl = {'kind': 'button' if t in ('button', 'submit') else 'input',
               'type': t}
        if get_bind(node):
            ctl['bind'] = get_bind(node)
        sz = size_class(node)
        if sz:
            ctl['size'] = sz
        elif node.attrs.get('size'):
            ctl['attrSize'] = int(node.attrs['size'])
        if node.attrs.get('placeholder'):
            ctl['placeholder'] = node.attrs['placeholder']
        if 'data-hp' in node.attrs:
            ctl['action'] = 'hp:' + node.attrs['data-hp']
        if node.attrs.get('id'):
            aid = node.attrs['id']
            ctl['id'] = aid
            if aid in ACTIONS:
                ctl['action'] = ACTIONS[aid]
        return ctl
    if tag == 'textarea':
        ctl = {'kind': 'textarea', 'rows': int(node.attrs.get('rows', 2))}
        if get_bind(node):
            ctl['bind'] = get_bind(node)
        if node.attrs.get('id'):
            ctl['id'] = node.attrs['id']
        if node.attrs.get('spellcheck') == 'false':
            ctl['spellcheck'] = False
        return ctl
    if tag == 'select':
        opts = [{'value': o.attrs.get('value', ''), 'label': o.text()}
                for o in node.find_all(lambda n: n.tag == 'option')]
        ctl = {'kind': 'select', 'options': opts}
        if get_bind(node):
            ctl['bind'] = get_bind(node)
        return ctl
    if tag == 'button':
        ctl = {'kind': 'button', 'type': node.attrs.get('type', 'button'),
               'text': node.text()}
        if 'data-hp' in node.attrs:
            ctl['action'] = 'hp:' + node.attrs['data-hp']
        if node.attrs.get('id'):
            aid = node.attrs['id']
            ctl['id'] = aid
            if aid in ACTIONS:
                ctl['action'] = ACTIONS[aid]
        return ctl
    return None


def el_role(node):
    cls = node.cls()
    for r in ('row', 'hp-controls', 'bigstats', 'stat', 'hps-row',
              'hp-stat', 'shield-stat', 'hps-quick', 'abil-table',
              'lang-list', 'lang-items', 'lang-add', 'grid3', 'bio-grid',
              'srv-layout', 'srv-left', 'srv-right', 'server-list',
              'srv-chars', 'block-vis-list', 'combat-strip', 'sheet-area',
              'sheet-grid', 'hint'):
        if r in cls:
            return r
    return None


def walk_children(node, out):
    for ch in node.children:
        if isinstance(ch, tuple):
            continue
        emit_node(ch, out)


def emit_node(node, out):
    tag = node.tag
    if tag == 'label':
        ctl = None
        for ch in node.children:
            if not isinstance(ch, tuple) and ch.tag in ('input', 'textarea', 'select'):
                ctl = control_of(ch)
        label_text = node.text()
        if ctl:
            stripped = (ctl.get('placeholder') or '')
            lbl = re.sub(r'\s+', ' ', label_text.replace(stripped, '')).strip()
            e = {'kind': 'label', 'text': lbl, 'control': ctl}
        else:
            e = {'kind': 'text', 'role': 'caption', 'html': label_text}
        if node.has_cls('grow'):
            e['role'] = 'grow'
        if node.has_cls('half'):
            e['role'] = 'half'
        if ctl and (ctl.get('bind') or is_dynamic(node)):
            e['dynamic'] = True
        out.append(e)
        return
    if tag in ('input', 'textarea', 'select', 'button'):
        e = control_of(node)
        if not e.get('bind') and not e.get('action') and e.get('id'):
            e['action'] = 'input:' + e['id']
        if e.get('bind') or is_dynamic(node):
            e['dynamic'] = True
        out.append(e)
        return
    if tag == 'span':
        nid = node.attrs.get('id', '')
        if nid in LIST_KINDS:
            e = {'kind': 'container', 'ref': nid, 'list': LIST_KINDS[nid]}
            if is_dynamic(node):
                e['dynamic'] = True
            out.append(e)
            return
        kids = []
        walk_children(node, kids)
        e = {'kind': 'text', 'role': 'value' if nid else 'inline',
             'html': node.text()}
        if nid:
            e['ref'] = nid
        if kids:
            e['children'] = kids
        if is_dynamic(node):
            e['dynamic'] = True
        out.append(e)
        return
    if tag in ('b', 'strong', 'small', 'em'):
        e = {'kind': 'text', 'role': 'value', 'html': node.text()}
        if node.attrs.get('id'):
            e['ref'] = node.attrs['id']
        if is_dynamic(node):
            e['dynamic'] = True
        out.append(e)
        return
    if tag == 'div':
        nid = node.attrs.get('id', '')
        if nid in LIST_KINDS:
            e = {'kind': 'list', 'ref': nid, 'list': LIST_KINDS[nid]}
            if is_dynamic(node):
                e['dynamic'] = True
            out.append(e)
            return
        children = []
        walk_children(node, children)
        if not children:
            return
        cls = node.cls()
        if any(c in DIV_ROLES for c in cls):
            e = {'kind': 'container', 'role': el_role(node), 'children': children}
        else:
            e = {'kind': 'section', 'children': children}
            role = el_role(node)
            if role:
                e['role'] = role
        if nid:
            e['ref'] = nid
        out.append(e)
        return
    if tag == 'fieldset':
        children = []
        walk_children(node, children)
        e = {'kind': 'section', 'children': children}
        if node.attrs.get('id'):
            e['domId'] = node.attrs['id']
        out.append(e)
        return
    if tag == 'table':
        body_rows = []
        thead = node.find_all(lambda n: n.tag == 'thead')
        headers = []
        if thead:
            headers = [th.text() for th in thead[0].find_all(lambda n: n.tag == 'th')]
        tbodies = node.find_all(lambda n: n.tag == 'tbody')
        static_rows = []
        if tbodies:
            for tr in tbodies[0].find_all(lambda n: n.tag == 'tr'):
                cells = [td.text() for td in tr.find_all(lambda n: n.tag == 'td')]
                if cells:
                    static_rows.append(cells)
        e = {'kind': 'static', 'tag': 'table',
             'headers': headers, 'columns': len(headers)}
        if tbodies and tbodies[0].attrs.get('id'):
            e['ref'] = tbodies[0].attrs['id']
            e['list'] = 'table-rows'
        if static_rows:
            e['rows'] = static_rows
        if is_dynamic(node):
            e['dynamic'] = True
        out.append(e)
        return
    if tag == 'p':
        e = {'kind': 'text', 'role': 'paragraph', 'html': node.text()}
        if node.attrs.get('id'):
            e['ref'] = node.attrs['id']
        if is_dynamic(node):
            e['dynamic'] = True
        out.append(e)
        return
    if tag in ('br', 'hr'):
        return
    # прочие контейнеры (div без id и т.п.)
    children = []
    walk_children(node, children)
    if children:
        e = {'kind': 'section', 'children': children}
        role = el_role(node)
        if role:
            e['role'] = role
        if node.attrs.get('id'):
            e['ref'] = node.attrs['id']
        if is_dynamic(node):
            e['dynamic'] = True
        out.append(e)


def slug(name, used):
    norm = re.sub(r'\s+', ' ', name.lower()).strip()
    norm = norm.replace('/', ' / ')
    s = ASCII_SLUG.get(norm) or norm.replace(' ', '-').replace('/', '-')
    # дефисы в слагe разрешены только как разделители: схлопываем серии,
    # затем удаляем прочие символы иLeading/trailing дефисы убираем
    s = re.sub(r'-{2,}', '-', s)
    s = re.sub(r'[^a-z0-9\-]', '', s)
    s = s.strip('-')
    if not s:
        s = 'block'
    base = s
    i = 2
    while s in used:
        s = base + '-' + str(i)
        i += 1
    used.add(s)
    return s


ASCII_SLUG = {
    'основное': 'main', 'характеристики': 'abilities', 'защиты': 'defense',
    'пункты здоровья': 'hp', 'навыки': 'skills', 'удары': 'strikes',
    'профичности оружия': 'weapon-prof', 'пз и щит': 'hp-shield',
    'бой': 'combat', 'магия': 'magic', 'черты и умения': 'feats',
    'действия': 'actions', 'богатство': 'coins',
    'надето / носится': 'inv-worn', 'в руках': 'inv-held',
    'расходники': 'inv-consumables', 'прочее': 'inv-other',
    'примечания инвентаря': 'inv-notes', 'происхождение': 'origin',
    'личность': 'personality', 'история и мир': 'history',
    'серверы': 'servers', 'подключение (логин / api-ключ)': 'srv-auth',
    'персонажи на сервере': 'srv-chars', 'экспорт': 'export',
    'импорт': 'import', 'сервер': 'io-server',
    'json данных текущего персонажа': 'json-data', 'блоки': 'blockvis',
}


def main():
    with open(TPL, encoding='utf-8') as fh:
        src = fh.read()
    parser = SheetParser()
    parser.feed(src)
    main_node = parser.root.find_all(lambda n: n.tag == 'main')[0]

    blocks = []
    used = set()
    cur_tab = None
    cur_col = None

    def visit(node):
        nonlocal cur_tab, cur_col
        for ch in node.children:
            if isinstance(ch, tuple):
                continue
            if ch.tag == 'section' and 'tabpage' in ch.cls():
                cur_tab = ch.attrs.get('id', '').replace('tab-', '')
                cur_col = None
                visit(ch)
                cur_tab_orig = cur_tab
                cur_tab = None
                _ = cur_tab_orig
                continue
            if ch.tag == 'div' and ch.attrs.get('data-col'):
                cur_col = ch.attrs['data-col']
                visit(ch)
                cur_col = None
                continue
            if ch.tag == 'fieldset':
                legends = ch.find_all(lambda n: n.tag == 'legend')
                name = legends[0].text() if legends else '(без названия)'
                elements = []
                for sub in ch.children:
                    if isinstance(sub, tuple):
                        continue
                    if sub.tag == 'legend':
                        continue
                    emit_node(sub, elements)
                fid = ch.attrs.get('id', '')
                bid = slug(name, used)
                blocks.append({
                    'id': bid,
                    'name': name,
                    'legend': name,
                    'domId': fid or None,
                    'tab': cur_tab,
                    'column': cur_col,
                    'elements': elements,
                })
                continue
            visit(ch)

    visit(main_node)

    doc = {'version': 1, 'source': 'frontend/src/index.template.html',
           'generator': 'tools/export_blocks_json.py', 'blocks': blocks}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=1)
    n_fields = sum(1 for b in blocks for e in b['elements'])
    print(f'blocks.json: {len(blocks)} блоков, {n_fields} корневых элементов -> {OUT}')


if __name__ == '__main__':
    main()
