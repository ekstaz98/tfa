// Отдельные база и очередь: RMQ-e2e не пересекается с API-e2e и dev-данными.
process.env.DATABASE_URL = 'postgres://tfa:tfa@localhost:5432/tfa_e2e_rmq';
process.env.RMQ_USERS_QUEUE = 'tfa-users-sync-e2e';
