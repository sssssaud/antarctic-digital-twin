import { Router } from 'express';
import { dashboard, twin } from '../controllers/views';

const router = Router();

router.get('/', dashboard);
router.get('/twin', twin);

export default router;
