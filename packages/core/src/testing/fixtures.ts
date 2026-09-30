/**
 * Small builders for tests. They live in the core package so that every
 * package tests against the same valid baseline documents.
 */
import type { BrandKit } from '../schema/brandKit';
import type { ShapeElement, TextElement } from '../schema/element';
import type { Koma } from '../schema/koma';
import type { Presentation } from '../schema/presentation';
import { CURRENT_SCHEMA_VERSION, PROJECT_FORMAT, type KomaProject } from '../schema/project';

export const FIXTURE_TIMESTAMP = '2026-01-15T10:30:00.000Z';

export function buildBrandKit(overrides: Partial<BrandKit> = {}): BrandKit {
  return {
    name: 'Fixture Brand',
    colours: {
      primary: '#FF5A36',
      secondary: '#2B3A55',
      accent: '#F2C14E',
      background: '#0E0F13',
      text: '#F2EFE9',
    },
    typography: { headingFont: 'Georgia', bodyFont: 'Arial' },
    logoAssetId: null,
    tone: 'Clear and confident',
    visualStyle: 'Minimal',
    iconStyle: 'Outlined',
    preferredImagery: 'Abstract geometry',
    preferredTopics: ['motion'],
    referenceNotes: '',
    ...overrides,
  };
}

export function buildShape(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'element-shape',
    persistentId: 'shape',
    name: 'Shape',
    type: 'shape',
    position: { x: 100, y: 100 },
    size: { width: 200, height: 200 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: false,
    visible: true,
    content: { shape: 'circle', cornerRadius: 0 },
    style: { fill: '#FF5A36', stroke: null, strokeWidth: 0 },
    ...overrides,
  };
}

export function buildText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'element-text',
    persistentId: 'text',
    name: 'Text',
    type: 'text',
    position: { x: 100, y: 400 },
    size: { width: 800, height: 120 },
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    locked: false,
    visible: true,
    content: { text: 'Presentations are frames.' },
    style: {
      fontFamily: 'Georgia',
      fontSize: 64,
      fontWeight: 700,
      colour: '#F2EFE9',
      textAlign: 'left',
      verticalAlign: 'top',
      lineHeight: 1.2,
    },
    ...overrides,
  };
}

export function buildKoma(overrides: Partial<Koma> = {}): Koma {
  return {
    id: 'koma-1',
    title: 'Koma',
    purpose: '',
    speakerNotes: '',
    background: { type: 'solid', colour: '#0E0F13' },
    elements: [buildShape(), buildText()],
    ...overrides,
  };
}

export function buildPresentation(overrides: Partial<Presentation> = {}): Presentation {
  return {
    id: 'presentation-1',
    title: 'Fixture presentation',
    objective: '',
    audience: '',
    narrative: '',
    aspectRatio: '16:9',
    komas: [buildKoma()],
    transitions: [],
    ...overrides,
  };
}

export function buildProject(overrides: Partial<KomaProject> = {}): KomaProject {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: 'project-1',
    name: 'Fixture project',
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    brandKit: buildBrandKit(),
    presentation: buildPresentation(),
    assets: [],
    agentConfiguration: { selectedProviderId: 'mock', timeoutSeconds: null, providers: {} },
    systemInstructions: '',
    generationHistory: [],
    ...overrides,
  };
}
