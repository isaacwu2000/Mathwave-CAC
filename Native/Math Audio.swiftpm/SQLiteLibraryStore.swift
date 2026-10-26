import Foundation
import SQLite3
import Darwin

/// Persists the complete library in SQLite without changing its backup format.
/// - Each save replaces one snapshot in a transaction, including drafts and history.
/// - A revision token rejects writes from a window that opened older work.
/// - Connections close after each operation; legacy files stay untouched during migration.
final class SQLiteLibraryStore {
  let url: URL
  private let legacyURL: URL
  private var revision: String?

  init(url: URL) {
    self.url = url
    legacyURL = url.deletingPathExtension().appendingPathExtension("json")
  }

  var exists: Bool { FileManager.default.fileExists(atPath: url.path) }

  /// Reads the database, or the old JSON file when no database exists.
  /// The caller validates legacy content before committing its first SQLite snapshot.
  func load() throws -> String? {
    try locked { try read() }
  }

  /// Reads storage while the caller holds the library's file lock.
  private func read() throws -> String? {
    guard exists else {
      revision = nil
      return FileManager.default.fileExists(atPath: legacyURL.path)
        ? try String(contentsOf: legacyURL, encoding: .utf8) : nil
    }
    return try connection(create: false) { db in
      try checkVersion(db)
      let statement = try prepare(db, "SELECT revision, library FROM problem_library WHERE id = 1")
      defer { sqlite3_finalize(statement) }
      guard sqlite3_step(statement) == SQLITE_ROW,
        sqlite3_column_type(statement, 1) == SQLITE_TEXT,
        let bytes = sqlite3_column_text(statement, 1) else {
        throw StorageFailure("The saved library is unreadable or missing.")
      }
      guard sqlite3_column_type(statement, 0) == SQLITE_TEXT,
        let token = sqlite3_column_text(statement, 0) else {
        throw StorageFailure("The saved library revision is invalid.")
      }
      revision = String(cString: token)
      let data = Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 1)))
      guard let library = String(data: data, encoding: .utf8) else {
        throw StorageFailure("The saved library is not valid text.")
      }
      return library
    }
  }

  /// Commits validated work and advances this reader's revision only after success.
  /// Lock, disk and stale-reader failures leave the previous snapshot unchanged.
  func save(_ library: String) throws {
    try locked { try commit(library) }
  }

  /// Publishes an initial database only after it commits; existing databases update in place.
  private func commit(_ library: String) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard exists else {
      guard revision == nil else { throw StorageFailure("The saved database is missing. Reopen the library before retrying.") }
      let staging = SQLiteLibraryStore(url: url.deletingLastPathComponent().appendingPathComponent(".initial-\(UUID().uuidString).sqlite"))
      defer {
        for suffix in ["", "-journal", "-wal", "-shm"] {
          try? FileManager.default.removeItem(atPath: staging.url.path + suffix)
        }
      }
      try staging.write(library, creating: true)
      // A hard link publishes the completed file atomically and refuses an existing destination.
      try FileManager.default.linkItem(at: staging.url, to: url)
      revision = staging.revision
      return
    }
    try write(library, creating: false)
  }

  /// Writes one snapshot; first-time files remain private until the commit succeeds.
  private func write(_ library: String, creating: Bool) throws {
    try connection(create: creating) { db in
      try execute(db, "PRAGMA synchronous = FULL")
      try execute(db, "BEGIN IMMEDIATE")
      var committed = false
      defer { if !committed { try? execute(db, "ROLLBACK") } }
      if creating {
        try execute(db, "CREATE TABLE problem_library (id INTEGER PRIMARY KEY CHECK (id = 1), revision TEXT NOT NULL, library TEXT NOT NULL)")
        try execute(db, "PRAGMA user_version = 1")
      } else {
        try checkVersion(db)
      }
      let current = try prepare(db, "SELECT revision FROM problem_library WHERE id = 1")
      let result = sqlite3_step(current)
      let storedRevision = result == SQLITE_ROW ? sqlite3_column_text(current, 0).map { String(cString: $0) } : nil
      sqlite3_finalize(current)
      guard result == SQLITE_ROW || result == SQLITE_DONE else { throw failure(db) }
      guard storedRevision == revision else {
        throw StorageFailure("Saved work changed in another window. Reopen the library before retrying; your draft is still available to export.")
      }
      let statement = try prepare(db, "INSERT INTO problem_library (id, revision, library) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, library = excluded.library")
      defer { sqlite3_finalize(statement) }
      let nextRevision = UUID().uuidString
      // SQLITE_TRANSIENT makes SQLite copy each temporary C string before withCString returns.
      let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
      let tokenBound = nextRevision.withCString { sqlite3_bind_text(statement, 1, $0, -1, transient) }
      let bound = library.withCString { sqlite3_bind_text(statement, 2, $0, -1, transient) }
      guard tokenBound == SQLITE_OK, bound == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw failure(db) }
      try execute(db, "COMMIT")
      committed = true
      revision = nextRevision
    }
  }

  /// Preserves unreadable files before explicit recovery, including any SQLite journal.
  /// Copies all originals first; a failed copy never removes active storage.
  func recover(with library: String, validate: (String) throws -> Void) throws {
    try locked { try archiveAndRecover(library, validate: validate) }
  }

  /// Rechecks readable work while excluding other app readers and writers from recovery.
  private func archiveAndRecover(_ library: String, validate: (String) throws -> Void) throws {
    var readable: String?
    do {
      if exists {
        try connection(create: false) { db in
          try execute(db, "BEGIN EXCLUSIVE")
          try execute(db, "ROLLBACK")
        }
      }
      readable = try read()
    }
    catch let error as StorageFailure {
      if error.code == SQLITE_BUSY || error.code == SQLITE_LOCKED { throw error }
    }
    if let readable, (try? validate(readable)) != nil {
      throw StorageFailure("Saved work can now be opened. Reopen the library instead of replacing it.")
    }
    let manager = FileManager.default
    let archive = url.deletingLastPathComponent().appendingPathComponent("unreadable-\(UUID().uuidString)")
    let originals = [url, URL(fileURLWithPath: url.path + "-journal"),
      URL(fileURLWithPath: url.path + "-wal"), URL(fileURLWithPath: url.path + "-shm"), legacyURL]
      .filter { manager.fileExists(atPath: $0.path) }
    if !originals.isEmpty {
      try manager.createDirectory(at: archive, withIntermediateDirectories: true)
      for original in originals {
        try manager.copyItem(at: original, to: archive.appendingPathComponent(original.lastPathComponent))
      }
      for original in originals where original != legacyURL { try manager.removeItem(at: original) }
    }
    revision = nil
    try commit(library)
  }

  /// Exports unreadable legacy text or an intact SQLite row without overwriting it.
  /// A damaged binary database stays on disk for the explicit archive/recovery action.
  func originalText() throws -> String {
    guard let text = try load() else { throw StorageFailure("There is no saved library to export.") }
    return text
  }

  /// Packages unreadable SQLite bytes and journals in a downloadable JSON archive.
  /// This preserves original files for repair; it is not a normal library import.
  func unreadableArchive() throws -> String {
    try locked { try archiveText() }
  }

  /// Encodes exact file bytes while the caller holds the library's file lock.
  private func archiveText() throws -> String {
    let manager = FileManager.default
    var files: [String: String] = [:]
    for suffix in ["", "-journal", "-wal", "-shm"] {
      let file = URL(fileURLWithPath: url.path + suffix)
      if manager.fileExists(atPath: file.path) {
        files[file.lastPathComponent] = try Data(contentsOf: file).base64EncodedString()
      }
    }
    guard !files.isEmpty else { throw StorageFailure("There is no saved database to export.") }
    let archive: [String: Any] = ["format": "mathwave-unreadable-sqlite", "version": 1, "files": files]
    return String(decoding: try JSONSerialization.data(withJSONObject: archive, options: [.sortedKeys]), as: UTF8.self)
  }

  /// Serializes file publication and recovery across app windows and processes.
  /// SQLite still owns transactional locking; this separate lock survives database replacement.
  private func locked<T>(_ action: () throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let descriptor = Darwin.open(url.path + ".lock", O_CREAT | O_RDWR | O_CLOEXEC, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw StorageFailure("Could not open the library lock.") }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      throw StorageFailure("Another window is saving this library. Retry in a moment.", code: SQLITE_BUSY)
    }
    defer { flock(descriptor, LOCK_UN) }
    return try action()
  }

  /// Opens a short-lived connection and closes it after success or failure.
  private func connection<T>(create: Bool, _ action: (OpaquePointer) throws -> T) throws -> T {
    var handle: OpaquePointer?
    let flags = SQLITE_OPEN_READWRITE | (create ? SQLITE_OPEN_CREATE : 0)
    let result = sqlite3_open_v2(url.path, &handle, flags, nil)
    guard let db = handle else { throw StorageFailure("Could not open the local SQLite database.") }
    defer { sqlite3_close(db) }
    guard result == SQLITE_OK else { throw failure(db) }
    sqlite3_busy_timeout(db, 1000)
    return try action(db)
  }

  /// Rejects unsupported schemas without changing the database.
  private func checkVersion(_ db: OpaquePointer) throws {
    let statement = try prepare(db, "PRAGMA user_version")
    defer { sqlite3_finalize(statement) }
    guard sqlite3_step(statement) == SQLITE_ROW, sqlite3_column_int(statement, 0) == 1 else {
      throw StorageFailure("This database version cannot be opened. The original file has been preserved.")
    }
  }

  /// Executes fixed SQL and propagates SQLite failures.
  private func execute(_ db: OpaquePointer, _ sql: String) throws {
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw failure(db) }
  }

  /// Prepares fixed SQL; the caller owns finalizing the returned statement.
  private func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw failure(db)
    }
    return statement
  }

  /// Reports the SQLite error without including the student's library contents.
  private func failure(_ db: OpaquePointer) -> StorageFailure {
    StorageFailure("SQLite could not finish: " + String(cString: sqlite3_errmsg(db)), code: sqlite3_errcode(db))
  }
}

private struct StorageFailure: LocalizedError {
  let errorDescription: String?
  let code: Int32?
  init(_ message: String, code: Int32? = nil) { errorDescription = message; self.code = code }
}
