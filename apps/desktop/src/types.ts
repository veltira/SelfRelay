export type ContextStability = "stable" | "fallback";

export interface DetectedContext {
  applicationId: string;
  applicationName: string;
  executableName: string;
  rawTitle: string;
  adapterId: string;
  contextId: string;
  contextLabel: string;
  stability: ContextStability;
  foreground: boolean;
}

export interface TrackingStatus {
  active: boolean;
  observer: "win32" | "unsupported";
}

export interface TrackedApplication {
  applicationId: string;
  applicationName: string;
  executablePath?: string | null;
}

export interface DiscoveredApplication extends TrackedApplication {
  running: boolean;
  foreground: boolean;
}

export interface ContextSnapshot {
  applicationId: string;
  applicationName: string;
  contextId: string;
  contextLabel: string;
}

export interface CheckpointRecord {
  id: number;
  applicationId: string;
  applicationName: string;
  contextId: string;
  contextLabel: string;
  text: string;
  createdAtMs: number;
  resolvedAtMs?: number | null;
}

export interface RecoveryView extends ContextSnapshot {
  checkpoints: CheckpointRecord[];
}
