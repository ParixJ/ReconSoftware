# Architecture

## Boundaries

The application is a two-surface client/server system:

- `client`: React single-page UI. React Router owns the authentication, Home, and reconciliation-history routes, Zustand owns session and theme state, and Axios owns API calls.
- `server`: Express API. It owns authentication, authorization, file storage, parsing, mappings, reconciliation, and persistence.
- `server/data`: local production-capable SQLite database and uploaded originals. This is intentional local persistence, not a mock adapter.

The browser never parses a return and never receives another user's data. Every document and reconciliation query is scoped to the authenticated user on the server.

## Modules

```text
client/src
  api/             Axios client and endpoint functions
  components/      Upload, document, mapping, and reconciliation UI
  pages/           Authentication, auditor Home, and reconciliation history
  store/           Zustand authentication and theme state
  utils/           Display formatting and reconciliation-history grouping

server/src
  server.js        Process entry point and shutdown
  app.js           Shared Express setup, sessions, static client, and errors
  config.js        Shared runtime configuration and storage locations
  errors.js        Shared application error type
  api/             Machine-readable endpoint contract
  db/              Shared SQLite connection and existing schema
  middleware/      Shared authentication and error handling
  routes/
    index.js       Universal API router: health, authentication, service mounts
    authRoutes.js  Shared authentication endpoints
  services/
    authService.js Shared user and session logic
  sales_recon/
    app.js         Sales module router exported to the universal router
    routes/        Document, original-document, and reconciliation adapters
    parsers/       Sales/GST file detection, extraction, and normalization
    services/      Sales document, reconciliation, and export logic
```

The backend remains one Express process with service-specific modules. Shared infrastructure lives outside those modules. `server/src/app.js` mounts the universal router at `/api`; the universal router imports each module's `app.js`, which exports an Express `Router` and registers only that module's routes. Module routers do not create servers, sessions, database connections, static-file handlers, or terminal error handlers.

The sales module retains `/api/documents`, `/api/document-org`, and `/api/reconciliations`. Authentication remains at `/api/auth`, and health remains at `/api/health`. Authentication middleware is attached to each protected sales route prefix rather than the whole module router, allowing unrelated future modules and unknown paths to reach their own handlers. Existing database tables, storage paths, and API payloads are unchanged.

To integrate another service, create a sibling directory under `server/src` with an `app.js` exporting a router and its own `routes/`, `services/`, and any required `parsers/`. Import and mount that router once in `routes/index.js`, using a distinct route prefix for new services. Reuse shared authentication and errors, and let failures reach the shared error handler. Document the service's endpoints in `api/contracts.js` and `docs/API_CONTRACTS.md`; document any separately approved persistence changes in `docs/DATABASE_SCHEMA.md`. Module-specific tests should import from the module directory, while API integration tests should continue using the shared `createApp()` factory.

The sales workbook export resolves `sample-docs/GST_Reconciliation.xlsx` from the repository root. This required template must be supplied for exports; a missing template raises `RECONCILIATION_TEMPLATE_MISSING` rather than substituting generated data.

## File processing

Multer streams uploads to disk with generated names. The parser then inspects file signatures/content and uses a format-specific parser. GSTR-1 and GSTR-3B PDFs are routed to independent table parsers after text extraction. XLSX workbooks with a recognized ledger header are parsed as sales registers, with dated rows grouped into monthly control totals and credit entries kept as signed adjustments. The normalized representation, anomalies, and ordered original field metadata are stored transactionally. Original values are re-extracted from the safely stored upload only when the document viewer requests them, so source presentation stays independent of reconciliation normalization without duplicating full source rows in SQLite. Original filenames are display metadata only and are never used as storage paths.

For tabular or text sources, the backend also records mapping coverage. Mapping coverage controls reconciliation readiness, but it does not hide fields in the document viewer: every extracted original field is rendered through the separate original-document endpoint regardless of whether the backend maps or uses it.

The reconciliation service always requires GSTR-1 and GSTR-3B. The Home UI cross-examines client GSTIN metadata as the selection changes, while the server independently repeats that check against the authenticated document rows before persisting a run. A selection containing different known client GSTINs is rejected atomically. Missing GSTINs continue through the mapping-exception workflow, but no value comparison uses a document whose client identity is unverified. A selected sales register adds books-to-GSTR-1 taxable-outward checks for the return period represented by the selected returns; a multi-period register contributes only its matching monthly bucket. GSTR-2B remains optional and adds ITC checks.

Home (`/home`) owns document upload, selection, mapping, preview, and starting a reconciliation. Reconciliation history (`/reconciliations`) groups the authenticated user's stored results by client GSTIN and return-period year. When a client month has been reconciled more than once, the newest saved result is shown for that monthly tab. A month is categorized only when its result documents belong to the reconciliation's authoritative selection and at least one of its GSTR-1/GSTR-3B documents identifies one consistent client GSTIN; selected returns with a missing GSTIN remain visible as resolvable exceptions. Legacy `/workspace` links redirect to the corresponding Home route.

The history report can be exported to the provided `GST_Reconciliation.xlsx` workbook format. The authenticated server selects the same newest monthly results for the requested client/year, recalculates the GSTR-1 B2B/B2C/note split and sales-register controls from current parsed documents, and replaces only the numeric cells in the template's `Taxable Value` and `Output Tax` worksheets. The bundled template remains unchanged.

## Security model

- Passwords use Node's `scrypt` with a per-password random salt.
- Opaque session tokens are sent in HTTP-only, SameSite=Strict cookies; only SHA-256 token digests are stored in SQLite.
- Sessions expire server-side and are removed on logout.
- All document, mapping, and reconciliation routes require a valid user session and scope SQL by `user_id`.
- Upload size, count, extensions/content, mapping keys, and reconciliation inputs are validated server-side.
