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

export enum OperationStatus {
  Pending = 'pending',
  Verified = 'verified',
  Expired = 'expired',
  Failed = 'failed',
}

/** 2ФА-операция: её id — operationId из sendTwoFa / x-2fa-operationId. */
@Entity('operations')
@Index(['identity', 'createdAt'])
@Index(['userId', 'createdAt'])
@Index(['clientIp', 'createdAt'])
export class Operation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** NULL для unauthed-флоу: signIn до токена и регистрация (юзера ещё нет). */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @Column('uuid')
  methodId: string;

  /** Куда слать код в unauthed-флоу; опора дневного лимита по identity. */
  @Column({ type: 'varchar', nullable: true })
  identity: string | null;

  /** Хэш параметров оригинального запроса — в скелете не заполняется. */
  @Column({ type: 'varchar', nullable: true })
  payloadHash: string | null;

  @Column({
    type: 'enum',
    enum: OperationStatus,
    enumName: 'operation_status',
    default: OperationStatus.Pending,
  })
  status: OperationStatus;

  /** IP клиента из заголовка гейтвея — опора часового IP-лимита unauthed-флоу. */
  @Column({ type: 'varchar', nullable: true })
  clientIp: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User | null;

  @ManyToOne(() => Method)
  @JoinColumn({ name: 'method_id' })
  method?: Method;
}
