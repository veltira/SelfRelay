from pathlib import Path

path = Path(__file__).resolve().parents[3] / "scripts" / "finalize_desktop_024.py"
text = path.read_text(encoding="utf-8")
lines = text.splitlines()
replaced = False
for index, line in enumerate(lines):
    if '"desktop ci final push"' in line:
        lines[index] = "s = s.replace('      - \\\"desktop/**\\\"\\n    paths:', '      - \\\"desktop/**\\\"\\n      - \\\"final/**\\\"\\n    paths:')"
        replaced = True
        break
if not replaced:
    raise SystemExit("desktop-ci finalizer matcher was not found")
text = "\n".join(lines) + "\n"

# GitHub Actions' GITHUB_TOKEN has contents:write but cannot push changes to
# .github/workflows without the separate workflows permission. Keep the
# validated application patch intact and defer the package-workflow edit to
# the authenticated repository write after source persistence.
start_marker = "# ---------- package workflow / upgrade scripts ----------\n"
end_marker = 'for path in ["apps/desktop/scripts/upgrade-qa.ps1", "apps/desktop/scripts/installed-webview-smoke.ps1"]:\n'
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("desktop-package finalizer block was not found")
text = (
    text[:start]
    + "# ---------- package workflow edit deferred until after source persistence ----------\n"
    + text[end:]
)

path.write_text(text, encoding="utf-8", newline="\n")
print("Repaired Desktop 0.2.4 finalizer matcher and deferred workflow-file persistence")
