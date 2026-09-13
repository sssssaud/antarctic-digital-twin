/**
 * The building itself: Bharati's zones, the equipment inside them, and the
 * service lines between them.
 *
 * Pure data plus lookups, no I/O. The 3D view and the alert mapping both read
 * from here, so a room cannot light up for an alert that no longer exists.
 *
 * Geometry is traced from the published architectural set — longitudinal
 * section (column grid 1..21, datums H1..H4), end elevation (shell profile)
 * and the BIM services model. It is *proportional*, not surveyed: bay and
 * storey spacing come from the drawings' own grid, scaled to plausible metres.
 */
import type { Pillar, Severity } from './telemetry-engine';

/** Structural column lines 1..21 running the length of the building. */
export const BAYS = 21;
/** Metres per bay, derived from the section's grid against its storey heights. */
export const BAY_M = 3.15;
/**
 * Half-width of the shell at its widest (the top edge), in metres.
 *
 * 18 m across against a 66 m length puts the footprint near 1200 m², which lands
 * the three decks close to Bharati's published ~2500 m² built-up area. Twice this
 * would make the station a hangar.
 */
export const HALF_WIDTH_M = 9;
/** The shell tapers inward going down; this is the bottom half-width. */
export const HALF_WIDTH_BOTTOM_M = 7.3;

/** Elevation datums from the drawings, metres above the rock. */
export const DATUM = {
  ground: 0,
  h1: 3.4,
  h2: 7.4,
  h3: 10.9,
  h4: 14.7,
} as const;

/** The four occupied bands, each spanning two datums. */
export type Level = 'under' | 'lower' | 'main' | 'roof';

export const LEVELS: Record<Level, { from: number; to: number; label: string }> = {
  under: { from: DATUM.ground, to: DATUM.h1, label: 'Understorey' },
  lower: { from: DATUM.h1, to: DATUM.h2, label: 'Lower deck' },
  main: { from: DATUM.h2, to: DATUM.h3, label: 'Main deck' },
  roof: { from: DATUM.h3, to: DATUM.h4, label: 'Roof deck' },
};

/**
 * One reading a zone is responsible for. `metric` is a dotted path into a
 * `Reading`, so the client can resolve it against whatever the API last sent
 * without this file knowing anything about transport.
 */
export interface Instrument {
  label: string;
  metric: string;
  unit: string;
  dp?: number;
}

export interface Zone {
  id: string;
  name: string;
  level: Level;
  /** Half-open span across the column grid: [from, to) in bay numbers. */
  bays: [number, number];
  pillar: Pillar;
  /** Rooms with no walls (terrace, balcony) draw as a deck, not a box. */
  open?: boolean;
  instruments: Instrument[];
}

