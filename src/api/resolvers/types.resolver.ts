import { Query, Resolver } from '@nestjs/graphql';
import { TypesCrudService } from '../../database/crud';
import { TwoFaTypeDto } from '../dto';

@Resolver(() => TwoFaTypeDto)
export class TypesResolver {
  constructor(private readonly _typesCrud: TypesCrudService) {}

  /** Query 2faTypes из ТЗ (GraphQL запрещает имена с цифры → twoFaTypes). */
  @Query(() => [TwoFaTypeDto], { name: 'twoFaTypes' })
  twoFaTypes(): Promise<TwoFaTypeDto[]> {
    return this._typesCrud.findBy({ isDeleted: false });
  }
}
