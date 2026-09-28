import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FRAME_HOSTS, embeddableUrl, playableVideo } from "./videoEmbed";

describe("embeddableUrl", () => {
  it("turns share links into each provider's player address", () => {
    expect(embeddableUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(embeddableUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embeddableUrl("https://vimeo.com/123456/abcdef")).toBe("https://player.vimeo.com/video/123456?h=abcdef");
    expect(embeddableUrl("https://www.loom.com/share/0123abcd")).toBe("https://www.loom.com/embed/0123abcd");
  });

  it("leaves anything else as it was pasted", () => {
    expect(embeddableUrl("not a url")).toBe("not a url");
    expect(embeddableUrl("https://example.com/v.mp4")).toBe("https://example.com/v.mp4");
  });
});

describe("playableVideo", () => {
  it("has nothing to play for a blank or unusable setting", () => {
    expect(playableVideo("")).toBeNull();
    expect(playableVideo("   ")).toBeNull();
    expect(playableVideo(undefined)).toBeNull();
    expect(playableVideo("javascript:alert(1)")).toBeNull();
    expect(playableVideo("not a url")).toBeNull();
  });

  it("plays a Media Library upload by path, whichever of the site's addresses it was copied from", () => {
    // Copied today from the callsphere address, played after the move to
    // bossclinician.com: by path it is always this origin's own file.
    expect(playableVideo("https://bossclinician.callsphere.site/uploads/abc.mp4")).toEqual({
      kind: "file",
      src: "/uploads/abc.mp4",
    });
    expect(playableVideo("https://www.bossclinician.com/uploads/abc.mp4")).toEqual({ kind: "file", src: "/uploads/abc.mp4" });
    expect(playableVideo("/uploads/abc.mp4")).toEqual({ kind: "file", src: "/uploads/abc.mp4" });
    expect(playableVideo("http://localhost:5301/uploads/abc.mp4", "localhost:5301")).toEqual({
      kind: "file",
      src: "/uploads/abc.mp4",
    });
  });

  it("frames the four providers the site's policy allows", () => {
    expect(playableVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toEqual({
      kind: "frame",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(playableVideo("https://www.youtube.com/embed/dQw4w9WgXcQ")).toEqual({
      kind: "frame",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    });
    expect(playableVideo("https://vimeo.com/123456")).toEqual({ kind: "frame", src: "https://player.vimeo.com/video/123456" });
    expect(playableVideo("https://player.vimeo.com/video/123456?h=ab")).toEqual({
      kind: "frame",
      src: "https://player.vimeo.com/video/123456?h=ab",
    });
    expect(playableVideo("https://www.loom.com/share/0123abcd")).toEqual({ kind: "frame", src: "https://www.loom.com/embed/0123abcd" });
    expect(playableVideo("https://bossclinician.wistia.com/medias/a1b2c3d4e5")).toEqual({
      kind: "frame",
      src: "https://fast.wistia.net/embed/iframe/a1b2c3d4e5",
    });
  });

  it("offers any other address as a link rather than a frame the policy would blank", () => {
    expect(playableVideo("https://drive.google.com/file/d/xyz/view")).toEqual({
      kind: "link",
      href: "https://drive.google.com/file/d/xyz/view",
    });
    // Somebody else's video file: `media-src 'self'` would refuse to play it.
    expect(playableVideo("https://cdn.example.com/masterclass.mp4")).toEqual({
      kind: "link",
      href: "https://cdn.example.com/masterclass.mp4",
    });
  });

  it("frames only hosts nginx/site.conf lets the page frame", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const conf = readFileSync(path.resolve(here, "../../../nginx/site.conf"), "utf8");
    const frameSrc = /frame-src ([^;]+);/.exec(conf)?.[1] ?? "";
    for (const host of FRAME_HOSTS) {
      expect(frameSrc.split(/\s+/), host).toContain(`https://${host}`);
    }
  });
});
