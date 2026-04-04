import { Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { TTSSettings, TTSProvider, DEFAULT_SETTINGS, TTSSettingTab } from "./settings";
import { TTSEngine } from "./tts-engine";
import { WebSpeechEngine } from "./web-speech-engine";
import { ElevenLabsEngine } from "./elevenlabs-engine";
import { FishAudioEngine } from "./fish-audio-engine";
import { GoogleTTSEngine } from "./google-tts-engine";
import { AzureTTSEngine } from "./azure-tts-engine";
import { FloatingBar } from "./floating-bar";
import { stripMarkdown } from "./utils";

function encryptSecret(key: string): string {
  if (!key) return "";
  try {
    const { safeStorage } = require("electron");
    if (safeStorage.isEncryptionAvailable()) {
      return "enc:" + safeStorage.encryptString(key).toString("base64");
    }
  } catch { /* safeStorage unavailable */ }
  return key;
}

function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (stored.startsWith("enc:")) {
    try {
      const { safeStorage } = require("electron");
      return safeStorage.decryptString(Buffer.from(stored.slice(4), "base64"));
    } catch {
      return "";
    }
  }
  return stored;
}

const ENCRYPTED_FIELDS: (keyof TTSSettings)[] = [
  "elevenlabsApiKey",
  "fishAudioApiKey",
  "googleApiKey",
  "azureSubscriptionKey",
];

export default class TTSReaderPlugin extends Plugin {
  settings: TTSSettings = DEFAULT_SETTINGS;
  private engine: TTSEngine | null = null;
  private floatingBar: FloatingBar | null = null;
  private currentSpeed = 1.0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new TTSSettingTab(this.app, this));

    this.addCommand({
      id: "read-aloud",
      name: "Read aloud",
      editorCallback: (editor: Editor, view: MarkdownView) => {
        this.startReading(editor);
      },
    });

    this.addCommand({
      id: "pause-resume",
      name: "Pause/Resume reading",
      checkCallback: (checking: boolean) => {
        if (this.engine && this.engine.getState() !== "idle") {
          if (!checking) this.togglePause();
          return true;
        }
        return false;
      },
    });

    this.addCommand({
      id: "stop-reading",
      name: "Stop reading",
      checkCallback: (checking: boolean) => {
        if (this.engine && this.engine.getState() !== "idle") {
          if (!checking) this.stopReading();
          return true;
        }
        return false;
      },
    });
  }

  onunload(): void {
    this.stopReading();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    for (const field of ENCRYPTED_FIELDS) {
      if (this.settings[field]) {
        (this.settings as unknown as Record<string, string>)[field] = decryptSecret(this.settings[field] as string);
      }
    }
  }

  async saveSettings(): Promise<void> {
    const toSave = { ...this.settings };
    for (const field of ENCRYPTED_FIELDS) {
      const val = toSave[field] as string;
      if (val && !val.startsWith("enc:")) {
        (toSave as unknown as Record<string, string>)[field] = encryptSecret(val);
      }
    }
    await this.saveData(toSave);
  }

  private startReading(editor: Editor): void {
    this.stopReading();

    const selection = editor.getSelection();
    const raw = selection || editor.getValue();
    const text = stripMarkdown(raw);

    if (!text) {
      new Notice("Nothing to read.");
      return;
    }

    this.currentSpeed = this.settings.defaultSpeed;
    this.pendingText = text;
    this.startWithEngine(text, this.settings.ttsProvider);
  }

  private pendingText = "";

  private createEngine(which: TTSProvider): TTSEngine {
    switch (which) {
      case "elevenlabs":
        return new ElevenLabsEngine(
          this.settings.elevenlabsApiKey,
          this.settings.elevenlabsModel,
          this.settings.elevenlabsVoiceId,
        );
      case "fishaudio":
        return new FishAudioEngine(
          this.settings.fishAudioApiKey,
          this.settings.fishAudioModel,
          this.settings.fishAudioVoiceId,
        );
      case "googletts":
        return new GoogleTTSEngine(
          this.settings.googleApiKey,
          this.settings.googleVoiceName,
          this.settings.googleLanguageCode,
        );
      case "azuretts":
        return new AzureTTSEngine(
          this.settings.azureSubscriptionKey,
          this.settings.azureRegion,
          this.settings.azureVoiceName,
        );
      case "webspeech":
        return new WebSpeechEngine(this.settings.webSpeechVoiceURI);
    }
  }

  private startWithEngine(text: string, which: TTSProvider): void {
    const engine = this.createEngine(which);

    engine.setCallbacks({
      onStateChange: (state) => {
        this.floatingBar?.updateState(state);
      },
      onProgress: (fraction) => {
        this.floatingBar?.updateProgress(fraction);
      },
      onEnd: () => {
        this.stopReading();
      },
      onError: (error) => {
        if (which !== "webspeech") {
          const labels: Record<string, string> = {
            elevenlabs: "ElevenLabs",
            fishaudio: "Fish Audio",
            googletts: "Google Cloud TTS",
            azuretts: "Azure AI Speech",
          };
          const label = labels[which] ?? which;
          new Notice(`${label} failed, falling back to Web Speech. (${error})`);
          engine.destroy();
          this.engine = null;
          this.startWithEngine(this.pendingText, "webspeech");
          return;
        }
        new Notice(error);
        this.stopReading();
      },
    });

    this.engine = engine;

    if (!this.floatingBar) {
      this.floatingBar = new FloatingBar(this.currentSpeed, {
        onPlayPause: () => this.togglePause(),
        onStop: () => this.stopReading(),
        onSpeedChange: (speed) => {
          this.currentSpeed = speed;
          this.engine?.setSpeed(speed);
        },
      });
      this.floatingBar.show();
    }

    engine.speak(text, this.currentSpeed);
  }

  private togglePause(): void {
    if (!this.engine) return;
    const state = this.engine.getState();
    if (state === "playing") {
      this.engine.pause();
    } else if (state === "paused") {
      this.engine.resume();
    }
  }

  private stopReading(): void {
    this.engine?.stop();
    this.engine?.destroy();
    this.engine = null;
    this.floatingBar?.destroy();
    this.floatingBar = null;
  }
}
