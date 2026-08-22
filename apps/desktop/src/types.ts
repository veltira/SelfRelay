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
