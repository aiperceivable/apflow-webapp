# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-10-28

### Added

- Discover available executor suggestions from the connected server, while
  allowing custom executor IDs to be entered manually.

### Changed

- Create tasks using `params.executor_id`, as supported by apflow 0.24.1.
  Legacy `schemas.method` is converted to the executor ID; other schema fields
  are rejected because the REST creation API does not preserve them.
- Retry failed root tasks with `run.retry`, submit the new root for durable
  execution, and open the new task. Direct execution and retry controls are
  hidden for child tasks.
- Move notifications to the bottom right so they do not obscure task controls.

### Compatibility

- Durable retries require a server exposing `run.retry` and `task.submit` and
  an active dispatcher. Older servers without these modules cannot use retry.

## [0.2.2] - 2026-07-18

### Removed

- **`apflow-demo` demo feature.** The `apflow-demo` project has been archived
  and its online demo shut down, so all demo-specific
  functionality has been removed from the webapp:
  - "Demo Mode" toggle in the sidebar and the `use_demo` flag passed to task
    execution (`UseDemoContext` removed).
  - Demo task initialization — the "Initialize Demo Tasks" alerts/buttons on the
    Dashboard and Task List, plus the `checkDemoInitStatus()` and
    `initDemoTasks()` API client methods.
  - The unused `.demo-mode-block` styles and related demo UI strings.

### Changed

- Reframed authentication docs, comments, and i18n strings so that cookie-based
  auto-login is described as a general, optional mechanism rather than an
  `apflow-demo` feature.
- `package.json` description updated to `apflow version>=0.12.0`.

### Notes

- **Auto-login is retained.** The optional cookie-based auth path
  (`NEXT_PUBLIC_AUTO_LOGIN_PATH`, off by default) is a general feature
  independent of the demo and is unaffected by this change.

## [0.2.1] - 2026-03-22

### Changed

- Rebranded `aipartnerup` → `aiperceivable`.
