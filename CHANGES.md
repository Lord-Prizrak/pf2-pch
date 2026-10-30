# Журнал изменений

## 2026-10-31 — v1.0.0 (cff60e7)

### Frontend — интерактивный лист персонажа PF2e
- `frontend/sheet.html` — автономный лист: автосчёт характеристик, броски кубиков, HP/щит/заклинания/инвентарь, переключение персонажей.
- Сохранение: localStorage, JSON внутри HTML (`PF2E-SHEET-DATA`), сервер.
- Импорт/экспорт: буфер обмена, JSON-файл, HTML-файл листа, PDF/XLSX, сервер.
- Вкладка «Серверы»: подключение, авторизация, списки персонажей на разных серверах, push/pull.
- `frontend/sheet-empty.html` — чистый лист для серверных страниц.

### Backend — Go-сервер хранения листов (`server/`)
- REST API CRUD для персонажей; авторизация: HMAC-сессии (cookie) + API-ключи (`X-API-Key`/Bearer).
- Страницы: `/login`, `/account` (данные пользователя, персонажи, ключи), `/sheet.html`, `/sheet-empty.html`.
- Хранение в файловой системе (`data/users.json`, `data/characters/<user>/<id>.json`), атомарная запись.
- Go >= 1.19, только стандартная библиотека. Сборка: `cd server && go build -o pf2e-server .`

### Данные и инструменты
- `sheets/jeff.json`, `sheets/sanych.json` — извлечённые из исходных PDF/XLSX персонажи (schema v1).
- `tools/extract.py` — извлечение данных из PDF/XLSX; `tools/build.py` — сборка автономных HTML-листов.

### Документация
- `README.md`, `docs/` — обзор системы, frontend, backend/API, формат данных, инструменты.
