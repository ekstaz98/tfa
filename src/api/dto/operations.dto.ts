import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';

@InputType()
export class SendTwoFaInput {
  @Field()
  method: string;

  /** Обязателен без авторизации (signin, регистрация), запрещён при ней. */
  @Field({ nullable: true })
  identity?: string;

  /** Подмножество типов — только для переотправки (x-2fa-operationId). */
  @Field(() => [String], { nullable: true })
  types?: string[];

  /** Прокидывается в событие отправки — продукт мультиязычный. */
  @Field({ nullable: true })
  locale?: string;
}

@ObjectType()
export class SendTwoFaTypeDto {
  @Field()
  type: string;

  /** Маскированный identity; null для GA (отправки нет). */
  @Field(() => String, { nullable: true })
  identity: string | null;

  @Field(() => Int, { nullable: true })
  expire: number | null;

  @Field(() => Int, { nullable: true })
  retry: number | null;
}

@ObjectType()
export class SendTwoFaResponse {
  @Field(() => ID)
  operationId: string;

  @Field(() => [SendTwoFaTypeDto])
  types: SendTwoFaTypeDto[];
}

@InputType()
export class VerifyCodeInput {
  @Field()
  type: string;

  @Field()
  code: string;
}

@InputType()
export class VerifyTwoFaInput {
  /** Без operationId — форма «покрыт ли метод»: ответ { required }. */
  @Field(() => ID, { nullable: true })
  operationId?: string;

  @Field()
  method: string;

  @Field({ nullable: true })
  userId?: string;

  /** Для unauthed-методов гейтвей передаёт identity из тела запроса. */
  @Field({ nullable: true })
  identity?: string;

  @Field(() => [VerifyCodeInput], { nullable: true })
  codes?: VerifyCodeInput[];
}

@ObjectType()
export class VerifyTwoFaResponse {
  @Field(() => Boolean, { nullable: true })
  verified: boolean | null;

  @Field(() => Boolean, { nullable: true })
  required: boolean | null;

  @Field(() => String, { nullable: true })
  userId: string | null;

  @Field(() => String, { nullable: true })
  identity: string | null;
}
