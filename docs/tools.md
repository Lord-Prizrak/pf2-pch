# Инструменты (`tools/`)

## `extract.py` — извлечение данных персонажа из заполненных листов

Преобразует исходные файлы пользователей (PDF с форм-полями и XLSX) в
канонический JSON ([data-format.md](data-format.md)).

```bash
# PDF (RM_CharacterSheet_Fillable.pdf, Саныч.pdf и т.п.)
python3 tools/extract.py "Саныч.pdf" -o sheets/sanych.json

# XLSX (PF2E Easy Character Sheet v1/v1.1)
python3 tools/extract.py --xlsx "PF2E Easy Character Sheet v1.1.xlsx" -o sheets/jeff.json
```

Зависимости: Python 3, `pypdf` (для PDF), `openpyxl` (лениво, только для `--xlsx`).

Как работает (PDF): читает все form-поля страницы (`/T → /V`; чекбоксы →
булевы), затем по именам полей собирает разделы — `core`, характеристики,
КД/спасброски/навыки (ранги профичности берутся из групп чекбоксов
`*_t/*_e/*_m/*_l`), атаки, заклинания, инвентарь, биографию. Маппинг полей
задокументирован в константах и функциях модуля (`SKILLS`, `prof_from_group`,
`build_*`). Результат можно доработать руками или импортировать в лист
(вкладка «Импорт/экспорт» → «Из PDF-листа» делает то же самое прямо в браузере).

Примеры уже извлечённых данных: `sheets/sanych.json` (из `Саныч.pdf`),
`sheets/jeff.json` (из XLSX).

## `build.py` — сборка автономного HTML-листа

Собирает из исходников `frontend/src/` один самодостаточный файл
`frontend/sheet.html`:

```bash
python3 tools/build.py            # sheet.html с встроенными персонажами из sheets/*.json
python3 tools/build.py --no-data  # sheet-empty.html без данных
                                  # (заодно пересобирает и sheet.html — обе страницы нужны серверу)
```

Шаги сборки:
1. Инлайн `<link rel="stylesheet" href="style.css">` → содержимое `style.css` в `<style>`.
2. Инлайн `<script src="app.js"></script>` → содержимое `app.js` в `<script>`.
3. Замена блока между маркерами `<!-- PF2E-SHEET-DATA:START/END -->` на
   `<script id="pf2e-embedded-data" type="application/json">` с объектом
   `{schema:1, characters:[…]}` (все JSON'ы из `sheets/`, `</` экранируется).

После изменения любого файла в `frontend/src/` или `sheets/*.json` нужно
пересобрать лист командой выше. Готовые `sheet.html` / `sheet-empty.html`
лежат в git и раздаются Go-сервером как `/sheet.html` и `/sheet-empty.html`.
