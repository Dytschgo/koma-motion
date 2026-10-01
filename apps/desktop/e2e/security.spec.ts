import { createSocket, type Socket } from 'node:dgram';
import { readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { connect, createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApplication, type RunningApplication, openSettingsPage } from './application';

const RENDERER_DIRECTORY = resolve(import.meta.dirname, '../out/renderer');
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_BASE64, 'base64');
const DATA_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const REPOSITORY = 'https://github.com/Dytschgo/koma-motion';

interface UdpListener {
  readonly port: number;
  count: () => number;
  reset: () => void;
  close: () => Promise<void>;
}

interface TcpListener {
  readonly port: number;
  count: () => number;
  reset: () => void;
  close: () => Promise<void>;
}

let running: RunningApplication;

test.beforeEach(async () => {
  running = await launchApplication();
});

test.afterEach(async () => {
  await running.close();
});

/** Binds a UDP socket. Returns null when this machine cannot bind that address. */
async function listenUdp(host: string): Promise<UdpListener | null> {
  const socket: Socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');
  let packets = 0;
  socket.on('message', () => {
    packets += 1;
  });
  try {
    await new Promise<void>((resolveBind, rejectBind) => {
      socket.once('error', rejectBind);
      socket.bind(0, host, () => {
        socket.off('error', rejectBind);
        resolveBind();
      });
    });
  } catch {
    socket.close();
    return null;
  }
  const address = socket.address();
  if (typeof address === 'string') {
    socket.close();
    return null;
  }
  return {
    port: address.port,
    count: () => packets,
    reset: () => {
      packets = 0;
    },
    close: () =>
      new Promise((resolveClose) => {
        socket.close(() => resolveClose());
      }),
  };
}

async function listenTcp(): Promise<TcpListener> {
  let connections = 0;
  const server: Server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The TCP listener has no port');
  }
  return {
    port: address.port,
    count: () => connections,
    reset: () => {
      connections = 0;
    },
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

async function proveUdp(listener: UdpListener, host: string): Promise<void> {
  const probe = createSocket(host.includes(':') ? 'udp6' : 'udp4');
  try {
    await new Promise<void>((resolveSend, rejectSend) => {
      probe.send(Buffer.from('probe'), listener.port, host, (error) => {
        if (error) {
          rejectSend(error);
        } else {
          resolveSend();
        }
      });
    });
    await expect.poll(() => listener.count()).toBeGreaterThan(0);
  } finally {
    probe.close();
    listener.reset();
  }
}

async function proveTcp(listener: TcpListener): Promise<void> {
  await new Promise<void>((resolveConnect, rejectConnect) => {
    const socket = connect(listener.port, '127.0.0.1', () => {
      socket.end();
      resolveConnect();
    });
    socket.on('error', rejectConnect);
  });
  await expect.poll(() => listener.count()).toBeGreaterThan(0);
  listener.reset();
}

async function settle(): Promise<void> {
  await new Promise((resolveDelay) => {
    setTimeout(resolveDelay, 400);
  });
}

/**
 * A renderer crash rejects the page evaluation. Return that outcome instead of
 * leaving the test waiting on a promise that will not settle.
 */
async function untilCrash<T>(
  window: Page,
  run: () => Promise<T>,
): Promise<{ crashed: boolean; value?: T }> {
  let crashed = false;
  const onCrash = (): void => {
    crashed = true;
  };
  window.once('crash', onCrash);
  try {
    const value = await run();
    return { crashed: false, value };
  } catch (error) {
    if (crashed) {
      return { crashed: true };
    }
    throw error;
  } finally {
    window.off('crash', onCrash);
  }
}

function removeDirectoryLink(link: string): void {
  try {
    unlinkSync(link);
  } catch {
    rmSync(link, { recursive: false, force: true });
  }
}

test('loads the application, fonts and images, and rejects protocol escapes', async () => {
  const { window } = running;
  await expect(window.getByRole('heading', { name: /Presentations are frames/ })).toBeVisible();

  const font = await window.evaluate(async () => {
    const page = globalThis as unknown as {
      document: { fonts: { load: (fontSpec: string) => Promise<unknown[]> } };
    };
    const faces = await page.document.fonts.load('16px "Instrument Sans Variable"');
    return faces.length;
  });
  expect(font).toBeGreaterThan(0);

  const dataWidth = await window.evaluate(async (url) => {
    const page = globalThis as unknown as {
      document: {
        createElement: (tag: string) => {
          src: string;
          naturalWidth: number;
          decode: () => Promise<void>;
        };
      };
    };
    const image = page.document.createElement('img');
    image.src = url;
    await image.decode();
    return image.naturalWidth;
  }, DATA_GIF);
  expect(dataWidth).toBe(1);

  const legitimate = join(RENDERER_DIRECTORY, 'e2e-ok.png');
  const host = join(RENDERER_DIRECTORY, 'e2e-host.png');
  const outside = await mkdtemp(join(tmpdir(), 'koma-escape-'));
  const link = join(RENDERER_DIRECTORY, 'e2e-escape');
  writeFileSync(join(outside, 'secret.png'), PNG);
  writeFileSync(legitimate, PNG);
  writeFileSync(`${host}:hidden.png`, PNG);
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const loaded = await loadImage(window, 'koma://app/e2e-ok.png');
    const junction = await loadImage(window, 'koma://app/e2e-escape/secret.png');
    const stream = await loadImage(window, 'koma://app/e2e-host.png:hidden.png');
    const encodedStream = await loadImage(window, 'koma://app/e2e-host.png%3Ahidden.png');
    expect(loaded).toBe('loaded');
    expect(junction).toBe('error');
    expect(stream).toBe('error');
    expect(encodedStream).toBe('error');
    expect(readFileSync(join(outside, 'secret.png')).equals(PNG)).toBe(true);
  } finally {
    removeDirectoryLink(link);
    expect(readFileSync(join(outside, 'secret.png')).equals(PNG)).toBe(true);
    await rm(outside, { recursive: true, force: true });
    rmSync(legitimate, { force: true });
    rmSync(host, { force: true });
  }
});

