import { requestUrl } from "obsidian";
import { TTSEngine, TTSEngineCallbacks, TTSState } from "./tts-engine";
import { chunkText } from "./utils";

const CHUNK_MAX = 1000;
const API_URL = "https://api.fish.audio/v1/tts";

export class FishAudioEngine implements TTSEngine {
  private state: TTSState = "idle";
  private callbacks: TTSEngineCallbacks | null = null;
  private apiKey: string;
  private voiceId: string;
  private model: string;
  private speed = 1;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private chunks: string[] = [];
  private currentChunkIdx = 0;
  private totalChars = 0;
  private charsBeforeCurrent = 0;
  private aborted = false;

  constructor(apiKey: string, model: string, voiceId: string) {
    this.apiKey = apiKey;
    this.model = model;
    this.voiceId = voiceId;
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
      const body: Record<string, unknown> = {
        text: this.chunks[idx],
        format: "mp3",
        mp3_bitrate: 128,
        latency: "balanced",
      };
      if (this.voiceId) {
        body.reference_id = this.voiceId;
      }
      if (this.speed !== 1) {
        body.prosody = { speed: this.speed };
      }

      const response = await requestUrl({
        url: API_URL,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          model: this.model,
        },
        body: JSON.stringify(body),
      });
      arrayBuffer = response.arrayBuffer;
    } catch (err: unknown) {
      console.error("[TTS] Fish Audio raw error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
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
          return "Fish Audio: invalid API key.";
        case "402":
          return "Fish Audio: payment required. Check your plan at fish.audio.";
        case "422":
          return "Fish Audio: invalid request (check voice ID).";
        case "429":
          return "Fish Audio: rate limited. Try again shortly.";
      }
    }
    return `Fish Audio error: ${raw}`;
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
