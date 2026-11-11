import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('sql_schema: migration file defines required tables, constraints, rls, and triggers', () => {
  const sqlPath = 'supabase/migrations/20261112_init.sql';
  assert.strictEqual(fs.existsSync(sqlPath), true, 'SQL migration file must exist');

  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('create table public.allowed_emails'), 'must create allowed_emails table');
  assert.ok(sql.includes('create table public.profiles'), 'must create profiles table');
  assert.ok(sql.includes('create table public.push_subscriptions'), 'must create push_subscriptions table');
  assert.ok(sql.includes('create table public.messages'), 'must create messages table');
  assert.ok(sql.includes('char_length(body) between 1 and 2000'), 'must enforce 2000 char limit on message body');
  assert.ok(sql.includes('idx_messages_created_at'), 'must create index on messages.created_at');
  assert.ok(sql.includes('idx_push_subs_user_id'), 'must create index on push_subscriptions.user_id');
  assert.ok(sql.includes('handle_new_user'), 'must define handle_new_user trigger function');
  assert.ok(sql.includes('keep_alive'), 'must define keep_alive RPC function');
  assert.ok(sql.includes('enable row level security'), 'must enable RLS on tables');
  assert.ok(sql.includes('is_registered_user()') && sql.includes('security definer'), 'must avoid recursive profiles RLS via security definer helper');
});
