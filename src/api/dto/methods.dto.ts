import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';

/** Элемент ответа twoFaMethods (Query 2faMethods из ТЗ). */
@ObjectType('TwoFaMethod')
export class TwoFaMethodDto {
  @Field(() => ID)
  id: string;

  @Field()
  isDeleted: boolean;

  @Field()
  isActive: boolean;

  @Field()
  method: string;

  @Field(() => [String])
  types: string[];

  @Field(() => [String])
  tags: string[];
}

@InputType()
export class TwoFaMethodsInput {
  /** Хэш настроек с фронта: совпал — список не возвращается. */
  @Field({ nullable: true })
  hash?: string;

  @Field(() => [String], { nullable: true })
  tags?: string[];
}

@ObjectType()
export class TwoFaMethodsResponse {
  @Field()
  hash: string;

  /**
   * В ТЗ при совпадении хэша возвращается literal true — GraphQL не умеет
   * «bool или список», поэтому совпадение выражено флагом: upToDate = true,
   * methods = null.
   */
  @Field()
  upToDate: boolean;

  @Field(() => [TwoFaMethodDto], { nullable: true })
  methods?: TwoFaMethodDto[] | null;
}

@InputType()
export class CreateMethodInputDto {
  @Field()
  method: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field(() => [String])
  types: string[];

  @Field(() => [String])
  tags: string[];
}

@InputType()
export class CreateMethodsInput {
  @Field(() => [CreateMethodInputDto])
  methods: CreateMethodInputDto[];
}

@InputType()
export class UpdateMethodInputDto {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  method?: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field({ nullable: true })
  isDeleted?: boolean;

  @Field(() => [String], { nullable: true })
  types?: string[];

  @Field(() => [String], { nullable: true })
  tags?: string[];
}

@InputType()
export class UpdateMethodsInput {
  @Field(() => [UpdateMethodInputDto])
  methods: UpdateMethodInputDto[];
}

@InputType()
export class UpdateMyMethodInputDto {
  /** id метода (methods.id). */
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field(() => [String], { nullable: true })
  types?: string[];
}

@InputType()
export class UpdateMyMethodsInput {
  @Field(() => [UpdateMyMethodInputDto])
  methods: UpdateMyMethodInputDto[];
}

@ObjectType()
export class UpdateListMethodsResponse {
  @Field(() => [String])
  created: string[];

  @Field(() => [String])
  deactivated: string[];
}
