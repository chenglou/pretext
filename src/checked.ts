// Checked reads of indexed elements: each read is the element, or a RangeError where the index
// holds none. A write is `list.splice(i, 1, value)` at its own site, which replaces the element at
// an index in bounds and appends at the length, and never leaves a hole. One function that took
// every list wrote them slower: JavaScriptCore's optimizing compiler converts each list a function
// reads or writes to the most general kind of list that function was handed, so lists of numbers
// became lists of values and lists of whole numbers lists of doubles, and webkit-host walked and
// streamed the chat demo's paragraphs 6% to 17% slower. A function checking the index and handing
// it to the splice kept the lists, and prepared the paragraphs again 13% to 20% slower.

export function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new RangeError('index out of range')
  return value
}

export function present<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new RangeError('missing value')
  return value
}
