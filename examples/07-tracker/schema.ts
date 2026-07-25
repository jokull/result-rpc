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
      const issues: StandardSchemaIssue[] = [];
      if (typeof record.id !== "string" || record.id.length === 0) {
        issues.push({ message: "A client-minted id is required", path: ["id"] });
      }
      if (typeof record.projectId !== "string" || record.projectId.length === 0) {
        issues.push({ message: "A project is required", path: ["projectId"] });
      }
      if (typeof record.title !== "string" || record.title.trim().length < 3) {
        issues.push({ message: "Title must be at least 3 characters", path: ["title"] });
      }
      if (issues.length > 0) return { issues };
      return {
        value: {
          id: record.id as string,
          projectId: record.projectId as string,
          title: (record.title as string).trim(),
        },
      };
    },
  },
};
