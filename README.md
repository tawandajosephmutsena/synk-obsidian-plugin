# Synkk Team Vault Sync

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Obsidian Min Version](https://img.shields.io/badge/Obsidian-0.15.0+-purple.svg)](https://obsidian.md)
[![Platform](https://img.shields.io/badge/Platform-Desktop%20%7C%20iOS%20%7C%20Android-green.svg)](https://obsidian.md)

**Synkk Team Vault Sync** is an Obsidian plugin that provides end-to-end synchronization between Obsidian vaults and your self-hosted or managed [Synkk](https://github.com/synkk/synkk) server.

Designed specifically for teams and distributed organizations, Synkk allows multi-user collaboration with role-based access control, path-level permissions, and background synchronization across **Desktop (macOS, Windows, Linux)** and **Mobile (iOS, Android)**.

---

## Features

- **Cross-Platform**: Seamless synchronization on macOS, Windows, Linux, iPhone, iPad, and Android.
- **Self-Hosted & Private**: Connect to your organization's own Synkk backend with zero third-party telemetry.
- **Team-Aware**: Manage role-based access (read, write, admin) and path-scoped restrictions.
- **Background & Startup Sync**: Automatically sync changes in configurable intervals (1, 2, 5, 10, or 30 minutes) or immediately upon app startup.
- **Conflict Handling**: Reliable SHA-256 fingerprinting and timestamp-based conflict tracking.

---

## Installation

### Method 1: Obsidian Community Plugins (Official)

Once listed in the Obsidian Community Plugins directory:

1. Open Obsidian on your computer or mobile phone.
2. Go to **Settings → Community plugins**.
3. Turn off **Restricted mode** if enabled.
4. Click **Browse** and search for **Synkk Team Vault Sync**.
5. Click **Install**, then **Enable**.

---

### Method 2: Via BRAT (Recommended for Beta / Internal Team Installs)

If your team needs immediate access before official directory approval or for private builds:

1. In Obsidian, go to **Settings → Community plugins → Browse**.
2. Search for **BRAT** (*Obsidian42 - BRAT*) and install/enable it.
3. Open **Settings → BRAT**.
4. Click **Add Beta plugin**.
5. Paste the GitHub repository URL of this plugin:
   ```text
   https://github.com/<your-org>/obsidian-synkk-sync
   ```
6. BRAT will automatically download `manifest.json`, `main.js`, and `styles.css`, enable the plugin, and keep it updated on team phones and desktops.

---

### Method 3: Manual Installation

1. Download `manifest.json`, `main.js`, and `styles.css` from the [Latest Release](https://github.com/<your-org>/obsidian-synkk-sync/releases/latest).
2. Create a folder in your vault: `<vault-root>/.obsidian/plugins/synkk-sync/`.
3. Place the downloaded files into that folder.
4. Reload Obsidian and enable **Synkk Team Vault Sync** in **Settings → Community plugins**.

---

## Configuration

1. In Obsidian, navigate to **Settings → Synkk Vault Sync**.
2. **Server API URL**: Enter your Synkk instance endpoint (e.g., `https://synkk.yourdomain.com/api/v1`).
3. **Device Sync Token**: Enter the device token generated from your user profile on the Synkk web dashboard.
4. Click **Verify & Load Vaults** to test the connection and authenticate your device.
5. Under **Target Vault**, select the team vault assigned to you.
6. (Optional) Configure **Automatic Background Sync** and **Sync Interval**.

---

## Development & Building

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/<your-org>/obsidian-synkk-sync.git
cd obsidian-synkk-sync
npm install
```

### Development Mode

Runs esbuild with file watching:
```bash
npm run dev
```

### Production Build

Minifies and bundles into `main.js`:
```bash
npm run build
```

### Releasing a New Version

```bash
npm version patch # or minor / major
git push origin main --tags
```
The automated GitHub Actions workflow will build the bundle and attach `main.js`, `manifest.json`, and `styles.css` directly to the GitHub Release.

---

## License

This project is licensed under the [MIT License](LICENSE).
