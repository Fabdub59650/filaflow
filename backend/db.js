const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER     || 'filaflow',
  password: process.env.DB_PASSWORD || 'filaflow_secret',
  database: process.env.DB_NAME     || 'filaflow',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,   // Retourne les DATE/DATETIME en string, pas en objet Date JS
});

module.exports = pool;
