import { App, Modal, Notice } from 'obsidian';
import type SynkkPlugin from './main';
import { parsePairingPayload, handlePairingProtocol } from './pairing';

interface BarcodeResult {
  rawValue?: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<BarcodeResult[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

export class SynkkPairingModal extends Modal {
  private plugin: SynkkPlugin;
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private scanTimer: number | null = null;
  private isProcessing: boolean = false;

  constructor(app: App, plugin: SynkkPlugin) {
    super(app);
    this.plugin = plugin;
  }

  public onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('synkk-pairing-modal');

    // Modal Title
    contentEl.createEl('h2', {
      text: '⚡ Instant QR Pairing',
      cls: 'synkk-pairing-modal-title',
    });

    contentEl.createEl('p', {
      text: 'Scan the QR code on your Synkk desktop dashboard, choose a screenshot, or paste your pairing link.',
      cls: 'synkk-pairing-modal-sub',
    });

    // Camera Viewfinder Container
    const scannerContainer = contentEl.createDiv({ cls: 'synkk-camera-container' });
    this.videoEl = scannerContainer.createEl('video', { cls: 'synkk-camera-video' });
    this.videoEl.autoplay = true;
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;

    // Viewfinder Reticle Overlay
    const overlay = scannerContainer.createDiv({ cls: 'synkk-camera-overlay' });
    overlay.createDiv({ cls: 'synkk-camera-reticle' });
    const statusText = scannerContainer.createEl('p', {
      text: 'Starting camera viewfinder…',
      cls: 'synkk-camera-status',
    });

    // Start live camera stream
    this.startCamera(statusText);

    // Fallback & Alternative Action Buttons
    const actionRow = contentEl.createDiv({ cls: 'synkk-pairing-actions' });

    // 1. Paste from Clipboard Button
    const pasteBtn = actionRow.createEl('button', {
      text: '📋 Paste from Clipboard',
      cls: 'mod-cta synkk-pairing-btn',
    });
    pasteBtn.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text?.trim()) {
          new Notice('Clipboard is empty.');
          return;
        }
        await this.processPayloadString(text.trim());
      } catch (err) {
        new Notice('Unable to read clipboard. Please paste manually below.');
      }
    };

    // 2. Select QR Image / Screenshot Button
    const fileLabel = actionRow.createEl('label', {
      text: '🖼️ Select Image / Photo',
      cls: 'synkk-pairing-btn mod-muted',
    });
    const fileInput = fileLabel.createEl('input', {
      type: 'file',
      attr: { accept: 'image/*' },
      cls: 'synkk-hidden-input',
    });
    fileInput.onchange = async (e) => {
      const target = e.target as HTMLInputElement;
      const file = target?.files?.[0];
      if (file) {
        await this.scanImageFile(file);
      }
    };

    // 3. Manual URL / Token Input Container
    const manualContainer = contentEl.createDiv({ cls: 'synkk-manual-pairing-box' });
    const manualInput = manualContainer.createEl('input', {
      type: 'text',
      placeholder: 'obsidian://synkk-pair?... or https://synkk.space/pair?...',
      cls: 'synkk-manual-input',
    });

    const manualSubmitBtn = manualContainer.createEl('button', {
      text: 'Pair Device',
      cls: 'synkk-manual-btn',
    });
    manualSubmitBtn.onclick = async () => {
      const val = manualInput.value.trim();
      if (!val) {
        new Notice('Please enter a pairing URL, session JSON, or token.');
        return;
      }
      await this.processPayloadString(val);
    };
  }

  private async startCamera(statusText: HTMLParagraphElement): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      statusText.setText('Camera is not supported on this device. Use image upload or paste below.');
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
      });

      if (this.videoEl) {
        this.videoEl.srcObject = this.stream;
        await this.videoEl.play();
        statusText.setText('Point camera at Synkk desktop dashboard QR code…');
        this.beginScanningLoop(statusText);
      }
    } catch (err: unknown) {
      statusText.setText('Camera access unavailable. Use "Select Image" or "Paste from Clipboard" below.');
    }
  }

  private beginScanningLoop(statusText: HTMLParagraphElement): void {
    if (typeof window === 'undefined' || !window.BarcodeDetector) {
      statusText.setText('Auto-scan unavailable in this view. Use image select or paste below.');
      return;
    }

    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    this.scanTimer = window.setInterval(async () => {
      if (this.isProcessing || !this.videoEl || this.videoEl.readyState < 2) return;

      try {
        const barcodes = await detector.detect(this.videoEl);
        if (barcodes && barcodes.length > 0) {
          const raw = barcodes[0].rawValue;
          if (raw) {
            this.isProcessing = true;
            statusText.setText('⚡ QR Detected! Linking device…');
            if (navigator.vibrate) {
              navigator.vibrate(100);
            }
            await this.processPayloadString(raw);
          }
        }
      } catch {
        // Continue detection on next interval tick
      }
    }, 300);
  }

  private async scanImageFile(file: File): Promise<void> {
    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      try {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await img.decode();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await detector.detect(img);
        URL.revokeObjectURL(img.src);
        if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
          await this.processPayloadString(barcodes[0].rawValue);
          return;
        }
      } catch (e) {
        // Fall back to notice
      }
    }
    new Notice('Could not detect a valid Synkk QR code in selected image.');
  }

  private async processPayloadString(raw: string): Promise<void> {
    const parsed = parsePairingPayload(raw);
    if (!parsed) {
      new Notice('Unrecognized pairing data. Please check the URL or QR code.');
      this.isProcessing = false;
      return;
    }

    this.close();

    // If it's a pairing session exchange
    if (parsed.type === 'synkk-pairing-session' && parsed.session && parsed.server) {
      await handlePairingProtocol(this.plugin, parsed);
      return;
    }

    // Direct token string configuration
    if (parsed.token) {
      this.plugin.settings.deviceToken = parsed.token;
      if (parsed.server) {
        this.plugin.settings.serverUrl = parsed.server;
      }
      if (parsed.vault) {
        this.plugin.settings.selectedVaultSlug = parsed.vault;
      }
      await this.plugin.saveSettings();
      this.plugin.apiClient.updateConfig(this.plugin.settings.serverUrl, this.plugin.settings.deviceToken);

      try {
        const authRes = await this.plugin.apiClient.verifyAuth();
        new Notice(`⚡ Synkk Paired! Connected as ${authRes.user.name} (${authRes.team.name}).`, 7000);
      } catch {
        new Notice('⚡ Device token saved! Please verify connection in settings.', 6000);
      }
    }
  }

  public onClose(): void {
    if (this.scanTimer !== null) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    const { contentEl } = this;
    contentEl.empty();
  }
}
