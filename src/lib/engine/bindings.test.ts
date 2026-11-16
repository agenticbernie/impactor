import { describe, expect, it } from 'vitest';
import { convertArgument, nativeValue, resolveBinding, supportedScalar, type BindingContext } from './bindings';

const context: BindingContext = { state: { amount: '1.25', flag: true, amountLarge: 42n }, wallet: { address: '0x0000000000000000000000000000000000000001', chainId: 43113 }, inputs: { recipient: { value: 'alice' } }, steps: { read: { output: 20n, txHash: '0x1234' } } };
describe('restricted binding grammar', () => {
  it('preserves whole-value types and interpolates text', () => {
    expect(resolveBinding('{{state.flag}}', context)).toBe(true);
    expect(resolveBinding('{{steps.read.output}}', context)).toBe(20n);
    expect(resolveBinding('Hello {{inputs.recipient.value}} on {{wallet.chainId}}', context)).toBe('Hello alice on 43113');
  });
  it.each(['{{state.__proto__}}', '{{state.constructor}}', '{{wallet.address.length}}', '{{state.amount.toString()}}', '{{steps.future.output}}', '{{steps.read.value}}', '{{state.missing}}', '{{state.amount'])('rejects unsafe or missing reference %s', value => expect(() => resolveBinding(value, context)).toThrow());
});
describe('ABI scalar conversion', () => {
  it('converts decimal token values exactly without floating point', () => {
    expect(convertArgument('uint256', { value: '{{state.amount}}', decimals: 18 }, context)).toBe(1250000000000000000n);
    expect(nativeValue('0.000000000000000001', context)).toBe(1n);
    expect(() => convertArgument('uint256', { value: '1.0001', decimals: 3 }, context)).toThrow(/precision/);
  });
  it('enforces signed widths and strict booleans', () => {
    expect(convertArgument('int8', { value: '-128' }, context)).toBe(-128n);
    expect(() => convertArgument('int8', { value: '128' }, context)).toThrow(/range/);
    expect(() => convertArgument('uint8', { value: '-1' }, context)).toThrow(/range/);
    expect(() => convertArgument('bool', { value: '1' }, context)).toThrow();
    expect(convertArgument('bool', { value: '{{state.flag}}' }, context)).toBe(true);
  });
  it('rejects non-scalars, malformed hex and invalid integer widths', () => {
    expect(supportedScalar('uint7')).toBe(false);
    expect(supportedScalar('tuple')).toBe(false);
    expect(() => convertArgument('address[]', { value: '[]' }, context)).toThrow();
    expect(() => convertArgument('bytes2', { value: '0x12' }, context)).toThrow();
    expect(() => convertArgument('bytes', { value: '0x123' }, context)).toThrow();
    expect(() => convertArgument('uint256', { value: '1e18' }, context)).toThrow();
    expect(() => convertArgument('address', { value: '0x123' }, context)).toThrow();
  });
});
