import { Field, ID, ObjectType } from '@nestjs/graphql';

/** Элемент ответа twoFaTypes (Query 2faTypes из ТЗ). */
@ObjectType('TwoFaType')
export class TwoFaTypeDto {
  @Field(() => ID)
  id: string;

  @Field()
  isDeleted: boolean;

  @Field()
  isActive: boolean;

  @Field()
  type: string;
}
