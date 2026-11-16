# Impactor — Software Requirements Specification

Version: 0.1 — proposed requirements baseline
Date: November 16, 2026
Status: Design specification; requirements are not yet implemented or verified

## 1. Purpose, scope, and precedence

This SRS translates `prd.md` into verifiable behavior for a visual Avalanche dApp interface and transaction-workflow builder. It applies to Studio, local interactive preview, standalone code export, and conditional Irys publication. Read alongside `technical-architecture.md` and `ui-ux-design-principles.md`.

P0 means the Fuji-first MVP. P1 means later Mainnet/custom-L1 execution and other extensions. Conditional publication requirements become mandatory before claiming the publication milestone; they do not authorize an unsupported storage integration. Requirement changes must be reflected in all affected documents.

“Shall” identifies a requirement; proposed numeric limits and performance targets require measurement before release. “Confirmed” means the configured receipt-confirmation policy has been met, not an unconditional guarantee of permanent finality or business correctness.

## 2. Actors and operating environment

| Actor | Responsibilities and authority |
|---|---|
| Builder | Author project schema, configure contracts, test interactions, approve publication and export |
| dApp visitor | Use a generated interface and approve transactions through their own wallet |
| Wallet | Hold signing authority; report account/chain changes; accept or reject requested operations |
| RPC service | Supply chain data, simulations, submission responses, and receipts; responses remain untrusted external input |
| Optional storage service | Quote/fund uploads and return retrievable snapshot identifiers if the compatibility checks pass |
| Developer receiving export | Install dependencies, supply public configuration, run checks, and operate the resulting app |

Proposed P0 environment: current stable desktop Chrome, Edge, Firefox, and Safari for Studio; current stable mobile Chrome and Safari for runtime. Record actual versions at verification. Wallet compatibility must be tested with Core and MetaMask; support is not established merely by listing a connector. No Impactor account is required in P0. Browser storage is local persistence, not a cloud backup.

## 3. Functional requirements

### FR-01 — Project lifecycle and local recovery

- Studio shall create, rename, duplicate, open, and explicitly delete local projects.
- Drafts shall autosave to IndexedDB; the UI shall distinguish dirty, saving, saved, and failed-to-save states.
- A save shall commit a consistent revision. Concurrent tabs shall detect revision conflicts rather than silently overwrite another tab's newer project.
- Storage denial, quota exhaustion, and unavailable browser storage shall leave the in-memory editor usable and offer a JSON backup. The UI shall not claim “saved” after failure.
- Deletion shall require confirmation and identify the project. Duplicate shall create a new project ID without claiming new on-chain deployments.

Acceptance: edit a project, reload after saved status, and recover the same schema. Simulated persistence failure produces a visible warning and an exportable draft. Conflicting tabs do not silently lose either draft.

### FR-02 — Versioned project serialization and import

- A project shall include a schema version, project ID/name, network configuration, contract configurations, initial state variables, UI tree, and workflow graph.
- IDs shall be unique in their defined namespaces; all references shall resolve. UI parentage shall be a tree, with one root and no cycles.
- JSON import shall validate structure, resource limits, supported schema version, block/action types, property values, bindings, contract/network associations, and graph semantics before replacing a draft.
- An invalid import shall leave the existing draft intact and identify actionable errors. Unsupported versions shall be rejected unless an explicit tested migration exists.
- Deterministic export shall preserve array ordering and canonicalize object keys. Volatile runtime state shall not be embedded in authored project data.
- JSON shall exclude secrets, wallet session objects, browser `File` objects, functions, `undefined`, nonfinite numbers, and JavaScript `bigint`. Chain integers shall use validated decimal strings at serialization boundaries.

Acceptance: export → import → export yields equivalent canonical project data. Malformed references, excessive nesting, unsupported types, and future schema versions are rejected without draft loss.

### FR-03 — Visual composition and history

- P0 shall provide Container, Heading, Text, Input, Button, ConnectWallet, ContractRead, and ContractWrite blocks.
- Builders shall add, select, duplicate, reorder, nest in supported containers, and delete blocks using pointer controls and non-drag alternatives.
- Properties and styles shall be edited through typed, constrained inspectors. Raw HTML, JavaScript, arbitrary JSX, and executable CSS shall not be accepted.
- Undo/redo shall operate on authored schema changes, grouping continuous edits into logical operations. Selection, wallet sessions, receipts, and other runtime effects shall not be part of undo history.
- Deleting a referenced block, contract, or variable shall either be prevented with reference details or require explicit removal of dependent references. Dangling references shall block execution/export/publication.

