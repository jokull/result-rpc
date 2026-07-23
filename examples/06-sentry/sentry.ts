/**
 * A minimal Sentry-shaped SDK stub. The surface mirrors `@sentry/browser` /
 * `@sentry/node` closely enough that the wiring in `app.tsx` is exactly what
 * a real app writes — swap this import for the real package and nothing else
 * changes.
 */
export interface Breadcrumb {
  readonly category: string;
  readonly message: string;
  readonly level: "info" | "warning" | "error";
  readonly data?: Record<string, unknown>;
}

export interface CapturedMessage {
  readonly message: string;
  readonly level: "info" | "warning" | "error";
}

export interface CapturedException {
  readonly exception: unknown;
  readonly tags: Record<string, string>;
}

export const createSentryStub = () => {
  const breadcrumbs: Breadcrumb[] = [];
  const messages: CapturedMessage[] = [];
  const exceptions: CapturedException[] = [];
  return {
    addBreadcrumb: (crumb: Breadcrumb) => void breadcrumbs.push(crumb),
    captureMessage: (message: string, level: CapturedMessage["level"] = "error") =>
      void messages.push({ message, level }),
    captureException: (exception: unknown, context?: { tags?: Record<string, string> }) =>
      void exceptions.push({ exception, tags: context?.tags ?? {} }),
    // test inspection
    breadcrumbs,
    messages,
    exceptions,
  };
};

export type SentryLike = ReturnType<typeof createSentryStub>;