async function loadImage(window: Page, url: string): Promise<string> {
  return window.evaluate(async (imageUrl) => {
    const page = globalThis as unknown as {
      document: {
        createElement: (tag: string) => {
          src: string;
          naturalWidth: number;
          decode: () => Promise<void>;
        };
      };
    };
    const image = page.document.createElement('img');
    image.src = imageUrl;
    try {
      await image.decode();
      return image.naturalWidth > 0 ? 'loaded' : 'empty';
    } catch {
      return 'error';
    }
  }, url);
}

test('sends no WebRTC packets to local listeners', async () => {
  const udp4 = await listenUdp('127.0.0.1');
  const udp6 = await listenUdp('::1');
  const tcp = await listenTcp();
  if (udp4 === null) {
    throw new Error('Could not bind a UDP listener on 127.0.0.1');
  }
  try {
    await proveUdp(udp4, '127.0.0.1');
    await proveTcp(tcp);
    if (udp6 !== null) {
      await proveUdp(udp6, '::1');
    } else {
      test.info().annotations.push({
        type: 'unverified',
        description: 'IPv6 STUN was not attempted because ::1 could not be bound.',
      });
    }

    const attempts = await untilCrash(running.window, () =>
      running.window.evaluate(
        async (ports: { udp4: number; udp6: number; tcp: number; tryIpv6: boolean }) => {
          const page = globalThis as unknown as {
            RTCPeerConnection: new (config?: unknown) => {
              createDataChannel: (label: string) => void;
              createOffer: () => Promise<unknown>;
              setLocalDescription: (description: unknown) => Promise<void>;
              close: () => void;
              iceGatheringState: string;
              addEventListener: (type: string, listener: () => void) => void;
            };
            setTimeout: (handler: () => void, timeout: number) => number;
            clearTimeout: (handle: number) => void;
          };

          async function gather(url: string): Promise<string> {
            try {
              const connection = new page.RTCPeerConnection({ iceServers: [{ urls: url }] });
              connection.createDataChannel('probe');
              const offer = await connection.createOffer();
              await connection.setLocalDescription(offer);
              await new Promise<void>((resolveGather) => {
                if (connection.iceGatheringState === 'complete') {
                  resolveGather();
                  return;
                }
                const timer = page.setTimeout(() => resolveGather(), 1500);
                connection.addEventListener('icegatheringstatechange', () => {
                  if (connection.iceGatheringState === 'complete') {
                    page.clearTimeout(timer);
                    resolveGather();
                  }
                });
              });
              connection.close();
              return 'ok';
            } catch (error) {
              const name = error instanceof Error ? error.name : 'Error';
              const message = error instanceof Error ? error.message : 'failed';
              return `${name}:${message}`;
            }
          }

          const urls = [
            `stun:127.0.0.1:${String(ports.udp4)}`,
            `turn:127.0.0.1:${String(ports.udp4)}?transport=udp`,
            `turn:127.0.0.1:${String(ports.tcp)}?transport=tcp`,
            `turns:127.0.0.1:${String(ports.tcp)}?transport=tcp`,
          ];
          if (ports.tryIpv6) {
            urls.push(`stun:[::1]:${String(ports.udp6)}`);
          }
          const results: string[] = [];
          for (const url of urls) {
            results.push(`${url} ${await gather(url)}`);
          }
          return results;
        },
        { udp4: udp4.port, udp6: udp6?.port ?? 0, tcp: tcp.port, tryIpv6: udp6 !== null },
      ),
    );
    await settle();
    const detail = attempts.crashed ? 'renderer crashed' : attempts.value?.join('; ');
    expect(udp4.count(), detail).toBe(0);
    expect(tcp.count(), detail).toBe(0);
    if (udp6 !== null) {
      expect(udp6.count(), detail).toBe(0);
    }
    test.info().annotations.push({
      type: 'webrtc',
      description: detail ?? 'no result',
    });

    if (attempts.crashed) {
      test.info().annotations.push({
        type: 'webrtc-workers',
        description: 'Same-origin and blob workers were not run: the renderer had already crashed.',
      });
      return;
    }

    const workerPath = join(RENDERER_DIRECTORY, 'e2e-worker.js');
    writeFileSync(
      workerPath,
      `const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${String(udp4.port)}' }] });
pc.createDataChannel('probe');
pc.createOffer().then((offer) => pc.setLocalDescription(offer)).then(() => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') resolve();
  else {
    const timer = setTimeout(resolve, 1500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
    });
  }
})).then(() => { pc.close(); postMessage('ok'); }).catch((error) => postMessage('error:' + (error && error.name ? error.name : 'failed')));`,
    );
    try {
      const worker = await untilCrash(running.window, () =>
        running.window.evaluate(
          async (stunUrl: string) => {
            const page = globalThis as unknown as {
              Worker: new (url: string) => {
                onmessage: ((event: { data: unknown }) => void) | null;
                onerror: (() => void) | null;
                terminate: () => void;
              };
              URL: { createObjectURL: (blob: unknown) => string };
              Blob: new (parts: string[], options: { type: string }) => unknown;
              setTimeout: (handler: () => void, timeout: number) => number;
              clearTimeout: (handle: number) => void;
            };

            function watch(
              create: () => {
                onmessage: ((event: { data: unknown }) => void) | null;
                onerror: (() => void) | null;
                terminate: () => void;
              },
            ): Promise<string> {
              try {
                const job = create();
                return new Promise((resolveJob) => {
                  const timer = page.setTimeout(() => {
                    job.terminate();
                    resolveJob('timeout');
                  }, 2000);
                  job.onmessage = (event) => {
                    page.clearTimeout(timer);
                    job.terminate();
                    resolveJob(String(event.data));
                  };
                  job.onerror = () => {
                    page.clearTimeout(timer);
                    job.terminate();
                    resolveJob('error');
                  };
                });
              } catch (error) {
                const name = error instanceof Error ? error.name : 'Error';
                return Promise.resolve(`threw:${name}`);
              }
            }

            const sameOrigin = await watch(() => new page.Worker('e2e-worker.js'));
            const source = `const pc = new RTCPeerConnection({ iceServers: [{ urls: ${JSON.stringify(stunUrl)} }] }); pc.createDataChannel('probe'); pc.createOffer().then((offer) => pc.setLocalDescription(offer)).then(() => postMessage('ok')).catch((error) => postMessage('error:' + (error && error.name ? error.name : 'failed')));`;
            const blob = await watch(
              () =>
                new page.Worker(
                  page.URL.createObjectURL(
                    new page.Blob([source], { type: 'application/javascript' }),
                  ),
                ),
            );
            return { sameOrigin, blob };
          },
          `stun:127.0.0.1:${String(udp4.port)}`,
        ),
      );
      await settle();
      const workerDetail = worker.crashed
        ? 'renderer crashed during worker attempt'
        : JSON.stringify(worker.value);
      expect(udp4.count(), workerDetail).toBe(0);
      expect(tcp.count(), workerDetail).toBe(0);
      test.info().annotations.push({ type: 'webrtc-workers', description: workerDetail });
    } finally {
      rmSync(workerPath, { force: true });
    }
  } finally {
    await udp4.close();
    if (udp6 !== null) {
      await udp6.close();
    }
    await tcp.close();
  }
});

