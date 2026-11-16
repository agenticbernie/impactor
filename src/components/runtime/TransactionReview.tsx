'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { TransactionReview } from '../../lib/web3/transactions';

export function useTransactionReview() {
  const [intent, setIntent] = useState<TransactionReview | null>(null);
  const resolve = useRef<((approved: boolean) => void) | null>(null);
  const review = useCallback((next: TransactionReview) => new Promise<boolean>(answer => {
    resolve.current?.(false); resolve.current = answer; setIntent(next);
  }), []);
  const answer = useCallback((approved: boolean) => { resolve.current?.(approved); resolve.current = null; setIntent(null); }, []);
  useEffect(() => () => { resolve.current?.(false); }, []);
  return { intent, review, answer };
}
export function TransactionReviewDialog({ intent, answer }: { intent: TransactionReview | null; answer: (approved: boolean) => void }) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (intent && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!intent && dialog.current?.open) dialog.current.close();
  }, [intent]);
  return <dialog className="rt-review" ref={dialog} onCancel={event => { event.preventDefault(); answer(false); }} aria-labelledby={titleId}>
    {intent && <>
      <h2 id={titleId}>Review {intent.kind === 'deployment' ? 'deployment' : 'transaction'}</h2>
      <p>A successful simulation is not a guarantee. Only continue if you trust this contract and understand the action.</p>
      <dl><dt>Network</dt><dd>{intent.network} ({intent.chainId})</dd><dt>Signer</dt><dd>{intent.account}</dd>
        {intent.address && <><dt>Contract</dt><dd>{intent.address}</dd></>}
        <dt>Method</dt><dd>{intent.method}</dd><dt>Arguments (base units)</dt><dd><ol>{intent.args.map((arg, index) => <li key={index}>{arg}</li>)}</ol>{!intent.args.length && 'None'}</dd>
        <dt>Native value</dt><dd>{intent.value} AVAX, plus network gas</dd><dt>Estimated gas units</dt><dd>{intent.gasEstimate ?? 'Unavailable — check the wallet estimate'}</dd>
        {intent.permissions && <><dt>Authority / permissions</dt><dd>{intent.permissions}</dd></>}
      </dl>
      <p>Your wallet will ask for a separate approval. A submitted transaction cannot be undone here.</p>
      <div className="rt-actions"><button type="button" autoFocus onClick={() => answer(false)}>Cancel</button><button type="button" className="rt-primary" onClick={() => answer(true)}>Continue to wallet</button></div>
    </>}
  </dialog>;
}
