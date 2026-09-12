/**
 * Self-check for the pure telemetry engine.
 * Run with: npm test   (no framework — node:test + assert only)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATION_PROFILES,
  baselineReading,
  clamp,
  deriveStatus,
  evaluateAlerts,
  nextReading,
  parseStationCode,
  seasonalTempC,
  sparklinePoints,
  walk,
  windChillC,
  type Reading,
} from './telemetry-engine';

/** Deterministic PRNG (mulberry32) so simulation tests are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAITRI = STATION_PROFILES.MAITRI;
const SUMMER = new Date('2026-01-15T06:00:00Z');
const WINTER = new Date('2026-07-16T06:00:00Z');

test('windChillC matches the published NWS value (-20 degC, 30 km/h => about -33)', () => {
  const kts = 30 / 1.852;
  assert.ok(Math.abs(windChillC(-20, kts) - -32.6) < 0.6, `got ${windChillC(-20, kts)}`);
});

test('windChillC falls back to air temperature in negligible wind', () => {
  assert.equal(windChillC(-30, 1), -30);
  assert.equal(windChillC(12, 40), 12);
});

test('wind chill is never warmer than the air temperature in real wind', () => {
  for (const t of [-50, -30, -10, 0, 5]) {
    assert.ok(windChillC(t, 25) <= t + 0.001, `t=${t}`);
  }
});

test('seasonal temperature is far colder in austral winter than in summer', () => {
  const summer = seasonalTempC(MAITRI, SUMMER);
  const winter = seasonalTempC(MAITRI, WINTER);
  assert.ok(winter < summer - 20, `summer=${summer} winter=${winter}`);
  assert.ok(winter < -25 && summer > -10, `summer=${summer} winter=${winter}`);
});

test('clamp and walk keep values inside their bounds', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(Number.NaN, 3, 9), 3);
  const rng = seeded(7);
  let v = 50;
  for (let i = 0; i < 2000; i++) {
    v = walk(v, 10, 0, 100, rng);
    assert.ok(v >= 0 && v <= 100, `escaped bounds: ${v}`);
  }
});

test('a healthy station in summer raises no alerts', () => {
  const alerts = evaluateAlerts(baselineReading(MAITRI, SUMMER, 'none'));
  assert.deepEqual(alerts, [], `unexpected: ${JSON.stringify(alerts)}`);
  assert.equal(deriveStatus(alerts), 'nominal');
});

test('blizzard stress raises critical environment alerts', () => {
  const alerts = evaluateAlerts(baselineReading(MAITRI, WINTER, 'blizzard'));
  const codes = alerts.map((a) => a.code);
  assert.ok(codes.includes('ENV_BLIZZARD'), codes.join(','));
  assert.ok(codes.includes('ENV_WHITEOUT'), codes.join(','));
  assert.equal(deriveStatus(alerts), 'critical');
});

test('supply stress raises the fuel warning and the resupply-gap critical', () => {
  const alerts = evaluateAlerts(baselineReading(STATION_PROFILES.BHARATI, WINTER, 'supply'));
  const codes = alerts.map((a) => a.code);
  assert.ok(codes.includes('PWR_FUEL_LOW'), codes.join(','));
  assert.ok(codes.includes('LOG_SUPPLY_GAP'), codes.join(','));
  assert.ok(codes.includes('LOG_MEDICAL_LOW'), codes.join(','));
  assert.equal(deriveStatus(alerts), 'critical');
});

test('alerts are sorted most severe first', () => {
  const alerts = evaluateAlerts(baselineReading(MAITRI, WINTER, 'blizzard'));
  const firstWarning = alerts.findIndex((a) => a.severity === 'warning');
  if (firstWarning !== -1) {
    assert.ok(
      alerts.slice(firstWarning).every((a) => a.severity === 'warning'),
      'a critical alert appeared after a warning',
    );
  }
});

test('deriveStatus picks the worst severity present', () => {
  assert.equal(deriveStatus([]), 'nominal');
  assert.equal(
    deriveStatus([{ pillar: 'energy', severity: 'warning', code: 'X', message: 'm' }]),
    'degraded',
  );
  assert.equal(
    deriveStatus([
      { pillar: 'energy', severity: 'warning', code: 'X', message: 'm' },
      { pillar: 'energy', severity: 'critical', code: 'Y', message: 'm' },
    ]),
    'critical',
  );
});

test('nextReading is deterministic for a given seed', () => {
  const base = baselineReading(MAITRI, WINTER, 'none');
  const a = nextReading(base, MAITRI, WINTER, seeded(42));
  const b = nextReading(base, MAITRI, WINTER, seeded(42));
  assert.deepEqual(a, b);
});

test('simulating 1000 ticks keeps every value finite and in range', () => {
  const rng = seeded(2026);
  let reading: Reading = baselineReading(MAITRI, WINTER, 'none');
  let at = WINTER.getTime();
  for (let i = 0; i < 1000; i++) {
    at += 10 * 60 * 1000;
    const next = nextReading(reading, MAITRI, new Date(at), rng, 1 / 6);
    assert.ok(next.energy.dieselLitres <= reading.energy.dieselLitres, 'diesel must not refill itself');
    for (const pillar of Object.values(next)) {
      for (const [key, value] of Object.entries(pillar)) {
        if (typeof value === 'number') {
          assert.ok(Number.isFinite(value), `${key} became ${value}`);
        }
      }
    }
    for (const pct of [
      next.energy.dieselLevelPct, next.energy.batterySocPct,
      next.infrastructure.structuralIntegrityPct, next.infrastructure.wasteTankPct,
      next.environment.humidityPct,
    ]) {
      assert.ok(pct >= 0 && pct <= 100, `percentage out of range: ${pct}`);
    }
    assert.ok(next.energy.generatorLoadKw <= MAITRI.generatorCapacityKw + 0.001, 'generator over capacity');
    assert.ok(next.logistics.foodDaysRemaining >= 0, 'negative rations');
    reading = next;
  }
});

test('parseStationCode accepts known codes and rejects anything else', () => {
  assert.equal(parseStationCode('maitri'), 'MAITRI');
  assert.equal(parseStationCode('  Bharati '), 'BHARATI');
  assert.equal(parseStationCode('MCMURDO'), null);
  assert.equal(parseStationCode("'; DROP COLLECTION --"), null);
  assert.equal(parseStationCode(undefined), null);
  assert.equal(parseStationCode({ code: 'MAITRI' }), null);
});

test('sparklinePoints scales a series into the box', () => {
  const points = sparklinePoints([0, 5, 10], 100, 40).split(' ');
  assert.equal(points.length, 3);
  assert.equal(points[0], '0,40');   // minimum sits on the bottom edge
  assert.equal(points[2], '100,0');  // maximum sits on the top edge
  assert.equal(sparklinePoints([], 100, 40), '');
  assert.equal(sparklinePoints([7], 100, 40), '0,20');
  assert.ok(sparklinePoints([4, 4, 4], 100, 40).split(' ').every((p) => p.endsWith(',20')));
});
