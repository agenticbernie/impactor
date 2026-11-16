import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createVM, type VM } from '@ethereumjs/vm';
import { createCustomCommon, Mainnet } from '@ethereumjs/common';
import { Account, createAddressFromString, type Address as VMAddress } from '@ethereumjs/util';
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, hexToBytes, toHex, type Abi, type Hex } from 'viem';
import erc20 from './artifacts/FixedSupplyToken.json';
import erc721 from './artifacts/OwnerMintNFT.json';

const owner = createAddressFromString('0x1000000000000000000000000000000000000001');
const other = createAddressFromString('0x2000000000000000000000000000000000000002');
let vm: VM;
async function deploy(artifact: typeof erc20 | typeof erc721, args: readonly unknown[]) {
  const data = encodeDeployData({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args });
  const result = await vm.evm.runCall({ caller: owner, data: hexToBytes(data), gasLimit: 10_000_000n });
  expect(result.execResult.exceptionError).toBeUndefined();
  expect(result.createdAddress).toBeDefined();
  return result.createdAddress!;
}
async function call(artifact: typeof erc20 | typeof erc721, address: VMAddress, functionName: string, args: readonly unknown[] = [], caller = owner) {
  const data = encodeFunctionData({ abi: artifact.abi as Abi, functionName, args });
  return vm.evm.runCall({ caller, to: address, data: hexToBytes(data), gasLimit: 2_000_000n });
}
async function read(artifact: typeof erc20 | typeof erc721, address: VMAddress, functionName: string, args: readonly unknown[] = []) {
  const result = await call(artifact, address, functionName, args);
  expect(result.execResult.exceptionError).toBeUndefined();
  return decodeFunctionResult({ abi: artifact.abi as Abi, functionName, data: toHex(result.execResult.returnValue) });
}
// Controlled in-process Cancun EVM: no RPC, browser wallet, faucet, or public funds.
// Ganache's Shanghai-only VM cannot execute OpenZeppelin 5.6.1 MCOPY bytecode.
beforeEach(async () => {
  vm = await createVM({ common: createCustomCommon({ chainId: 31337 }, Mainnet, { hardfork: 'cancun' }) });
  await vm.stateManager.putAccount(owner, new Account(0n, 10n ** 20n));
  await vm.stateManager.putAccount(other, new Account(0n, 10n ** 20n));
});
describe('real compiled contract artifacts on a controlled Cancun EVM', () => {
  it('matches pinned compiler, source and bytecode integrity metadata', () => {
    for (const artifact of [erc20, erc721]) {
      expect(artifact.compiler).toMatch(/^0\.8\.38\+/); expect(artifact.dependencies['@openzeppelin/contracts']).toBe('5.6.1');
      expect(artifact.settings.evmVersion).toBe('cancun');
      expect(createHash('sha256').update(Buffer.from(artifact.bytecode.slice(2), 'hex')).digest('hex')).toBe(artifact.bytecodeSha256);
      expect(createHash('sha256').update(JSON.stringify(artifact.sources)).digest('hex')).toBe(artifact.sourceBundleSha256);
      for (const source of Object.values(artifact.sources)) expect(createHash('sha256').update(source.content).digest('hex')).toBe(source.sha256);
    }
  });
  it('deploys the fixed supply ERC20 and enforces transfer balances without mint authority', async () => {
    const supply = 1_000_000n * 10n ** 18n;
    const address = await deploy(erc20, ['Test Token', 'TEST', owner.toString(), supply]);
    expect(await read(erc20, address, 'name')).toBe('Test Token');
    expect(await read(erc20, address, 'decimals')).toBe(18);
    expect(await read(erc20, address, 'totalSupply')).toBe(supply);
    expect(await read(erc20, address, 'balanceOf', [owner.toString()])).toBe(supply);
    expect((await call(erc20, address, 'transfer', [other.toString(), 25n])).execResult.exceptionError).toBeUndefined();
    expect(await read(erc20, address, 'balanceOf', [other.toString()])).toBe(25n);
    expect(await read(erc20, address, 'totalSupply')).toBe(supply);
    expect((await call(erc20, address, 'transfer', [owner.toString(), 26n], other)).execResult.exceptionError).toBeDefined();
    expect(erc20.abi.some(entry => entry.type === 'function' && 'name' in entry && ['mint', 'owner', 'claim'].includes(entry.name ?? ''))).toBe(false);
    expect(toHex(await vm.stateManager.getCode(address))).toBe(erc20.deployedBytecode);
  });
  it('deploys ERC721 and permits only owner mint, rejecting duplicate IDs', async () => {
    const address = await deploy(erc721, ['Test Collection', 'NFT', owner.toString()]);
    expect(await read(erc721, address, 'owner')).toBe(owner.toString());
    expect((await call(erc721, address, 'mint', [other.toString(), 1n], other)).execResult.exceptionError).toBeDefined();
    expect((await call(erc721, address, 'mint', [other.toString(), 1n])).execResult.exceptionError).toBeUndefined();
    expect(await read(erc721, address, 'ownerOf', [1n])).toBe(other.toString());
    expect((await call(erc721, address, 'mint', [owner.toString(), 1n])).execResult.exceptionError).toBeDefined();
    expect((await call(erc721, address, 'transferOwnership', [other.toString()])).execResult.exceptionError).toBeUndefined();
    expect((await call(erc721, address, 'mint', [owner.toString(), 2n])).execResult.exceptionError).toBeDefined();
    expect((await call(erc721, address, 'mint', [owner.toString(), 2n], other)).execResult.exceptionError).toBeUndefined();
  });
  it('rejects zero recipient or zero owner constructors', async () => {
    for (const artifact of [erc20, erc721]) {
      const args = ['Bad', 'BAD', '0x0000000000000000000000000000000000000000', ...(artifact === erc20 ? [1n] : [])];
      const data = encodeDeployData({ abi: artifact.abi as Abi, bytecode: artifact.bytecode as Hex, args });
      const result = await vm.evm.runCall({ caller: owner, data: hexToBytes(data), gasLimit: 10_000_000n });
      expect(result.execResult.exceptionError).toBeDefined();
    }
  });
});
