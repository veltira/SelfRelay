import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const desktop = path.resolve(import.meta.dirname, "..");
const root = path.resolve(desktop, "../..");
const output = path.join(root, "artifacts", "desktop-visual-qa");
await mkdir(output, { recursive: true });

const viteBin = path.join(desktop, "node_modules", "vite", "bin", "vite.js");
const preview = spawn(process.execPath, [viteBin, "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  cwd: desktop,
  stdio: ["ignore", "pipe", "pipe"],
});

let previewError = "";
preview.stderr.on("data", (chunk) => { previewError += String(chunk); });

async function waitForPreview() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:4173/");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite preview did not start. ${previewError}`);
}

const states = [
  ["01-onboarding", "onboarding", { width: 900, height: 720 }],
  ["02-applications", "applications", { width: 900, height: 720 }],
  ["03-worksets", "worksets", { width: 900, height: 720 }],
  ["04-capture-text-audio", "capture", { width: 520, height: 620 }],
  ["05-recovery-a-b", "recovery", { width: 540, height: 690 }],
  ["06-history", "history", { width: 900, height: 720 }],
];

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  for (const [filename, state, viewport] of states) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("__TAURI_INTERNALS__")) consoleErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:4173/?qa=${state}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(output, `${filename}.png`), fullPage: true });
    if (consoleErrors.length) throw new Error(`${state} emitted console errors: ${consoleErrors.join(" | ")}`);
    await page.close();
  }
  console.log(`SelfRelay Desktop Visual QA PASS: ${states.length} screenshots`);
} finally {
  if (browser) await browser.close();
  preview.kill();
}
