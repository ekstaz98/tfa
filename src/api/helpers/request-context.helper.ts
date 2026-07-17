import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { IncomingHttpHeaders } from 'http';
import {
  HEADER_CLIENT_IP,
  HEADER_OPERATION_ID,
  HEADER_ROLES,
  HEADER_USER_ID,
  RequestContext,
} from '../interfaces';

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | null {
  const value = headers[name];
  const single = Array.isArray(value) ? value[0] : value;
  return single && single.trim().length > 0 ? single.trim() : null;
}

export function requestContextFromHeaders(
  headers: IncomingHttpHeaders,
): RequestContext {
  return {
    userId: headerValue(headers, HEADER_USER_ID),
    roles: (headerValue(headers, HEADER_ROLES) ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0),
    clientIp: headerValue(headers, HEADER_CLIENT_IP),
    operationId: headerValue(headers, HEADER_OPERATION_ID),
  };
}

interface GqlRequestHolder {
  req: { headers: IncomingHttpHeaders };
}

export function requestContextOf(context: ExecutionContext): RequestContext {
  const { req } =
    GqlExecutionContext.create(context).getContext<GqlRequestHolder>();
  return requestContextFromHeaders(req.headers);
}

/** Параметр-декоратор резолверов: контекст запроса из заголовков гейтвея. */
export const ReqCtx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext =>
    requestContextOf(context),
);
