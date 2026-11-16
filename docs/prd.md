# Impactor — Product Requirements Document

Version: 0.1 — proposed product baseline
Date: November 16, 2026
Status: Design proposal; no implementation or production-readiness claim

## 1. Purpose and document relationships

Impactor helps Avalanche builders turn a contract and an application idea into a branded, testable dApp interface with visual workflows and maintainable source export.

This PRD defines the customer problem, product scope, and outcomes. `srs.md` defines verifiable requirements; `technical-architecture.md` describes their proposed implementation using an AI-Centered Development lens; `ui-ux-design-principles.md` defines interaction and presentation rules. `../CLAUDE.md` remains the project brief. `research.md` supplies directional discovery hypotheses, not validated purchase intent.

All numerical targets below are proposed targets to measure, not existing results. Conflicts or scope changes should be resolved explicitly across these documents before implementation.

## 2. Problem and value proposition

### Problem hypothesis

A builder can have a deployed contract yet still lack a usable application. The remaining work includes wallet and network configuration, forms, ABI argument handling, transaction states, contract reads, hosting, and client handoff. Repeating this integration work across similar apps is Impactor's initial opportunity.

The existing research is desk research, not interviews with Avalanche customers. Its survey figures and market claims must not be treated as product validation without checking the original sources. This PRD does not rely on those figures for sizing the market.

### Product promise

> Compose an Avalanche dApp interface and transaction workflow visually, test it on Fuji, and export the Next.js project you can maintain yourself.

The product is a visual application builder, not only a token deployer. Its proposed differentiators are reusable UI/workflow composition, explicit Avalanche network context, equivalent preview/export behavior, and a practical exit path through code export.

### What “usable” means for the MVP

A user can configure a supported application, connect a wallet, execute the intended Fuji transaction, see its actual outcome, and download a project that builds and reproduces that behavior. This is not a certification of contract security, legal compliance, production suitability, or infrastructure availability.

## 3. Users, buyers, and jobs to be done

| Segment | Job to be done | Likely buyer | Evidence status |
|---|---|---|---|
| Primary: Web3 agencies/product studios | Deliver repeatable, branded client dApps without rebuilding wallet and transaction plumbing | Agency owner or engineering lead | Customer and willingness-to-pay hypothesis |
| Secondary: funded Avalanche product teams | Validate an application flow quickly while retaining an editable codebase | Founder or product/engineering lead | Customer and willingness-to-pay hypothesis |
| Adjacent: gaming, loyalty, consumer teams | Build asset/reward interaction surfaces | Product team | Requires use-case interviews |
| Adoption: independent builders and hackathon participants | Learn, prototype, and share a working flow | Individual builder | Paid conversion unvalidated |

An end user of a generated dApp is not necessarily an Impactor customer. They should not need a Studio account or knowledge of the editor to use a published/exported application.

### Core jobs

- When I have a contract address and ABI, help me create a usable interface without hand-wiring every interaction.
- When I need a standard test contract, help me deploy a clearly described template through my own wallet.
- When a wallet action fails, show what happened and what I can safely do next.
- When I hand a project to a client or developer, give them source that works without an Impactor subscription.
- When I close the browser, help me recover my work and provide a portable backup.

## 4. Product principles

1. **One portable project model:** Studio, runtime, and exporter consume the same versioned project schema.
2. **Wallet control stays with the user:** Impactor does not request private keys, custody funds, or authorize hidden actions.
3. **Fuji before value-bearing deployment:** Default to testnet; clearly separate tests from real-money operations.
4. **Honest capabilities:** Disabled or unsupported features are labeled; no mocked publish, transaction, or audit success.
5. **Useful without vendor lock-in:** Local project backups and source export are core, not substitutes for each other.
6. **Small, complete vertical slices:** Prefer one working transaction flow over many disconnected block types.

## 5. Proposed release scope

P0 is the Fuji-first MVP baseline. P1 is the next release after the core has been validated. This staging preserves the brief's Mainnet/custom-L1 direction without claiming those networks are fully supported in the first demonstration.

