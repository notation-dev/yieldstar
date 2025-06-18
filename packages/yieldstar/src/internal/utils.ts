import { createHash } from "crypto";

export const isIterable = <T>(i: T | Iterable<T>): i is Iterable<T> => {
  return (
    typeof i === "object" && i != null && Symbol.iterator in (i as Iterable<T>)
  );
};


export function getCallSiteHash(stepFn: Function) {
  const originalStack = (stepFn as any).stack;

  Error.captureStackTrace(stepFn, getCallSiteHash);

  const stack = (stepFn as any).stack
  const stepFnCallSite = stack.split(')')[1]

  if (originalStack === undefined) {
    delete (stepFn as any).stack;
  } else {
    (stepFn as any).stack = originalStack;
  }

  return createHash("sha1").update(stepFnCallSite).digest("hex");
}
