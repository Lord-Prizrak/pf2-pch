package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Пароли: salt + многократный SHA-256 (без внешних зависимостей).
// Формат хеша: v1$<saltHex>$<iters>$<hashHex>
// ---------------------------------------------------------------------------

const pwIters = 20000

func hashPassword(pass string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	h := deriveKey(salt, pass, pwIters)
	return fmt.Sprintf("v1$%s$%d$%x", hex.EncodeToString(salt), pwIters, h), nil
}

func deriveKey(salt []byte, pass string, iters int) []byte {
	cur := append(append([]byte{}, salt...), []byte(pass)...)
	for i := 0; i < iters; i++ {
		sum := sha256.Sum256(cur)
		cur = sum[:]
	}
	return cur
}

func verifyPassword(stored, pass string) (bool, error) {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "v1" {
		return false, errors.New("неизвестный формат хеша пароля")
	}
	salt, err := hex.DecodeString(parts[1])
	if err != nil {
		return false, err
	}
	iters, err := strconv.Atoi(parts[2])
	if err != nil {
		return false, err
	}
	want, err := hex.DecodeString(parts[3])
	if err != nil {
		return false, err
	}
	got := deriveKey(salt, pass, iters)
	return hmac.Equal(got, want), nil
}

// ---------------------------------------------------------------------------
// Сессии: подписанная HMAC cookie вида base64(userID.exp).hexSig
// ---------------------------------------------------------------------------

const sessionTTL = 30 * 24 * time.Hour

func (srv *Server) sessionCookie(userID string) *http.Cookie {
	cl := &http.Cookie{
		Name:     cookieName,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionTTL.Seconds()),
	}
	if userID == "" {
		cl.Value = ""
		return cl
	}
	exp := time.Now().Add(sessionTTL).Unix()
	payload := fmt.Sprintf("%s.%d", userID, exp)
	sig := sign([]byte(payload), srv.sessionSec)
	cl.Value = base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
	return cl
}

func sign(data, key []byte) string {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return hex.EncodeToString(m.Sum(nil))
}

func parseSession(value string, sec []byte) (*sessionInfo, bool) {
	dot := strings.LastIndex(value, ".")
	if dot < 0 {
		return nil, false
	}
	payloadB64, sig := value[:dot], value[dot+1:]
	raw, err := base64.RawURLEncoding.DecodeString(payloadB64)
	if err != nil {
		return nil, false
	}
	if !hmac.Equal([]byte(sign(raw, sec)), []byte(sig)) {
		return nil, false
	}
	parts := strings.SplitN(string(raw), ".", 2)
	if len(parts) != 2 {
		return nil, false
	}
	exp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return nil, false
	}
	return &sessionInfo{UserID: parts[0], Exp: exp, Sig: sig}, true
}

// ---------------------------------------------------------------------------
// ID и токены
// ---------------------------------------------------------------------------

func newID(prefix string) string {
	b := make([]byte, 8)
	rand.Read(b)
	return prefix + "-" + hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return "pf2e_" + hex.EncodeToString(b)
}

func randomBytes(b []byte) { rand.Read(b) }
