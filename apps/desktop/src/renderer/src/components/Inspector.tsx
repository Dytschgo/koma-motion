import { type KomaProject, type KomaTransition } from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { getMotionStatus } from '../lib/motionSummary';
import {
  getTransitionOfKoma,
  useCurrentTransition,
  useSelectedElement,
  useSelectedKoma,
} from '../lib/selectors';
import { canRecalculateTransition } from '../state/commands';
import { useUiStore, type InspectorTab } from '../state/uiStore';
import { ElementPanel } from './inspector/ElementPanel';
import { KomaPanel } from './inspector/KomaPanel';
import { LayersPanel } from './inspector/LayersPanel';
import { MotionPanel, type TransitionHealth } from './inspector/MotionPanel';

const TABS: readonly { readonly id: InspectorTab; readonly label: string }[] = [
  { id: 'element', label: 'Element' },
  { id: 'koma', label: 'Koma' },
  { id: 'motion', label: 'Motion' },
];

function useTransitionHealth(
  project: KomaProject,
  transition: KomaTransition | null,
): TransitionHealth | null {
  return useMemo(() => {
    if (transition === null) {
      return null;
    }
    const issues = validateTransition(transition, project.presentation);
    const status = getMotionStatus(issues);
    const canRecalculate =
      (status.health === 'stale' || status.health === 'blocked') &&
      canRecalculateTransition(project.presentation, transition.id);
    return { issues, status, canRecalculate };
  }, [project, transition]);
}

/**
 * The properties of what the person works on. Three contexts share the
 * column: the selected element, the Koma, and the motion to the next Koma.
 * Selection chooses the context; the tabs let the person switch. The layer
 * list stays below the element and Koma contexts.
 */
export function Inspector({ project }: { readonly project: KomaProject }): ReactElement {
  const preview = useUiStore((state) => state.preview);
  const tab = useUiStore((state) => state.inspectorTab);
  const setTab = useUiStore((state) => state.setInspectorTab);
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  const selectElement = useUiStore((state) => state.selectElement);
  const koma = useSelectedKoma();
  const element = useSelectedElement();
  const transition = useCurrentTransition();
  const komaTransition = getTransitionOfKoma(project.presentation, koma?.id ?? null);
  const health = useTransitionHealth(project, transition);
  const komaHealth = useTransitionHealth(project, komaTransition);
  const { komas } = project.presentation;
  const index = komas.findIndex((candidate) => candidate.id === koma?.id);
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // A selection whose element is gone, after a deletion or an undo, is cleared.
  useEffect(() => {
    if (selectedElementId !== null && element === null) {
      selectElement(null);
    }
  }, [selectedElementId, element, selectElement]);

  // A new context starts at its top.
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab, element?.id, koma?.id]);

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, position: number): void => {
    const next =
      event.key === 'ArrowRight'
        ? TABS[(position + 1) % TABS.length]
        : event.key === 'ArrowLeft'
          ? TABS[(position - 1 + TABS.length) % TABS.length]
          : event.key === 'Home'
            ? TABS[0]
            : event.key === 'End'
              ? TABS.at(-1)
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setTab(next.id);
    tabs.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  const motionNeedsAttention = health !== null && health.status.health !== 'ready';

  return (
    <aside
      aria-label="Inspector"
      className="flex w-[304px] flex-none flex-col border-l border-line bg-surface-1"
    >
      {koma === null ? (
        <p className="p-4 text-ink-400">Select a Koma to see its details.</p>
      ) : (
        <>
          <div className="flex-none px-3 pt-3 pb-2">
            <div
              ref={tabs}
              role="tablist"
              aria-label="Inspector context"
              className="grid grid-cols-3 gap-0.5 rounded-control border border-line bg-surface-0 p-0.5"
            >
              {TABS.map((item, position) => {
                const selected = item.id === tab;
                const label =
                  item.id === 'element' && element !== null
                    ? `${item.label}: ${element.name.trim() === '' ? element.type : element.name}`
                    : item.id === 'motion' && motionNeedsAttention
                      ? `${item.label}, needs attention`
                      : item.label;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    data-tab={item.id}
                    id={`${id}-${item.id}-tab`}
                    aria-label={label}
                    aria-selected={selected}
                    aria-controls={`${id}-panel`}
                    tabIndex={selected ? 0 : -1}
                    className={`relative flex h-7 items-center justify-center gap-1.5 rounded-md text-sm ${
                      selected
                        ? 'bg-surface-3 font-semibold text-ink-100 shadow-raised'
                        : 'text-ink-400 hover:bg-surface-2 hover:text-ink-100'
                    }`}
                    onClick={() => {
                      setTab(item.id);
                    }}
                    onKeyDown={(event) => {
                      moveTab(event, position);
                    }}
                  >
                    {item.label}
                    {item.id === 'motion' && motionNeedsAttention && (
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-signal-warn" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            ref={scroller}
            role="tabpanel"
            id={`${id}-panel`}
            aria-labelledby={`${id}-${tab}-tab`}
            className="min-h-0 flex-1 overflow-y-auto border-t border-line"
          >
            {tab === 'motion' ? (
              <MotionPanel
                key={transition?.id ?? 'none'}
                project={project}
                transition={transition}
                health={health}
                komaId={koma.id}
              />
            ) : (
              <fieldset disabled={preview !== null} className="min-w-0">
                {tab === 'element' ? (
                  element === null ? (
                    <div className="flex flex-col gap-2 px-3 py-3">
                      <h2 className="text-base font-semibold text-ink-100">Element</h2>
                      <p className="text-ink-400">
                        {koma.elements.length === 0
                          ? 'This Koma has no elements yet.'
                          : 'Select an element on the canvas or in Layers to edit it.'}
                      </p>
                    </div>
                  ) : (
                    <ElementPanel
                      key={element.id}
                      project={project}
                      koma={koma}
                      element={element}
                    />
                  )
                ) : (
                  <KomaPanel
                    key={koma.id}
                    koma={koma}
                    index={index}
                    count={komas.length}
                    health={komaHealth}
                    editable={preview === null}
                  />
                )}
              </fieldset>
            )}
          </div>

          {tab !== 'motion' && (
            <LayersPanel
              koma={koma}
              aspectRatio={project.presentation.aspectRatio}
              disabled={preview !== null}
            />
          )}
        </>
      )}
    </aside>
  );
}
