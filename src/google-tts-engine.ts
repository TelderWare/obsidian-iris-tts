import { requestUrl } from "obsidian";
import { TTSEngine, TTSEngineCallbacks, TTSState } from "./tts-engine";
import { chunkText } from "./utils";

const CHUNK_MAX = 1000;
const API_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";

export class GoogleTTSEngine implements TTSEngine {
  private state: TTSState = "idle";
  private callbacks: TTSEngineCallbacks | null = null;
  private apiKey: string;
  private voiceName: string;
  private languageCode: string;
  private speed = 1;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private chunks: string[] = [];
  private currentChunkIdx = 0;
  private totalChars = 0;
  private charsBeforeCurrent = 0;
  private aborted = false;

  constructor(apiKey: string, voiceName: string, languageCode: string) {
    this.apiKey = apiKey;
    this.voiceName = voiceName;
    this.languageCode = languageCode;
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

    let audioContent: string;
    try {
      const response = await requestUrl({
        url: API_URL,
        method: "POST",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { text: this.chunks[idx] },
          voice: {
            languageCode: this.languageCode,
            name: this.voiceName,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: this.speed,
          },
        }),
      });
      audioContent = response.json.audioContent;
    } catch (err: unknown) {
      console.error("[TTS] Google Cloud raw error:", JSON.stringify(err, Object.getOwnPropertyNames(err as object)));
      const msg = this.friendlyError(err);
      this.callbacks?.onError(msg);
      this.stop();
      return;
    }

    if (this.aborted) return;

    this.revokeUrl();
    const binary = atob(audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/mpeg" });
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
        case "400":
          return "Google TTS: bad request (check voice name/language).";
        case "401":
        case "403":
          return "Google TTS: invalid API key or TTS API not enabled.";
        case "429":
          return "Google TTS: rate limited. Try again shortly.";
      }
    }
    return `Google TTS error: ${raw}`;
  }

  private revokeUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
