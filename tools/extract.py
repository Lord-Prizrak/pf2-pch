#!/usr/bin/env python3
"""
Извлечение данных персонажа PF2e из заполненного листа (PDF с форм-полями)
в канонический JSON-формат (schema v1).

Использование:
    python3 tools/extract_pdf.py "Саныч.pdf" -o sheets/sanych.json

Также поддерживается извлечение из xlsx-листа
(PF2E Easy Character Sheet):
    python3 tools/extract_pdf.py --xlsx "PF2E Easy Character Sheet v1.1.xlsx" -o out.json
"""
import argparse
import json
import re
import sys

from pypdf import PdfReader

SKILLS = [
    ('acrobatics', 'Акробатика', 'dex'),
    ('arcana', 'Аркана', 'int'),
    ('athletics', 'Атлетика', 'str'),
    ('crafting', 'Ремесло', 'int'),
    ('deception', 'Обман', 'cha'),
    ('diplomacy', 'Дипломатия', 'cha'),
    ('intimidation', 'Запугивание', 'cha'),
    ('medicine', 'Медицина', 'wis'),
    ('nature', 'Природа', 'wis'),
    ('occultism', 'Оккультизм', 'int'),
    ('performance', 'Выступление', 'cha'),
    ('religion', 'Религия', 'wis'),
    ('society', 'Общество', 'int'),
    ('stealth', 'Скрытность', 'dex'),
    ('survival', 'Выживание', 'wis'),
    ('thievery', 'Воровство', 'dex'),
]

PROF_BY_VALUE = {0: 'u', 2: 't', 3: 't', 4: 'e', 6: 'm', 8: 'l'}


def norm(s):
    if s is None:
        return ''
    s = str(s)
    if s == 'None':
        return ''
    return s.replace('\r\n', '\n').replace('\\r\\n', '\n').strip()


def read_fields(path):
    """dict: имя поля -> значение. Чекбоксы -> True, остальные -> текст."""
    r = PdfReader(path)
    out = {}
    for page in r.pages:
        annots = page.get('/Annots') or []
        for a in annots:
            o = a.get_object()
            name = o.get('/T')
            if not name:
                continue
            ft = str(o.get('/FT'))
            if ft == '/Btn':
                val = o.get('/V')
                on = val is not None and str(val) not in ('/Off', 'None')
                if not on:
                    for k in (o.get('/Kids') or []):
                        as_ = k.get_object().get('/AS')
                        if as_ is not None and str(as_) not in ('/Off', 'None'):
                            on = True
                            break
                out[str(name)] = on
            else:
                out[str(name)] = norm(o.get('/V'))
    return out


def prof_from_group(fields, prefix):
    """Ранг профичности по группе чекбоксов prefix_{t,e,m,l} или prefix."""
    for rank_key in ('l', 'm', 'e', 't'):
        if fields.get('%s_%s' % (prefix, rank_key)) is True:
            return rank_key
    v = fields.get(prefix)
    if isinstance(v, str) and v.isdigit():
        return PROF_BY_VALUE.get(int(v), 'u')
    return 'u'


def num(v, default=0):
    try:
        f = float(v)
        return int(f) if f == int(f) else f
    except (TypeError, ValueError):
        return default


def split_lines(v):
    if not v:
        return []
    return [p.strip() for p in re.split(r'\n+', str(v)) if p.strip()]


def tradition_from_flags(f):
    tr = []
    for k, ru in (('arcane', 'Арканная'), ('occult', 'Оккультная'),
                  ('primal', 'Первобытная'), ('divine', 'Божественная')):
        if f.get('magic_tradition_' + k) is True:
            tr.append(ru)
    return ', '.join(tr)


def slug(s):
    s = (s or 'character').lower()
    s = re.sub(r'[^a-zа-я0-9]+', '-', s).strip('-')
    return s or 'character'


