import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleMinuteUtc } from '../scripts/backfill-soundsensing-externalid.mjs';

test('titleMinuteUtc parseert het alarmtijdstip (UTC) uit de jobtitel', () => {
  // 25.06.2026 14:50 UTC -> unix-minuut
  const expected = Math.floor(Date.UTC(2026, 5, 25, 14, 50, 0) / 60000);
  assert.equal(
    titleMinuteUtc('Schema-afwijking - Asset is off (25.06.2026 14:50)'),
    expected
  );
});

test('titleMinuteUtc matcht een alarm-timestamp op dezelfde minuut', () => {
  // Een Soundsensing-alarm-timestamp (fractionele seconden) valt in dezelfde minuut.
  const alarmTs = Date.UTC(2026, 5, 25, 14, 50, 33) / 1000 + 0.42;
  assert.equal(Math.floor(alarmTs / 60), titleMinuteUtc('X (25.06.2026 14:50)'));
});

test('titleMinuteUtc geeft null zonder tijdstip in de titel', () => {
  assert.equal(titleMinuteUtc('Geen datum hier'), null);
  assert.equal(titleMinuteUtc(''), null);
  assert.equal(titleMinuteUtc(null), null);
});
