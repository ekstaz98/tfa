import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Реплика юзера из core-системы (RMQ-consumer, upsert по userId). */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** id юзера в core-системе. */
  @Column('uuid', { unique: true })
  userId: string;

  /**
   * Общий переключатель 2ФА юзера для default-методов: false гасит их все
   * разом. На методы с тегами user/system не влияет.
   */
  @Column({ name: 'default_methods_enabled', default: true })
  defaultMethodsEnabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
