# Impactor — Technical Architecture

Version: 0.1 — proposed architecture baseline
Date: November 16, 2026
Lens: AI-Centered Development (AICD)
Status: Design, not an inventory of implemented modules

**Implementation update (November 17, 2026):** The user-approved publisher now packages the actual shared runtime as a self-contained static website, rather than requiring hosted Impactor to render a stored snapshot. See [publishing.md](publishing.md) for implemented build boundaries, pinned SDKs, explicit Fuji funding/upload consent, content verification and recovery. New publication URLs point directly to the fixed Irys gateway; `/dapp/[txId]` remains a separate legacy JSON-snapshot loader. The older snapshot-host design below is historical where it differs. Integration is experimental: independent static-host and mocked browser-SDK tests pass, but live wallet funding/signing and public gateway delivery still require manual acceptance.

## 1. Architecture summary

Build a client-first modular application with one versioned project schema, one portable runtime, isolated external-service adapters, and a source exporter that packages the same runtime. Keep the editor, authored data, runtime session, and irreversible external effects separate.

The P0 execution network is Fuji. Mainnet/custom-L1 execution is a later capability. Irys publication is conditional on actual payment, browser-wallet, and retrieval validation. The system does not require an AI service, account backend, SQL database, or harness engineering kit.

Related documents: `prd.md` for product scope; `srs.md` for FR/NFR requirements; `ui-ux-design-principles.md` for presentation and interaction contracts. `/dapp/[txId]` is the single proposed published-runtime route; the earlier brief's `/preview/[irysTxId]` and `/live/[slug]` are not additional P0 routes.

## 2. AICD interpretation and boundaries

The user selected **AI-Centered Development**. No specific external AICD standard or reference implementation was supplied, so the structure below is an explicit project interpretation—not a claim of certification or compliance with a named formal standard.

For Impactor, AICD means designing implementation work so an AI coding assistant can operate on small, explicit contracts while humans retain product decisions, review responsibility, and signing authority:

| AICD concern | Impactor application | Evidence of correctness |
|---|---|---|
| Explicit intent | PRD journeys and numbered SRS requirements define outcomes and limits | Requirement-to-test mapping |
| Bounded implementation context | Modules have clear responsibilities and dependency directions | Import-boundary checks and focused review |
| Machine-checkable contracts | Versioned schema, block/action registries, typed adapter interfaces | Runtime validation, strict typecheck, fixture tests |
| Fast feedback | Pure tests first; adapter and browser tests for external behavior | Recorded checks, not assistant assertions |
| Human control | Review source/artifacts and authorize transactions/uploads | Wallet consent and reviewed changes |
| Reproducibility | Pinned dependency/artifact manifests and generated lockfile | Clean-directory build and runtime parity |

This is ordinary development discipline assisted by AI. It introduces no custom agent runtime, model orchestration, prompt library, MCP dependency, harness gates, process router, or engineering-kit installation. Any optional coding assistant is a development tool, not a component shipped to dApp visitors.

## 3. System context and trust boundaries

### Product-controlled components

- **Studio:** browser editor, project validation, local persistence, and preview shell.
- **Portable runtime:** block rendering, bindings, runtime variables, sequential workflow execution, and adapter calls.
- **Template catalog:** reviewed source/build metadata and deployable ABI/bytecode artifacts.
- **Exporter:** client-side packaging of schema, runtime source, configuration, and fixed Next.js application templates.
- **Published-runtime loader:** conditional bounded snapshot retrieval and validation before runtime construction.

### External components

- Browser wallet holds signing authority; Impactor never stores private keys or seed phrases.
- Avalanche RPC supplies reads, simulations, submissions, and receipts.
- Avalanche C-Chain/Fuji or a separately tested custom EVM L1 executes contracts.
- Optional Irys service handles supported funding/upload/retrieval operations.
- The deployment host serves Studio and the runtime application. External frontend hosting remains necessary; storing project JSON does not itself host executable Next.js code.
- Package registries and a receiving developer's build environment are needed to install/build exported source.

### Trust rules

Imported JSON, gateway responses, ABIs, user URLs, RPC errors, and contract outputs are untrusted. A valid schema is not proof that its author is trustworthy or that a transaction is safe. An ABI can misdescribe a contract, and code presence at an address is not source verification or an audit.

The portable runtime must render data through an allowlisted registry, never execute code carried in a project. Opening a project or published link must not trigger signatures, deployment, paid upload, or automatic wallet connection.

## 4. Proposed stack and version decisions

