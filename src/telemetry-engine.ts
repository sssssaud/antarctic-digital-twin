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

// --- The healthy-plant model -------------------------------------------------
// One copy of the station's physics, shared by the simulator and the divergence
// engine. `nextReading` runs these numbers forward with noise and wear;
// `expectedReading` runs the same numbers clean. If the two ever stop reading
// from here, the divergence stops meaning anything and becomes decoration.

/** Diesel consumed per kWh the generator actually produces. */
const DIESEL_L_PER_KWH = 0.28;
/** Potable water drawn per person per day. */
const CREW_WATER_L_PER_DAY = 55;
/** Melt plant output, as a fraction of tank capacity per hour, while HVAC is nominal. */
const MELT_FRACTION_PER_H = 0.0016;

/** Heat + power a healthy station should draw at this air temperature, before noise. */
function modelDemandKw(profile: StationProfile, temperatureC: number): number {
  // Colder air pushes heating demand up.
  const coldLoad = clamp((-temperatureC - 10) / 30, 0, 1);
  return clamp(
    profile.generatorCapacityKw * (0.38 + coldLoad * 0.34),
    profile.generatorCapacityKw * 0.2,
    profile.generatorCapacityKw * 0.98,
  );
}

/**
 * Hidden degradation. The simulator is the only thing that ever sees this — the
 * divergence engine has to infer it from the readings, which is the whole point.
 * Never put it in a `Reading`, or the API would hand the twin its own answer.
 */
export interface PlantState {
  /** Fouled exchangers: more kW to hold the same indoor temperature, worse fuel burn. */
  foulingPct: number;
  /** Water leaving the loop without anyone drinking it, litres per hour. */
  leakLph: number;
}

