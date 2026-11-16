import type { ArgumentBinding } from '../schema/types';
import { isAddress, getAddress, parseUnits } from 'viem';

export interface BindingContext {
  state: Record<string, unknown>;
  inputs: Record<string, { value: string }>;
  wallet: { address?: string; chainId?: number };
  steps: Record<string, { output?: unknown; txHash?: string }>;
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const own = (object: object, key: string): unknown => {
  if (forbidden.has(key) || !Object.prototype.hasOwnProperty.call(object, key)) throw new Error(`Missing or forbidden binding: ${key}`);
  return (object as Record<string, unknown>)[key];
};
function reference(path: string, context: BindingContext): unknown {
  const parts = path.trim().split('.');
  if (parts.some(p => !/^[a-zA-Z0-9_-]+$/.test(p) || forbidden.has(p))) throw new Error('Unsupported binding expression');
  let result: unknown;
  if (parts[0] === 'state' && parts.length === 2) result = own(context.state, parts[1]);
  else if (parts[0] === 'wallet' && parts.length === 2 && ['address', 'chainId'].includes(parts[1])) result = own(context.wallet, parts[1]);
  else if (parts[0] === 'inputs' && parts.length === 3 && parts[2] === 'value') result = own(own(context.inputs, parts[1]) as object, 'value');
  else if (parts[0] === 'steps' && parts.length === 3 && ['output', 'txHash'].includes(parts[2])) result = own(own(context.steps, parts[1]) as object, parts[2]);
  else throw new Error('Unsupported binding expression');
  if (result === undefined || result === null) throw new Error(`Binding has no value: ${path}`);
  return result;
}
export function displayValue(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  throw new Error('Unsupported display value');
}
/** This is a reference parser, never a JavaScript evaluator. */
export function resolveBinding(value: string, context: BindingContext): unknown {
  const whole = /^\{\{\s*([^{}]+)\s*\}\}$/.exec(value);
  if (whole) return reference(whole[1], context);
  const output = value.replace(/\{\{([^{}]+)\}\}/g, (_, path: string) => displayValue(reference(path, context)));
  if (output.includes('{{') || output.includes('}}')) throw new Error('Malformed binding expression');
  return output;
}
export function supportedScalar(type: string): boolean {
  return /^(address|bool|string|bytes|bytes([1-9]|[12][0-9]|3[0-2])|u?int([0-9]+)?)$/.test(type)
    && (!/^u?int/.test(type) || (() => { const bits = Number(type.replace(/^u?int/, '') || '256'); return bits >= 8 && bits <= 256 && bits % 8 === 0; })());
}
export function convertArgument(type: string, binding: ArgumentBinding, context: BindingContext): string | boolean | bigint {
  if (!supportedScalar(type)) throw new Error(`Unsupported interactive ABI type: ${type}`);
  const resolved = resolveBinding(binding.value, context);
  const text = displayValue(resolved);
  if (binding.decimals !== undefined && !/^u?int/.test(type)) throw new Error('Decimals apply only to integer parameters');
  if (type === 'address') {
    if (!isAddress(text, { strict: true })) throw new Error('Invalid address');
    return getAddress(text);
  }
  if (type === 'bool') {
    if (resolved === true || text === 'true') return true;
    if (resolved === false || text === 'false') return false;
    throw new Error('Boolean must be true or false');
  }
  if (type === 'string') return text;
  if (type.startsWith('bytes')) {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(text)) throw new Error('Bytes must be even-length hexadecimal');
    const size = Number(type.slice(5));
    if (size && text.length !== 2 + size * 2) throw new Error(`${type} requires exactly ${size} bytes`);
    return text;
  }
  // Never accept JS numbers for large on-chain quantities or silently round precision.
  if (typeof resolved === 'number' && !Number.isSafeInteger(resolved)) throw new Error('Use decimal strings for chain quantities');
  let integer: bigint;
  if (binding.decimals !== undefined) {
    if (!Number.isInteger(binding.decimals) || binding.decimals < 0 || binding.decimals > 255) throw new Error('Invalid decimals');
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error('Invalid decimal amount');
    if ((text.split('.')[1]?.length ?? 0) > binding.decimals) throw new Error('Amount exceeds configured decimal precision');
    integer = parseUnits(text, binding.decimals);
  } else {
    if (!/^-?\d+$/.test(text)) throw new Error('Integer requires a whole decimal string');
    integer = BigInt(text);
  }
  const signed = type.startsWith('int');
  const bits = BigInt(Number(type.replace(/^u?int/, '') || '256'));
  const min = signed ? -(1n << (bits - 1n)) : 0n;
  const max = signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
  if (integer < min || integer > max) throw new Error(`${type} value is out of range`);
  return integer;
}
export function nativeValue(text: string | undefined, context: BindingContext): bigint {
  return convertArgument('uint256', { value: text ?? '0', decimals: 18 }, context) as bigint;
}