| Responsibility | Proposed choice | Constraint |
|---|---|---|
| Application shell | Next.js App Router, React, strict TypeScript | Brief names Next.js 15/React 19; verify compatible patched releases before scaffolding |
| UI | Tailwind CSS, Shadcn/UI, Lucide React | Accessible defaults still require interaction testing |
| Authoring state/history | Zustand + zundo | Authored schema history only; exclude external effects |
| UI placement | `@dnd-kit/core` plus explicit move/reorder controls | Dragging is never the only route |
| Workflow editing | `@xyflow/react` | Store semantic graph separately from editor-specific selection/viewport |
| Chain access | wagmi v2, viem, TanStack Query, RainbowKit | Separate public reads from wallet actions; test selected connectors |
| Local persistence | Browser IndexedDB | Revision-aware transactions and visible failure states |
| Boundary validation | Proposed Zod schemas | New design choice; pin and test a compatible version during implementation |
| ZIP generation | JSZip | Fixed safe file paths and serialized data, not schema-to-code string interpolation |
| Storage | Conditional Irys adapter | Package names in brief are candidates, not validated compatibility |
| Testing | Proposed Vitest + React Testing Library + Playwright; contract tests with one selected Solidity toolchain | Do not add two competing contract toolchains without need |

Next.js's support policy, checked November 16, 2026, lists version 15 as Maintenance LTS with extended security releases through January 31, 2027. Do not scaffold an unpatched 15.x release or silently freeze the project onto an expiring line. Select a supported patched stack at implementation time and explicitly record any change to the brief's major-version choice. No exact dependency versions are invented in this document.

## 5. Module decomposition and dependency direction

These paths are proposed targets, not existing source files.

| Module | Proposed location | Owns | Must not own |
|---|---|---|---|
| Schema and semantic validation | `src/lib/schema/` | Versioned types, parsing, canonical serialization, reference/graph validation, limits | Wallet sessions or React components |
| Studio shell | `src/components/studio/` | Panels, selection, inspector, layout/history commands | Contract submission logic |
| Authoring store | `src/store/useStudioStore.ts` | Current schema revision and ephemeral editor state | Serializing wallet clients or pending promises |
| Local repository | `src/lib/persistence/` | IndexedDB draft revisions and separate minimal run journals | On-chain state ownership |
| Block registry | `src/components/blocks/` | Allowed block types, typed prop editors, shared semantic rendering | Arbitrary HTML or source evaluation |
| Workflow editor | `src/components/workflow/` | React Flow mapping and configuration UI | Business execution semantics |
| Portable engine | `src/lib/engine/` | Binding resolution, runtime state, graph execution, action states and cancellation | Browser-wallet SDK globals or Studio imports |
| Web3 adapter/catalog | `src/lib/web3/` | Network configurations, viem/wagmi integration, artifact manifests, exact call/deployment submission | Implicit project edits or success toasts |
| Optional storage adapter | `src/lib/irys/` | Verified quote/fund/upload/retrieve flows | Unverified AVAX promises or embedded credentials |
| Exporter | `src/lib/exporter/` | Fixed app templates, runtime-source bundle, project data and ZIP packaging | A second handwritten workflow engine |
| Application composition | `src/app/`, `src/components/providers/` | Routes, client boundaries, adapter/provider construction | Duplicated validation/business rules |

Dependency direction: application/editor code depends on schema and runtime contracts; runtime depends on schema plus narrow interfaces; concrete wallet/storage adapters implement those interfaces. The runtime never imports the Studio store, React Flow editor objects, or exporter. Shared React blocks may use a supplied runtime context but must not inspect editor internals.

Keep this a modular codebase, not a microservice system. Do not create separate services merely to mirror each row.

## 6. Data model and state ownership

### 6.1 Authored project

The versioned `ImpactorProjectSchema` is the portable source of truth:

| Field | Meaning and invariants |
|---|---|
| `schemaVersion` | Explicit supported version; unsupported future versions rejected |
| `id`, `name` | Stable project identity and display name; names never become unsanitized paths |
| `network` | dApp execution chain ID, RPC configuration and native-currency metadata |
| `contracts[]` | Logical ID, chain ID/address, validated ABI, exposed canonical signatures, optional artifact/source metadata |
| `variables[]` | Declared name, type and JSON-serializable initial value |
| `uiTree` | One rooted tree of discriminated supported blocks |
| `workflows` | Typed semantic nodes/edges forming finite sequential trigger chains |
| Optional `assets[]` | Validated external content references and metadata; no browser file handles |
| Optional publication configuration | Verified storage environment/payment-chain selection, separate from dApp execution network |

