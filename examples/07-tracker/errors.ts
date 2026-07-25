/**
 * Domain errors for the tracker, declared once as namespaced maps.
 * Keys become tags (camelCase key -> kebab-case tag segment).
 */
import { defineErrors, wire } from "../../src/index.js";

export const authErrors = defineErrors("auth", {
  unauthorized: { httpStatus: 401 },
});

export const issueErrors = defineErrors("issue", {
  notFound: { data: wire.object({ issueId: wire.string }), httpStatus: 404 },
  closed: {
    data: wire.object({ issueId: wire.string, closedAt: wire.date }),
    httpStatus: 409,
  },
  titleTaken: { data: wire.object({ title: wire.string }), httpStatus: 409 },
});

export const projectErrors = defineErrors("project", {
  forbidden: { data: wire.object({ projectId: wire.string }), httpStatus: 403 },
});

export const directoryErrors = defineErrors("directory", {
  unavailable: { httpStatus: 503, retry: "transient" },
});
