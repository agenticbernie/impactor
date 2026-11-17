# Impactor

**Build an Avalanche dApp visually. Test it on Fuji. Publish a static website or take the source with you.**

Impactor is a local-first visual builder for Avalanche dApp interfaces and on-chain workflows. Compose an interface, connect a contract, wire up wallet-approved actions, and preview the result without rebuilding the same Web3 plumbing for every project.

One versioned JSON project powers the editor, interactive runtime, source export, and experimental Irys website publisher.

> **Prototype / testnet software.** Contract writes and deployments are Fuji-only. Irys publishing targets devnet with Fuji test AVAX and temporary storage. Real Core/MetaMask funding, upload signing, and live gateway delivery still require end-to-end acceptance testing. Generated apps and contract templates are not automatically audited or production-ready.

## Features

- **Visual interface editor** — Compose Container, Heading, Text, Input, Button, ConnectWallet, ContractRead, and ContractWrite blocks. Edit properties, organize layers, undo/redo changes, and check desktop/mobile layouts.
- **Visual workflows** — Connect click triggers to sequential contract reads, wallet-approved writes, state updates, and user feedback. Bind inputs, state, and wallet context to supported actions.
- **Contract integration** — Register a deployed Fuji contract using its address and ABI, including ABI artifacts, or deploy the included fixed-supply ERC-20 and owner-mint ERC-721 templates through your wallet.
- **Interactive preview** — Test the shared runtime explicitly. Editing the canvas does not initiate transactions; preview interactions can request wallet approval.
- **Local projects** — Create, rename, duplicate, and autosave projects in your browser. Import validated JSON and download portable backups. No Impactor account is required.
- **Source export** — Download a standalone Next.js project with the actual shared runtime sources, project snapshot, pinned dependency lockfile, setup instructions, and license notices.
- **Experimental Irys hosting** — Package a self-contained static website, review its storage quote, explicitly approve funding and upload, then verify gateway content. Recovery records and cross-tab locks help prevent blind duplicate payments or uploads.

## Quick start

### Requirements

- Node.js **22 LTS** or a supported newer LTS, with npm.
- A modern browser; publishing additionally requires Web Crypto, Web Locks, and HTTPS or localhost.
- An injected EVM wallet, such as Core or MetaMask, for blockchain actions. Use a disposable test wallet and **Fuji test AVAX**, not real-value funds.

A wallet is not required to edit projects, download JSON backups, or export source.

```bash
git clone https://github.com/agenticbernie/impactor.git
cd impactor
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000), then enter [Studio](http://localhost:3000/studio).

The development and production build hooks generate both the portable source bundle and the static runtime/browser SDK assets. No private keys or service credentials are required. The current wallet provider uses injected-wallet discovery; setting a WalletConnect environment variable alone does not enable a relay. See [`.env.example`](.env.example).

### Build and run

```bash
npm run build
npm start
```

The **Studio application** runs as a Next.js server application. The **website produced by Publish** is static; these are different deployment artifacts. Deploy the generated `public/publish-runtime/` assets together with the Studio application.

## Build your first dApp

1. **Start a project.** Choose the token starter or a blank project from the project menu.
2. **Configure a contract.** In **Contracts**, register a Fuji address and ABI or deploy a supported template after reviewing its permissions and approving the wallet request.
3. **Compose the interface.** Add blocks in **Interface** and configure their properties. Add inputs and app-state variables as needed.
4. **Wire the behavior.** In **Workflow**, connect a UI trigger to supported reads, writes, and feedback steps. Configure the contract methods and argument bindings.
5. **Preview deliberately.** Switch to **Preview**, connect your wallet when needed, review the network and transaction, and inspect the outcome. Closing preview does not undo a submitted transaction.
6. **Keep a backup.** Download project JSON before sharing or making substantial changes. Browser-local storage is not a cloud backup.
7. **Export or publish.** Choose editable Next.js source for a developer handoff, or experimental static hosting on Irys devnet.

The token starter is an interface starting point, not a preconfigured token deployment. The NFT template exposes owner-only minting; it is not a public sale or claim contract.

## Export versus publish

| Option | Output | Hosting / dependencies |
| --- | --- | --- |
| **JSON backup** | Validated project configuration | Import back into Studio; not a standalone website |
| **Export code** | Standalone Next.js source ZIP with the shared runtime and dependency lockfile | Install, build, and host it yourself; no hosted Impactor code or account required |
| **Publish** | Static HTML, compiled runtime, CSS, project JSON, and license notices in an Irys manifest/bundle | Irys devnet gateway/CDN; blockchain access still needs an RPC service and a compatible wallet |

### Publish to Irys devnet

Publishing uploads the **frontend**, not the smart contracts. Contracts execute on Avalanche Fuji; Irys stores the browser application that interacts with them.

1. Open **Publish** and review the public-data and testnet warnings.
2. Deliberately connect a wallet on **Avalanche Fuji — chain ID `43113`**.
3. Prepare a snapshot and quote. Preparation does not request a wallet signature, make a payment, or upload the website.
4. Review the exact prepared bundle price, existing Irys storage balance, funding shortfall, and recipient. Wallet gas is separate.
5. If necessary, explicitly approve funding with Fuji test AVAX.
6. Separately approve **Sign & upload** to authorize spending storage credit on the prepared website.
7. Verify the served HTML and named files against the prepared content before treating the link as verified.

**Important limitations:**

- Devnet retention is documented as approximately **60 days**, not permanent hosting or an availability guarantee.
- The publisher is pinned to Irys devnet and Fuji. It does not silently fall back to production or another payment network.
- Authored text, initial state, RPC URLs, contract configuration, and other uploaded project data are public. Never include secrets.
- If funding or upload status is uncertain, retain the original transaction hash and publication IDs. Retry credit checks or verification rather than blindly paying or uploading again.
- Real wallet-funded remote publication remains unverified. Local static-runtime and mocked browser-SDK tests are not proof of a successful live deployment.

See [the publishing guide](docs/publishing.md) for exact endpoints, consent behavior, recovery, bundle limits, and the manual acceptance checklist.

The older `/dapp/[txId]` route is a separate experimental **JSON snapshot loader** that uses a hosted Impactor runtime. New static website publication links go directly to the Irys gateway, not that route.

## Architecture

The shared `ImpactorProjectSchema` contains the network, contracts, initial variables, UI tree, and workflow graph. Imported projects are validated before use; project data is configuration, not arbitrary executable source.

- **Studio** edits and locally persists the schema.
- **RuntimeApp** renders it and executes supported workflows with explicit wallet actions.
- **Source exporter** packages the actual runtime sources with the project snapshot.
- **Static publisher** bundles that same runtime at build time and packages validated project data in the browser. It does not compile Next.js in the browser or require a hosted build backend.

| Layer | Technology |
| --- | --- |
| Application | Next.js 15, React 19, strict TypeScript |
| Styling and UI | Tailwind CSS, Radix UI, Lucide |
| Editor and state | dnd-kit, Zustand, zundo |
| Workflow canvas | React Flow (`@xyflow/react`) |
| Wallets and chain access | Wagmi, Viem, RainbowKit, TanStack Query |
| Export and static packaging | JSZip, esbuild |
| Experimental storage | Irys browser uploader and Viem adapter |
| Tests | Vitest, Testing Library, Playwright |

### Repository layout

```text
contracts/                 Solidity template sources
scripts/                   Contract compilation and runtime bundling
src/app/                   Landing page, Studio, legacy snapshot route
src/components/studio/     Visual editor and publish dialog
src/components/runtime/    Shared application and wallet runtime
src/components/workflow/   Workflow editor
src/lib/schema/            Versioned project model and validation
src/lib/engine/            Bindings and workflow execution
src/lib/web3/              Chain configuration and contract artifacts
src/lib/irys/              Static packaging, upload, recovery, verification
src/lib/exporter/          Standalone Next.js source ZIP generation
src/store/                 Editor state and project operations
tests/                     Browser, static-hosting, and export checks
docs/                      Product, architecture, and publishing notes
```

## Development and testing

```bash
npm run typecheck
npm run lint
npm test

