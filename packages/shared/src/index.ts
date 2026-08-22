export type ContextType = 'browser' | 'desktop';
export type BrowserContextScope = 'tab' | 'url' | 'site';
export type LocalTranscriptionEngine = 'browser-local' | 'whisper-local';

export interface ContextBase {
  id: string;
  userId?: string | null;
  type: ContextType;
  contextKey: string;
  title: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * One explicitly selected page inside a browser work context.
 * Optional on BrowserContext so all pre-workset contexts remain valid without migration.
 */
export interface BrowserContextMember {
  id: string;
  url: string;
  title: string;
  faviconUrl: string | null;
  order: number;
  addedAt: string;
}

export interface BrowserContext extends ContextBase {
  type: 'browser';
  scope: BrowserContextScope;
  url: string;
  origin: string;
  faviconUrl: string | null;
  trackedTabId: number | null;
  /**
   * Present only for explicitly assembled multi-tab/single-tab worksets.
   * Legacy tab/url/site contexts omit this field and preserve their historical matching semantics.
   */
  members?: BrowserContextMember[];
}

export interface DesktopContext extends ContextBase {
  type: 'desktop';
  executablePath: string;
}

export type SelfRelayContext = BrowserContext | DesktopContext;

export interface Checkpoint {
  id: string;
  userId?: string | null;
  contextId: string;
  /** User-authored text. May be empty for an audio-only checkpoint. */
  originalText: string;
  /** IndexedDB asset key. Optional so pre-audio checkpoints remain valid without migration. */
  audioRef?: string | null;
  audioMimeType?: string | null;
  audioDurationMs?: number | null;
  transcript?: string | null;
  transcriptionEngine?: LocalTranscriptionEngine | null;
  /**
   * Omitted/null means the whole context. A non-empty list limits recovery to the selected workset members.
   * A one-item list is the explicit per-tab form. Legacy checkpoints omit this field.
   */
  targetMemberIds?: string[] | null;
  structuredSummary?: {
    progress?: string;
    blocker?: string;
    nextStep?: string;
  } | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface PendingCapture {
  id: string;
  contextId: string;
  url: string;
  title: string;
  closedAt: string;
  /** Workset member that was last active/closed when known. */
  memberId?: string | null;
  /** Internal idempotency key used to avoid duplicate shutdown recovery. */
  sourceKey?: string;
}

export interface BrowserTabSnapshot {
  tabId: number;
  /** Present for snapshots captured by current extension builds. Optional for backward compatibility with old session data. */
  windowId?: number;
  contextId: string;
  /** Workset member matched by this tab, absent on legacy contexts. */
  memberId?: string | null;
  url: string;
  title: string;
  faviconUrl?: string | null;
  capturedAt: string;
}
