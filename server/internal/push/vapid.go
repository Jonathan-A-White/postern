// Package push manages this backend's VAPID identity and the phone's push
// subscriptions, and sends a classified Web Push (RFC 8291/8292) for every
// newly indexed record whose payload names a subscribed public key.
package push

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const vapidFileName = "postern-vapid.json"

// VAPIDKeys is the backend's VAPID identity: a public key handed to every
// browser that subscribes, and a private key used to sign every push.
type VAPIDKeys struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

// LoadOrGenerateVAPIDKeys returns envPublicKey/envPrivateKey verbatim if both
// are non-empty. Otherwise it loads dataDir/postern-vapid.json, generating a
// new key pair and persisting it there the first time this backend runs.
func LoadOrGenerateVAPIDKeys(dataDir, envPublicKey, envPrivateKey string) (VAPIDKeys, error) {
	if envPublicKey != "" && envPrivateKey != "" {
		return VAPIDKeys{PublicKey: envPublicKey, PrivateKey: envPrivateKey}, nil
	}

	path := filepath.Join(dataDir, vapidFileName)
	data, err := os.ReadFile(path)
	if err == nil {
		var keys VAPIDKeys
		if err := json.Unmarshal(data, &keys); err != nil {
			return VAPIDKeys{}, fmt.Errorf("parsing %s: %w", path, err)
		}
		return keys, nil
	}
	if !os.IsNotExist(err) {
		return VAPIDKeys{}, fmt.Errorf("reading %s: %w", path, err)
	}

	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		return VAPIDKeys{}, fmt.Errorf("generating VAPID keys: %w", err)
	}
	keys := VAPIDKeys{PublicKey: publicKey, PrivateKey: privateKey}

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return VAPIDKeys{}, fmt.Errorf("creating data directory %s: %w", dataDir, err)
	}
	encoded, err := json.Marshal(keys)
	if err != nil {
		return VAPIDKeys{}, fmt.Errorf("marshaling VAPID keys: %w", err)
	}
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return VAPIDKeys{}, fmt.Errorf("writing %s: %w", path, err)
	}

	return keys, nil
}