# Install the browser once, then run browser tests.
npx playwright install chromium
npm run test:e2e
```

Playwright starts a development server on port `3100` by default. Set `PLAYWRIGHT_BASE_URL` to test an already running instance, or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an installed Chromium binary.

The default unit suite skips the expensive standalone checks. To exercise them explicitly:

```bash
# Generate the source/static runtime assets first.
npm run build

# Independent static HTTP host and browser SDK preparation.
IMPACTOR_VERIFY_STATIC=1 npx vitest run tests/export/static.test.ts

# Extracted source ZIP: install, typecheck, lint, build, browser runtime.
IMPACTOR_VERIFY_EXPORT=1 npx vitest run tests/export/standalone.test.ts
```

Set `IMPACTOR_CHROMIUM_PATH` when those checks should use a system Chromium binary. The source-export check installs dependencies in a temporary directory and requires network access. Automated publishing checks use mocked endpoints/fake wallets; they do not make real payments or public uploads.

Additional maintenance commands:

```bash
# Refresh the standalone export lock after dependency changes.
node scripts/bundle-runtime.mjs --refresh-lock

# Recompile the included contract artifacts after reviewing source changes.
npm run contracts:build
```

Commit reviewed generated artifacts alongside their source changes. `public/publish-runtime/` is generated and ignored; the build recreates it.

## Safety and current scope

- **Fuji execution only.** Mainnet/custom-network definitions are not a claim of supported writes or deployments.
- **Wallets stay under user control.** No private-key imports, custodial signing, automatic top-ups, or unattended transactions.
- **Local-first is not offline-only.** RPC providers, wallets, and Irys are external dependencies. Published apps still need blockchain connectivity.
- **No production guarantees.** Schema validation and transaction review do not audit contracts, enforce authorization, or replace monitoring, indexing, authentication, or compliance services.
- **Dependency review is required.** The experimental SDK integration includes transitive dependencies with reported audit findings; review the current dependency tree before wider deployment.
- **One-page applications.** Custom domains, stable mutable publication links, multipage routing, team cloud sync, and server-side application logic are outside the current prototype. The runtime `irys_upload` workflow action remains disabled; Studio publishing is a separate capability.

## Documentation

- [Publishing and recovery](docs/publishing.md) — current experimental integration and manual acceptance steps
- [Technical architecture](docs/technical-architecture.md) — architecture baseline and implementation updates
- [Product requirements](docs/prd.md) — product direction and proposed scope
- [Software requirements](docs/srs.md) — requirements baseline
- [UI/UX principles](docs/ui-ux-design-principles.md) — interface and interaction guidance
- [Research](docs/research.md) — discovery hypotheses and background

Some design documents describe proposed or historical behavior. For current publishing behavior and limitations, use the publishing guide and implementation rather than assuming every roadmap item is shipped.

## License

[MIT](LICENSE). Exported and published applications include applicable runtime and dependency notices. You remain responsible for the rights to any third-party assets, brands, and contracts included in your project.
