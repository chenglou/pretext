import { resetHiddenThoughts } from '../../../../lib/db'

export async function POST() {
  return Response.json(resetHiddenThoughts())
}
