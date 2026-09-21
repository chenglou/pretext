// Insertion-only ordered records. The record array keeps creation order; tree links are indices
// into that same array, so there is no second collection of values and no object-reference cycle.
export type OrderedLinks = { left: number; right: number; height: number }
export type OrderedRecords<T extends OrderedLinks> = { records: T[]; root: number }

export function orderedRecords<T extends OrderedLinks>(): OrderedRecords<T> {
  return { records: [], root: -1 }
}

export function findRecord<T extends OrderedLinks, Key>(tree: OrderedRecords<T>, key: Key, compare: (key: Key, record: T) => number): T | null {
  let index = tree.root
  while (index >= 0) {
    const record = tree.records[index]!
    const order = compare(key, record)
    if (order === 0) return record
    index = order < 0 ? record.left : record.right
  }
  return null
}

export function insertRecord<T extends OrderedLinks>(tree: OrderedRecords<T>, record: T, compare: (a: T, b: T) => number): T {
  const records = tree.records
  const added = records.length
  records.push(record)
  const height = (index: number): number => index < 0 ? 0 : records[index]!.height
  const update = (index: number): void => {
    const node = records[index]!
    node.height = 1 + Math.max(height(node.left), height(node.right))
  }
  const rotateLeft = (index: number): number => {
    const node = records[index]!, next = node.right, right = records[next]!
    node.right = right.left
    right.left = index
    update(index)
    update(next)
    return next
  }
  const rotateRight = (index: number): number => {
    const node = records[index]!, next = node.left, left = records[next]!
    node.left = left.right
    left.right = index
    update(index)
    update(next)
    return next
  }
  const insert = (index: number): number => {
    if (index < 0) return added
    const node = records[index]!
    const order = compare(record, node)
    if (order === 0) throw new Error('duplicate ordered record')
    if (order < 0) node.left = insert(node.left)
    else node.right = insert(node.right)
    update(index)
    const balance = height(node.left) - height(node.right)
    if (balance > 1) {
      const left = records[node.left]!
      if (height(left.left) < height(left.right)) node.left = rotateLeft(node.left)
      return rotateRight(index)
    }
    if (balance < -1) {
      const right = records[node.right]!
      if (height(right.right) < height(right.left)) node.right = rotateRight(node.right)
      return rotateLeft(index)
    }
    return index
  }
  tree.root = insert(tree.root)
  return record
}
