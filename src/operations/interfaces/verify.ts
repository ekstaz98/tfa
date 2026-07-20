export interface VerifyParams {
  operationId: string;
  method: string;
  /** core userId — гейтвей передаёт для authed-запросов. */
  userId?: string | null;
  codes: Array<{ type: string; code: string }>;
}

export interface VerifyResult {
  verified: boolean;
  /** Гейтвею для signIn нужно знать, кто прошёл проверку. */
  userId: string | null;
  identity: string | null;
}
