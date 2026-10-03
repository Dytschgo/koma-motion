import {
  ASPECT_RATIOS,
  createSeededIdGenerator,
  getCanvasSize,
  komaProjectSchema,
  MAX_ELEMENTS_PER_KOMA,
} from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildText } from '@koma-motion/core/testing';
import { syncTransitions, validateTransition } from '@koma-motion/motion-engine';
import { parseProject, serialiseProject } from '@koma-motion/project-format';
import { describe, expect, it } from 'vitest';
import { AUTHORING_KINDS } from '../lib/authoring';
import { getCanvasPlacement, orderLayers } from '../lib/layers';
import { createElement } from './commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

const koma = buildKoma({ elements: [] });
const base = buildProject({ presentation: buildPresentation({ komas: [koma], transitions: [] }) });
const ids = () => createSeededIdGenerator('authoring');

describe('direct authoring', () => {
  it('creates independent, visible objects with current Brand Kit defaults inside each canvas', () => {
    const brandKit = {
      ...base.brandKit,
      colours: { ...base.brandKit.colours, primary: '#123456', text: '#654321' },
      typography: { headingFont: 'Arial', bodyFont: 'Georgia' },
    };
    for (const aspectRatio of ASPECT_RATIOS) {
      let project = { ...base, brandKit, presentation: { ...base.presentation, aspectRatio } };
      const generator = ids();
      for (const kind of AUTHORING_KINDS)
        project = createElement(koma.id, kind)(project, generator);
      const elements = project.presentation.komas[0]?.elements ?? [];
      expect(elements).toHaveLength(4);
      expect(new Set(elements.map((item) => item.id)).size).toBe(4);
      expect(new Set(elements.map((item) => item.persistentId)).size).toBe(4);
      expect(komaProjectSchema.safeParse(project).success).toBe(true);
      for (const element of elements) {
        expect(element).toMatchObject({ locked: false, visible: true, opacity: 1, rotation: 0 });
        expect(getCanvasPlacement(element, getCanvasSize(aspectRatio))).toBe('inside');
        if (element.type === 'text')
          expect(element.style).toMatchObject({ colour: '#654321', fontFamily: 'Georgia' });
        else if (element.type === 'shape') {
          expect(element.style).toMatchObject(
            element.content.shape === 'line'
              ? { fill: null, stroke: '#123456', strokeWidth: 4 }
              : { fill: '#123456' },
          );
          if (element.content.shape === 'circle')
            expect(element.size.width).toBe(element.size.height);
        }
      }
      expect(orderLayers(elements)[0]?.name).toBe('Line');
      expect(project.generationHistory).toEqual([]);
    }
    expect(base.presentation.komas[0]?.elements).toEqual([]);
  });

  it('places creation in front at the maximum z-index and ignores a missing Koma', () => {
    const old = buildText({ zIndex: 10000 });
    const project = {
      ...base,
      presentation: { ...base.presentation, komas: [{ ...koma, elements: [old] }] },
    };
    const command = createElement(koma.id, 'rectangle');
    const next = command(project, ids());
    expect(command.affectedKomaIds).toEqual([koma.id]);
    expect(orderLayers(next.presentation.komas[0]?.elements ?? [])[0]?.name).toBe('Rectangle');
    expect(createElement('missing', 'text')(project, ids())).toBe(project);
  });

  it('rejects element limits and identity collisions before committing', () => {
    const crowded = {
      ...base,
      presentation: {
        ...base.presentation,
        komas: [
          {
            ...koma,
            elements: Array.from({ length: MAX_ELEMENTS_PER_KOMA }, (_, i) =>
              buildText({ id: `text-${i}`, persistentId: `object-${i}` }),
            ),
          },
        ],
      },
    };
    useProjectStore.getState().load(crowded, null);
    expect(() => useProjectStore.getState().apply(createElement(koma.id, 'text'))).toThrow(
      'element limit',
    );
    expect(selectProject(useProjectStore.getState())).toBe(crowded);
    expect(useProjectStore.getState().history?.past).toEqual([]);
    const first = createElement(koma.id, 'text')(base, ids());
    expect(() => createElement(koma.id, 'circle')(first, ids())).toThrow();
  });

  it('creates in one undo step, keeps stored motion explicit, and survives file round trip', () => {
    const project = {
      ...base,
      presentation: syncTransitions(
        buildPresentation({
          komas: [koma, buildKoma({ id: 'koma-2', elements: [] })],
          transitions: [],
        }),
        ids(),
      ).presentation,
    };
    const transition = project.presentation.transitions[0];
    if (!transition) throw new Error('Expected transition');
    const store = useProjectStore;
    store.getState().load(project, null);
    store.getState().apply(createElement(koma.id, 'text'));
    const created = selectProject(store.getState());
    if (!created) throw new Error('Expected project');
    expect(store.getState().history?.past).toHaveLength(1);
    expect(selectHasUnsavedChanges(store.getState())).toBe(true);
    expect(created.presentation.transitions).toBe(project.presentation.transitions);
    expect(
      validateTransition(transition, created.presentation).map((issue) => issue.code),
    ).toContain('staleTransition');
    store.getState().undo();
    expect(selectProject(store.getState())).toBe(project);
    store.getState().redo();
    expect(selectProject(store.getState())).toBe(created);
    const saved = serialiseProject(created);
    if (!saved.ok) throw new Error(saved.error.message);
    const opened = parseProject(saved.value);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.project.presentation).toEqual(created.presentation);
  });

  it('reveals properties only on request and preserves wide chat and chosen width', () => {
    const ui = useUiStore;
    ui.getState().reset();
    ui.getState().setAgentPanelOpen(true);
    ui.getState().setAgentPanelWidth(410);
    ui.getState().selectElement('element');
    expect(ui.getState().agentPanelOpen).toBe(true);
    ui.getState().inspectSelectedElement(false);
    expect(ui.getState().agentPanelOpen).toBe(true);
    ui.getState().inspectSelectedElement(true);
    expect(ui.getState()).toMatchObject({
      view: 'canvas',
      inspectorTab: 'element',
      agentPanelOpen: false,
      agentPanelWidth: 410,
      selectedElementId: 'element',
    });
    ui.getState().setAgentPanelOpen(true);
    ui.getState().selectElement(null);
    ui.getState().inspectSelectedElement(true);
    expect(ui.getState().agentPanelOpen).toBe(true);
    ui.getState().reset();
  });
});
