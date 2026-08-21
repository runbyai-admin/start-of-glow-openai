type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export class GlowAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  unlock(): void {
    if (this.context) {
      void this.context.resume().catch(() => undefined);
      return;
    }
    try {
      const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (!AudioCtor) return;
      this.context = new AudioCtor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.context.destination);
    } catch {
      this.context = null;
      this.master = null;
    }
  }

  note(frequency: number, duration = 0.28, type: OscillatorType = "sine", volume = 0.22): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.72), now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.03);
    } catch {
      // Audio is optional; a hostile or suspended context cannot stop play.
    }
  }

  seed(index: number): void {
    const scale = [261.63, 329.63, 392, 523.25, 659.25, 783.99, 1046.5];
    this.note(scale[index % scale.length], 0.34, "sine", 0.24);
  }

  dash(): void { this.note(145, 0.12, "triangle", 0.16); }
  breakShadow(): void { this.note(92, 0.24, "sawtooth", 0.14); }
  damage(): void { this.note(68, 0.42, "square", 0.13); }
  gate(): void { [220, 329.63, 493.88].forEach((f, i) => window.setTimeout(() => this.note(f, 0.5, "sine", 0.2), i * 90)); }
  ending(): void { [261.63, 392, 523.25, 783.99].forEach((f, i) => window.setTimeout(() => this.note(f, 0.8, "sine", 0.18), i * 150)); }
}

export const glowAudio = new GlowAudio();
