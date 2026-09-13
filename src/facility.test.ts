/**
 * Self-check for the facility registry.
 * Run with: npm test   (no framework — node:test + assert only)
 *
 * The registry's whole job is to connect two things that live apart: the alert
 * codes the engine emits, and the rooms the 3D view draws. Nothing at runtime
 * notices when those drift — a retired alert code just stops lighting a room,
 * and a typo'd metric path quietly renders "--". These checks are the only
 * thing standing between that and a silent demo failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_ZONES,
  BAY_M,
  DATUM,
  LEVELS,
  SERVICE_LINES,
  STRUCTURE_ID,
  ZONES,
  facilityModel,
  zoneById,
  zoneSeverities,
  type Level,
} from './facility';
import { STATION_PROFILES, baselineReading, type Reading } from './telemetry-engine';

const READING: Reading = baselineReading(STATION_PROFILES.BHARATI, new Date('2026-01-15T06:00:00Z'));

/** Resolve a dotted path the same way the browser will. */
function resolve(reading: Reading, metric: string): unknown {
  return metric
    .split('.')
    .reduce<unknown>(
      (node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined),
      reading,
    );
}

/**
 * Every alert code the engine can actually emit, read from its source.
 *
 * Scoped to the body of `evaluateAlerts` rather than the whole file: station
 * profiles carry a `code` field too, and a file-wide scan happily mistakes
 * MAITRI for an alert.
 */
function engineAlertCodes(): string[] {
  const source = fs.readFileSync(path.join(__dirname, 'telemetry-engine.ts'), 'utf8');
  const start = source.indexOf('export function evaluateAlerts');
  assert.ok(start >= 0, 'evaluateAlerts has moved or been renamed — this check is now blind');
  const end = source.indexOf('\nexport ', start + 1);
  const body = source.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/code:\s*'([A-Z][A-Z_]+)'/g)].map((match) => match[1]!);
}

test('every alert the engine emits has a home in the building', () => {
  const codes = engineAlertCodes();
  assert.ok(codes.length >= 20, `expected the engine to define alerts, found ${codes.length}`);
  for (const code of codes) {
    assert.ok(ALERT_ZONES[code], `alert ${code} lights up no zone — add it to ALERT_ZONES`);
    assert.ok(ALERT_ZONES[code]!.length > 0, `alert ${code} maps to an empty zone list`);
  }
});

test('ALERT_ZONES never points at a zone that does not exist', () => {
  for (const [code, ids] of Object.entries(ALERT_ZONES)) {
    for (const id of ids) {
      if (id === STRUCTURE_ID) continue;
      assert.ok(zoneById(id), `alert ${code} points at unknown zone "${id}"`);
    }
  }
});

test('zone ids are unique', () => {
  const seen = new Set<string>();
  for (const zone of ZONES) {
    assert.ok(!seen.has(zone.id), `duplicate zone id "${zone.id}"`);
    seen.add(zone.id);
  }
  assert.ok(!seen.has(STRUCTURE_ID), 'a zone shadows the reserved structure id');
});

test('rooms on the same deck do not overlap on the column grid', () => {
  for (const level of Object.keys(LEVELS) as Level[]) {
    const onLevel = ZONES.filter((zone) => zone.level === level).sort((a, b) => a.bays[0] - b.bays[0]);
    for (let i = 1; i < onLevel.length; i += 1) {
      const prev = onLevel[i - 1]!;
      const here = onLevel[i]!;
      assert.ok(
        here.bays[0] >= prev.bays[1] - 1e-9,
        `${level}: "${here.name}" starts at bay ${here.bays[0]} inside "${prev.name}" which runs to ${prev.bays[1]}`,
      );
    }
  }
});

test('every bay span is forward and lands on the drawn grid', () => {
  for (const zone of ZONES) {
    const [from, to] = zone.bays;
    assert.ok(to > from, `${zone.id}: bay span is not forward (${from} -> ${to})`);
    assert.ok(from >= 0 && to <= 22, `${zone.id}: bay span ${from}..${to} falls outside column lines 1..21`);
  }
});

test('every instrument metric resolves against a real reading', () => {
  for (const zone of ZONES) {
    for (const instrument of zone.instruments) {
      const value = resolve(READING, instrument.metric);
      assert.notEqual(
        value,
        undefined,
        `${zone.id}: instrument "${instrument.label}" reads ${instrument.metric}, which is not on a Reading`,
      );
    }
  }
});

test('every service line has a resolvable rate and a drawable route', () => {
  for (const line of SERVICE_LINES) {
    const value = resolve(READING, line.rateMetric);
    assert.equal(typeof value, 'number', `${line.id}: rateMetric ${line.rateMetric} is not numeric`);
    assert.ok(line.rateFull > 0, `${line.id}: rateFull must be positive`);
    assert.ok(line.points.length >= 2, `${line.id}: a route needs at least two points`);
    for (const point of line.points) {
      assert.ok(
        point.y >= DATUM.ground && point.y <= DATUM.h4,
        `${line.id}: route point at y=${point.y} is outside the building`,
      );
    }
  }
});

test('zoneSeverities keeps the worst severity per zone', () => {
  const severities = zoneSeverities([
    { code: 'LOG_FOOD_LOW', severity: 'warning' },
    { code: 'LOG_FOOD_CRITICAL', severity: 'critical' },
  ]);
  assert.equal(severities['cold-store-a'], 'critical', 'critical must win over warning');
  assert.equal(severities['dining-hall'], 'critical');

  // Order must not change the outcome.
  const reversed = zoneSeverities([
    { code: 'LOG_FOOD_CRITICAL', severity: 'critical' },
    { code: 'LOG_FOOD_LOW', severity: 'warning' },
  ]);
  assert.deepEqual(reversed, severities);

  assert.deepEqual(zoneSeverities([]), {});
  // An alert with no mapping is ignored, not fatal.
  assert.deepEqual(zoneSeverities([{ code: 'NOT_A_REAL_CODE', severity: 'critical' }]), {});
});

test('the datums climb and the model payload is complete', () => {
  assert.ok(DATUM.ground < DATUM.h1 && DATUM.h1 < DATUM.h2, 'datums must ascend');
  assert.ok(DATUM.h2 < DATUM.h3 && DATUM.h3 < DATUM.h4, 'datums must ascend');
  assert.ok(BAY_M > 0);

  const model = facilityModel();
  assert.equal(model.zones.length, ZONES.length);
  assert.equal(model.services.length, SERVICE_LINES.length);
  assert.ok(model.halfWidthBottomM < model.halfWidthM, 'the shell tapers inward going down');
  // The payload is serialised into the page, so it has to survive JSON.
  assert.deepEqual(JSON.parse(JSON.stringify(model)).zones.length, ZONES.length);
});
