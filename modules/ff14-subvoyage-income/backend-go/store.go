package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var (
	errUnauthorized = errors.New("上报令牌无效")
	errConflict     = errors.New("同一生成时间已经存在不同内容的快照")
)

const timestampLayout = "2006-01-02T15:04:05.000000000Z"

func timeKey(t time.Time) string { return t.UTC().Format(timestampLayout) }

type store struct{ db *sql.DB }

func openStore(dir string) (*store, error) {
	db, err := sql.Open("sqlite", filepath.Join(dir, "subvoyage.sqlite"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, alias TEXT NOT NULL, token BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS webhook (id INTEGER PRIMARY KEY CHECK(id=1), token BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS daily (
 company TEXT NOT NULL REFERENCES companies(id), day TEXT NOT NULL, generated TEXT NOT NULL, total INTEGER NOT NULL,
 payload BLOB NOT NULL, PRIMARY KEY(company,day)
);
CREATE INDEX IF NOT EXISTS daily_generated ON daily(company,generated DESC);
CREATE TABLE IF NOT EXISTS fleets (
 company TEXT PRIMARY KEY REFERENCES companies(id), generated TEXT NOT NULL, payload BLOB NOT NULL
);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &store{db}, nil
}

func newToken() (string, [32]byte, error) {
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", [32]byte{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(random[:])
	return token, sha256.Sum256([]byte(token)), nil
}
func (s *store) saveReport(ctx context.Context, token string, report snapshot) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var expected []byte
	err = tx.QueryRowContext(ctx, "SELECT token FROM webhook WHERE id=1").Scan(&expected)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	actual := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(expected, actual[:]) == 1 {
		// Keep the legacy token column so existing SQLite files and credentials remain valid.
		_, err = tx.ExecContext(ctx, "INSERT INTO companies(id,alias,token) VALUES(?,'',X'') ON CONFLICT(id) DO NOTHING", report.CompanyID)
		if err != nil {
			return "", err
		}
	} else {
		expected = nil
		err = tx.QueryRowContext(ctx, "SELECT token FROM companies WHERE id=?", report.CompanyID).Scan(&expected)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if subtle.ConstantTimeCompare(expected, actual[:]) != 1 {
			return "", errUnauthorized
		}
	}
	payload, err := json.Marshal(report)
	if err != nil {
		return "", err
	}
	generated := timeKey(report.GeneratedAt)
	var prior string
	var old []byte
	err = tx.QueryRowContext(ctx, "SELECT generated,payload FROM daily WHERE company=? AND day=?", report.CompanyID, report.Date).Scan(&prior, &old)
	switch {
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return "", err
	case prior == generated:
		if string(old) != string(payload) {
			return "", errConflict
		}
		return "duplicate", nil
	}
	status := "stale"
	if prior < generated {
		_, err = tx.ExecContext(ctx, "INSERT INTO daily(company,day,generated,total,payload) VALUES(?,?,?,?,?) ON CONFLICT(company,day) DO UPDATE SET generated=excluded.generated,total=excluded.total,payload=excluded.payload", report.CompanyID, report.Date, generated, report.Total, payload)
		if err != nil {
			return "", err
		}
		status = "accepted"
	}
	if report.Vessels != nil {
		fleetJSON, err := json.Marshal(fleet{report.GeneratedAt, report.Vessels})
		if err != nil {
			return "", err
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO fleets(company,generated,payload) VALUES(?,?,?) ON CONFLICT(company) DO UPDATE SET generated=excluded.generated,payload=excluded.payload WHERE excluded.generated>fleets.generated", report.CompanyID, generated, fleetJSON)
		if err != nil {
			return "", err
		}
	}
	return status, tx.Commit()
}
func readJSON[T any](row *sql.Row) (*T, error) {
	var data []byte
	if err := row.Scan(&data); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	var value T
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return &value, nil
}

const latestQuery = "SELECT payload FROM daily WHERE company=? ORDER BY generated DESC LIMIT 1"

func (s *store) listCompanies(ctx context.Context) ([]company, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,alias,(SELECT payload FROM daily WHERE company=companies.id ORDER BY generated DESC LIMIT 1) FROM companies ORDER BY alias,id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []company{}
	for rows.Next() {
		var c company
		var data []byte
		if err := rows.Scan(&c.ID, &c.Alias, &data); err != nil {
			return nil, err
		}
		if len(data) > 0 {
			var latest snapshot
			if err := json.Unmarshal(data, &latest); err != nil {
				return nil, err
			}
			c.profile = latest.profile
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

type trendPoint struct {
	Date  string `json:"date"`
	Total int64  `json:"totalGil"`
}
type view struct {
	dashboard
	Trend []trendPoint `json:"trend"`
}

func (s *store) view(ctx context.Context, id, month string, now time.Time) (*view, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	today := now.In(beijing).Format(time.DateOnly)
	result := &view{dashboard: dashboard{Today: today, Now: now, Month: month, Company: company{ID: id}, Months: []string{}, Reports: []snapshot{}}, Trend: []trendPoint{}}
	if err = tx.QueryRowContext(ctx, "SELECT alias FROM companies WHERE id=?", id).Scan(&result.Company.Alias); err != nil {
		return nil, err
	}
	result.Latest, err = readJSON[snapshot](tx.QueryRowContext(ctx, latestQuery, id))
	if err != nil {
		return nil, err
	}
	if result.Latest != nil {
		result.Company.profile = result.Latest.profile
	}
	result.TodayReport, err = readJSON[snapshot](tx.QueryRowContext(ctx, "SELECT payload FROM daily WHERE company=? AND day=?", id, today))
	if err != nil {
		return nil, err
	}
	var yesterday int64
	err = tx.QueryRowContext(ctx, "SELECT total FROM daily WHERE company=? AND day=?", id, now.In(beijing).AddDate(0, 0, -1).Format(time.DateOnly)).Scan(&yesterday)
	if err == nil {
		result.YesterdayTotal = &yesterday
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	result.Fleet, err = readJSON[fleet](tx.QueryRowContext(ctx, "SELECT payload FROM fleets WHERE company=?", id))
	if err != nil {
		return nil, err
	}

	months, err := tx.QueryContext(ctx, "SELECT DISTINCT substr(day,1,7) FROM daily WHERE company=? ORDER BY 1 DESC", id)
	if err != nil {
		return nil, err
	}
	for months.Next() {
		var value string
		if err = months.Scan(&value); err != nil {
			months.Close()
			return nil, err
		}
		result.Months = append(result.Months, value)
	}
	if err = months.Err(); err != nil {
		months.Close()
		return nil, err
	}
	months.Close()

	start, _ := time.Parse("2006-01", month)
	end := start.AddDate(0, 1, -1)
	if end.Format(time.DateOnly) > today {
		end, _ = time.Parse(time.DateOnly, today)
	}
	rows, err := tx.QueryContext(ctx, "SELECT day,total,CASE WHEN day>=? THEN payload ELSE NULL END FROM daily WHERE company=? AND day BETWEEN ? AND ? ORDER BY day", start.Format(time.DateOnly), id, end.AddDate(0, 0, -89).Format(time.DateOnly), end.Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var point trendPoint
		var data []byte
		if err = rows.Scan(&point.Date, &point.Total, &data); err != nil {
			return nil, err
		}
		result.Trend = append(result.Trend, point)
		if len(data) > 0 {
			var report snapshot
			if err = json.Unmarshal(data, &report); err != nil {
				return nil, err
			}
			result.Reports = append(result.Reports, report)
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	return result, tx.Commit()
}
