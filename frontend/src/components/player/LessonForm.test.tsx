import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonFormIdentity } from "./LessonForm";

describe("native survey account identity", () => {
  it("shows required source labels and server account values as readonly controls", () => {
    const html = renderToStaticMarkup(<LessonFormIdentity
      fields={[{key:"email",label:"Email",required:true},{key:"name",label:"First and Last Name",required:true}]}
      member={{name:"Student A",email:"student-a@example.invalid"}}
    />);
    expect(html).toContain("First and Last Name *");
    expect(html).toContain("Email *");
    expect(html).toContain('value="Student A"');
    expect(html).toContain('value="student-a@example.invalid"');
    expect(html.match(/readOnly=""/gi)).toHaveLength(2);
    expect(html.match(/required=""/g)).toHaveLength(2);
    expect(html.indexOf('name="email"')).toBeLessThan(html.indexOf('name="name"'));
  });
  it("gives missing-name members a profile-edit route instead of an uneditable dead end", () => {
    const html = renderToStaticMarkup(<LessonFormIdentity
      fields={[{key:"name",label:"First and Last Name",required:true}]}
      member={{name:"",email:"student@example.invalid"}}
    />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/account/profile"');
    expect(html).toContain("Edit your profile");
  });
  it("does not introduce identity questions into forms that do not define them", () => {
    expect(renderToStaticMarkup(<LessonFormIdentity member={{name:"A",email:"a@example.invalid"}} />)).toBe("");
  });
});
