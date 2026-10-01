import type { BrandKit } from '@koma-motion/core';

/**
 * Starter presets: a Brand Kit, project instructions and a first request
 * that show what Koma Motion can do with shapes, text and motion alone.
 * The instructions are project guidance; they cannot override the
 * application rules or the response schema.
 */
export interface StarterPreset {
  readonly id: 'solar-system' | 'finance-report' | 'rapunzel';
  readonly name: string;
  /** One sentence for the starter card. */
  readonly summary: string;
  readonly brandKit: BrandKit;
  readonly systemInstructions: string;
  /** Put into the chat composer, ready to send. */
  readonly request: string;
  readonly komaCount: number;
}

/** Shared craft notes. Every starter adds its own art direction after them. */
const MOTION_CRAFT = `MOTION CRAFT (applies to every Koma)
- Think of the deck as one continuous animated scene, not separate pages. Before writing any Koma, plan a cast of persistent objects and decide where each one is in every Koma.
- Persistent ids are the animation. An object that appears in consecutive Komas MUST keep its persistentId, so the app moves, scales, rotates and recolours it. Never re-create an object under a new id when it could travel instead.
- Give every transition at least three kinds of change: something moves a long way, something changes size, and something changes colour or opacity. Keep a few background objects drifting slowly (small position shifts, slight rotation) so even calm steps feel alive.
- Enter and leave with intent: new objects should start small, transparent or off to one side in the Koma where they first appear; objects that leave should first shrink or fade in the Koma before they disappear.
- Use the "staged" strategy when objects leave and arrive, "continuous" for pure camera-like moves. Use easeInOut, or easeOut for arrivals. Durations of 1200 to 2200 ms read well; longer for big scene changes.
- Write each transition rationale as one short sentence that names what travels.

LAYOUT
- Canvas is 1920 x 1080. Keep text at least 96 units from every edge. Never overlap text with other text.
- Typography scale: hero titles 96 to 140, Koma titles 64 to 84, labels 26 to 34, small captions 20 to 24. Headings use fontRole heading, everything else body.
- Use 20 to 45 elements per Koma. Rich detail comes from many small shapes (dots, rings, ticks, grid lines, highlights), not from long text.
- Keep at most 30 words of readable text per Koma, split into short labels. No paragraphs.
- Draw everything with shapes and text. Do not use image elements and do not request generated images.
- Layer with zIndex: background decoration lowest, content in the middle, labels on top.
- Every Koma needs a full-canvas background rectangle (persistentId "backdrop") in the Brand Kit background colour; recolour it slightly between chapters instead of replacing it.`;

