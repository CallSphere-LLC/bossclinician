export type GrowthState = Record<string, unknown>;
export const growthDefaults = (): GrowthState => ({version:4, workspaces:{}, cycle:1, start:new Date().toISOString().slice(0,10), answers:Array(12).fill(null), intake:{}, goalMeasures:[], coaching:{}, focus:"clarity", snapshotDone:false, flags:[], goals:[], status:Array(12).fill("Not started"), metrics:{}, metricsNotes:"", review:{}, history:[]});
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const safe = (value: unknown, depth = 0): unknown => {
  if (depth > 12) return null;
  if (typeof value === "string") return value.slice(0,20000);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0,500).map(v => safe(v, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).filter(([k]) => !["__proto__","constructor","prototype"].includes(k)).map(([k,v]) => [k,safe(v,depth+1)]));
  return null;
};
export function normaliseGrowth(raw: unknown): GrowthState {
  const clean = safe(raw), base = growthDefaults();
  if (!record(clean)) return base;
  const state: GrowthState = {...base, ...clean, version:4};
  state.focus = ["clarity","revenue","systems","owner","clients","sustain"].includes(String(state.focus)) ? state.focus : "clarity";
  state.cycle = typeof state.cycle === "number" && state.cycle > 0 ? Math.floor(state.cycle) : 1;
  state.start = typeof state.start === "string" ? state.start : base.start;
  for (const k of ["workspaces","intake","coaching","metrics","review"]) if (!record(state[k])) state[k] = {};
  for (const k of ["goalMeasures","answers","flags","goals","history"]) if (!Array.isArray(state[k])) state[k] = base[k];
  state.goals = (state.goals as unknown[]).slice(0,3).map(String);
  state.status = Array.from({length:12}, (_,i) => {
    const v = Array.isArray(clean.status) ? clean.status[i] : undefined;
    return ["Not started","In progress","Completed","Blocked"].includes(String(v)) ? v : "Not started";
  });
  state.history = (state.history as unknown[]).filter(record).map(h => ({...h,status:Array.isArray(h.status) ? h.status : [], goals:Array.isArray(h.goals) ? h.goals : []}));
  return state;
}
