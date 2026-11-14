import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/index.ts';
import { briefingComparisons } from '../../db/schema.ts';
import { compareBriefingsSchema } from '../../shared/schemas/index.ts';
import { AuthenticatedRequest, requireAuth, requireOrgAccess } from '../middleware/auth.ts';
import { compareBriefings } from '../services/analytics/comparisonEngine.ts';

export const comparisonRoutes = Router();

comparisonRoutes.post(
  '/',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = compareBriefingsSchema.parse(req.body);
      const comparison = await compareBriefings({
        organizationId: req.org!.organizationId,
        userId: req.auth!.userId,
        currentBriefingId: body.currentBriefingId,
        previousBriefingId: body.previousBriefingId,
      });
      res.status(201).json({ comparison });
    } catch (err) {
      next(err);
    }
  },
);

comparisonRoutes.get(
  '/',
  requireAuth,
  requireOrgAccess(),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const rows = await db
        .select()
        .from(briefingComparisons)
        .where(eq(briefingComparisons.organizationId, req.org!.organizationId))
        .orderBy(desc(briefingComparisons.id))
        .limit(30);

      res.json({
        comparisons: rows.map((r) => ({
          id: r.id,
          currentBriefingId: r.currentBriefingId,
          previousBriefingId: r.previousBriefingId,
          isComparable: r.isComparable,
          incomparabilityReasons: JSON.parse(r.incomparabilityReasonsJson),
          deltaMetrics: JSON.parse(r.deltaMetricsJson),
          summaryNarrative: r.summaryNarrative,
          createdAt: r.createdAt,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);