def extract(pdf_path, source_name=None):
    f = read_fields(pdf_path)

    def g(key, default=''):
        v = f.get(key, default)
        return v if isinstance(v, str) else default

    level = num(g('level'), 1)

    abilities = {}
    for k in ('str', 'dex', 'con', 'int', 'wis', 'cha'):
        abilities[k] = {'boost': f.get('att_%s_boost' % k) is True}

    def bonus_block(prefix, key_attr):
        return {
            'total': num(g(prefix)),
            'prof': prof_from_group(f, prefix + '_prof'),
            'keyAttr': key_attr,
            'item': num(g(prefix + '_item')),
        }

    saves = {
        'fortitude': bonus_block('save_fort', 'con'),
        'reflex': bonus_block('save_reflex', 'dex'),
        'will': bonus_block('save_will', 'wis'),
    }
    perception = bonus_block('perception', 'wis')
    perception['notes'] = g('perception_sensesandnotes')

    skills = []
    for key, ru, attr in SKILLS:
        b = bonus_block('skill_' + key, attr)
        b.update({'name': ru, 'attr': attr, 'key': key})
        skills.append(b)
    for i in (1, 2, 3, 4):
        nm = g('skill_lore%d_name' % i)
        if nm:
            b = bonus_block('skill_lore%d' % i, 'int')
            b.update({'key': 'lore%d' % i, 'name': 'Знание (%s)' % nm, 'attr': 'int'})
            skills.append(b)

    def strike(kind, i):
        p = 'weapon_%s%d_' % (kind, i)
        name = g(p + 'name')
        if not name:
            return None
        return {
            'name': name,
            'attack': num(g(p + 'attack')),
            'ability': g(p + 'strordex'),
            'prof': prof_from_group(f, p + 'prof'),
            'item': num(g(p + 'item')),
            'damage': g(p + 'damage'),
            'traits': g(p + 'traits_notes'),
            'range': g(p + 'range') if kind == 'range' else '',
            'reload': '',
            'agile': False,
            'fatal': '',
            'map': ['-5', '-10'],
        }

    melee = [x for x in (strike('melee', i) for i in (1, 2, 3)) if x]
    ranged = [x for x in (strike('range', i) for i in (1, 2, 3)) if x]

    weapon_prof = {}
    for grp in ('unarm', 'simple', 'martial', 'advanced', 'other'):
        weapon_prof[grp] = prof_from_group(f, 'weapon_prof_%s' % grp)

    inventory = {
        'worn': [{'name': line, 'bulk': '', 'invested': False}
                 for line in split_lines(g('inventory_worn_items'))],
        'held': [{'name': line, 'bulk': g('inventory_held_bulk')}
                 for line in split_lines(g('inventory_held_item'))],
        'consumables': [{'name': line}
                        for line in split_lines(g('inventory_consumables'))],
        'other': [],
        'coins': {
            'pp': num(g('wealth_platinum')), 'gp': num(g('wealth_gold')),
            'sp': num(g('wealth_silver')), 'cp': num(g('wealth_copper')),
        },
        'bulkMax': num(g('bulk_total')),
        'notes': g('inventory_notes'),
    }

    spellcasting = {
        'tradition': tradition_from_flags(f),
        'method': 'Подготовленный' if f.get('magic_tradition_prepared') else
                  ('Спонтанный' if f.get('magic_tradition_spontaneous') else ''),
        'keyAttr': 'int',
        'attack': bonus_block('spell_stat_attack', 'int'),
        'dc': bonus_block('spell_stat_dc', 'int'),
        'focusPoints': {'max': 0, 'current': 0},
        'slots': [{'rank': i,
                   'perDay': num(g('spellslots_rank_%d_per_day' % i)),
                   'used': 0} for i in range(1, 11)],
        'spells': [],
        'rituals': [],
    }
    for i in (1, 2, 3, 4, 5):
        nm = g('spellslots_names_%d' % i)
        if nm:
            spellcasting['spells'].append({
                'name': nm,
                'rank': num(g('spellslots_ranks_%d' % i), 1),
                'prepared': num(g('spellslots_prepared_%d' % i), 1),
                'heights': [],
            })
    for line in split_lines(g('spell_cantrips_names')):
        spellcasting['spells'].append({'name': line, 'rank': 0, 'prepared': 1,
                                       'heights': []})
    for i in (1, 2):
        nm = g('rituals_names_%d' % i)
        if nm:
            spellcasting['rituals'].append({
                'name': nm, 'rank': num(g('rituals_ranks_%d' % i)),
                'cost': g('rituals_costs_%d' % i)})

    feats = []
    feat_field_re = re.compile(r'^level_(\d+)_(.+)$')
    for name, value in f.items():
        m = feat_field_re.match(name)
        if not m or not isinstance(value, str) or not value.strip():
            continue
        lvl, kind = int(m.group(1)), m.group(2)
        if 'feat' not in kind and 'feature' not in kind and 'ability' not in kind:
            continue
        category = 'ancestry' if 'ancestry' in kind else \
                   ('class' if 'class' in kind else
                    ('skill' if 'skill' in kind else 'general'))
        feats.append({'name': value.split('\n')[0][:80], 'level': lvl,
                      'category': category, 'text': value})
    feats.sort(key=lambda x: (x['level'], x['category']))

    hero = sum(1 for i in (1, 2, 3) if f.get('hero_%d' % i) is True)

    actions = []
    act_re = re.compile(r'^action_activity_(\d+)_name$')
    for name, value in f.items():
        m = act_re.match(name)
        if m and isinstance(value, str) and value.strip():
            n = m.group(1)
            actions.append({
                'name': value,
                'actions': g('action_activity_%s_numactions' % n),
                'traits': g('action_activity_%s_traits' % n),
                'source': g('action_activity_%s_sourcepage' % n),
                'text': g('action_activity_%s_effects' % n),
            })
    r_re = re.compile(r'^action_free_reaction_(\d+)_name$')
    for name, value in f.items():
        m = r_re.match(name)
        if m and isinstance(value, str) and value.strip():
            n = m.group(1)
            actions.append({
                'name': value,
                'actions': 'Реакция' if f.get('action_free_reaction_%s_reaction' % n)
                          else 'Свободное',
                'traits': g('action_free_reaction_%s_traits' % n),
                'source': g('action_free_reaction_%s_pagesource' % n),
                'text': ('Триггер: ' + g('action_free_reaction_%s_trigger' % n)).strip() +
                        '\n' + g('action_free_reaction_%s_effects' % n),
            })

    return finalize({
        'schema': 1,
        'id': slug(source_name or g('name_char') or 'character'),
        'name': g('name_char') or 'Персонаж',
        'player': g('name_player'),
        'core': {
            'level': level,
            'xp': num(g('xp')),
            'ancestry': g('ancestry_name'),
            'heritage': g('ancestry_heritage_traits'),
            'size': g('ancestry_size'),
            'background': g('background_name'),
            'class': g('class_name'),
            'classNotes': g('class_notes'),
            'alignment': '',
            'deity': g('personality_deity_philosophy'),
            'languages': g('languages'),
            'speed': {'feet': num(g('speed'), 25), 'notes': g('speed_specialmovement')},
            'heroPoints': hero,
        },
        'abilities': abilities,
        'armor': {
            'ac': num(g('def_armor_total')),
            'dexOrCap': num(g('def_armor_dexorcap')),
            'prof': prof_from_group(f, 'def_armor_prof'),
            'item': num(g('def_armor_item')),
            'checkPenalty': 0,
            'shield': {
                'ac': num(g('def_shield_ac')),
                'hardness': num(g('def_shield_hardness')),
                'hp': num(g('def_shield_maxhp')),
                'bt': num(g('def_shield_bt')),
                'current': num(g('def_shield_current_hp')),
            },
            'groups': {k: prof_from_group(f, 'def_armor_prof_%s' % k)
                       for k in ('unarmored', 'light', 'medium', 'heavy')},
        },
        'classDC': {'value': num(g('class_dc')), 'key': num(g('class_dc_key')),
                    'prof': prof_from_group(f, 'class_dc_prof'),
                    'item': num(g('class_dc_item'))},
        'saves': saves,
        'perception': perception,
        'skills': skills,
        'hitPoints': {
            'max': num(g('hp_max')), 'current': num(g('hp_current')),
            'temp': num(g('hp_temporary')), 'dying': 0, 'wounded': 0,
            'hardness': 0, 'bt': 0,
        },
        'strikes': {'melee': melee, 'ranged': ranged},
        'weaponProficiencies': weapon_prof,
        'weaponProfNotes': g('weapon_prof_notes'),
        'spellcasting': spellcasting,
        'inventory': inventory,
        'feats': feats,
        'actions': actions,
        'resistances': g('hp_resistancesandimmunities'),
        'conditions': g('hp_conditions'),
        'defenseNotes': g('def_notes'),
        'biography': {
            'portrait': '',
            'ethnicity': g('origin_ethnicity'),
            'birthplace': g('origin_birthplace'),
            'age': g('origin_age'),
            'gender': g('origin_gender_pronouns'),
            'height': g('origin_height'),
            'weight': g('origin_weight'),
            'appearance': g('origin_appearance'),
            'attitude': g('personality_attitude'),
            'edicts': g('personality_edicts'),
            'anathema': g('personality_anathema'),
            'likes': g('personality_likes'),
            'dislikes': g('personality_dislikes'),
            'catchphrases': g('personality_catchphrases'),
            'backstory': g('campaign_notes'),
            'allies': g('campaign_allies'),
            'enemies': g('campaign_enemies'),
            'organizations': g('campaign_organizations'),
            'notes': g('background_notes'),
        },
    })


