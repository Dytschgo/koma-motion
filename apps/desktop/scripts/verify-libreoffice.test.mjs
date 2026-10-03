import assert from 'node:assert/strict';
import test from 'node:test';
import { REQUIRED_TITLES, verifyReport } from './verify-libreoffice.mjs';

const report = () => ({
  suites: [
    {
      suites: [
        {
          specs: REQUIRED_TITLES.map((title) => ({
            title,
            tests: [{ status: 'expected', results: [{ status: 'passed' }] }],
          })),
        },
      ],
    },
  ],
});
test('LibreOffice gate requires every named real integration scenario and a passed attempt', () => {
  assert.match(verifyReport(report()), /5 passed/);
  for (const status of ['skipped', 'unexpected', 'flaky']) {
    const value = report();
    value.suites[0].suites[0].specs[0].tests[0].status = status;
    assert.throws(() => verifyReport(value), /failed, skipped, retried or missing/);
  }
  const missing = report();
  missing.suites[0].suites[0].specs.pop();
  assert.throws(() => verifyReport(missing), /missing or duplicated/);
  const wrong = report();
  wrong.suites[0].suites[0].specs[0].title = 'a different test';
  assert.throws(() => verifyReport(wrong), /missing/);
  const noAttempt = report();
  noAttempt.suites[0].suites[0].specs[0].tests[0].results = [];
  assert.throws(() => verifyReport(noAttempt), /missing/);
});
