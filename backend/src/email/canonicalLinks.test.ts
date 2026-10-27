import { describe, it, expect, vi } from "vitest";
vi.mock("../config/env", () => ({ env: { publicSiteUrl: "https://bossclinician.callsphere.site" } }));
import { canonicalizeEmailLinks, publicEmailOrigin, publicEmailUrl } from "./canonicalLinks";

const old = "https://bossclinician.callsphere.site";
const site = "https://www.bossclinician.com";
describe("canonical member email links", () => {
  it("guards stale origins and encodes certificate path segments at the caller", () => {
    expect(publicEmailUrl("/account/certificates")).toBe(site+"/account/certificates");
    expect(publicEmailUrl("/verify/"+encodeURIComponent("a/b?c#d"))).toBe(site+"/verify/a%2Fb%3Fc%23d");
    expect(publicEmailOrigin("http://bossclinician.callsphere.site:8080/stale")).toBe(site);
    expect(publicEmailOrigin("https://bossclinician.com/")).toBe(site);
    expect(publicEmailOrigin("http://localhost:4100/prefix")).toBe("http://localhost:4100");
    expect(publicEmailOrigin("https://preview.example.test/")).toBe("https://preview.example.test");
  });
  it.each(["", "not a URL", "javascript:alert(1)", "https://user:secret@example.test"])("uses canonical origin for invalid/unsafe config %s", config => {
    expect(publicEmailOrigin(config)).toBe(site);
  });
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/ok\nLocation:bad"])("rejects nonlocal path %s", path => {
    expect(() => publicEmailUrl(path)).toThrow();
  });
  it("repairs persisted markdown/HTML after merge, preserving query/hash bytes and idempotence", () => {
    const url=old+"/library/credential-with-confidence/lessons/credential-with-confidence-quiz?token=a%2B%2F%3D&x=1#result";
    const body=`[Open](${url}) <a href="${url}">Quiz</a>`;
    const expected=body.replaceAll(old,site);
    expect(canonicalizeEmailLinks(body)).toBe(expected);
    expect(canonicalizeEmailLinks(expected)).toBe(expected);
  });
  it.each(["http://bossclinician.callsphere.site:80/path", "https://BOSSCLINICIAN.CALLSPHERE.SITE:443/path", old+"?x=1",old+"#report"])("maps exact public URL %s", url => {
    expect(canonicalizeEmailLinks(url)).toBe(url.replace(/^https?:\/\/bossclinician\.callsphere\.site(?::(?:80|443))?/i,site));
  });
  it.each([
    old+".evil.test/library", "https://evilbossclinician.callsphere.site/library",
    "https://admin.bossclinician.callsphere.site/admin", "https://bossclinician.callsphere.site@evil.test/a",
    "https://user@bossclinician.callsphere.site/library", "https://bossclinician.callsphere.site:8443/a",
    "https://bossclinician.callsphere.site:80/a", "http://bossclinician.callsphere.site:443/a",
    "mailto:help@bossclinician.callsphere.site", "bossclinician.callsphere.site is the former host",
    "https://external.test/redirect?next="+old+"/library",
  ])("leaves unrelated/ambiguous token unchanged: %s", input => expect(canonicalizeEmailLinks(input)).toBe(input));
  it("does not rewrite a nested third-party redirect even when the same URL also occurs directly", () => {
    const direct=old+"/library";
    expect(canonicalizeEmailLinks(`${direct} https://external.test/?next=${direct}`)).toBe(`${site}/library https://external.test/?next=${direct}`);
  });
});
