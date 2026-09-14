import { Link } from "react-router-dom";
import { Button } from "./primitives";
import { Modal } from "./Dialog";

const types = [
  { name: "Course", route: "courses", description: "Teach a structured programme.", features: ["Video and audio content", "Text lessons", "Quizzes and surveys", "Membership area", "Exclusive downloads"] },
  { name: "Community", route: "community", description: "Bring your members together.", features: ["Channels and posts", "Direct messages", "Live rooms"] },
  { name: "Coaching", route: "coaching", description: "Offer personal support.", features: ["One-to-one or group sessions", "Scheduling", "Session files"] },
  { name: "Podcast", route: "podcasts", description: "Publish audio for your listeners.", features: ["Episodes", "Private feeds", "Audio uploads"] },
  { name: "Newsletter", route: "newsletters", description: "Build a regular connection.", features: ["Issues", "Subscriber access", "Email delivery"] },
  { name: "Download", route: "downloads", description: "Sell useful files and resources.", features: ["Multiple files", "Cover image", "Purchase instructions", "Re-downloads"] },
];

export function NewProductPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Modal open={open} onOpenChange={onOpenChange} title="New product" description="Choose what you want to create." size="xl">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {types.map((type) => <section key={type.name} className="flex min-w-0 flex-col gap-4 rounded-xl border border-hairline bg-surface p-5">
        <h3 className="font-display text-xl text-ink">{type.name}</h3>
        <p className="text-sm text-ink-soft">{type.description}</p>
        <ul className="flex-1 space-y-1 text-xs text-ink-soft">{type.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
        <Button asChild size="sm" className="self-start"><Link to={`/admin/${type.route}?new=1`}>Create {type.name}</Link></Button>
      </section>)}
    </div>
  </Modal>;
}
