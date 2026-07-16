import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Method } from './method.entity';
import { User } from './user.entity';

/** Переопределение метода юзером (только для методов с тегом user). */
@Entity('user_methods')
@Index('uq_user_methods_user_method', ['userId', 'methodId'], {
  unique: true,
  where: '"is_deleted" = false',
})
export class UserMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid')
  methodId: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDeleted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** Участвует в hash юзерских настроек. */
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => Method)
  @JoinColumn({ name: 'method_id' })
  method?: Method;
}
