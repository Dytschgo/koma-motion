import { pickReadableColour } from '@koma-motion/core';
import type { PresentationGenerationRequest } from '../../contract/request';
import type { AgentElement, AgentKoma, AgentPresentationResponse } from '../../contract/response';
import type {
  AgentTransitionSettings,
  TransitionRegenerationRequest,
} from '../../contract/transition';

/**
 * The demonstration story of the mock provider: three Komas that show what
 * persistent identity and motion mean. It is a pure function of the request,
 * so the same request always produces the same story.
 *
 * The layout is designed for a canvas width of 1920 and scaled horizontally
 * for other aspect ratios.
 */
const DESIGN_WIDTH = 1920;

type ElementOverrides = Partial<AgentElement> &
  Pick<AgentElement, 'persistentId' | 'name' | 'type' | 'x' | 'y' | 'width' | 'height'>;

function element(overrides: ElementOverrides): AgentElement {
  return {
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    text: null,
    fontRole: null,
    fontSize: null,
    fontWeight: null,
    textAlign: null,
    verticalAlign: null,
    textColour: null,
    shape: null,
    cornerRadius: null,
    fillColour: null,
    strokeColour: null,
    strokeWidth: null,
    assetId: null,
    ...overrides,
  };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function buildMockResponse(
  request: PresentationGenerationRequest,
): AgentPresentationResponse {
  const { colours } = request.brandKit;
  const scale = request.canvas.width / DESIGN_WIDTH;

  /** A box whose horizontal position and width follow the canvas width. */
  const box = (x: number, y: number, width: number, height: number): Box => ({
    x: x * scale,
    y,
    width: width * scale,
    height,
  });
  /** A square box around a centre, so circles stay circles on every canvas. */
  const around = (centreX: number, centreY: number, size: number): Box => ({
    x: centreX * scale - size / 2,
    y: centreY - size / 2,
    width: size,
    height: size,
  });

  const onSecondary = pickReadableColour(colours.secondary, [colours.text, colours.background]);

  const text = (
    persistentId: string,
    name: string,
    content: string,
    place: Box,
    overrides: Partial<AgentElement> = {},
  ): AgentElement =>
    element({
      persistentId,
      name,
      type: 'text',
      ...place,
      text: content,
      fontRole: 'body',
      fontSize: 30,
      fontWeight: 400,
      textAlign: 'left',
      verticalAlign: 'top',
      textColour: colours.text,
      zIndex: 10,
      ...overrides,
    });

  const node = (
    persistentId: string,
    label: string,
    place: Box,
    opacity: number,
  ): AgentElement[] => [
    element({
      persistentId: `node-${persistentId}`,
      name: `${label} component`,
      type: 'shape',
      ...place,
      shape: 'roundedRectangle',
      cornerRadius: 20,
      fillColour: colours.secondary,
      opacity,
      zIndex: 3,
    }),
    text(`label-${persistentId}`, `${label} label`, label, place, {
      fontWeight: 600,
      textAlign: 'center',
      verticalAlign: 'middle',
      textColour: onSecondary,
      opacity,
      zIndex: 4,
    }),
  ];

  const link = (index: number, x: number, width: number): AgentElement =>
    element({
      persistentId: `link-${String(index)}`,
      name: `Connection ${String(index)}`,
      type: 'shape',
      ...box(x, 638, width, 4),
      shape: 'line',
      strokeColour: colours.text,
      strokeWidth: 4,
      opacity: 0.45,
      zIndex: 2,
    });

  const engine = (place: Box): AgentElement =>
    element({
      persistentId: 'motion-engine',
      name: 'Motion engine',
      type: 'shape',
      ...place,
      shape: 'circle',
      fillColour: colours.primary,
      zIndex: 6,
    });

  const engineLabel = (centreX: number, y: number): AgentElement =>
    text(
      'label-motion-engine',
      'Motion engine label',
      'Motion engine',
      { x: centreX * scale - 150, y, width: 300, height: 44 },
      { fontWeight: 600, textAlign: 'center', zIndex: 7 },
    );

  const title = (content: string): AgentElement =>
    text('title', 'Title', content, box(96, 88, 1728, 130), {
      fontRole: 'heading',
      fontSize: 96,
      fontWeight: 700,
    });

  const subtitle = (content: string): AgentElement =>
    text('subtitle', 'Subtitle', content, box(96, 236, 1728, 60), {
      fontSize: 38,
      opacity: 0.75,
    });

  /** Present and unchanged in every Koma. */
  const footer = (): AgentElement[] => [
    element({
      persistentId: 'footer-rule',
      name: 'Footer rule',
      type: 'shape',
      ...box(96, 958, 1728, 4),
      shape: 'line',
      strokeColour: colours.text,
      strokeWidth: 2,
      opacity: 0.25,
      zIndex: 1,
    }),
    text('wordmark', 'Wordmark', 'Koma Motion', box(96, 984, 800, 40), {
      fontSize: 22,
      fontWeight: 700,
      opacity: 0.6,
    }),
  ];

  const counter = (index: number): AgentElement =>
    text('frame-counter', 'Koma counter', `0${String(index)} / 03`, box(1424, 984, 400, 40), {
      fontSize: 22,
      textAlign: 'right',
      opacity: 0.6,
    });

  const system: AgentKoma = {
    key: 'system',
    title: 'One connected system',
    purpose: 'Show the complete Koma Motion system as a set of connected components.',
    speakerNotes:
      'Koma Motion connects a Brand Kit, agents, Komas, the motion engine and an editable result. Every component is an object that stays on stage.',
    backgroundColour: colours.background,
    elements: [
      title('Koma Motion'),
      subtitle('Presentations are frames. Make them move.'),
      ...node('brand-kit', 'Brand Kit', box(96, 560, 256, 160), 1),
      link(1, 352, 112),
      ...node('agents', 'Agents', box(464, 560, 256, 160), 1),
      link(2, 720, 112),
      ...node('komas', 'Komas', box(832, 560, 256, 160), 1),
      link(3, 1088, 140),
      engine(around(1328, 640, 200)),
      engineLabel(1328, 756),
      link(4, 1428, 140),
      ...node('output', 'Editable output', box(1568, 560, 256, 160), 1),
      ...footer(),
      counter(1),
    ],
  };

  const focus: AgentKoma = {
    key: 'motion-engine',
    title: 'The motion engine',
    purpose: 'Focus on the motion engine: it moves to the centre and grows.',
    speakerNotes:
      'The motion engine compares two Komas. Objects with the same persistent identity are the same object in a new state, so the engine knows what moved, what changed size, what arrived and what left.',
    backgroundColour: colours.background,
    elements: [
      title('The motion engine'),
      subtitle('It compares two Komas and works out what changed.'),
      ...node('brand-kit', 'Brand Kit', box(96, 430, 208, 130), 0.35),
      ...node('agents', 'Agents', box(96, 600, 208, 130), 0.35),
      ...node('komas', 'Komas', box(1616, 430, 208, 130), 0.35),
      ...node('output', 'Editable output', box(1616, 600, 208, 130), 0.35),
      element({
        persistentId: 'engine-halo',
        name: 'Focus ring',
        type: 'shape',
        ...around(960, 580, 480),
        shape: 'circle',
        strokeColour: colours.accent,
        strokeWidth: 4,
        zIndex: 5,
      }),
      engine(around(960, 580, 400)),
      engineLabel(960, 836),
      text(
        'caption-identity',
        'Identity caption',
        'Objects keep their identity from one Koma to the next.',
        box(360, 892, 1200, 48),
        { fontSize: 32, textAlign: 'center', textColour: colours.accent },
      ),
      ...footer(),
      counter(2),
    ],
  };

  const result: AgentKoma = {
    key: 'editable-result',
    title: 'Motion you can edit',
    purpose:
      'Reveal how the motion model leads to an editable presentation and introduce supporting information.',
    speakerNotes:
      'Because motion is part of the document model, the result stays editable: text stays text, shapes stay shapes and every transition can be adjusted. Export to presentation software is planned and not available yet.',
    backgroundColour: colours.background,
    elements: [
      title('Motion you can edit'),
      subtitle('Every object stays a real, editable object.'),
      engine(around(330, 580, 260)),
      engineLabel(330, 730),
      element({
        persistentId: 'flow-arrow',
        name: 'Flow line',
        type: 'shape',
        ...box(500, 578, 620, 4),
        shape: 'line',
        strokeColour: colours.accent,
        strokeWidth: 4,
        zIndex: 2,
      }),
      element({
        persistentId: 'frame-back',
        name: 'Koma behind',
        type: 'shape',
        ...box(1228, 352, 560, 360),
        shape: 'roundedRectangle',
        cornerRadius: 20,
        strokeColour: colours.text,
        strokeWidth: 2,
        opacity: 0.3,
        zIndex: 1,
      }),
      element({
        persistentId: 'frame-middle',
        name: 'Koma between',
        type: 'shape',
        ...box(1204, 376, 560, 360),
        shape: 'roundedRectangle',
        cornerRadius: 20,
        strokeColour: colours.text,
        strokeWidth: 2,
        opacity: 0.55,
        zIndex: 2,
      }),
      ...node('output', 'Editable output', box(1180, 400, 560, 360), 1),
      text('point-text', 'First point', 'Text stays text', box(560, 620, 560, 44)),
      text('point-shapes', 'Second point', 'Shapes stay shapes', box(560, 676, 560, 44)),
      text('point-motion', 'Third point', 'Motion stays adjustable', box(560, 732, 560, 44)),
      ...footer(),
      counter(3),
    ],
  };

  const objective = request.objective ?? request.userRequest;
  if (request.targetKoma !== undefined) {
    return {
      presentation: {
        title: 'Selected Koma proposal',
        objective: objective.slice(0, 2000),
        audience: request.audience ?? '',
        narrative: 'A preview of one revised Koma.',
      },
      komas: [
        {
          ...focus,
          key: 'selected-proposal',
          title: `Revised: ${request.targetKoma.title}`.slice(0, 300),
          purpose: request.userRequest.slice(0, 2000),
        },
      ],
      transitions: [],
      warnings: [],
      visualRationale:
        'The mock proposes a focused layout for the selected Koma; Apply is required to change the project.',
    };
  }
  const warnings =
    request.requestedKomaCount !== null && request.requestedKomaCount !== 3
      ? ['The mock provider always creates its demonstration story with three Komas.']
      : [];

  return {
    presentation: {
      title: 'Koma Motion',
      objective: objective.slice(0, 2000),
      audience: request.audience ?? 'People who create presentations',
      narrative:
        'The complete system comes first. The motion engine then takes the stage, and finally the editable result is revealed with the motion engine still present as the source of it.',
    },
    komas: [system, focus, result],
    transitions: [
      {
        fromKoma: system.key,
        toKoma: focus.key,
        strategy: 'staged',
        durationMs: 1600,
        easing: 'easeInOut',
        rationale:
          'The connections leave first. Then the motion engine travels to the centre and grows while the other components step back, and the focus ring and caption enter.',
      },
      {
        fromKoma: focus.key,
        toKoma: result.key,
        strategy: 'staged',
        durationMs: 1600,
        easing: 'easeInOut',
        rationale:
          'The explanation of the engine leaves. The engine moves aside and shrinks, the output grows into a Koma, and the supporting points enter last.',
      },
    ],
    visualRationale:
      'One accent-coloured circle carries the story, so the eye follows a single object through all three Komas. Supporting components use the secondary colour and step back when they are not the subject.',
    warnings,
  };
}

function countObjects(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? `object ${singular}` : `objects ${plural}`}`;
}

/**
 * Settings for one regenerated transition. They depend on the request only:
 * the same Komas always give the same answer. The current timing is kept and
 * the rationale describes what the Komas call for now.
 */
export function buildMockTransitionSettings(
  request: TransitionRegenerationRequest,
): AgentTransitionSettings {
  const operations = request.motion.map((entry) => entry.operations);
  const entering = operations.filter((list) => list.includes('fadeIn')).length;
  const exiting = operations.filter((list) => list.includes('fadeOut')).length;
  const changing = operations.filter((list) =>
    list.some(
      (operation) => operation !== 'hold' && operation !== 'fadeIn' && operation !== 'fadeOut',
    ),
  ).length;
  const parts = [
    changing > 0 ? countObjects(changing, 'changes', 'change') : '',
    entering > 0 ? countObjects(entering, 'enters', 'enter') : '',
    exiting > 0 ? countObjects(exiting, 'leaves', 'leave') : '',
  ].filter(Boolean);
  return {
    strategy: request.current.strategy,
    durationMs: Math.min(
      request.durationRangeMs.max,
      Math.max(request.durationRangeMs.min, request.current.durationMs),
    ),
    easing: request.current.easing,
    rationale:
      `Redone for the current Komas "${request.source.title}" and "${request.target.title}": ${
        parts.length === 0 ? 'every object holds its place' : parts.join(', ')
      }.`.slice(0, 1000),
  };
}
