import { calculate } from '@/components/lesson-tools/calculatorFormula';
import { isCalculatorConfig, type CalculatorConfig } from '@/components/lesson-tools/CustomCalculator';

const inputClass = 'min-h-10 w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-gold';
export const DEFAULT_CALCULATOR: CalculatorConfig = {
  title: 'My calculator', outputLabel: 'Result', formula: 'x1 * x2', unit: '',
  inputs: [{ label: 'First number', defaultValue: 1 }, { label: 'Second number', defaultValue: 1 }],
};

export function CalculatorEditor({ value, onChange }: { value: unknown; onChange: (value: CalculatorConfig) => void }) {
  const config = isCalculatorConfig(value) ? value : DEFAULT_CALCULATOR;
  const change = (patch: Partial<CalculatorConfig>) => onChange({ ...config, ...patch });
  const example = calculate(config.formula, config.inputs.map((input) => input.defaultValue));
  return (
    <div className="space-y-4 rounded-xl border border-hairline bg-panel p-4" aria-label="Build a calculator">
      <p className="text-sm text-ink-soft">Name the inputs, then write a formula using x1, x2, and so on. The student can change each number.</p>
      <label className="block text-sm font-medium text-ink">Calculator title
        <input className={inputClass} value={config.title} maxLength={120} onChange={(event) => change({ title: event.target.value })} />
      </label>
      <div className="space-y-3">
        {config.inputs.map((input, index) => (
          <div key={index} className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2 sm:grid-cols-[auto_minmax(0,1fr)_7rem_auto]">
            <span className="pb-2 font-mono text-xs text-ink-soft">x{index + 1}</span>
            <label className="min-w-0 text-xs font-medium text-ink">Label
              <input className={inputClass} value={input.label} maxLength={80} onChange={(event) => change({ inputs: config.inputs.map((item, at) => at === index ? { ...item, label: event.target.value } : item) })} />
            </label>
            <label className="text-xs font-medium text-ink">Starting number
              <input className={inputClass} type="number" value={input.defaultValue} onChange={(event) => change({ inputs: config.inputs.map((item, at) => at === index ? { ...item, defaultValue: Number(event.target.value) } : item) })} />
            </label>
            <button type="button" className="min-h-10 px-2 text-xs text-red-600 disabled:opacity-40" disabled={config.inputs.length === 1} onClick={() => change({ inputs: config.inputs.filter((_, at) => at !== index) })}>Remove</button>
          </div>
        ))}
        <button type="button" disabled={config.inputs.length >= 8} className="rounded-lg border border-hairline px-3 py-2 text-sm text-ink disabled:opacity-40" onClick={() => change({ inputs: [...config.inputs, { label: `Input ${config.inputs.length + 1}`, defaultValue: 0 }] })}>Add an input</button>
      </div>
      <label className="block text-sm font-medium text-ink">Formula
        <input className={inputClass + ' font-mono'} value={config.formula} maxLength={200} placeholder="(x1 + x2) / x3" onChange={(event) => change({ formula: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-ink">Result label
          <input className={inputClass} value={config.outputLabel} maxLength={120} onChange={(event) => change({ outputLabel: event.target.value })} />
        </label>
        <label className="text-sm font-medium text-ink">Unit (optional)
          <input className={inputClass} value={config.unit ?? ''} maxLength={20} placeholder="USD, hours, %" onChange={(event) => change({ unit: event.target.value })} />
        </label>
      </div>
      <p className="rounded-lg bg-surface px-3 py-2 text-sm text-ink" role="status">Example result: <strong>{example === null ? 'Check your formula and starting numbers' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(example)} ${config.unit ?? ''}`}</strong></p>
    </div>
  );
}
