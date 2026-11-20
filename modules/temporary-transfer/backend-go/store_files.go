package main

import (
	"context"
	"database/sql"
	"errors"
)

const fileColumns = "f.id,f.object_key,f.filename,f.size,f.upload_id,f.state,f.storage_backend"

func scanFile(scanner interface{ Scan(...any) error }) (*storedFile, error) {
	f := &storedFile{}
	err := scanner.Scan(&f.ID, &f.key, &f.filename, &f.size, &f.uploadID, &f.state, &f.backend)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *transferStore) addFile(ctx context.Context, owner, id, fileID, filename string, size, quota int64, backend string) (*storedFile, bool, error) {
	var file *storedFile
	var existing bool
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		var count int
		err := tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM files WHERE transfer_id=?) FROM transfers
          WHERE id=? AND owner_id=? AND state='uploading' AND revoked_at IS NULL AND expires_at>?`, id, id, owner, nowMS()).Scan(&count)
		if errors.Is(err, sql.ErrNoRows) {
			return clientError(400, "投递不存在或已失效")
		}
		if err != nil {
			return err
		}
		file, err = scanFile(tx.QueryRowContext(ctx, "SELECT "+fileColumns+" FROM files f WHERE f.id=? AND f.transfer_id=?", fileID, id))
		if err != nil {
			return err
		}
		if file != nil {
			if file.filename != filename || file.size != size {
				return clientError(400, "上传文件信息不一致")
			}
			existing = true
			return nil
		}
		if count >= 20 {
			return clientError(400, "单次投递最多包含 20 个文件")
		}
		used, err := usage(ctx, tx)
		if err != nil {
			return err
		}
		if used+size > quota {
			return clientError(400, "暂存空间不足")
		}
		file = &storedFile{ID: fileID, key: "transfers/" + id + "/" + fileID, filename: filename, size: size, state: "pending", backend: backend}
		if _, err = tx.ExecContext(ctx, "INSERT INTO files(id,transfer_id,object_key,filename,size,storage_backend) VALUES(?,?,?,?,?,?)",
			fileID, id, file.key, filename, size, backend); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE transfers SET file_total=file_total+1,size_bytes=size_bytes+? WHERE id=?", size, id)
		return err
	})
	return file, existing, err
}

func (s *transferStore) ownedFile(ctx context.Context, owner, id, fileID string) (*storedFile, error) {
	return scanFile(s.db.QueryRowContext(ctx, "SELECT "+fileColumns+` FROM files f JOIN transfers t ON t.id=f.transfer_id
      WHERE f.id=? AND t.id=? AND t.owner_id=? AND t.revoked_at IS NULL AND t.expires_at>?`, fileID, id, owner, nowMS()))
}

func (s *transferStore) changePending(ctx context.Context, fileID string, uploadID *string) (bool, error) {
	if uploadID == nil {
		return changed(ctx, s.db, `UPDATE files SET state='ready',upload_id=NULL WHERE id=? AND state='pending'
          AND EXISTS(SELECT 1 FROM transfers t WHERE t.id=files.transfer_id AND t.revoked_at IS NULL AND t.expires_at>?)`, fileID, nowMS())
	}
	return changed(ctx, s.db, `UPDATE files SET upload_id=? WHERE id=? AND state='pending'
      AND EXISTS(SELECT 1 FROM transfers t WHERE t.id=files.transfer_id AND t.revoked_at IS NULL AND t.expires_at>?)`, *uploadID, fileID, nowMS())
}

func (s *transferStore) rememberUploadForCleanup(ctx context.Context, fileID, uploadID string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE files SET upload_id=? WHERE id=? AND state='pending'", uploadID, fileID)
	return err
}

func (s *transferStore) forgetFile(ctx context.Context, fileID string, removeMetadata bool) error {
	return s.transaction(ctx, func(tx *sql.Tx) error {
		if removeMetadata {
			if _, err := tx.ExecContext(ctx, `UPDATE transfers SET file_total=MAX(0,file_total-1),
                size_bytes=MAX(0,size_bytes-(SELECT size FROM files WHERE id=?))
                WHERE id=(SELECT transfer_id FROM files WHERE id=?)`, fileID, fileID); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM files WHERE id=?", fileID)
		return err
	})
}

func (s *transferStore) publish(ctx context.Context, owner, id string) (bool, error) {
	return changed(ctx, s.db, `UPDATE transfers SET state='ready' WHERE id=? AND owner_id=? AND state IN ('uploading','ready')
      AND revoked_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM files WHERE transfer_id=?)
      AND NOT EXISTS(SELECT 1 FROM files WHERE transfer_id=? AND state<>'ready')`, id, owner, nowMS(), id, id)
}

func (s *transferStore) revoke(ctx context.Context, owner, id string) (bool, error) {
	return changed(ctx, s.db, "UPDATE transfers SET revoked_at=? WHERE id=? AND owner_id=? AND revoked_at IS NULL", nowMS(), id, owner)
}

func (s *transferStore) list(ctx context.Context, owner string, offset int64) (map[string]any, error) {
	rows, err := queryMaps(ctx, s.db, `SELECT t.id,t.title,t.created_at,t.expires_at,t.revoked_at,t.exhausted_at,t.max_grants,t.grant_count,t.state,
      t.content_kind,t.file_total AS file_count,t.size_bytes AS size,
      (SELECT GROUP_CONCAT(DISTINCT f.storage_backend) FROM files f WHERE f.transfer_id=t.id) AS storage_backend
      FROM transfers t WHERE t.owner_id=? ORDER BY t.created_at DESC,t.id DESC LIMIT 101 OFFSET ?`, owner, offset)
	if err != nil {
		return nil, err
	}
	var next any
	if len(rows) > 100 {
		rows = rows[:100]
		next = offset + 100
	}
	used, err := usage(ctx, s.db)
	if err != nil {
		return nil, err
	}
	var failures int
	if err = s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM files WHERE cleanup_attempts>0").Scan(&failures); err != nil {
		return nil, err
	}
	return map[string]any{"items": rows, "nextOffset": next, "usedBytes": used, "cleanupFailures": failures}, nil
}

func (s *transferStore) files(ctx context.Context, id string) ([]map[string]any, error) {
	return queryMaps(ctx, s.db, "SELECT id,filename,size,storage_backend FROM files WHERE transfer_id=? AND state='ready' ORDER BY rowid", id)
}

func (s *transferStore) resolvePickup(ctx context.Context, code string) (*accessData, error) {
	var id, owner string
	err := s.db.QueryRowContext(ctx, "SELECT id,owner_id FROM transfers WHERE pickup_hash=?", s.pickupHash(code)).Scan(&id, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	pin, pickup, err := s.share(ctx, owner, id)
	if err != nil || pin == "" || pickup != code {
		return nil, err
	}
	return s.verify(ctx, s.db, id, pin)
}

func (s *transferStore) ownedContent(ctx context.Context, owner, id string) (*accessData, error) {
	pin, _, err := s.share(ctx, owner, id)
	if err != nil || pin == "" {
		return nil, err
	}
	return s.verify(ctx, s.db, id, pin)
}

func grantCandidate(ctx context.Context, q dbQuery, id, fileID string) (*storedFile, error) {
	return scanFile(q.QueryRowContext(ctx, "SELECT "+fileColumns+` FROM files f JOIN transfers t ON t.id=f.transfer_id
      WHERE t.id=? AND f.id=? AND f.state='ready' AND t.state='ready' AND t.revoked_at IS NULL AND t.expires_at>?
      AND (t.max_grants IS NULL OR t.grant_count<t.max_grants)`, id, fileID, nowMS()))
}

func (s *transferStore) claimGrant(ctx context.Context, id, fileID, pin string) (bool, error) {
	var claimed bool
	err := s.transaction(ctx, func(tx *sql.Tx) error {
		data, err := s.verify(ctx, tx, id, pin)
		if err != nil || data == nil {
			return err
		}
		file, err := grantCandidate(ctx, tx, id, fileID)
		if err != nil || file == nil {
			return err
		}
		claimed, err = changed(ctx, tx, `UPDATE transfers SET grant_count=grant_count+1,
          exhausted_at=CASE WHEN max_grants IS NOT NULL AND grant_count+1>=max_grants THEN ? ELSE exhausted_at END
          WHERE id=?`, nowMS(), id)
		return err
	})
	return claimed, err
}

func (s *transferStore) localUploadActive(ctx context.Context, key, id string) (bool, error) {
	var exists int
	err := s.db.QueryRowContext(ctx, `SELECT 1 FROM files f JOIN transfers t ON t.id=f.transfer_id
      WHERE f.object_key=? AND f.upload_id=? AND f.storage_backend='local' AND f.state='pending'
      AND t.state='uploading' AND t.revoked_at IS NULL AND t.expires_at>?`, key, id, nowMS()).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *transferStore) localDownload(ctx context.Context, key string) (*storedFile, error) {
	return scanFile(s.db.QueryRowContext(ctx, "SELECT "+fileColumns+` FROM files f JOIN transfers t ON t.id=f.transfer_id
      WHERE f.object_key=? AND f.storage_backend='local' AND f.state='ready' AND t.state='ready'
      AND t.revoked_at IS NULL AND t.expires_at>?`, key, nowMS()))
}

func (s *transferStore) hasR2Files(ctx context.Context) (bool, error) {
	var exists int
	err := s.db.QueryRowContext(ctx, "SELECT 1 FROM files WHERE storage_backend='r2' LIMIT 1").Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *transferStore) cleanupCandidates(ctx context.Context) ([]storedFile, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT "+fileColumns+` FROM files f JOIN transfers t ON t.id=f.transfer_id
      WHERE t.revoked_at IS NOT NULL OR t.expires_at<=? OR (t.exhausted_at IS NOT NULL AND t.exhausted_at<=?)
      ORDER BY COALESCE(f.cleanup_last_at,0),f.rowid LIMIT 100`, nowMS(), nowMS()-120000)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var files []storedFile
	for rows.Next() {
		file, err := scanFile(rows)
		if err != nil {
			return nil, err
		}
		files = append(files, *file)
	}
	return files, rows.Err()
}

func (s *transferStore) purgeExpiredText(ctx context.Context) error {
	const condition = `(revoked_at IS NOT NULL OR expires_at<=? OR (exhausted_at IS NOT NULL AND exhausted_at<=?))
      AND (text_content IS NOT NULL OR title<>'已清理的投递')`
	now := nowMS()
	var exists int
	err := s.db.QueryRowContext(ctx, "SELECT 1 FROM transfers WHERE "+condition+" LIMIT 1", now, now-120000).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	update, err := changed(ctx, s.db, "UPDATE transfers SET text_content=NULL,title='已清理的投递' WHERE "+condition, now, now-120000)
	if err != nil || !update {
		return err
	}
	_, err = s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
