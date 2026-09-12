/**
 * Pure telemetry engine for the Antarctic Digital Twin.
 *
 * Everything in this file is deterministic given its inputs and performs no I/O
 * (no database, no network, no clock reads except what is passed in). That keeps
 * the physics, the simulation and the alert rules unit-testable in isolation —
 * see telemetry-engine.test.ts.
 */

export type StationCode = 'MAITRI' | 'BHARATI';

export type Severity = 'critical' | 'warning';
export type StationStatus = 'nominal' | 'degraded' | 'critical';
export type Pillar = 'environment' | 'energy' | 'infrastructure' | 'logistics';

export type HvacStatus = 'nominal' | 'strained' | 'fault';
export type CommsStatus = 'online' | 'degraded' | 'down';

export interface EnvironmentReading {
  temperatureC: number;
  windChillC: number;
  windSpeedKts: number;
  windGustKts: number;
  humidityPct: number;
  visibilityM: number;
  pressureHpa: number;
  snowDepthCm: number;
  blizzard: boolean;
}

export interface EnergyReading {
  dieselLevelPct: number;
  dieselLitres: number;
  generatorLoadKw: number;
  generatorCapacityKw: number;
  solarOutputKw: number;
  windOutputKw: number;
  batterySocPct: number;
  demandKw: number;
}

export interface InfrastructureReading {
  hvacStatus: HvacStatus;
  indoorTempC: number;
  waterReserveL: number;
  waterCapacityL: number;
  structuralIntegrityPct: number;
  commsStatus: CommsStatus;
  uplinkLatencyMs: number;
  wasteTankPct: number;
}

export interface LogisticsReading {
  crewOnStation: number;
  crewCapacity: number;
  foodDaysRemaining: number;
  medicalKits: number;
  nextResupplyDays: number;
  pendingCargoTonnes: number;
}

export interface Reading {
  environment: EnvironmentReading;
  energy: EnergyReading;
  infrastructure: InfrastructureReading;
  logistics: LogisticsReading;
}

export interface Alert {
  pillar: Pillar;
  severity: Severity;
  code: string;
  message: string;
}

export interface StationProfile {
  code: StationCode;
  name: string;
  region: string;
  coordinates: { latitude: number; longitude: number };
  commissionedYear: number;
  crewCapacity: number;
  /** Mean annual air temperature (degC) used as the centre of the seasonal cycle. */
  baseTempC: number;
  /** Half the peak-to-peak seasonal swing (degC). */
  tempAmplitudeC: number;
  baseWindKts: number;
  generatorCapacityKw: number;
  dieselCapacityL: number;
  waterCapacityL: number;
}

/**
 * The two permanent Indian Antarctic stations operated by NCPOR.
 * Coordinates and commissioning years are real; the engineering capacities are
 * plausible prototype figures, not published NCPOR specifications.
 */
export const STATION_PROFILES: Record<StationCode, StationProfile> = {
  MAITRI: {
    code: 'MAITRI',
    name: 'Maitri',
    region: 'Schirmacher Oasis, Queen Maud Land',
    coordinates: { latitude: -70.7661, longitude: 11.7314 },
    commissionedYear: 1989,
    crewCapacity: 25,
    baseTempC: -18,
    tempAmplitudeC: 14,
    baseWindKts: 24,
    generatorCapacityKw: 180,
    dieselCapacityL: 90000,
    waterCapacityL: 40000,
  },
  BHARATI: {
    code: 'BHARATI',
    name: 'Bharati',
    region: 'Larsemann Hills, Prydz Bay',
    coordinates: { latitude: -69.4069, longitude: 76.1953 },
    commissionedYear: 2012,
    crewCapacity: 47,
    baseTempC: -12,
    tempAmplitudeC: 11,
    baseWindKts: 19,
    generatorCapacityKw: 260,
    dieselCapacityL: 140000,
    waterCapacityL: 65000,
  },
};

export const STATION_CODES = Object.keys(STATION_PROFILES) as StationCode[];

/** Narrow arbitrary user input to a known station code, or null. */
export function parseStationCode(raw: unknown): StationCode | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return (STATION_CODES as string[]).includes(code) ? (code as StationCode) : null;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Wind chill in degC (Environment Canada / NWS formula).
 * Defined for air temperature <= 10 degC and wind above 4.8 km/h; outside that
 * envelope the air temperature itself is the honest answer.
 */