Acceptance: keyboard and click-only controls can build and reorder the reference layout. Undo restores a deletion as schema only and does not reverse a chain transaction.

### FR-04 — Edit mode and interactive preview

- Edit mode shall render selectable blocks without triggering wallet prompts, uploads, deployments, or contract writes. Runtime input shall not mutate authored defaults.
- Interactive preview shall be entered explicitly and use a frozen project revision for each run.
- Switching back to editing shall not imply cancellation of a transaction already broadcast. The run status shall remain inspectable.
- Shared block definitions and execution logic shall power preview and exported/published runtime. Editor selection controls shall not appear in runtime.

Acceptance: clicking an Edit-mode ContractWrite block only selects it. A Preview-mode action requires deliberate visitor interaction and the configured approval sequence.

### FR-05 — Network configuration and wallet lifecycle

- Fuji (`43113`) shall be the default P0 execution target. Mainnet (`43114`) and custom EVM network configurations shall be representable, but unsupported write/deploy targets shall be blocked and labeled.
- Custom configuration shall include chain ID, RPC URL, optional explorer URL, and native currency name/symbol/decimals. Supplied chain ID shall be checked against the RPC response when the configuration is tested.
- Production URL configuration shall permit only supported safe protocols and shall identify URLs as public, browser-visible information. Private provider secrets shall never be requested as public client configuration.
- Editing and offline schema export shall not require a wallet. Wallet connection and network switching shall be user initiated.
- Before each signature request, the runtime shall recheck the selected chain/account against the run intent. Account/chain changes shall invalidate stale simulations and require renewed review.
- A chain switch or account change after broadcast shall not discard the transaction's original network/hash.

Acceptance: a wrong-network write is blocked; rejection of a network switch is recoverable; a receipt is monitored on its original chain even if the wallet changes networks.

### FR-06 — Existing contract registration

- Builders shall register a same-network address and ABI, with an optional human-readable name. Registration shall validate ABI structure, address syntax, and deployed code presence using the selected RPC.
- Contract configuration shall record chain ID and address together. A project-network change shall require explicit contract reassociation, not reinterpret old addresses on a new chain.
- Builders shall select the functions exposed to workflows. Overloaded functions shall be identified by full canonical signature, not name alone.
- P0 interactive forms shall support scalar address, boolean, string, integer, and bytes parameters. Arrays and tuple parameters/outputs shall be marked unsupported in P0 rather than flattened or guessed. Other supported ABI entries may be retained as inert ABI metadata.
- Runtime argument validation shall enforce integer signedness/width, address/bytes encoding, and selected function mutability. Decimal token amounts shall have an explicit decimals-aware conversion configuration; ordinary JavaScript floating point shall not be used for chain quantities.
- Payable native value shall default to zero and require explicit configuration and transaction review if nonzero. Arbitrary raw-calldata actions shall not be offered in P0.

Acceptance: ERC-20 `balanceOf` and `transfer` work with supported inputs. Unsupported tuple inputs and out-of-range integers fail before a wallet request. Overloads remain unambiguous.

### FR-07 — Contract-template deployment

- The template catalog shall supply versioned ERC-20 and ERC-721 artifacts with source, ABI, bytecode, compiler/settings, dependency versions, constructor schema, permissions summary, and integrity metadata.
- The ERC-20 reference template shall have fixed initial supply minted to the specified owner and no implied public mint or claim function. The ERC-721 reference template shall expose documented owner-only minting; it shall not imply public mint or payment behavior.
- Templates shall not be described as audited without evidence for that exact artifact. OpenZeppelin dependency use alone shall not be treated as an audit of the generated contract/application.
- Before wallet approval, the UI shall show chain, signer, constructor arguments, authority/ownership, native value, and available gas estimate. Estimates shall be labeled estimates.
- Deployment shall be recorded as completed only after a successful receipt and valid returned contract address. Template verification shall be a distinct status; no automatic explorer verification shall be claimed without a working verification integration.

