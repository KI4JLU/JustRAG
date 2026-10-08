// Package libpaths holds the object-storage path conventions of the user file
// library. It is a leaf package so cascade (deletion) and processor (writing)
// can share them without importing each other.
package libpaths

// ParseCacheDir returns the storage prefix holding every cached parse of a
// library file: users/<ownerID>/parses/<userFileID>/.
func ParseCacheDir(ownerID, userFileID string) string {
	return "users/" + ownerID + "/parses/" + userFileID + "/"
}

// ParseCacheKey returns users/<ownerID>/parses/<userFileID>/<configHash>.json.
func ParseCacheKey(ownerID, userFileID, configHash string) string {
	return ParseCacheDir(ownerID, userFileID) + configHash + ".json"
}