test('sends no packets when a child frame constructs a peer connection', async () => {
  const udp4 = await listenUdp('127.0.0.1');
  const tcp = await listenTcp();
  if (udp4 === null) {
    throw new Error('Could not bind a UDP listener on 127.0.0.1');
  }
  try {
    await proveUdp(udp4, '127.0.0.1');
    await proveTcp(tcp);
    const outcome = await untilCrash(running.window, () =>
      running.window.evaluate(
        async (stunUrl: string) => {
          const page = globalThis as unknown as {
            document: {
              createElement: (tag: string) => {
                contentWindow: {
                  RTCPeerConnection?: new (config?: unknown) => {
                    createDataChannel: (label: string) => void;
                    createOffer: () => Promise<unknown>;
                    setLocalDescription: (description: unknown) => Promise<void>;
                    close: () => void;
                    iceGatheringState: string;
                    addEventListener: (type: string, listener: () => void) => void;
                  };
                } | null;
              };
              body: { appendChild: (node: unknown) => void };
            };
            setTimeout: (handler: () => void, timeout: number) => number;
            clearTimeout: (handle: number) => void;
          };
          const frame = page.document.createElement('iframe');
          page.document.body.appendChild(frame);
          const child = frame.contentWindow;
          const Constructor = child?.RTCPeerConnection;
          if (Constructor === undefined) {
            return 'missing-constructor';
          }
          try {
            const connection = new Constructor({ iceServers: [{ urls: stunUrl }] });
            connection.createDataChannel('probe');
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            await new Promise<void>((resolveGather) => {
              const timer = page.setTimeout(() => resolveGather(), 1000);
              connection.addEventListener('icegatheringstatechange', () => {
                if (connection.iceGatheringState === 'complete') {
                  page.clearTimeout(timer);
                  resolveGather();
                }
              });
            });
            connection.close();
            return 'constructed';
          } catch (error) {
            const name = error instanceof Error ? error.name : 'Error';
            return `threw:${name}`;
          }
        },
        `stun:127.0.0.1:${String(udp4.port)}`,
      ),
    );
    await settle();
    const detail = outcome.crashed ? 'renderer crashed' : (outcome.value ?? 'no result');
    expect(udp4.count(), detail).toBe(0);
    expect(tcp.count(), detail).toBe(0);
    test.info().annotations.push({ type: 'child-frame', description: detail });
  } finally {
    await udp4.close();
    await tcp.close();
  }
});

