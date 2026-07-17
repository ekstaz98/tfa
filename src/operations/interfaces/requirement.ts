export interface RequirementParams {
  method: string;
  /** core userId авторизованного клиента. */
  userId?: string | null;
  /** identity из unauthed-запроса (login из signin) — гейтвей извлекает сам. */
  identity?: string | null;
}
