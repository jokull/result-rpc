/**
 * A hand-rolled Standard Schema v1 validator, adopted as a wire codec via
 * wire.standard in the contract. No Zod/Valibot dependency — the interface
 * comes straight from the package root.
 *
 * The same schema validates the human in the form (progressive field errors
 * before the wire is ever involved) and the application boundary on both
 * sides of the wire.
 */
import type {
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from "../../src/index.js";

export interface CreateIssueInput {
  id: string;
  projectId: string;
  title: string;
}

export const createIssueSchema: StandardSchemaV1<CreateIssueInput, CreateIssueInput> = {
  "~standard": {
    version: 1,
    vendor: "07-tracker",
    validate(value: unknown): StandardSchemaResult<CreateIssueInput> {
      if (typeof value !== "object" || value === null) {
        return { issues: [{ message: "Expected an object" }] };
      }
      const record = value as Record<string, unknown>;
      const { id, projectId, title } = record;
      const issues: StandardSchemaIssue[] = [];
      const idIsValid = typeof id === "string" && id.length > 0;
      const projectIdIsValid = typeof projectId === "string" && projectId.length > 0;
      const titleIsValid = typeof title === "string" && title.trim().length >= 3;
      if (!idIsValid) {
        issues.push({ message: "A client-minted id is required", path: ["id"] });
      }
      if (!projectIdIsValid) {
        issues.push({ message: "A project is required", path: ["projectId"] });
      }
      if (!titleIsValid) {
        issues.push({ message: "Title must be at least 3 characters", path: ["title"] });
      }
      if (!idIsValid || !projectIdIsValid || !titleIsValid) return { issues };
      return { value: { id, projectId, title: title.trim() } };
    },
  },
};