| Area | P0: Fuji-first MVP | P1: next release / additional validation |
|---|---|---|
| Projects | Create, rename, duplicate, local autosave, JSON import/export | Cross-device account/project sync |
| UI editor | Container, Heading, Text, Input, Button, ConnectWallet, ContractRead, ContractWrite; selection, properties, reorder, undo/redo | Rich asset library, multipage routing, arbitrary custom blocks |
| Layout | One-page responsive flow layout; desktop/mobile preview | Advanced breakpoint-specific layout controls |
| Contracts | Import a same-network address + validated ABI; deploy versioned ERC-20 and ERC-721 templates through wallet | Custom Solidity compilation; advanced permissions or upgradeable templates |
| Workflows | Explicit click trigger → sequential read/write/feedback actions; safe reference bindings | Conditions, loops, parallel actions, server jobs, event-triggered automation |
| Networks | Fuji execution and visible chain identity; explicit runtime verification | Mainnet execution and tested custom Avalanche EVM L1 setup |
| Preview | Edit mode has no chain side effects; interactive local preview is explicit | Additional runtime capabilities after review |
| Export | Standalone Next.js ZIP including schema, application source, runtime, setup instructions, and dependency manifest | Round-trip import of modified source |
| Publishing | Irys-backed immutable snapshot/runtime route only if the validation checklist passes | Mutable slugs, custom domains, managed deployment/update services |
| Team/commercial features | No required account or billing integration | Workspaces, billing, collaboration and entitlement service |

**Publishing release rule:** `irys_upload` and `/dapp/[txId]` are conditional capabilities, not simulated P0 successes. If Irys support cannot be demonstrated, a clearly labeled local-preview/export MVP may ship, but it must not be called the complete publishing milestone. Do not silently substitute another provider or claim the full roadmap is finished.

**Network release rule:** Mainnet and custom L1 definitions can exist in the schema before P1, but wallet writes to an unsupported execution target must be blocked. Merely accepting a chain ID is not support certification or proof that a chain belongs to Avalanche.

## 6. Initial application templates

### Primary reference application: token dashboard

- Connect a wallet on Fuji.
- Read a configured ERC-20 balance.
- Enter recipient and amount.
- Review and submit a transfer using that wallet.
- Display pending/confirmed/reverted/rejected states and refresh the balance after confirmation.

The builder can use an imported ABI/address or deploy the included fixed-supply ERC-20 template first. A token transfer spends tokens controlled by the connected wallet; it is not a token claim or airdrop service.

### Secondary reference application: owner mint interface

Deploy or import a supported ERC-721 contract, enter recipient/token metadata, and invoke its documented owner-only mint method. The interface must show that only the authorized owner can mint. It must not market this template as a public mint, allowlist, claim, or payment contract.

Loyalty, token-gated access, claims, and other verticals remain future template candidates until the required contract behavior is defined and validated. Hiding UI is not secure access control.

## 7. End-to-end user journeys

### J1 — Build with an existing contract

Create project → select Fuji → add contract address and ABI → verify address has code on the selected chain → select allowed methods → build UI → bind inputs → connect workflow → preview → review and sign → confirm → export source.

Acceptance: an existing-contract builder completes the token-dashboard flow without editing application code; a rejected signature does not show success or execute downstream feedback.

### J2 — Deploy and use a template

Choose template → review source/version/permissions → enter constructor fields → validate values → show chain, account and estimated cost → request wallet approval → track deployment receipt → record deployed address → connect UI to that contract.

Acceptance: no address is marked deployed until a successful receipt and a contract address are obtained. Changing the project network never reuses that address as though it were a deployment on another chain.

### J3 — Publish a supported snapshot

Validate project → review public-data disclosure → resolve/upload selected assets if supported → show quote and funding requirements → obtain explicit consent → upload snapshot → retrieve and validate the uploaded snapshot → open `/dapp/[txId]` → connect wallet only when the visitor chooses to interact.

Acceptance: the link is shown as published only after successful retrieval and validation. Updating the project creates a new snapshot; the old URL does not silently change.

### J4 — Export and hand off

Validate project → download ZIP → extract in a new directory → install locked dependencies → configure public wallet/RPC settings → typecheck, lint, build → run app → reproduce reference transaction flow.

Acceptance: the exported app does not fetch execution code from the hosted Impactor service or require an Impactor account. External RPC, wallet and optional storage services remain declared dependencies.

