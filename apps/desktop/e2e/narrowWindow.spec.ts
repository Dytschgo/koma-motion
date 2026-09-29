import { expect, test } from '@playwright/test';
import { launchApplication } from './application';

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