Each block/action type has a discriminated configuration schema; broad `Record<string, JsonValue>` portability is not permission to accept arbitrary properties. ABI parameters and outputs use an explicitly supported scalar type subset for P0. Unsupported arrays/tuples are rejected for interactive configuration, not guessed.

`JsonValue` permits JSON strings, finite numbers, booleans, null, arrays, and objects. Chain integer values cross serialization boundaries as validated decimal strings; decimal token quantities require explicit token-decimals conversion. Wallet clients, `bigint`, `File`, functions, and secrets never enter the schema.

### 6.2 Separate state domains

| State | Persistence | Included in project/export? |
|---|---|---|
| Authored schema and revision | IndexedDB draft | Schema yes; local revision bookkeeping no |
| Selected block, active panel, viewport | Memory; optional local preference | No |
| Wallet account/connection and clients | Wallet/provider context | No |
| Runtime input and mutable variables | Runtime session memory | Initial defaults only |
| Run/step status and minimal transaction identifiers | Memory; local redacted journal when available | No |
| Published snapshot | Storage provider if enabled | Explicit frozen schema, not local session state |

A snapshot's content hash can detect byte differences but is not an author signature, security endorsement, or substitute for gateway/provider identity guarantees. Publication metadata should live outside the authored snapshot when including it would create a self-reference.

### 6.3 Persistence and deterministic serialization

Use one IndexedDB transaction to compare expected revision and write the next draft. A stale tab receives a conflict result and offers reload, duplicate, or JSON backup; it must not silently win. Browser storage remains fallible and may be cleared.

Canonical serialization sorts object keys while preserving array order, uses validated finite JSON values, and excludes volatile runtime timestamps/session fields. For identical authored input, serialized project bytes should match. ZIP build reproducibility additionally requires fixed entry metadata/order and the selected template/runtime version; do not confuse schema determinism with automatically byte-identical archives.

## 7. Portable execution design

### 7.1 Binding resolver

Compile a restricted reference grammar into typed lookups for constants, declared variables, wallet context, supported input values, and prior step outputs. Reject prototype keys, undeclared paths, function calls, forward references, and arbitrary expressions. Never use `eval`, `Function`, or dynamic source imports from project data.

Whole-value references retain type. Text interpolation produces escaped text. Contract-argument conversion is explicit and validated: strings are not silently converted to zero, and native/token quantities are not processed using floating-point arithmetic.

### 7.2 Runtime ports

Define small typed interfaces for the actual requirements, not a plugin platform:

- **Chain port:** check network/code, read supported contract methods, prepare/simulate a call, estimate deployment/call costs where supported, submit an explicitly reviewed request, and monitor receipts/replacements.
- **Consent port:** present exact action intent, disclose chain/account/value, obtain a deliberate choice, and invalidate consent if material inputs change. Wallet approval remains an additional independent requirement.
- **Storage port, conditional:** validate capability, quote, fund only if required/approved, upload, and retrieve a bounded payload.
- **Session port:** publish step-state changes and retain minimal read-only reconciliation information without copying full user input into logs.

Concrete implementations belong at application composition boundaries. Engine unit tests can supply deterministic adapters; real-wallet/Fuji checks still remain required.

### 7.3 Graph and run semantics

P0 graph validation yields one ordered action list per supported UI trigger. Trigger has no incoming edge; each action has one predecessor; each node has at most one successor. Reject cycles, branches, merges, orphans, ambiguous event mapping, and more than 50 steps per run.

At run start, freeze the project revision and current input values. Allow one active run per runtime instance; reject duplicate clicks rather than queuing them. Recheck account/chain before every signature and after asynchronous preparation. A changed account/network invalidates prior review/simulation before submission.

Step states: idle, validating, awaiting consent, awaiting wallet, submitted, confirming, succeeded, rejected, reverted, cancelled, failed, or unknown. A run may finish with partial external completion. Failed/unknown predecessors do not unlock downstream success actions.

Cancellation stops unstarted work. It cannot roll back chain state or uploaded bytes. A reload can reconcile known hashes read-only but must not automatically replay writes, resume payments, or continue the old workflow.

### 7.4 Contract-write flow

1. Resolve and validate canonical function signature, chain/address, account, arguments, and native value.
2. Check wallet/network and contract code. Prepare/simulate on the selected chain; decode supported custom errors when ABI information exists.
3. Display review with method, address, signer, value, network, token-unit conversions, permissions implications and estimate availability.
4. After deliberate continuation, recheck context and request wallet submission. A wallet response containing a hash means submitted, not confirmed.
5. Monitor the original chain for a receipt. Handle provider errors, timeout, and known replacements.
6. Mark chain execution confirmed only from a successful receipt under the configured confirmation policy. Timeout is unknown, not proof of failure. Replacement with different intent or cancellation stops dependent actions; a same-intent fee repricing may continue with its replacement hash.
7. Refresh relevant reads and run remaining configured feedback steps only when their prerequisites hold.

