import { TTSEngine, TTSEngineCallbacks, TTSState } from "./tts-engine";
import { chunkText } from "./utils";

const CHUNK_MAX = 200;
const CHROME_RESUME_INTERVAL = 10_000;

export class WebSpeechEngine implements TTSEngine {
  private state: TTSState = "idle";
  private callbacks: TTSEngineCallbacks | null = null;
  private chunks: string[] = [];
  private currentChunkIdx = 0;
  private totalChars = 0;
  private charsBeforeCurrent = 0;
  private speed = 1;
  private voiceURI: string;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private chromeInterval: number | null = null;

  constructor(voiceURI: string) {
    this.voiceURI = voiceURI;
  }

  setCallbacks(callbacks: TTSEngineCallbacks): void {
    this.callbacks = callbacks;
  }

  async speak(text: string, speed: number): Promise<void> {
    this.stop();
    this.speed = speed;
    this.chunks = chunkText(text, CHUNK_MAX);
    this.totalChars = text.length;
    this.currentChunkIdx = 0;
    this.charsBeforeCurrent = 0;

    if (this.chunks.length === 0) return;

    this.setState("playing");
    this.startChromeWorkaround();
    this.speakChunk(0);
  }

  pause(): void {
    if (this.state !== "playing") return;
    window.speechSynthesis.pause();
    this.setState("paused");
  }

  resume(): void {
    if (this.state !== "paused") return;
    window.speechSynthesis.resume();
    this.setState("playing");
  }

  stop(): void {
    window.speechSynthesis.cancel();
    this.currentUtterance = null;
    this.chunks = [];
    this.stopChromeWorkaround();
    this.setState("idle");
  }

  getState(): TTSState {
    return this.state;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    // Takes effect on the next chunk; can't change rate mid-utterance
  }

  destroy(): void {
    this.stop();
  }

  private setState(state: TTSState): void {
    if (this.state === state) return;
    this.state = state;
    this.callbacks?.onStateChange(state);
  }

  private speakChunk(idx: number): void {
    if (idx >= this.chunks.length) {
      this.stopChromeWorkaround();
      this.setState("idle");
      this.callbacks?.onEnd();
      return;
    }

    this.currentChunkIdx = idx;
    this.charsBeforeCurrent = 0;
    for (let i = 0; i < idx; i++) {
      this.charsBeforeCurrent += this.chunks[i].length;
    }

    const utterance = new SpeechSynthesisUtterance(this.chunks[idx]);
    utterance.rate = this.speed;

    const voice = this.findVoice();
    if (voice) utterance.voice = voice;

    utterance.onboundary = (e) => {
      if (this.totalChars > 0) {
        const progress = (this.charsBeforeCurrent + e.charIndex) / this.totalChars;
        this.callbacks?.onProgress(Math.min(progress, 1));
      }
    };

    utterance.onend = () => {
      if (this.state === "idle") return; // was stopped
      this.speakChunk(idx + 1);
    };

    utterance.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;
      this.callbacks?.onError(`Speech error: ${e.error}`);
      this.stop();
    };

    this.currentUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  private findVoice(): SpeechSynthesisVoice | null {
    if (!this.voiceURI) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => v.voiceURI === this.voiceURI) || null;
  }

  private startChromeWorkaround(): void {
    this.stopChromeWorkaround();
    this.chromeInterval = window.setInterval(() => {
      if (this.state === "playing" && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, CHROME_RESUME_INTERVAL);
  }

  private stopChromeWorkaround(): void {
    if (this.chromeInterval !== null) {
      window.clearInterval(this.chromeInterval);
      this.chromeInterval = null;
    }
  }
}
