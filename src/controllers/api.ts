/**
 * JSON API controllers. Every handler is wrapped in try/catch and forwards to
 * the central error middleware — a failed query must never take the server down.
 */
import type { NextFunction, Request, Response } from 'express';
import { isDatabaseConnected } from '../db';
import { getAllAlerts, getAllSnapshots, getHistory, getSnapshot } from '../station-service';
import { STATION_CODES, parseStationCode, type StationCode } from '../telemetry-engine';

const DEFAULT_HISTORY = 72;
const MAX_HISTORY = 500;

/** Validate the :code path parameter, replying 400 when it is not a known station. */
function requireStationCode(req: Request, res: Response): StationCode | null {
  const code = parseStationCode(req.params.code);
  if (!code) {
    res.status(400).json({
      ok: false,
      error: 'Unknown station code',
      validCodes: STATION_CODES,
    });
    return null;
  }
  return code;
}

/** Coerce ?limit= to a sane integer; anything unparseable falls back to the default. */
function parseLimit(raw: unknown): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_HISTORY;
  return Math.min(value, MAX_HISTORY);
}

export async function health(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      ok: true,
      service: 'antarctic-digital-twin',
      problemStatement: 'SIH 2026 / 26060',
      database: isDatabaseConnected() ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function listStations(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const snapshots = await getAllSnapshots();
    res.json({ ok: true, count: snapshots.length, data: snapshots });
  } catch (error) {
    next(error);
  }
}

export async function getStation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = requireStationCode(req, res);
    if (!code) return;

    const snapshot = await getSnapshot(code);
    if (!snapshot) {
      res.status(404).json({ ok: false, error: `Station ${code} has not been seeded` });
      return;
    }
    res.json({ ok: true, data: snapshot });
  } catch (error) {
    next(error);
  }
}

export async function getStationTelemetry(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const code = requireStationCode(req, res);
    if (!code) return;

    const limit = parseLimit(req.query.limit);
    const history = await getHistory(code, limit);
    res.json({ ok: true, stationCode: code, count: history.length, limit, data: history });
  } catch (error) {
    next(error);
  }
}

export async function listAlerts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const alerts = await getAllAlerts();
    res.json({
      ok: true,
      count: alerts.length,
      critical: alerts.filter((a) => a.severity === 'critical').length,
      warning: alerts.filter((a) => a.severity === 'warning').length,
      data: alerts,
    });
  } catch (error) {
    next(error);
  }
}
