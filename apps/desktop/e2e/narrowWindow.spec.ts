import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import {
  answerSaveDialog,
  launchApplication,
  chooseProjectCommand,
  showTransitionControls,
} from './application';

test('keeps the saved filename and toolbar actions visible on smaller screens', async () => {
  const running = await launchApplication();
  const { window, application, directory } = running;
  try {
    await window.getByRole('button', { name: 'Create a project' }).click();
    await answerSaveDialog(application, join(directory, 'introduction.koma'));
    await chooseProjectCommand(window, 'Save');
    const header = window.getByRole('banner');
    for (const width of [1280, 1120, 1024]) {
      await application.evaluate(({ BrowserWindow }, contentWidth) => {
        const native = BrowserWindow.getAllWindows()[0];
        native?.setMinimumSize(800, 600);
        native?.setContentSize(contentWidth, 700);
      }, width);
      // The saved file is named by the saved state's tooltip rather than more bar text.
      const saved = header.getByText('All changes saved');
      await expect(saved).toBeVisible();
      await expect(saved).toHaveAttribute('title', /introduction.koma$/);
      for (const name of ['Project menu', 'Undo', 'Add element', 'Share']) {
        await expect(header.getByRole('button', { name, exact: true })).toBeInViewport({
          ratio: 1,
        });
      }
      await window.screenshot({
        path: test.info().outputPath(`toolbar-${width}.png`),
        scale: 'css',
      });
    }
    expect(running.problems).toEqual([]);
  } finally {
    await running.close();
  }
});

test('keeps the position control usable in a narrow window with reduced motion', async () => {
  const running = await launchApplication();
  const { window, application } = running;
  try {
    // Narrower than the minimum width: what a small screen gives the window.
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1024, 700);
    });
    await window.emulateMedia({ reducedMotion: 'reduce' });
    await window.getByRole('button', { name: 'Create a project' }).click();
    await window.getByRole('button', { name: 'Use the example request' }).click();
    await window.getByRole('button', { name: 'Generate Komas' }).click();
    await expect(window.getByText(/Created 3 Komas/)).toBeVisible();

    // Both must be visible: neither may push the other out of the window.
    await showTransitionControls(window);
    await expect(window.getByText(/Reduced motion is on/)).toBeVisible();
    const slider = window.getByLabel('Position in the transition');
    await expect(slider).toBeVisible();
    const box = await slider.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(96);
    await slider.fill('500');
    await expect(slider).toHaveAttribute('aria-valuetext', '50 percent');
  } finally {
    await running.close();
  }
});
