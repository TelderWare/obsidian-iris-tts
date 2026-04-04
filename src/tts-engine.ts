export type TTSState = "idle" | "playing" | "paused";

export interface TTSEngineCallbacks {
  onStateChange: (state: TTSState) => void;
  onProgress: (fraction: number) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

export interface TTSEngine {
  speak(text: string, speed: number): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  getState(): TTSState;
  setSpeed(speed: number): void;
  setCallbacks(callbacks: TTSEngineCallbacks): void;
  destroy(): void;
}
