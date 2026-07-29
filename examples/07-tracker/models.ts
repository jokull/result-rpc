/**
 * Entity models and shared wire shapes. Outputs composed from model codecs
 * participate in identity-based cache patching; inline wire.object shapes
 * do not.
 */
import { defineModel, wire, type InputOf } from "../../src/index.js";

export const User = defineModel("user", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
  },
});

export const Project = defineModel("project", {
  key: "id",
  shape: {
    id: wire.string,
    name: wire.string,
    openCount: wire.number,
  },
});

export const ActivityEventCodec = wire.object({
  id: wire.string,
  issueId: wire.string,
  message: wire.string,
  at: wire.date,
});
export type ActivityEvent = InputOf<typeof ActivityEventCodec>;

export const Issue = defineModel("issue", {
  key: "id",
  shape: {
    id: wire.string,
    projectId: wire.string,
    title: wire.string,
    status: wire.union([wire.literal("open"), wire.literal("closed")]),
    assigneeId: wire.union([wire.string, wire.null]),
    closedAt: wire.union([wire.date, wire.null]),
  },
});
