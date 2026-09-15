/**
 * Read model shared by the JSON API and the server-rendered dashboard, so both
 * surfaces always agree on status and alerts.
 */
import { Station, type StationDoc } from './models/station';
import { Telemetry } from './models/telemetry';
import {
  STATION_PROFILES,
  deriveStatus,
  divergences,
  evaluateAlerts,
  type Alert,
  type Divergence,
  type Reading,
  type StationCode,
  type StationStatus,
  type TimedReading,
} from './telemetry-engine';

export interface Snapshot {
  station: StationDoc;
  reading: Reading | null;
  recordedAt: Date | null;
  alerts: Alert[];
  status: StationStatus;
  /**
   * Where the station has stopped matching its model. Deliberately kept out of
   * `status`: a threshold alert says the station is in trouble now, a divergence
   * says it is heading there while every gauge still reads normal. Folding one
   * into the other would throw away the only signal the twin adds.
   */
  divergences: Divergence[];
}

export type HistoryPoint = TimedReading;

/**
 * How far back the divergence engine looks. Slow faults — a seeping joint, a
 * fouled exchanger — only become visible once enough litres or kWh have moved
 * to stand clear of sensor noise.
 */
const DIVERGENCE_WINDOW_H = 12;

/**
 * Readings across the divergence window, oldest-first. Time-based rather than
 * count-based on purpose: the live simulator ticks every few seconds, so the
 * newest 72 rows can span six minutes, and no leak worth catching moves a
 * measurable amount of water in six minutes.
 */
async function getDivergenceWindow(code: StationCode): Promise<HistoryPoint[]> {
  const since = new Date(Date.now() - DIVERGENCE_WINDOW_H * 3_600_000);
  const rows = await Telemetry.find({ stationCode: code, recordedAt: { $gte: since } })
    .sort({ recordedAt: 1 })
    .lean()
    .exec();

  return rows.map((row) => ({ recordedAt: row.recordedAt, ...toReading(row) }));
}

function toReading(source: Reading): Reading {
  return {
    environment: source.environment,
    energy: source.energy,
    infrastructure: source.infrastructure,
    logistics: source.logistics,
  };
}

export async function getSnapshot(code: StationCode): Promise<Snapshot | null> {
  const station = await Station.findOne({ code }).lean<StationDoc>().exec();
  if (!station) return null;

  const latest = await Telemetry.findOne({ stationCode: code })
    .sort({ recordedAt: -1 })
    .lean()
    .exec();

  if (!latest) {
    return {
      station, reading: null, recordedAt: null, alerts: [], status: 'nominal', divergences: [],
    };
  }

  const reading = toReading(latest);
  const alerts = evaluateAlerts(reading);
  const window = await getDivergenceWindow(code);

  return {
    station,
    reading,
    recordedAt: latest.recordedAt,
    alerts,
    status: deriveStatus(alerts),
    divergences: divergences(window, STATION_PROFILES[code]),
  };
}

export async function getAllSnapshots(): Promise<Snapshot[]> {
  const stations = await Station.find().sort({ code: 1 }).lean<StationDoc[]>().exec();
  const snapshots: Snapshot[] = [];
  for (const station of stations) {
    const snapshot = await getSnapshot(station.code);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

/** Newest `limit` readings, returned oldest-first so charts read left to right. */
export async function getHistory(code: StationCode, limit: number): Promise<HistoryPoint[]> {
  const rows = await Telemetry.find({ stationCode: code })
    .sort({ recordedAt: -1 })
    .limit(limit)
    .lean()
    .exec();

  return rows
    .map((row) => ({ recordedAt: row.recordedAt, ...toReading(row) }))
    .reverse();
}

export interface StationAlert extends Alert {
  stationCode: StationCode;
  stationName: string;
}

export async function getAllAlerts(): Promise<StationAlert[]> {
  const snapshots = await getAllSnapshots();
  return snapshots.flatMap((snapshot) =>
    snapshot.alerts.map((alert) => ({
      ...alert,
      stationCode: snapshot.station.code,
      stationName: snapshot.station.name,
    })),
  );
}
