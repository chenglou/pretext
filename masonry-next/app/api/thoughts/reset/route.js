import { resetThoughtState } from '../../../../lib/db'

export async function POST() {
  return Response.json(resetThoughtState())
}
