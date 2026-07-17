// Отдельные база и очередь сквозного e2e.
process.env.DATABASE_URL = 'postgres://tfa:tfa@localhost:5432/tfa_e2e_flow';
process.env.RMQ_USERS_QUEUE = 'tfa-users-sync-flow';