export const HEALTHY_PLANT: PlantState = { foulingPct: 0, leakLph: 0 };

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
  plant: PlantState = HEALTHY_PLANT,
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

  // Fouling means more kW for the same weather — the excess is what gives it away.
  const demandKw = round(
    clamp(
      modelDemandKw(profile, temperatureC) * (1 + plant.foulingPct) + (rng() * 2 - 1) * 6,
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
  // Diesel burn ~0.28 L per kWh generated, degraded further by a fouled plant.
  const burnedL = generatorLoadKw * elapsedHours * DIESEL_L_PER_KWH * (1 + plant.foulingPct * 0.6);
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
      Math.round(prev.infrastructure.waterReserveL
        - prev.logistics.crewOnStation * CREW_WATER_L_PER_DAY * elapsedHours / 24
        + (hvacStatus === 'nominal' ? profile.waterCapacityL * MELT_FRACTION_PER_H * elapsedHours : 0)
        - plant.leakLph * elapsedHours),
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

// --- Divergence --------------------------------------------------------------
// The difference between a dashboard and a twin. A threshold alarm fires once a
// number leaves its safe band. A twin notices when a number stops matching the
// model *while still inside* that band: the generator is fine, the tank is fine,
// but the station is burning more fuel than this weather can explain. Nothing is
// alarming yet, and something is already wrong. That gap is the signal.

/** A reading with its clock attached, which is what the store hands back. */
export interface TimedReading extends Reading {
  recordedAt: Date;
}

/** What a healthy plant should be reading, given the weather and crew measured. */
export interface Expected {
  demandKw: number;
  dieselLitres: number;
  waterReserveL: number;
  /** Potable water the crew on station should have drawn over the step. */
  crewDrawL: number;
}

export type DivergenceMetric =
  | 'energy.demandKw'
  | 'energy.dieselLitres'
  | 'infrastructure.waterReserveL';

export interface Divergence {
  metric: DivergenceMetric;
  pillar: Pillar;
  label: string;
  unit: string;
  /** Model and measurement over the window, in the metric's own unit. */
  expected: number;
  actual: number;
  /** Residual as a share of the model. Positive means more than predicted. */
  ratio: number;
  severity: Severity;
  message: string;
}

/**
 * Run the healthy model one step forward from `prev`, using only what the
 * station actually measured in `now` — weather, generator load, crew, HVAC state.
 * It is deliberately blind to `PlantState`: the gap it leaves is the diagnosis.
 */
export function expectedReading(
  prev: Reading,
  now: Reading,
  profile: StationProfile,
  elapsedHours: number,
): Expected {
  // Crew draw is known, and the melt plant runs whenever HVAC is nominal.
  const crewDrawL = (prev.logistics.crewOnStation * CREW_WATER_L_PER_DAY * elapsedHours) / 24;
  const meltL =
    now.infrastructure.hvacStatus === 'nominal'
      ? profile.waterCapacityL * MELT_FRACTION_PER_H * elapsedHours
      : 0;
  return {
    demandKw: round(modelDemandKw(profile, now.environment.temperatureC), 1),
    // Generator load is measured, so only the burn rate per kWh is modelled here.
    dieselLitres:
      prev.energy.dieselLitres - now.energy.generatorLoadKw * elapsedHours * DIESEL_L_PER_KWH,
    waterReserveL: prev.infrastructure.waterReserveL - crewDrawL + meltL,
    crewDrawL,
  };
}

/** Residual bands, as a share of what the model predicted. */
const DIVERGENCE_BAND = { warning: 0.12, critical: 0.3 };

function gradeResidual(ratio: number): Severity | null {
  const size = Math.abs(ratio);
  if (size >= DIVERGENCE_BAND.critical) return 'critical';
  if (size >= DIVERGENCE_BAND.warning) return 'warning';
  return null;
}

/**
 * Compare a window of readings against the model, one consecutive pair at a time.
 *
 * Stocks (fuel, water) are judged by how far they *moved* across the window, never
 * by their level: a 300 L leak is invisible against a 65 000 L tank but glaring
 * against the 900 L the crew was supposed to drink. Rates (demand) are averaged,
 * so one noisy tick cannot raise an alarm by itself.
 */
export function divergences(
  history: readonly TimedReading[],
  profile: StationProfile,
): Divergence[] {
  let pairs = 0;
  let demandExpected = 0;
  let demandActual = 0;
  let dieselModelledDrop = 0;
  let dieselMeasuredDrop = 0;
  let waterModelledDrop = 0;
  let waterMeasuredDrop = 0;
  let waterCrewDraw = 0;

  for (let i = 1; i < history.length; i += 1) {
    const prev = history[i - 1];
    const now = history[i];
    if (!prev || !now) continue;
    const elapsedHours = (now.recordedAt.getTime() - prev.recordedAt.getTime()) / 3_600_000;
    // Duplicate rows and clock skew would divide by zero or run the model backwards.
    if (!(elapsedHours > 0)) continue;

    const model = expectedReading(prev, now, profile, elapsedHours);
    demandExpected += model.demandKw;
    demandActual += now.energy.demandKw;
    dieselModelledDrop += prev.energy.dieselLitres - model.dieselLitres;
    dieselMeasuredDrop += prev.energy.dieselLitres - now.energy.dieselLitres;
    waterModelledDrop += prev.infrastructure.waterReserveL - model.waterReserveL;
    waterMeasuredDrop += prev.infrastructure.waterReserveL - now.infrastructure.waterReserveL;
    waterCrewDraw += model.crewDrawL;
    pairs += 1;
  }
  if (pairs === 0) return [];

  const found: Divergence[] = [];
  const consider = (
    metric: DivergenceMetric,
    pillar: Pillar,
    label: string,
    unit: string,
    expected: number,
    actual: number,
    floor: number,
    message: (pct: number, over: boolean) => string,
  ): void => {
    // Below the floor the model predicts almost no movement, so the ratio would be
    // pure rounding noise. Stay quiet rather than invent a fault.
    if (Math.abs(expected) < floor) return;
    // Round once, then report and phrase from the same number. Rounding the
    // stored ratio separately from the one in the sentence puts "+14%" next to
    // "13% more fuel" on the same row.
    const ratio = round((actual - expected) / Math.abs(expected), 3);
    const severity = gradeResidual(ratio);
    if (!severity) return;
    found.push({
      metric,
      pillar,
      label,
      unit,
      expected: round(expected, 1),
      actual: round(actual, 1),
      ratio,
      severity,
      message: message(Math.round(Math.abs(ratio) * 100), ratio > 0),
    });
  };

  consider(
    'energy.demandKw', 'energy', 'Site demand', 'kW',
    demandExpected / pairs, demandActual / pairs, 1,
    (pct, over) => over
      ? `Drawing ${pct}% more power than this air temperature explains — fouled heat exchangers or a breach in the envelope.`
      : `Drawing ${pct}% less power than this air temperature explains — a load is offline, or the meter is under-reading.`,
  );
  consider(
    'energy.dieselLitres', 'energy', 'Fuel burn', 'L',
    dieselModelledDrop, dieselMeasuredDrop, 5,
    (pct, over) => over
      ? `Burning ${pct}% more fuel than the generator load accounts for — injectors, or a transfer line losing fuel.`
      : `Burning ${pct}% less fuel than the generator load accounts for — check the tank gauge before trusting it.`,
  );
  // Water that left the loop without anyone drinking it. The melt plant very
  // nearly cancels the crew draw, so the *net* change crosses zero and a ratio
  // taken against it is an artifact of that near-cancellation, not a measurement.
  // Against the crew draw the same litres read as what they are: unaccounted flow.
  const unaccountedL = waterMeasuredDrop - waterModelledDrop;
  consider(
    'infrastructure.waterReserveL', 'infrastructure', 'Water draw', 'L',
    waterCrewDraw, waterCrewDraw + unaccountedL, 20,
    (pct, over) => over
      ? `${pct}% more water is leaving the loop than the crew can account for — a leak downstream of the melt plant.`
      : `${pct}% less water is leaving the loop than the crew can account for — the melt plant is over-producing, or the level sensor is stuck.`,
  );

  const rank: Record<Severity, number> = { critical: 0, warning: 1 };
  return found.sort((a, b) => rank[a.severity] - rank[b.severity]);
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
