/** Порт получения списка методов (queries + mutations) гейтвея. */
export interface GatewayMethodsPort {
  fetchMethodNames(): Promise<string[]>;
}

export const GATEWAY_METHODS_PORT = Symbol('GatewayMethodsPort');
