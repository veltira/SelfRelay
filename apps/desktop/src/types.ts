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
}

export interface TrackedApplication {
  applicationId: string;
  applicationName: string;
  executablePath?: string | null;
}

export interface DiscoveredApplication extends TrackedApplication {
  executableName?: string | null;
  aliases: string[];
  packageFamilyName?: string | null;
  appUserModelId?: string | null;
  running: boolean;
  foreground: boolean;
}

export interface ApplicationIcon {
  width: number;
  height: number;
  rgba: number[];
  fallback: boolean;
}

export interface WorksetOption {
  id: string;
  name: string;
}

export interface CaptureView {
  id: string;
  applicationId: string;
  applicationName: string;
  contextId: string;
  contextLabel: string;
  createdAtMs: number;
  worksets: WorksetOption[];
}

export interface CheckpointRecord {
  id: number;
  applicationId: string;
  applicationName: string;
  contextId: string;
  contextLabel: string;
  worksetId?: string | null;
  text: string;
  audioPath?: string | null;
  transcript?: string | null;
  createdAtMs: number;
  resolvedAtMs?: number | null;
}

export interface RecoveryView {
  targetKind: "context" | "workset";
  targetName: string;
  applicationId: string;
  applicationName: string;
  contextId: string;
  contextLabel: string;
  worksetId?: string | null;
  checkpoints: CheckpointRecord[];
}

export interface WorksetView {
  id: string;
  name: string;
  applicationIds: string[];
  active: boolean;
}

export interface SettingsView {
  launchAtStartup: boolean;
  trackingActive: boolean;
  version: string;
  dataDirectory: string;
}
