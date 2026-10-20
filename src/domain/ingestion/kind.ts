import type { SourceKind } from './types.ts';

const EXTENSIONS: Record<string, SourceKind> = {
  pdf: 'pdf',
  pptx: 'pptx',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
};

export const ACCEPTED_EXTENSIONS = Object.keys(EXTENSIONS).map(e => `.${e}`);

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Picks the kind from the file extension and checks the leading bytes, because the client-supplied MIME type
 * and name cannot be trusted. Returns null when the type is unsupported or the content does not match its name.
 */
export function detectKind(filename: string, head: Uint8Array): SourceKind | null {
  const kind = EXTENSIONS[fileExtension(filename)];
  if (!kind) return null;
  const startsWith = (sig: number[]) => sig.every((b, i) => head[i] === b);
  if (kind === 'pdf') return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) ? kind : null; // %PDF-
  if (kind === 'pptx' || kind === 'docx') return startsWith([0x50, 0x4b]) ? kind : null; // PK (zip)
  return head.includes(0) ? null : kind; // text files must not contain NUL bytes
}
