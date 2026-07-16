import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Type } from './type.entity';
import { UserMethod } from './user-method.entity';

/** Типы, выбранные юзером для метода; сервис проверяет подмножество method_types. */
@Entity('user_method_types')
@Unique(['userMethodId', 'typeId'])
export class UserMethodType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userMethodId: string;

  @Column('uuid')
  typeId: string;

  @ManyToOne(() => UserMethod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_method_id' })
  userMethod?: UserMethod;

  @ManyToOne(() => Type)
  @JoinColumn({ name: 'type_id' })
  type?: Type;
}
