// Package main — backend-сервер хранения листов персонажей PF2e.
//
//	Запуск:  go run .            (по умолчанию :8090)
//	Флаги:   -addr :8090 -data ./data -secret <ключ HMAC>
//
// Хранилище: файловое (JSON в каталоге data/), без внешних зависимостей.
// Авторизация: сессии (cookie, HMAC-подписанные) + API-ключи (заголовочные).
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const cookieName = "pf2e_session"

// ---------------------------------------------------------------------------
// Модели
// ---------------------------------------------------------------------------

type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"`
	PassHash     string    `json:"-"` // scrypt-подобный хеш (salt$iters$hex)
	CreatedAt    time.Time `json:"createdAt"`
	ServerSecret bool      `json:"serverSecret,omitempty"` // встроенный админ сервера
}

type APIKey struct {
	Token     string    `json:"token"`
	UserID    string    `json:"userId"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"createdAt"`
	LastUsed  time.Time `json:"lastUsed,omitempty"`
}

// CharacterMeta — краткая карточка для списков.
type CharacterMeta struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Class     string    `json:"class"`
	Level     int       `json:"level"`
	UpdatedAt time.Time `json:"updatedAt"`
	Size      int       `json:"size"`
}

type sessionInfo struct {
	UserID string
	Exp    int64
	Sig    string
}

// ---------------------------------------------------------------------------
// Хранилище
// ---------------------------------------------------------------------------

type Store struct {
	mu       sync.RWMutex
	dir      string
	users    map[string]*User          // username -> user
	userByID map[string]*User          // id -> user
	keys     map[string]*APIKey        // token -> key
	charDir  string                    // data/characters/<userID>/
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(filepath.Join(dir, "characters"), 0o755); err != nil {
		return nil, err
	}
	st := &Store{
		dir:      dir,
		charDir:  filepath.Join(dir, "characters"),
		users:    map[string]*User{},
		userByID: map[string]*User{},
		keys:     map[string]*APIKey{},
	}
	if err := st.load(); err != nil {
		return nil, err
	}
	return st, nil
}

func (s *Store) path(parts ...string) string { return filepath.Join(append([]string{s.dir}, parts...)...) }

func (s *Store) load() error {
	var users []*User
	if err := readJSON(s.path("users.json"), &users); err == nil {
		for _, u := range users {
			s.users[u.Username] = u
			s.userByID[u.ID] = u
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	var keys []*APIKey
	if err := readJSON(s.path("keys.json"), &keys); err == nil {
		for _, k := range keys {
			s.keys[k.Token] = k
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *Store) saveUsers() error {
	list := make([]*User, 0, len(s.users))
	for _, u := range s.users {
		list = append(list, u)
	}
	return writeJSON(s.path("users.json"), list)
}
func (s *Store) saveKeys() error {
	list := make([]*APIKey, 0, len(s.keys))
	for _, k := range s.keys {
		list = append(list, k)
	}
	return writeJSON(s.path("keys.json"), list)
}

func (s *Store) AddUser(username, pass string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[username]; ok {
		return nil, errors.New("пользователь уже существует")
	}
	hash, err := hashPassword(pass)
	if err != nil {
		return nil, err
	}
	u := &User{ID: newID("u"), Username: username, PassHash: hash, CreatedAt: time.Now().UTC()}
	s.users[username] = u
	s.userByID[u.ID] = u
	return u, s.saveUsers()
}

func (s *Store) Authenticate(username, pass string) (*User, bool) {
	s.mu.RLock()
	u := s.users[username]
	s.mu.RUnlock()
	if u == nil {
		return nil, false
	}
	ok, err := verifyPassword(u.PassHash, pass)
	if err != nil || !ok {
		return nil, false
	}
	return u, true
}

func (s *Store) User(id string) *User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.userByID[id]
}

func (s *Store) AddKey(userID, label string) *APIKey {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := &APIKey{Token: newToken(), UserID: userID, Label: label, CreatedAt: time.Now().UTC()}
	s.keys[k.Token] = k
	_ = s.saveKeys()
	return k
}

func (s *Store) DeleteKey(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.keys, token)
	_ = s.saveKeys()
}

func (s *Store) KeysForUser(userID string) []*APIKey {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []*APIKey
	for _, k := range s.keys {
		if k.UserID == userID {
			out = append(out, k)
		}
	}
	return out
}

// AuthorizeByKey возвращает пользователя по API-ключу из заголовка X-API-Key.
func (s *Store) AuthorizeByKey(r *http.Request) *User {
	tok := r.Header.Get("X-API-Key")
	if tok == "" {
		tok = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if tok == r.Header.Get("Authorization") {
			return nil // не Bearer
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.keys[tok]
	if !ok {
		return nil
	}
	k.LastUsed = time.Now().UTC()
	_ = s.saveKeys()
	return s.userByID[k.UserID]
}

// --- персонажи -------------------------------------------------------------

func (s *Store) charPath(userID, charID string) string {
	return filepath.Join(s.charDir, userID, sanitizeID(charID)+".json")
}

// sanitizeID — безопасное имя файла из id персонажа: только буквы, цифры,
// «-» и «_»; прочие символы (включая кириллицу) заменяются на «-».
func sanitizeID(id string) string {
	var b strings.Builder
	prevDash := false
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "c"
	}
	return out
}

func (s *Store) ListCharacters(userID string) ([]CharacterMeta, error) {
	dir := filepath.Join(s.charDir, userID)
	ents, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []CharacterMeta{}, nil
	}
	if err != nil {
		return nil, err
	}
	var out []CharacterMeta
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		out = append(out, metaFromJSON(raw))
	}
	return out, nil
}

func metaFromJSON(raw []byte) CharacterMeta {
	var doc struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Core struct {
			Class string `json:"class"`
			Level int    `json:"level"`
		} `json:"core"`
		Meta struct {
			UpdatedAt time.Time `json:"updatedAt"`
		} `json:"meta"`
	}
	_ = json.Unmarshal(raw, &doc)
	return CharacterMeta{
		ID: doc.ID, Name: doc.Name, Class: doc.Core.Class, Level: doc.Core.Level,
		UpdatedAt: doc.Meta.UpdatedAt, Size: len(raw),
	}
}

