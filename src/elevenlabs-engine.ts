import { requestUrl } from "obsidian";
import { TTSEngine, TTSEngineCallbacks, TTSState } from "./tts-engine";
import { chunkText } from "./utils";

const CHUNK_MAX = 1000;
const API_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

export class ElevenLabsEngine implements TTSEngine {
  private state: TTSState = "idle";
  private callbacks: TTSEngineCallbacks | null = null;
  private apiKey: string;
  private voiceId: string;
  private modelId: string;
  private speed = 1;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private chunks: string[] = [];
  private currentChunkIdx = 0;
  private totalChars = 0;
  private charsBeforeCurrent = 0;
  private aborted = false;

  constructor(apiKey: string, modelId: string, voiceId: string) {
    this.apiKey = apiKey;
    this.modelId = modelId;
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
    // Takes effect on the next chunk
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
      const response = await requestUrl({
        url: `${API_BASE}/${this.voiceId}`,
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: this.chunks[idx],
          model_id: this.modelId,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: this.speed,
          },
        }),
      });
      arrayBuffer = response.arrayBuffer;
    } catch (err: unknown) {
      console.error("[TTS] ElevenLabs raw error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
      const detail = this.extractDetail(err);
      const msg = detail ? `ElevenLabs: ${detail}` : this.friendlyError(err);
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

  private extractDetail(err: unknown): string | null {
    // Obsidian's requestUrl throws an object with a response property on HTTP errors
    const obj = err as Record<string, unknown>;
    try {
      if (obj && typeof obj === "object") {
        // Try to get the JSON response body
        const headers = obj.headers as Record<string, string> | undefined;
        const body = obj.body as string | undefined;
        if (body) {
          const json = JSON.parse(body);
          if (json?.detail?.message) return json.detail.message;
          if (typeof json?.detail === "string") return json.detail;
        }
      }
    } catch {
      // ignore parse errors
    }
    return null;
  }

  private friendlyError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const status = raw.match(/status\s+(\d{3})/i);
    if (status) {
      switch (status[1]) {
        case "401":
          return "ElevenLabs: invalid API key.";
        case "402":
          return "ElevenLabs: quota exceeded. Check your plan at elevenlabs.io.";
        case "429":
          return "ElevenLabs: rate limited. Try again shortly.";
      }
    }
    return `ElevenLabs error: ${raw}`;
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
