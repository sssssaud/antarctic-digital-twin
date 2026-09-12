import { Router } from 'express';
import { dashboard } from '../controllers/views';

const router = Router();

router.get('/', dashboard);

export default router;
