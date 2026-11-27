package main

import (
	"bytes"
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
	create := call("POST", "/companies", companyInput{ID: id, Alias: "示例部队"}, true, "", http.StatusCreated)
	if err = json.Unmarshal(create, &credentials); err != nil {
		t.Fatal(err)
	}
	token := credentials["token"]
	call("GET", "/companies", nil, false, "", http.StatusForbidden)
	next := now.Add(time.Hour).Unix()
	price, subtotal := int64(2000), int64(6000)
	s := snapshot{Version: 1, Event: "subvoyage.income.summary", CompanyID: id, Date: "2026-11-27", GeneratedAt: now.Add(-time.Hour),
		Trigger: "manual", Total: 6000, Items: []item{{ID: 5060, Name: "玄钢锭", Quantity: 3, Price: &price, Subtotal: &subtotal}, {ID: 100, Name: "待估价", Quantity: 1}},
		Vessels: []vessel{{Slot: 1, Name: "苍蓝号", Next: &next}}}
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
	s.Total = 0
	s.Items = []item{}
	call("POST", "/public/reports", s, false, token, http.StatusOK)
	s.GeneratedAt = s.GeneratedAt.Add(-2 * time.Minute)
	s.Vessels = []vessel{}
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
	s.GeneratedAt = now
	call("POST", "/public/reports", s, false, token, http.StatusOK)
	if err = json.Unmarshal(call("GET", "/dashboard?companyId="+id, nil, true, "", http.StatusOK), &view); err != nil {
		t.Fatal(err)
	}
	if view.Fleet == nil || view.Fleet.Vessels == nil || len(view.Fleet.Vessels) != 0 {
		t.Fatal("empty fleet must clear earlier vessels")
	}
	call("GET", "/trend?companyId="+id+"&from=2026-11-26&to=2026-11-27", nil, true, "", http.StatusOK)
	call("GET", "/trend?companyId="+id+"&from=2026-11-01&to=2026-11-28", nil, true, "", http.StatusBadRequest)
	call("POST", "/companies/"+id+"/token", nil, true, "", http.StatusOK)
	call("POST", "/public/reports", s, false, token, http.StatusUnauthorized)
}
