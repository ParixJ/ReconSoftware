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

Stores owner, safe storage name, detected file/document type, GSTIN, period, status, record count, normalized JSON, mapping JSON, anomaly JSON, and the optional original/hidden document-view preference. `user_id` is indexed. Multi-period sales registers keep `return_period` null at the document level and store their monthly control totals inside the normalized JSON `periods` object.

## `reconciliations`

Stores owner, selected document IDs, tolerances, status, the comparison-result snapshot, and creation time. Result JSON contains a `periods` array with independent monthly comparison groups. Reconciliation GET responses re-evaluate the selected documents with their current mappings so resolved defects disappear and corrected return periods move into the proper monthly group.