## 8. Success metrics and validation plan

| Measure | Proposed initial target | Measurement |
|---|---|---|
| Time to first Fuji flow | Median ≤30 minutes for a builder with an ABI/address, supported wallet, and test AVAX | Moderated sessions; measure funding/setup separately |
| Task completion | At least 4 of 5 representative pilot participants finish J1 without developer intervention | Usability test; record assistance |
| Export reproducibility | Every shipped reference fixture installs, typechecks, lints and builds | Automated clean-directory checks |
| Runtime parity | Every P0 reference fixture passes the same functional expectations in preview and exported runtime; published runtime when enabled | Shared fixtures and browser tests |
| Transaction truthfulness | No success state on signature rejection, timeout, cancelled/replaced intent, or reverted transaction in the test matrix | Automated wallet/RPC scenarios |
| Repeat use | At least 3 of the first 5 pilot teams attempt a second project within 30 days | Consent-based interviews or pilot records |
| Commercial validation | At least 3 qualified teams agree to a paid pilot with an explicit buyer and agreed scope | Actual agreement; not survey enthusiasm |

Targets are discovery hypotheses, not launch marketing claims. Do not treat one small pilot cohort as market-size evidence. No analytics backend is required for P0; conduct consent-based pilot observation and collect minimal data.

## 9. Commercial model hypothesis

Test a team/agency subscription around repeated project delivery, reusable templates, and handoff support. A free local-building tier may support adoption. Exact pricing, feature limits, charging mechanism, and enterprise plans are deliberately undecided.

Client-side ZIP generation is not an enforceable paid entitlement by itself. Charging for protected services would require a separately designed authenticated billing/entitlement service. Do not add a weak browser-only paywall or require accounts simply to satisfy this hypothesis.

## 10. Non-goals

- AI prompt-to-app generation or an LLM-dependent runtime.
- A monolithic application backend, general SQL database builder, or arbitrary server-code execution.
- Cross-chain bridging, non-EVM Avalanche chains, launching Avalanche L1 infrastructure, or automatic bridge configuration.
- Guaranteed audits, legal/compliance certification, production SLAs, or automatic contract verification claims.
- Custodial wallets, private-key imports, silent signatures, gas sponsorship, or unattended transaction automation.
- Real-time collaboration, custom domains, mutable `/live/[slug]` hosting, subscriptions, or round-trip source editing in P0.

## 11. Milestones and exit conditions

1. **Studio + schema:** validated import/export, editing, undo/redo, local recovery, responsive renderer; no chain side effects in Edit mode.
2. **Fuji + contracts:** imported contracts, tested deployment artifacts, wallet interaction and actual receipt tracking; both reference contracts documented.
3. **Workflow runtime:** safe bindings and sequential execution; user rejection, account/chain changes, RPC errors and partial success handled.
4. **Export + conditional publication:** clean exported build and parity pass; Irys publication added only after its independent compatibility/privacy/retrieval checks pass.

Each milestone must produce a usable vertical slice. Dates and staffing estimates should be added after implementation discovery, not invented here.

## 12. Risks and unresolved decisions

| Risk/decision | Proposed handling | Decision needed before |
|---|---|---|
| Customers do not pay for visual integration | Interview buyers and run narrowly scoped paid pilots | Billing implementation |
| Irys AVAX/browser/Fuji support is unverified | Prove funded upload and retrieval on documented supported networks; separate storage payment chain from dApp execution chain | Advertising publication |
| Precompiled template mismatch or harmful permissions | Pin source/compiler/dependencies, test artifacts, display authority, never call “audited” without evidence | Wallet deployment |
| Preview/export drift | Shared portable runtime and fixtures; exporter packages source rather than inventing a second engine | Export release |
| Browser-local data loss | Autosave status, portable backups and explicit storage-failure handling | Pilot use |
| Mainnet users mistake a prototype for vetted software | Explicit capability labels and separate readiness review | P1 Mainnet execution |
| Framework/package lifecycle | Verify patched, supported dependency versions before scaffold; see architecture external references | Implementation |

TL;DR: Build a complete Fuji-tested interface-to-transaction-to-export path for agencies and product teams; validate customer demand and storage compatibility before expanding the promise.
