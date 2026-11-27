package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSnapshotsThroughRoutes(t *testing.T) {
	db, err := openStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.db.Close() })
	now := time.Date(2026, 11, 27, 4, 0, 0, 0, time.UTC)
	routes := (&server{store: db, token: "internal", now: func() time.Time { return now }}).routes()
	call := func(method, path string, body any, admin bool, token string, status int) []byte {
		t.Helper()
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(payload))
		r.Header.Set("X-Toolnest-Internal-Token", "internal")
		if admin {
			r.Header.Set("X-Toolnest-User-Is-Admin", "true")
		}
		if token != "" {
			r.Header.Set("X-ToolNest-Token", token)
		}
		w := httptest.NewRecorder()
		routes.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s status %d, expected %d: %s", method, path, w.Code, status, w.Body)
		}
		return w.Body.Bytes()
	}
	var credentials map[string]string
	id := "18446744073709551615"
	call("POST", "/companies", companyInput{ID: id}, true, "", http.StatusMethodNotAllowed)
	call("POST", "/webhook/token", nil, false, "", http.StatusForbidden)
	call("PUT", "/webhook/token", nil, true, "", http.StatusConflict)
	create := call("POST", "/webhook/token", nil, true, "", http.StatusCreated)
	if err = json.Unmarshal(create, &credentials); err != nil {
		t.Fatal(err)
	}
	token := credentials["token"]
	call("POST", "/webhook/token", nil, true, "", http.StatusConflict)
	status := call("GET", "/webhook", nil, true, "", http.StatusOK)
	if string(bytes.TrimSpace(status)) != `{"configured":true}` {
		t.Fatalf("status must only expose whether a webhook is configured: %s", status)
	}
	call("GET", "/companies", nil, false, "", http.StatusForbidden)
	next := now.Add(time.Hour).Unix()
	price, subtotal := int64(2000), int64(6000)
	members := 42
	s := snapshot{Version: 1, Event: "subvoyage.income.summary", CompanyID: id, Date: "2026-11-27", GeneratedAt: time.Date(2026, 11, 27, 1, 0, 0, 0, beijing),
		profile: profile{TotalMembers: &members},
		Trigger: "manual", Total: 6000, Items: []item{{ID: 5060, Name: "玄钢锭", Quantity: 3, Price: &price, Subtotal: &subtotal}, {ID: 100, Name: "待估价", Quantity: 1}},
		Vessels: []vessel{{Slot: 1, Name: "苍蓝号", Next: &next}}}
	call("POST", "/public/reports", s, false, "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG", http.StatusUnauthorized)
	malformed := s
	malformed.Total++
	call("POST", "/public/reports", malformed, false, token, http.StatusBadRequest)
	if got := call("GET", "/companies", nil, true, "", http.StatusOK); string(bytes.TrimSpace(got)) != "[]" {
		t.Fatalf("only a valid first report may create a company: %s", got)
	}
	if got := call("POST", "/public/reports", s, false, token, http.StatusOK); !bytes.Contains(got, []byte("accepted")) {
		t.Fatal(string(got))
	}
	s.Items[0], s.Items[1] = s.Items[1], s.Items[0]
	if got := call("POST", "/public/reports", s, false, token, http.StatusOK); !bytes.Contains(got, []byte("duplicate")) {
		t.Fatal(string(got))
	}
	s.Trigger = "completion"
	call("POST", "/public/reports", s, false, token, http.StatusConflict)
	s.GeneratedAt = s.GeneratedAt.Add(time.Minute)
	s.Vessels = nil
	s.TotalMembers = nil
	s.Total = 0
	s.Items = []item{}
	call("POST", "/public/reports", s, false, token, http.StatusOK)
	s.GeneratedAt = s.GeneratedAt.Add(-2 * time.Minute)
	s.Vessels = []vessel{}
	olderMembers := 25
	s.TotalMembers = &olderMembers
	if got := call("POST", "/public/reports", s, false, token, http.StatusOK); !bytes.Contains(got, []byte("stale")) {
		t.Fatal(string(got))
	}
	var view view
	if err = json.Unmarshal(call("GET", "/dashboard?companyId="+id, nil, true, "", http.StatusOK), &view); err != nil {
		t.Fatal(err)
	}
	if view.TodayReport == nil || view.TodayReport.Total != 0 || view.Fleet == nil || len(view.Fleet.Vessels) != 1 || view.Company.ID != id {
		t.Fatalf("unexpected view: %+v", view)
	}
	if view.Company.TotalMembers == nil || *view.Company.TotalMembers != members {
		t.Fatalf("dashboard must retain the latest known member count: %+v", view.Company)
	}
	var listed []company
	if err := json.Unmarshal(call("GET", "/companies", nil, true, "", http.StatusOK), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].TotalMembers == nil || *listed[0].TotalMembers != members {
		t.Fatalf("company list must retain the same member count: %+v", listed)
	}
	s.TotalMembers = nil
	s.GeneratedAt = now
	call("POST", "/public/reports", s, false, token, http.StatusOK)
	if err = json.Unmarshal(call("GET", "/dashboard?companyId="+id, nil, true, "", http.StatusOK), &view); err != nil {
		t.Fatal(err)
	}
	if view.Fleet == nil || view.Fleet.Vessels == nil || len(view.Fleet.Vessels) != 0 {
		t.Fatal("empty fleet must clear earlier vessels")
	}

	backfill := s
	backfill.Date = "2026-11-27"
	backfill.GeneratedAt = time.Date(2026, 11, 25, 16, 15, 0, 0, time.UTC)
	backfill.Total = subtotal
	backfill.Items = []item{{ID: 5060, Name: "玄钢锭", Quantity: 3, Price: &price, Subtotal: &subtotal}}
	backfill.Vessels = nil
	if got := call("POST", "/public/reports", backfill, false, token, http.StatusOK); !bytes.Contains(got, []byte("accepted")) {
		t.Fatal(string(got))
	}
	var saved *snapshot
	if err := json.Unmarshal(call("GET", "/reports/2026-11-26?companyId="+id, nil, true, "", http.StatusOK), &saved); err != nil {
		t.Fatal(err)
	}
	if saved == nil || saved.Date != "2026-11-26" || saved.Total != backfill.Total || !saved.GeneratedAt.Equal(backfill.GeneratedAt) {
		t.Fatalf("backfilled report must use the Beijing generation date and retain the generation time: %+v", saved)
	}

	backfill.Date = "2026-11-26"
	backfill.GeneratedAt = now
	amount := int64(927159)
	backfill.Total = amount
	backfill.Items = []item{{ID: 5060, Name: "玄钢锭", Quantity: 1, Price: &amount, Subtotal: &amount}}
	if got := call("POST", "/public/reports", backfill, false, token, http.StatusOK); !bytes.Contains(got, []byte("accepted")) {
		t.Fatal(string(got))
	}
	saved = nil
	if err := json.Unmarshal(call("GET", "/reports/2026-11-26?companyId="+id, nil, true, "", http.StatusOK), &saved); err != nil {
		t.Fatal(err)
	}
	if saved == nil || saved.Date != backfill.Date || saved.Total != backfill.Total || !saved.GeneratedAt.Equal(backfill.GeneratedAt) {
		t.Fatalf("historical income must retain its reported date and the actual generation time: %+v", saved)
	}
	if err := json.Unmarshal(call("GET", "/dashboard?companyId="+id, nil, true, "", http.StatusOK), &view); err != nil {
		t.Fatal(err)
	}
	if view.YesterdayTotal == nil || *view.YesterdayTotal != backfill.Total || view.TodayReport == nil || view.TodayReport.Total != 0 {
		t.Fatalf("backfilled income must count toward yesterday while preserving today's report: %+v", view)
	}
	backfill.GeneratedAt = now.Add(6 * time.Minute)
	call("POST", "/public/reports", backfill, false, token, http.StatusBadRequest)

	var trend []trendPoint
	if err := json.Unmarshal(call("GET", "/trend?companyId="+id+"&from=2026-11-26&to=2026-11-27", nil, true, "", http.StatusOK), &trend); err != nil {
		t.Fatal(err)
	}
	if len(trend) != 2 || trend[0] != (trendPoint{Date: "2026-11-26", Total: amount}) || trend[1] != (trendPoint{Date: "2026-11-27", Total: 0}) {
		t.Fatalf("unexpected income trend after backfill: %+v", trend)
	}
	call("GET", "/trend?companyId="+id+"&from=2026-11-01&to=2026-11-28", nil, true, "", http.StatusBadRequest)
	second := s
	second.CompanyID = "472"
	call("POST", "/public/reports", second, false, token, http.StatusOK)
	call("GET", "/dashboard?companyId="+second.CompanyID, nil, true, "", http.StatusOK)

	legacyToken, legacyDigest, err := newToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.db.ExecContext(context.Background(), "INSERT INTO companies(id,alias,token) VALUES('73','旧部队',?)", legacyDigest[:]); err != nil {
		t.Fatal(err)
	}
	call("POST", "/public/reports", s, false, legacyToken, http.StatusUnauthorized)
	legacy := s
	legacy.CompanyID = "73"
	call("POST", "/public/reports", legacy, false, legacyToken, http.StatusOK)

	rotation := call("PUT", "/webhook/token", nil, true, "", http.StatusOK)
	if err := json.Unmarshal(rotation, &credentials); err != nil {
		t.Fatal(err)
	}
	call("POST", "/public/reports", s, false, token, http.StatusUnauthorized)
	call("POST", "/public/reports", s, false, credentials["token"], http.StatusOK)
	call("POST", "/public/reports", legacy, false, legacyToken, http.StatusOK)
}

func TestMemberCountFromExistingSnapshots(t *testing.T) {
	dir := t.TempDir()
	db, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.db.Exec(`
DROP TABLE company_members;
INSERT INTO companies (id,alias,token) VALUES ('1','',X'');
INSERT INTO daily (company,day,generated,total,payload) VALUES
 ('1','2026-11-25','2026-11-25T04:00:00.000000000Z',0,'{"companyTotalMembers":35}'),
 ('1','2026-11-26','2026-11-26T04:00:00.000000000Z',0,'{"companyTotalMembers":42}'),
 ('1','2026-11-27','2026-11-27T04:00:00.000000000Z',0,'{"companyTotalMembers":null}');`)
	closeErr := db.db.Close()
	if err != nil {
		t.Fatal(err)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}

	db, err = openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.db.Close() })
	companies, err := db.listCompanies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(companies) != 1 || companies[0].TotalMembers == nil || *companies[0].TotalMembers != 42 {
		t.Fatalf("existing database must recover the latest known member count: %+v", companies)
	}
}