A successful simulation can become stale. A successful receipt proves successful transaction execution under chain rules, not every business assertion (for example an arbitrary contract could return false without reverting). Use accurate “transaction confirmed” wording; business-success claims require supported decoded results or a configured verified postcondition.

Automatic retries apply only to reads/status checks, never uncertain submissions. This prevents in-instance replay but does not guarantee exactly-once behavior across devices, tabs, wallets, or the blockchain; true business idempotency needs contract-level support.

## 8. Templates and deployments

Maintain source-controlled artifact manifests with template ID/version, exact Solidity compiler and settings, source/dependency versions, constructor schema, ABI, bytecode, permissions description, license and integrity metadata.

Provide two narrowly specified contracts: fixed-supply ERC-20 and owner-only mint ERC-721. No upgradeability, hidden mint authority, unrestricted public mint, or claim/allowlist semantics unless separately designed. Ownership must match the reviewed constructor parameters; imported projects cannot replace built-in artifact bytecode while retaining a trusted-template label.

Build artifacts reproducibly from pinned sources and compare their hashes; test constructors, supply/mint permissions and failure cases. Successful Fuji deployment and artifact comparison are not security audits. A published code-verified status is separate from deployment status, and its implementation must be independently demonstrated.

## 9. Publication and retrieval, conditional

The Irys adapter remains disabled until a documented browser proof confirms current SDK packages, wallet compatibility, supported funding chain/asset, endpoint/environment, payload limits, fee/funding behavior, completion semantics, gateway/CORS and retrieval guarantees.

Do not assume Fuji dApp execution implies a Fuji storage payment route. If the available storage flow requires a different chain or real AVAX, disclose that exact chain/asset and cost and obtain consent; do not run it in automated acceptance tests by default.

Publishing proceeds through validate/freeze → public-data review → actual-byte quote → approved funding if required → asset uploads if supported → validated snapshot upload → retrieve/compare/validate → verified runtime link. Earlier payments/uploads may remain if later steps fail. The UI must not promise rollback, content deletion, or permanent availability without provider evidence.

For `/dapp/[txId]`, validate the provider identifier and fetch only through configured gateway roots with byte/time limits. Prefer browser retrieval for P0, avoiding an arbitrary URL-fetching server. If a fixed-origin server loader is later chosen for CORS/metadata, separately design SSRF protections, quotas, redirects and caching. Nothing from a fetched project is executable code.

The runtime host serves the actual application code; Irys serves the schema/assets. Both availability paths matter. New revisions use new identifiers; mutable slugs and custom domains need an additional mapping/hosting design and are outside P0.

## 10. Source export and parity

Use a versioned source bundle generated from the portable runtime/blocks at Impactor build time. The client exporter combines that bundle with fixed Next.js app templates and safely serialized validated project JSON. Do not hand-maintain a second interpreter or concatenate user strings into executable code.

The ZIP contains a dependency manifest and tested lockfile, runtime/block source, project schema, public environment placeholders, provider setup, scripts for typecheck/lint/build, setup instructions, license notices and template metadata. Node-only build tooling remains a developer dependency; the authored dApp still performs browser wallet actions.

Exclude Studio/editor dependencies, account sessions, run journals, local file handles and secrets. Keep the export name/path sanitized. Declare external RPC, wallet and optional storage dependencies honestly; “standalone” means no required hosted Impactor execution service, not no external infrastructure at all.

Run the same fixture expectations in local preview, clean exported app, and published runtime when enabled. Coverage must include bindings, decimal conversion, failure/rejection states, chain context and receipt status. Validate install/typecheck/lint/production build in a fresh directory before treating export as working.

## 11. Security, privacy, and operational boundaries

