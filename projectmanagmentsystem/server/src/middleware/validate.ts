import type { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validate(schema: {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query) as any;
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params) as any;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues || (err as any).errors || [];
        const msg = issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ') || err.message;
        res.status(400).json({ error: msg, details: issues });
        return;
      }
      next(err);
    }
  };
}
