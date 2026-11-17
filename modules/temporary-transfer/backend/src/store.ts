import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export type StorageBackend = "r2" | "local";
export type StoredFile = { id: string; object_key: string; filename: string; size: number; upload_id: string | null; state: string; storage_backend: StorageBackend };

/** Metadata and local objects live outside the immutable module release. */
export class TransferStore {
  private readonly db: DatabaseSync;
  private readonly shareKey: Buffer;

  constructor(readonly dataDir: string) {
    const keyPath = path.join(dataDir, "share-key");
    try { this.shareKey = readFileSync(keyPath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const key = randomBytes(32);
      try { writeFileSync(keyPath, key, { mode: 0o600, flag: "wx" }); this.shareKey = key; }
      catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw writeError;
        this.shareKey = readFileSync(keyPath);
      }
    }
    if (this.shareKey.length !== 32) throw new Error("投递密钥无效");
    this.db = new DatabaseSync(path.join(dataDir, "transfers.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS transfers (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
        text_content TEXT, code_salt TEXT NOT NULL, code_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        revoked_at INTEGER, max_grants INTEGER, grant_count INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'ready', exhausted_at INTEGER,
        content_kind TEXT NOT NULL DEFAULT 'text', file_total INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS transfers_owner_created ON transfers(owner_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL REFERENCES transfers(id),
        object_key TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, size INTEGER NOT NULL,
        upload_id TEXT, state TEXT NOT NULL DEFAULT 'pending',
        cleanup_attempts INTEGER NOT NULL DEFAULT 0, cleanup_last_at INTEGER,
        storage_backend TEXT NOT NULL DEFAULT 'r2'
      );
      CREATE INDEX IF NOT EXISTS files_transfer ON files(transfer_id);
    `);
    const columns = this.db.prepare("PRAGMA table_info(transfers)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "state")) this.db.exec("ALTER TABLE transfers ADD COLUMN state TEXT NOT NULL DEFAULT 'ready'");
    if (!columns.some((column) => column.name === "exhausted_at")) this.db.exec("ALTER TABLE transfers ADD COLUMN exhausted_at INTEGER");
    if (!columns.some((column) => column.name === "content_kind")) {
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE transfers ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'text';
        ALTER TABLE transfers ADD COLUMN file_total INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE transfers ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
        UPDATE transfers SET
          content_kind = CASE WHEN EXISTS (SELECT 1 FROM files f WHERE f.transfer_id = transfers.id) OR state = 'uploading' THEN 'files' ELSE 'text' END,
          file_total = (SELECT COUNT(*) FROM files f WHERE f.transfer_id = transfers.id),
          size_bytes = (SELECT COALESCE(SUM(f.size), 0) FROM files f WHERE f.transfer_id = transfers.id) + COALESCE(length(CAST(text_content AS BLOB)), 0);
        COMMIT`);
    }
    if (!columns.some(column => column.name === "pickup_hash")) this.db.exec("ALTER TABLE transfers ADD COLUMN pickup_hash TEXT");
    if (!columns.some(column => column.name === "pickup_counter")) this.db.exec("ALTER TABLE transfers ADD COLUMN pickup_counter INTEGER NOT NULL DEFAULT 0");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS transfers_pickup_hash ON transfers(pickup_hash)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db.prepare("SELECT id, code_salt FROM transfers WHERE pickup_hash IS NULL").all() as Array<{id:string; code_salt:string}>) {
        const pickup = this.allocatePickup(row.id, row.code_salt);
        this.db.prepare("UPDATE transfers SET pickup_hash = ?, pickup_counter = ? WHERE id = ?").run(pickup.hash, pickup.counter, row.id);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    const fileColumns = this.db.prepare("PRAGMA table_info(files)").all() as Array<{ name: string }>;
    if (!fileColumns.some((column) => column.name === "cleanup_attempts")) this.db.exec("ALTER TABLE files ADD COLUMN cleanup_attempts INTEGER NOT NULL DEFAULT 0");
    if (!fileColumns.some((column) => column.name === "cleanup_last_at")) this.db.exec("ALTER TABLE files ADD COLUMN cleanup_last_at INTEGER");
    if (!fileColumns.some((column) => column.name === "storage_backend")) this.db.exec("ALTER TABLE files ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'r2'");
  }

