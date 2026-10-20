'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { PrerequisitesResponse } from '@/types';
import { Button, TerminalPanel } from '@/components/ui';

/** "Builds on": the terms this concept's definition names. Renders nothing for concepts with no graph. */
export function PrerequisitePanel({ conceptId }: { conceptId: string }) {
  const [data, setData] = useState<PrerequisitesResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.concepts.prerequisites(conceptId).then(d => !cancelled && setData(d)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [conceptId]);

  if (!data?.available || !data.prerequisites) return null;
  const { prerequisites, struggling, dependents, questions } = data;
  if (prerequisites.length === 0 && !dependents) return null;
  const toCheck = prerequisites.filter(p => p.needsCheck);
  const probes = questions?.length ?? 0;

  return (
    <TerminalPanel title="PREREQUISITES.EXE" actions={<span className="font-mono text-[10px] tracking-[0.14em] text-cyan">FROM SOURCE TEXT</span>}>
      <div className="space-y-4">
        {struggling && toCheck.length > 0 ? (
          <p role="status" className="rounded border border-watch/40 bg-watch/10 p-3 text-sm text-watch">
            You&apos;re struggling with this one. It builds on {toCheck.length} term{toCheck.length === 1 ? '' : 's'} that {toCheck.length === 1 ? 'needs' : 'need'} a check; a shaky foundation is a common reason a definition won&apos;t stick.
          </p>
        ) : (
          <p className="text-sm text-ink-dim">
            Terms this definition names (and the source defines no later). Found by matching names in the text, so check they make sense.
          </p>
        )}

        {prerequisites.length > 0 && (
          <ul className="space-y-2">
            {prerequisites.map(p => (
              <li key={p.termId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded border border-line bg-night px-3 py-2">
                <span className="min-w-0 break-words text-sm text-ink">
                  {p.conceptId ? <Link href={`/concepts/${p.conceptId}`} className="text-cyan underline-offset-2 hover:underline">{p.term}</Link> : p.term}
                </span>
                <span className={cn('font-mono text-[11px]', p.needsCheck ? 'text-watch' : 'text-strong')}>
                  {p.reason ?? `OK · ${Math.round((p.predictedRecall ?? 0) * 100)}% predicted`}
                </span>
              </li>
            ))}
          </ul>
        )}

        {probes > 0 && (
          <Link href={`/concepts/${conceptId}/check`}>
            <Button variant={struggling ? 'primary' : 'secondary'} size="sm" className="min-h-11 sm:min-h-0">Check the prerequisites ({probes} question{probes === 1 ? '' : 's'})</Button>
          </Link>
        )}
        {!!dependents && <p className="font-mono text-[11px] text-ink-dim">{dependents} other term{dependents === 1 ? '' : 's'} in this source build on this one.</p>}
      </div>
    </TerminalPanel>
  );
}
