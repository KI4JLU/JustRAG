package eval

import (
	"crypto/sha256"
	"encoding/hex"
)

// HashFixtureContent returns the lowercase hex sha256 of the given bytes.
// Stamps each eval run so runs using the same fixture can be safely compared.
func HashFixtureContent(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
