package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
	_ "modernc.org/sqlite"
)

type transferStore struct {
	db  *sql.DB
	key []byte
}

type dbQuery interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

type storedFile struct {
	ID, key, filename, state, backend string
	size                              int64
	uploadID                          sql.NullString
}

type accessData struct {
	ID        string
	Title     string
	Content   *string
	ExpiresAt int64
	pin       string
}

func nowMS() int64 { return time.Now().UnixMilli() }

func readOrCreateKey(dir, filename string) ([]byte, error) {
	path := filepath.Join(dir, filename)
	key, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		value := make([]byte, 32)
		if _, err = rand.Read(value); err != nil {
			return nil, err
		}
		f, createErr := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		switch {
		case errors.Is(createErr, os.ErrExist):
			key, err = os.ReadFile(path)
		case createErr != nil:
			return nil, createErr
		default:
			_, err = f.Write(value)
			if err == nil {
				err = f.Sync()
			}
			err = errors.Join(err, f.Close())
			key = value
		}
	}
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("invalid %s length", filename)
	}
	return key, nil
}

func openStore(ctx context.Context, dir string) (*transferStore, error) {
	key, err := readOrCreateKey(dir, "share-key")
	if err != nil {
		return nil, err
	}
	fileName, err := filepath.Abs(filepath.Join(dir, "transfers.sqlite"))
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(fileName)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	uri := url.URL{Scheme: "file", Path: uriPath, RawQuery: "_pragma=busy_timeout%285000%29&_pragma=foreign_keys%281%29&_pragma=secure_delete%281%29&_txlock=immediate"}
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &transferStore{db: db, key: key}
	if err = store.migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *transferStore) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, "PRAGMA journal_mode=WAL"); err != nil {
		return err
	}
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, schema); err != nil {
			return err
		}
		transferCols, err := tableColumns(ctx, tx, "transfers")
		if err != nil {
			return err
		}
		fileCols, err := tableColumns(ctx, tx, "files")
		if err != nil {
			return err
		}
		for _, column := range []struct {
			table, name, definition string
			cols                    map[string]bool
		}{
			{"transfers", "state", "TEXT NOT NULL DEFAULT 'ready'", transferCols},
			{"transfers", "exhausted_at", "INTEGER", transferCols},
			{"transfers", "content_kind", "TEXT NOT NULL DEFAULT 'text'", transferCols},
			{"transfers", "file_total", "INTEGER NOT NULL DEFAULT 0", transferCols},
			{"transfers", "size_bytes", "INTEGER NOT NULL DEFAULT 0", transferCols},
			{"transfers", "pickup_hash", "TEXT", transferCols},
			{"transfers", "pickup_counter", "INTEGER NOT NULL DEFAULT 0", transferCols},
			{"files", "cleanup_attempts", "INTEGER NOT NULL DEFAULT 0", fileCols},
			{"files", "cleanup_last_at", "INTEGER", fileCols},
			{"files", "storage_backend", "TEXT NOT NULL DEFAULT 'r2'", fileCols},
		} {
			if !column.cols[column.name] {
				if _, err := tx.ExecContext(ctx, "ALTER TABLE "+column.table+" ADD COLUMN "+column.name+" "+column.definition); err != nil {
					return err
				}
			}
		}
		if !transferCols["content_kind"] {
			if _, err := tx.ExecContext(ctx, `UPDATE transfers SET
                content_kind = CASE WHEN EXISTS(SELECT 1 FROM files f WHERE f.transfer_id=transfers.id) OR state='uploading' THEN 'files' ELSE 'text' END,
                file_total = (SELECT COUNT(*) FROM files f WHERE f.transfer_id=transfers.id),
                size_bytes = (SELECT COALESCE(SUM(f.size),0) FROM files f WHERE f.transfer_id=transfers.id) + COALESCE(length(CAST(text_content AS BLOB)),0)`); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "CREATE UNIQUE INDEX IF NOT EXISTS transfers_pickup_hash ON transfers(pickup_hash)"); err != nil {
			return err
		}
		pending, err := queryMaps(ctx, tx, "SELECT id,code_salt FROM transfers WHERE pickup_hash IS NULL")
		if err != nil {
			return err
		}
		for _, row := range pending {
			id, salt := row["id"].(string), row["code_salt"].(string)
			_, hash, counter, err := s.allocatePickup(ctx, tx, id, salt)
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, "UPDATE transfers SET pickup_hash=?,pickup_counter=? WHERE id=?", hash, counter, id); err != nil {
				return err
			}
		}
		return nil
	})
}