Acceptance: both artifacts deploy on a controlled test environment and Fuji; owner permissions and token behavior match their documented scope. Rejection, revert, and unknown receipt never create a false deployed configuration.

### FR-08 — Bindings and authored variables

- P0 binding sources shall be limited to constants, declared `state` variables, wallet context, supported input-block values, and previous step outputs in the current run.
- References shall use a defined expression grammar such as `{{state.recipient}}`; they shall not execute JavaScript, arbitrary function calls, prototype access, or arbitrary property traversal.
- Whole-value bindings shall preserve their declared type. Text interpolation shall escape output as text; interpolation shall not generate HTML or executable code.
- Runtime state shall initialize from authored defaults. A run shall capture its input values; later edits shall not silently change an action already reviewed.
- Missing values and invalid type conversions shall produce validation errors rather than empty-string or zero defaults.

Acceptance: an address input can feed an ERC-20 transfer argument and a read result can update a variable. `__proto__`, executable expressions, nonexistent references, and forward-output references are rejected.

### FR-09 — Workflow authoring and validation

- Supported nodes shall be `ui_trigger`, `contract_read`, `contract_write`, and `ui_feedback`; `irys_upload` shall be exposed only when its publication capability is verified.
- P0 workflows shall be finite sequential chains: a trigger has no inbound edge, each action has exactly one predecessor, and nodes have at most one successor. Cycles, branching, merges, orphan actions, and ambiguous trigger/event mappings shall be rejected.
- Each trigger shall reference a supported block event. Each action shall declare its configuration and output schema.
- Graph validation shall occur on import and before execution/export/publication. Studio shall show invalid nodes and references without silently repairing business logic.

Acceptance: a click → read → write → state update/toast chain executes in order; a cyclic or ambiguous graph cannot run.

### FR-10 — Workflow execution and transaction safety

- Preview/runtime shall allow one active run at a time per application instance. Repeated clicks shall not queue duplicate writes. This is not a guarantee of cross-tab or cross-device deduplication.
- Each run shall have an ID, frozen project revision, originating chain/account, step states, and redacted diagnostic records separate from the authored schema.
- A write shall validate arguments, verify wallet context, simulate where supported, show the transaction review, request wallet submission, and then track the receipt. Simulation success shall not guarantee transaction success.
- Downstream actions shall run only after the predecessor has met its success condition. A reverted, rejected, cancelled, or unresolved transaction shall not trigger success feedback.
- Receipt polling expiry shall produce an unknown/pending state with a hash and a check-status action, not a failed-transaction claim. Known replacements shall be tracked; repricing may continue only for the same intent, while cancellation/different intent shall stop dependent actions.
- Automatic retries shall be limited to safe reads/status checks. No deployment, transaction submission, upload funding, or paid upload shall be automatically resubmitted after uncertainty.
- Cancel shall stop unstarted actions; it cannot undo broadcast transactions or completed uploads. Partial completion shall remain visible.
- After reload, known hashes may be reconciled through read-only receipt checks; interrupted runs shall not automatically resume signatures or downstream paid actions.

Acceptance: double-clicking a submit button generates one in-instance submission request. A write that confirms followed by a failed step is shown as partial completion and is not replayed when retrying status.

### FR-11 — Conditional Irys upload and publication

Before enabling this capability, the implementation shall demonstrate browser SDK/wallet compatibility, supported payment chain and asset, endpoint/network configuration, fees/funding, identifier format, upload completion semantics, retrieval, CORS, payload limits, and current storage guarantees. Record actual SDK versions and tested networks.

- dApp execution chain and storage-payment chain shall be modeled separately. No claim shall be made that Fuji test AVAX funds permanent storage unless demonstrated by the provider's supported flow.
- Publication shall validate and freeze a schema snapshot, show a public-data disclosure, identify public network/contract configuration, and show fee/funding information before any paid action.
- Unresolved local files and private/sensitive values shall block publication. Only validated explicit asset references shall be included; raw browser file handles shall not enter JSON.
- Funding and uploading shall be separate observable steps if the provider requires them. An interrupted upload shall not automatically fund/upload again.
- A snapshot shall be marked published only after successful provider completion and retrieved schema validation. Uploaded bytes or funding may remain even if later verification fails; the UI shall report this honestly.
- Each published revision shall obtain its own immutable identifier. P0 shall not promise mutable slugs, custom-domain hosting, deletion of immutable content, or permanent availability without provider evidence.

