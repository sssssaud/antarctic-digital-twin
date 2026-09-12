/**
 * Read model shared by the JSON API and the server-rendered dashboard, so both
 * surfaces always agree on status and alerts.
 */
import { Station, type StationDoc } from './models/station';
import { Telemetry } from './models/telemetry';
import {
  deriveStatus,
  evaluateAlerts,
  type Alert,
  type Reading,
  type StationCode,
  type StationStatus,
} from './telemetry-engine';

export interface Snapshot {
  station: StationDoc;
  reading: Reading | null;
  recordedAt: Date | null;
  alerts: Alert[];
  status: StationStatus;
}

export interface HistoryPoint extends Reading {
  recordedAt: Date;
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
    return { station, reading: null, recordedAt: null, alerts: [], status: 'nominal' };
  }

  const reading = toReading(latest);
  const alerts = evaluateAlerts(reading);

  return { station, reading, recordedAt: latest.recordedAt, alerts, status: deriveStatus(alerts) };
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
