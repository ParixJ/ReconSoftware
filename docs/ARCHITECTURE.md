# Architecture

## Boundaries

The application is a two-surface client/server system:

- `client`: React single-page UI. React Router owns the authentication and workspace routes, Zustand owns session state, and Axios owns API calls.
- `server`: Express API. It owns authentication, authorization, file storage, parsing, mappings, reconciliation, and persistence.
- `server/data`: local production-capable SQLite database and uploaded originals. This is intentional local persistence, not a mock adapter.

The browser never parses a return and never receives another user's data. Every document and reconciliation query is scoped to the authenticated user on the server.

## Modules

```text
client/src
  api/             Axios client and endpoint functions
  components/      Upload, document, mapping, and reconciliation UI
  pages/           Authentication and auditor workspace
  store/           Zustand authentication state
  utils/           Display-only formatting

server/src
  api/             Machine-readable endpoint contract
  db/              SQLite connection and schema
  middleware/      Authentication and error handling
  parsers/         File detection and format-specific parsing
  routes/          Express route adapters
  services/        Authentication, documents, and reconciliation logic
```

## File processing

Multer streams uploads to disk with generated names. The parser then inspects file signatures/content and uses a format-specific parser. The normalized representation and anomalies are stored transactionally with document metadata. Original filenames are display metadata only and are never used as storage paths.

For tabular or text sources, the backend also records mapping coverage. If minimum reconciliation fields are missing, normalized rendering is blocked until the user either completes the mapping, explicitly renders the original extracted columns, or keeps the document table hidden. That preference is persisted per document.

## Security model

- Passwords use Node's `scrypt` with a per-password random salt.
- Opaque session tokens are sent in HTTP-only, SameSite=Strict cookies; only SHA-256 token digests are stored in SQLite.
- Sessions expire server-side and are removed on logout.
- All document, mapping, and reconciliation routes require a valid user session and scope SQL by `user_id`.
- Upload size, count, extensions/content, mapping keys, and reconciliation inputs are validated server-side.
