/**
 * The pixel character of the chat: a small Koma frame with eyes and legs.
 * Every observed run phase has its own pose. Pure data, so the frames can be
 * tested without a window.
 */
import type { ActivityPhase } from './runActivity';

export const SPRITE_SIZE = 16;

/** Colours of the character, drawn from the application's tokens. */
export const PIXEL_COLORS = {
  body: 'var(--color-accent)',
  shade: 'var(--color-accent-deep)',
  eye: 'var(--color-surface-0)',
  light: 'var(--color-ink-100)',
  motion: 'var(--color-motion)',
  spark: 'var(--color-signal-warn)',
  ok: 'var(--color-signal-ok)',
  paper: 'var(--color-ink-300)',
} as const;
export type PixelColor = keyof typeof PIXEL_COLORS;

export type Pixel = readonly [x: number, y: number, color: PixelColor];
export type SpriteFrame = readonly Pixel[];

const LEGEND: Readonly<Record<string, PixelColor>> = {
  k: 'body',
  d: 'shade',
  e: 'eye',
  w: 'light',
  r: 'motion',
  y: 'spark',
  g: 'ok',
  s: 'paper',
};

/** Reads rows of characters into pixels; `.` is empty. */
function draw(rows: readonly string[], dx = 0, dy = 0): Pixel[] {
  const pixels: Pixel[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((character, x) => {
      const color = LEGEND[character];
      if (color !== undefined) pixels.push([x + dx, y + dy, color]);
    });
  });
  return pixels;
}

const BODY = [
  '....kkkkkkkk',
  '...kwwkkkkkkk',
  '...kwkkkkkkkk',
  '...kkkkkkkkkk',
  '...kkkkkkkkkk',
  '...kkkkkkkkkk',
  '...kkkkkkkkkk',
  '...kkkkkkkkkk',
  '...dkkkkkkkkd',
  '....dddddddd',
];
const LEGS = ['.....dd..dd', '.....dd..dd'];
const LEGS_WALK = ['....dd....dd', '....d......d'];

type Eyes = 'open' | 'blink' | 'left' | 'right' | 'closed' | 'happy' | 'cross' | 'down';

function eyes(kind: Eyes, dy: number): Pixel[] {
  const at = (rows: readonly string[]): Pixel[] => draw(rows, 0, 4 + dy);
  switch (kind) {
    case 'open':
      return at(['.....ee..ee', '.....ee..ee']);
    case 'blink':
      return at(['...........', '.....ee..ee']);
    case 'left':
      return at(['....ee..ee', '....ee..ee']);
    case 'right':
      return at(['......ee..ee', '......ee..ee']);
    case 'down':
      return at(['...........', '.....ee..ee', '.....ee..ee']);
    case 'closed':
      return at(['...........', '...........', '....eee.eee']);
    case 'happy':
      return at(['.....e....e', '....e.e..e.e']);
    case 'cross':
      return at(['....r.r.r.r', '.....r...r.', '....r.r.r.r']);
  }
}

type Mouth = 'small' | 'smile' | 'flat' | 'open' | 'sad';

function mouth(kind: Mouth, dy: number): Pixel[] {
  const at = (rows: readonly string[]): Pixel[] => draw(rows, 0, 8 + dy);
  switch (kind) {
    case 'small':
      return at(['.......rr']);
    case 'smile':
      return at(['.....r....r', '......rrrr']);
    case 'flat':
      return at(['......rrrr']);
    case 'open':
      return at(['.......rr', '.......rr']);
    case 'sad':
      return at(['......rrrr', '.....r....r']);
  }
}

function character(
  options: {
    readonly eyes?: Eyes;
    readonly mouth?: Mouth;
    readonly dy?: number;
    readonly legs?: 'stand' | 'walk' | 'tucked';
  } = {},
): Pixel[] {
  const dy = options.dy ?? 0;
  const legs = options.legs ?? 'stand';
  return [
    ...draw(BODY, 0, 2 + dy),
    ...(legs === 'tucked' ? [] : draw(legs === 'walk' ? LEGS_WALK : LEGS, 0, 12 + dy)),
    ...eyes(options.eyes ?? 'open', dy),
    ...mouth(options.mouth ?? 'small', dy),
  ];
}

