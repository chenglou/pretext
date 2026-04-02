import { getThoughts } from '../../../lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(getThoughts())
}
