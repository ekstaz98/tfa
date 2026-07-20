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
import { Type } from './type.entity';
import { User } from './user.entity';

/**
 * Канал юзера (телефон/email) или TOTP-секрет.
 * identity глобально уникален среди неудалённых — точка входа unauthed signIn.
 */
@Entity('user_credentials')
@Index('uq_user_credentials_type_identity', ['typeId', 'identity'], {
  unique: true,
  where: '"is_deleted" = false',
})
@Index('uq_user_credentials_user_type', ['userId', 'typeId'], {
  unique: true,
  where: '"is_deleted" = false',
})
export class UserCredential {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid')
  typeId: string;

  /** Нормализованный identity: email — lowercase, phone — E.164. */
  @Column()
  identity: string;

  /** TOTP-секрет для GA: шифртекст AES-256-GCM с версией ключа (CredentialCipherService). */
  @Column({ type: 'varchar', nullable: true })
  secret: string | null;

  /** false — канал не получает коды и не участвует в verify. */
  @Column({ default: false })
  isConfirmed: boolean;

  @Column({ default: true })
  isActive: boolean;

  @Column({ default: false })
  isDeleted: boolean;

  /** Последний использованный TOTP time-step — anti-replay для GA. */
  @Column({ type: 'bigint', nullable: true })
  lastUsedCounter: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => Type)
  @JoinColumn({ name: 'type_id' })
  type?: Type;
}