export const ZONES: Zone[] = [
  // --- Understorey: tanks and plant, under the occupied decks -------------
  {
    id: 'fuel-store',
    name: 'Diesel tank farm',
    level: 'under',
    bays: [1, 4.5],
    pillar: 'energy',
    instruments: [
      { label: 'Tank level', metric: 'energy.dieselLevelPct', unit: '%', dp: 1 },
      { label: 'Remaining', metric: 'energy.dieselLitres', unit: 'L', dp: 0 },
    ],
  },
  {
    id: 'water-plant',
    name: 'Water plant & melt tanks',
    level: 'under',
    bays: [9, 12],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Reserve', metric: 'infrastructure.waterReserveL', unit: 'L', dp: 0 },
      { label: 'Waste tank', metric: 'infrastructure.wasteTankPct', unit: '%', dp: 1 },
    ],
  },

  // --- Lower deck (H1 to H2) ---------------------------------------------
  {
    id: 'garage',
    name: 'Garage',
    level: 'lower',
    bays: [1, 4.5],
    pillar: 'logistics',
    instruments: [{ label: 'Snow depth', metric: 'environment.snowDepthCm', unit: 'cm', dp: 1 }],
  },
  {
    id: 'workshop',
    name: 'Workshop',
    level: 'lower',
    bays: [4.5, 8],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Structure', metric: 'infrastructure.structuralIntegrityPct', unit: '%', dp: 1 },
    ],
  },
  {
    id: 'stair-lower',
    name: 'Staircase',
    level: 'lower',
    bays: [8, 9],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'storage',
    name: 'General storage',
    level: 'lower',
    bays: [9, 10.5],
    pillar: 'logistics',
    instruments: [
      { label: 'Pending cargo', metric: 'logistics.pendingCargoTonnes', unit: 't', dp: 1 },
      { label: 'Medical kits', metric: 'logistics.medicalKits', unit: '', dp: 0 },
    ],
  },
  {
    id: 'corridor-lower',
    name: 'Corridor',
    level: 'lower',
    bays: [10.5, 13],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'lab-biology',
    name: 'Biology laboratory',
    level: 'lower',
    bays: [13, 15.5],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Indoor temp', metric: 'infrastructure.indoorTempC', unit: '°C', dp: 1 },
    ],
  },

  // --- Main deck (H2 to H3) ----------------------------------------------
  {
    id: 'emergency-exit',
    name: 'Emergency exit',
    level: 'main',
    bays: [0.5, 1.2],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'dining-hall',
    name: 'Dining hall',
    level: 'main',
    bays: [1.2, 4],
    pillar: 'logistics',
    instruments: [
      { label: 'Crew aboard', metric: 'logistics.crewOnStation', unit: '', dp: 0 },
      { label: 'Rations left', metric: 'logistics.foodDaysRemaining', unit: 'd', dp: 0 },
    ],
  },
  {
    id: 'cold-store-a',
    name: 'Cold storage A',
    level: 'main',
    bays: [4, 5],
    pillar: 'logistics',
    instruments: [
      { label: 'Rations left', metric: 'logistics.foodDaysRemaining', unit: 'd', dp: 0 },
    ],
  },
  {
    id: 'cold-store-b',
    name: 'Cold storage B',
    level: 'main',
    bays: [5, 6],
    pillar: 'logistics',
    instruments: [
      { label: 'Next resupply', metric: 'logistics.nextResupplyDays', unit: 'd', dp: 0 },
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical room',
    level: 'main',
    bays: [6, 7.5],
    pillar: 'energy',
    instruments: [
      { label: 'Generator', metric: 'energy.generatorLoadKw', unit: 'kW', dp: 1 },
      { label: 'Demand', metric: 'energy.demandKw', unit: 'kW', dp: 1 },
      { label: 'Battery', metric: 'energy.batterySocPct', unit: '%', dp: 1 },
      { label: 'Solar', metric: 'energy.solarOutputKw', unit: 'kW', dp: 1 },
      { label: 'Wind', metric: 'energy.windOutputKw', unit: 'kW', dp: 1 },
    ],
  },
  {
    id: 'stair-main',
    name: 'Staircase',
    level: 'main',
    bays: [7.5, 8.8],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'toilet',
    name: 'Toilets',
    level: 'main',
    bays: [8.8, 10.5],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Water reserve', metric: 'infrastructure.waterReserveL', unit: 'L', dp: 0 },
    ],
  },
  {
    id: 'bathroom',
    name: 'Bathrooms',
    level: 'main',
    bays: [10.5, 12.5],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Waste tank', metric: 'infrastructure.wasteTankPct', unit: '%', dp: 1 },
    ],
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    level: 'main',
    bays: [12.5, 15.5],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Indoor temp', metric: 'infrastructure.indoorTempC', unit: '°C', dp: 1 },
    ],
  },
  {
    id: 'corridor-main',
    name: 'Corridor',
    level: 'main',
    bays: [15.5, 17],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'lounge-bar',
    name: 'Lounge & bar',
    level: 'main',
    bays: [17, 20],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Indoor temp', metric: 'infrastructure.indoorTempC', unit: '°C', dp: 1 },
    ],
  },
  {
    id: 'balcony',
    name: 'Balcony',
    level: 'main',
    bays: [20, 21.3],
    pillar: 'environment',
    open: true,
    instruments: [
      { label: 'Wind chill', metric: 'environment.windChillC', unit: '°C', dp: 1 },
    ],
  },

  // --- Roof deck (H3 to H4) ----------------------------------------------
  {
    id: 'plant-room',
    name: 'HVAC plant room',
    level: 'roof',
    bays: [4.5, 7],
    pillar: 'infrastructure',
    instruments: [
      { label: 'HVAC', metric: 'infrastructure.hvacStatus', unit: '' },
      { label: 'Indoor temp', metric: 'infrastructure.indoorTempC', unit: '°C', dp: 1 },
    ],
  },
  {
    id: 'stair-roof',
    name: 'Staircase',
    level: 'roof',
    bays: [7, 8],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'vestibule',
    name: 'Vestibule',
    level: 'roof',
    bays: [8, 9.2],
    pillar: 'infrastructure',
    instruments: [],
  },
  {
    id: 'terrace',
    name: 'Terrace',
    level: 'roof',
    bays: [9.2, 16],
    pillar: 'environment',
    open: true,
    instruments: [{ label: 'Snow depth', metric: 'environment.snowDepthCm', unit: 'cm', dp: 1 }],
  },
  {
    id: 'met-mast',
    name: 'Meteorological mast',
    level: 'roof',
    bays: [16, 17],
    pillar: 'environment',
    instruments: [
      { label: 'Air temp', metric: 'environment.temperatureC', unit: '°C', dp: 1 },
      { label: 'Wind chill', metric: 'environment.windChillC', unit: '°C', dp: 1 },
      { label: 'Wind', metric: 'environment.windSpeedKts', unit: 'kt', dp: 1 },
      { label: 'Gust', metric: 'environment.windGustKts', unit: 'kt', dp: 1 },
      { label: 'Visibility', metric: 'environment.visibilityM', unit: 'm', dp: 0 },
      { label: 'Pressure', metric: 'environment.pressureHpa', unit: 'hPa', dp: 0 },
    ],
  },
  {
    id: 'comms',
    name: 'Satellite uplink',
    level: 'roof',
    bays: [17, 18.5],
    pillar: 'infrastructure',
    instruments: [
      { label: 'Link', metric: 'infrastructure.commsStatus', unit: '' },
      { label: 'Latency', metric: 'infrastructure.uplinkLatencyMs', unit: 'ms', dp: 0 },
    ],
  },
];

