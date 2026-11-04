package splitter

import "strings"

// TableCarry is the markdown table still open at the end of a text: its
// header row and the |---| row below it. SplitCarry hands it to the next
// text (the next page) so a table continuing there gets its header too.
// The zero value means no open table.
type TableCarry struct {
	header, sep string
}

// SplitCarry is Split for one of several consecutive texts (a document's
// pages). carry is the table left open by the previous text; the returned
// carry is the table this text leaves open.
func SplitCarry(text string, cfg Config, carry TableCarry) ([]string, TableCarry) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, carry
	}
	chunks := splitRecursive(text, cfg.Separators, cfg.ChunkSize, cfg.ChunkOverlap)
	return repeatTableHeaders(chunks, carry, cfg.ChunkSize)
}

func isTableRow(l string) bool { return strings.HasPrefix(strings.TrimSpace(l), "|") }

func isTableSep(l string) bool {
	t := strings.TrimSpace(l)
	return strings.HasPrefix(t, "|") && strings.Contains(t, "-") && strings.Trim(t, "|-: ") == ""
}

// isRowTail reports whether l is the end of a table row cut off at the
// front: no leading pipe, but cells ending in one ("Nr. 0 | 1,00 | 2026/1 |").
// The overlap is cut at word boundaries, so a chunk that continues a table
// usually starts with such a tail of the previous chunk's last row.
func isRowTail(l string) bool {
	t := strings.TrimSpace(l)
	return !strings.HasPrefix(t, "|") && strings.HasSuffix(t, "|") && strings.Count(t, "|") >= 2
}

// repeatTableHeaders prefixes a chunk that starts inside a markdown table
// with that table's header and |---| rows (KI-853). The splitter cuts a long
// table between rows, so before this only the first piece carried the header
// and every later piece was a run of bare cells ("Mieten Geräte 1.785,00")
// with nothing saying which column is which. A chunk that already contains
// the header (e.g. through the overlap) is left alone. A header longer than
// a quarter of chunkSize is not repeated, so a chunk stays within bounds.
//
// A row tail at the start of chunk i > 0 comes from the overlap; its full row
// is in chunk i-1, so it is dropped rather than left as a broken row under
// the repeated header. At the start of a text (i == 0, a new page) nothing
// overlaps, so nothing is dropped there.
func repeatTableHeaders(chunks []string, carry TableCarry, chunkSize int) ([]string, TableCarry) {
	for i, c := range chunks {
		lines := strings.Split(c, "\n")
		if i > 0 && carry.header != "" && len(lines) > 1 && isRowTail(lines[0]) {
			lines = lines[1:]
			c = strings.Join(lines, "\n")
			chunks[i] = c
		}
		first := -1
		for j, l := range lines {
			if strings.TrimSpace(l) != "" {
				first = j
				break
			}
		}
		startsInTable := first >= 0 && isTableRow(lines[first]) && !isTableSep(lines[first]) &&
			(first+1 >= len(lines) || !isTableSep(lines[first+1]))
		if startsInTable && carry.header != "" && estimateTokens(carry.header+carry.sep) <= chunkSize/4 {
			chunks[i] = carry.header + "\n" + carry.sep + "\n" + c
		}
		carry = tableOpenAtEnd(lines, carry)
	}
	return chunks, carry
}

// tableOpenAtEnd walks a chunk's lines and returns the table still open
// after its last line. A header row followed by a |---| row opens a table;
// table rows keep it open; a blank or any other line closes it (a markdown
// table ends at the first non-table line).
func tableOpenAtEnd(lines []string, carry TableCarry) TableCarry {
	for j := 0; j < len(lines); j++ {
		l := lines[j]
		switch {
		case isTableRow(l) && !isTableSep(l) && j+1 < len(lines) && isTableSep(lines[j+1]):
			carry = TableCarry{header: strings.TrimSpace(l), sep: strings.TrimSpace(lines[j+1])}
			j++
		case isTableRow(l):
			// a data row (or a stray |---|): the table stays open
		default:
			carry = TableCarry{}
		}
	}
	return carry
}