const SOLAR_SYSTEM: StarterPreset = {
  id: 'solar-system',
  name: 'Solar system',
  summary: 'A guided flight past the Sun and the eight planets, drawn with shapes and orbits.',
  brandKit: {
    name: 'Deep Orbit',
    colours: {
      primary: '#FFB547',
      secondary: '#5B6CFF',
      accent: '#5CE1E6',
      background: '#070B1A',
      text: '#EEF2FF',
    },
    typography: {
      headingFont: 'Trebuchet MS, Segoe UI, Helvetica Neue, Arial',
      bodyFont: 'Segoe UI, Helvetica Neue, Arial',
    },
    logoAssetId: null,
    tone: 'Wonder-filled and precise, like a planetarium show narrated by a scientist. Short, vivid phrases with one surprising fact per Koma.',
    visualStyle:
      'Deep space. Near-black navy background, glowing warm Sun, cool cyan and indigo highlights, thin orbit rings, scattered star dots. Generous negative space, large hero objects, small precise data labels.',
    iconStyle: 'Thin outlined rings and dots. No clip-art.',
    preferredImagery:
      'Planets as layered circles: a base circle, a lighter offset circle for the lit side, and thin rings for orbits or atmospheres.',
    preferredTopics: ['solar system', 'planets', 'astronomy', 'space exploration'],
    referenceNotes:
      'Planet colours: Mercury #9C9AA6, Venus #E8C27A, Earth #3B82F6 with #34D399 land, Mars #E4572E, Jupiter #D9A066 with #B86F3E bands, Saturn #E9D29A with #CDB77A ring, Uranus #7FE0E8, Neptune #3D5AFE.',
  },
  systemInstructions: `You are designing an animated planetarium show about our solar system for Koma Motion.

${MOTION_CRAFT}

ART DIRECTION: SPACE
- Starfield: 14 to 18 tiny circles (size 3 to 8, text colour, opacity 0.25 to 0.9) with persistentIds star-1, star-2 and so on. Keep the SAME stars in every Koma and shift each one 20 to 80 units between Komas (all roughly in the same direction) so the camera seems to fly. Vary their opacity a little to twinkle.
- The Sun (persistentId "sun") is a large circle in the primary colour with two softer halo circles around it ("sun-glow-1", "sun-glow-2") at opacity 0.15 to 0.3. On the title Koma it is huge and partly off-canvas; later it shrinks toward the left edge as we travel outward, and it stays visible as a small anchor on most Komas.
- Each planet is a cast member with its own persistentId (mercury, venus, earth, mars, jupiter, saturn, uranus, neptune) built from: a base circle, a lighter "-light" circle offset toward the Sun for the lit side, and where useful a ring or band shapes (Saturn ring: a thin stroked circle or flat rounded rectangle; Jupiter bands: thin rounded rectangles). Use the planet colours in the Brand Kit reference notes.
- Orbits: thin stroked circles (fill null, stroke secondary colour, strokeWidth 2, opacity 0.35) centred on the Sun, persistentIds orbit-1 to orbit-8.
- Choreography: when a planet becomes the focus it travels from its small position on the overview to the centre-right and scales up 4 to 8 times; the previous focus planet shrinks and slides back to its orbit position. The planet name label travels with it.
- A persistent "fact card" (rounded rectangle, fill secondary at opacity 0.2, stroke accent) holds two or three data labels such as distance from the Sun, day length and number of moons. Keep the card and its label ids across Komas and change only the text, so the numbers update in place.
- A small progress track at the bottom (eight dots, persistentIds dot-mercury ... dot-neptune): the dot of the current planet grows and turns accent colour.
- Facts must be accurate and rounded sensibly (for example Earth: 1 AU, 24 hours, 1 moon; Jupiter: 5.2 AU, 10 hours, 95 known moons). Keep wording short and lively.`,
  request:
    'Create a flight through the solar system. Start with a dramatic title Koma with the Sun, then an overview of all eight planets on their orbits, then fly to the rocky planets (Mercury and Venus, then Earth and Mars), then the giants Jupiter and Saturn, then the ice giants Uranus and Neptune, and end with a closing Koma that zooms back out to the whole system with one memorable takeaway.',
  komaCount: 7,
};

