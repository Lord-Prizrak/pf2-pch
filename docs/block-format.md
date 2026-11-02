# Формат блоков листа персонажа (Block Format JSON)

**Block Format** — независимый от системы описания JSON-формат, которым задаются *блоки*
(карточки/секции) интерактивного листа персонажа. Формат рассчитан на НРИ любого жанра:
Pathfinder 2e, D&D 5e, Starfinder, Call of Cthulhu и самодельные системы.
Машинально-читаемая схема: [`block-format.schema.json`](block-format.schema.json) (JSON Schema draft-07).

Примеры готовых определений листов: [`../examples/sheets/`](../examples/sheets/)
и отдельных блоков: [`../examples/blocks/`](../examples/blocks/).

Проверка определения: `python3 tools/validate_block.py <файл.json>`

---

## 1. Уровни формата

| Уровень | Файл | Описание |
|---|---|---|
| **Блок** (`block`) | `*.block.json` | Одна карточка листа: заголовок + набор полей. |
| **Лист** (`sheetdef`) | `*.sheetdef.json` | Полный лист: система, вкладки (разделы) и список блоков каждой вкладки. |

Блок не привязан к вкладке — один и тот же блок можно использовать в нескольких листах.

## 2. Корневые поля блока

```jsonc
{
  "formatVersion": 1,
  "kind": "block",
  "id": "identity",              // уникальный id блока (латиница, цифры, дефис/подчёркивание)
  "title": "Кто я",              // заголовок (legend) блока
  "icon": "🪪",                  // необязательная иконка для заголовка
  "system": "generic",           // pf2e | dnd5e | starfinder | generic | ... (подсказка UI)
  "fields": [ /* см. §4 */ ],    // состав блока
  "layout": {                    // необязательно — пожелания к сетке
    "span": 4,                   // ширина в колонках 12-сетки: 4 (по умолчанию), 6, 8, 12
    "order": 1                   // порядок внутри вкладки
  },
  "editable": true,              // доступен ли режим редактирования (по умолчанию true)
  "defaultVisible": true         // показывать ли блок при первом открытии листа
}
```

## 3. Корневые поля листа (sheetdef)

```jsonc
{
  "formatVersion": 1,
  "kind": "sheetdef",
  "id": "sf-starship-crew",
  "name": "Starfinder: член экипажа",
  "system": "starfinder",
  "theme": "dark",               // рекомендуемая раскладка (см. docs/frontend.md)
  "palette": "dark",             // рекомендуемая гамма
  "tabs": [
    {
      "id": "core",
      "title": "Основное",
      "blocks": [ { "$ref": "blocks/identity.block.json" }, { "inline": /* блок целиком */ } ]
    },
    { "id": "combat", "title": "Бой", "blocks": [] }
  ]
}
```

Ссылка на внешний блок — `{"$ref": "относительный/путь.json"}`; либо блок встраивается
полностью в поле `inline`. Путь разрешается относительно файла sheetdef.

## 4. Поля (types)

Каждый элемент `fields[]` — поле одного из типов. Общие атрибуты любого поля:

| Атрибут | Тип | Описание |
|---|---|---|
| `key` | string | путь в JSON данных персонажа, напр. `abilities.str` или `custom.hitpoints`. Обязателен. |
| `type` | enum | тип поля (см. ниже). |
| `label` | string | подпись над полем. |
| `help` | string | подсказка (tooltip). |
| `placeholder` | string | плейсхолдер ввода. |
| `readonly` | bool | запрет правки (например, авто-расчётные поля). |
| `default` | any | значение по умолчанию при создании персонажа. |

### 4.1 Скалярные типы

* **`text`** — однострочный ввод (`input`).
* **`textarea`** — многострочный, авторастягивание по содержимому.
* **`number`** — число (`min`, `max`, `step`).
* **`select`** — выпадающий список: `"options": ["A","B"]` или `[{"value":"a","label":"A"}]`.
* **`checkbox`** — флажок.
* **`dice`** — кнопка броска: `"formula": "1d6+3"`, `"labelRoll": "Урон меча"`.

### 4.2 Композитные типы

* **`checklist`** — список элементов с раскрытием деталей:
  ```jsonc
  { "key": "feats", "type": "checklist", "label": "Черты",
    "itemFields": [ {"key":"name","type":"text","label":"Название"},
                    {"key":"text","type":"textarea","label":"Описание"} ] }
  ```
* **`table`** — таблица с колонками-полями (строки хранятся массивом):
  ```jsonc
  { "key": "inventory.items", "type": "table", "label": "Инвентарь",
    "columns": [ {"key":"name","type":"text","label":"Предмет"},
                 {"key":"qty","type":"number","label":"Кол-во"},
                 {"key":"bulk","type":"text","label":"Объём"} ],
    "addRowLabel": "＋ предмет" }
  ```
* **`skills`** — встроенный PF2e-вид навыков (профичность u/t/e/m/l + модификатор + броска нет).
* **`spells`** — слоты заклинаний + списки заклинаний по традициям.
* **`group`** — визуальная подгруппа внутри блока: `"fields": [...]` вложенно.
* **`computed`** — формульное поле, только чтение:
  `"expr": "abilities.dex.mod + armor.check_penalty"` (синтаксис: `<ключ.путь>` и арифметика).

### 4.3 Расширяемость

Неизвестный `type` валидатор считает ошибкой, но UI обязан показать заглушку
(`readonly textarea` с JSON-значением) — лист не «ломается» при встрече нового типа.

## 5. Хранение данных

Значения полей пишутся в общий JSON персонажа по `key` (`.` — спуск по объектам,
`[i]` — индекс массива). Новый лист = пустой объект `{}` плюс `default`-значения.
Формат данных PF2e-листа описан в [data-format.md](data-format.md); произвольные
системы используют пространство `custom.*`, чтобы не конфликтовать с каноническими ключами.

## 6. Совместимость и версионирование

* `formatVersion` — целое, монотонно растёт. Миграция: UI принимает файлы с
  `formatVersion <= текущей`; удалённые атрибуты игнорируются, недостающие получают `default`.
* id блоков и вкладок должны быть уникальны в пределах листа; дубличатые id валидатор отвергает.

## 7. Примеры

* [`../examples/blocks/identity.block.json`](../examples/blocks/identity.block.json) — минимальный текстовый блок.
* [`../examples/blocks/appearance.block.json`](../examples/blocks/appearance.block.json) — select/textarea/checklist.
* [`../examples/blocks/weapons-pf2e.block.json`](../examples/blocks/weapons-pf2e.block.json) — table + computed + dice (PF2e).
* [`../examples/sheets/generic-fantasy.sheetdef.json`](../examples/sheets/generic-fantasy.sheetdef.json) — фэнтези-лист без привязки к PF2e.
* [`../examples/sheets/starfinder.sheetdef.json`](../examples/sheets/starfinder.sheetdef.json) — sci-fi лист (Starfinder).