func (s *Store) GetCharacter(userID, charID string) ([]byte, error) {
	return os.ReadFile(s.charPath(userID, charID))
}

// SaveCharacter сохраняет JSON листа; id берётся из тела, если пуст — генерируется.
func (s *Store) SaveCharacter(userID string, body []byte, forcedID string) (CharacterMeta, error) {
	var doc map[string]interface{}
	if err := json.Unmarshal(body, &doc); err != nil {
		return CharacterMeta{}, fmt.Errorf("некорректный JSON: %w", err)
	}
	if _, ok := doc["name"]; !ok {
		return CharacterMeta{}, errors.New("в данных персонажа нет поля name")
	}
	id, _ := doc["id"].(string)
	if forcedID != "" {
		id = forcedID
		doc["id"] = forcedID
	}
	if id == "" {
		id = newID("c")
		doc["id"] = id
	}
	metaAny, _ := doc["meta"].(map[string]interface{})
	if metaAny == nil {
		metaAny = map[string]interface{}{}
		doc["meta"] = metaAny
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if _, ok := metaAny["createdAt"]; !ok {
		metaAny["createdAt"] = now
	}
	metaAny["updatedAt"] = now
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return CharacterMeta{}, err
	}
	dir := filepath.Join(s.charDir, userID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return CharacterMeta{}, err
	}
	tmp := s.charPath(userID, id) + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return CharacterMeta{}, err
	}
	if err := os.Rename(tmp, s.charPath(userID, id)); err != nil {
		return CharacterMeta{}, err
	}
	return metaFromJSON(out), nil
}

func (s *Store) DeleteCharacter(userID, charID string) error {
	err := os.Remove(s.charPath(userID, charID))
	if os.IsNotExist(err) {
		return errors.New("персонаж не найден")
	}
	return err
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func readJSON(path string, v interface{}) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v interface{}) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSONResp(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.Encode(v)
}

// maxBody — лимит на размер листа персонажа.
const maxBody = 4 << 20 // 4 MiB

func readCapped(r io.Reader) ([]byte, error) {
	return io.ReadAll(io.LimitReader(r, maxBody))
}

// ---------------------------------------------------------------------------
// Сервер
// ---------------------------------------------------------------------------

type Server struct {
	store      *Store
	sessionSec []byte
	startTime  time.Time
}

func (srv *Server) currentUser(r *http.Request) *User {
	// 1) API-ключ
	if u := srv.store.AuthorizeByKey(r); u != nil {
		return u
	}
	// 2) cookie-сессия
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	info, ok := parseSession(c.Value, srv.sessionSec)
	if !ok || info.Exp < time.Now().Unix() {
		return nil
	}
	return srv.store.User(info.UserID)
}

