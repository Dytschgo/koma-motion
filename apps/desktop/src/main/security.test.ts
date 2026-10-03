import type { Session } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { hardenSession } from './security';

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    commandLine: {
      getSwitchValue: () => '',
      appendSwitch: () => undefined,
    },
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

describe('session hardening', () => {
  it('denies permission requests and checks, and blocks foreign requests', () => {
    let request:
      | ((contents: unknown, permission: string, callback: (allowed: boolean) => void) => void)
      | undefined;
    let check: ((contents: unknown, permission: string) => boolean) | undefined;
    let beforeRequest:
      | ((details: { url: string }, callback: (result: { cancel: boolean }) => void) => void)
      | undefined;
    const session = {
      setPermissionRequestHandler(
        handler: (
          contents: unknown,
          permission: string,
          callback: (allowed: boolean) => void,
        ) => void,
      ) {
        request = handler;
      },
      setPermissionCheckHandler(handler: (contents: unknown, permission: string) => boolean) {
        check = handler;
      },
      webRequest: {
        onBeforeRequest(
          handler: (
            details: { url: string },
            callback: (result: { cancel: boolean }) => void,
          ) => void,
        ) {
          beforeRequest = handler;
        },
      },
    };
    hardenSession(session as unknown as Session);

    for (const permission of ['notifications', 'media', 'geolocation']) {
      let allowed = true;
      request?.(null, permission, (value) => {
        allowed = value;
      });
      expect(allowed, permission).toBe(false);
      expect(check?.(null, permission), permission).toBe(false);
    }

    const decisionFor = (url: string): { cancel: boolean } | undefined => {
      let decision: { cancel: boolean } | undefined;
      beforeRequest?.({ url }, (result) => {
        decision = result;
      });
      return decision;
    };
    expect(decisionFor('https://example.com/')).toEqual({ cancel: true });
    expect(decisionFor('devtools://devtools/bundled/inspector.html')).toEqual({ cancel: true });
    expect(decisionFor('koma://app/index.html')).toEqual({ cancel: false });
    expect(decisionFor('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toEqual({ cancel: false });
  });
});