export function windChillC(temperatureC: number, windSpeedKts: number): number {
  const windKph = windSpeedKts * 1.852;
  if (temperatureC > 10 || windKph <= 4.8) return round(temperatureC, 1);
  const v = windKph ** 0.16;
  const wc = 13.12 + 0.6215 * temperatureC - 11.37 * v + 0.3965 * temperatureC * v;
  return round(wc, 1);
}

/**
 * Seasonal air temperature for a station on a given date.
 * Austral summer peaks mid-January (day 15); winter minimum falls near mid-July.
 */
export function seasonalTempC(profile: StationProfile, at: Date): number {
  const start = Date.UTC(at.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((at.getTime() - start) / 86_400_000);
  const phase = (2 * Math.PI * (dayOfYear - 15)) / 365;
  const diurnal = 1.5 * Math.sin((2 * Math.PI * at.getUTCHours()) / 24);
  return round(profile.baseTempC + profile.tempAmplitudeC * Math.cos(phase) + diurnal, 1);
}

/** Random source, injectable so tests can be deterministic. */
export type Rng = () => number;

/** Bounded random walk: nudge `value` by at most +/-`step` and keep it in range. */
export function walk(value: number, step: number, min: number, max: number, rng: Rng): number {
  return clamp(value + (rng() * 2 - 1) * step, min, max);
}

function pick<T>(items: readonly T[], rng: Rng): T {
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index] as T;
}

/**
 * First reading for a station — the baseline the simulator then walks away from.
 * `stress` seeds a station with a visibly degraded pillar so the alerting logic
 * is demonstrable the moment the dashboard loads.
 */
export function baselineReading(
  profile: StationProfile,
  at: Date,
  stress: 'none' | 'blizzard' | 'supply' = 'none',
): Reading {
  const temperatureC = seasonalTempC(profile, at);
  const windSpeedKts = stress === 'blizzard' ? profile.baseWindKts + 28 : profile.baseWindKts;
  const dieselLevelPct = stress === 'supply' ? 27 : 68;
  const crewOnStation = Math.round(profile.crewCapacity * 0.72);

  const environment: EnvironmentReading = {
    temperatureC: stress === 'blizzard' ? round(temperatureC - 9, 1) : temperatureC,
    windChillC: 0, // filled below
    windSpeedKts,
    windGustKts: round(windSpeedKts * 1.35, 1),
    humidityPct: 62,
    visibilityM: stress === 'blizzard' ? 80 : 9000,
    pressureHpa: stress === 'blizzard' ? 962 : 988,
    snowDepthCm: 42,
    blizzard: stress === 'blizzard',
  };
  environment.windChillC = windChillC(environment.temperatureC, environment.windSpeedKts);

  const demandKw = round(profile.generatorCapacityKw * 0.46, 1);
  const energy: EnergyReading = {
    dieselLevelPct,
    dieselLitres: Math.round((dieselLevelPct / 100) * profile.dieselCapacityL),
    generatorLoadKw: demandKw,
    generatorCapacityKw: profile.generatorCapacityKw,
    solarOutputKw: round(profile.generatorCapacityKw * 0.06, 1),
    windOutputKw: round(profile.generatorCapacityKw * 0.09, 1),
    batterySocPct: 82,
    demandKw,
  };

  const infrastructure: InfrastructureReading = {
    hvacStatus: stress === 'blizzard' ? 'strained' : 'nominal',
    indoorTempC: stress === 'blizzard' ? 17.5 : 21.5,
    waterReserveL: Math.round(profile.waterCapacityL * 0.63),
    waterCapacityL: profile.waterCapacityL,
    structuralIntegrityPct: stress === 'blizzard' ? 91 : 97,
    commsStatus: stress === 'supply' ? 'degraded' : 'online',
    uplinkLatencyMs: stress === 'supply' ? 1450 : 620,
    wasteTankPct: 38,
  };

  const logistics: LogisticsReading = {
    crewOnStation,
    crewCapacity: profile.crewCapacity,
    foodDaysRemaining: stress === 'supply' ? 48 : 165,
    medicalKits: stress === 'supply' ? 4 : 12,
    nextResupplyDays: stress === 'supply' ? 62 : 38,
    pendingCargoTonnes: 14.5,
  };

  return { environment, energy, infrastructure, logistics };
}

