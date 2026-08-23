import { describe, expect, it } from "vitest";
import { presentDetectedContext } from "./windowPresentation";

const base = {
  applicationId: "app:code.exe",
  applicationName: "Visual Studio Code",
  executableName: "Code.exe",
  rawTitle: "main.ts — SelfRelay — Visual Studio Code",
  adapterId: "vscode",
  contextId: "vscode:selfrelay",
  contextLabel: "SelfRelay",
  stability: "stable" as const,
  foreground: true,
};

describe("presentDetectedContext", () => {
  it("shows the application and derived work context", () => {
    expect(presentDetectedContext(base)).toEqual({
      primary: "Visual Studio Code",
      secondary: "SelfRelay",
      badge: "Contexto",
    });
  });

  it("labels generic fallback identity honestly", () => {
    expect(presentDetectedContext({ ...base, adapterId: "generic", stability: "fallback" })).toMatchObject({
      badge: "Aplicación",
    });
  });
});
