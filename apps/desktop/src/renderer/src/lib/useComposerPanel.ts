import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Sidebar focus, mutually exclusive choices and measured popup space. */
export function useComposerPanel(projectId: string, open: boolean) {
  const [choice, setChoice] = useState<'model' | 'count' | 'brand' | null>(null);
  const section = useRef<HTMLElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const [pickerMaxHeight, setPickerMaxHeight] = useState<number>();
  const requestField = useRef<HTMLTextAreaElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const countButton = useRef<HTMLButtonElement>(null);
  const choicesPanel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const choiceProject = useRef(projectId);
  useEffect(() => {
    if (!open || choiceProject.current !== projectId) {
      setChoice(null);
    }
    choiceProject.current = projectId;
  }, [open, projectId]);

  // A long request in a short window leaves less room above the composer.
  // Bound the popup to that actual space so it never covers the chat header.
  useLayoutEffect(() => {
    if (choice === null || composer.current === null || header.current === null) return;
    const measure = (): void => {
      const top = composer.current?.getBoundingClientRect().top;
      const bottom = header.current?.getBoundingClientRect().bottom;
      if (top !== undefined && bottom !== undefined) {
        setPickerMaxHeight(Math.max(64, Math.floor(top - bottom - 12)));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer.current);
    if (section.current !== null) observer.observe(section.current);
    return () => observer.disconnect();
  }, [choice]);

  useEffect(() => {
    if (choice === null || choice === 'brand') return;
    const trigger = choice === 'model' ? modelButton.current : countButton.current;
    choicesPanel.current
      ?.querySelector<HTMLElement>(
        choice === 'model'
          ? 'input[type="search"]:not(:disabled)'
          : 'select:not(:disabled), input:not(:disabled), button:not(:disabled)',
      )
      ?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !trigger?.contains(event.target) &&
        !choicesPanel.current?.contains(event.target)
      ) {
        setChoice(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [choice]);

  // Opening moves focus to the request. Closing moves it to the control that
  // opens the chat again, so focus is never lost in the hidden panel.
  useEffect(() => {
    if (wasOpen.current === open) {
      return;
    }
    wasOpen.current = open;
    if (open) {
      requestField.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body || section.current?.contains(active)) {
      showButton.current?.focus();
    }
  }, [open]);

  return {
    choice,
    setChoice,
    section,
    header,
    composer,
    pickerMaxHeight,
    requestField,
    showButton,
    modelButton,
    countButton,
    choicesPanel,
  };
}
export type ComposerPanel = ReturnType<typeof useComposerPanel>;
