'use strict';
const { Pool } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const { configuration } = require('./core.cjs');
async function migrate(pool) {
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}
if (require.main === module) {
  const pool = new Pool({ connectionString: configuration().databaseUrl });
  migrate(pool).then(() => console.log('NHI schema ready'))
    .catch(() => { console.error('NHI_SCHEMA_MIGRATION_FAILED'); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { migrate };
