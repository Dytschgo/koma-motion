/**
 * The pages of Settings and where each one keeps its values. Pure data, so
 * the order, the scope labels and keyboard movement can be tested without a
 * window.
 *
 * The scope says where a change is stored. It follows the existing storage
 * and does not move any setting: project settings live in the .koma file and
 * can be undone, app settings live in the application data folder, and
 * provider availability is checked on this computer and not stored.
 */

export type SettingsScope = 'project' | 'app' | 'computer';

export const SETTINGS_PAGES = [
  {
    id: 'instructions',
    label: 'Instructions',
    scope: 'project',
    description: 'Guidance that the agent receives with every request for this project.',
  },
  {
    id: 'generation',
    label: 'Generation',
    scope: 'project',
    description: 'Time limit and the model each provider uses for this project.',
  },
  {
    id: 'templates',
    label: 'Templates',
    scope: 'app',
    description: 'Reusable instructions you can copy into any project.',
  },
  {
    id: 'providers',
    label: 'Providers',
    scope: 'computer',
    description: 'The agents Koma Motion can run on this computer, and what they send online.',
  },
  {
    id: 'updates',
    label: 'Updates',
    scope: 'app',
    description: 'The installed version and the update channel of Koma Motion.',
  },
  {
    id: 'about',
    label: 'About',
    scope: 'app',
    description: 'Version, licence and export formats.',
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly scope: SettingsScope;
  readonly description: string;
}[];

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]['id'];
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'instructions';

/** How each scope is named in the navigation and on the page. */
export const SETTINGS_SCOPES: Readonly<
  Record<SettingsScope, { readonly group: string; readonly badge: string; readonly note: string }>
> = {
  project: {
    group: 'This project',
    badge: 'Project',
    note: 'Saved in the .koma file of this project. Undo applies.',
  },
  app: {
    group: 'Koma Motion',
    badge: 'App',
    note: 'Saved in Koma Motion on this computer. Applies to every project.',
  },
  computer: {
    group: 'Koma Motion',
    badge: 'This computer',
    note: 'Checked on this computer. Nothing is saved.',
  },
};

export function getSettingsPage(id: SettingsPageId): SettingsPage {
  return SETTINGS_PAGES.find((page) => page.id === id) ?? SETTINGS_PAGES[0];
}

/** The pages under one heading of the navigation, in order. */
export function groupSettingsPages(): readonly {
  readonly heading: string;
  readonly pages: readonly SettingsPage[];
}[] {
  const groups: { heading: string; pages: SettingsPage[] }[] = [];
  for (const page of SETTINGS_PAGES) {
    const heading = SETTINGS_SCOPES[page.scope].group;
    const last = groups.at(-1);
    if (last?.heading === heading) {
      last.pages.push(page);
    } else {
      groups.push({ heading, pages: [page] });
    }
  }
  return groups;
}

/**
 * The page that a navigation key moves to. Arrow keys wrap around, Home and
 * End go to the ends. Other keys return `null`.
 */
export function movePage(current: SettingsPageId, key: string): SettingsPageId | null {
  const index = SETTINGS_PAGES.findIndex((page) => page.id === current);
  const count = SETTINGS_PAGES.length;
  const target =
    key === 'ArrowDown'
      ? (index + 1) % count
      : key === 'ArrowUp'
        ? (index - 1 + count) % count
        : key === 'Home'
          ? 0
          : key === 'End'
            ? count - 1
            : null;
  return target === null ? null : (SETTINGS_PAGES[target]?.id ?? null);
}
