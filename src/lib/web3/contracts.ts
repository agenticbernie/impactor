import { getAddress, isAddress, toFunctionSignature, type Abi, type AbiFunction, type AbiParameter, type Address } from 'viem';
import type { AvalancheNetworkConfig, ContractConfig, ContractActionConfig } from '../schema/types';
import { convertArgument, nativeValue, supportedScalar, type BindingContext } from '../engine/bindings';
import { publicClientFor } from './chains';

export interface FunctionDescriptor {
  signature: string; name: string; inputs: readonly AbiParameter[]; outputs: readonly AbiParameter[];
  stateMutability: AbiFunction['stateMutability']; supported: boolean; reason?: string;
}
export function getFunctions(abi: Abi): FunctionDescriptor[] {
  return abi.filter((entry): entry is AbiFunction => entry.type === 'function').map(fn => {
    const supported = [...fn.inputs, ...fn.outputs].every(p => supportedScalar(p.type));
    return { signature: toFunctionSignature(fn), name: fn.name, inputs: fn.inputs, outputs: fn.outputs,
      stateMutability: fn.stateMutability, supported, ...(!supported ? { reason: 'Arrays, tuples and non-scalar ABI types are not supported in P0.' } : {}) };
  });
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function parameters(value: unknown, depth = 0): boolean {
  if (depth > 10 || !Array.isArray(value) || value.length > 100) return false;
  return value.every(p => record(p) && typeof p.type === 'string' && p.type.length <= 100
    && /^(address|bool|string|bytes([1-9]|[12][0-9]|3[0-2])?|u?int([0-9]+)?|tuple|function)(\[\d*\])*$/.test(p.type)
    && (p.name === undefined || (typeof p.name === 'string' && p.name.length <= 200))
    && (!p.type.startsWith('tuple') || parameters(p.components, depth + 1)));
}
export function parseAbiJson(text: string): Abi {
  if (text.length > 200_000) throw new Error('ABI exceeds 200 KB');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('ABI must be valid JSON'); }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 300) throw new Error('ABI must be a non-empty array (maximum 300 entries)');
  for (const item of raw) {
    if (!record(item) || !['function', 'constructor', 'event', 'error', 'receive', 'fallback'].includes(String(item.type))) throw new Error('Unsupported ABI entry');
    if (['function', 'event', 'error'].includes(String(item.type)) && (typeof item.name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(item.name))) throw new Error('Invalid ABI name');
    if (['function', 'constructor', 'event', 'error'].includes(String(item.type)) && !parameters(item.inputs)) throw new Error('Invalid ABI inputs');
    if (item.type === 'function' && !parameters(item.outputs)) throw new Error('Invalid ABI outputs');
    if (['function', 'constructor', 'receive', 'fallback'].includes(String(item.type)) && !['pure', 'view', 'nonpayable', 'payable'].includes(String(item.stateMutability))) throw new Error('Invalid ABI mutability');
    if (item.type === 'event' && typeof item.anonymous !== 'boolean') throw new Error('Invalid event ABI');
  }
  const abi = raw as Abi;
  const signatures = getFunctions(abi).map(fn => fn.signature);
  if (new Set(signatures).size !== signatures.length) throw new Error('Duplicate function signatures');
  return abi;
}
export async function validateContract(network: AvalancheNetworkConfig, addressText: string, abiText: string) {
  if (!isAddress(addressText, { strict: true })) throw new Error('Enter a valid contract address');
  const address = getAddress(addressText);
  const abi = parseAbiJson(abiText);
  const client = publicClientFor(network);
  try {
    if (await client.getChainId() !== network.chainId) throw new Error('RPC chain mismatch');
    const code = await client.getCode({ address });
    if (!code || code === '0x') throw new Error('No deployed code');
  } catch {
    throw new Error('Contract verification failed: confirm the RPC is available, its chain matches the project, and this address contains deployed code.');
  }
  return { address, abi, functions: getFunctions(abi) };
}
export async function registerContract(network: AvalancheNetworkConfig, address: string, abiText: string, name = 'Imported contract', exposedFunctions?: string[]): Promise<ContractConfig> {
  const verified = await validateContract(network, address, abiText);
  const allowed = verified.functions.filter(fn => fn.supported).map(fn => fn.signature);
  const exposed = exposedFunctions ?? allowed;
  if (exposed.some(signature => !allowed.includes(signature))) throw new Error('Only supported ABI functions can be exposed');
  return { id: crypto.randomUUID(), name: name.trim() || 'Imported contract', chainId: network.chainId, address: verified.address, abi: verified.abi, exposedFunctions: exposed };
}
export interface PreparedCall {
  address: Address; abi: readonly [AbiFunction]; functionName: string; signature: string;
  args: readonly (string | boolean | bigint)[]; value: bigint; mutability: AbiFunction['stateMutability'];
}
export function prepareCall(contract: ContractConfig, action: ContractActionConfig, context: BindingContext): PreparedCall {
  if (!contract.exposedFunctions.includes(action.functionSignature)) throw new Error('Function is not exposed by this project');
  const fn = contract.abi.find((entry): entry is AbiFunction => entry.type === 'function' && toFunctionSignature(entry) === action.functionSignature);
  if (!fn || !getFunctions([fn])[0].supported) throw new Error('Unsupported function');
  if (action.args.length !== fn.inputs.length) throw new Error(`Expected ${fn.inputs.length} arguments`);
  const args = fn.inputs.map((input, index) => convertArgument(input.type, action.args[index], context));
  const value = nativeValue(action.value, context);
  if (value !== 0n && fn.stateMutability !== 'payable') throw new Error('Native value requires a payable function');
  return { address: contract.address, abi: [fn], functionName: fn.name, signature: action.functionSignature, args, value, mutability: fn.stateMutability };
}
export async function readContract(network: AvalancheNetworkConfig, contract: ContractConfig, action: ContractActionConfig, context: BindingContext): Promise<unknown> {
  if (contract.chainId !== network.chainId) throw new Error('Contract is associated with another chain');
  const call = prepareCall(contract, action, context);
  if (!['view', 'pure'].includes(call.mutability)) throw new Error('This function is not read-only');
  const client = publicClientFor(network);
  try {
    if (await client.getChainId() !== network.chainId) throw new Error('RPC chain mismatch');
    return await client.readContract({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args });
  } catch { throw new Error('Contract read failed. Check the RPC network, contract address, arguments and permissions.'); }
}
