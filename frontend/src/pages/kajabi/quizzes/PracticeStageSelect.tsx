export function PracticeStageSelect({ value, onChange }: {value: string; onChange: (value: string) => void}) {
  return <label className="block text-sm leading-relaxed text-white/85">Which describes your practice now?
    <select name="practice_stage" value={value} onChange={e => onChange(e.target.value)} className="mt-2 block min-h-[44px] w-full rounded border border-white/30 bg-[#161523] px-3 text-white">
      <option value="">Prefer not to say</option>
      <option value="not_launched">I have not launched my practice yet</option>
      <option value="first_hire">I have a solo practice and am considering my first hire</option>
      <option value="existing_team">I already have a team</option>
    </select>
  </label>;
}