/**
 * Advance the twin by one tick. Pure: same previous reading + same rng => same result.
 * `elapsedHours` scales the slow-moving consumables so seeding a 12 h history and
 * ticking live every few seconds both drain stores at a believable rate.
 */
export function nextReading(
  prev: Reading,
  profile: StationProfile,
  at: Date,
  rng: Rng = Math.random,
  elapsedHours = 1 / 360,
): Reading {
  const season = seasonalTempC(profile, at);
  // Pull gently back toward the seasonal mean so the walk cannot drift forever.
  const pulled = prev.environment.temperatureC + (season - prev.environment.temperatureC) * 0.08;
  const temperatureC = round(walk(pulled, 0.8, season - 18, season + 8, rng), 1);
  const windSpeedKts = round(walk(prev.environment.windSpeedKts, 3.5, 2, 78, rng), 1);
  const blizzard = windSpeedKts >= 45;
  const visibilityM = Math.round(
    blizzard ? walk(prev.environment.visibilityM, 220, 30, 1200, rng)
             : walk(prev.environment.visibilityM, 900, 400, 20000, rng),
  );

  const environment: EnvironmentReading = {
    temperatureC,
    windChillC: windChillC(temperatureC, windSpeedKts),
    windSpeedKts,
    windGustKts: round(windSpeedKts * (1.2 + rng() * 0.35), 1),
    humidityPct: round(walk(prev.environment.humidityPct, 3, 25, 98, rng), 1),
    visibilityM,
    pressureHpa: round(walk(prev.environment.pressureHpa, 1.6, 940, 1020, rng), 1),
    snowDepthCm: round(walk(prev.environment.snowDepthCm, 0.6, 0, 240, rng), 1),
    blizzard,
  };

  // Colder air and higher wind push heating demand up.
  const coldLoad = clamp((-temperatureC - 10) / 30, 0, 1);
  const demandKw = round(
    clamp(
      profile.generatorCapacityKw * (0.38 + coldLoad * 0.34) + (rng() * 2 - 1) * 6,
      profile.generatorCapacityKw * 0.2,
      profile.generatorCapacityKw * 0.98,
    ),
    1,
  );
  // Renewables cannot contribute in a whiteout; solar also follows the polar day.
  const daylight = clamp(Math.sin((2 * Math.PI * (at.getUTCHours() - 3)) / 24), 0, 1);
  const solarOutputKw = round(
    blizzard ? 0 : profile.generatorCapacityKw * 0.12 * daylight * (0.6 + rng() * 0.4),
    1,
  );
  const windOutputKw = round(
    clamp(profile.generatorCapacityKw * 0.0045 * windSpeedKts, 0, profile.generatorCapacityKw * 0.22),
    1,
  );
  const generatorLoadKw = round(clamp(demandKw - solarOutputKw - windOutputKw, 0, profile.generatorCapacityKw), 1);
  // Diesel burn ~0.28 L per kWh generated.
  const burnedL = generatorLoadKw * elapsedHours * 0.28;
  const dieselLitres = Math.max(0, Math.round(prev.energy.dieselLitres - burnedL));
  const surplusKw = demandKw - generatorLoadKw - solarOutputKw - windOutputKw;

  const energy: EnergyReading = {
    dieselLitres,
    dieselLevelPct: round((dieselLitres / profile.dieselCapacityL) * 100, 1),
    generatorLoadKw,
    generatorCapacityKw: profile.generatorCapacityKw,
    solarOutputKw,
    windOutputKw,
    batterySocPct: round(clamp(prev.energy.batterySocPct - surplusKw * 0.02 + (rng() - 0.45), 5, 100), 1),
    demandKw,
  };

  const hvacStrain = environment.windChillC < -45 || temperatureC < season - 10;
  const hvacStatus: HvacStatus = prev.infrastructure.hvacStatus === 'fault'
    ? (rng() < 0.25 ? 'strained' : 'fault')
    : hvacStrain
      ? (rng() < 0.04 ? 'fault' : 'strained')
      : (rng() < 0.08 ? 'strained' : 'nominal');

  const commsStatus: CommsStatus = blizzard
    ? (rng() < 0.15 ? 'down' : 'degraded')
    : (rng() < 0.06 ? 'degraded' : 'online');

  const infrastructure: InfrastructureReading = {
    hvacStatus,
    indoorTempC: round(
      walk(prev.infrastructure.indoorTempC, 0.35, hvacStatus === 'fault' ? 8 : 15, 24, rng),
      1,
    ),
    waterReserveL: Math.max(
      0,
      Math.round(prev.infrastructure.waterReserveL - prev.logistics.crewOnStation * 55 * elapsedHours / 24
        + (hvacStatus === 'nominal' ? profile.waterCapacityL * 0.0016 * elapsedHours : 0)),
    ),
    waterCapacityL: profile.waterCapacityL,
    structuralIntegrityPct: round(
      walk(prev.infrastructure.structuralIntegrityPct, blizzard ? 0.35 : 0.06, 70, 100, rng),
      1,
    ),
    commsStatus,
    uplinkLatencyMs: Math.round(
      commsStatus === 'down' ? 0 : walk(prev.infrastructure.uplinkLatencyMs, 180, 380, 2600, rng),
    ),
    wasteTankPct: round(clamp(prev.infrastructure.wasteTankPct + 0.02 * elapsedHours * 24, 0, 100), 1),
  };

  const logistics: LogisticsReading = {
    crewOnStation: prev.logistics.crewOnStation,
    crewCapacity: profile.crewCapacity,
    foodDaysRemaining: round(Math.max(0, prev.logistics.foodDaysRemaining - elapsedHours / 24), 2),
    medicalKits: prev.logistics.medicalKits,
    nextResupplyDays: round(Math.max(0, prev.logistics.nextResupplyDays - elapsedHours / 24), 2),
    pendingCargoTonnes: prev.logistics.pendingCargoTonnes,
  };

  return { environment, energy, infrastructure, logistics };
}