const FINANCE_REPORT: StarterPreset = {
  id: 'finance-report',
  name: 'Quarterly results',
  summary:
    'A modern investor update for the fictional Northwind Labs, with animated charts and KPIs.',
  brandKit: {
    name: 'Northwind Labs',
    colours: {
      primary: '#2563EB',
      secondary: '#0F766E',
      accent: '#22D3A6',
      background: '#0B1220',
      text: '#E8EEF8',
    },
    typography: {
      headingFont: 'Segoe UI, Helvetica Neue, Arial',
      bodyFont: 'Segoe UI, Helvetica Neue, Arial',
    },
    logoAssetId: null,
    tone: 'Confident, clear and data-first. Numbers lead, words explain. Plain language for executives and investors.',
    visualStyle:
      'Modern fintech dashboard. Dark navy canvas, crisp cards with rounded corners and thin borders, electric blue and mint accents, lots of alignment and white space, subtle grid lines.',
    iconStyle: 'Minimal geometric marks: small circles, arrows from lines, rounded chips.',
    preferredImagery:
      'Charts and numbers drawn from shapes: bars, lines, dots, rings and progress bars.',
    preferredTopics: ['quarterly results', 'revenue', 'growth', 'SaaS metrics', 'outlook'],
    referenceNotes:
      'Northwind Labs is a fictional company invented for demos. All figures are fictional. Positive change uses #22D3A6, negative change uses #F87171, neutral uses #94A3B8.',
  },
  systemInstructions: `You are designing an animated investor presentation for Northwind Labs, a fictional software company, in Koma Motion. Every number is invented and must be internally consistent.

${MOTION_CRAFT}

ART DIRECTION: MODERN FINANCE
- Use these fictional figures consistently. Quarterly revenue in millions of USD: Q1 2025 18.4, Q2 21.0, Q3 24.6, Q4 29.3, Q1 2026 33.8. Gross margin 78 percent (up from 74). Net revenue retention 124 percent. Customers 1,240 (up 31 percent year over year). Operating cash flow 6.1 million. Revenue mix Q1 2026: Platform 58 percent, Analytics 27 percent, Services 15 percent. FY2026 revenue guidance 150 to 158 million.
- Title Koma: big company name, quarter label (Q1 2026 results) and a single hero number (33.8M revenue, +84 percent year over year) inside a glowing ring made of two or three stroked circles.
- KPI Koma: four cards (rounded rectangles, cornerRadius 24, fill secondary colour at low opacity or a slightly lighter navy, stroke primary at opacity 0.5). Each card has a big number, a small label and a delta chip (small rounded rectangle with +x percent in positive colour). Keep the four cards as persistent objects and let them move into new positions in the next Koma rather than disappearing.
- Bar chart Koma (revenue by quarter): baseline line, four faint horizontal grid lines with value labels, five bars as rounded rectangles with persistentIds bar-q1-2025 ... bar-q1-2026, value labels above each bar, quarter labels below. ANIMATE GROWTH: in the Koma before the chart, place the same bar ids at the baseline with height 4 and opacity 0, so the transition grows them upward. The last bar uses the accent colour, earlier bars the primary colour.
- Line chart / trend Koma: reuse the five bar ids, shrink each bar into a small circle-like marker (roundedRectangle 20 x 20, cornerRadius 10) placed on a trend line made of short line segments between the points. This morph from bars to points is the signature move; keep ids identical.
- Mix Koma: a horizontal 100 percent stacked bar made of three rounded rectangles with widths proportional to 58, 27 and 15 percent, plus a legend with colour dots and big percentage labels. In the transition into this Koma, the three segments should grow from width 4 at the left end of the track.
- Outlook Koma: guidance range drawn as a horizontal track with a highlighted range segment from 150 to 158, a marker for the midpoint, and three short priorities as chips.
- Number labels are text elements. When a number changes between Komas, keep the persistentId so it updates in place. Right-align numbers in tables and use tabular formatting (for example 33.8M, +18 percent).
- Add the small footnote "Fictional company. Illustrative figures only." on the title and closing Komas.`,
  request:
    'Create the Q1 2026 investor update for Northwind Labs: a title Koma with the hero revenue number, a KPI overview with four cards, a revenue-by-quarter bar chart that grows from the baseline, a trend Koma that morphs the bars into a line chart, a revenue mix breakdown, and a closing outlook Koma with FY2026 guidance and three priorities.',
  komaCount: 6,
};