/** A pencil held at the right side, tip at (x, y). */
function pencil(x: number, y: number): Pixel[] {
  return [
    [x, y, 'spark'],
    [x + 1, y - 1, 'motion'],
    [x + 2, y - 2, 'motion'],
  ];
}

const SHEET = draw(['sss', 's.s', 'sss'], 13, 10);

export interface SpriteAnimation {
  readonly frames: readonly SpriteFrame[];
  /** Time per frame; 0 for a single still frame. */
  readonly frameMs: number;
}

/** The poses of every phase. The first frame is the still pose for reduced motion. */
export const SPRITE_ANIMATIONS: Readonly<Record<ActivityPhase, SpriteAnimation>> = {
  // Wakes up: looks around and blinks.
  starting: {
    frameMs: 520,
    frames: [
      character({ eyes: 'open' }),
      character({ eyes: 'left' }),
      character({ eyes: 'right' }),
      character({ eyes: 'blink' }),
    ],
  },
  // Draws on a sheet: the pencil moves, a spark marks each stroke.
  generating: {
    frameMs: 200,
    frames: [
      [...character({ eyes: 'down', legs: 'walk' }), ...pencil(12, 10), ...SHEET],
      [...character({ eyes: 'down' }), ...pencil(13, 9), ...SHEET, [14, 11, 'spark']],
      [...character({ eyes: 'down', legs: 'walk' }), ...pencil(12, 11), ...SHEET],
      [
        ...character({ eyes: 'down', mouth: 'open' }),
        ...pencil(13, 10),
        ...SHEET,
        [14, 11, 'motion'],
      ],
    ],
  },
  // Checks the answer: looks from side to side over the sheet.
  validating: {
    frameMs: 480,
    frames: [
      [...character({ eyes: 'left', mouth: 'flat' }), ...SHEET],
      [...character({ eyes: 'right', mouth: 'flat' }), ...SHEET],
    ],
  },
  // Corrects the answer: erases with quick strokes.
  repairing: {
    frameMs: 240,
    frames: [
      [
        ...character({ eyes: 'down', mouth: 'flat' }),
        ...SHEET,
        [12, 12, 'light'],
        [12, 11, 'motion'],
      ],
      [
        ...character({ eyes: 'down', mouth: 'flat', legs: 'walk' }),
        ...SHEET,
        [13, 13, 'light'],
        [13, 12, 'motion'],
        [15, 7, 'spark'],
      ],
    ],
  },
  // Jumps with a check mark.
  completed: {
    frameMs: 360,
    frames: [
      [
        ...character({ eyes: 'happy', mouth: 'smile' }),
        ...draw(['...g', '..g.', 'gg..', '.g..'], 12, 0),
      ],
      [
        ...character({ eyes: 'happy', mouth: 'smile', dy: -1, legs: 'tucked' }),
        ...draw(['...g', '..g.', 'gg..', '.g..'], 12, 0),
      ],
    ],
  },
  // Crossed eyes and a puff. It does not move.
  failed: {
    frameMs: 0,
    frames: [
      [...character({ eyes: 'cross', mouth: 'sad', dy: 1 }), [1, 3, 'paper'], [0, 2, 'paper']],
    ],
  },
  // Stopped and resting: eyes closed, a slow Z.
  cancelled: {
    frameMs: 900,
    frames: [
      [
        ...character({ eyes: 'closed', mouth: 'flat', dy: 1 }),
        ...draw(['www', '.w.', 'www'], 13, 0),
      ],
      [...character({ eyes: 'closed', mouth: 'flat', dy: 1 }), ...draw(['ww', '.w', 'ww'], 14, 1)],
    ],
  },
};
