import { describe, expect, it } from "vitest";
import { readSpreadsheet } from "./peopleSpreadsheet";

/** The heading row exactly as Kajabi's "Export contacts" writes it (September 2026). */
const KAJABI_HEADINGS = "Name,First Name,Last Name,Email,Products,Tags,ID,Member ID,External User ID,Created At,Member Created At,Sign In Count,Last Activity,Last Sign In At,First Name (name),Email (email),Phone Number (phone_number),Mobile Phone Number (mobile_phone_number),Address (address_line_1),Address Line 2 (address_line_2),City (address_city),State (address_state),Country (address_country),Zip Code (address_zip),Business Number (business_number),How Many Employees/Contractors Do You Have (custom_50),I agree to be charged the agreed monthly payments until I cancel (custom_52),Source (custom_1),Last Name (custom_2),Credit Card Number (custom_3),Expiration (custom_4),CW (custom_5),Agree (custom_8),Your Masterclass Review (custom_6),\"I hereby authorize Boss Clinician LLC. to copy, exhibit, publish or distribute the testimonial for purposes of publicizing Boss Clinician LLC. programs or for any other lawful purpose. I agree that I will make no monetary or other claim against Boss Clinician LLC for the use of the statement. (custom_7)\",What do you want your practice to look and feel like in the next 90 days? (custom_14),Why are you ready to invest in support at this stage of your journey?  (custom_15),Do you have an Instagram handle? (custom_11),I am currently feeling\u2026  (custom_12),I feel excited but need guidance and structure (custom_24),\"The investment to start working with Yvette begins at $2500, with payment plan options available. Are you ready to invest in yourself at this level? (custom_17)\",I feel stuck and unsure about my next steps in private practice (custom_19),\"I feel overwhelmed trying to balance clients, life, and business tasks (custom_20)\",I feel underpaid for the work and energy I give (custom_21),\"I feel confident clinically, but not as a business owner (custom_22)\",I feel ready for a major shift in my practice (custom_23),I feel burnt out from agency work and want more freedom (custom_25),I feel disconnected from my true earning potential (custom_26),What do you want your practice to look and feel like in the next 90 days? (Select All That Apply) (custom_27),I want my practice to be profitable and financially stable (custom_28),\"I want my practice to support my lifestyle, not drain me (custom_30)\",\"I want my practice to feel organized, structured, and sustainable (custom_31)\",I want my practice to grow without burning me out (custom_32),\"I want my practice to reflect who I am as a strong, ambitious woman (custom_33)\",I want my practice to expand into a group practice or bigger vision (custom_34),\"I want my practice to give me more time, freedom, and peace (custom_35)\",What is your current practice status? (custom_13),Have you ever invested in a program or mentorship to help start or grow your practice? (custom_38),What is your DREAM Monthly Revenue!? (custom_41),\"If you found a system to grow your business quickly, and it required an investment to get started, how would you fund that investment? (custom_42)\",How did you hear about me? (custom_43),What is your current monthly revenue? (custom_40),I am currently feeling\u2026 (Select All That Apply) (custom_18),How would you like me to follow up with you? (custom_45),\"If I sent you a message right now saying you are accepted to work with me, is there anything holding you back? (custom_46)\",\"Are you a therapist or service provider looking to acquire more clients, scale or grow your private practice (custom_39)\",Which package are you interested in? I have 3 options to choose from. (custom_37),Room Preference  (custom_47),What is your license type (custom_10),How Long Have You Been In Practice (custom_48),How Long Have You Been A Group Practice Owner (custom_49),\"Therapists obtaining consulting services with Yvette are in private practice and making $100k/year and growing. They want to stop hustling with 1:1 and start scaling and growing their practice without the overwhelm, frustration and confusion and not making mistakes in the process. How do you feel about stepping into the next phase of your private practice journey? (custom_44)\",\"If a payment plan is needed, choose the best option that works best for you (Should match the package you are wanting to start with) (custom_16)\",Webinar time (custom_9),\"I want my practice to attract aligned, higher-paying clients (custom_29)\",Did you confirm your email was registered correctly? (custom_51),What is your current practice status? (custom_36)";

/** A line of that export: values for the named columns, blank everywhere else. */
function kajabiLine(values: Record<string, string>): string {
  const headings = parseHeadings();
  return headings
    .map((heading) => {
      const value = values[heading] ?? "";
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
    .join(",");
}

function parseHeadings(): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const char of KAJABI_HEADINGS) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

describe("readSpreadsheet on a Kajabi contacts export", () => {
  const file = [
    "\uFEFF" + KAJABI_HEADINGS,
    kajabiLine({
      Name: "Pat Example",
      "First Name": "Pat",
      "Last Name": "",
      Email: "pat@example.invalid",
      "Email (email)": "pat@example.invalid",
      "First Name (name)": "Pat Example",
      "Last Name (custom_2)": "Example",
      Products: "Credential With Confidence, Practice Reset Intensive",
      Tags: "quiz, Bali 2027 Attendee",
      ID: "2233445566",
      "Member ID": "778899",
      "Created At": "2024-05-06 18:01:32 -0700",
      "Last Activity": "2025-02-03 04:05:06 -0800",
      "Phone Number (phone_number)": "555-0100",
      "City (address_city)": "Atlanta",
      "Credit Card Number (custom_3)": "4111111111111111",
      "CW (custom_5)": "123",
      "Expiration (custom_4)": "12/30",
      "What is your current practice status? (custom_13)": "Solo, part time",
      "What is your current practice status? (custom_36)": "Growing",
      "Do you have an Instagram handle? (custom_11)": "@pat\nand @patbiz",
    }),
    kajabiLine({ Name: "No Address" }),
  ].join("\r\n");

  const parsed = readSpreadsheet(file);
  const [pat] = parsed.rows;

  it("reads the people and counts the line without an address", () => {
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.unusable).toBe(1);
  });

  it("maps Kajabi's headings onto the contact's own fields", () => {
    expect(pat).toMatchObject({
      email: "pat@example.invalid",
      name: "Pat Example",
      firstName: "Pat",
      lastName: "Example",
      phone: "555-0100",
      tags: "quiz, Bali 2027 Attendee",
      products: "Credential With Confidence, Practice Reset Intensive",
      createdAt: "2024-05-06 18:01:32 -0700",
      lastActivityAt: "2025-02-03 04:05:06 -0800",
    });
  });

  it("keeps every other column, under the question she recognises", () => {
    expect(pat.customFields).toEqual({
      ID: "2233445566",
      "Member ID": "778899",
      City: "Atlanta",
      "What is your current practice status?": "Solo, part time",
      "What is your current practice status? (custom_36)": "Growing",
      "Do you have an Instagram handle?": "@pat\nand @patbiz",
    });
  });

  it("never reads card details, whatever is in those columns", () => {
    const sent = JSON.stringify(parsed.rows);
    expect(sent).not.toContain("4111111111111111");
    expect(sent).not.toContain("12/30");
    expect(sent).not.toMatch(/credit card|\bCW\b|expiration/i);
  });
});

describe("readSpreadsheet on a plain list", () => {
  it("still reads pasted lines with no headings", () => {
    const parsed = readSpreadsheet("yvette@example.com\tYvette Howard\n");
    expect(parsed.rows).toEqual([{ email: "yvette@example.com", name: "Yvette Howard" }]);
  });
});
