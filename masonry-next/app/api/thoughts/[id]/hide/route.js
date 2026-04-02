import { setThoughtHidden } from '../../../../../lib/db'

function parseId(value) {
  const id = Number.parseInt(value, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}

export async function POST(request, { params }) {
  const id = parseId(params.id)
  if (id == null) {
    return Response.json({ error: 'Invalid thought id.' }, { status: 400 })
  }

  const body = await request.json()
  const thought = setThoughtHidden(id, Boolean(body.isHidden))
  if (!thought) {
    return Response.json({ error: 'Thought not found.' }, { status: 404 })
  }

  return Response.json(thought)
}
