import { App, Notice, Platform } from 'obsidian';
import { SynkkApiClient } from './apiClient';
import { TransportStatus } from './types';

export class BackgroundSyncRelay {
  private app: App;
  private api: SynkkApiClient;
  private getVaultSlug: () => string;
  private onTriggerSync: () => Promise<void>;
  private isRunning: boolean = false;
  private timerId: number | null = null;
  private lastKnownVersion: number = 0;

  constructor(
    app: App,
    api: SynkkApiClient,
    getVaultSlug: () => string,
    onTriggerSync: () => Promise<void>
  ) {
    this.app = app;
    this.api = api;
    this.getVaultSlug = getVaultSlug;
    this.onTriggerSync = onTriggerSync;
  }

  public start(intervalSeconds: number = 60): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Adaptive interval: on mobile, relax background polling to 90s to conserve battery; on desktop 30s
    const effectiveInterval = Platform.isMobile ? Math.max(intervalSeconds, 60) : intervalSeconds;

    this.timerId = window.setInterval(() => {
      void this.pollTransportRelay();
    }, effectiveInterval * 1000);

    // Also register app resume / visibility change on mobile
    if (Platform.isMobile && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }

    if (Platform.isMobile && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      // Mobile app returned to foreground: check relay immediately
      void this.pollTransportRelay();
    }
  };

  public async pollTransportRelay(): Promise<TransportStatus | null> {
    const slug = this.getVaultSlug();
    if (!slug) return null;

    try {
      const status = await this.api.getTransportStatus(slug);

      // If remote revision has advanced beyond last known version, trigger background sync
      if (status.latest_version > this.lastKnownVersion && this.lastKnownVersion > 0) {
        new Notice(`Synkk Relay: New revisions detected (v${status.latest_version}). Syncing in background...`, 3000);
        await this.onTriggerSync();
      }

      this.lastKnownVersion = status.latest_version;
      return status;
    } catch {
      // Offline or network error: gracefully ignore in background relay
      return null;
    }
  }

  public setLastKnownVersion(version: number): void {
    this.lastKnownVersion = version;
  }
}
