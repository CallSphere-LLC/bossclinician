import { useState } from 'react';
import { ToolCard, NumberField, Figure } from './ToolShell';
import { calculate } from './calculatorFormula';

export interface CalculatorConfig {
  title: string;
  outputLabel: string;
  formula: string;
  unit?: string;
  inputs: { label: string; defaultValue: number }[];
}

export function isCalculatorConfig(value: unknown): value is CalculatorConfig {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.title === 'string' && typeof c.outputLabel === 'string' &&
    typeof c.formula === 'string' && Array.isArray(c.inputs) && c.inputs.length > 0 && c.inputs.length <= 8 &&
    c.inputs.every((input) => input && typeof input.label === 'string' && Number.isFinite(input.defaultValue));
}

export function CustomCalculator({ config }: { config: CalculatorConfig }) {
  const [values, setValues] = useState(() => config.inputs.map((input) => String(input.defaultValue)));
  const result = values.some((value) => value.trim() === '')
    ? null
    : calculate(config.formula, values.map(Number));
  const formatted = result === null ? 'Check the numbers or formula' :
    `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(result)}${config.unit ? ` ${config.unit}` : ''}`;
  return (
    <ToolCard title={config.title}>
      <div className="grid gap-4 sm:grid-cols-2">
        {config.inputs.map((input, index) => (
          <NumberField key={index} label={input.label} value={values[index] ?? ''} min={-1000000000}
            onChange={(next) => setValues((current) => current.map((value, at) => at === index ? next : value))} />
        ))}
      </div>
      <div className="rounded-xl border border-gold/25 bg-gold/[0.08] p-5" role="status" aria-live="polite">
        <Figure label={config.outputLabel} value={formatted} emphasis />
      </div>
    </ToolCard>
  );
}
