# Impactor — Visual Avalanche dApp Builder and Code Exporter

## 1. Project Overview
**Impactor** is a visual no-code/low-code builder for Avalanche dApp interfaces and on-chain workflows, targeting Web3 agencies/product studios and funded Avalanche product teams that repeatedly ship branded, transaction-based applications. The initial focus is composing reusable UI and contract workflows, testing on Fuji, publishing schema-driven previews, and exporting maintainable Next.js code.
Potential adjacent use cases include gaming, loyalty, and consumer apps; treat these as hypotheses until validated with customers. Do not describe generated apps as automatically audited, secure, or production-ready, or as complete substitutes for indexing, authentication/permissions, monitoring, compliance, or other production services.

## 2. Core Tech Stack
- **Framework:** Next.js 15 (App Router), React 19, TypeScript (strict mode)
- **Styling & UI:** Tailwind CSS, Shadcn/UI, Lucide React
- **State Management:** Zustand (with `zundo` for undo/redo history in Studio)
- **UI Drag & Drop Builder:** `@dnd-kit/core` + custom recursive JSON tree renderer (avoid heavy legacy editors; keep JSON schema clean and exportable)
- **Visual Workflow Builder:** `@xyflow/react` (React Flow)
- **Web3 & Avalanche Integration:** `wagmi` (v2), `viem`, `@tanstack/react-query`, `@rainbow-me/rainbowkit` (prioritizing Core Wallet & MetaMask)
- **Decentralized Storage (planned):** Evaluate `@irys/web-upload` and `@irys/web-upload-ethereum`; verify current SDK support, Avalanche/AVAX funding, cost, retrieval guarantees, and browser-wallet compatibility before committing to the integration.
- **Code Export:** `jszip` (client-side Next.js + Viem project zip generator)

## 3. Architectural Principles (CRITICAL)
1. **Single Source of Truth (`ImpactorProjectSchema`):**
   - Everything built in the Studio (UI layout tree, global state variables, React Flow workflow graph, deployed contract configs, and network settings) MUST serialize into a single deterministic JSON object (`ImpactorProjectSchema`).
   - Both the **Live dApp Runtime Renderer** (`/preview/[irysTxId]` or `/live/[slug]`) and the **Code Exporter** consume this exact same JSON schema.
2. **Client-First & Decentralized Infra (Zero Heavy Backend):**
   - Keep the MVP client-first; do not build a monolithic Node/Python backend or SQL database without validated need. Treat this as an MVP scope constraint, not a claim that production dApps never need backend, indexing, authentication/permissions, monitoring, or compliance services.
   - Smart contract deployment happens directly from the user's connected wallet via Viem `deployContract()` using pre-compiled ABI + Bytecode templates.
   - If current SDK validation confirms support, upload project snapshots/assets to Irys with user-approved AVAX payment and record the returned `irysTxId`. Do not promise permanence or availability without verifying current retrieval guarantees, pricing, and network support.
3. **Avalanche-Native Experience:**
   - Default networks: Avalanche Mainnet (`43114`) and Avalanche Fuji Testnet (`43113`).
   - Support custom Avalanche L1 configuration (custom `chainId`, `rpcUrl`, `explorerUrl`, native currency symbol).

## 4. Directory Structure
```text
docs/
└── research.md                  # User pain points, dApp workflow, customer segments
src/
├── app/
│   ├── page.tsx                  # Landing page
│   ├── studio/page.tsx           # Main 3-pane Visual Studio (UI + Workflow + Contracts)
│   └── dapp/[txId]/page.tsx      # Dynamic runtime renderer fetching schema from Irys
├── components/
│   ├── studio/                   # Studio shell: Topbar, ComponentPalette, Canvas, Inspector
│   ├── workflow/                 # React Flow custom nodes (Trigger, IrysUpload, ContractCall, Toast)
│   ├── blocks/                   # Renderable UI & Web3 blocks (Container, Text, Button, ConnectWallet, ContractRead, ContractWrite)
│   └── providers/                # Wagmi, RainbowKit, QueryClient providers
├── lib/
│   ├── schema/                   # ImpactorProjectSchema TypeScript interfaces & default templates
│   ├── engine/                   # Workflow execution engine & dynamic variable resolver ({{state.x}}, {{wallet.address}})
│   ├── web3/                     # Avalanche chains config, pre-compiled contract templates (ERC20, ERC721)
│   ├── irys/                     # Irys WebUploader initialization with Wagmi/Viem & AVAX funding helpers
│   └── exporter/                 # JSZip generator converting ImpactorProjectSchema to standalone Next.js code
└── store/
    └── useStudioStore.ts         # Zustand store managing schema, selected node, active tab (UI vs Workflow)
```

## 5. Core Data Schema (`src/lib/schema/types.ts`)
Maintain strict typing for the project schema:
- `ImpactorProjectSchema`: `{ id, name, network: AvalancheNetworkConfig, contracts: ContractConfig[], variables: StateVariable[], uiTree: UIBlockNode, workflows: WorkflowGraph }`
- `JsonValue`: `string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }`
- `UIBlockNode`: `{ id, type, props: Record<string, JsonValue>, styles: Record<string, string>, bindings?: Record<string, string>, children?: UIBlockNode[] }`
- `WorkflowGraph`: `{ nodes: WorkflowNode[], edges: WorkflowEdge[] }`
- `WorkflowNode` types:
  - `ui_trigger` (e.g., `onClick` of a specific `UIBlockNode.id`)
  - `irys_upload` (uploads file/JSON to Irys using AVAX, outputs `irysUrl`)
  - `contract_write` (calls write method on a configured contract via Viem/Wagmi, outputs `txHash`)
  - `contract_read` (reads on-chain state and saves to `variables`)
  - `ui_feedback` (triggers toast notification or updates a state variable)

## 6. Coding Conventions & Quality Rules
- Always use TypeScript strict types; never use `any` for schema definitions or Web3 ABI interactions.
- Treat project data as versioned, JSON-serializable schema; validate imported projects before rendering or exporting them.
- Use Viem's `parseEther`, `formatEther`, and typed contract calls (`writeContract`, `readContract`, `deployContract`).
- Keep UI components modular: every block in `src/components/blocks/` must work both in **Edit Mode** (inside Studio canvas with selection bounding box) and **Runtime Mode** (interactive live dApp).
- Always run `npm run typecheck` (or `npx tsc --noEmit`) and `npm run lint` after implementing major features to verify zero type or build errors.

## 7. MVP Implementation Roadmap (Build in Vertical Slices)
1. **Slice 1 (Studio Shell & JSON Canvas):** Setup Next.js + Tailwind + Shadcn + Zustand. Build the 3-pane Studio layout and recursive UI block renderer with basic blocks (`Container`, `Heading`, `Text`, `Input`, `Button`).
2. **Slice 2 (Avalanche Web3 Runtime & Contract Deployer):** Configure Wagmi/RainbowKit for Avalanche Mainnet & Fuji. Add a `ConnectWallet` block and a Contract Modal for wallet-confirmed deployment of pre-compiled ERC-20 / ERC-721 contracts onto Fuji Testnet.
3. **Slice 3 (Visual Workflow Engine):** Integrate `@xyflow/react` in the Workflow tab. Build the runtime workflow executor that listens to UI events (`onClick`), executes `contract_write` or `irys_upload`, and updates UI state/toasts.
4. **Slice 4 (Irys Publish & Code Export):** Validate current Irys WebUploader support for Avalanche/AVAX payments and reliable retrieval. If verified, implement schema publishing and render the returned transaction at `/dapp/[txId]`. Add the `JSZip` code export button.
