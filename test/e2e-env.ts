// Выполняется до импорта AppModule (порядок import'ов):
// e2e ходит в отдельную базу, dev-данные не трогаются.
process.env.DATABASE_URL = 'postgres://tfa:tfa@localhost:5432/tfa_e2e';
