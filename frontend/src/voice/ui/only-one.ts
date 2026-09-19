/**
 * only-one.ts — "there may be exactly one of these on the page".
 *
 * The cursor and the approval card belong to the conversation, not to the
 * widget that started it, and there are now two widgets that can start one:
 * the spoken concierge and the typed chat. Both mount the same pieces, and two
 * cursors chasing the same element — or two identical cards asking the owner
 * the same question — is a bug, not a redundancy.
 *
 * So the pieces claim a name. The first one mounted renders; the others render
 * nothing and wait, and if the holder unmounts the claim passes to whoever is
 * still there. It is a handful of lines instead of a rule in a document that
 * the next person to mount one will not have read.
 */

import { useEffect, useRef, useState } from "react";

const holders = new Map<string, symbol>();
const waiting = new Set<() => void>();

function announce() {
  for (const notify of Array.from(waiting)) notify();
}

/** True when this component instance is the one that should render `key`. */
export function useOnlyOne(key: string): boolean {
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol(key);
  const [mine, setMine] = useState(false);

  useEffect(() => {
    const token = tokenRef.current as symbol;

    const settle = () => {
      if (!holders.has(key)) holders.set(key, token);
      setMine(holders.get(key) === token);
    };
    settle();
    waiting.add(settle);

    return () => {
      waiting.delete(settle);
      if (holders.get(key) === token) {
        holders.delete(key);
        // Hand the claim on rather than leaving the page without a cursor.
        announce();
      }
    };
  }, [key]);

  return mine;
}
