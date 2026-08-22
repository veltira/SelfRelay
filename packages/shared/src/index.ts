export type ContextType = 'browser' | 'desktop';
export type BrowserContextScope = 'tab' | 'url' | 'site';

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

export interface BrowserContext extends ContextBase {
  type: 'browser';
  scope: BrowserContextScope;
  url: string;
  origin: string;
  faviconUrl: string | null;
  trackedTabId: number | null;
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
  originalText: string;
  audioRef?: string | null;
  transcript?: string | null;
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
}

export interface BrowserTabSnapshot {
  tabId: number;
  contextId: string;
  url: string;
  title: string;
  faviconUrl?: string | null;
  capturedAt: string;
}
