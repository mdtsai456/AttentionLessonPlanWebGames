import type { BubbleState, PlayerRenderer } from './game';

const imagePath = (name: string): string => new URL(
  `${import.meta.env.BASE_URL}images/${name}`,
  window.location.href,
).href;
const ARROW_IMAGE_PATHS = [0, 1, 2, 3].map((index) => imagePath(`arrow_${index}_up.PNG`));

ARROW_IMAGE_PATHS.forEach((path) => {
  const image = new Image();
  image.src = path;
});
const rotationForDirection: Record<BubbleState['direction'], number> = {
  ArrowUp: 0,
  ArrowRight: 90,
  ArrowDown: 180,
  ArrowLeft: 270,
};

interface BubbleElements {
  root: HTMLDivElement;
  base: HTMLImageElement;
  arrow: HTMLImageElement;
}

export class DomPlayerRenderer implements PlayerRenderer {
  private readonly elements = new Map<number, BubbleElements>();

  constructor(private readonly arena: HTMLElement) {}

  clear(): void {
    this.arena.replaceChildren();
    this.elements.clear();
  }

  createBubble(bubble: BubbleState, arrowImageIndex: number): void {
    const root = document.createElement('div');
    const base = document.createElement('img');
    const arrow = document.createElement('img');
    root.className = `bubble${bubble.isTarget ? ' bubble--target' : ''}`;
    root.setAttribute('aria-label', bubble.isTarget ? `目標氣泡，方向為 ${bubble.direction}` : '非目標氣泡');
    base.className = 'bubble-base';
    base.src = imagePath('empty.png');
    base.alt = '';
    arrow.className = 'bubble-arrow';
    arrow.src = ARROW_IMAGE_PATHS[arrowImageIndex] ?? ARROW_IMAGE_PATHS[3];
    arrow.alt = '';
    arrow.addEventListener('error', () => {
      if (arrow.dataset.fallbackApplied === 'true') return;
      arrow.dataset.fallbackApplied = 'true';
      arrow.src = ARROW_IMAGE_PATHS[3];
    });
    arrow.style.transform = `rotate(${rotationForDirection[bubble.direction]}deg)`;
    arrow.setAttribute('aria-hidden', 'true');
    root.append(base, arrow);
    this.arena.append(root);
    this.elements.set(bubble.id, { root, base, arrow });
    this.renderBubble(bubble);
  }

  renderBubble(bubble: BubbleState): void {
    const elements = this.elements.get(bubble.id);
    if (!elements) return;
    elements.root.style.setProperty('--bubble-x', String(bubble.x));
    elements.root.style.setProperty('--bubble-y', String(bubble.y));
  }

  revealBubbles(bubbles: BubbleState[]): void {
    bubbles.forEach((bubble) => {
      if (!bubble.isTarget) return;
      const elements = this.elements.get(bubble.id);
      if (!elements) return;
      elements.base.src = imagePath('target.png');
      elements.root.classList.add('bubble--revealed');
      elements.arrow.style.transform = `rotate(${rotationForDirection[bubble.direction]}deg)`;
    });
  }
}