test('opens only the repository in the system browser', async () => {
  const { application, window } = running;
  const installed = await application.evaluate(({ shell }) => {
    const opened: string[] = [];
    const record = globalThis as unknown as { __komaOpenedUrls?: string[] };
    record.__komaOpenedUrls = opened;
    const target = shell as unknown as { openExternal: (url: string) => Promise<void> };
    const replacement = (url: string): Promise<void> => {
      opened.push(url);
      return Promise.resolve();
    };
    try {
      target.openExternal = replacement;
    } catch {
      return 'not-writable';
    }
    return target.openExternal === replacement ? 'installed' : 'not-installed';
  });
  expect(installed).toBe('installed');

  const blocked = [
    'https://evil.example/',
    'https://github.com/Dytschgo/koma-motion.evil',
    'javascript:alert(1)',
    'file:///C:/Windows/notepad.exe',
    'https://github.com/Dytschgo/koma-motion/..%2f..%2fother',
    'https://user:pass@github.com/Dytschgo/koma-motion',
  ];
  for (const url of blocked) {
    await openFromPage(application, url);
  }
  await openFromPage(application, REPOSITORY);
  await openFromPage(application, `${REPOSITORY}/issues#readme`);
  await openSettingsPage(window, 'About');
  await window.getByRole('link', { name: 'Koma Motion on GitHub' }).click();

  await expect
    .poll(async () =>
      application.evaluate(() => {
        return (globalThis as unknown as { __komaOpenedUrls: string[] }).__komaOpenedUrls;
      }),
    )
    .toEqual([REPOSITORY, `${REPOSITORY}/issues#readme`, REPOSITORY]);
});

async function openFromPage(
  application: RunningApplication['application'],
  url: string,
): Promise<void> {
  await application.evaluate(({ BrowserWindow }, target) => {
    const contents = BrowserWindow.getAllWindows()[0]?.webContents;
    if (contents === undefined) {
      throw new Error('No window');
    }
    return contents.executeJavaScript(`window.open(${JSON.stringify(target)})`, true).then(
      () => undefined,
      () => undefined,
    );
  }, url);
}
