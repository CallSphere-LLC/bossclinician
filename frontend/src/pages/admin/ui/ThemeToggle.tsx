import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useConsoleTheme, type ThemePreference } from "@/pages/admin/ui/theme";

/**
 * Light / Dark / System — Part II §6, §10.
 *
 * Three explicit choices rather than a two-state switch. A switch cannot
 * express "follow my machine", which is the setting most people actually want
 * and the one that keeps working when their laptop flips at sunset.
 *
 * The trigger shows what is *currently rendering* — sun in light, moon in dark
 * — while the menu marks which *preference* is chosen, so "System" being
 * selected and the sun being shown is readable rather than contradictory.
 */

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun; hint: string }[] = [
  { value: "light", label: "Light", Icon: Sun, hint: "Always light" },
  { value: "dark", label: "Dark", Icon: Moon, hint: "Always dark" },
  { value: "system", label: "System", Icon: Monitor, hint: "Follow my computer" },
];

export function ThemeToggle() {
  const { preference, theme, setPreference } = useConsoleTheme();
  const Trigger = theme === "dark" ? Moon : Sun;
  const current = OPTIONS.find((o) => o.value === preference);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          // The accessible name states the preference, not just "theme", so a
          // screen-reader user can tell "System" from "Light" without opening it.
          aria-label={`Appearance: ${current?.label ?? "System"}`}
          title={`Appearance: ${current?.label ?? "System"}`}
          className="grid size-9 place-items-center rounded-xl border border-hairline text-ink-soft transition-colors hover:border-accent/45 hover:text-accent"
        >
          <Trigger aria-hidden className="size-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[12.5rem] rounded-xl border border-hairline bg-surface-raised p-1.5 shadow-console-pop"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[0.66rem] font-bold uppercase tracking-[0.14em] text-ink-soft">
            Appearance
          </DropdownMenu.Label>
          {OPTIONS.map((option) => (
            <DropdownMenu.Item
              key={option.value}
              onSelect={() => setPreference(option.value)}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-none",
                "data-[highlighted]:bg-raise",
                preference === option.value ? "text-accent" : "text-ink",
              )}
            >
              <option.Icon aria-hidden className="size-4 shrink-0" />
              <span className="flex-1">
                {option.label}
                <span className="block text-[0.7rem] text-ink-soft">{option.hint}</span>
              </span>
              {/* A tick, not just a colour — §51. */}
              {preference === option.value && <Check aria-hidden className="size-4 shrink-0" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
