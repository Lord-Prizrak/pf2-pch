# PF2e Character Sheets — система листов персонажей Pathfinder 2e

Интерактивный HTML-лист персонажа + Go-backend для хранения и синхронизации.
Подробная документация — в [docs/](docs/README.md).

## Структура репозитория

| Каталог | Описание |
|---|---|
| `frontend/` | Готовые автономные листы `sheet.html` / `sheet-empty.html` и исходники `src/` ([docs/frontend.md](docs/frontend.md)) |
| `server/` | Backend на Go: REST API, авторизация, страницы логина/аккаунта ([docs/server.md](docs/server.md)) |
| `sheets/` | Канонические JSON-данные персонажей ([docs/data-format.md](docs/data-format.md)) |
| `tools/` | `extract.py` (PDF/XLSX → JSON), `build.py` (сборка листа) ([docs/tools.md](docs/tools.md)) |
| docs/ | Документация системы |
| корень | Исходные заполненные листы пользователей (PDF, XLSX) |

## Быстрый старт

```bash
# backend (по умолчанию http://localhost:8090, данные в server/data/)
cd server && go run .

# лист — через сервер…
open http://localhost:8090/sheet.html
# …или совсем без сервера (файл самодостаточен, работает по file://)
open frontend/sheet.html
```

Основные команды:

```bash
python3 tools/build.py                                   # пересобрать frontend/sheet.html
python3 tools/extract.py "Саныч.pdf" -o sheets/x.json    # извлечение из PDF-листа
cd server && go build -o pf2e-server .                   # сборка бинарника
./pf2e-server -addr :8090 -data ./data -frontend ../frontend
```

## Возможности

- Автосчёт характеристик, спасбросков, навыков, КД; броски атак и кубиков.
- Мультиперсонажность: переключение, новый/удаление, автосохранение в localStorage.
- Импорт/экспорт всегда в JSON: буфер обмена, файл, HTML-лист с встроенными
  данными, PDF-лист, сервер.
- Вкладка «Серверы»: несколько backend'ов, вход/регистрация или API-ключ,
  списки персонажей на каждом сервере, загрузка/выгрузка.
- Backend: пользователи, HMAC-сессии, API-ключи (`X-API-Key` / Bearer),
  файловое хранение, страницы `/login`, `/user`, `/sheet.html`, `/sheet-empty.html`.

## Требования

Браузер (без внешних зависимостей); Go ≥ 1.19 (stdlib); Python 3 + pypdf/openpyxl для инструментов.
