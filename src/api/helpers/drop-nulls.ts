/**
 * GraphQL отличает «поле не передано» (undefined) от явного null.
 * Доменные сервисы понимают только undefined = «не менять», поэтому
 * явные null из инпутов отбрасываются.
 */
export function dropNulls<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== null),
  ) as T;
}
