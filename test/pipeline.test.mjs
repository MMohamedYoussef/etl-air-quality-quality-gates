import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from '../pipeline.mjs';

test('converts units, removes exact duplicates, and groups by station hour', () => {
  const stations = [{ station_id: 'S1', city: 'Cairo' }];
  const readings = [
    { id: 'a', station_id: 'S1', timestamp: '2026-09-01T10:05:00Z', pm25_value: 10, unit: 'ug/m3' },
    { id: 'b', station_id: 'S1', timestamp: '2026-09-01T10:25:00Z', pm25_value: 0.02, unit: 'mg/m3' },
    { id: 'b', station_id: 'S1', timestamp: '2026-09-01T10:25:00Z', pm25_value: 0.02, unit: 'mg/m3' },
    { id: 'c', station_id: 'BAD', timestamp: '2026-09-01T10:30:00Z', pm25_value: 12, unit: 'ug/m3' },
  ];
  const result = transform(readings, stations);
  assert.deepEqual(result.hourly, [{ station_id: 'S1', city: 'Cairo', hour: '2026-09-01T10:00:00.000Z', samples: 2, avg_ug_m3: 15 }]);
  assert.equal(result.quarantine[0].reason, 'unknown_station');
});

test('quarantines negative measurements without breaking empty outputs', () => {
  assert.deepEqual(transform([], []).hourly, []);
  assert.equal(transform([{ id: 'x', station_id: 'S1', timestamp: '2026-09-01T10:00:00Z', pm25_value: -1, unit: 'ug/m3' }], [{ station_id: 'S1', city: 'Cairo' }]).quarantine[0].reason, 'invalid_measurement');
});

test('quarantines null, impossible, and timezone-less timestamps', () => {
  const stations = [{ station_id: 'S1', city: 'Cairo' }];
  const readings = [null, '2026-02-30T10:00:00Z', '2026-09-01T10:00:00'].map((timestamp, index) => ({
    id: `bad-${index}`, station_id: 'S1', timestamp, pm25_value: 10, unit: 'ug/m3',
  }));
  const result = transform(readings, stations);
  assert.deepEqual(result.hourly, []);
  assert.deepEqual(result.quarantine.map(row => row.reason), ['invalid_measurement', 'invalid_measurement', 'invalid_measurement']);
  assert.equal(transform([{ ...readings[0], id: 'offset', timestamp: '2026-09-01T12:00:00+02:00' }], stations).hourly[0].hour, '2026-09-01T10:00:00.000Z');
});
