import { requestUrl } from "obsidian";
import { TTSEngine, TTSEngineCallbacks, TTSState } from "./tts-engine";
import { chunkText } from "./utils";

const CHUNK_MAX = 1000;

export class AzureTTSEngine implements TTSEngine {
  private state: TTSState = "idle";
  private callbacks: TTSEngineCallbacks | null = null;
  private subscriptionKey: string;
  private region: string;
  private voiceName: string;
  private speed = 1;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private chunks: string[] = [];
  private currentChunkIdx = 0;
  private totalChars = 0;
  private charsBeforeCurrent = 0;
  private aborted = false;

  constructor(subscriptionKey: string, region: string, voiceName: string) {
    this.subscriptionKey = subscriptionKey;
    this.region = region;
    this.voiceName = voiceName;
  }

  setCallbacks(callbacks: TTSEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async speak(text: string, speed: number): Promise<void> {
    this.stop();
    this.speed = speed;
    this.aborted = false;
    this.chunks = chunkText(text, CHUNK_MAX);
    this.totalChars = text.length;
    this.currentChunkIdx = 0;
    this.charsBeforeCurrent = 0;

    if (this.chunks.length === 0) return;

    this.setState("playing");
    await this.playChunk(0);
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.audio?.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.audio?.play();
    this.setState("playing");
  }

  stop(): void {
    this.aborted = true;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio = null;
    }
    this.revokeUrl();
    this.chunks = [];
    this.setState("idle");
  }

  getState(): TTSState {
    return this.state;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  destroy(): void {
    this.stop();
  }

  private setState(state: TTSState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks?.onStateChange(state);
  }

  private buildSSML(text: string): string {
    // Escape XML special characters
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

    // Convert speed multiplier to SSML prosody rate percentage
    const ratePercent = `${Math.round(this.speed * 100)}%`;

    // Extract lang from voice name (e.g. "en-US-JennyNeural" -> "en-US")
    const langMatch = this.voiceName.match(/^([a-z]{2}-[A-Z]{2})/);
    const lang = langMatch ? langMatch[1] : "en-US";

    return `<speak version='1.0' xml:lang='${lang}'><voice name='${this.voiceName}'><prosody rate='${ratePercent}'>${escaped}</prosody></voice></speak>`;
  }

  private async playChunk(idx: number): Promise<void> {
    if (this.aborted || idx >= this.chunks.length) {
      if (!this.aborted) {
        this.setState("idle");
        this.callbacks?.onEnd();
      }
      return;
    }

    this.currentChunkIdx = idx;
    this.charsBeforeCurrent = 0;
    for (let i = 0; i < idx; i++) {
      this.charsBeforeCurrent += this.chunks[i].length;
    }

    let arrayBuffer: ArrayBuffer;
    try {
      const url = `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const ssml = this.buildSSML(this.chunks[idx]);

      const response = await requestUrl({
        url,
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.subscriptionKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
          "User-Agent": "ObsidianTTSReader",
        },
        body: ssml,
      });
      arrayBuffer = response.arrayBuffer;
    } catch (err: unknown) {
      console.error("[TTS] Azure raw error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
      const msg = this.friendlyError(err);
      this.callbacks?.onError(msg);
      this.stop();
      return;
    }

    if (this.aborted) return;

    this.revokeUrl();
    const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
    this.objectUrl = URL.createObjectURL(blob);

    const audio = new Audio(this.objectUrl);
    this.audio = audio;

    audio.ontimeupdate = () => {
      if (this.totalChars > 0 && audio.duration > 0) {
        const chunkFraction = audio.currentTime / audio.duration;
        const chunkChars = this.chunks[this.currentChunkIdx]?.length ?? 0;
        const progress = (this.charsBeforeCurrent + chunkFraction * chunkChars) / this.totalChars;
        this.callbacks?.onProgress(Math.min(progress, 1));
      }
    };

    audio.onended = () => {
      if (this.aborted) return;
      this.revokeUrl();
      this.playChunk(idx + 1);
    };

    audio.onerror = () => {
      if (this.aborted) return;
      this.callbacks?.onError("Audio playback error.");
      this.stop();
    };

    audio.play();
  }

  private friendlyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const status = raw.match(/status\s+(\d{3})/i);
    if (status) {
      switch (status[1]) {
        case "401":
          return "Azure TTS: invalid subscription key or wrong region.";
        case "403":
          return "Azure TTS: access denied. Check your key and region.";
        case "429":
          return "Azure TTS: rate limited. Try again shortly.";
      }
    }
    return `Azure TTS error: ${raw}`;
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