| Threat | Design control | Residual limit |
|---|---|---|
| Malicious schema/markup | Strict version/type/reference validation; allowlisted blocks/styles/URL protocols; escaped text | Supported contracts can still implement harmful logic |
| Deceptive wallet action | Explicit method/address/value/network review; fresh account/chain check; no automatic page-load writes | User can still approve a harmful or misdescribed imported contract |
| Duplicate paid action | One active run per instance; no automatic paid retry; persistent known hashes where available | Cross-device deduplication requires more than UI state |
| Resource exhaustion | 1 MiB JSON, 500 blocks, depth 20, 200 workflow nodes, 50 steps/run; bounded retrieval | External provider rate limits and outages remain |
| Secret leakage | No secret inputs stored in public schema; inspect publication/export content; redact diagnostics | Public RPC credentials remain public and should be domain-restricted where available |
| Dependency/artifact tampering | Pinned versions, reproducible artifacts, reviewed manifest, checks before release | Does not eliminate upstream compromise |
| False frontend authorization | UI visibility never presented as contract permission enforcement | Contract/backend must enforce actual access control |
| Local-data loss/conflict | Atomic revision writes, conflict UI, JSON backups | Cleared/unavailable storage cannot be made durable without a separate service |

No telemetry backend is required for P0. Diagnostics are local/redacted and exported deliberately. Do not send customer projects, wallet identifiers, RPC keys, private source, or sensitive input to an AI service without explicit authorization and a separate data-handling decision.

## 12. Deployment and operations

Deploy one Next.js application for landing, Studio and the conditional runtime route. Client-mark browser-dependent modules explicitly; prevent wallet/store initialization during server rendering. Lazy-load editor/workflow/ZIP/storage modules to avoid shipping Studio weight into runtime.

Use environment-specific public configuration for wallet-project identifiers, allowed gateways and public RPC defaults. Server secrets must not appear in browser-prefixed environment variables. Wallet relay/project identifiers that are necessarily public must be documented as public and configured with provider-supported origin restrictions.

Keep Studio origin permissions, CSP/connect-src policy, supported custom-RPC behavior, caching, and gateway choices consistent. A fixed strict connect-src allowlist may conflict with arbitrary custom RPC URLs; resolve this before P1 rather than silently disabling protection or promising unrestricted custom networks.

Keep a published-runtime-compatible version available for supported schema versions. Unknown versions get an explanatory error, not an implicit migration. Immutable old snapshots cannot be patched in place; runtime security patches and version support policy still require host maintenance.

No database/service architecture is prescribed for later billing, team sync, indexing or custom domains. Add those only through their own requirements, data ownership and threat model.

## 13. AI-assisted implementation and verification

For each vertical slice, provide the coding assistant the relevant requirements, exact module interfaces, supported feature subset, and fixture expectations. Ask it to change bounded files and preserve dependency direction. Review the resulting diff and actual test output; a model's summary is not evidence.

Humans retain approval for product scope, template privileges, dependency changes with security impact, published data, payments and value-bearing deployments. Tests must be derived from requirements independently of the generated implementation so a mistaken implementation does not simply define its own passing criteria.

No new API integration, provider choice, token budget, autonomous agent runtime, or harness kit is required. If future product AI generation is requested, specify it separately, including consent, cost, evaluation and strict schema validation; AI output must not directly authorize a wallet action.

## 14. Implementation sequence and decisions to close

1. Define schema, canonical serialization, supported block/action types, limits and malicious fixtures.
2. Deliver Studio with local revision-aware persistence, history and inert Edit mode.
3. Deliver portable renderer/engine with deterministic adapters and controlled EVM tests.
4. Add actual wallet/Fuji integration and reproducible deployment artifacts.
5. Package source export and prove parity in a fresh app.
6. Enable Irys only after compatibility, payment and retrieval evidence; otherwise report it as deferred.

Before starting, close exact supported patched framework versions, artifact source/compiler choices, selected test toolchain and public RPC/wallet configuration. Before publication, close Irys adapter proof and public-data policy. Before P1, close Mainnet/custom-L1 safety, RPC/CSP policy and network-support claims.

## 15. External technical references

References identify implementation assumptions, not a complete dependency audit. Official pages checked November 16, 2026; recheck before coding. The project has no supplied formal AICD reference.

- Next.js, **Support Policy** — `https://nextjs.org/support-policy` — version lifecycle and the need to select maintained patched releases.
- viem, **simulateContract** — `https://viem.sh/docs/contract/simulateContract` — simulation versus actual write submission and its limitations.
- viem, **waitForTransactionReceipt** — `https://viem.sh/docs/actions/public/waitForTransactionReceipt` — confirmations, polling, replacements and timeout behavior.
- W3C, **Web Content Accessibility Guidelines 2.2** — `https://www.w3.org/TR/WCAG22/` — accessibility target; detailed UI requirements live in the design document.

TL;DR: Use a deterministic, typed, portable runtime with isolated wallet/storage boundaries; use AI to assist implementation, never as a trust boundary or a replacement for tests and human signing authority.
