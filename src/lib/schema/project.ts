import type { AvalancheNetworkConfig, BlockType, ImpactorProjectSchema, JsonValue, UIBlockNode } from './types';

export const FUJI_NETWORK: AvalancheNetworkConfig = {
  chainId: 43113, name: 'Avalanche Fuji', rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
  explorerUrl: 'https://testnet.snowtrace.io', nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
};
export const MAINNET_NETWORK: AvalancheNetworkConfig = {
  chainId: 43114, name: 'Avalanche C-Chain', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
  explorerUrl: 'https://snowtrace.io', nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
};

export function createBlock(type: BlockType): UIBlockNode {
  const defaults: Record<BlockType, Record<string, JsonValue>> = {
    Container: {}, Heading: { text: 'Your heading', level: 2 }, Text: { text: 'Add your description here.' },
    Input: { label: 'Input', placeholder: 'Enter a value', value: '', inputType: 'text' },
    Button: { label: 'Continue', variant: 'primary' }, ConnectWallet: { label: 'Connect wallet' },
    ContractRead: { label: 'Contract value', contractId: '', functionSignature: '', args: [] },
    ContractWrite: { label: 'Submit transaction', contractId: '', functionSignature: '', args: [] },
  };
  return {
    id: crypto.randomUUID(), type, props: structuredClone(defaults[type]),
    styles: type === 'Container' ? { display: 'flex', flexDirection: 'column', gap: '16px', padding: '24px' } : {},
    ...(type === 'Container' ? { children: [] } : {}),
  };
}

export function createProject(name = 'Untitled project', template: 'token' | 'blank' = 'token'): ImpactorProjectSchema {
  const root = createBlock('Container');
  root.styles = { ...root.styles, maxWidth: '720px', width: '100%' };
  if (template === 'token') {
    const heading = createBlock('Heading');
    heading.props = { text: 'Your token dashboard', level: 1 };
    const description = createBlock('Text');
    description.props.text = 'Connect a wallet and configure your deployed token contract on Fuji. Add a transfer action after registering the real contract.';
    const recipient = createBlock('Input');
    recipient.props = { label: 'Recipient address', placeholder: '0x…', inputType: 'text', value: '' };
    const amount = createBlock('Input');
    amount.props = { label: 'Token amount', placeholder: '0.0', inputType: 'text', value: '' };
    root.children = [heading, description, createBlock('ConnectWallet'), recipient, amount];
  }
  return { schemaVersion: 1, id: crypto.randomUUID(), name, network: structuredClone(FUJI_NETWORK), contracts: [], variables: [], uiTree: root, workflows: { nodes: [], edges: [] } };
}

export function flattenBlocks(root: UIBlockNode): UIBlockNode[] {
  const result: UIBlockNode[] = [];
  const pending = [root];
  const seen = new Set<UIBlockNode>();
  while (pending.length) {
    const block = pending.pop()!;
    if (seen.has(block)) continue;
    seen.add(block);
    result.push(block);
    if (block.children) pending.push(...[...block.children].reverse());
  }
  return result;
}

export function findBlock(root: UIBlockNode, id: string): UIBlockNode | undefined {
  return flattenBlocks(root).find((block) => block.id === id);
}

/** Stable key ordering, unchanged array ordering. Reject non-JSON values instead of losing data. */
export function canonicalizeProject(project: ImpactorProjectSchema): string {
  const ancestors = new Set<object>();
  function sort(value: unknown): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || ancestors.has(value)) throw new Error('Project must contain finite, acyclic JSON values only.');
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Project must contain plain JSON objects only.');
    ancestors.add(value);
    const result: JsonValue = Array.isArray(value) ? value.map(sort) : Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort((value as Record<string, unknown>)[key])]));
    ancestors.delete(value);
    return result;
  }
  return JSON.stringify(sort(project));
}
