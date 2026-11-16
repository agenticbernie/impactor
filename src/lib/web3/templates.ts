import type { Abi, Address, Hash, Hex, WalletClient } from 'viem';
import { encodeDeployData } from 'viem';
import erc20 from './artifacts/FixedSupplyToken.json';
import erc721 from './artifacts/OwnerMintNFT.json';
import type { AvalancheNetworkConfig, ContractConfig } from '../schema/types';
import { convertArgument } from '../engine/bindings';
import { ActionError, type Progress } from '../engine/workflow';
import { assertFuji, chainFor, publicClientFor } from './chains';
import { getFunctions } from './contracts';
import { isRejected, journal, walletIdentity, waitReceipt, type ReviewTransaction } from './transactions';

export interface ContractTemplate {
  templateId: string; name: string; version: string; license: string; compiler: string;
  dependencies: Record<string, string>; abi: Abi; bytecode: Hex; bytecodeSha256: string;
  permissions: string; auditStatus: string; explorerVerification: string;
}
export const CONTRACT_TEMPLATES: ContractTemplate[] = [erc20 as unknown as ContractTemplate, erc721 as unknown as ContractTemplate];
export const TEMPLATE_MANIFESTS = { 'erc20-fixed-v1': erc20, 'erc721-owner-v1': erc721 };
export interface DeploymentInput { templateId: string; name: string; symbol: string; owner: string; supply?: string }
export function prepareDeployment(input: DeploymentInput) {
  const template = CONTRACT_TEMPLATES.find(item => item.templateId === input.templateId);
  if (!template) throw new Error('Unknown built-in contract template');
  if (!input.name.trim() || input.name.length > 100 || !input.symbol.trim() || input.symbol.length > 20) throw new Error('Provide a name (1–100 characters) and symbol (1–20 characters)');
  const context = { state: {}, inputs: {}, wallet: {}, steps: {} };
  const owner = convertArgument('address', { value: input.owner }, context) as Address;
  if (/^0x0{40}$/.test(owner)) throw new Error('Owner / recipient cannot be the zero address');
  const args: (string | bigint)[] = [input.name.trim(), input.symbol.trim(), owner];
  if (template.templateId === 'erc20-fixed-v1') args.push(convertArgument('uint256', { value: input.supply ?? '', decimals: 18 }, context) as bigint);
  return { template, args, owner };
}
export async function deployTemplate(network: AvalancheNetworkConfig, input: DeploymentInput, wallet: WalletClient, review: ReviewTransaction, progress: Progress): Promise<ContractConfig> {
  assertFuji(network);
  const { template, args } = prepareDeployment(input);
  const account = await walletIdentity(wallet, network.chainId);
  const client = publicClientFor(network);
  if (await client.getChainId() !== network.chainId) throw new ActionError('RPC chain mismatch', 'failed');
  const data = encodeDeployData({ abi: template.abi, bytecode: template.bytecode, args });
  let gas: bigint;
  try { gas = await client.estimateGas({ account, data, value: 0n }); }
  catch { throw new ActionError('Deployment simulation / gas estimation failed. Check your Fuji balance and constructor values. Nothing was submitted.', 'failed'); }
  progress('awaiting_consent');
  if (!await review({ kind: 'deployment', chainId: network.chainId, network: network.name, account, method: `${template.name} constructor`, args: args.map(String), value: '0', gasEstimate: gas.toString(), permissions: template.permissions })) throw new ActionError('Deployment review cancelled', 'cancelled');
  await walletIdentity(wallet, network.chainId, account);
  progress('awaiting_wallet');
  let hash: Hash;
  try { hash = await wallet.deployContract({ abi: template.abi, bytecode: template.bytecode, args, account, chain: chainFor(network), value: 0n }); }
  catch (error) {
    if (isRejected(error)) throw new ActionError('Deployment request was declined in the wallet', 'rejected');
    throw new ActionError('Deployment submission is uncertain and no hash was returned. Check wallet activity; no automatic retry.', 'unknown');
  }
  journal({ hash, chainId: network.chainId, kind: 'deployment', status: 'submitted', timestamp: Date.now() });
  progress('submitted', hash);
  const receipt = await waitReceipt(network, hash, 'deployment', progress);
  if (!receipt.contractAddress || /^0x0{40}$/.test(receipt.contractAddress)) throw new ActionError('Receipt did not contain a valid deployed address. Do not redeploy automatically.', 'unknown');
  let code: Hex | undefined;
  try { code = await client.getCode({ address: receipt.contractAddress }); }
  catch { throw new ActionError('Deployment receipt succeeded but code verification is unavailable. Check status using the retained hash; do not redeploy.', 'unknown'); }
  if (!code || code === '0x') throw new ActionError('Deployment receipt succeeded but code could not be verified. Check status; do not redeploy.', 'unknown');
  return { id: crypto.randomUUID(), name: input.name.trim(), address: receipt.contractAddress, chainId: network.chainId, abi: template.abi, templateId: template.templateId, exposedFunctions: getFunctions(template.abi).filter(fn => fn.supported).map(fn => fn.signature) };
}
