/** Evaluate bounded arithmetic for owner-authored calculators; never run JavaScript from a lesson. */
export function calculate(formula: string, inputs: number[]): number | null {
  formula = formula.trim();
  if (formula.length > 200 || inputs.length > 8 || inputs.some((n) => !Number.isFinite(n))) return null;
  const tokens: string[] = [];
  const matcher = /\s*(x[1-8]|\d+(?:\.\d+)?|[()+*/-])/gy;
  let at = 0;
  while (at < formula.length) {
    matcher.lastIndex = at;
    const match = matcher.exec(formula);
    if (!match) return null;
    tokens.push(match[1]);
    at = matcher.lastIndex;
  }
  let pos = 0;
  function factor(): number {
    const token = tokens[pos++];
    if (token === '-') return -factor();
    if (token === '+') return factor();
    if (token === '(') {
      const value = expression();
      if (tokens[pos++] !== ')') throw new Error('Unclosed parenthesis');
      return value;
    }
    if (/^x[1-8]$/.test(token ?? '')) {
      const value = inputs[Number(token.slice(1)) - 1];
      if (value === undefined) throw new Error('Missing input');
      return value;
    }
    if (token && /^\d+(?:\.\d+)?$/.test(token)) return Number(token);
    throw new Error('Invalid factor');
  }
  function term(): number {
    let value = factor();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++];
      const right = factor();
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }
  function expression(): number {
    let value = term();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++];
      const right = term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  try {
    const value = expression();
    return pos === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
