import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAlarmIdFromExternalId, buildResolveBody } from '../netlify/functions/soundsensing-resolve.js';

test('parseAlarmIdFromExternalId haalt UUID uit ss-alarm: prefix', () => {
  assert.equal(
    parseAlarmIdFromExternalId('ss-alarm:c947671e-c1de-4a23-90a6-264234338523'),
    'c947671e-c1de-4a23-90a6-264234338523'
  );
});

test('parseAlarmIdFromExternalId geeft null zonder prefix', () => {
  assert.equal(parseAlarmIdFromExternalId('ss-1699-abc'), null);
  assert.equal(parseAlarmIdFromExternalId(''), null);
  assert.equal(parseAlarmIdFromExternalId(null), null);
});

test('buildResolveBody zet resolved:true en verwijst naar de job', () => {
  const body = buildResolveBody('093794');
  assert.equal(body.resolved, true);
  assert.match(body.resolution_description, /093794/);
});
