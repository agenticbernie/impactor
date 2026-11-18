# Impactor — UI/UX Design Principles

Version: 0.1 — proposed interaction and visual-design baseline
Date: November 16, 2026
Status: Design guidance; not a completed interface or accessibility certification

## 1. Design objective

Make it clear what the builder is authoring, what the visitor will experience, what is saved or published, and exactly which external action a wallet is being asked to approve.

Impactor should feel like a focused visual product tool, not a trading terminal or a contract-security endorsement. Its primary builder is an agency/product-team member who understands the intended contract interaction but wants to avoid repetitive frontend integration. Generated-app visitors should not need to understand Studio.

Related documents: `prd.md` defines users and scope; `srs.md` defines acceptance requirements; `technical-architecture.md` defines state and service boundaries. This document specifies interaction principles, a proposed visual language, critical flows, failure states and design-review criteria—not production UI code.

## 2. Core principles

### 2.1 Make the next action obvious

Use a guided sequence: **Build → Connect contract → Wire workflow → Test on Fuji → Export / Publish**. Do not demand wallet connection just to create a project. Favor a starter token-dashboard project over an empty canvas with no explanation.

Each empty panel should explain its purpose and offer one relevant action. A contract panel should say “Add contract” rather than presenting an ABI editor without context.

### 2.2 Separate editing from execution

Edit mode is visibly labeled and inert: clicking a Button or ContractWrite block selects it; it never signs or submits. Interactive Preview has a distinct mode label, visible network, and a clear exit. Show “Transactions in Preview use your connected wallet” before the first wallet interaction.

Canvas viewport size is not execution mode. Changing from desktop to mobile preview must not enable interaction or change networks.

### 2.3 Preserve wallet authority

Before asking the wallet to act, explain the action in the user's terms and expose its exact technical details. Keep the signer, chain, contract, function, native value, argument values and authority implications inspectable.

“Continue to wallet” is a better label than “Done” or “Instant deploy.” The wallet may reject the operation, and a signed submission may still fail. Never suggest that a simulation is a guarantee.

### 2.4 Tell the truth about state

“Draft saved,” “Source exported,” “Upload complete,” “Published link verified,” “Transaction submitted,” and “Transaction confirmed” are different outcomes. Use these exact distinctions in UI and logs.

A timeout is “Status not yet known,” not “Transaction failed.” A confirmed transaction is not necessarily evidence that every application-level business objective was achieved.

### 2.5 Prefer prevention to late recovery

Mark unsupported ABI types, missing bindings, wrong chains, and invalid graphs in the editor before a wallet action opens. Disable the unsafe action with an accessible reason and a direct path to fix the issue. The Studio entry gate requires an explicit wallet connection, but must not request a signature, payment, or upload merely to enter or reconnect.

### 2.6 Make recovery non-destructive

Keep a failed import from replacing the current draft. Keep a failed upload from erasing the local project. Offer JSON backup when autosave fails. Show partial workflow completion rather than implying all earlier actions were rolled back.

Undo/redo affects authored content only. It cannot undo transactions, deployments, or immutable uploads; the history UI must not suggest otherwise.

### 2.7 Support professional handoff

Keep contract addresses, function signatures, configuration, source scope, and export instructions inspectable. Prefer concise labels with optional technical detail to hiding all complexity behind “magic” actions. Clean source export is a core path, not a buried account upsell.

## 3. Information architecture and screen structure

### 3.1 Application areas

| Area | Primary task | Required content |
|---|---|---|
| Landing | Understand the product and start | Honest product promise, Fuji-first scope, build entry point; no unsupported audit/permanence claims |
| Project entry | Create/open a local project | Starter template, existing local projects, JSON import, local-storage explanation |
| Studio | Author UI, workflows and contracts | Persistent project context, editing surfaces, inspector, validation and save status |
| Interactive Preview | Test visitor-facing behavior | Distinct mode, wallet/network state, real transaction feedback |
| Export dialog | Obtain source | Validation, included features/dependencies, public configuration needs, download |
| Conditional Publish dialog | Publish a public snapshot | Public-data disclosure, verified payment configuration/quote, progress, retrieval result |
| `/dapp/[txId]` | Run a published project | Validated visitor interface; safe loading/failure states; no authoring controls |

The project entry can be an overlay or Studio start state in P0; it does not require an account dashboard, additional backend, or new public route.

### 3.2 Studio anatomy

**Top bar:** project name, save status, Undo/Redo, active network, Edit/Preview switch, Export and conditional Publish. Keep paid/external effects separate from ordinary editing controls.

**Main navigation:** UI, Workflow, Contracts. Switching tabs changes the authoring surface, not the project network or active wallet. Preserve selection where meaningful.

