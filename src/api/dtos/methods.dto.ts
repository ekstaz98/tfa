import {
  Field,
  ID,
  InputType,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { TwoFaManagedBy } from '../../methods/interfaces';

/** Справочник типов доставки кода (сид SeedDictionaries). */
export enum TwoFaMethodType {
  SMS = 'sms',
  EMAIL = 'email',
  PUSH = 'push',
  GA = 'ga',
}
registerEnumType(TwoFaMethodType, { name: 'TwoFaMethodType' });

/** Справочник тегов метода (сид SeedDictionaries). */
export enum TwoFaMethodTag {
  UNAUTHED = 'unauthed',
  USER = 'user',
  SYSTEM = 'system',
  DEFAULT = 'default',
}
registerEnumType(TwoFaMethodTag, { name: 'TwoFaMethodTag' });

/** Элемент ответа twoFaMethods (Query twoFaMethods из ТЗ). */
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

  @Field(() => [TwoFaMethodTag], { nullable: true })
  tags?: TwoFaMethodTag[];
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

export { TwoFaManagedBy };
registerEnumType(TwoFaManagedBy, {
  name: 'TwoFaManagedBy',
  description:
    'METHOD — индивидуальный выключатель (updateMyTwoFaMethod, тег user); ' +
    'GLOBAL — общий переключатель default-методов (updateMyTwoFaDefaults).',
});

/** Элемент ответа myTwoFaMethods — настройки 2ФА юзера по user/default-методу. */
@ObjectType('MyTwoFaMethod', {
  description:
    'Настройки 2ФА юзера по методу с тегом user или default. В отличие от ' +
    'twoFaMethods, выключенные методы остаются в списке — экран настроек ' +
    'видит их id и полный набор доступных типов.',
})
export class MyTwoFaMethodDto {
  @Field(() => ID, { description: 'id метода (methods.id)' })
  id: string;

  @Field({ description: 'Имя метода (transfer, signin, ...)' })
  method: string;

  @Field({
    description: 'Требует ли метод 2ФА для юзера с учётом его настроек',
  })
  isEnabled: boolean;

  @Field(() => [String], {
    description: 'Полный набор типов, разрешённый админом, — из чего выбирать',
  })
  allowedTypes: string[];

  @Field(() => [String], {
    description: 'Типы, действующие для юзера сейчас; пусто — 2ФА выключена',
  })
  enabledTypes: string[];

  @Field(() => [String], { description: 'Теги метода' })
  tags: string[];

  @Field(() => TwoFaManagedBy, {
    description:
      'METHOD — переключается updateMyTwoFaMethod; GLOBAL — общим ' +
      'переключателем updateMyTwoFaDefaults',
  })
  managedBy: TwoFaManagedBy;
}

@InputType({
  description:
    'Фильтры myTwoFaMethods; все опциональны, без них — весь список. ' +
    'Массивные фильтры (tags, allowedTypes, enabledTypes) — метод должен ' +
    'содержать ВСЕ запрошенные значения; managedBy — любой из списка.',
})
export class MyTwoFaMethodsInput {
  @Field(() => [TwoFaManagedBy], {
    nullable: true,
    description: 'Только методы с одним из способов управления',
  })
  managedBy?: TwoFaManagedBy[];

  @Field({
    nullable: true,
    description: 'true — только с включённой 2ФА, false — только выключенные',
  })
  isEnabled?: boolean;

  @Field(() => [TwoFaMethodTag], {
    nullable: true,
    description: 'Метод содержит все перечисленные теги',
  })
  tags?: TwoFaMethodTag[];

  @Field(() => [TwoFaMethodType], {
    nullable: true,
    description: 'Админский набор типов содержит все перечисленные',
  })
  allowedTypes?: TwoFaMethodType[];

  @Field(() => [TwoFaMethodType], {
    nullable: true,
    description: 'Действующие типы содержат все перечисленные',
  })
  enabledTypes?: TwoFaMethodType[];
}

@ObjectType('MyTwoFaSettings', {
  description: 'Настройки 2ФА юзера уровня аккаунта.',
})
export class MyTwoFaSettingsDto {
  @Field({
    description:
      'Общий переключатель: false гасит 2ФА на всех default-методах разом; ' +
      'user- и system-методы не затрагивает',
  })
  defaultMethodsEnabled: boolean;
}

@InputType()
export class UpdateMyTwoFaDefaultsInput {
  @Field({ description: 'Включить (true) или выключить (false) default-2ФА' })
  isEnabled: boolean;
}

@InputType()
export class CreateMethodInputDto {
  @Field()
  method: string;

  @Field({ nullable: true })
  isActive?: boolean;

  @Field(() => [TwoFaMethodType])
  types: TwoFaMethodType[];

  @Field(() => [TwoFaMethodTag])
  tags: TwoFaMethodTag[];
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

  @Field(() => [TwoFaMethodType], { nullable: true })
  types?: TwoFaMethodType[];

  @Field(() => [TwoFaMethodTag], { nullable: true })
  tags?: TwoFaMethodTag[];
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

  @Field(() => [TwoFaMethodType], { nullable: true })
  types?: TwoFaMethodType[];
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
