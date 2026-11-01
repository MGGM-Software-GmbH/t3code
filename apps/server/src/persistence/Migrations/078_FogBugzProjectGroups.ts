import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE fogbugz_project_groups (project_id TEXT PRIMARY KEY, fogbugz_project_group_id INTEGER NOT NULL)`;
});
