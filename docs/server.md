# Backend: Go-сервер хранения листов PF2e (`server/`)

Лёгкий HTTP-сервер на **чистой стандартной библиотеке Go** (≥ 1.19), без
внешних зависимостей. Хранит пользователей, API-ключи и персонажей в файлах
JSON на диске; раздаёт страницы авторизации, аккаунта и интерактивный лист.

## Файлы

| Файл | Содержимое |
|---|---|
| `server/main.go` | Модели, файловое хранилище (`Store`), маршруты REST API и страниц, `main()` с флагами |
| `server/auth.go` | Хеширование паролей (salt + итеративный SHA-256), HMAC-подписанные сессионные cookie, генерация API-ключей |
| `server/pages.go` | HTML страниц: `/login`, `/user` (аккаунт + ключи + персонажи) |
| `server/go.mod` | Модуль `github.com/pf2e/charsrv`, `go 1.19` |

## Сборка и запуск

```bash
cd server
go build -o pf2e-server .   # бинарник (или go run . для разработки)
./pf2e-server               # по умолчанию http://localhost:8090, данные ./data
```

Флаги запуска:

| Флаг | По умолчанию | Описание |
|---|---|---|
| `-addr` | `:8090` | Адрес слушания |
| `-data` | `./data` | Каталог данных (создаётся автоматически) |
| `-secret` | *(файл)* | Секрет подписи сессий; если пуст — генерируется и кладётся в `data/session.secret` (0600) |
| `-frontend` | `../frontend` | Каталог со собранным `sheet.html` / `sheet-empty.html` |

Продакшен-пример: `./pf2e-server -addr :8090 -data /srv/pf2e/data -frontend /var/www/pf2e`

## Структура данных на диске

```
data/
├── users.json          # [{id, username, passHash(v1$salt$iters$hex), createdAt}]
├── keys.json           # API-ключи [{token(pf2e_+48hex), userId, label, createdAt, lastUsed}]
├── session.secret      # секрет HMAC-подписи cookie (если не задан -secret)
└── characters/<userID>/<charID>.json   # канонический JSON персонажа (schema v1)
```

Записи сохраняются атомарно (`.tmp` + rename). Имена файлов проходят
`sanitizeID` (только буквы/цифры/`-`/`_`). Тело запросов ограничено (readCapped).

## Авторизация

Два независимых механизма (оба поддерживают все `/api/*` эндпоинты):

1. **Сессионная cookie** `pf2e_session` — значение `base64(userID.exp).hexHMAC`;
   выдаётся `/api/register` и `/api/login`, TTL 30 дней, HttpOnly, SameSite=Lax.
   Страницы `/user*` работают только с ней.
2. **API-ключ** — заголовок `X-API-Key: pf2e_…` **или** `Authorization: Bearer pf2e_…`.
   Ключи создаются/удаляются на странице `/user`; при использовании обновляется `lastUsed`.

Ошибка `401 {"error":"требуется авторизация (войдите или передайте X-API-Key)"}`.
Между пользователями данные изолированы: каждый видит только своих персонажей.

## REST API

Базовый URL — корень сервера. Ответы: `application/json; charset=utf-8`.

| Метод | Путь | Авторизация | Описание |
|---|---|---|---|
| GET | `/api/health` | нет | `{ok:true, uptime}` — проверка доступности |
| POST | `/api/register` | нет | `{username,password}` → 201 + cookie-сессия. Требования: логин ≥3, пароль ≥6 символов |
| POST | `/api/login` | нет | `{username,password}` → 200 + cookie-сессия; 401 при неверных данных |
| POST | `/api/logout` | нет | Сбрасывает cookie |
| GET | `/api/me` | да | `{username, createdAt, characters:[meta]}` |
| GET | `/api/characters` | да | Список карточек персонажей: `[{id,name,class,level,updatedAt,size}]` |
| POST | `/api/characters` | да | Создать: тело = канонический JSON персонажа (обязательно поле `name`); id генерируется (`c-…`), если не задан; ответ 201 `{status:"created", character:meta}` |
| GET | `/api/characters/{id}` | да | Полный JSON персонажа (+ `Content-Disposition: attachment`) |
| PUT | `/api/characters/{id}` | да | Обновить (тело — JSON; id из пути имеет приоритет) |
| DELETE | `/api/characters/{id}` | да | Удалить |

CORS открыт (`Access-Control-Allow-Origin: *`, разрешены заголовки
`Content-Type,X-API-Key,Authorization`) — чтобы лист работал с `file://`.

### Примеры (curl)

```bash
# регистрация + создание персонажа из файла
curl -c jar -X POST localhost:8090/api/register \
     -d '{"username":"master","password":"secret123"}'
curl -b jar -X POST localhost:8090/api/characters \
     -H 'Content-Type: application/json' --data @sheets/sanych.json

# по API-ключу
curl -H 'X-API-Key: pf2e_…' localhost:8090/api/characters
curl -H 'X-API-Key: pf2e_…' localhost:8090/api/characters/sanych -o sanych.json
```

## HTML-страницы

| Путь | Описание |
|---|---|
| `/` | Редирект на `/sheet.html` |
| `/sheet.html` | Интерактивный лист (с встроенными персонажами) |
| `/sheet-empty.html` | Чистый лист (без встроенных данных) |
| `/login` | Форма входа/регистрации (POST на `/api/login`, `/api/register`) |
| `/user` | Кабинет: данные аккаунта, список персонажей со ссылками выгрузки, управление API-ключами (`/user/keys/create`, `/user/keys/delete`), выход (`/user/logout`). Без сессии — редирект на `/login` |
| прочие | Раздача статики из каталога `-frontend` (для разработки: `style.css`, `app.js`) |

## Замечания по эксплуатации

- Все состояние — обычные файлы: резервная копия = копия каталога `data/`.
- Для продакшена ставьте TLS перед сервером (nginx/caddy reverse proxy) и
  задавайте постоянный `-secret`, иначе смена секрета сбросит все сессии.
- Логи — стандартный `log` в stderr.
