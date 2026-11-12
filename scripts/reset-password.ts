// Operator tool: reset a user's password and sign out all of their sessions.
// Usage: npm run user:reset-password -- <username>
// Prints a random temporary password. The user should change it from the Account window after signing in.
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../server/auth';
import { createPool } from '../server/db';

const username = process.argv[2];
if (!username) {
  console.error('Usage: npm run user:reset-password -- <username>');
  process.exit(2);
}
const pool = createPool(process.env.DATABASE_URL ?? 'postgres://mds:mds@localhost:5433/mds');
try {
  const temp = randomBytes(12).toString('base64url');
  const r = await pool.query(
    `UPDATE users SET password_hash = $2, password_changed_at = now() WHERE lower(username) = lower($1) RETURNING id, username`,
    [username, await hashPassword(temp)],
  );
  if (!r.rowCount) {
    console.error(`No user named "${username}".`);
    process.exitCode = 1;
  } else {
    const s = await pool.query('DELETE FROM sessions WHERE user_id = $1', [r.rows[0].id]);
    console.log(`Password for ${r.rows[0].username} reset. ${s.rowCount} session(s) signed out.`);
    console.log(`Temporary password: ${temp}`);
  }
} finally {
  await pool.end();
}
