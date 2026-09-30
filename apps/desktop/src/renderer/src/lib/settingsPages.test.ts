import { describe, expect, it } from 'vitest';
import {
  getSettingsPage,
  groupSettingsPages,
  movePage,
  SETTINGS_PAGES,
  SETTINGS_SCOPES,
} from './settingsPages';

describe('settings pages', () => {
  it('lists project pages first, then the app pages', () => {
    expect(groupSettingsPages().map((group) => group.heading)).toEqual([
      'This project',
      'Koma Motion',
    ]);
    expect(groupSettingsPages()[0]?.pages.map((page) => page.id)).toEqual([
      'instructions',
      'generation',
    ]);
  });

  it('keeps each setting in the scope where it is stored today', () => {
    const scopes = Object.fromEntries(SETTINGS_PAGES.map((page) => [page.id, page.scope]));
    // Instructions, the time limit and models are part of the .koma file.
    expect(scopes['instructions']).toBe('project');
    expect(scopes['generation']).toBe('project');
    // The template library and the update channel are stored by the app.
    expect(scopes['templates']).toBe('app');
    expect(scopes['updates']).toBe('app');
    // Provider availability is detected, not stored.
    expect(scopes['providers']).toBe('computer');
    expect(SETTINGS_SCOPES.project.note).toContain('Undo applies');
  });

  it('moves with arrow keys, wraps around and jumps with Home and End', () => {
    expect(movePage('instructions', 'ArrowDown')).toBe('generation');
    expect(movePage('instructions', 'ArrowUp')).toBe('about');
    expect(movePage('about', 'ArrowDown')).toBe('instructions');
    expect(movePage('updates', 'Home')).toBe('instructions');
    expect(movePage('generation', 'End')).toBe('about');
    expect(movePage('generation', 'Enter')).toBeNull();
  });

  it('finds a page by id', () => {
    expect(getSettingsPage('providers').label).toBe('Providers');
  });
});
