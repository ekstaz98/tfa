import { Module } from '@nestjs/common';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { formatGraphQlError } from '../errors';
import { DatabaseModule } from '../database/database.module';
import { MethodsModule } from '../methods/methods.module';
import { OperationsModule } from '../operations/operations.module';
import { MethodsResolver } from './resolvers/methods.resolver';
import { OperationsResolver } from './resolvers/operations.resolver';
import { TypesResolver } from './resolvers/types.resolver';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      formatError: formatGraphQlError,
      context: ({ req }: { req: unknown }) => ({ req }),
      playground: false,
      plugins: [
        ApolloServerPluginLandingPageLocalDefault({ embed: true }),
      ] as ApolloDriverConfig['plugins'],
    }),
    DatabaseModule,
    MethodsModule,
    OperationsModule,
  ],
  providers: [TypesResolver, MethodsResolver, OperationsResolver],
})
export class ApiModule {}
