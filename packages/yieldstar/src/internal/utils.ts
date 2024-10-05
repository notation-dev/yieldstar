export const isIterable = <T>(i: T | Iterable<T>): i is Iterable<T> => {
  return (
    typeof i === "object" && i != null && Symbol.iterator in (i as Iterable<T>)
  );
};
