/**
 * Database seeder + live simulator.
 *
 * On startup the seeder wipes the (ephemeral) database and lays down 12 hours
 * of 10-minute telemetry for both stations, then the simulator keeps ticking so
 * the dashboard is genuinely live rather than a static screenshot.
 *
 * Each station is seeded with a scripted scenario so the alerting logic is
 * visible the moment a judge opens the page:
 *   MAITRI  - a katabatic storm front builds over the second half of the history
 *             and ends in full blizzard conditions.
 *   BHARATI - a supply-chain squeeze: low diesel, thin rations, resupply that
 *             arrives after the food runs out, degraded satellite uplink.
 */
import { Station } from './models/station';
import { Telemetry } from './models/telemetry';
import {
  STATION_CODES,
  STATION_PROFILES,
  baselineReading,
  clamp,
  deriveStatus,
  evaluateAlerts,
  nextReading,
  round,
  seasonalTempC,
  windChillC,
  type Reading,
  type StationCode,
} from './telemetry-engine';

const HISTORY_POINTS = 72;                     // 12 h of history ...
const HISTORY_INTERVAL_MS = 10 * 60 * 1000;    // ... at 10-minute resolution
const HISTORY_INTERVAL_H = HISTORY_INTERVAL_MS / 3_600_000;

interface Scenario {
  stress: 'none' | 'blizzard' | 'supply';
  storm: boolean;
}

const SCENARIOS: Record<StationCode, Scenario> = {
  MAITRI: { stress: 'none', storm: true },
  BHARATI: { stress: 'supply', storm: false },
};

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Cold anomaly (degC below the seasonal mean) at the height of the storm. */
const STORM_TEMP_ANOMALY_C = 9;
const STORM_WIND_KTS = 56;

/**
 * Bend a reading toward blizzard conditions as the history progresses.
 * `progress` runs 0 -> 1 across the seeded window; the front only starts to
 * bite after 45% so the sparkline shows a calm period before the storm.
 *
 * Every target is absolute, never relative to the reading being shaped: the
 * shaped reading is fed back into the next tick, so a relative target (such as
 * "9 degC colder than now") would compound every tick and slide the station
 * down to the random walk's floor instead of settling at the intended anomaly.
 */
function applyStormFront(reading: Reading, progress: number, seasonalC: number): Reading {
  const t = clamp((progress - 0.45) / 0.55, 0, 1);
  if (t === 0) return reading;

  const env = reading.environment;
  const windSpeedKts = round(lerp(env.windSpeedKts, STORM_WIND_KTS, t), 1);
  const temperatureC = round(lerp(env.temperatureC, seasonalC - STORM_TEMP_ANOMALY_C, t), 1);
  const visibilityM = Math.round(lerp(env.visibilityM, 70, t));

  return {
    ...reading,
    environment: {
      ...env,
      temperatureC,
      windSpeedKts,
      windChillC: windChillC(temperatureC, windSpeedKts),
      windGustKts: round(windSpeedKts * 1.38, 1),
      visibilityM,
      pressureHpa: round(lerp(env.pressureHpa, 958, t), 1),
      humidityPct: round(lerp(env.humidityPct, 88, t), 1),
      blizzard: windSpeedKts >= 45,
    },
  };
}

/** Recompute a station's headline status from its newest reading. */
async function refreshStationStatus(code: StationCode, reading: Reading, at: Date): Promise<void> {
  await Station.updateOne(
    { code },
    { $set: { status: deriveStatus(evaluateAlerts(reading)), lastContactAt: at } },
  );
}

export interface SeedSummary {
  stations: number;
  readings: number;
}

/** Wipe and repopulate. Safe to call on every boot because the DB is ephemeral. */
export async function seedDatabase(now: Date = new Date()): Promise<SeedSummary> {
  await Promise.all([Station.deleteMany({}), Telemetry.deleteMany({})]);

  const startMs = now.getTime() - (HISTORY_POINTS - 1) * HISTORY_INTERVAL_MS;
  let readings = 0;

  for (const code of STATION_CODES) {
    const profile = STATION_PROFILES[code];
    const scenario = SCENARIOS[code];

    await Station.create({
      code: profile.code,
      name: profile.name,
      region: profile.region,
      coordinates: profile.coordinates,
      commissionedYear: profile.commissionedYear,
      crewCapacity: profile.crewCapacity,
      generatorCapacityKw: profile.generatorCapacityKw,
      dieselCapacityL: profile.dieselCapacityL,
      waterCapacityL: profile.waterCapacityL,
      status: 'nominal',
      lastContactAt: now,
    });

    const documents = [];
    let reading = baselineReading(profile, new Date(startMs), scenario.stress);

    for (let index = 0; index < HISTORY_POINTS; index++) {
      const at = new Date(startMs + index * HISTORY_INTERVAL_MS);
      if (index > 0) {
        reading = nextReading(reading, profile, at, Math.random, HISTORY_INTERVAL_H);
      }
      if (scenario.storm) {
        reading = applyStormFront(reading, index / (HISTORY_POINTS - 1), seasonalTempC(profile, at));
      }
      documents.push({ stationCode: code, recordedAt: at, ...reading });
    }

    await Telemetry.insertMany(documents);
    readings += documents.length;
    await refreshStationStatus(code, reading, now);
  }

  return { stations: STATION_CODES.length, readings };
}

/**
 * Append one fresh reading per station, derived from that station's last one.
 * Never throws: a simulator hiccup must not take the API down.
 */
export async function tickSimulator(tickSeconds: number, now: Date = new Date()): Promise<void> {
  for (const code of STATION_CODES) {
    try {
      const latest = await Telemetry.findOne({ stationCode: code })
        .sort({ recordedAt: -1 })
        .lean()
        .exec();
      if (!latest) continue;

      const previous: Reading = {
        environment: latest.environment,
        energy: latest.energy,
        infrastructure: latest.infrastructure,
        logistics: latest.logistics,
      };
      const reading = nextReading(
        previous,
        STATION_PROFILES[code],
        now,
        Math.random,
        tickSeconds / 3600,
      );

      await Telemetry.create({ stationCode: code, recordedAt: now, ...reading });
      await refreshStationStatus(code, reading, now);
    } catch (error) {
      console.error(`[simulator] tick failed for ${code}:`, error);
    }
  }
}

/**
 * Start the live tick. Returns a stop function for graceful shutdown.
 * ponytail: readings accumulate unbounded (~1 MB/h for both stations); the DB is
 * in-memory and dies with the process, so prune only if demos start running long.
 */
export function startSimulator(tickSeconds: number): () => void {
  const timer = setInterval(() => {
    void tickSimulator(tickSeconds);
  }, tickSeconds * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
