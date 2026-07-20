export interface RequirementParams {
  method: string;
  /** core userId авторизованного клиента. */
  userId?: string | null;
  /** identity из unauthed-запроса (login из signIn) — гейтвей извлекает сам. */
  identity?: string | null;
}
