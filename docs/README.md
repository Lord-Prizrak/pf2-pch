# PF2e Character Sheets — система листов персонажей Pathfinder 2e

Полностью автономная система для ведения интерактивных листов персонажей НРИ
**Pathfinder 2e**: HTML-лист + Go-backend для хранения и синхронизации.

## Компоненты

| Каталог | Описание | Документация |
|---|---|---|
| `frontend/` | Интерактивный лист персонажа — единый самодостаточный HTML-файл (`sheet.html`, `sheet-empty.html`), собранный из исходников `frontend/src/` | [docs/frontend.md](frontend.md) |
| `server/` | Backend на Go: REST API, авторизация (сессии + API-ключи), страницы логина/аккаунта, раздача листов | [docs/server.md](server.md) |
| `sheets/` | Канонические JSON-данные персонажей (`jeff.json`, `sanych.json`) | [docs/data-format.md](data-format.md) |
| `tools/` | Утилиты: `extract.py` (PDF/XLSX → JSON), `build.py` (сборка sheet.html) | [docs/tools.md](tools.md) |
| корень | Исходные заполненные листы пользователей (PDF, XLSX) | — |

## Быстрый старт

```bash
# 1. Запустить backend (из каталога server/; frontend по умолчанию ../frontend)
cd server && go run .            # http://localhost:8090

# 2. Открыть лист в браузере
xdg-open http://localhost:8090/sheet.html

# ...или использовать лист вообще без сервера — файл самодостаточен:
xdg-open frontend/sheet.html     # работает и по file://
```

Лист сохраняет изменения в `localStorage` браузера автоматически. Импорт /
экспорт доступны в виде JSON (буфер обмена, файл) и HTML (сохранённый лист с
встроенными данными). Синхронизация с сервером — на вкладке «Серверы»
(логин/регистрация или API-ключ).

## Основные команды

```bash
python3 tools/build.py                 # пересобрать frontend/sheet.html (+ sheet-empty.html)
python3 tools/extract.py "Саныч.pdf" -o sheets/sanych.json   # извлечение из PDF-листа
cd server && go build -o pf2e-server . # сборка бинарника
cd server && ./pf2e-server -addr :8090 -data ./data          # запуск
```

## Требования

- **Frontend:** современный браузер (Chrome/Firefox/Safari/Edge); внешних зависимостей нет.
- **Backend:** Go ≥ 1.19, только стандартная библиотека (`go.mod`: `github.com/pf2e/charsrv`).
- **Tools:** Python 3 + `pypdf` (для PDF), `openpyxl` (для XLSX).

## Документация

- [Frontend: интерактивный лист](frontend.md) — возможности, хранилища, импорт/экспорт, работа с серверами
- [Backend: Go-сервер](server.md) — установка, конфигурация, API, авторизация, страницы
- [Формат данных персонажа (schema v1)](data-format.md) — структура канонического JSON
- [Инструменты](tools.md) — экстрактор PDF/XLSX и сборщик HTML
