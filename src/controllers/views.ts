/**
 * Server-rendered dashboard. Renders `layout.ejs`, which pulls in the page named
 * by the `view` local — one wrapper, any number of pages, no layout dependency.
 */
import type { NextFunction, Request, Response } from 'express';
import { facilityModel, zoneSeverities } from '../facility';
import { getAllSnapshots, getHistory } from '../station-service';
import { parseStationCode, sparklinePoints } from '../telemetry-engine';

const SPARKLINE_POINTS = 48;
/** Station shown when no ?station= is supplied. */
const DEFAULT_STATION = 'MAITRI';
/** The 3D twin is traced from Bharati's drawings; Maitri has no published set. */
const MODELLED_STATION = 'BHARATI';

/** Formatting helpers handed to the templates as locals. */
export const helpers = {
  num(value: number | null | undefined, dp = 1): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return value.toFixed(dp);
  },
  int(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
    return Math.round(value).toLocaleString('en-IN');
  },
  pct(value: number | null | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  },
  clock(date: Date | null | undefined): string {
    if (!date) return '--:--:--';
    return `${date.toISOString().slice(11, 19)} UTC`;
  },
  stamp(date: Date | null | undefined): string {
    if (!date) return 'no contact';
    return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  },
};

/**
 * The 3D twin. The building's geometry is static, so it is serialised into the
 * page once; only the live half is polled afterwards from `/api/facility`.
 */
export async function twin(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const snapshots = await getAllSnapshots();
    const active = snapshots.find((s) => s.station.code === MODELLED_STATION);

    if (!active) {
      res.status(503).render('layout', {
        view: 'error',
        helpers,
        title: 'Twin not ready',
        status: 503,
        heading: 'Bharati has not been seeded',
        detail: 'The 3D twin is modelled on Bharati. Retry once the seeder has finished.',
      });
      return;
    }

    res.render('layout', {
      view: 'twin',
      helpers,
      title: `${active.station.name} — 3D Twin`,
      snapshots,
      active,
      facility: facilityModel(),
      zones: zoneSeverities(active.alerts),
      generatedAt: new Date(),
    });
  } catch (error) {
    next(error);
  }
}

export async function dashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const snapshots = await getAllSnapshots();

    if (snapshots.length === 0) {
      res.status(503).render('layout', {
        view: 'error',
        helpers,
        title: 'Twin not ready',
        status: 503,
        heading: 'Telemetry store is empty',
        detail: 'The seeder has not finished populating the in-memory database. Retry in a moment.',
      });
      return;
    }

    // An unknown or absent ?station= falls back to the flagship station rather
    // than erroring: a dashboard should always render something useful.
    const requested = parseStationCode(req.query.station) ?? DEFAULT_STATION;
    const active = snapshots.find((s) => s.station.code === requested) ?? snapshots[0]!;

    const history = await getHistory(active.station.code, SPARKLINE_POINTS);
    const temperatureSeries = history.map((point) => point.environment.temperatureC);
    const windSeries = history.map((point) => point.environment.windSpeedKts);
    const demandSeries = history.map((point) => point.energy.demandKw);

    res.render('layout', {
      view: 'dashboard',
      helpers,
      title: `${active.station.name} — Antarctic Digital Twin`,
      snapshots,
      active,
      history,
      sparklines: {
        temperature: sparklinePoints(temperatureSeries, 240, 44),
        wind: sparklinePoints(windSeries, 240, 44),
        demand: sparklinePoints(demandSeries, 240, 44),
      },
      series: { temperature: temperatureSeries, wind: windSeries, demand: demandSeries },
      generatedAt: new Date(),
    });
  } catch (error) {
    next(error);
  }
}