func tableColumns(ctx context.Context, q dbQuery, table string) (map[string]bool, error) {
	rows, err := queryMaps(ctx, q, "PRAGMA table_info("+table+")")
	if err != nil {
		return nil, err
	}
	columns := make(map[string]bool, len(rows))
	for _, row := range rows {
		columns[row["name"].(string)] = true
	}
	return columns, nil
}

func (s *transferStore) transaction(ctx context.Context, action func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = action(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func queryMaps(ctx context.Context, q dbQuery, query string, args ...any) ([]map[string]any, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	refs := make([]any, len(columns))
	for i := range values {
		refs[i] = &values[i]
	}
	results := make([]map[string]any, 0)
	for rows.Next() {
		if err := rows.Scan(refs...); err != nil {
			return nil, err
		}
		result := make(map[string]any, len(columns))
		for i, name := range columns {
			result[name] = values[i]
		}
		results = append(results, result)
	}
	return results, rows.Err()
}

func mac(key []byte, value string) []byte {
	hash := hmac.New(sha256.New, key)
	_, _ = hash.Write([]byte(value))
	return hash.Sum(nil)
}

func (s *transferStore) deriveCode(id, salt string) string {
	for i := 0; ; i++ {
		value := binary.BigEndian.Uint32(mac(s.key, fmt.Sprintf("%s:%s:%d", id, salt, i)))
		if value < 4294000000 {
			return fmt.Sprintf("%06d", value%1000000)
		}
	}
}

func (s *transferStore) pickupCode(id, salt string, i int) string {
	// Node uses Number.toString(32), whose alphabet is 0–9 and A–V.
	bits := binary.BigEndian.Uint64(mac(s.key, fmt.Sprintf("pickup:%s:%s:%d", id, salt, i))) >> 24
	const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
	var text [8]byte
	for i := len(text) - 1; i >= 0; i-- {
		text[i] = digits[bits&31]
		bits >>= 5
	}
	return string(text[:])
}

func (s *transferStore) pickupHash(code string) string {
	return hex.EncodeToString(mac(s.key, "pickup-index:"+code))
}

func (s *transferStore) allocatePickup(ctx context.Context, q dbQuery, id, salt string) (code, hash string, counter int, err error) {
	for counter = 0; ; counter++ {
		code = s.pickupCode(id, salt, counter)
		hash = s.pickupHash(code)
		var exists int
		err = q.QueryRowContext(ctx, "SELECT 1 FROM transfers WHERE pickup_hash=?", hash).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return code, hash, counter, nil
		}
		if err != nil {
			return "", "", 0, err
		}
	}
}

func pinHash(pin, salt string) ([]byte, error) {
	return scrypt.Key([]byte(pin), []byte(salt), 16384, 8, 1, 32)
}

func randomBytes(n int) ([]byte, error) {
	out := make([]byte, n)
	_, err := rand.Read(out)
	return out, err
}

func (s *transferStore) create(ctx context.Context, owner, title, kind string, content *string, expires int64, maxGrants *int64, quota int64) (map[string]any, error) {
	key, err := randomBytes(24)
	if err != nil {
		return nil, err
	}
	id := base64.RawURLEncoding.EncodeToString(key)
	saltBytes, err := randomBytes(16)
	if err != nil {
		return nil, err
	}
	salt := hex.EncodeToString(saltBytes)
	pin := s.deriveCode(id, salt)
	pinBytes, err := pinHash(pin, salt)
	if err != nil {
		return nil, err
	}
	state, size := "uploading", int64(0)
	if content != nil {
		state, size = "ready", int64(len(*content))
	}
	var created int64
	var pickup string
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM transfers WHERE owner_id=? AND revoked_at IS NULL AND expires_at>?", owner, nowMS()).Scan(&count); err != nil {
			return err
		}
		if count >= 1000 {
			return clientError(400, "有效投递数量已达上限")
		}
		if content != nil {
			used, err := usage(ctx, tx)
			if err != nil {
				return err
			}
			if used+size > quota {
				return clientError(400, "暂存空间不足")
			}
		}
		code, hash, counter, err := s.allocatePickup(ctx, tx, id, salt)
		if err != nil {
			return err
		}
		pickup, created = code, nowMS()
		_, err = tx.ExecContext(ctx, `INSERT INTO transfers
            (id,owner_id,title,text_content,code_salt,code_hash,created_at,expires_at,max_grants,state,content_kind,size_bytes,pickup_hash,pickup_counter)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, owner, title, content, salt, hex.EncodeToString(pinBytes), created, expires, maxGrants, state, kind, size, hash, counter)
		return err
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "code": pin, "pickupCode": pickup, "createdAt": created, "expiresAt": expires}, nil
}

func usage(ctx context.Context, q dbQuery) (int64, error) {
	var n int64
	err := q.QueryRowContext(ctx, `SELECT (SELECT COALESCE(SUM(size),0) FROM files)+(SELECT COALESCE(SUM(length(CAST(text_content AS BLOB))),0) FROM transfers)`).Scan(&n)
	return n, err
}

func changed(ctx context.Context, q dbQuery, query string, args ...any) (bool, error) {
	result, err := q.ExecContext(ctx, query, args...)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

func (s *transferStore) verify(ctx context.Context, q dbQuery, id, pin string) (*accessData, error) {
	data := &accessData{ID: id, pin: pin}
	var salt, hash, state string
	var revoked, maxGrants sql.NullInt64
	var grants int64
	err := q.QueryRowContext(ctx, `SELECT title,text_content,expires_at,code_salt,code_hash,state,revoked_at,max_grants,grant_count
      FROM transfers WHERE id=?`, id).Scan(&data.Title, &data.Content, &data.ExpiresAt, &salt, &hash, &state, &revoked, &maxGrants, &grants)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	expected := make([]byte, 32)
	if errors.Is(err, sql.ErrNoRows) {
		salt = strings.Repeat("0", 32)
	} else {
		expected, _ = hex.DecodeString(hash)
	}
	actual, hashErr := pinHash(pin, salt)
	if hashErr != nil {
		return nil, hashErr
	}
	if !hmac.Equal(expected, actual) || err != nil || state != "ready" || revoked.Valid || data.ExpiresAt <= nowMS() || (maxGrants.Valid && grants >= maxGrants.Int64) {
		return nil, nil
	}
	return data, nil
}

func (s *transferStore) share(ctx context.Context, owner, id string) (pin, pickup string, err error) {
	var salt, hash string
	var counter int
	err = s.db.QueryRowContext(ctx, `SELECT code_salt,code_hash,pickup_counter FROM transfers
      WHERE id=? AND owner_id=? AND state='ready' AND revoked_at IS NULL AND expires_at>?
      AND (max_grants IS NULL OR grant_count<max_grants)`, id, owner, nowMS()).Scan(&salt, &hash, &counter)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	pin = s.deriveCode(id, salt)
	expected, _ := hex.DecodeString(hash)
	actual, err := pinHash(pin, salt)
	if err != nil || !hmac.Equal(expected, actual) {
		return "", "", err
	}
	return pin, s.pickupCode(id, salt, counter), nil
}

func (s *transferStore) rotate(ctx context.Context, owner, id string) (string, error) {
	raw, err := randomBytes(16)
	if err != nil {
		return "", err
	}
	salt := hex.EncodeToString(raw)
	pin := s.deriveCode(id, salt)
	hash, err := pinHash(pin, salt)
	if err != nil {
		return "", err
	}
	var ok bool
	err = s.transaction(ctx, func(tx *sql.Tx) error {
		_, pickup, counter, err := s.allocatePickup(ctx, tx, id, salt)
		if err != nil {
			return err
		}
		ok, err = changed(ctx, tx, `UPDATE transfers SET code_salt=?,code_hash=?,pickup_hash=?,pickup_counter=?
          WHERE id=? AND owner_id=? AND revoked_at IS NULL AND expires_at>?`, salt, hex.EncodeToString(hash), pickup, counter, id, owner, nowMS())
		return err
	})
	if !ok || err != nil {
		return "", err
	}
	return pin, nil
}
