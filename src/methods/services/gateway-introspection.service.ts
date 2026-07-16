import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GatewayMethodsPort } from '../gateway-methods.port';

const INTROSPECTION_QUERY = `{
  __schema {
    queryType { fields { name } }
    mutationType { fields { name } }
  }
}`;

interface IntrospectionResponse {
  data?: {
    __schema?: {
      queryType?: { fields?: Array<{ name: string }> } | null;
      mutationType?: { fields?: Array<{ name: string }> } | null;
    };
  };
  errors?: unknown[];
}

/** Реализация порта: интроспекция GraphQL-схемы гейтвея. */
@Injectable()
export class GatewayIntrospectionService implements GatewayMethodsPort {
  private readonly url: string | null;

  constructor(config: ConfigService) {
    this.url = config.get<string | null>('gateway.graphqlUrl') ?? null;
  }

  async fetchMethodNames(): Promise<string[]> {
    if (!this.url) {
      throw new Error(
        'GATEWAY_GRAPHQL_URL is not configured, methods sync is unavailable',
      );
    }
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
    });
    if (!response.ok) {
      throw new Error(
        `Gateway introspection failed with status ${response.status}`,
      );
    }
    const payload = (await response.json()) as IntrospectionResponse;
    if (payload.errors?.length || !payload.data?.__schema) {
      throw new Error('Gateway introspection returned errors or no schema');
    }
    const { queryType, mutationType } = payload.data.__schema;
    return [...(queryType?.fields ?? []), ...(mutationType?.fields ?? [])].map(
      (field) => field.name,
    );
  }
}