Acceptance: a supported wallet uploads a non-sensitive snapshot using a verified payment configuration, and a fresh browser retrieves the same canonical schema. Failed retrieval does not present a working publication link as verified.

### FR-12 — Published runtime

- The canonical planned route shall be `/dapp/[txId]`; `/preview/[irysTxId]` and `/live/[slug]` are not additional P0 routes.
- Retrieval shall use a configured trusted gateway and a validated identifier, not an arbitrary fetch URL supplied through the route.
- Retrieved schema shall pass the same version, size, type, reference, and graph validation as imports. Unknown block/action types shall fail closed.
- Loading, unavailable content, unsupported schema, invalid content, and unsupported execution-network states shall be distinct.
- Opening a link shall never automatically connect a wallet or request a signature. Visitor runtime state shall be independent of the author's Studio draft.

Acceptance: malicious/oversized snapshots cannot inject executable markup or cause a signature on page load. Gateway errors have a useful retry path without paid re-upload.

### FR-13 — Standalone source export

- Export shall validate the project and package a Next.js/React/TypeScript application, the schema, matching portable runtime source, public configuration placeholders, dependency manifest/lockfile, setup instructions, and applicable license notices.
- Generated paths shall be fixed or sanitized; project names and schema strings shall be treated as data rather than source fragments. There shall be no path traversal or executable-code interpolation.
- No wallet secrets, session data, private provider credentials, browser-local drafts, or run journals shall be bundled.
- The ZIP shall build independently after documented public configuration and dependency installation. It shall not require the hosted Impactor runtime or a paid Impactor account.
- Export shall disclose unresolved external dependencies and unsupported capabilities. Invalid graph, unresolved local asset, and unsupported interactive ABI type shall block export with actionable errors.

Acceptance: a clean-directory fixture install, typecheck, lint, production build, and browser run succeeds; reference-flow behavior matches preview. Export without wallet connection succeeds for a valid project.

### FR-14 — Diagnostics and contextual help

- Errors shall identify the affected block/step and safe recovery options without exposing raw stack traces, secrets, or sensitive payloads by default.
- Addresses and hashes shall be copyable; explorer links shall be available only when a safe configured explorer exists for that network.
- Diagnostic export shall be explicit and redact input contents, RPC query credentials, and wallet-derived personal information by default.
- “Saved,” “exported,” “uploaded,” “published,” and “transaction confirmed” shall be different statuses.

Acceptance: a rejected signature says it was declined and permits a new deliberate attempt; a receipt timeout says the result is not yet known.

## 4. Data and external-interface requirements

| Boundary | Required validation and invariants |
|---|---|
| Project JSON | Version, types, unique IDs, tree/graph structure, references, limits; decimal strings for large integers |
| Block registry | Discriminated properties per block; allowed layout/style values; safe URL protocols; no HTML/event-handler injection |
| ABI/address | Supported JSON ABI shape, canonical signature, compatible argument types, address and chain association |
| Wallet | Account/chain recheck before signature; no custody; reject stale review requests |
| RPC | Network identity, response shape/error handling, timeouts; never infer a confirmed receipt from a submission hash |
| Storage | Separate payment chain, fee quote, explicit approval, bounded upload/retrieval, verified schema |
| Browser persistence | Revision-aware writes; drafts and run journals stored separately; no guarantee against cleared browser data |
| ZIP generation | Safe names/paths, fixed templates, non-executable serialized data, no secrets |

Browser-visible RPC endpoints and schema snapshots are public configuration, not secret storage. The system shall not implement server-side arbitrary URL fetching for custom RPC configurations in P0. If that changes, server-side network-request protections require a separate design review.

## 5. Nonfunctional requirements

