import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Tag } from './tag.entity';
import { UserMethod } from './user-method.entity';

/** Теги юзерского переопределения; заполняется системой, юзер напрямую не меняет. */
@Entity('user_method_tags')
@Unique(['userMethodId', 'tagId'])
export class UserMethodTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userMethodId: string;

  @Column('uuid')
  tagId: string;

  @ManyToOne(() => UserMethod, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_method_id' })
  userMethod?: UserMethod;

  @ManyToOne(() => Tag)
  @JoinColumn({ name: 'tag_id' })
  tag?: Tag;
}
