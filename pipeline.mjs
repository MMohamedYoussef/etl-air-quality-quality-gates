import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 ||
      Number(minute) > 59 || Number(second) > 59) return null;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function transform(readings, stations) {
  const stationById = new Map(stations.map(station => [station.station_id, station]));
  const seen = new Map();
  const groups = new Map();
  const quarantine = [];
  for (const reading of readings) {
    const id = reading?.id;
    const date = parseTimestamp(reading?.timestamp);
    const raw = reading?.pm25_value;
    if (typeof id !== 'string' || !id || typeof reading?.station_id !== 'string' ||
        !date || typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 ||
        !['ug/m3', 'mg/m3'].includes(reading?.unit)) {
      quarantine.push({ id: id ?? null, reason: 'invalid_measurement' });
      continue;
    }
    if (!stationById.has(reading.station_id)) {
      quarantine.push({ id, reason: 'unknown_station' });
      continue;
    }
    const prior = seen.get(id);
    if (prior !== undefined) {
      if (prior !== JSON.stringify(reading)) quarantine.push({ id, reason: 'conflicting_duplicate' });
      continue;
    }
    seen.set(id, JSON.stringify(reading));
    const ug = raw * (reading.unit === 'mg/m3' ? 1000 : 1);
    if (ug > 1000) {
      quarantine.push({ id, reason: 'out_of_range' });
      continue;
    }
    const hour = date.toISOString().slice(0, 13) + ':00:00.000Z';
    const key = reading.station_id + '|' + hour;
    const group = groups.get(key) ?? { station_id: reading.station_id, city: stationById.get(reading.station_id).city, hour, samples: 0, sum: 0 };
    group.samples++;
    group.sum += ug;
    groups.set(key, group);
  }
  const hourly = [...groups.values()].sort((a, b) => a.station_id.localeCompare(b.station_id) || a.hour.localeCompare(b.hour))
    .map(({ sum, ...group }) => ({ ...group, avg_ug_m3: Math.round(sum / group.samples * 100) / 100 }));
  return { hourly, quarantine };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const readings = JSON.parse(await readFile(path.join(root, 'fixtures/readings.json'), 'utf8'));
  const stations = JSON.parse(await readFile(path.join(root, 'fixtures/stations.json'), 'utf8'));
  const result = transform(readings, stations);
  await mkdir(path.join(root, 'examples'), { recursive: true });
  await writeFile(path.join(root, 'examples/result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Wrote ${result.hourly.length} hourly rows; quarantined ${result.quarantine.length}`);
}
