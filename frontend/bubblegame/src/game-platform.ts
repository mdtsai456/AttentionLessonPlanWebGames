export interface GameClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timeoutId: number): void;
  setInterval(callback: () => void, delayMs: number): number;
  clearInterval(intervalId: number): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(frameId: number): void;
}

export interface RandomSource {
  next(): number;
}

export const browserGameClock: GameClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
  setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
  clearInterval: (intervalId) => window.clearInterval(intervalId),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (frameId) => window.cancelAnimationFrame(frameId),
};

export const mathRandomSource: RandomSource = {
  next: () => Math.random(),
};
