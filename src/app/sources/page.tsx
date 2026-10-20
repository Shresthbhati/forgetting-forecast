'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Presentation, RotateCcw, Trash2, UploadCloud } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ACCEPTED_EXTENSIONS, fileExtension } from '@/domain/ingestion/kind';
import { MAX_UPLOAD_BYTES } from '@/domain/ingestion/types';
import type { Source } from '@/types';
import { Badge, Button, Dialog, EmptyState, Input, Skeleton, StatusPill, TerminalPanel, useToast, type PillStatus } from '@/components/ui';

const SUBJECT_KEY = 'ff:last-source-subject';

type UploadState = 'uploading' | 'processing' | 'done' | 'error';
interface UploadItem {
  key: number;
  name: string;
  progress: number;
  state: UploadState;
  message?: string;
}

const STATUS: Record<Source['status'], { pill: PillStatus; label: string }> = {
  ready: { pill: 'strong', label: 'READY' },
  processing: { pill: 'pending', label: 'PROCESSING' },
  failed: { pill: 'due', label: 'FAILED' },
};

function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function unitLabel(s: Source): string | null {
  if (s.unitCount == null || s.kind === 'docx' || s.kind === 'text') return null;
  const noun = s.kind === 'pptx' ? 'slide' : 'page';
  return `${s.unitCount} ${noun}${s.unitCount === 1 ? '' : 's'}`;
}