**UI workspace:** three panes—left Palette/Layers, central Canvas, right Inspector. The left pane toggles between inserting blocks and inspecting hierarchy. Inspector fields change with selection; the canvas does not need a separate editor implementation for each block.

**Workflow workspace:** action palette, graph surface, selected-node inspector, and a validation/run-detail panel. Provide a semantic step-list view and an “Add next action” control alongside the graph so neither dragging nor spatial graph navigation is mandatory.

**Contracts workspace:** configured contract list, import/deploy entry points, method exposure settings, chain/address/source status, and permissions summary. Distinguish imported contracts from exact built-in template artifacts.

A collapsed validation panel may show an error count and “Review issues,” but errors must link directly to their block/node/field. Do not create analytics or business-performance panels that the MVP has no data to populate.

## 4. Visual system

### 4.1 Direction

Use a calm, neutral workspace with restrained red brand accents and semantic status colors. Visual emphasis should identify the user's selected object and next safe action, not constantly imply urgency. Avalanche affiliation must not imply endorsement, official-wallet status, or security approval.

### 4.2 Tokens and spacing

Define semantic tokens rather than hardcoded component colors:

- Surfaces: page, panel, canvas, inset, elevated overlay.
- Content: primary text, secondary text, muted text, inverse text.
- Boundaries: default border, strong border, selection ring, keyboard focus ring.
- Actions: primary, secondary, destructive, disabled.
- Status: informational, pending, success, warning, error, unknown.

Use a consistent 4 px spacing base with 8/12/16/24/32 px composition steps. Proposed radii: 6–8 px for controls/cards and 12 px for larger dialogs. Keep border/shadow treatment subtle and consistent. Support light and dark themes with separately tested semantic-token values; never assume inverted colors remain accessible.

Suggested initial dimensions: 56 px top bar, 240–280 px palette, 288–336 px inspector, resizable/collapsible side panes. These are design starting points, not requirements that override zoom or smaller-screen usability.

### 4.3 Typography and hierarchy

Use a readable sans-serif interface face and monospace only for addresses, hashes, signatures, code and ABI details. Use 14–16 px body/control text; avoid shrinking critical chain/cost messages to fit a dense editor. Keep headings compact and hierarchy clear.

Truncated hashes/addresses must have an accessible full-value alternative and copy action. Transaction review must expose the full recipient/contract value; do not rely only on visually similar shortened addresses.

### 4.4 Meaning cannot depend on color

Pair every status color with a label and where useful an icon. Use distinct selection and keyboard-focus treatments: a selected block is not necessarily the focused control. Workflow nodes need explicit type and connection labels; line color alone cannot encode success or execution order.

Test actual foreground/background pairs rather than declaring an unverified palette compliant. Do not use green styling or shield icons to imply an imported contract has been audited.

## 5. Interaction patterns

### 5.1 Inserting, selecting, and reordering blocks

- Provide click-to-add and an “Insert into selected container” control; dragging is an accelerator.
- Show insertion targets and reject invalid nesting before drop.
- Use selection outlines without shifting authored layout; provide a clear Layers tree for nested content.
- Expose Move up/down, Move to container, Duplicate and Delete actions through visible/context controls and keyboard access.
- Preserve focus after insertion/deletion in a predictable nearby element.
- Group continuous inspector edits into one undoable action; keep explicit shortcut hints discoverable.

Shortcuts must not capture normal typing inside inputs. Modals should not require undocumented keyboard combinations to exit. Offer visible Undo/Redo controls even when shortcuts exist.

### 5.2 Inspector and binding fields

Use block-appropriate form controls, units, defaults, and validation. Separate Content, Layout/Style, and Bindings/Events sections. Show inherited/default values distinctly from explicit overrides.

Provide a binding picker for variables, wallet properties, input-block values and prior outputs. Show a readable label plus technical reference, for example “Recipient input value” and `{{inputs.recipient.value}}`. Available bindings must match runtime grammar; the editor must not offer unsupported expressions.

Display type and units next to contract parameters. For token amounts, make the decimals source visible. For native value, show currency/chain context; do not convert fiat values without a real data source. Never silently reinterpret “1” as one smallest unit or one whole token.

### 5.3 Workflow graph and list

Node cards should show action type, concise description, configuration completeness, and execution state when previewing. Distinguish trigger, read, write and feedback visually and textually.

For P0, constrain authoring to sequential chains. Reject extra outgoing edges/joins/cycles at connection time with a short explanation. Do not offer branching or loop node visuals that the runtime cannot execute.

The alternative step list supports add, remove, reorder and configure using clicks/taps and keyboard. Reordering must revalidate data dependencies; it must not silently repair references to future outputs. Run details identify which step completed, failed, awaits approval or has unknown chain status.

