# SelfRelay — CoderCup delivery guide

This document defines how SelfRelay should be presented to CoderCup evaluators and normal users.

## One project, two downloadable products

SelfRelay remains one project and one source repository. The products are distributed independently:

### Chrome Extension

Asset:

`SelfRelay-Chrome.zip`

Use:

`download → extract → chrome://extensions → Developer mode → Load unpacked → choose SelfRelay folder`

### Windows Desktop

Asset:

`SelfRelay-Setup.exe`

Use:

`download → double click → install → open SelfRelay`

An evaluator should never need to browse `apps/extension` or `apps/desktop` merely to run the product.

## Where downloads live

Stable downloads belong in **GitHub Releases**.

Do not use these as final evaluator links:

- GitHub Actions artifacts — temporary/expiring validation output.
- `Code → Download ZIP` — monorepo source code, not the product.
- `artifacts/chrome-extension-unpacked` — historical extension reference.

## Desired repository landing page

The README should make this hierarchy immediately visible:

1. What problem SelfRelay solves.
2. Download for Chrome.
3. Download for Windows.
4. Installation steps requiring no terminal.
5. Product demo / presentation video.
6. Technical source layout for reviewers who want it.

## Stable release shape

Once Windows Desktop is validated, the preferred stable Release is:

```text
SelfRelay

Assets
├── SelfRelay-Chrome.zip
└── SelfRelay-Setup.exe
```

Both artifacts may share one Release because they are two surfaces of the same SelfRelay product. The evaluator chooses the one they want to test.

## Video-friendly explanation

The presentation should be able to explain installation in a few seconds:

> SelfRelay is available for Chrome and Windows. Open the GitHub Release, download the version you want, and run it without building the project.

For Chrome, briefly show extraction and Load unpacked. For Windows, show the normal installer.

## Product demo priority

The demo should focus on the product loop rather than installation details:

`context → exit → checkpoint → return → automatic recovery`

Recommended Chrome sequence:

`follow work context → leave/close → save checkpoint → return → recover unresolved context`

Recommended Windows sequence:

`VS Code work context → exit → SelfRelay capture → save checkpoint → reopen same work context → automatic recovery`

## Release checklist

Before sharing final links:

- repository/evaluator access confirmed;
- stable Release exists;
- `SelfRelay-Chrome.zip` is the physically validated Chrome build;
- `SelfRelay-Setup.exe` is the physically validated Windows installer;
- no final link points to an expiring Actions artifact;
- README installation instructions match the actual packages;
- download and install are tested from a clean user perspective;
- presentation video uses the same stable release build the evaluator can download.