export default function SourcesPage() {
  const toast = useToast();
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectError, setSubjectError] = useState('');
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<Source | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);

  const load = useCallback(async () => {
    setError('');
    try {
      setSources((await api.sources.list()).sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load your sources');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Default the subject once, after the list loads: the last one used, else the most recent source's.
  // (Only once, so the user can clear the field and type a new subject.)
  const subjectDefaulted = useRef(false);
  useEffect(() => {
    if (sources === null || subjectDefaulted.current) return;
    subjectDefaulted.current = true;
    let saved = '';
    try {
      saved = localStorage.getItem(SUBJECT_KEY) ?? '';
    } catch {
      /* storage unavailable */
    }
    setSubject(saved || sources[0]?.subject || '');
  }, [sources]);

  const subjects = useMemo(() => [...new Set((sources ?? []).map(s => s.subject))].sort(), [sources]);
  const grouped = useMemo(() => {
    const map = new Map<string, Source[]>();
    for (const s of sources ?? []) map.set(s.subject, [...(map.get(s.subject) ?? []), s]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sources]);

  const patchUpload = (key: number, patch: Partial<UploadItem>) =>
    setUploads(prev => prev.map(u => (u.key === key ? { ...u, ...patch } : u)));

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const trimmed = subject.trim();
      if (!trimmed) {
        setSubjectError('Enter a subject first so the material is organised');
        return;
      }
      setSubjectError('');
      try {
        localStorage.setItem(SUBJECT_KEY, trimmed);
      } catch {
        /* storage unavailable */
      }

      for (const file of files) {
        const key = nextKey.current++;
        const ext = `.${fileExtension(file.name)}`;
        if (!ACCEPTED_EXTENSIONS.includes(ext)) {
          setUploads(prev => [...prev, { key, name: file.name, progress: 0, state: 'error', message: `${ext === '.' ? 'This file type' : ext} is not supported. Use PDF, PPTX, DOCX, TXT or MD.` }]);
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          setUploads(prev => [...prev, { key, name: file.name, progress: 0, state: 'error', message: 'Larger than the 20 MB limit' }]);
          continue;
        }
        setUploads(prev => [...prev, { key, name: file.name, progress: 0, state: 'uploading' }]);
        try {
          const { source, duplicate } = await api.sources.upload(file, trimmed, fraction => {
            patchUpload(key, { progress: fraction, state: fraction >= 1 ? 'processing' : 'uploading' });
          });
          if (source.status === 'failed') {
            patchUpload(key, { progress: 1, state: 'error', message: source.error ?? 'Processing failed' });
          } else {
            patchUpload(key, { progress: 1, state: 'done', message: duplicate ? 'Already uploaded — showing the existing copy' : undefined });
          }
          await load();
        } catch (err) {
          patchUpload(key, { state: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
        }
      }
    },
    [subject, load]
  );

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) uploadFiles(files);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) uploadFiles(files);
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.sources.delete(deleting.id);
      setSources(prev => (prev ?? []).filter(s => s.id !== deleting.id));
      toast('Source deleted. Concepts made from it keep their text.', { variant: 'success' });
      setDeleting(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the source', { variant: 'error' });
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-ink-dim">// STUDY MATERIAL</p>
        <h1 className="mt-1 font-display text-3xl font-black uppercase tracking-[0.06em] text-chrome">Sources</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-dim">
          Upload what you study. The app reads it, builds an outline and picks out key terms and definitions, each linked back to its page or slide. You choose which ones become concepts.
        </p>
      </div>

      <TerminalPanel title="UPLOAD.EXE">
        <div className="space-y-4">
          <div className="max-w-sm">
            <Input
              label="Subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              list="source-subjects"
              placeholder="e.g. Databases"
              error={subjectError}
              maxLength={100}
            />
            <datalist id="source-subjects">
              {subjects.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Upload files: drop them here or press Enter to choose"
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), inputRef.current?.click())}
            onDragOver={e => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
              'focus-visible:outline-none focus-visible:shadow-[var(--glow-cyan)]',
              dragging ? 'border-magenta bg-magenta/10' : 'border-line hover:border-cyan'
            )}
          >
            <UploadCloud className="h-8 w-8 text-magenta" aria-hidden="true" />
            <p className="text-sm font-medium text-ink">Drop files here, or choose files</p>
            <p className="font-mono text-[11px] text-ink-dim">PDF · PPTX · DOCX · TXT · MD — up to 20 MB and 300 pages</p>
            <span className="mt-1 rounded-md border border-line px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-ink">Choose files</span>
            <input ref={inputRef} type="file" multiple accept={ACCEPTED_EXTENSIONS.join(',')} onChange={onPick} className="sr-only" tabIndex={-1} aria-hidden="true" />
          </div>

          {uploads.length > 0 && (
            <ul className="space-y-2" aria-label="Uploads">
              {uploads.map(u => (
                <li key={u.key} className="rounded border border-line bg-night p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">{u.name}</span>
                    <span
                      className={cn(
                        'shrink-0 font-mono text-[11px] uppercase tracking-wider',
                        u.state === 'error' ? 'text-due' : u.state === 'done' ? 'text-strong' : 'text-ink-dim'
                      )}
                    >
                      {u.state === 'uploading' ? `Uploading ${Math.round(u.progress * 100)}%` : u.state === 'processing' ? 'Reading document…' : u.state === 'done' ? 'Done' : 'Failed'}
                    </span>
                  </div>
                  {(u.state === 'uploading' || u.state === 'processing') && (
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${u.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(u.progress * 100)}
                      className="mt-2 h-1.5 overflow-hidden rounded bg-panel-hi"
                    >
                      <div className={cn('h-full bg-magenta transition-[width]', u.state === 'processing' && 'animate-pulse')} style={{ width: `${u.progress * 100}%` }} />
                    </div>
                  )}
                  {u.message && <p role={u.state === 'error' ? 'alert' : undefined} className={cn('mt-2 text-xs', u.state === 'error' ? 'text-due' : 'text-ink-dim')}>{u.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </TerminalPanel>

      {error ? (
        <TerminalPanel title="SIGNAL_LOST.EXE">
          <div role="alert" className="space-y-3 py-4 text-center">
            <p className="text-sm text-ink-dim">{error}</p>
            <Button onClick={load}><RotateCcw className="h-4 w-4" aria-hidden="true" />Retry</Button>
          </div>
        </TerminalPanel>
      ) : sources === null ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : sources.length === 0 ? (
        <TerminalPanel title="EMPTY.EXE">
          <EmptyState title="No sources yet" body="Upload lecture notes, slides or a chapter above. Each one gets an outline and a list of key terms." />
        </TerminalPanel>
      ) : (
        grouped.map(([group, items]) => (
          <section key={group} aria-labelledby={`subject-${group}`} className="space-y-3">
            <h2 id={`subject-${group}`} className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-ink-dim">
              {group} · {items.length}
            </h2>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
              {items.map(s => {
                const st = STATUS[s.status];
                const Icon = s.kind === 'pptx' ? Presentation : FileText;
                const units = unitLabel(s);
                return (
                  <li key={s.id} className="group relative min-w-0 rounded-lg border border-line bg-panel/85 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] transition-[border-color] hover:border-magenta/60">
                    <div className="flex items-start gap-3 pr-8">
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-cyan" aria-hidden="true" />
                      <div className="min-w-0 flex-1 space-y-2">
                        {s.status === 'ready' ? (
                          <Link href={`/sources/${s.id}`} className="block truncate text-sm font-semibold text-ink after:absolute after:inset-0 hover:text-magenta">
                            {s.title}
                          </Link>
                        ) : (
                          <p className="truncate text-sm font-semibold text-ink">{s.title}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <StatusPill status={st.pill} label={st.label} />
                          <Badge size="sm">{s.kind === 'text' ? 'txt/md' : s.kind}</Badge>
                          <span className="font-mono text-[11px] text-ink-dim">{[units, sizeLabel(s.byteSize)].filter(Boolean).join(' · ')}</span>
                        </div>
                        {s.status === 'failed' && s.error && <p role="alert" className="text-xs text-due">{s.error}</p>}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete source: ${s.title}`}
                      onClick={() => setDeleting(s)}
                      className="absolute right-1 top-1 z-10 flex h-10 w-10 items-center justify-center rounded text-neutral-400 hover:text-due focus-visible:text-due"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => !deleteBusy && setDeleting(null)}
        title="CONFIRM_DELETE.EXE"
        description="This deletes the uploaded file, its outline and its detected terms. Concepts you already made from it are kept, but lose their link to the source."
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={deleteBusy}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleteBusy}>Delete</Button>
          </>
        }
      >
        <p className="rounded border border-line bg-night p-3 text-sm text-ink">{deleting?.title}</p>
      </Dialog>
    </div>
  );
}
