# Формат данных персонажа (канонический JSON, schema v1)

Единый формат для **всех** мест хранения: localStorage браузера, встроенный
блок в HTML-листе, файлы `sheets/*.json`, серверное хранилище и API. Примеры:
[`sheets/jeff.json`](../sheets/jeff.json), [`sheets/sanych.json`](../sheets/sanych.json).

## Корень объекта

| Ключ | Тип | Описание |
|---|---|---|
| `schema` | number | Версия схемы (`1`) |
| `id` | string | Уникальный id (`"sanych"`, `"c-a1b2…"`); генерируется при импорте, если отсутствует |
| `name` | string | Имя персонажа (**обязательно** — проверяется сервером) |
| `player` | string | Имя игрока |
| `core` | object | Уровень/происхождение/класс (см. ниже) |
| `abilities` | object | 6 характеристик |
| `armor` | object | КД, щит, профичности брони |
| `classDC` | object | Классовый DC |
| `saves` | object | Три спасброска |
| `perception` | object | Восприятие |
| `skills` | array[15] | Навыки PF2e |
| `hitPoints` | object | HP/В dying/wounded/BT |
| `strikes` | object | `{melee:[], ranged:[]}` — атаки |
| `weaponProficiencies` | object | Профичности оружия |
| `weaponProfNotes` | string | Заметки по оружию |
| `spellcasting` | object\|null | Заклинания (null у безмагов) |
| `inventory` | object | Инвентарь и монеты |
| `feats` | array | Черты |
| `actions` | array | Действия/умения |
| `resistances` | string | Устойчивости/слабости |
| `conditions` | string | Условия |
| `defenseNotes` | string | Заметки по защите |
| `biography` | object | Биография |
| `meta` | object | Служебное (`createdAt`, `updatedAt`, `source`) |

Профицити везде кодируются одной буквой: `u` untrained, `t` trained,
`e` expert, `m` master, `l` legendary.

### `core`
`level`, `xp`, `ancestry`, `heritage`, `size`, `background`, `class`,
`classNotes`, `alignment`, `deity`, `languages`, `speed{feet,notes}`,
`heroPoints`.

### `abilities`
```json
{ "str": {"score": 14, "boost": true}, "dex": {...}, "con": {...},
  "int": {...}, "wis": {...}, "cha": {...} }
```
Модификатор лист считает сам: `floor((score - 10) / 2)`; `boost` — отметка
увеличения характеристики (4-й уровень и т.п.).

### `armor`
```json
{ "ac": 18, "dexOrCap": 2, "prof": "t", "item": 1, "checkPenalty": -1,
  "shield": {"ac": 4, "hardness": 8, "hp": 20, "bt": 10, "current": 20},
  "groups": {"unarmored":"u","light":"t","medium":"t","heavy":"u"} }
```

### `classDC` / `saves` / `perception`
Формула бонуса листа: `total = ключевой мод + prof-бонус(level) + item + level(для DC)`.
```json
"classDC": { "value": 18, "key": 3, "prof": "t", "item": 1 }
"saves":   { "fortitude": {"total":7,"prof":"e","keyAttr":"con","item":0}, "reflex": {...}, "will": {...} }
"perception": { "total": 9, "prof": "m", "keyAttr": "wis", "item": 0, "notes": "" }
```

### `skills`
Массив из 15 объектов `{key, name, attr, total, prof, keyAttr, item}`
(acrobatics…thievery; `attr` — базовая характеристика навыка).

### `hitPoints`
`{max, current, temp, dying, wounded, hardness, bt}`.

### `strikes.melee[] / .ranged[]`
`{name, attack, ability ("str"/"dex"/"0"=авто), prof, item, damage ("1d6+2"),
traits, notes}` — кнопка броска на листе кидает d20+attack, урон удваивается на крит. 20.

### `spellcasting`
```json
{ "tradition": "Primal", "method": "Подготовленный", "keyAttr": "int",
  "attack": {"total":7,"prof":"e","keyAttr":"int","item":0},
  "dc":     {"total":17,"prof":"e","keyAttr":"int","item":0},
  "focusPoints": {"max":1,"current":1},
  "slots":  [{"rank":1,"perDay":2,"used":1}, … ],
  "spells": [{"name":"Исцеление","rank":1,"prepared":2,"heights":[1]}, …],
  "rituals":[…] }
```

### `inventory`
Категории `worn/held/consumables/other` — массивы `{name, bulk, qty?, invested?}`;
`coins{pp,gp,sp,cp}`, `bulkMax`, `notes`.

### `feats[]` / `actions[]`
`feats`: `{name, level, category ("ancestry"/"class"/"feat"…), text}`.
`actions`: `{name, actions ("1"/"2"/"free"…), traits, source, text}`.

### `biography`
`portrait, ethnicity, birthplace, age, gender, height, weight, appearance,
attitude, edicts, anathema, likes, dislikes, catchphrases, backstory, allies,
enemies, organizations, notes`.

## Совместимость

- Клиент нормализует импорт (`normalizeSheet`): дополняет отсутствующие поля
  дефолтами, не трогая известные значения (deepMerge).
- Сервер требует только наличие `name`; остальное хранится как есть,
  `meta.updatedAt/createdAt` проставляются автоматически.
- Массив персонажей — обычный JSON-массив таких объектов (экспорт «все»).
