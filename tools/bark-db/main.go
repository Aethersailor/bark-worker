package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"time"

	bolt "go.etcd.io/bbolt"
)

const bucketName = "device"

type device struct {
	Key   string `json:"device_key"`
	Token string `json:"device_token"`
}

type exportFile struct {
	SchemaVersion int      `json:"schema_version"`
	GeneratedAt   string   `json:"generated_at"`
	Count         int      `json:"count"`
	SHA256        string   `json:"sha256"`
	Devices       []device `json:"devices"`
}

func canonicalHash(devices []device) string {
	hash := sha256.New()
	for _, item := range devices {
		_, _ = io.WriteString(hash, item.Key)
		_, _ = hash.Write([]byte{0})
		_, _ = io.WriteString(hash, item.Token)
		_, _ = hash.Write([]byte{'\n'})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func validateExport(payload exportFile) error {
	if payload.SchemaVersion != 1 {
		return fmt.Errorf("unsupported schema version: %d", payload.SchemaVersion)
	}
	if payload.Count != len(payload.Devices) {
		return fmt.Errorf("device count mismatch: header=%d actual=%d", payload.Count, len(payload.Devices))
	}
	sort.Slice(payload.Devices, func(i, j int) bool { return payload.Devices[i].Key < payload.Devices[j].Key })
	if digest := canonicalHash(payload.Devices); digest != payload.SHA256 {
		return fmt.Errorf("device checksum mismatch: expected=%s actual=%s", payload.SHA256, digest)
	}
	seen := make(map[string]struct{}, len(payload.Devices))
	for _, item := range payload.Devices {
		if item.Key == "" {
			return errors.New("device export contains an empty key")
		}
		if _, exists := seen[item.Key]; exists {
			return fmt.Errorf("device export contains a duplicate key: %s", item.Key)
		}
		seen[item.Key] = struct{}{}
	}
	return nil
}

func writeExclusive(path string, contents []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		_ = file.Close()
		if !completed {
			_ = os.Remove(path)
		}
	}()
	if _, err := file.Write(contents); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	completed = true
	return nil
}

func exportDatabase(inputPath, outputPath string) (exportFile, error) {
	db, err := bolt.Open(inputPath, 0o600, &bolt.Options{ReadOnly: true, Timeout: time.Second})
	if err != nil {
		return exportFile{}, err
	}
	defer db.Close()

	devices := make([]device, 0)
	err = db.View(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(bucketName))
		if bucket == nil {
			return fmt.Errorf("bucket %q not found", bucketName)
		}
		return bucket.ForEach(func(key, value []byte) error {
			devices = append(devices, device{Key: string(key), Token: string(value)})
			return nil
		})
	})
	if err != nil {
		return exportFile{}, err
	}

	sort.Slice(devices, func(i, j int) bool { return devices[i].Key < devices[j].Key })
	payload := exportFile{
		SchemaVersion: 1,
		GeneratedAt:   time.Now().UTC().Format(time.RFC3339),
		Count:         len(devices),
		SHA256:        canonicalHash(devices),
		Devices:       devices,
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return exportFile{}, err
	}
	encoded = append(encoded, '\n')
	if err := writeExclusive(outputPath, encoded); err != nil {
		return exportFile{}, err
	}
	return payload, nil
}

func importDatabase(inputPath, outputPath string) (exportFile, error) {
	encoded, err := os.ReadFile(inputPath)
	if err != nil {
		return exportFile{}, err
	}
	var payload exportFile
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return exportFile{}, err
	}
	if err := validateExport(payload); err != nil {
		return exportFile{}, err
	}
	if _, err := os.Stat(outputPath); err == nil {
		return exportFile{}, fmt.Errorf("output already exists: %s", outputPath)
	} else if !errors.Is(err, os.ErrNotExist) {
		return exportFile{}, err
	}

	db, err := bolt.Open(outputPath, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return exportFile{}, err
	}
	completed := false
	defer func() {
		_ = db.Close()
		if !completed {
			_ = os.Remove(outputPath)
		}
	}()
	err = db.Update(func(tx *bolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists([]byte(bucketName))
		if err != nil {
			return err
		}
		for _, item := range payload.Devices {
			if err := bucket.Put([]byte(item.Key), []byte(item.Token)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return exportFile{}, err
	}
	if err := db.Sync(); err != nil {
		return exportFile{}, err
	}
	completed = true
	return payload, nil
}

func commandFlags(name string, args []string) (string, string, error) {
	flags := flag.NewFlagSet(name, flag.ContinueOnError)
	input := flags.String("input", "", "input file")
	output := flags.String("output", "", "new output file; must not already exist")
	if err := flags.Parse(args); err != nil {
		return "", "", err
	}
	if *input == "" || *output == "" {
		return "", "", errors.New("both -input and -output are required")
	}
	return *input, *output, nil
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bark-db <export|import> -input <file> -output <file>")
	}
	input, output, err := commandFlags(args[0], args[1:])
	if err != nil {
		return err
	}
	var payload exportFile
	switch args[0] {
	case "export":
		payload, err = exportDatabase(input, output)
	case "import":
		payload, err = importDatabase(input, output)
	default:
		return fmt.Errorf("unknown command: %s", args[0])
	}
	if err != nil {
		return err
	}
	fmt.Printf("%s devices=%d sha256=%s output=%s\n", args[0], payload.Count, payload.SHA256, output)
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
