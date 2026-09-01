package main

import (
	"os"
	"path/filepath"
	"testing"

	bolt "go.etcd.io/bbolt"
)

func createTestDatabase(t *testing.T, path string, values map[string]string) {
	t.Helper()
	db, err := bolt.Open(path, 0o600, nil)
	if err != nil {
		t.Fatal(err)
	}
	err = db.Update(func(tx *bolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists([]byte(bucketName))
		if err != nil {
			return err
		}
		for key, value := range values {
			if err := bucket.Put([]byte(key), []byte(value)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestExportAndImportRoundTrip(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	exported := filepath.Join(dir, "devices.json")
	restored := filepath.Join(dir, "restored.db")
	values := map[string]string{"alpha": "token-a", "beta": "", "gamma": "token-c"}
	createTestDatabase(t, source, values)

	payload, err := exportDatabase(source, exported)
	if err != nil {
		t.Fatal(err)
	}
	if payload.Count != len(values) {
		t.Fatalf("count=%d want=%d", payload.Count, len(values))
	}
	if _, err := importDatabase(exported, restored); err != nil {
		t.Fatal(err)
	}

	verification := filepath.Join(dir, "verification.json")
	restoredPayload, err := exportDatabase(restored, verification)
	if err != nil {
		t.Fatal(err)
	}
	if restoredPayload.SHA256 != payload.SHA256 {
		t.Fatalf("sha256=%s want=%s", restoredPayload.SHA256, payload.SHA256)
	}
}

func TestExportRefusesToOverwrite(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	output := filepath.Join(dir, "existing.json")
	createTestDatabase(t, source, map[string]string{"alpha": "token"})
	if err := os.WriteFile(output, []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := exportDatabase(source, output); err == nil {
		t.Fatal("expected overwrite refusal")
	}
	contents, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "preserve" {
		t.Fatalf("existing output changed: %q", contents)
	}
}
