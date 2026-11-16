'use client';

import { use, useEffect, useState } from 'react';
import { RuntimeApp } from '@/components/runtime/RuntimeApp';
import { loadPublishedProject, type SnapshotResult } from '@/lib/irys';

type LoaderState = SnapshotResult | { status: 'loading' };
const headings = {
  invalid: 'Invalid snapshot',
  unavailable: 'Snapshot unavailable',
  'unsupported-schema': 'Unsupported schema version',
  'unsupported-network': 'Unsupported execution network',
} as const;

export default function PublishedProjectPage({ params }: { params: Promise<{ txId: string }> }) {
  const { txId } = use(params);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; attempt: number; result: LoaderState } | null>(null);
  const state: LoaderState = loaded?.id === txId && loaded.attempt === attempt ? loaded.result : { status: 'loading' };

  useEffect(() => {
    const controller = new AbortController();
    void loadPublishedProject(txId, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setLoaded({ id: txId, attempt, result });
    });
    return () => controller.abort();
  }, [txId, attempt]);

  return (
    <main>
      <aside style={{ padding: '12px 20px', borderBottom: '1px solid currentColor', fontSize: 14 }}>
        Experimental snapshot retrieval. Availability and storage guarantees are unverified. A valid snapshot is not a security endorsement; review contracts before connecting a wallet.
      </aside>
      {state.status === 'ready' ? <RuntimeApp key={`${txId}:${attempt}`} project={state.project} /> : (
        <section aria-live="polite" style={{ maxWidth: 680, margin: '64px auto', padding: 24 }}>
          <h1>{state.status === 'loading' ? 'Loading snapshot' : headings[state.status]}</h1>
          <p>{state.status === 'loading' ? 'Retrieving a bounded JSON snapshot from the configured gateway. No wallet connection is requested.' : state.message}</p>
          {state.status === 'unavailable' && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry retrieval</button>}
          <p><a href="/studio">Open Studio</a></p>
        </section>
      )}
    </main>
  );
}
