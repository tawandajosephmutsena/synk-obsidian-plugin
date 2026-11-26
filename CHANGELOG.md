# Changelog

All notable changes to this project will be documented in this file.

## [1.1.1] - 2026-11-24

### Changed
- Bumped `minAppVersion` to `1.7.2` to align with current Obsidian Community Plugin review requirements.
- Replaced inline `.style.display = 'none'` toggles with `.synkk-hidden` CSS utility classes across `main.ts`, `conflictResolver.ts`, and `styles.css`.
- Awaited `workspace.revealLeaf()` when opening the AI sidebar, used `createSpan()` helpers in `aiSidebarView.ts`, and tightened TypeScript type definitions for Obsidian automated plugin review compliance.

## [1.1.0] - 2026-11-22

### Added
- **Dockable Synkk AI Sidebar (`SynkkAiSidebarView`):** Streaming Cloud Copilot threads over Reverb (with HTTP polling fallback), active-note context toggle, clickable `[[wikilink]]` citation chips, copy/insert/save-as-note actions, and automatic fallback to Local AI on E2EE vaults.
- **AI Change Inbox (`AiProposalsModal`) & Vault Gardener:** Review proposed AI edits (`create`, `update`, `append`, `move`, `delete`, `rename`, `tag`) with colored line diffs, staleness detection, optional override editing, and 1-click **Approve & Sync** or **Reject**, plus a live pending proposals status bar badge.
- **AI Smart Merge:** Integrated semantic conflict merge inside the Visual Conflict Sandbox (routes to server `/conflicts/smart-merge` on standard vaults and Local AI on E2EE vaults).
- **Zero-Knowledge E2EE Local AI (`LocalAiEngine`):** Pure-JS BM25 + 1-hop `[[wikilink]]` graph retrieval querying user-hosted Ollama (`llama3.2`) or OpenAI-compatible (LM Studio / LocalAI / BYOK) endpoints directly from Obsidian.

## [1.0.12] - 2026-10-06

### Fixed
- **Device credential privacy:** Always keep Synkk's own plugin data files, including credential backups and conflict copies, out of outgoing and incoming vault sync when full plugin suite sync is enabled.
- **First-run pairing:** Clear a prior vault selection when a pairing session has no target vault, explain the next setup step, and wait to sync until a vault is selected.

## [1.0.11] - 2026-09-23

### Fixed
- **Cross-Note Contamination:** Resolved severe issue where switching notes or creating new notes could cause content from previously viewed notes to be copied or overwritten. Disabled the CodeMirror 6 collaboration extension by default (`realtimeCollaboration: false`) and eliminated destructive document replacement in `collabRelay.ts`.
- **Text Duplication:** Fixed CodeMirror `ySync` double-seeding race condition that previously caused repeated blocks and text doubling (1x → 2x → 4x) inside notes on switch or load.
- **Deletion Sync Overwrites:** Fixed sync engine Step 3 conflict behavior where remote corrupted notes overwrote local user deletions and edits. Incoming conflicting remote versions are now safely routed to `.sync-conflict-<timestamp>.md`, ensuring the user's active file and local deletions are preserved intact.
- **Base Version Resolution:** Fixed batch-sync `base_version` resolution to reference remote manifest versions, allowing local edits to push cleanly to the server without false 409 conflict rejections.
- **Sync Version Tracking:** Step 6 now tracks the highest pushed version from batch upload responses, preventing stale manifest re-pulls.
- **Type Safety & Linting:** Eliminated `any` type casts and removed redundant non-null assertions in `collabRelay.ts`.

## [1.0.10] - 2026-09-23

### Fixed
- Initial fixes for cross-note data contamination and CodeMirror live collaboration isolation.

## [1.0.9] - 2026-09-22

### Added
- Path-based editor view lookup and isolation in collaboration relay.
- Added user-facing setting toggle for Real-Time Collaboration (CRDT Multiplayer), defaulting to disabled for atomic vault sync stability.

## [1.0.8] - 2026-09-17

### Fixed
- **Security:** Resolved a TypeScript gate error and prevented the `e2eePassphrase` from being persisted to disk.

### Changed
- Refreshed package dependencies and package-lock logic for stable testing/building.
