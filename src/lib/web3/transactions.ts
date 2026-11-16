import type { Abi, Address, Hash, WalletClient, TransactionReceipt } from 'viem';
import { formatEther } from 'viem';
import type { AvalancheNetworkConfig, ContractActionConfig, ContractConfig } from '../schema/types';
import type { BindingContext } from '../engine/bindings';
import { ActionError, type Progress } from '../engine/workflow';
import { assertFuji, chainFor, publicClientFor } from './chains';
import { prepareCall } from './contracts';

export interface TransactionReview {
  kind: 'write' | 'deployment'; chainId: number; network: string; account: Address; address?: Address;
  method: string; args: readonly string[]; value: string; gasEstimate?: string; permissions?: string;
}
export type ReviewTransaction = (review: TransactionReview) => Promise<boolean>;
export interface JournalEntry { hash: Hash; chainId: number; kind: 'write' | 'deployment'; status: 'submitted' | 'success' | 'reverted' | 'replaced'; timestamp: number; intent?: 'different' }
const JOURNAL_KEY = 'impactor-transaction-journal-v1';
export function readJournal(): JournalEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(JOURNAL_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((entry): entry is JournalEntry => typeof entry === 'object' && entry !== null && /^0x[\da-f]{64}$/i.test(entry.hash) && Number.isSafeInteger(entry.chainId) && ['write', 'deployment'].includes(entry.kind) && ['submitted', 'success', 'reverted', 'replaced'].includes(entry.status) && Number.isFinite(entry.timestamp) && (entry.intent === undefined || entry.intent === 'different')).slice(-50);
  } catch { return []; }
}
export function journal(entry: JournalEntry): void {
  try {
    const previous = readJournal();
    const existing = previous.find(item => item.hash === entry.hash && item.chainId === entry.chainId);
    const entries = previous.filter(item => item.hash !== entry.hash || item.chainId !== entry.chainId);
    // Receipt status updates must never erase a known different-intent replacement disposition.
    const intent = entry.intent ?? existing?.intent;
    localStorage.setItem(JOURNAL_KEY, JSON.stringify([...entries, { ...entry, ...(intent ? { intent } : {}) }].slice(-50)));
  } catch { /* Storage is fallible; run memory still retains the hash. */ }
}
export function isRejected(error: unknown): boolean {
  let current: unknown = error;
  for (let i = 0; current && typeof current === 'object' && i < 8; i++) {
    const item = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (item.code === 4001 || item.name === 'UserRejectedRequestError') return true;
    current = item.cause;
  }
  return false;
}
export async function walletIdentity(wallet: WalletClient, chainId: number, expected?: Address): Promise<Address> {
  const [accounts, actualChain] = await Promise.all([wallet.getAddresses(), wallet.getChainId()]);
  const account = accounts[0];
  if (!account || actualChain !== chainId) throw new ActionError('Connect your wallet to Avalanche Fuji before continuing.', 'failed');
  if (expected && expected.toLowerCase() !== account.toLowerCase()) throw new ActionError('Wallet account changed. Start a new review.', 'cancelled');
  return account;
}
export async function waitReceipt(network: AvalancheNetworkConfig, hash: Hash, kind: 'write' | 'deployment', progress: Progress): Promise<TransactionReceipt> {
  const client = publicClientFor(network);
  let currentHash = hash; let replaced = false;
  try {
    progress('confirming', hash);
    const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 180_000,
      onReplaced(replacement) {
        if (replacement.reason !== 'repriced') replaced = true;
        const intent = replaced ? { intent: 'different' as const } : {};
        journal({ hash: currentHash, chainId: network.chainId, kind, status: 'replaced', timestamp: Date.now(), ...intent });
        currentHash = replacement.transaction.hash;
        journal({ hash: currentHash, chainId: network.chainId, kind, status: 'submitted', timestamp: Date.now(), ...intent });
        progress('confirming', currentHash);
      },
    });
    journal({ hash: currentHash, chainId: network.chainId, kind, status: receipt.status, timestamp: Date.now() });
    if (replaced) throw new ActionError('Transaction was cancelled or replaced with a different intent. Downstream actions stopped.', 'cancelled');
    if (receipt.status === 'reverted') throw new ActionError('Transaction reverted on-chain. Downstream actions stopped.', 'reverted');
    return receipt;
  } catch (error) {
    if (replaced) throw new ActionError('Transaction was cancelled or replaced with a different intent. Downstream actions and original-intent recovery stopped.', 'cancelled');
    if (error instanceof ActionError) throw error;
    throw new ActionError('Receipt is not known yet. Check status using the retained hash; do not resubmit.', 'unknown');
  }
}
export async function checkReceipt(network: AvalancheNetworkConfig, hash: Hash): Promise<TransactionReceipt | undefined> {
  try {
    const client = publicClientFor(network);
    if (await client.getChainId() !== network.chainId) return undefined;
    return await client.getTransactionReceipt({ hash });
  } catch { return undefined; }
}
export async function writeContract(network: AvalancheNetworkConfig, contract: ContractConfig, action: ContractActionConfig, context: BindingContext,
  wallet: WalletClient, review: ReviewTransaction, progress: Progress, cancelled: () => boolean): Promise<Hash> {
  assertFuji(network);
  if (contract.chainId !== network.chainId) throw new ActionError('Contract belongs to another chain', 'failed');
  const call = prepareCall(contract, action, context);
  if (['view', 'pure'].includes(call.mutability)) throw new ActionError('Read functions cannot be submitted as writes', 'failed');
  const client = publicClientFor(network);
  const account = await walletIdentity(wallet, network.chainId, context.wallet.address as Address | undefined);
  if (await client.getChainId() !== network.chainId) throw new ActionError('RPC chain does not match the project', 'failed');
  const code = await client.getCode({ address: call.address });
  if (!code || code === '0x') throw new ActionError('Contract has no deployed code on this network', 'failed');
  const request = { address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, account, value: call.value };
  try { await client.simulateContract(request); } catch { throw new ActionError('Contract simulation failed. Check arguments, balance and permissions. No transaction was sent.', 'failed'); }
  let gasEstimate: string | undefined;
  try { gasEstimate = (await client.estimateContractGas({ ...request, abi: call.abi as Abi })).toString(); } catch { /* Estimate unavailable is disclosed. */ }
  if (cancelled()) throw new ActionError('Run cancelled before review', 'cancelled');
  progress('awaiting_consent');
  const consent = await review({ kind: 'write', chainId: network.chainId, network: network.name, account, address: call.address, method: call.signature, args: call.args.map(String), value: formatEther(call.value), gasEstimate });
  if (!consent || cancelled()) throw new ActionError('Transaction review cancelled. Nothing was submitted.', 'cancelled');
  await walletIdentity(wallet, network.chainId, account);
  if (cancelled()) throw new ActionError('Run cancelled before wallet request', 'cancelled');
  progress('awaiting_wallet');
  let hash: Hash;
  try { hash = await wallet.writeContract({ ...request, chain: chainFor(network) }); }
  catch (error) {
    if (isRejected(error)) throw new ActionError('Wallet request was declined. Nothing was submitted by this request.', 'rejected');
    throw new ActionError('Wallet submission result is uncertain and no hash was returned. Check your wallet activity before starting another run. No automatic retry.', 'unknown');
  }
  journal({ hash, chainId: network.chainId, kind: 'write', status: 'submitted', timestamp: Date.now() });
  progress('submitted', hash);
  const receipt = await waitReceipt(network, hash, 'write', progress);
  return receipt.transactionHash;
}
