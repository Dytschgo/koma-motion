import { describe, expect, it } from 'vitest';
import { createScrubber } from './scrub';

const windows = createScrubber({
  app: 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Koma Motion\\resources\\app.asar',
  userData: 'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\Koma Motion',
  temp: 'C:\\Users\\ADALOV~1\\AppData\\Local\\Temp',
  home: 'C:\\Users\\Ada Lovelace',
});
const mac = createScrubber({
  app: '/Applications/Koma Motion.app/Contents/Resources/app.asar',
  userData: '/Users/ada/Library/Application Support/Koma Motion',
  temp: '/var/folders/ab/cd/T',
  home: '/Users/ada',
});

describe('createScrubber', () => {
  it('keeps the inner path of application code and application data', () => {
    expect(
      windows(
        'at save (C:\\Users\\Ada Lovelace\\AppData\\Local\\Programs\\Koma Motion\\resources\\app.asar\\out\\main\\index.cjs:120:15)',
      ),
    ).toBe('at save (<app>\\out\\main\\index.cjs:120:15)');
    expect(
      windows(
        "ENOENT: open 'C:\\Users\\Ada Lovelace\\AppData\\Roaming\\Koma Motion\\recovery\\snapshot.json'",
      ),
    ).toBe("ENOENT: open '<app-data>\\recovery\\snapshot.json'");
    expect(
      mac('at /Applications/Koma Motion.app/Contents/Resources/app.asar/out/main/index.cjs:1:2'),
    ).toBe('at <app>/out/main/index.cjs:1:2');
    expect(
      mac("open '/Users/ada/Library/Application Support/Koma Motion/brand-kits/library.json'"),
    ).toBe("open '<app-data>/brand-kits/library.json'");
  });

  it('reduces every other path to its extension, with or without quotes', () => {
    expect(windows("EPERM: open 'C:\\Users\\Ada Lovelace\\Documents\\Merger plan.koma'")).toBe(
      "EPERM: open '<home>/…/*.koma'",
    );
    expect(windows('could not read C:\\Users\\Ada Lovelace\\Desktop\\notes.txt')).toBe(
      'could not read <home>/…/*.txt',
    );
    expect(windows('cwd is C:\\Users\\Ada Lovelace')).toBe('cwd is <home>');
    expect(windows('C:\\Users\\ADALOV~1\\AppData\\Local\\Temp\\koma-deck-1\\slides.pdf')).toBe(
      '<temp>/…/*.pdf',
    );
    expect(windows("open 'D:\\Clients\\Acme Corp\\Q3 deck.koma' failed")).toBe(
      "open '<path>/…/*.koma' failed",
    );
    expect(windows('open \\\\nas\\share\\Ada\\deck.koma')).toBe('open <path>/…/*.koma');
    expect(mac("open '/Users/ada/Documents/Merger plan.koma'")).toBe("open '<home>/…/*.koma'");
    expect(mac('reading /Volumes/Clients/acme/deck.koma')).toBe('reading <path>/…/*.koma');
    expect(mac('/var/folders/ab/cd/T/koma-1/prompt.txt')).toBe('<temp>/…/*.txt');
  });

  it('recognises other users, short names, JSON escapes, other case and file URLs', () => {
    for (const text of [
      'C:\\Users\\Grace Hopper\\Documents\\plan.koma',
      'c:/users/ada lovelace/documents/plan.koma',
      'C:\\\\Users\\\\Ada Lovelace\\\\Documents\\\\plan.koma',
      'file:///C:/Users/Ada%20Lovelace/Documents/plan.koma',
    ]) {
      const scrubbed = windows(text);
      expect(scrubbed, text).not.toMatch(/ada|grace|hopper|lovelace|documents|plan/i);
      expect(scrubbed, text).toContain('*.koma');
    }
    expect(mac('file:///Users/grace/Documents/plan.koma')).toBe('<path>/…/*.koma');
    expect(mac('/home/grace/plan.koma\n/Users/ada')).toBe('<path>/…/*.koma\n<home>');
  });

  it('cuts a path without quotes to the end of its line, because it may contain spaces', () => {
    expect(windows('C:\\Users\\Ada Lovelace\\My Deck.koma could not be read\nnext line')).toBe(
      '<home>/…\nnext line',
    );
    expect(mac('/home/grace/plan.koma and /Users/ada')).toBe('<path>/…<home>');
  });

  it('does not treat a longer folder name as the known folder', () => {
    expect(windows('C:\\Users\\Ada Lovelace2\\file.txt')).toBe('<path>/…/*.txt');
  });

  it('leaves application URLs, module names and ordinary text alone', () => {
    for (const text of [
      'at KomaStrip (koma://app/assets/main-abc123.js:1203:44)',
      'at node:internal/process/task_queues:105:5',
      'Found version 0.3.1 (url: https://github.com/Dytschgo/koma-motion/releases/download/v0.3.1/latest.yml)',
      'ratio 16:9 and/or 4:3, at 12:30',
      'This execution is already running.',
    ]) {
      expect(windows(text), text).toBe(text);
      expect(mac(text), text).toBe(text);
    }
  });

  it('redacts credentials and control sequences, and limits the length', () => {
    const scrubbed = windows(
      '\u001b[31mfailed\u001b[0m with token=abc123456789 and Bearer abcdefghijklmnop1234 github_pat_abcdefghijklmnopqrstuv',
    );
    expect(scrubbed).toBe('failed with token=[redacted] and Bearer [redacted] [redacted]');
    expect(windows('word '.repeat(1000), 100).length).toBeLessThan(120);
  });

  it('works without any known folder', () => {
    expect(createScrubber()('open C:\\Users\\Ada\\a.txt')).toBe('open <path>/…/*.txt');
    expect(createScrubber({ home: 'C:\\', temp: '' })('C:\\x\\y.txt')).toBe('<path>/…/*.txt');
  });
});
