# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/frida-analyzer` (`@workspace/frida-analyzer`)

React + Vite frontend for **ReverseKit** — iOS Analysis Platform. Connects to `api-server` at `/api`.

- Entry: `src/App.tsx` — wouter router with pages: Home, Binary Inspector, Binary Diff, Hex Viewer, Script Arsenal, Device Manager
- API base: computed from `import.meta.env.BASE_URL`
- Pages: `src/pages/` — each page is a self-contained component
  - `home.tsx` — Welcome page with tool cards, Quick Start guide, Integrated Analysis Engines listing
  - `binary-analyzer.tsx` — Full static analysis UI with 20 tabs (Ghidra Source, RetDec Source, ObjC Headers, Pseudo-C, Functions, ObjC Classes, Symbols, Imports, Strings, Libraries, Pattern Scan, URLs, Entitlements, Swift Metadata, YARA Scan, Class-dump, String Decrypt, ROP Gadgets, Disassembly, Sections) + security properties panel + obfuscation detection + CodeViewer component
  - `binary-diff.tsx` — Binary Diff: compare two iOS binaries, shows changes in classes, methods, symbols, strings, libraries, sections
  - `hex-viewer.tsx` — Upload any file, view hex bytes + ASCII + file info + magic bytes
  - `scripts.tsx` — Script Arsenal with localStorage persistence, built-in Frida scripts
  - `device.tsx` — Consolidated Device Manager: Frida connection, process browser, app spawner, sessions, class/method browser, hooks, script executor
- Layout: `src/components/layout.tsx` — dark sidebar with sections (Analysis, Toolkit) + Frida connection status

### Binary Analyzer Engine

- **Python script**: `artifacts/api-server/src/lib/analyze_binary.py`
  - Tools: lief (Mach-O parsing), capstone (ARM64 disassembly), r2pipe (radare2), ROPgadget, pwntools checksec, YARA 4.5 (threat scanning), llvm-nm, llvm-objdump, strings
  - **Archive extraction**: Automatically extracts .dylib binaries from .deb (ar+tar+zst), .ipa (zip), and .zip archives before analysis
  - **Decompilers**: Ghidra 11.3.2 (headless), RetDec 5.0, radare2 pdc (all three produce C source code)
  - **Ghidra script**: `artifacts/api-server/src/lib/ghidra_decompile.py` — Jython postScript that runs inside Ghidra headless, decompiles up to 300 functions, writes output to a temp file
  - **ObjC Headers**: class-dump equivalent using lief — extracts @interface declarations, methods, properties, ivars
  - **Enhanced Class-dump**: Full reconstruction with typed properties, method signatures, categories, forward declarations, protocol listing
  - **YARA Scan**: 10 custom iOS rules — jailbreak detection, anti-debug, Frida detection, SSL pinning, encryption, Logos/Substrate tweaks, malware indicators, obfuscation, network exfiltration, privacy violations
  - **String Decryption**: Detects Base64, XOR, hex-encoded, ROT13, high-entropy suspicious blobs
  - **Binary Diff**: `artifacts/api-server/src/lib/binary_diff.py` — compares two binaries: classes, methods, symbols, strings, libraries, sections
  - Detects: obfuscation (Hikari, OLLVM), anti-debug (ptrace, sysctl), jailbreak detection, Frida detection, SSL pinning, root detection, XOR string encryption
  - Outputs: hashes, Mach-O structure, ObjC classes+methods, symbols, imports, sections, security properties, ROP gadgets, Ghidra C source, RetDec C source, ObjC headers, radare2 pseudo-C, YARA scan, class-dump, string decryption
- **CodeViewer component**: `artifacts/frida-analyzer/src/components/code-viewer.tsx` — Professional code viewer with Prism.js syntax highlighting, line numbers, search (Ctrl+F), copy, per-file download, macOS-style toolbar
- **API routes** (`artifacts/api-server/src/routes/binary.ts`):
  - POST `/api/binary/analyze` — Full binary analysis with multer upload, 300s timeout, 50MB buffer
  - POST `/api/binary/hexdump` — Hex dump of uploaded file (offset/length params, max 64KB)
  - POST `/api/binary/fileinfo` — File type, size, magic bytes
  - POST `/api/binary/diff` — Compare two binaries (multipart: file1, file2), 60s timeout
- **Python path**: `/home/runner/workspace/.pythonlibs/bin/python3`
- **ROPgadget path**: `/home/runner/workspace/.pythonlibs/bin/ROPgadget`
- **Ghidra path**: `/nix/store/2pbav18pr4rn4v2ngimf29gjkv6l47l6-ghidra-11.3.2/bin/ghidra-analyzeHeadless`
- **RetDec path**: `/nix/store/v6k7ayjdqaflpia7hcbjv3vh9dyz4ck6-retdec-5.0/bin/retdec-decompiler`

### System Tools (replit.nix)

radare2 5.9.8, binutils, llvm (objdump/nm), python3, retdec, ghidra

### Python Packages (.pythonlibs)

lief 0.17.6, capstone 5.0.7, keystone-engine, ROPgadget 7.7, pwntools 4.15.0, r2pipe, frida-tools 17.9, objection 1.12, yara-python 4.5.4, unicorn 2.0.1
Note: angr has cffi/pycparser conflicts on Python 3.11 — not installed.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