  createText(ownerId: string, title: string, content: string, expiresAt: number, maxGrants: number | null, maxTotalBytes: number) {
    if (this.usage() + Buffer.byteLength(content, "utf8") > maxTotalBytes) throw new Error("暂存空间不足");
    return this.create(ownerId, title, content, expiresAt, maxGrants, "ready");
  }

  createFiles(ownerId: string, title: string, expiresAt: number, maxGrants: number | null) {
    return this.create(ownerId, title, null, expiresAt, maxGrants, "uploading");
  }

  private create(ownerId: string, title: string, content: string | null, expiresAt: number, maxGrants: number | null, state: string) {
    const count = this.db.prepare("SELECT COUNT(*) AS total FROM transfers WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ?").get(ownerId, Date.now()) as { total: number };
    if (count.total >= 1000) throw new Error("有效投递数量已达上限");
    const id = randomBytes(24).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const code = this.deriveCode(id, salt);
    const hash = scryptSync(code, salt, 32).toString("hex");
    const createdAt = Date.now();
    this.db.prepare(`INSERT INTO transfers
      (id, owner_id, title, text_content, code_salt, code_hash, created_at, expires_at, max_grants, state, content_kind, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ownerId, title, content, salt, hash, createdAt, expiresAt, maxGrants, state, state === "uploading" ? "files" : "text", content === null ? 0 : Buffer.byteLength(content, "utf8"));
    const pickup = this.allocatePickup(id, salt);
    this.db.prepare("UPDATE transfers SET pickup_hash = ?, pickup_counter = ? WHERE id = ?").run(pickup.hash, pickup.counter, id);
    return { id, code, pickupCode: pickup.code, createdAt, expiresAt };
  }

  publish(ownerId: string, transferId: string) {
    return this.db.prepare(`UPDATE transfers SET state = 'ready' WHERE id = ? AND owner_id = ? AND state IN ('uploading', 'ready')
      AND revoked_at IS NULL AND expires_at > ? AND EXISTS (SELECT 1 FROM files WHERE transfer_id = ?)
      AND NOT EXISTS (SELECT 1 FROM files WHERE transfer_id = ? AND state <> 'ready')`)
      .run(transferId, ownerId, Date.now(), transferId, transferId).changes > 0;
  }

  rotateCode(ownerId: string, transferId: string) {
    const salt = randomBytes(16).toString("hex");
    const code = this.deriveCode(transferId, salt);
    const hash = scryptSync(code, salt, 32).toString("hex");
    const pickup = this.allocatePickup(transferId, salt);
    const result = this.db.prepare(`UPDATE transfers SET code_salt = ?, code_hash = ?, pickup_hash = ?, pickup_counter = ?
      WHERE id = ? AND owner_id = ? AND revoked_at IS NULL AND expires_at > ?`).run(salt, hash, pickup.hash, pickup.counter, transferId, ownerId, Date.now());
    return result.changes ? code : null;
  }

  shareCode(ownerId: string, transferId: string) {
    const row = this.db.prepare(`SELECT code_salt, code_hash FROM transfers
      WHERE id = ? AND owner_id = ? AND state = 'ready' AND revoked_at IS NULL AND expires_at > ?
      AND (max_grants IS NULL OR grant_count < max_grants)`)
      .get(transferId, ownerId, Date.now()) as { code_salt: string; code_hash: string } | undefined;
    if (!row) return null;
    const code = this.deriveCode(transferId, row.code_salt);
    const actual = scryptSync(code, row.code_salt, 32);
    const expected = Buffer.from(row.code_hash, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual) ? code : null;
  }

  private pickupHash(code: string) { return createHmac("sha256", this.shareKey).update(`pickup-index:${code}`).digest("hex"); }
  private pickupCode(id: string, salt: string, counter: number) {
    return createHmac("sha256", this.shareKey).update(`pickup:${id}:${salt}:${counter}`).digest().readUIntBE(0, 5).toString(32).padStart(8, "0").toUpperCase();
  }
  private allocatePickup(id: string, salt: string) {
    for (let counter = 0; ; counter++) {
      const code = this.pickupCode(id, salt, counter); const hash = this.pickupHash(code);
      if (!this.db.prepare("SELECT 1 FROM transfers WHERE pickup_hash = ?").get(hash)) return { code, hash, counter };
    }
  }
  sharePickupCode(owner: string, id: string) {
    if (!this.shareCode(owner, id)) return null;
    const row = this.db.prepare("SELECT code_salt, pickup_counter FROM transfers WHERE id = ?").get(id) as {code_salt:string; pickup_counter:number};
    return this.pickupCode(id, row.code_salt, row.pickup_counter);
  }
  resolvePickup(code: string) {
    const row = this.db.prepare("SELECT id, owner_id FROM transfers WHERE pickup_hash = ?").get(this.pickupHash(code)) as {id:string; owner_id:string} | undefined;
    if (!row) return null;
    const pin = this.shareCode(row.owner_id, row.id);
    const content = pin && this.verify(row.id, pin);
    return content ? { ...content, id: row.id, pin } : null;
  }
  ownedContent(owner: string, id: string) {
    const code = this.shareCode(owner, id);
    return code ? this.verify(id, code) : null;
  }

  private deriveCode(id: string, salt: string) {
    for (let counter = 0; ; counter += 1) {
      const value = createHmac("sha256", this.shareKey).update(`${id}:${salt}:${counter}`).digest().readUInt32BE(0);
      if (value < 4_294_000_000) return String(value % 1_000_000).padStart(6, "0");
    }
  }

  /** Reserve declared bytes transactionally before initiating a remote upload. */
  addFile(ownerId: string, transferId: string, id: string, filename: string, size: number, maxTotalBytes: number, backend: StorageBackend = "r2") {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const transfer = this.db.prepare("SELECT id FROM transfers WHERE id = ? AND owner_id = ? AND state = 'uploading' AND revoked_at IS NULL AND expires_at > ?")
        .get(transferId, ownerId, Date.now());
      if (!transfer) throw new Error("投递不存在或已失效");
      const existing = this.db.prepare("SELECT * FROM files WHERE id = ? AND transfer_id = ?").get(id, transferId) as StoredFile | undefined;
      if (existing) {
        if (existing.filename !== filename || existing.size !== size) throw new Error("上传文件信息不一致");
        this.db.exec("COMMIT");
        return { id, key: existing.object_key, existing: true, uploadId: existing.upload_id, state: existing.state, backend: existing.storage_backend };
      }
      const count = this.db.prepare("SELECT COUNT(*) AS total FROM files WHERE transfer_id = ?").get(transferId) as { total: number };
      if (count.total >= 20) throw new Error("单次投递最多包含 20 个文件");
      if (this.usage() + size > maxTotalBytes) throw new Error("暂存空间不足");
      const key = `transfers/${transferId}/${id}`;
      this.db.prepare("INSERT INTO files (id, transfer_id, object_key, filename, size, storage_backend) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, transferId, key, filename, size, backend);
      this.db.prepare("UPDATE transfers SET file_total = file_total + 1, size_bytes = size_bytes + ? WHERE id = ?").run(size, transferId);
      this.db.exec("COMMIT");
      return { id, key, existing: false, uploadId: null, state: "pending", backend };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  setUploadId(fileId: string, uploadId: string) {
    return this.db.prepare(`UPDATE files SET upload_id = ? WHERE id = ? AND state = 'pending' AND
      EXISTS (SELECT 1 FROM transfers t WHERE t.id = files.transfer_id AND t.revoked_at IS NULL AND t.expires_at > ?)`)
      .run(uploadId, fileId, Date.now()).changes > 0;
  }

  setUploadIdForCleanup(fileId: string, uploadId: string) {
    this.db.prepare("UPDATE files SET upload_id = ? WHERE id = ? AND state = 'pending'").run(uploadId, fileId);
  }

  ownedFile(ownerId: string, transferId: string, fileId: string) {
    return this.db.prepare(`SELECT f.* FROM files f JOIN transfers t ON t.id = f.transfer_id
      WHERE f.id = ? AND t.id = ? AND t.owner_id = ? AND t.revoked_at IS NULL AND t.expires_at > ?`)
      .get(fileId, transferId, ownerId, Date.now()) as
      | StoredFile
      | undefined;
  }

  markFileReady(fileId: string) {
    return this.db.prepare(`UPDATE files SET state = 'ready', upload_id = NULL WHERE id = ? AND state = 'pending'
      AND EXISTS (SELECT 1 FROM transfers t WHERE t.id = files.transfer_id AND t.revoked_at IS NULL AND t.expires_at > ?)`)
      .run(fileId, Date.now()).changes > 0;
  }

  forgetFile(fileId: string, removeMetadata = false) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (removeMetadata) this.db.prepare(`UPDATE transfers SET file_total = MAX(0, file_total - 1),
        size_bytes = MAX(0, size_bytes - (SELECT size FROM files WHERE id = ?))
        WHERE id = (SELECT transfer_id FROM files WHERE id = ?)`).run(fileId, fileId);
      this.db.prepare("DELETE FROM files WHERE id = ?").run(fileId);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  cleanupCandidates() {
    return this.db.prepare(`SELECT f.id, f.object_key, f.upload_id, f.state, f.storage_backend FROM files f JOIN transfers t ON t.id = f.transfer_id
      WHERE t.revoked_at IS NOT NULL OR t.expires_at <= ? OR (t.exhausted_at IS NOT NULL AND t.exhausted_at <= ?)
      ORDER BY COALESCE(f.cleanup_last_at, 0), f.rowid LIMIT 100`).all(Date.now(), Date.now() - 120_000) as
      Array<{ id: string; object_key: string; upload_id: string | null; state: string; storage_backend: StorageBackend }>;
  }

  markCleanupFailure(fileId: string) {
    this.db.prepare("UPDATE files SET cleanup_attempts = cleanup_attempts + 1, cleanup_last_at = ? WHERE id = ?").run(Date.now(), fileId);
  }

  cleanupFailures() {
    return (this.db.prepare("SELECT COUNT(*) AS total FROM files WHERE cleanup_attempts > 0").get() as { total: number }).total;
  }

  purgeExpiredText() {
    const changed = this.db.prepare(`UPDATE transfers SET text_content = NULL, title = '已清理的投递'
      WHERE (revoked_at IS NOT NULL OR expires_at <= ? OR (exhausted_at IS NOT NULL AND exhausted_at <= ?))
      AND (text_content IS NOT NULL OR title <> '已清理的投递')`).run(Date.now(), Date.now() - 120_000);
    if (changed.changes) this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  files(transferId: string) {
    return this.db.prepare("SELECT id, filename, size, storage_backend FROM files WHERE transfer_id = ? AND state = 'ready' ORDER BY rowid").all(transferId);
  }

  usage() {
    return (this.db.prepare(`SELECT (SELECT COALESCE(SUM(size), 0) FROM files) +
      (SELECT COALESCE(SUM(length(CAST(text_content AS BLOB))), 0) FROM transfers) AS total`).get() as { total: number }).total;
  }

  fileUsage() { return (this.db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM files").get() as { total: number }).total; }
  hasFiles() { return Boolean(this.db.prepare("SELECT 1 FROM files LIMIT 1").get()); }
  hasR2Files() { return Boolean(this.db.prepare("SELECT 1 FROM files WHERE storage_backend = 'r2' LIMIT 1").get()); }

  localUploadActive(key: string, uploadId: string) {
    return Boolean(this.db.prepare(`SELECT 1 FROM files f JOIN transfers t ON t.id = f.transfer_id
      WHERE f.object_key = ? AND f.upload_id = ? AND f.storage_backend = 'local' AND f.state = 'pending'
      AND t.state = 'uploading' AND t.revoked_at IS NULL AND t.expires_at > ?`).get(key, uploadId, Date.now()));
  }

  localDownloadFile(key: string) {
    return this.db.prepare(`SELECT f.filename, f.size FROM files f JOIN transfers t ON t.id = f.transfer_id
      WHERE f.object_key = ? AND f.storage_backend = 'local' AND f.state = 'ready' AND t.state = 'ready'
      AND t.revoked_at IS NULL AND t.expires_at > ?`).get(key, Date.now()) as { filename: string; size: number } | undefined;
  }

  /** One grant counts one issued download URL, not a completed download. */
  fileGrantCandidate(transferId: string, fileId: string) {
    return this.db.prepare(`SELECT f.object_key, f.filename, f.storage_backend FROM files f JOIN transfers t ON t.id = f.transfer_id
      WHERE t.id = ? AND f.id = ? AND f.state = 'ready' AND t.state = 'ready' AND t.revoked_at IS NULL AND t.expires_at > ?
      AND (t.max_grants IS NULL OR t.grant_count < t.max_grants)`)
      .get(transferId, fileId, Date.now()) as { object_key: string; filename: string; storage_backend: StorageBackend } | undefined;
  }

  claimFileGrant(transferId: string, fileId: string, code: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const file = this.verify(transferId, code) ? this.fileGrantCandidate(transferId, fileId) : undefined;
      if (!file) { this.db.exec("ROLLBACK"); return null; }
      this.db.prepare(`UPDATE transfers SET grant_count = grant_count + 1,
        exhausted_at = CASE WHEN max_grants IS NOT NULL AND grant_count + 1 >= max_grants THEN ? ELSE exhausted_at END
        WHERE id = ?`).run(Date.now(), transferId);
      this.db.exec("COMMIT");
      return file;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  list(ownerId: string, offset = 0) {
    const rows = this.db.prepare(`SELECT t.id, t.title, t.created_at, t.expires_at, t.revoked_at, t.exhausted_at, t.max_grants, t.grant_count, t.state,
      t.content_kind, t.file_total AS file_count, t.size_bytes AS size,
      (SELECT GROUP_CONCAT(DISTINCT f.storage_backend) FROM files f WHERE f.transfer_id = t.id) AS storage_backend
      FROM transfers t WHERE t.owner_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 101 OFFSET ?`).all(ownerId, offset);
    return { items: rows.slice(0, 100), nextOffset: rows.length > 100 ? offset + 100 : null };
  }

  revoke(ownerId: string, id: string) {
    return this.db.prepare("UPDATE transfers SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
      .run(Date.now(), id, ownerId).changes > 0;
  }

  /** Generic failures avoid revealing whether an identifier or access code was wrong. */
  verify(id: string, code: string) {
    const row = this.db.prepare("SELECT * FROM transfers WHERE id = ?").get(id) as
      | { code_salt: string; code_hash: string; expires_at: number; revoked_at: number | null; text_content: string | null; title: string; max_grants: number | null; grant_count: number; state: string }
      | undefined;
    const salt = row?.code_salt ?? "00000000000000000000000000000000";
    const expected = row ? Buffer.from(row.code_hash, "hex") : Buffer.alloc(32);
    const valid = timingSafeEqual(scryptSync(code, salt, 32), expected);
    if (!row || !valid || row.state !== "ready" || row.revoked_at !== null || row.expires_at <= Date.now() ||
        (row.max_grants !== null && row.grant_count >= row.max_grants)) return null;
    return { title: row.title, content: row.text_content, expiresAt: row.expires_at };
  }

  close() { this.db.close(); }
}
