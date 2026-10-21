import {expect,it} from "vitest";
import {externalResourceUrl} from "./externalResource";
it("allows only explicit Google resource locations, without arbitrary redirect or credential hosts",()=>{
  expect(externalResourceUrl("https://docs.google.com/document/d/abc-123/copy?usp=sharing")).toContain("/abc-123/copy");
  for(const bad of ["javascript:alert(1)","https://docs.google.com.evil.test/document/d/abc/copy","https://evil.test/document/d/abc/copy","https://docs.google.com@evil.test/document/d/abc/copy","https://docs.google.com/url?q=https://evil.test","protected:workbook.pdf"])
    expect(externalResourceUrl(bad)).toBeNull();
});
