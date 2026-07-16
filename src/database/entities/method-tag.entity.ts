import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Method } from './method.entity';
import { Tag } from './tag.entity';

/** Теги метода: режимный (system | default | user, не больше одного) + unauthed. */
@Entity('method_tags')
@Unique(['methodId', 'tagId'])
export class MethodTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  methodId: string;

  @Column('uuid')
  tagId: string;

  @ManyToOne(() => Method, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'method_id' })
  method?: Method;

  @ManyToOne(() => Tag)
  @JoinColumn({ name: 'tag_id' })
  tag?: Tag;
}