/**
 * Derive every active alert from a reading. Ordered most severe first so the
 * dashboard banner and the API agree on what matters most.
 */
export function evaluateAlerts(reading: Reading): Alert[] {
  const alerts: Alert[] = [];
  const { environment: env, energy, infrastructure: infra, logistics } = reading;

  // --- Environment -------------------------------------------------------
  if (env.windChillC <= -45) {
    alerts.push({
      pillar: 'environment', severity: 'critical', code: 'ENV_WIND_CHILL',
      message: `Wind chill ${env.windChillC}°C — outdoor operations suspended, frostbite in minutes`,
    });
  }
  if (env.blizzard) {
    alerts.push({
      pillar: 'environment', severity: 'critical', code: 'ENV_BLIZZARD',
      message: `Blizzard conditions — sustained winds ${env.windSpeedKts} kts`,
    });
  } else if (env.windSpeedKts >= 34) {
    alerts.push({
      pillar: 'environment', severity: 'warning', code: 'ENV_GALE',
      message: `Gale-force winds ${env.windSpeedKts} kts — secure external stores`,
    });
  }
  if (env.visibilityM < 100) {
    alerts.push({
      pillar: 'environment', severity: 'critical', code: 'ENV_WHITEOUT',
      message: `Whiteout — visibility ${env.visibilityM} m, all traverses halted`,
    });
  } else if (env.visibilityM < 1000) {
    alerts.push({
      pillar: 'environment', severity: 'warning', code: 'ENV_LOW_VIS',
      message: `Reduced visibility ${env.visibilityM} m`,
    });
  }

  // --- Energy ------------------------------------------------------------
  if (energy.dieselLevelPct < 15) {
    alerts.push({
      pillar: 'energy', severity: 'critical', code: 'PWR_FUEL_CRITICAL',
      message: `Diesel reserve ${energy.dieselLevelPct}% — below winter safety margin`,
    });
  } else if (energy.dieselLevelPct < 30) {
    alerts.push({
      pillar: 'energy', severity: 'warning', code: 'PWR_FUEL_LOW',
      message: `Diesel reserve ${energy.dieselLevelPct}% — schedule refuelling`,
    });
  }
  if (energy.generatorLoadKw > energy.generatorCapacityKw * 0.9) {
    alerts.push({
      pillar: 'energy', severity: 'warning', code: 'PWR_GEN_LOAD',
      message: `Generator at ${Math.round((energy.generatorLoadKw / energy.generatorCapacityKw) * 100)}% of rated capacity`,
    });
  }
  if (energy.batterySocPct < 25) {
    alerts.push({
      pillar: 'energy', severity: 'warning', code: 'PWR_BATTERY_LOW',
      message: `Battery bank at ${energy.batterySocPct}% state of charge`,
    });
  }

  // --- Infrastructure ----------------------------------------------------
  if (infra.hvacStatus === 'fault') {
    alerts.push({
      pillar: 'infrastructure', severity: 'critical', code: 'INF_HVAC_FAULT',
      message: 'HVAC fault — habitat heating loop requires immediate intervention',
    });
  } else if (infra.hvacStatus === 'strained') {
    alerts.push({
      pillar: 'infrastructure', severity: 'warning', code: 'INF_HVAC_STRAIN',
      message: 'HVAC running at sustained peak to hold habitat temperature',
    });
  }
  if (infra.indoorTempC < 16) {
    alerts.push({
      pillar: 'infrastructure', severity: 'critical', code: 'INF_HABITAT_COLD',
      message: `Habitat temperature ${infra.indoorTempC}°C — below liveable threshold`,
    });
  }
  if (infra.commsStatus === 'down') {
    alerts.push({
      pillar: 'infrastructure', severity: 'critical', code: 'INF_COMMS_DOWN',
      message: 'Satellite uplink down — station operating without remote link',
    });
  } else if (infra.commsStatus === 'degraded') {
    alerts.push({
      pillar: 'infrastructure', severity: 'warning', code: 'INF_COMMS_DEGRADED',
      message: `Uplink degraded — ${infra.uplinkLatencyMs} ms latency`,
    });
  }
  if (infra.waterReserveL < infra.waterCapacityL * 0.15) {
    alerts.push({
      pillar: 'infrastructure', severity: 'warning', code: 'INF_WATER_LOW',
      message: `Water reserve ${infra.waterReserveL} L — start melt-tank top-up`,
    });
  }
  if (infra.structuralIntegrityPct < 85) {
    alerts.push({
      pillar: 'infrastructure', severity: 'warning', code: 'INF_STRUCTURE',
      message: `Structural integrity index ${infra.structuralIntegrityPct}% — inspect module anchors`,
    });
  }

  // --- Logistics ---------------------------------------------------------
  if (logistics.foodDaysRemaining < 30) {
    alerts.push({
      pillar: 'logistics', severity: 'critical', code: 'LOG_FOOD_CRITICAL',
      message: `Only ${Math.floor(logistics.foodDaysRemaining)} days of rations remaining`,
    });
  } else if (logistics.foodDaysRemaining < 60) {
    alerts.push({
      pillar: 'logistics', severity: 'warning', code: 'LOG_FOOD_LOW',
      message: `${Math.floor(logistics.foodDaysRemaining)} days of rations remaining`,
    });
  }
  if (logistics.nextResupplyDays > logistics.foodDaysRemaining) {
    alerts.push({
      pillar: 'logistics', severity: 'critical', code: 'LOG_SUPPLY_GAP',
      message: `Resupply in ${Math.ceil(logistics.nextResupplyDays)} days but rations last ${Math.floor(logistics.foodDaysRemaining)} days`,
    });
  }
  if (logistics.medicalKits < 5) {
    alerts.push({
      pillar: 'logistics', severity: 'warning', code: 'LOG_MEDICAL_LOW',
      message: `${logistics.medicalKits} medical kits in store — below reserve level`,
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Worst severity present wins; no alerts means the station is nominal. */
export function deriveStatus(alerts: Alert[]): StationStatus {
  if (alerts.some((a) => a.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a.severity === 'warning')) return 'degraded';
  return 'nominal';
}

/**
 * Build `points` for an SVG <polyline> from a series, scaled to a box.
 * A flat series is drawn down the vertical middle rather than dividing by zero.
 */
export function sparklinePoints(values: number[], width = 220, height = 40): string {
  if (values.length === 0) return '';
  if (values.length === 1) return `0,${round(height / 2, 2)}`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = width / (values.length - 1);
  return values
    .map((value, index) => {
      const x = round(index * stepX, 2);
      const y = span === 0 ? height / 2 : round(height - ((value - min) / span) * height, 2);
      return `${x},${y}`;
    })
    .join(' ');
}
