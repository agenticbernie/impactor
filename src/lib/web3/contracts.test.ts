import { describe, expect, it } from 'vitest';
import { parseAbi } from 'viem';
import { parseAbiJson } from './contracts';
import erc20 from './artifacts/FixedSupplyToken.json';
import erc721 from './artifacts/OwnerMintNFT.json';

const abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

describe('ABI JSON and downloaded artifact import', () => {
  it.each([erc20, erc721])('extracts only the ABI from the downloaded $name artifact', artifact => {
    const download = JSON.stringify(artifact, null, 2);
    expect(new TextEncoder().encode(download).length).toBeGreaterThan(200_000);
    expect(parseAbiJson(download)).toEqual(artifact.abi);
  });

  it('accepts a JSON array formatted to 198 KiB', () => {
    expect(parseAbiJson(JSON.stringify(abi).padEnd(198 * 1024, ' '))).toEqual(abi);
  });

  it('measures the extracted ABI in UTF-8 bytes rather than string characters', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      type: 'function', name: `method${i}`, stateMutability: 'view',
      inputs: [{ type: 'string', name: 'é'.repeat(150) }],
      outputs: [{ type: 'string', name: 'é'.repeat(150) }],
    }));
    const json = JSON.stringify(entries);
    expect(json.length).toBeLessThan(200_000);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(200 * 1024);
    expect(() => parseAbiJson(json)).toThrow(/200 KiB/);
  });

  it('bounds the whole artifact before JSON parsing', () => {
    expect(() => parseAbiJson(' '.repeat(1024 * 1024 + 1))).toThrow(/1 MiB/);
  });

  it.each([{}, { abi: 'not an array' }, { abi: [] }, { bytecode: '0x6000' }])('rejects an artifact without a usable ABI: %j', artifact => {
    expect(() => parseAbiJson(JSON.stringify(artifact))).toThrow(/non-empty array/);
  });
});