### 5.4 Contract import and deployment

ABI import should identify unsupported interactive methods before the user tries to wire them. Show full canonical signatures for overloads. “Code found at address” is a connectivity check, not “Verified contract.”

Deployment follows Template → Configuration → Review → Wallet → Receipt. Show source/artifact version, constructor inputs, ownership and supply/mint rules. The ERC-721 owner-mint template must say “Only the configured owner can mint”; it must not present a public mint/claim flow.

Do not show a deployed address before successful deployment evidence. Provide explorer access only for the configured correct network, with safe external-link behavior.

## 6. Critical-state matrix and copy guidance

| State | Suggested message | Safe primary action |
|---|---|---|
| Wallet absent/disconnected | “Connect a wallet to test this transaction.” | Connect wallet |
| Wrong network | “This project runs on Fuji. Your wallet is on another network.” | Switch network |
| Unsupported execution target | “Execution on this network is not supported in this release.” | Return to Fuji / inspect configuration |
| Invalid arguments | “Enter a valid recipient address.” / specific parameter error | Focus invalid field |
| Estimate unavailable | “Gas estimate is unavailable. Nothing has been submitted.” | Recheck / cancel; no fabricated cost |
| Awaiting wallet | “Review this request in your wallet.” | Open wallet guidance; cancel unstarted flow |
| Signature declined | “You declined the wallet request. Nothing was submitted by this step.” | Review again |
| Submitted | “Transaction submitted. Waiting for confirmation.” | View/copy hash |
| Confirmed | “Transaction confirmed on Fuji.” | View receipt / refreshed data |
| Reverted | “The transaction reverted. Network fees may still have been charged.” | Inspect reason and inputs |
| Receipt timeout | “The result is not yet known. Check status before submitting again.” | Check status |
| Repriced replacement | “The wallet changed the fee. Tracking the replacement transaction.” | View replacement hash |
| Cancelled/different replacement | “The original action was cancelled or replaced. Later steps were stopped.” | Inspect actual transaction |
| Partial completion | “Step 2 confirmed; step 3 did not finish. Earlier actions were not undone.” | Inspect completed steps |
| Autosave failure | “This draft is not saved in this browser.” | Download JSON backup |
| Storage unavailable | “Publishing is unavailable until storage support is verified.” | Export source / local preview |
| Upload succeeded, retrieval failed | “Upload completed, but the published snapshot could not be verified.” | Retry retrieval, not payment |
| Future/invalid schema | “This project cannot be opened by this runtime version.” | Return / obtain compatible project |

Inline errors identify the issue and next step; a toast is supplementary, not the sole location of important state. Do not expose raw provider messages containing sensitive data by default; allow redacted technical details on demand.

## 7. Publication and source-export UX

### Publication, only when supported

Use a dedicated review surface listing what will be public: project content, initial variables, contract addresses, network/RPC configuration and selected assets. Explain immutable revisions and the lack of guaranteed deletion. An acknowledgment is not a substitute for validation and secret-data warnings.

Show the dApp execution chain separately from storage payment chain/asset. If a payment requires real AVAX while the dApp uses Fuji, make that distinction unmistakable before the wallet opens. Quotes and estimates need timestamps/context and may change; refresh material changes and obtain renewed consent.

Show funding, asset upload, snapshot upload and retrieval verification as distinct steps when applicable. Do not collapse them into an early “Published” toast. Paid operations are never automatically retried on uncertainty. A verified result offers Copy link, Open runtime and revision details.

When publishing is unsupported, show a capability explanation and the working Preview/Export alternatives. Never fake an Irys transaction ID or successful upload to make the demonstration look complete.

### Source export

Explain that the ZIP contains Next.js source, schema, portable runtime, dependency lockfile, public configuration placeholders and setup instructions. List external service dependencies and unsupported project features before download.

The action should not require wallet connection. Use “Download source ZIP,” not “Deploy app.” After download, show concise setup/check instructions and distinguish portable source from local project JSON backup. No account or billing UI is required for the P0 export.

## 8. Accessibility requirements

Target WCAG 2.2 AA for applicable Studio and generated-runtime functionality. That is a target to test, not an automatic certification of all builder-authored content.

