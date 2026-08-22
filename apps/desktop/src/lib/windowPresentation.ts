import type { DetectedContext } from "../types";

export interface WindowPresentation {
  primary: string;
  secondary: string | null;
  badge: string;
}

export function presentDetectedContext(context: DetectedContext): WindowPresentation {
  const secondary = context.contextLabel.trim() && context.contextLabel !== context.applicationName
    ? context.contextLabel.trim()
    : null;
  return {
    primary: context.applicationName,
    secondary,
    badge: context.adapterId === "generic" ? "Aplicación" : "Contexto",
  };
}
