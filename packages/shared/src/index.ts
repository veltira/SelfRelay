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

/** One explicitly selected logical page inside a browser work context. */
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
  /** Present only for explicitly assembled worksets. Legacy tab/url/site contexts omit it. */
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
  /** Null/omitted means the whole context. Non-empty limits recovery to those workset members. */
  targetMemberIds?: string[] | null;
  structuredSummary?: {
    progress?: string;
    blocker?: string;
    nextStep?: string;
  } | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Immutable member information captured at the moment an exit happens. */
export interface PendingClosedMember {
  memberId: string | null;
  url: string;
  title: string;
  faviconUrl?: string | null;
}

export type PendingExitKind = 'tab' | 'window' | 'shutdown' | 'mixed';

export interface PendingCapture {
  id: string;
  contextId: string;
  url: string;
  title: string;
  closedAt: string;
  /** Legacy compatibility: representative workset member for this pending. */
  memberId?: string | null;
  /** Snapshot of every logical workset member affected by this still-unprocessed exit event. */
  closedMembers?: PendingClosedMember[];
  /** Default targeting for the capture UI. Null means whole context. */
  defaultTargetMemberIds?: string[] | null;
  /** Browser session whose exit events are allowed to aggregate into this pending. */
  exitSessionId?: string;
  exitKind?: PendingExitKind;
  /** Primary historical idempotency key. */
  sourceKey?: string;
  /** Additional source keys folded into an already-visible pending. */
  sourceKeys?: string[];
}

export interface BrowserTabSnapshot {
  tabId: number;
  /** Present for snapshots captured by current extension builds. Optional for backward compatibility. */
  windowId?: number;
  contextId: string;
  /** Workset member matched by this tab, absent on legacy contexts. */
  memberId?: string | null;
  url: string;
  title: string;
  faviconUrl?: string | null;
  capturedAt: string;
}
