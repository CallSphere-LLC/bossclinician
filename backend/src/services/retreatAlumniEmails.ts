/**
 * The four post-retreat alumni emails (sheet row 249, Yvette's item 12), word
 * for word from "FlourisHealer — Four Post-Retreat Alumni Emails". Migration
 * 220 inserted the original text and migration 225 revises Email 4 to this;
 * retreatAlumniEmails.test.ts pins the copy.
 *
 * Only the placeholders are changed: [First Name] is the engine's
 * {{firstName}} (blank first name reads "there"), and each bracketed call to
 * action is a button to the guest's own retreat dashboard pages, built per
 * retreat by retreatAnchor.retreatMergeValues. Email 4 (revised by migration
 * 225, Yvette's round-2 item 6) has her new preview text and paragraph and an
 * "Explore upcoming retreats" button to the permanent /upcoming-retreats page
 * (a retreat's owner-set link overrides it); it ships switched OFF.
 *
 * Emails 1-2 are relationship mail (thank-you, gallery, private feedback):
 * topic '' — only a full unsubscribe, a bounce or a complaint stops them.
 * Emails 3-4 are marketing (topic 'marketing'), and also skip anybody who has
 * declined future invitations on a retreat dashboard.
 *
 * Import-free so a script can render the preview without a database.
 */

export interface AlumniEmail {
  position: number;
  /** Days after the retreat's end date (owner-approved 22 Nov 2026). */
  offsetDays: number;
  subject: string;
  previewText: string;
  bodyMd: string;
  /** '' = relationship mail; 'marketing' = honours the marketing switch. */
  topic: "" | "marketing";
  skipRules: Record<string, unknown>;
  /**
   * Whether the email ships switched on (sequence_emails.enabled). Email 4
   * stays OFF until /upcoming-retreats and /retreat-interest are live and
   * tested (Yvette, 22 Nov 2026 round 2, item 6); migration 225.
   */
  enabled: boolean;
}

export const ALUMNI_SEQUENCE_SLUG = "retreat-alumni";

export const ALUMNI_EMAILS: readonly AlumniEmail[] = [
  {
    position: 1,
    offsetDays: 3,
    subject: "We made those memories together",
    previewText: "Your FlourisHealer gallery is waiting.",
    topic: "",
    skipRules: {},
    enabled: true,
    bodyMd: `Hey {{firstName}},

You're home, but I hope you're still carrying little moments from our time together. The laughter. The conversations that didn't need an explanation. The simple joy of being somewhere beautiful without having to be everything for everyone.

Thank you for choosing to experience FlourisHealer with us. It means so much that you made room for yourself and trusted us to be part of that time.

I created a private space for our retreat memories. You can view the photos and videos, upload your own favorites, and revisit the moments that made you smile.

[OPEN OUR RETREAT MEMORIES]({{retreatMemoriesUrl}} "button")

You're welcome to share the pictures you love. Please be mindful of other guests' privacy before posting images of them, and remember that the gallery is for our retreat group—not a public marketing album.

With so much love,
Yvette
FlourisHealer Retreats`,
  },
  {
    position: 2,
    offsetDays: 7,
    subject: "Can I ask you something about our retreat?",
    previewText: "Your reflections will help me make the next experience even more thoughtful.",
    topic: "",
    skipRules: { retreat: { feedbackSubmitted: true } },
    enabled: true,
    bodyMd: `Hey {{firstName}},

There's something I care about just as much as the beautiful photos: how the experience actually felt for you.

What was your favorite moment? What made you feel cared for? What would you love to see us do differently? I would genuinely appreciate hearing all of it.

I've added a short, optional reflection to your FlourisHealer dashboard. You can share your feedback privately, and if you ever want to share a public testimonial, there's a separate choice for that. No pressure to make it public.

[SHARE YOUR EXPERIENCE]({{retreatFeedbackUrl}} "button")

Thank you again for taking this journey with us. Your reflections help me build experiences that feel even more intentional for the women who come next.

With love,
Yvette`,
  },
  {
    position: 3,
    offsetDays: 14,
    subject: "Where should FlourisHealer take you next?",
    previewText: "Another getaway, a domestic business retreat, or maybe both?",
    topic: "marketing",
    skipRules: { retreat: { interestSet: true, marketingOptedOut: true } },
    enabled: true,
    bodyMd: `Hey {{firstName}},

One of my favorite parts of hosting FlourisHealer is seeing how quickly a group of women can feel connected when they finally make space to enjoy life together.

I want to keep creating those experiences—and I would love to know what would excite you next.

Would you be dreaming about another international getaway where you can simply enjoy the destination and be poured into? Or would a domestic business retreat with strategy, a content day, and meaningful connection be more your speed? Maybe both.

Inside your guest dashboard, you can tell me which experiences you'd like to hear about and choose whether to receive future invitations. No new retreat booking is required to share your preference.

[TELL ME WHAT INTERESTS YOU]({{retreatInterestUrl}} "button")

Wherever we go next, I want the experience to feel worth making time for.

With love,
Yvette`,
  },
  {
    position: 4,
    offsetDays: 21,
    subject: "It's always your turn to make room for you",
    previewText: "Stay connected to what's next for FlourisHealer.",
    topic: "marketing",
    skipRules: { retreat: { marketingOptedOut: true, bookedFeatured: true } },
    enabled: false,
    bodyMd: `Hey {{firstName}},

I hope you've kept at least a little of that FlourisHealer feeling with you—the freedom to laugh, connect, rest, and enjoy yourself without explaining why you deserve it.

If you've been thinking, "I want to do something like that again," I have a place for you to hear what's coming next.

FlourisHealer will continue to offer international experiences focused on time away and meaningful connection, along with domestic business retreats designed for strategy, content creation, and community.

If an upcoming retreat catches your eye, you can explore the details and decide whether it fits your next chapter. If nothing is announced yet, you can sign up to hear when new retreats are available.

[Explore upcoming retreats]({{retreatNextUrl}} "button")

No rush. I'm simply keeping the door open. You've already shown yourself that making space for you is possible.

With so much love,
Yvette
FlourisHealer Retreats`,
  },
];
