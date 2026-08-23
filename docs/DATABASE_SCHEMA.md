# Database schema

SQLite runs with foreign keys and write-ahead logging enabled.

## `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | UUID |
| `email` | TEXT UNIQUE | case-insensitive |
| `name` | TEXT | display name |
| `password_hash` | TEXT | scrypt salt and digest |
| `created_at` | TEXT | ISO timestamp |

## `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id_hash` | TEXT PK | SHA-256 digest of opaque cookie token |
| `user_id` | TEXT FK | cascades when user is removed |
| `expires_at` | INTEGER | Unix milliseconds |
| `created_at` | TEXT | ISO timestamp |

## `documents`

Stores owner, safe storage name, detected file/return type, GSTIN, period, status, record count, normalized JSON, mapping JSON, anomaly JSON, and the optional original/hidden document-view preference. `user_id` is indexed.

## `reconciliations`

Stores owner, selected document IDs, tolerances, status, immutable result JSON, and creation time. Historical results therefore remain reproducible even if a document mapping is later changed.