func (srv *Server) requireUser(w http.ResponseWriter, r *http.Request) (*User, bool) {
	u := srv.currentUser(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "требуется авторизация (войдите или передайте X-API-Key)")
		return nil, false
	}
	return u, true
}

func (srv *Server) routes() http.Handler {
	mux := newMux()

	// pathID извлекает id персонажа из URL вида /api/characters/<id>.
	// (Совместимо с Go < 1.22, где нет r.PathValue.)
	pathID := func(r *http.Request) string {
		return strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/characters/"), "/")
	}

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSONResp(w, 200, map[string]interface{}{"ok": true, "uptime": time.Since(srv.startTime).String()})
	})

	mux.HandleFunc("/api/register", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Username, Password string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
			writeErr(w, 400, "ожидался JSON {username,password}")
			return
		}
		if len(in.Username) < 3 || len(in.Password) < 6 {
			writeErr(w, 400, "логин ≥3 символов, пароль ≥6 символов")
			return
		}
		u, err := srv.store.AddUser(in.Username, in.Password)
		if err != nil {
			writeErr(w, 409, err.Error())
			return
		}
		// сразу выдаём сессионную cookie
		http.SetCookie(w, srv.sessionCookie(u.ID))
		writeJSONResp(w, 201, map[string]string{"status": "created", "username": u.Username})
	})

	mux.HandleFunc("/api/login", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Username, Password string }
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&in); err != nil {
			writeErr(w, 400, "ожидался JSON {username,password}")
			return
		}
		u, ok := srv.store.Authenticate(in.Username, in.Password)
		if !ok {
			writeErr(w, 401, "неверный логин или пароль")
			return
		}
		http.SetCookie(w, srv.sessionCookie(u.ID))
		writeJSONResp(w, 200, map[string]string{"status": "ok", "username": u.Username})
	})

	mux.HandleFunc("/api/logout", func(w http.ResponseWriter, r *http.Request) {
		cl := srv.sessionCookie("")
		cl.MaxAge = -1
		http.SetCookie(w, cl)
		writeJSONResp(w, 200, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/api/me", func(w http.ResponseWriter, r *http.Request) {
		u, ok := srv.requireUser(w, r)
		if !ok {
			return
		}
		chars, _ := srv.store.ListCharacters(u.ID)
		if chars == nil {
			chars = []CharacterMeta{}
		}
		writeJSONResp(w, 200, map[string]interface{}{"username": u.Username, "createdAt": u.CreatedAt, "characters": chars})
	})

	// --- персонажи ---
	mux.HandleFunc("/api/characters", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			u, ok := srv.requireUser(w, r)
			if !ok {
				return
			}
			chars, err := srv.store.ListCharacters(u.ID)
			if err != nil {
				writeErr(w, 500, err.Error())
				return
			}
			if chars == nil {
				chars = []CharacterMeta{}
			}
			writeJSONResp(w, 200, chars)
		case "POST":
			u, ok := srv.requireUser(w, r)
			if !ok {
				return
			}
			body, err := readCapped(r.Body)
			if err != nil {
				writeErr(w, 400, "не удалось прочитать тело")
				return
			}
			meta, err := srv.store.SaveCharacter(u.ID, body, "")
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			writeJSONResp(w, 201, map[string]interface{}{"status": "created", "character": meta})
		default:
			writeErr(w, 405, "метод не поддерживается")
		}
	})

	mux.HandleFunc("/api/characters/", func(w http.ResponseWriter, r *http.Request) {
		u, ok := srv.requireUser(w, r)
		if !ok {
			return
		}
		id := pathID(r)
		if id == "" {
			writeErr(w, 404, "персонаж не найден")
			return
		}
		switch r.Method {
		case "GET":
			raw, err := srv.store.GetCharacter(u.ID, id)
			if err != nil {
				writeErr(w, 404, "персонаж не найден")
				return
			}
			w.Header().Set("Content-Disposition", `attachment; filename="`+id+`.json"`)
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.Write(raw)
		case "PUT":
			body, err := readCapped(r.Body)
			if err != nil {
				writeErr(w, 400, "не удалось прочитать тело")
				return
			}
			meta, err := srv.store.SaveCharacter(u.ID, body, id)
			if err != nil {
				writeErr(w, 400, err.Error())
				return
			}
			writeJSONResp(w, 200, map[string]interface{}{"status": "updated", "character": meta})
		case "DELETE":
			if err := srv.store.DeleteCharacter(u.ID, id); err != nil {
				writeErr(w, 404, err.Error())
				return
			}
			writeJSONResp(w, 200, map[string]string{"status": "deleted"})
		default:
			writeErr(w, 405, "метод не поддерживается")
		}
	})

	// --- HTML-страницы ---
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			// статика фронтенда (style.css/app.js при разработке)
			frontendFileServer().ServeHTTP(w, r)
			return
		}
		http.Redirect(w, r, "/sheet.html", http.StatusFound)
	})
	mux.HandleFunc("/sheet.html", srv.serveSheet(false))
	mux.HandleFunc("/sheet-empty.html", srv.serveSheet(true))
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, loginPageHTML)
	})
	mux.HandleFunc("/user", func(w http.ResponseWriter, r *http.Request) {
		u := srv.currentUser(r)
		if u == nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		chars, _ := srv.store.ListCharacters(u.ID)
		if chars == nil {
			chars = []CharacterMeta{}
		}
		keys := srv.store.KeysForUser(u.ID)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, userPageHTML(u, chars, keys))
	})
	mux.HandleFunc("/user/keys/create", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, "метод не поддерживается")
			return
		}
		u := srv.currentUser(r)
		if u == nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		label := r.FormValue("label")
		if label == "" {
			label = "ключ " + time.Now().Format("2006-01-02 15:04")
		}
		srv.store.AddKey(u.ID, label)
		http.Redirect(w, r, "/user", http.StatusFound)
	})
	mux.HandleFunc("/user/keys/delete", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, "метод не поддерживается")
			return
		}
		u := srv.currentUser(r)
		if u == nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}
		srv.store.DeleteKey(r.FormValue("token"))
		http.Redirect(w, r, "/user", http.StatusFound)
	})
	mux.HandleFunc("/user/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			writeErr(w, 405, "метод не поддерживается")
			return
		}
		cl := srv.sessionCookie("")
		cl.MaxAge = -1
		http.SetCookie(w, cl)
		http.Redirect(w, r, "/login", http.StatusFound)
	})

	return corsMiddleware(mux)
}

