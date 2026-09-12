import { Router } from 'express';
import {
  getStation,
  getStationTelemetry,
  health,
  listAlerts,
  listStations,
} from '../controllers/api';

const router = Router();

router.get('/health', health);
router.get('/stations', listStations);
router.get('/stations/:code', getStation);
router.get('/stations/:code/telemetry', getStationTelemetry);
router.get('/alerts', listAlerts);

// Anything else under /api is a client mistake, not a page.
router.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Unknown API endpoint' });
});

export default router;