/**
 * The frame itself — stilts, columns, shell. Not a room, but structural alerts
 * have to land somewhere visible, so the client tints the columns for this id.
 */
export const STRUCTURE_ID = 'structure';

/**
 * Which zones an alert lights up. Every code `evaluateAlerts` can emit appears
 * here; the engine self-check fails if one is added without a home.
 *
 * ponytail: LOG_MEDICAL_LOW lands on general storage — the section labels no
 * medical bay, and inventing a room the drawings do not show would be worse.
 */
export const ALERT_ZONES: Record<string, string[]> = {
  ENV_WIND_CHILL: ['met-mast'],
  ENV_BLIZZARD: ['met-mast', 'terrace'],
  ENV_GALE: ['met-mast'],
  ENV_WHITEOUT: ['met-mast'],
  ENV_LOW_VIS: ['met-mast'],

  PWR_FUEL_CRITICAL: ['fuel-store'],
  PWR_FUEL_LOW: ['fuel-store'],
  PWR_GEN_LOAD: ['electrical'],
  PWR_BATTERY_LOW: ['electrical'],

  INF_HVAC_FAULT: ['plant-room'],
  INF_HVAC_STRAIN: ['plant-room'],
  INF_HABITAT_COLD: ['dining-hall', 'lounge-bar', 'entertainment', 'lab-biology'],
  INF_COMMS_DOWN: ['comms'],
  INF_COMMS_DEGRADED: ['comms'],
  INF_WATER_LOW: ['water-plant', 'toilet', 'bathroom'],
  INF_STRUCTURE: [STRUCTURE_ID],

  LOG_FOOD_CRITICAL: ['cold-store-a', 'cold-store-b', 'dining-hall'],
  LOG_FOOD_LOW: ['cold-store-a', 'cold-store-b'],
  LOG_SUPPLY_GAP: ['storage'],
  LOG_MEDICAL_LOW: ['storage'],
};

