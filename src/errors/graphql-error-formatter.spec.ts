import { ApolloServer } from '@apollo/server';
import { TwoFaErrorCode } from './two-fa-error-code';
import { TwoFaError } from './two-fa.error';
import { formatGraphQlError } from './graphql-error-formatter';

/**
 * Интеграционная проверка формата на живом Apollo (без HTTP):
 * тот же formatError будет стоять в GraphQLModule.
 */
describe('formatGraphQlError через ApolloServer', () => {
  let server: ApolloServer;

  beforeAll(async () => {
    server = new ApolloServer({
      typeDefs: `type Query { domainError: String, internalError: String, ok: String }`,
      resolvers: {
        Query: {
          domainError: () => {
            throw new TwoFaError(TwoFaErrorCode.MethodAlreadyExists);
          },
          internalError: () => {
            throw new Error('secret: db connection string leaked');
          },
          ok: () => 'ok',
        },
      },
      formatError: formatGraphQlError,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  async function errorsOf(query: string): Promise<unknown[]> {
    const response = await server.executeOperation({ query });
    if (response.body.kind !== 'single') {
      throw new Error('unexpected response kind');
    }
    return (response.body.singleResult.errors ?? []) as unknown[];
  }

  it('TwoFaError → ровно {message, title, code, status} из ТЗ', async () => {
    const errors = await errorsOf('{ domainError }');

    expect(errors).toEqual([
      {
        message: 'Method with provided name already exists and is not deleted',
        title: 'Method already exists',
        code: 'WRONG_METHOD-005',
        status: 409,
      },
    ]);
  });

  it('внутренняя ошибка маскируется, детали не утекают', async () => {
    const errors = await errorsOf('{ internalError }');

    expect(errors).toEqual([
      {
        message: 'Internal server error',
        title: 'Internal server error',
        code: 'INTERNAL-500',
        status: 500,
      },
    ]);
    expect(JSON.stringify(errors)).not.toContain('secret');
  });

  it('битый запрос (валидация GraphQL) → BAD_REQUEST-400 с сообщением', async () => {
    const errors = (await errorsOf('{ noSuchField }')) as Array<
      Record<string, unknown>
    >;

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      title: 'Bad request',
      code: 'BAD_REQUEST-400',
      status: 400,
    });
    expect(String(errors[0].message)).toContain('noSuchField');
  });

  it('успешный запрос ошибок не содержит', async () => {
    const response = await server.executeOperation({ query: '{ ok }' });
    if (response.body.kind !== 'single') {
      throw new Error('unexpected response kind');
    }
    expect(response.body.singleResult.errors).toBeUndefined();
    expect(response.body.singleResult.data).toEqual({ ok: 'ok' });
  });
});
