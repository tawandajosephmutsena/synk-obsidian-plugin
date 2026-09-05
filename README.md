# Synkk Team Vault Sync

<p align="center">
  <img src="assets/github/synkk-logo.svg" alt="Synkk - Obsidian everywhere" width="360">
</p>

<p align="center">
  <strong>Whole-file team vault sync for Obsidian, powered by a self-hosted Synkk server.</strong>
</p>

<p align="center">
  <a href="https://synkk.ottomate.space">Website</a> ·
  <a href="https://synkk.ottomate.space/docs">Docs</a> ·
  <a href="https://github.com/tawandajosephmutsena/synkk">Server repo</a> ·
  <a href="https://github.com/tawandajosephmutsena/synk-obsidian-plugin/releases/tag/1.0.0">v1.0.0 release</a> ·
  <a href="https://ottomate.space">Ottomate</a>
</p>

![Synkk plugin connected to the web dashboard](assets/github/dashboard-overview.webp)

Synkk Team Vault Sync connects an Obsidian vault to a Synkk team server. It is designed for teams that need private infrastructure, member/device access control, path-specific permissions, and recoverable sync history without turning every user into a Git operator.

## Product Screens

| Web Dashboard | Markdown Editor |
| --- | --- |
| ![Synkk dashboard showing vault health, sync events, and activity](assets/github/dashboard-overview.webp) | ![Synkk Markdown editor showing source mode, outline, and preview](assets/github/editor-full.webp) |

| Graph View | Permissions Matrix |
| --- | --- |
| ![Synkk graph view showing linked notes and graph navigation](assets/github/graph-full.webp) | ![Synkk permissions matrix showing member path access rules](assets/github/permissions-full.webp) |

## Foundation Release Capabilities

- macOS, Windows, Linux, iOS, and Android support through Obsidian's plugin runtime.
- Startup, scheduled, and manual whole-file sync.
- Device tokens, team membership, and path-level `read_write`, `read_only`, and `hidden` permissions through the Synkk server.
- SHA-256 content verification and preserved `*.sync-conflict-*.md` copies for concurrent writes.
- Per-device include/exclude folder rules.
- Optional `.obsidian` syncing for plugin lists, snippets, and plugin data.
- Device-local workspace, hotkeys, caches, and Synkk state so desktop and mobile layouts do not fight each other.
- Atomic Safety Shield with deletion thresholds, one-time override, and local snapshots before remote overwrites/deletions.
- Web Time Machine for server-side file-version rollback.

## Important Limits

This is not CRDT synchronization yet. It does not perform character-level merges, peer-to-peer transport, QR pairing, zero-knowledge client-side encryption, delta attachment transfer, virtual/ghost files, native mobile background execution, or official Obsidian Community Plugins distribution.

The server receives file contents so it can store, authorize, version, and restore them. Deploy Synkk only over HTTPS and on infrastructure you trust.

## Install The GitHub Public Beta

1. Download `main.js`, `manifest.json`, and `styles.css` from the [v1.0.0 release](https://github.com/tawandajosephmutsena/synk-obsidian-plugin/releases/tag/1.0.0).
2. Create `<vault>/.obsidian/plugins/synkk-sync/`.
3. Place the three release files in that directory.
4. In Obsidian, open **Settings -> Community plugins** and enable **Synkk Team Vault Sync**.
5. In **Settings -> Synkk Vault Sync**, enter your HTTPS server URL ending in `/api/v1`, add a device token from Synkk, and choose the target vault.

Synkk is currently distributed through GitHub. Obsidian Community Plugins and BRAT distribution are planned separately.

## Development

```bash
npm ci
npm run build
```

The production command emits `main.js`; release packages also include the committed `manifest.json` and `styles.css`.

## Links

- Public app: [synkk.ottomate.space](https://synkk.ottomate.space)
- Documentation: [synkk.ottomate.space/docs](https://synkk.ottomate.space/docs)
- Server repo: [github.com/tawandajosephmutsena/synkk](https://github.com/tawandajosephmutsena/synkk)
- Plugin repo: [github.com/tawandajosephmutsena/synk-obsidian-plugin](https://github.com/tawandajosephmutsena/synk-obsidian-plugin)
- Creator studio: [Ottomate](https://ottomate.space)
- Commercial license: Lemon Squeezy checkout opens after live checkout and activation verification.
- AppSumo: planned after the public GitHub release path is stable.

## Roadmap

- **Foundation:** selective sync, `.obsidian` controls, Atomic Safety Shield, snapshots, and file-version rollback.
- **Launch hardening:** official onboarding docs, checkout/activation verification, and clearer public release packaging.
- **Next:** QR pairing, encrypted transport design, CRDT collaboration, visual conflict sandbox, virtual files, and smarter attachment sync.
- **Later:** peer-assisted relay transport, native mobile background sync, and folder/team federation.

## Creators

Synkk is created by [Ottomate](https://ottomate.space). Product direction and engineering are led by [Tawanda Joseph Mutsena](https://github.com/tawandajosephmutsena).

## License

The plugin is licensed under the [MIT License](LICENSE).