const RAPUNZEL: StarterPreset = {
  id: 'rapunzel',
  name: 'Rapunzel story',
  summary:
    'The fairy tale of Rapunzel as an animated storybook, with a tower, a forest and a growing braid.',
  brandKit: {
    name: 'Golden Tower Tales',
    colours: {
      primary: '#F2B33D',
      secondary: '#6D4AA8',
      accent: '#F28CB1',
      background: '#1B1530',
      text: '#FBF4E6',
    },
    typography: {
      headingFont: 'Palatino Linotype, Palatino, Book Antiqua, Georgia',
      bodyFont: 'Georgia, Palatino Linotype, serif',
    },
    logoAssetId: null,
    tone: 'Warm storyteller voice, like reading aloud at bedtime. Simple sentences, gentle suspense, a happy ending.',
    visualStyle:
      'Storybook theatre at dusk. Deep violet night sky, golden hair and lantern light, rose highlights, soft rounded shapes, layered silhouettes for hills and trees, scenes that feel like paper cut-outs on a stage.',
    iconStyle: 'Soft rounded paper cut-out shapes.',
    preferredImagery:
      'Scenes built from layered shapes: a tall stone tower, a tiny window, a long golden braid, moon and stars, rolling hills, round trees, floating lanterns.',
    preferredTopics: ['fairy tale', 'Rapunzel', 'storytelling', 'courage', 'freedom'],
    referenceNotes:
      'Retell the classic Brothers Grimm tale in a gentle, child-friendly way (no violence). Scene palette hints: tower stone #8A7FA8 and #5E537D, forest #2F6B4F and #24533D, moon #FFF3C4, lantern glow #FFB347.',
  },
  systemInstructions: `You are designing an animated picture-book telling of Rapunzel for Koma Motion. Each Koma is one illustrated story beat with a short line of narration.

${MOTION_CRAFT}

ART DIRECTION: STORYBOOK
- Build one stage that stays on screen through the whole story. Persistent cast: "moon" (pale circle with a soft halo circle), "hill-back" and "hill-front" (very large circles or rounded rectangles partly below the canvas bottom, in deep greens), trees made of a trunk rectangle plus two or three overlapping circles ("tree-1-crown-a" and so on), and twinkling star dots (star-1 ... star-10).
- The tower (persistentId "tower") is a tall rounded rectangle in stone colours with a darker "tower-shadow" strip, a pointed roof suggested by a rotated square ("tower-roof", rotation 45) and a small glowing "tower-window". Add a few "stone-1" ... small rounded rectangles for texture.
- Rapunzel's braid (persistentId "braid") is a narrow golden rounded rectangle hanging from the window. It is the hero of the motion: short in early Komas, then it grows dramatically in height down to the ground when she lets down her hair, then it is cut short (height shrinks) at the turning point, and in the ending it becomes a golden ribbon shape that travels to the centre. Add "braid-shine" as a thin lighter stripe that moves with it.
- Characters are simple silhouettes: a head circle plus a rounded-rectangle body, with a persistentId per character (rapunzel, prince, gothel). They walk between Komas by moving horizontally, and grow when the camera "moves closer".
- Camera moves: to zoom into the window, scale the tower, window and braid up together and move them so the window is near the centre; to pull back, do the reverse. Keep the moon and hills, but shift them more slowly than the tower for parallax.
- Time of day: recolour "backdrop" from violet dusk to deep night for the lonely years, and to a warm rose dawn (#3A2140 or similar) for the ending. Floating lanterns ("lantern-1" ... "lantern-6", small rounded rectangles in #FFB347 with opacity 0.9) rise upward across the last Komas.
- Narration: one or two short sentences per Koma in a parchment-style caption card (rounded rectangle, fill background colour at 0.85 opacity, stroke primary), always in the same position and with the same persistentId "caption-card" and "caption-text", so only the words change. A small chapter label above it (Chapter 1 ... ) uses the accent colour.
- Keep the story child-friendly: Gothel is cunning but never violent; the ending is joyful and hopeful.`,
  request:
    'Tell the story of Rapunzel as an animated storybook: a title Koma with the tower at dusk, the hidden girl with the golden hair in the tower, "Rapunzel, Rapunzel, let down your hair" with the braid growing to the ground, the prince who hears her singing and climbs up, the turning point when Gothel cuts the braid, the long search through the wild forest, and a joyful ending at dawn with lanterns rising.',
  komaCount: 7,
};

export const STARTER_PRESETS: readonly StarterPreset[] = [SOLAR_SYSTEM, FINANCE_REPORT, RAPUNZEL];

export function getStarterPreset(id: StarterPreset['id']): StarterPreset {
  const preset = STARTER_PRESETS.find((candidate) => candidate.id === id);
  if (preset === undefined) {
    throw new Error(`Unknown starter preset: ${id}`);
  }
  return preset;
}
