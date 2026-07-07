import { createHash } from "crypto";

export const isIterable = <T>(i: T | Iterable<T>): i is Iterable<T> => {
  return (
    typeof i === "object" && i != null && Symbol.iterator in (i as Iterable<T>)
  );
};


/**
 * Derives a replay-stable cache key from the call site of a keyless step.
 *
 * IMPORTANT: `stepFn` must be the synchronously-executing function that the
 * user called directly (e.g. the `step.run` wrapper) – NOT an async generator
 * body. Async generator bodies don't run until the first `.next()`, by which
 * point the user's frame is no longer on the stack. `Error.captureStackTrace`
 * omits every frame above (and including) `stepFn`, so the first captured
 * frame is the user's call site (file:line:column), which is deterministic
 * across executions of the same workflow code.
 */
export function getCallSiteHash(stepFn: Function): string {
  const holder: { stack?: string } = {};

  Error.captureStackTrace(holder, stepFn);

  const frames = (holder.stack ?? "")
    .split("\n")
    .filter((line) => /^\s*at\s/.test(line));

  const callSite = frames[0]?.trim();

  if (!callSite) {
    throw new Error(
      "Could not derive a cache key from the call site. Pass an explicit key to this step."
    );
  }

  return createHash("sha1").update(callSite).digest("hex");
}
