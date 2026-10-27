import { describe, it, expect, vi } from "vitest";
vi.hoisted(() => { process.env.PUBLIC_SITE_URL = "https://bossclinician.callsphere.site"; });
import { certificateEmail } from "./certificates";

describe("certificate email URL generation", () => {
  it("renders canonical account and verification URLs even with stale configuration", () => {
    const email=certificateEmail({firstName:"<QA>",courseTitle:"CWC & Course",creditLabel:"1.75 CE hours",verificationCode:"opaque/code?x=1"});
    expect(email.text).toContain("https://www.bossclinician.com/account/certificates");
    expect(email.text).toContain("https://www.bossclinician.com/verify/opaque%2Fcode%3Fx%3D1");
    expect(email.html).toContain('href="https://www.bossclinician.com/account/certificates"');
    expect(email.html).toContain('href="https://www.bossclinician.com/verify/opaque%2Fcode%3Fx%3D1"');
    expect(email.html).toContain("&lt;QA&gt;");
    expect(email.text+email.html).not.toContain("bossclinician.callsphere.site");
  });
});
