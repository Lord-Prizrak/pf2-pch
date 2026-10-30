package main

import (
	"fmt"
	"html"
	"strings"
	"time"
)

// Страницы, отдаваемые сервером. Минимальный самодостаточный HTML+CSS.

var pageCSS = `<style>
:root{--bg:#f4efe6;--panel:#fffdf8;--ink:#2b2117;--accent:#8c2d19;--line:#d8cdb9;--muted:#8a7c66}
*{box-sizing:border-box}body{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:var(--bg);color:var(--ink)}
header.top{background:linear-gradient(#3a2a18,#2b1f12);color:#f3e9d6;padding:12px 20px;display:flex;gap:16px;align-items:center}
header.top a{color:#e0a45e;text-decoration:none}header.top .grow{flex:1}
main{max-width:960px;margin:24px auto;padding:0 16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
h1,h2,h3{color:var(--accent);margin-top:0}
label{display:block;font-size:12px;color:var(--muted);margin:8px 0 2px}
input[type=text],input[type=password]{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;font:inherit}
button,.btn{background:var(--accent);color:#fff;border:none;border-radius:6px;padding:9px 16px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}
button:hover,.btn:hover{filter:brightness(1.1)}
.btn.sec{background:#6b543a}.btn.danger{background:#a33227}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;color:var(--muted);font-size:12px;text-transform:uppercase}
td,th{padding:7px 8px;border-bottom:1px dashed var(--line)}
code{background:#eee4cf;padding:2px 6px;border-radius:5px;font-size:13px;word-break:break-all}
.muted{color:var(--muted);font-size:13px}
form.inline{display:inline}
</style>`

var loginPageHTML = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход — PF2e Character Server</title>` + pageCSS + `</head><body>
<header class="top"><b>PF2e Character Server</b><span class="grow"></span><a href="/sheet.html">Чистый лист</a></header>
<main>
<div class="card" style="max-width:420px;margin:40px auto">
<h2>Вход</h2>
<form id="f">
<label>Логин</label><input type="text" id="u" autocomplete="username" required>
<label>Пароль</label><input type="password" id="p" autocomplete="current-password" required>
<p id="msg" class="muted"></p>
<button type="submit">Войти</button>
<button type="button" class="btn sec" id="reg">Регистрация</button>
</form>
<p class="muted">После входа — <a href="/user">страница пользователя</a> (данные, персонажи, API-ключи).</p>
</div>
</main>
<script>
async function call(path, body){
  const r = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(body)});
  const d = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
  return d;
}
document.getElementById('f').addEventListener('submit', async ev=>{
  ev.preventDefault();
  try{ await call('/api/login',{username:u.value,password:p.value}); location.href='/user'; }
  catch(e){ msg.textContent='Ошибка: '+e.message; }
});
document.getElementById('reg').addEventListener('click', async ()=>{
  try{ await call('/api/register',{username:u.value,password:p.value}); location.href='/user'; }
  catch(e){ msg.textContent='Ошибка: '+e.message; }
});
</script></body></html>`

func userPageHTML(u *User, chars []CharacterMeta, keys []*APIKey) string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>` +
		html.EscapeString(u.Username) + ` — PF2e Character Server</title>` + pageCSS + `</head><body>
<header class="top"><b>PF2e Character Server</b><span class="grow"></span>
<a href="/sheet.html">Чистый лист</a><a href="/user">` + html.EscapeString(u.Username) + `</a>
<form class="inline" method="post" action="/user/logout"><button class="btn danger" style="padding:4px 10px">Выход</button></form>
</header><main>`)

	// данные о пользователе
	b.WriteString(`<div class="card"><h2>Учётная запись</h2>
<table><tr><th>Логин</th><td>` + html.EscapeString(u.Username) + `</td></tr>
<tr><th>ID</th><td><code>` + html.EscapeString(u.ID) + `</code></td></tr>
<tr><th>Создана</th><td>` + u.CreatedAt.Format("2006-01-02 15:04 MST") + `</td></tr></table></div>`)

	// персонажи
	b.WriteString(`<div class="card"><h2>Персонажи</h2>`)
	if len(chars) == 0 {
		b.WriteString(`<p class="muted">Пока нет ни одного загруженного персонажа.</p>`)
	} else {
		b.WriteString(`<table><tr><th>Имя</th><th>Класс</th><th>Уровень</th><th>Обновлён</th><th>Размер</th><th></th></tr>`)
		for _, c := range chars {
			cls := c.Class
			if cls == "" {
				cls = "—"
			}
			b.WriteString(`<tr><td>` + html.EscapeString(c.Name) + `</td><td>` + html.EscapeString(cls) +
				`</td><td>` + fmt.Sprint(c.Level) + `</td><td>` +
				c.UpdatedAt.Local().Format("2006-01-02 15:04") + `</td><td>` +
				fmt.Sprintf("%.1f КБ", float64(c.Size)/1024) + `</td><td>
<a class="btn sec" href="/api/characters/`+html.EscapeString(c.ID)+`">JSON ⤓</a></td></tr>`)
		}
		b.WriteString(`</table>`)
	}
	b.WriteString(`</div>`)

	// API-ключи
	b.WriteString(`<div class="card"><h2>API-ключи</h2>
<p class="muted">Ключ передаётся в заголовке <code>X-API-Key</code>. Пример:
<code>curl -H "X-API-Key: …" http://` + `localhost:8090/api/characters</code></p>
<table><tr><th>Метка</th><th>Ключ</th><th>Создан</th><th>Использовался</th><th></th></tr>`)
	for _, k := range keys {
		lu := "—"
		if !k.LastUsed.IsZero() {
			lu = k.LastUsed.Local().Format("2006-01-02 15:04")
		}
		b.WriteString(`<tr><td>` + html.EscapeString(k.Label) + `</td><td><code>` + html.EscapeString(k.Token) +
			`</code></td><td>` + k.CreatedAt.Local().Format("2006-01-02 15:04") + `</td><td>` + lu + `</td><td>
<form class="inline" method="post" action="/user/keys/delete"><input type="hidden" name="token" value="`+html.EscapeString(k.Token)+`">
<button class="btn danger" style="padding:3px 10px">Удалить</button></form></td></tr>`)
	}
	b.WriteString(`</table>
<form method="post" action="/user/keys/create" style="margin-top:10px">
<input type="text" name="label" placeholder="Название ключа (например, «ноутбук»)" style="width:60%">
<button>Создать ключ</button></form></div>`)

	b.WriteString(`</main></body></html>`)
	return b.String()
}

var _ = time.Now
