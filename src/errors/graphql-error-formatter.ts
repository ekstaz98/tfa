import { HttpException } from '@nestjs/common';
import { unwrapResolverError } from '@apollo/server/errors';
import { GraphQLFormattedError } from 'graphql';
import { TwoFaError, TwoFaErrorShape } from './two-fa.error';

/** Ошибки самого GraphQL-слоя (битый запрос) — клиентские, message не маскируем. */
const GRAPHQL_CLIENT_ERROR_CODES = new Set([
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
]);

export const BAD_REQUEST_SHAPE: Omit<TwoFaErrorShape, 'message'> = {
  title: 'Bad request',
  code: 'BAD_REQUEST-400',
  status: 400,
};

export const INTERNAL_ERROR_SHAPE: TwoFaErrorShape = {
  message: 'Internal server error',
  title: 'Internal server error',
  code: 'INTERNAL-500',
  status: 500,
};

/**
 * formatError для Apollo — единственная точка формата ошибок API
 * ({"errors":[{message,title,code,status}]}). Ставится в GraphQLModule
 * и потому покрывает весь API, включая verifyTwoFa: отдельного транспорта
 * ошибок нет. Недоменные ошибки маскируются (внутренности не утекают),
 * ошибки парсинга/валидации GraphQL отдаются клиенту как BAD_REQUEST-400.
 */
export function formatGraphQlError(
  formattedError: GraphQLFormattedError,
  error: unknown,
): GraphQLFormattedError {
  const original = unwrapResolverError(error);
  if (original instanceof TwoFaError) {
    return original.toShape() as unknown as GraphQLFormattedError;
  }

  // guard-заглушки (Forbidden/Unauthorized и т.п.) — не маскируем статус
  if (original instanceof HttpException) {
    const status = original.getStatus();
    return {
      message: original.message,
      title: 'Request rejected',
      code: `HTTP-${status}`,
      status,
    } as unknown as GraphQLFormattedError;
  }

  const apolloCode = formattedError.extensions?.code;
  if (
    typeof apolloCode === 'string' &&
    GRAPHQL_CLIENT_ERROR_CODES.has(apolloCode)
  ) {
    return {
      message: formattedError.message,
      ...BAD_REQUEST_SHAPE,
    } as unknown as GraphQLFormattedError;
  }

  return INTERNAL_ERROR_SHAPE as unknown as GraphQLFormattedError;
}
