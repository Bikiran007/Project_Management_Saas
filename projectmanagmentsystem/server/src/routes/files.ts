import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { env } from '../config/env.js';

const router = Router();

router.get('/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.resolve(env.UPLOAD_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).send('File not found');
    return;
  }

  res.sendFile(filePath);
});

export default router;
