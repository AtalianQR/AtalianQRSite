import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlarmExternalId } from '../netlify/functions/soundsensing-sync.js';

test('buildAlarmExternalId zet ss-alarm: prefix voor het UUID', () => {
  assert.equal(
    buildAlarmExternalId('c947671e-c1de-4a23-90a6-264234338523'),
    'ss-alarm:c947671e-c1de-4a23-90a6-264234338523'
  );
});

test('buildAlarmExternalId kapt af op 48 tekens', () => {
  const out = buildAlarmExternalId('x'.repeat(80));
  assert.equal(out.length, 48);
  assert.ok(out.startsWith('ss-alarm:'));
});
