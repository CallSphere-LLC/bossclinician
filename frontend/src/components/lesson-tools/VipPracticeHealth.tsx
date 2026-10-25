import { useId, useState, type FormEvent } from "react";
import { DashboardFrame } from "./DashboardKit";
import { useMember } from "@/hooks/useMember";
import { useVersionedToolState } from "./useVersionedToolState";
import {
  AREAS, CHALLENGES, PRIORITIES, VIP_HEALTH_KEY,
  emptyVipHealth, normaliseVipHealth, vipHealthResult,
} from "./vipPracticeHealth";

/** Native, account-saved edition of the owner's VIP Practice Health package. */
export function VipPracticeHealth() {
  const { member } = useMember();
  // A shared browser can switch accounts without unmounting the player.
  return <VipPracticeHealthSession key={member?.id ?? "preview"} />;
}

function VipPracticeHealthSession() {
  const tool = useVersionedToolState(VIP_HEALTH_KEY, emptyVipHealth, normaliseVipHealth);
  const id = useId();
  const [error, setError] = useState("");
  const result = tool.state.completedAt ? vipHealthResult(tool.state) : null;
  const blocked = !tool.ready || ["loading", "offline", "readonly", "conflict"].includes(tool.status);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked) return;
    if (!vipHealthResult(tool.state)) {
      setError("Answer all six practice areas and choose your top 90-day priority.");
      return;
    }
    setError("");
    tool.setState({ ...tool.state, completedAt: new Date().toISOString() });
  }

  return (
    <DashboardFrame
      eyebrow="Boss Clinician · The Lounge VIP"
      title="Your 2-Minute Practice Health Check"
      subtitle="Eight quick questions. A clear starting point for your VIP strategy conversation."
      status={tool.status}
      savedAt={tool.savedAt}
      footer="This self-reported business coaching baseline is not a financial audit or validated diagnostic instrument. Do not enter client-identifying health information."
    >
      {!tool.ready && <p className="text-sm text-orchid">Loading your answers…</p>}
      {tool.ready && result && (
        <section aria-label="Your Practice Health Report" className="space-y-5">
          <p className="text-sm text-orchid">Your answers and report are saved privately to your account.</p>
          <div><p className="text-sm text-orchid">Overall baseline</p><p className="font-body text-4xl font-bold tabular-nums text-gold">{result.score} / 100</p></div>
          <p className="text-sm leading-relaxed text-orchid">Compare your lowest-scoring area with your challenges and 90-day priority. Confirm your focus with your VIP coach.</p>
          <dl className="divide-y divide-white/10 rounded-xl border border-white/15">
            {result.areas.map((area) => (
              <div key={area.name} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                <dt className="text-white">{area.name}</dt><dd className="shrink-0 font-bold tabular-nums text-gold">{area.score} / 4</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-orchid"><strong className="text-white">Current challenges:</strong> {result.challenges.join("; ") || "None selected"}</p>
          <p className="text-sm text-orchid"><strong className="text-white">Top 90-day priority:</strong> {result.priority}</p>
          <div className="rounded-xl border border-gold/30 bg-gold/[0.06] p-4">
            <h3 className="font-semibold text-white">Your suggested first move</h3>
            <p className="mt-1 text-sm leading-relaxed text-orchid">{result.action}</p>
          </div>
          <p className="text-xs text-orchid-dim">Each area is scored 1–4. The six scores divided by 24 produce the overall percentage. When areas tie for lowest, the first is used as a discussion prompt.</p>
          <div className="flex flex-wrap gap-3 print:hidden">
            <button type="button" onClick={() => window.print()} className="rounded-full border border-gold/50 px-4 py-2 text-sm text-white">Print or save report</button>
            <button type="button" disabled={blocked} onClick={() => tool.setState({ ...tool.state, completedAt: null })} className="rounded-full border border-white/20 px-4 py-2 text-sm text-white disabled:opacity-50">Review or update answers</button>
          </div>
        </section>
      )}
      {tool.ready && !result && (
        <form onSubmit={submit} className="space-y-6">
          <p className="text-sm leading-relaxed text-orchid">Choose what best reflects your practice right now. Your selections save to your account as you go.</p>
          {AREAS.map((area, i) => (
            <fieldset key={area.name} className="space-y-3 border-b border-white/10 pb-5" disabled={blocked}>
              <legend className="text-base font-semibold text-white"><span className="mr-2 text-gold">{String(i + 1).padStart(2, "0")}</span>{area.name}</legend>
              <p className="text-sm text-orchid">{area.question}</p>
              <div className="grid gap-2">
                {area.options.map((label, choice) => (
                  <label key={label} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-white/15 bg-white/[0.03] px-4 py-3 text-sm text-white has-[:checked]:border-gold/60 has-[:checked]:bg-gold/[0.09]">
                    <input type="radio" name={`${id}-area-${i}`} checked={tool.state.scores[i] === choice + 1}
                      onChange={() => { const scores = [...tool.state.scores]; scores[i] = choice + 1; tool.setState({ ...tool.state, scores }); }}
                      className="mt-0.5 shrink-0 accent-gold" />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="space-y-3 border-b border-white/10 pb-5" disabled={blocked}>
            <legend className="font-semibold text-white"><span className="mr-2 text-gold">07</span>Current challenges</legend>
            <p className="text-sm text-orchid">Which challenges are affecting your practice right now? Choose all that apply.</p>
            <div className="grid gap-2">{CHALLENGES.map((label) => (
              <label key={label} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/15 px-4 py-3 text-sm text-white has-[:checked]:border-gold/60">
                <input type="checkbox" checked={tool.state.challenges.includes(label)} onChange={(event) => tool.setState({ ...tool.state, challenges: event.target.checked ? [...tool.state.challenges, label] : tool.state.challenges.filter((item) => item !== label) })} className="accent-gold" />
                {label}
              </label>
            ))}</div>
          </fieldset>
          <fieldset className="space-y-3" disabled={blocked}>
            <legend className="font-semibold text-white"><span className="mr-2 text-gold">08</span>Top 90-day priority</legend>
            <p className="text-sm text-orchid">What is your most important practice goal for the next 90 days?</p>
            <div className="grid gap-2">{PRIORITIES.map((label) => (
              <label key={label} className="flex min-h-11 items-center gap-3 rounded-xl border border-white/15 px-4 py-3 text-sm text-white has-[:checked]:border-gold/60">
                <input type="radio" name={`${id}-priority`} checked={tool.state.priority === label} onChange={() => tool.setState({ ...tool.state, priority: label })} className="accent-gold" />
                {label}
              </label>
            ))}</div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-gold">{error}</p>}
          {tool.status === "conflict" && <button type="button" onClick={tool.reload} className="text-sm text-gold underline">Load the latest saved answers</button>}
          {tool.status === "offline" && <button type="button" onClick={tool.reload} className="text-sm text-gold underline">Retry loading your answers</button>}
          <button type="submit" disabled={blocked} className="min-h-11 rounded-full bg-gold px-6 py-3 text-sm font-semibold text-ink disabled:opacity-50">See my practice health baseline</button>
        </form>
      )}
    </DashboardFrame>
  );
}
