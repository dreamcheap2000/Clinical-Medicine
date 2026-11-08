'use strict';
const { fail, hash } = require('./core.cjs');

class Store {
  constructor(pool) { this.pool = pool; }
  async query(sql, params = []) { return this.pool.query(sql, params); }
  async one(sql, params) { return (await this.query(sql, params)).rows[0]; }
  async session(token) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token || '')) fail(401, 'LOGIN_REQUIRED');
    const user = await this.one(`SELECT u.subject,u.email FROM nhi_sessions s JOIN nhi_users u
      ON u.subject=s.subject WHERE s.hash=$1 AND s.expires>now()`, [hash(token)]);
    if (!user) fail(401, 'SESSION_EXPIRED');
    return user;
  }
  async clinics(user) {
    return (await this.query(`SELECT c.id,c.name,c.sheet_id,c.ready,m.role FROM nhi_clinics c
      JOIN nhi_members m ON m.clinic_id=c.id WHERE m.email=$1
      AND (m.subject IS NULL OR m.subject=$2) ORDER BY c.name`, [user.email, user.subject])).rows;
  }
  async member(user, id, admin = false) {
    const clinic = await this.one(`SELECT c.*,m.role FROM nhi_clinics c JOIN nhi_members m
      ON m.clinic_id=c.id WHERE c.id=$1 AND m.email=$2
      AND (m.subject IS NULL OR m.subject=$3)`, [id, user.email, user.subject]);
    if (!clinic) fail(404, 'WORKSPACE_NOT_FOUND');
    if (admin && clinic.role !== 'admin') fail(403, 'ADMIN_REQUIRED');
    await this.query(`UPDATE nhi_members SET subject=$3 WHERE clinic_id=$1 AND email=$2
      AND subject IS NULL`, [id, user.email, user.subject]);
    return clinic;
  }
  async locked(id, fn) {
    const client = await this.pool.connect();
    let held = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [id]);
      held = result.rows[0].held;
      if (!held) fail(409, 'WORKSPACE_BUSY');
      return await fn(client);
    } finally {
      if (held) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [id]); }
        catch (error) { client.release(true); throw error; }
      }
      client.release();
    }
  }
  async audit(user, id, action, outcome) {
    await this.query('INSERT INTO nhi_audit(clinic_id,subject,action,outcome) VALUES($1,$2,$3,$4)',
      [id, user.subject, action, outcome]);
  }
}
module.exports = { Store };
