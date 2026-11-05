import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE fogbugz_connection (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)`;
  yield* sql`CREATE TABLE fogbugz_projects (project_id TEXT PRIMARY KEY, fogbugz_project_id INTEGER NOT NULL)`;
  yield* sql`CREATE TABLE fogbugz_threads (thread_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, case_id INTEGER NOT NULL, title TEXT NOT NULL)`;
  yield* sql`CREATE INDEX fogbugz_threads_case ON fogbugz_threads(case_id)`;
});