// frontendFileServer — раздача статики фронтенда (для разработки).
func frontendFileServer() http.Handler {
	return http.StripPrefix("/", http.FileServer(http.Dir(frontendDir)))
}

// newMux — обычный http.ServeMux; маршрутизация по методу выполняется в хендлерах,
// чтобы код собирался под Go < 1.22 (без "METHOD /path" синтаксиса и r.PathValue).
func newMux() *http.ServeMux { return http.NewServeMux() }

// serveSheet раздаёт собранный sheet.html; empty=true — без встроенных данных.
func (srv *Server) serveSheet(empty bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(frontendDir, "sheet.html")
		if empty {
			path = filepath.Join(frontendDir, "sheet-empty.html")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			writeErr(w, 500, "sheet не собран: "+err.Error())
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(b)
	}
}

var frontendDir = "../frontend"

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,X-API-Key,Authorization")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	addr := flag.String("addr", ":8090", "адрес слушания")
	data := flag.String("data", "./data", "каталог данных")
	secret := flag.String("secret", "", "секрет подписи сессий (по умолчанию — файл в data/)")
	fe := flag.String("frontend", "../frontend", "каталог собранного фронтенда")
	flag.Parse()
	frontendDir = *fe

	if err := os.MkdirAll(*data, 0o755); err != nil {
		log.Fatal(err)
	}
	sec := []byte(*secret)
	if len(sec) == 0 {
		secPath := filepath.Join(*data, "session.secret")
		if b, err := os.ReadFile(secPath); err == nil {
			sec = b
		} else {
			sec = make([]byte, 32)
			randomBytes(sec)
			os.WriteFile(secPath, sec, 0o600)
		}
	}

	store, err := NewStore(*data)
	if err != nil {
		log.Fatal(err)
	}
	srv := &Server{store: store, sessionSec: sec, startTime: time.Now()}

	s := &http.Server{
		Addr:              *addr,
		Handler:           srv.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("PF2e charsrv запущен на http://localhost%s (данные: %s)", *addr, *data)
	log.Fatal(s.ListenAndServe())
}