def finalize(sheet):
    sheet.setdefault('meta', {})
    sheet['meta'].setdefault('createdAt', None)
    sheet['meta'].setdefault('updatedAt', None)
    sheet['meta'].setdefault('source', 'manual')
    return sheet


# --------------------------------------------------------------------------
# Поддержка xlsx (PF2E Easy Character Sheet) — базовое извлечение
# --------------------------------------------------------------------------
def extract_xlsx(path, source_name=None):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    cs = wb['Character Sheet']

    def cell(coord):
        v = cs[coord].value
        return norm(v)

    ab = {}
    coords = {'str': 'O13', 'dex': 'O15', 'con': 'O17',
              'int': 'V13', 'wis': 'V15', 'cha': 'V17'}
    for k, c in coords.items():
        ab[k] = {'score': num(cell(c), 10), 'boost': False}

    sheet = {
        'schema': 1,
        'id': slug(source_name or cell('U2') or 'character'),
        'name': cell('U2') or 'Персонаж',
        'player': cell('U6'),
        'core': {
            'level': num(cell('AZ13'), 1),
            'xp': num(cell('AU8')),
            'ancestry': cell('AQ2'),
            'heritage': cell('AX2') if cs['AX2'].value and not isinstance(cs['AX2'].value, str) or (isinstance(cs['AX2'].value, str) and cs['AX2'].value != 'Heritage') else '',
            'size': '',
            'background': '',
            'class': cell('AQ6'),
            'classNotes': '',
            'alignment': '',
            'deity': cell('AB8') if isinstance(cs['AB8'].value, str) else '',
            'languages': cell('AZ26'),
            'speed': {'feet': num(cell('M25'), 25), 'notes': ''},
            'heroPoints': sum(1 for c in ('BD13', 'BE13', 'BF13') if cs[c].value is True),
        },
        'abilities': ab,
        'armor': {
            'ac': num(cell('AA13')),
            'dexOrCap': num(cell('AD13')),
            'prof': 'u', 'item': num(cell('AH13')), 'checkPenalty': 0,
            'shield': {'ac': 0, 'hardness': num(cell('AO13')), 'hp': num(cell('AQ13')),
                       'bt': num(cell('AP13')), 'current': 0},
            'groups': {},
        },
        'classDC': {'value': num(cell('M21')), 'key': num(cell('R21')),
                    'prof': 'u', 'item': 0},
        'saves': {
            'fortitude': {'total': num(cell('AF21')), 'prof': 'u', 'keyAttr': 'con', 'item': 0},
            'reflex': {'total': num(cell('AF23')), 'prof': 'u', 'keyAttr': 'dex', 'item': 0},
            'will': {'total': num(cell('AF25')), 'prof': 'u', 'keyAttr': 'wis', 'item': 0},
        },
        'perception': {'total': num(cell('AS21')), 'prof': 'u', 'keyAttr': 'wis',
                       'item': 0, 'notes': ''},
        'skills': [],
        'hitPoints': {'max': num(cell('AW13')), 'current': num(cell('AS12')) if cs['AS12'].value else num(cell('AW13')),
                      'temp': num(cell('AW16')), 'dying': 0, 'wounded': 0,
                      'hardness': num(cell('AO13')), 'bt': num(cell('AP13'))},
        'strikes': {'melee': [], 'ranged': []},
        'weaponProficiencies': {},
        'weaponProfNotes': '',
        'spellcasting': {'tradition': cell('BB8'), 'method': '', 'keyAttr': 'wis',
                         'attack': {'total': num(cell('AB29')), 'prof': 'u', 'keyAttr': 'wis', 'item': 0},
                         'dc': {'total': num(cell('AP29')), 'prof': 'u', 'keyAttr': 'wis', 'item': 0},
                         'focusPoints': {'max': 0, 'current': 0},
                         'slots': [], 'spells': [], 'rituals': []},
        'inventory': {'worn': [], 'held': [], 'consumables': [], 'other': [],
                      'coins': {'pp': 0, 'gp': num(cell('AB16')), 'sp': 0, 'cp': num(cell('X16'))},
                      'bulkMax': 0, 'notes': ''},
        'feats': [], 'actions': [],
        'resistances': '', 'conditions': '', 'defenseNotes': '',
        'biography': {k: '' for k in
                      ('portrait', 'ethnicity', 'birthplace', 'age', 'gender',
                       'height', 'weight', 'appearance', 'attitude', 'edicts',
                       'anathema', 'likes', 'dislikes', 'catchphrases',
                       'backstory', 'allies', 'enemies', 'organizations', 'notes')},
    }
    # навыки из листа Abilities
    if 'Abilities' in wb.sheetnames:
        ws = wb['Abilities']
        rows = {'Acrobatics': ('acrobatics', 'Акробатика', 'dex', 5),
                'Arcana': ('arcana', 'Аркана', 'int', 7),
                'Athletics': ('athletics', 'Атлетика', 'str', 9),
                'Crafting': ('crafting', 'Ремесло', 'int', 11),
                'Deception': ('deception', 'Обман', 'cha', 13),
                'Diplomacy': ('diplomacy', 'Дипломатия', 'cha', 15),
                'Intimidation': ('intimidation', 'Запугивание', 'cha', 17),
                'Medicine': ('medicine', 'Медицина', 'wis', 27),
                'Nature': ('nature', 'Природа', 'wis', 29),
                'Occultism': ('occultism', 'Оккультизм', 'int', 31),
                'Performance': ('performance', 'Выступление', 'cha', 33),
                'Religion': ('religion', 'Религия', 'wis', 35),
                'Society': ('society', 'Общество', 'int', 37),
                'Stealth': ('stealth', 'Скрытность', 'dex', 39),
                'Survival': ('survival', 'Выживание', 'wis', 41),
                'Thievery': ('thievery', 'Воровство', 'dex', 43)}
        for eng, (key, ru, attr, row) in rows.items():
            prof = 'u'
            for rk, col in (('t', 'N'), ('e', 'O'), ('m', 'P'), ('l', 'Q')):
                if ws['%s%d' % (col, row)].value is True:
                    prof = rk
            sheet['skills'].append({
                'key': key, 'name': ru, 'attr': attr,
                'total': num(ws['H%d' % row].value), 'prof': prof,
                'keyAttr': attr, 'item': num(ws['S%d' % row].value),
            })
    # удары melee/ranged
    for base_row, kind in ((33, 'melee'), (39, 'melee'), (45, 'melee')):
        name = cs['B%d' % base_row].value
        if isinstance(name, str) and name and name != 'Weapon':
            sheet['strikes']['melee'].append({
                'name': name, 'attack': num(cs['N%d' % base_row].value),
                'ability': '', 'prof': 'u', 'item': 0,
                'damage': norm(cs['S%d' % (base_row + 3)].value) if cs['S%d' % (base_row + 3)].value else '',
                'traits': norm(cs['B%d' % (base_row + 3)].value), 'range': '',
                'reload': '', 'agile': False, 'fatal': '', 'map': ['-5', '-10']})
    return finalize(sheet)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('-o', '--out', default=None)
    ap.add_argument('--xlsx', action='store_true', help='читать xlsx-лист')
    args = ap.parse_args()
    if args.xlsx or args.src.lower().endswith('.xlsx'):
        data = extract_xlsx(args.src)
    else:
        data = extract(args.src)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as fh:
            fh.write(text + '\n')
        print('written', args.out)
    else:
        print(text)


if __name__ == '__main__':
    sys.exit(main())