/** A point on a service run: bay along the grid, metres up, metres off centre. */
export interface RoutePoint {
  bay: number;
  y: number;
  z: number;
}

export interface ServiceLine {
  id: string;
  name: string;
  /** Drives how fast the flow markers travel; a dotted path into a `Reading`. */
  rateMetric: string;
  /** Value of `rateMetric` at which the run is considered at full flow. */
  rateFull: number;
  points: RoutePoint[];
}

/** Routed off the BIM services model: fuel rises, water crosses, air drops. */
export const SERVICE_LINES: ServiceLine[] = [
  {
    id: 'diesel',
    name: 'Diesel feed',
    rateMetric: 'energy.generatorLoadKw',
    rateFull: 260,
    // Fuel store under-deck, out to the service side, up the riser, into the
    // generator hall. Same path a walk-down would follow.
    points: [
      { bay: 2.7, y: 1.7, z: 0 },
      { bay: 2.7, y: 1.7, z: -3.6 },
      { bay: 5.2, y: 1.7, z: -3.6 },
      { bay: 5.2, y: 5.4, z: -3.6 },
      { bay: 5.2, y: 9.1, z: -3.6 },
      { bay: 6.8, y: 9.1, z: -2.2 },
    ],
  },
  {
    id: 'water',
    name: 'Water main',
    rateMetric: 'logistics.crewOnStation',
    rateFull: 48,
    // Melt plant under-deck, riser at bay 10.5, then along the main deck to the
    // wet rooms and on to the galley at the far end.
    points: [
      { bay: 10.5, y: 1.7, z: 2.8 },
      { bay: 10.5, y: 5.4, z: 2.8 },
      { bay: 10.5, y: 9.1, z: 2.8 },
      { bay: 9.4, y: 9.1, z: 3.6 },
      { bay: 5.0, y: 9.1, z: 3.6 },
      { bay: 2.6, y: 9.1, z: 2.8 },
    ],
  },
  {
    id: 'hvac',
    name: 'Supply air',
    rateMetric: 'energy.demandKw',
    rateFull: 300,
    points: [
      { bay: 5.7, y: 12.4, z: 0 },
      { bay: 5.7, y: 10.2, z: 0 },
      { bay: 9, y: 10.2, z: 0 },
      { bay: 14, y: 10.2, z: 0 },
      { bay: 19.8, y: 10.2, z: 0 },
    ],
  },
];

/** Zone lookup by id — the client asks for these by name constantly. */
export function zoneById(id: string): Zone | undefined {
  return ZONES.find((zone) => zone.id === id);
}

/**
 * Zones an alert set touches, mapped to the worst severity landing on each.
 * Unknown codes are skipped rather than thrown: a new alert should not blank
 * the whole building while its home is still being decided.
 */
export function zoneSeverities(
  alerts: { code: string; severity: Severity }[],
): Record<string, Severity> {
  const out: Record<string, Severity> = {};
  for (const alert of alerts) {
    for (const id of ALERT_ZONES[alert.code] ?? []) {
      if (out[id] !== 'critical') out[id] = alert.severity;
    }
  }
  return out;
}

/** Everything the browser needs to draw the building, in one payload. */
export function facilityModel() {
  return {
    bays: BAYS,
    bayM: BAY_M,
    halfWidthM: HALF_WIDTH_M,
    halfWidthBottomM: HALF_WIDTH_BOTTOM_M,
    datum: DATUM,
    levels: LEVELS,
    structureId: STRUCTURE_ID,
    zones: ZONES,
    services: SERVICE_LINES,
  };
}