- **Keyboard and focus:** all controls and editing commands are keyboard operable, with logical order, visible focus, no traps, and focus return after dialogs. Focused controls must not be entirely hidden behind sticky panels/overlays (2.1.1, 2.4.7, 2.4.11).
- **Non-drag alternatives:** block and graph operations must also work with single-pointer clicks/taps without dragging; keyboard support alone does not satisfy the dragging alternative requirement (2.5.7).
- **Targets:** meet the 24 × 24 CSS px minimum or a documented applicable exception under 2.5.8. Prefer 40–44 px control boxes and 44 px mobile targets where practical rather than relying on exceptions.
- **Contrast:** ordinary text at least 4.5:1; large text at least 3:1; essential control/graphic boundaries at least 3:1 against adjacent colors (1.4.3, 1.4.11). Check both themes and selected/error states.
- **Errors and labels:** inputs have persistent accessible labels, required/type/unit guidance, specific errors linked to their controls, and error summaries where useful (3.3.1 and related form requirements).
- **Status announcements:** save/validation/transaction changes are available to assistive technology without repeatedly stealing focus or flooding a live region. Use polite announcements for routine status and concise urgent messaging only where necessary.
- **Structure:** landmarks, heading hierarchy, accessible names for icon controls, native buttons/inputs where possible, and semantic tree/list alternatives for spatial editing.
- **Zoom/reflow:** property panels/forms remain usable at zoom and narrow widths; ordinary visitor content reflows. A genuinely two-dimensional canvas may use controlled panning, but that does not exempt surrounding controls from accessibility.
- **Motion:** honor reduced-motion preferences; do not use motion alone to communicate pending status, and avoid decorative wallet/transaction animations that delay action.

Provide accessible block defaults: semantic headings, explicit Input labels, meaningful button text, and error text. Warn about obviously missing labels, but do not claim the builder can prove accessibility for arbitrary content or external wallets.

## 9. Responsive behavior

| Width / mode | Proposed behavior |
|---|---|
| ≥1280 px desktop | Three-pane UI editor with resizable sidebars and unobstructed top-bar actions |
| 1024–1279 px | Collapse palette/layers or inspector into a toggleable panel; preserve canvas space |
| 768–1023 px | Single authoring surface with accessible drawers; support project inspection and practical edits without claiming desktop-equivalent efficiency |
| <768 px Studio | Readable project/preview view and essential project actions; explicitly recommend desktop for complex authoring; never silently lose drafts |
| Published/exported runtime | Responsive single-page app at 320 CSS px and above, subject to supported authored layout constraints; test forms, wallet dialogs and long addresses |

A mobile preview inside Studio constrains the actual renderer viewport, not merely a decorative phone frame. Avoid horizontal page scrolling in ordinary runtime content. Wrap technical text or provide local copy/detail controls instead of forcing overflow.

## 10. Component-state contract

Every interactive component specification should identify default, hover, focus-visible, active/selected, disabled-with-reason, loading, error and success states where applicable. Runtime-specific components additionally need disconnected, wrong-network, awaiting-wallet, submitted, unknown and confirmed states.

Loading controls keep their accessible name and prevent duplicate in-instance actions. Long operations provide status and a safe cancellation/exit explanation, not a permanently spinning unlabeled button. Disabled controls remain understandable; tooltips alone are insufficient for critical requirements and do not work reliably for every disabled element.

Dialogs use clear titles, one primary action, optional safe secondary action, focus management and a reviewable summary. Destructive local actions require confirmation. Wallet prompts and fees are not ordinary reversible form submission.

## 11. Design validation and handoff

Before implementation sign-off, review:

1. A first-time builder can identify the product's Fuji-first scope and start without a wallet.
2. The reference token-dashboard flow is complete using supported blocks and scalar ABI methods.
3. Edit clicks cannot execute writes; Preview has an unmistakable boundary.
4. All drag operations have working click/tap alternatives and keyboard access.
5. An empty project, invalid binding, wrong network, rejected signature, reverted/unknown receipt and partial workflow completion have designed recovery paths.
6. Autosave failure and conflicting tabs preserve recoverable work.
7. Publish distinguishes storage-payment chain from execution chain and does not claim support until validated.
8. Export is visibly different from publication and local JSON backup.
9. Text/control contrast, focus, screen-reader announcements, zoom and mobile runtime flows have been manually checked in addition to automated scans.
10. The same authored fixture has equivalent content and behavior in preview/export and conditional published runtime.

Handoff should attach actual component states, tested tokens, form labels, error messages and responsive behavior to implementation work. This document does not substitute for a browser-tested interface. Pilot tests should record assistance, completion time and failure points against the PRD targets; no user results are claimed yet.

## 12. Official accessibility references

Checked November 16, 2026. Recheck applicability during implementation rather than treating a design checklist as certification.

- W3C, **Web Content Accessibility Guidelines 2.2** — `https://www.w3.org/TR/WCAG22/`.
- W3C WAI, **Understanding SC 2.5.7: Dragging Movements** — `https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html`.
- W3C WAI, **Understanding SC 2.5.8: Target Size (Minimum)** — `https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html`.

TL;DR: Make authoring fast, execution explicit, transaction state truthful, failure recoverable, and every important action accessible without relying on dragging or color alone.