| ID | Requirement / proposed target | Verification |
|---|---|---|
| NFR-01 | TypeScript strict mode; schema/ABI boundaries use validated types, not `any` | Typecheck, lint, invalid-input tests |
| NFR-02 | Authored schema and deterministic graph validation independent of wallet/UI/provider | Unit tests without wallet/network |
| NFR-03 | Same supported feature semantics in preview, export, and conditional publication | Shared fixture browser tests |
| NFR-04 | WCAG 2.2 AA target for applicable Studio/runtime functionality; accessible authoring defaults | Automated scans plus keyboard, screen-reader, contrast, non-drag manual tests |
| NFR-05 | On a recorded reference laptop, 500-block project selection/property updates: p95 ≤100 ms; local save normally completes ≤1 second after debounce | Measured benchmark excluding RPC/wallet time; record hardware/browser |
| NFR-06 | Proposed limits: 1 MiB schema JSON, 500 UI nodes, nesting depth 20, 200 workflow nodes, 50 action steps per run | Boundary tests including limit+1; future limits require explicit change |
| NFR-07 | Initial paid-asset support, if enabled: ≤10 MiB per file and ≤20 MiB total selected upload; quotes include actual bytes | Adapter limits and UI tests; provider may impose stricter bounds |
| NFR-08 | No arbitrary code evaluation, dangerous markup, prototype traversal, embedded secrets, or unsigned privileged server operations | Security review and malicious fixture suite |
| NFR-09 | Initial read timeout budget 15 seconds and receipt monitoring window 180 seconds, both explicit configuration; expiry is not proof of chain failure | RPC failure tests and documented configuration |
| NFR-10 | Patched supported dependencies and reproducible generated lockfile; no floating `latest` dependency declarations in exports | Clean install/build and dependency advisory check before release |
| NFR-11 | P0 core editor/export usable without an analytics service or product account; network unavailable blocks only dependent features | Offline/degraded-network tests |
| NFR-12 | No telemetry by default in MVP; pilot research consent and diagnostic exports explicit | Browser network inspection and UX review |

Limits are design guardrails, not measured capacity claims. Asset capabilities may remain disabled until storage validation passes. Accessibility of arbitrary builder-authored content is not automatically guaranteed by accessible defaults.

## 6. Verification and requirement traceability

| Verification scenario | Requirements covered | Required evidence |
|---|---|---|
| Import/export round trip and malformed payload matrix | FR-01–03, FR-08–09, NFR-01–02/06/08 | Unit/property tests; no draft loss |
| No-wallet build and Edit-mode safety | FR-03–05, FR-13, NFR-11 | Browser test; no signature/upload requests |
| Token dashboard on Fuji | FR-05–06, FR-08–10 | Chain/address/ABI fixture, wallet test, actual receipt and refreshed read |
| Fixed-supply ERC-20 + owner-mint ERC-721 deployment | FR-07, FR-10 | Artifact manifest, source tests, deployment and permission tests |
| Rejection / wrong network / account change / revert | FR-05, FR-10, FR-14 | Controlled wallet/RPC scenario results |
| Receipt timeout / replacement / partial completion / reload | FR-10, FR-14, NFR-09 | No duplicate submission; original hash/network retained |
| Clean standalone ZIP | FR-04, FR-13, NFR-03/10 | Install, typecheck, lint, build and browser tests in fresh directory |
| Accessibility and responsive behavior | FR-03, FR-14, NFR-04 | Keyboard/click-only workflow and screen-reader notes |
| Malicious schema / unsafe URLs / export path payloads | FR-02, FR-08, FR-12–13, NFR-08 | Fail-closed tests and security review |
| Optional Irys publication and fresh-browser retrieval | FR-11–12, NFR-03/07 | Documented payment configuration, upload/retrieval and error scenarios |

Use a controlled local EVM and wallet/RPC test doubles for repeatable failure scenarios; use Fuji for interoperability smoke tests. Test doubles do not replace actual Fuji wallet checks or source/artifact security tests. Do not run paid uploads or real-value Mainnet transactions automatically.

## 7. Release criteria and unresolved items

P0 core requires all unconditional P0 requirements passing, clean typecheck/lint/build, reference-flow browser evidence, no unresolved critical/high security defects in reviewed scope, and an honest disabled-state for unsupported publication/networks. A publication release additionally requires FR-11/12 and its parity tests. P1 Mainnet/custom-L1 execution requires a separate readiness decision, tested wallet/RPC behavior, and explicit network/value safeguards.

Open items: exact artifact compiler/dependency versions; supported storage funding configuration; tested public RPC/providers and wallet connectors; final patched framework versions; benchmark device; commercial packaging. None of these may be represented as already solved by this specification.
