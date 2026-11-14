import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE fogbugz_projects ADD COLUMN fogbugz_area_id INTEGER CHECK (fogbugz_area_id IS NULL OR fogbugz_area_id > 0)`;
});
