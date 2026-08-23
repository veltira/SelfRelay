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
path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
print("Repaired Desktop 0.2.4 finalizer matcher")
