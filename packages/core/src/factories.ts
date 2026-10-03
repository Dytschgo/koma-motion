import type { HexColour } from './colour';
import type { AspectRatio } from './geometry';
import type { IdGenerator } from './ids';
import type { BrandKit } from './schema/brandKit';
import type { Koma } from './schema/koma';
import type { Presentation } from './schema/presentation';
import {
  CURRENT_SCHEMA_VERSION,
  PROJECT_FORMAT,
  type AgentConfiguration,
  type KomaProject,
} from './schema/project';

export const DEFAULT_PROVIDER_ID = 'mock';
export const DEFAULT_AGENT_TIMEOUT_SECONDS = null;

export function createAgentConfiguration(): AgentConfiguration {
  return {
    selectedProviderId: DEFAULT_PROVIDER_ID,
    timeoutSeconds: DEFAULT_AGENT_TIMEOUT_SECONDS,
    providers: {},
  };
}

export function createKoma(options: {
  readonly idGenerator: IdGenerator;
  readonly title: string;
  readonly backgroundColour: HexColour;
}): Koma {
  return {
    id: options.idGenerator.next('koma'),
    title: options.title,
    purpose: '',
    speakerNotes: '',
    holdDurationMs: null,
    background: { type: 'solid', colour: options.backgroundColour },
    elements: [],
  };
}

export function createPresentation(options: {
  readonly idGenerator: IdGenerator;
  readonly title: string;
  readonly aspectRatio?: AspectRatio;
}): Presentation {
  return {
    id: options.idGenerator.next('presentation'),
    title: options.title,
    objective: '',
    audience: '',
    narrative: '',
    aspectRatio: options.aspectRatio ?? '16:9',
    komas: [],
    transitions: [],
  };
}

export function createProject(options: {
  readonly idGenerator: IdGenerator;
  readonly name: string;
  readonly brandKit: BrandKit;
  /** Current time as an ISO 8601 timestamp. */
  readonly now: string;
}): KomaProject {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.idGenerator.next('project'),
    name: options.name,
    createdAt: options.now,
    updatedAt: options.now,
    brandKit: options.brandKit,
    presentation: createPresentation({ idGenerator: options.idGenerator, title: options.name }),
    assets: [],
    agentConfiguration: createAgentConfiguration(),
    systemInstructions: '',
    generationHistory: [],
  };
}
