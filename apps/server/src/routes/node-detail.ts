import { NodeDetailDTO, SeriesDTO, SignalDTO, TelemetryKind, Uint32 } from "@meshterm/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { getConnection } from "../db/repositories.js";
import { buildNodeDetail } from "../nodes/detail.js";
import { METRIC_NAME, signalSeries, telemetryCsv, telemetrySeries } from "../nodes/series.js";
import { HttpError } from "./http-error.js";

const NodeParams = z.object({
  id: z.coerce.number().int().positive(),
  num: z.coerce.number().pipe(Uint32),
});

const DAY_MS = 24 * 3600_000;
/** Longest range one request may ask for. */
export const MAX_RANGE_MS = 366 * DAY_MS;

const Range = z
  .object({
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().positive().optional(),
    /** Force a bucket width (ms); 0 = raw. Normally the server picks one. */
    bucket: z.coerce.number().int().min(0).max(DAY_MS).optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from < q.to, {
    message: "from must be before to",
  });

/** Node detail (the drawer) and its telemetry/signal series and CSV export. */
export const nodeDetailRoutes: FastifyPluginAsyncZod = (app) => {
  const { db, clock } = app.meshterm;
  const requireConnection = (id: number) => {
    if (!getConnection(db, id)) throw new HttpError(404, "not_found", `connection ${id} not found`);
  };
  /** Defaults to the last 24 h; at most `MAX_RANGE_MS`. */
  const range = (q: { from?: number | undefined; to?: number | undefined }) => {
    const to = q.to ?? clock.now();
    const from = q.from ?? to - DAY_MS;
    if (to - from > MAX_RANGE_MS) {
      throw new HttpError(400, "range_too_long", "ranges are limited to 366 days");
    }
    return { from, to };
  };

  app.get(
    "/api/connections/:id/nodes/:num",
    { schema: { params: NodeParams, response: { 200: NodeDetailDTO } } },
    (req) => {
      const { id, num } = req.params;
      requireConnection(id);
      const detail = buildNodeDetail(db, id, num, clock.now());
      if (!detail) throw new HttpError(404, "not_found", `node ${num} not found`);
      return detail;
    },
  );

  app.get(
    "/api/connections/:id/nodes/:num/telemetry",
    {
      schema: {
        params: NodeParams,
        querystring: Range.and(
          z.object({
            kind: TelemetryKind.default("device"),
            /** Comma-separated metric names; default: every metric present in the range. */
            metrics: z
              .string()
              .optional()
              .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
              .refine((list) => list === undefined || list.every((m) => METRIC_NAME.test(m)), {
                message: "unknown metric name",
              }),
          }),
        ),
        response: { 200: SeriesDTO },
      },
    },
    (req) => {
      const { id, num } = req.params;
      requireConnection(id);
      const { kind, metrics, bucket } = req.query;
      return telemetrySeries(db, id, num, kind, {
        ...range(req.query),
        ...(bucket === undefined ? {} : { bucketMs: bucket }),
        ...(metrics ? { metrics } : {}),
      });
    },
  );

  app.get(
    "/api/connections/:id/nodes/:num/signal",
    { schema: { params: NodeParams, querystring: Range, response: { 200: SignalDTO } } },
    (req) => {
      const { id, num } = req.params;
      requireConnection(id);
      const { bucket } = req.query;
      return signalSeries(db, id, num, {
        ...range(req.query),
        ...(bucket === undefined ? {} : { bucketMs: bucket }),
      });
    },
  );

  app.get(
    "/api/connections/:id/nodes/:num/telemetry.csv",
    { schema: { params: NodeParams, querystring: Range } },
    (req, reply) => {
      const { id, num } = req.params;
      requireConnection(id);
      const { from, to } = range(req.query);
      if (to - from > 31 * DAY_MS) {
        throw new HttpError(400, "range_too_long", "CSV exports are limited to 31 days");
      }
      const name = `node-${num.toString(16).padStart(8, "0")}-telemetry.csv`;
      return reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${name}"`)
        .send(telemetryCsv(db, id, num, from, to));
    },
  );

  return Promise.resolve();
};
