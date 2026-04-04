import { setIcon } from "obsidian";
import type { TTSState } from "./tts-engine";

export interface FloatingBarCallbacks {
  onPlayPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: number) => void;
}

export class FloatingBar {
  private container: HTMLElement;
  private playPauseBtn: HTMLElement;
  private progressBar: HTMLElement;
  private progressFill: HTMLElement;
  private speedLabel: HTMLElement;
  private speed: number;
  private callbacks: FloatingBarCallbacks;

  constructor(speed: number, callbacks: FloatingBarCallbacks) {
    this.speed = speed;
    this.callbacks = callbacks;
    this.container = document.createElement("div");
    this.container.addClass("tts-floating-bar");

    // Play/Pause
    this.playPauseBtn = this.container.createEl("button", { cls: "tts-btn clickable-icon" });
    setIcon(this.playPauseBtn, "pause");
    this.playPauseBtn.addEventListener("click", () => this.callbacks.onPlayPause());

    // Stop
    const stopBtn = this.container.createEl("button", { cls: "tts-btn clickable-icon" });
    setIcon(stopBtn, "square");
    stopBtn.addEventListener("click", () => this.callbacks.onStop());

    // Progress
    const progressContainer = this.container.createEl("div", { cls: "tts-progress" });
    this.progressFill = progressContainer.createEl("div", { cls: "tts-progress-fill" });
    this.progressBar = progressContainer;

    // Speed controls
    const speedGroup = this.container.createEl("span", { cls: "tts-speed-group" });

    const speedDown = speedGroup.createEl("button", { cls: "tts-btn clickable-icon tts-btn-small" });
    setIcon(speedDown, "minus");
    speedDown.addEventListener("click", () => this.changeSpeed(-0.1));

    this.speedLabel = speedGroup.createEl("span", {
      cls: "tts-speed-label",
      text: this.formatSpeed(),
    });

    const speedUp = speedGroup.createEl("button", { cls: "tts-btn clickable-icon tts-btn-small" });
    setIcon(speedUp, "plus");
    speedUp.addEventListener("click", () => this.changeSpeed(0.1));

  }

  show(): void {
    if (!this.container.parentElement) {
      document.body.appendChild(this.container);
    }
  }

  hide(): void {
    this.container.remove();
  }

  updateState(state: TTSState): void {
    setIcon(this.playPauseBtn, state === "playing" ? "pause" : "play");
  }

  updateProgress(fraction: number): void {
    this.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  updateSpeed(speed: number): void {
    this.speed = speed;
    this.speedLabel.textContent = this.formatSpeed();
  }

  destroy(): void {
    this.hide();
  }

  private changeSpeed(delta: number): void {
    const newSpeed = Math.round(Math.max(0.5, Math.min(2.0, this.speed + delta)) * 10) / 10;
    if (newSpeed !== this.speed) {
      this.speed = newSpeed;
      this.speedLabel.textContent = this.formatSpeed();
      this.callbacks.onSpeedChange(this.speed);
    }
  }

  private formatSpeed(): string {
    return `${this.speed.toFixed(1)}x`;
  }
}
