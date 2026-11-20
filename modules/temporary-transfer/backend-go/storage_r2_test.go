package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestR2MultipartProtocolAndPresignedRequests(t *testing.T) {
	const key = "transfers/test/file"
	const endpointPath = "/example/" + key
	requests := make(chan string, 12)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != endpointPath || !strings.Contains(r.Header.Get("Authorization"), "/auto/s3/aws4_request") {
			t.Error("unexpected signed S3 request")
			w.WriteHeader(400)
			return
		}
		q := r.URL.Query()
		w.Header().Set("Content-Type", "application/xml")
		switch {
		case r.Method == "POST" && q.Has("uploads"):
			requests <- "start"
			if r.Header.Get("Cache-Control") != "private, no-store" || !strings.Contains(r.Header.Get("Content-Disposition"), "filename*=UTF-8''") {
				t.Error("object metadata missing")
			}
			fmt.Fprint(w, `<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>`)
		case r.Method == "GET" && q.Get("uploadId") == "test-upload":
			requests <- "parts"
			if q.Get("part-number-marker") == "" {
				fmt.Fprint(w, `<ListPartsResult><IsTruncated>true</IsTruncated><NextPartNumberMarker>1</NextPartNumberMarker><Part><PartNumber>1</PartNumber><ETag>"first"</ETag><Size>5242880</Size></Part></ListPartsResult>`)
			} else {
				fmt.Fprint(w, `<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>2</PartNumber><ETag>"second"</ETag><Size>3</Size></Part></ListPartsResult>`)
			}
		case r.Method == "POST" && q.Get("uploadId") == "test-upload":
			requests <- "complete"
			data, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(data), "<PartNumber>2</PartNumber>") {
				t.Error("second part missing")
			}
			fmt.Fprint(w, `<CompleteMultipartUploadResult><ETag>"complete"</ETag></CompleteMultipartUploadResult>`)
		case r.Method == "HEAD":
			requests <- "head"
			w.Header().Set("Content-Length", "5242883")
		case r.Method == "DELETE" && q.Get("uploadId") == "test-upload":
			requests <- "abort"
			w.WriteHeader(404)
			fmt.Fprint(w, `<Error><Code>NoSuchUpload</Code></Error>`)
		case r.Method == "DELETE":
			requests <- "delete"
			w.WriteHeader(204)
		default:
			t.Errorf("unexpected S3 operation %v", r.Method)
			w.WriteHeader(400)
		}
	}))
	defer server.Close()
	cfg := r2Config{AccountID: strings.Repeat("a", 32), Bucket: "example", AccessKeyID: "synthetic-id", SecretAccessKey: "synthetic-secret"}
	r2 := newR2(cfg, server.URL, server.Client())
	id, err := r2.start(t.Context(), key, "文件.txt")
	if err != nil || id != "test-upload" {
		t.Fatalf("start failed %v", err)
	}
	if err = r2.complete(t.Context(), key, id, partSize+3); err != nil {
		t.Fatal(err)
	}
	if err = r2.abort(t.Context(), key, id); err != errNoUpload {
		t.Fatalf("missing upload error %v", err)
	}
	if err = r2.remove(t.Context(), key); err != nil {
		t.Fatal(err)
	}
	close(requests)
	var calls []string
	for call := range requests {
		calls = append(calls, call)
	}
	if strings.Join(calls, ",") != "start,parts,parts,complete,head,abort,delete" {
		t.Fatalf("unexpected S3 calls %v", calls)
	}
	prod := newR2(cfg, cfg.endpoint(), server.Client())
	signed, err := prod.signPart(t.Context(), key, id, 2, 3)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(signed)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if u.Scheme != "https" || !strings.HasSuffix(u.Host, ".r2.cloudflarestorage.com") || q.Get("X-Amz-Expires") != "300" ||
		q.Get("uploadId") != id || q.Get("partNumber") != "2" || !strings.Contains(q.Get("X-Amz-SignedHeaders"), "content-length") {
		t.Fatalf("incorrect upload URL claims: %s %v", u.Host, q.Get("X-Amz-SignedHeaders"))
	}
	signed, err = prod.download(t.Context(), key)
	if err != nil {
		t.Fatal(err)
	}
	u, err = url.Parse(signed)
	if err != nil || u.Query().Get("X-Amz-Expires") != "120" {
		t.Fatal("invalid download authorization")
	}
}
