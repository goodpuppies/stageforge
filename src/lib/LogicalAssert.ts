import { assert as stdAssert } from "@std/assert";

export function assert(value: any) {
  return function (handlers: { [x: string]: () => any; unknown?: any; }) {
    const callSite = new Error().stack!.split('\n')[2]

    for (const key of Object.keys(handlers)) {
      if (key === 'unknown') continue

      if (typeof value === 'number' && !isNaN(Number(key))) {
        if (Number(key as string) === value) {
          return handlers[key]()
        }
      } else if (typeof value === 'boolean' && ['true', 'false'].includes(key)) {
        if (value === (key === 'true')) {
          return handlers[key]()
        }
      } else if (value === null && key === 'null') {
        return handlers[key]()
      } else if (value === key) {
        return handlers[key]()
      }
    }
    if ('unknown' in handlers) {
      return handlers.unknown()
    }

    const validValues = Object.keys(handlers)
      .filter(k => k !== 'unknown')
      .join(', ')

    stdAssert(false,
      `\nAssertion failed for value: ${value}\n` +
      `Valid values: ${validValues}\n` +
      `Got: ${value} typeof ${typeof value}\n` +
      `At: ${callSite}`
    )
  }
}