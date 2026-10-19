package chat

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/justrag/go-backend/internal/userfiles"
)

// MessageAttachment is one file attached to a user message, as the message
// history reports it (GET /api/chats/{id}/messages).
type MessageAttachment struct {
	UserFileID string `json:"userFileId"`
	Name       string `json:"name"`
	Mime       string `json:"mime"`
	Size       int64  `json:"size"`
}

// attachedFile is one message_attachments row joined with its user_files
// row: everything the answer path needs to read the file's text.
type attachedFile struct {
	MessageID string
	Position  int
	File      *userfiles.UserFile
}

// AttachmentStore is the chat-store surface of chat attachments (migration
// 0090). Satisfied by *PGStore.
type AttachmentStore interface {
	// MessageAttachments returns the attachments of the given messages,
	// ordered by message (in the order of messageIDs) and position.
	MessageAttachments(ctx context.Context, messageIDs []string) ([]attachedFile, error)
	// ChatScopedAttachments returns the chat-scoped user_files ids (with
	// owner) attached anywhere in chatID, for cleanup after the chat goes.
	ChatScopedAttachments(ctx context.Context, chatID string) ([]userFileRef, error)
}

// userFileRef names a user file together with its owner.
type userFileRef struct {
	ID      string
	OwnerID string
}

var _ AttachmentStore = (*PGStore)(nil)

// insertMessageAttachments links ids to messageID in tx, in order.
func insertMessageAttachments(ctx context.Context, tx pgx.Tx, messageID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	positions := make([]int32, len(ids))
	for i := range ids {
		positions[i] = int32(i)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO message_attachments (message_id, user_file_id, position)
		SELECT $1::uuid, a.user_file_id, a.pos
		  FROM unnest($2::uuid[], $3::int[]) AS a(user_file_id, pos)
		ON CONFLICT (message_id, user_file_id) DO NOTHING`, messageID, ids, positions); err != nil {
		return fmt.Errorf("AddMessage insert attachments: %w", err)
	}
	return nil
}

func (s *PGStore) MessageAttachments(ctx context.Context, messageIDs []string) ([]attachedFile, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT ma.message_id::text, ma.position,
		       uf.id::text, uf.owner_user_id::text, uf.name, uf.mime, uf.size,
		       uf.sha256::text, uf.storage_path, uf.scope, uf.created_at
		  FROM message_attachments ma
		  JOIN user_files uf ON uf.id = ma.user_file_id
		  JOIN unnest($1::uuid[]) WITH ORDINALITY AS m(id, ord) ON m.id = ma.message_id
		 ORDER BY m.ord, ma.position`, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("MessageAttachments: %w", err)
	}
	defer rows.Close()
	var out []attachedFile
	for rows.Next() {
		var (
			a  attachedFile
			uf userfiles.UserFile
			at time.Time
		)
		if err := rows.Scan(&a.MessageID, &a.Position, &uf.ID, &uf.OwnerUserID, &uf.Name, &uf.Mime,
			&uf.Size, &uf.SHA256, &uf.StoragePath, &uf.Scope, &at); err != nil {
			return nil, fmt.Errorf("MessageAttachments scan: %w", err)
		}
		uf.CreatedAt = at
		uf.KBs = []userfiles.KBLink{}
		a.File = &uf
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("MessageAttachments rows: %w", err)
	}
	return out, nil
}

func (s *PGStore) ChatScopedAttachments(ctx context.Context, chatID string) ([]userFileRef, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT DISTINCT uf.id::text, uf.owner_user_id::text
		  FROM message_attachments ma
		  JOIN messages m ON m.id = ma.message_id
		  JOIN user_files uf ON uf.id = ma.user_file_id
		 WHERE m.chat_id = $1::uuid AND uf.scope = 'chat'`, chatID)
	if err != nil {
		return nil, fmt.Errorf("ChatScopedAttachments: %w", err)
	}
	defer rows.Close()
	var out []userFileRef
	for rows.Next() {
		var r userFileRef
		if err := rows.Scan(&r.ID, &r.OwnerID); err != nil {
			return nil, fmt.Errorf("ChatScopedAttachments scan: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ChatScopedAttachments rows: %w", err)
	}
	return out, nil
}
